import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import {
  Upload, GitCompareArrows, ChevronLeft, ChevronRight,
  X, Trash2, Sparkles, Image as ImageIcon
} from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { isSignedUrlFresh, signedUrlEntriesFor, signedUrlsFor } from '../../../lib/signedUrls.ts'
import type { SignedUrl } from '../../../lib/signedUrls.ts'
import { compressImageToBlob, compressImageToDataUrl, captionPhoto } from '../../../lib/docIntelligence.ts'
import { toastError, toastSuccess } from '../../../lib/toast.ts'
import { hapticTap, hapticSuccess } from '../../../lib/haptics.ts'
import { queuePhoto, isNetworkError } from '../../../lib/outbox.ts'
import { SkeletonList } from '../../../components/Skeleton.tsx'
import DataErrorState from '../../../components/DataErrorState.tsx'
import LoadingValue from '../../../components/LoadingValue.tsx'
import { countNoun } from '../../../lib/format.ts'
import { keepFocusOnRetry } from '../../../lib/retryFocus.ts'
import { jobPhotosKey } from '../phone/SpineList.tsx'
import { useArmedId } from '../../../lib/secondTap.ts'
import { Eyebrow } from '../../../components/v3'

const BUCKET = 'job-photos'
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB per photo

// Curated section options for the photo-tagging picker. Free-text
// "Other…" branch lets the contractor add a custom label when their
// trade isn't on this list (matches the section names they use in
// fh_quote_items.section). The PDF photos-by-section distributor
// matches strings exactly, so picker labels here mirror what shows
// up in scope cards.
const SCOPE_SECTIONS = [
  'Demolition',
  'Roofing',
  'Exterior',
  'Interior',
  'Concrete',
  'Framing',
  'Electrical',
  'Plumbing',
  'HVAC',
  'Finishes',
  'Allowances',
  'Site work'
]

/**
 * Photos section, fh_job_files where kind='photo'.
 *
 * Features (preserved from legacy UploadList):
 *   - Multi-upload from <input type="file" multiple accept="image/*">
 *   - Direct upload to private 'job-photos' Supabase Storage bucket
 *     (path: <userId>/<jobId>/<rowId>.<ext>); insert into fh_job_files.
 *   - Fire-and-forget Claude Vision auto-captioning post-upload
 *     (captionAndPersist). Caption column may be missing (migration 009
 *     not applied), UPDATE silently no-ops in that case.
 *   - 3-col responsive grid with signed URL thumbnails (1h TTL).
 *   - Lightbox with swipe-between + caption editor.
 *   - Compare mode: select 2 photos, drag the before/after slider.
 *   - incomingFiles: photos the phone Job page's camera took; they upload
 *     once, exactly as if picked with Add Photos.
 */
export default function PhotosSection({ jobId, userId, incomingFiles = null, onIncomingHandled }: any) {
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<any[]>([])
  // Each grid photo's signed URL by row id, with when it was signed.
  const [thumbUrls, setThumbUrls] = useState<Record<string, SignedUrl>>({})
  const [loading, setLoading] = useState(true)
  // A read of this job's photos has landed, so the count and the empty
  // card can show; until then neither does.
  const [loaded, setLoaded] = useState(false)
  // The latest read failed. Photos an earlier read brought stay on screen.
  const [failed, setFailed] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [captioningIds, setCaptioningIds] = useState(() => new Set())
  // Destructive-confirm sheet state for delete photo.
  // Delete asks with a second tap on the same button (D57).
  const deleteTap = useArmedId()
  const [deleting, setDeleting] = useState(false)

  const [lightboxIdx, setLightboxIdx] = useState(-1)
  const [lightboxUrl, setLightboxUrl] = useState('')

  const [compareMode, setCompareMode] = useState(false)
  const [compareBefore, setCompareBefore] = useState<any>(null)
  const [compareAfter, setCompareAfter] = useState<any>(null)

  const inputRef = useRef<any>(null)
  // The section; Try again leaves focus on the sub tab's panel around it.
  const rootRef = useRef<HTMLDivElement>(null)
  // Each read takes the next number and sets state only while it is the
  // latest: an upload's reread that fails late never marks the photos a
  // delete just read again as failed.
  const readSeq = useRef(0)
  useEffect(() => () => { readSeq.current += 1 }, [])

  const fetchRows = useCallback(async () => {
    if (!jobId || !userId) return
    const seq = ++readSeq.current
    setLoading(true)
    // Every photo on the job, whoever took it: org RLS scopes the read
    // to teammates and accepted partners.
    const { data, error } = await supabase
      .from('fh_job_files')
      .select('*')
      .eq('job_id', jobId)
      .eq('kind', 'photo')
      .order('uploaded_at', { ascending: false })
    // A newer read has gone out since: it decides.
    if (seq !== readSeq.current) return
    // A failed read is never "0 photos" or the empty card: it says so, with
    // Try again, and keeps what an earlier read brought.
    if (error) {
      setFailed(true)
      setLoading(false)
      return
    }
    const list = data || []
    setRows(list)
    setLoaded(true)
    setFailed(false)
    setLoading(false)

    // Batch sign URLs for the grid thumbnails. URLs signed in the last
    // 50 minutes are reused, so coming back to the job lets the browser
    // cache serve the images instead of downloading them again.
    if (list.length > 0) {
      const byPath = await signedUrlEntriesFor(queryClient, BUCKET, list.map((r) => r.storage_path))
      if (seq !== readSeq.current) return
      const next: Record<string, SignedUrl> = {}
      for (const r of list) {
        const entry = byPath.get(r.storage_path)
        if (entry) next[r.id] = entry
      }
      setThumbUrls(next)
    } else {
      setThumbUrls({})
    }
  }, [jobId, userId, queryClient])

  // Another job's photos never stand in for this one's, nor does a read of
  // them still out.
  useEffect(() => {
    readSeq.current += 1
    setRows([])
    setThumbUrls({})
    setLoaded(false)
    setFailed(false)
  }, [jobId])

  useEffect(() => { fetchRows() }, [fetchRows])

  function pick() { inputRef.current?.click() }

  // The phone header and Spine read their own photo query; refresh it
  // after this section adds or removes a photo.
  function refreshJobPhotos() {
    queryClient.invalidateQueries({ queryKey: jobPhotosKey(jobId) })
  }

  // Camera photos from the Job page: upload each batch once. The ref
  // survives StrictMode's second effect run, so nothing uploads twice.
  const handledIncoming = useRef<any>(null)
  useEffect(() => {
    if (!Array.isArray(incomingFiles) || incomingFiles.length === 0) return
    if (!jobId || !userId || handledIncoming.current === incomingFiles) return
    handledIncoming.current = incomingFiles
    onIncomingHandled?.()
    void uploadFiles(incomingFiles)
    // uploadFiles reads the current job and user; the batch is the trigger.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomingFiles, jobId, userId])

  async function handleFile(e: any) {
    await uploadFiles(Array.from(e.target.files || []))
  }

  async function uploadFiles(picked: any[]) {
    const files: any[] = picked
    if (files.length === 0) return
    setUploading(true)
    const newPhotoIds: any[] = []
    let queuedCount = 0
    try {
      for (const file of files) {
        if (file.size > MAX_BYTES) {
          toastError('Photo too large', `${file.name} exceeds 10 MB`)
          continue
        }
        // Re-encode through canvas to strip EXIF metadata before upload.
        // Drops GPS coordinates, camera identity, and timestamps from
        // jobsite photos. Orientation is preserved because the browser
        // auto-rotates pixels at <img> decode time. Storage gets a
        // ~1.5MB JPEG instead of the original 3-8MB raw file.
        let uploadBlob: any
        try {
          uploadBlob = await compressImageToBlob(file, 1_500_000, 1800)
        } catch (ex: any) {
          toastError("Couldn't process photo", ex?.message || `${file.name} skipped`)
          continue
        }
        const rowId = crypto.randomUUID()
        const path = `${userId}/${jobId}/${rowId}.jpg`
        const row = {
          id: rowId,
          user_id: userId,
          job_id: jobId,
          filename: file.name,
          storage_path: path,
          mime_type: 'image/jpeg',
          size_bytes: uploadBlob.size,
          kind: 'photo'
        }
        // Dead-zone path: park the compressed blob + row in the outbox
        // (IndexedDB) and move on, it uploads when signal returns.
        if (navigator.onLine === false) {
          const ok = await queuePhoto({ bucket: BUCKET, path, blob: uploadBlob, contentType: 'image/jpeg', row })
          if (ok) queuedCount += 1
          else toastError("Couldn't save offline", `${file.name}: offline storage is full`)
          continue
        }
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, uploadBlob, { upsert: false, contentType: 'image/jpeg' })
        if (upErr) {
          if (isNetworkError(upErr)) {
            const ok = await queuePhoto({ bucket: BUCKET, path, blob: uploadBlob, contentType: 'image/jpeg', row })
            if (ok) queuedCount += 1
            else toastError("Couldn't save offline", `${file.name}: offline storage is full`)
            continue
          }
          throw upErr
        }
        const { error: insErr } = await supabase.from('fh_job_files').insert(row)
        if (insErr) throw insErr
        newPhotoIds.push({ id: rowId, file: uploadBlob })
      }
      hapticSuccess()
      if (queuedCount > 0) {
        toastSuccess('Saved offline', `${queuedCount} photo${queuedCount === 1 ? '' : 's'} will upload when signal returns`)
      }
      if (newPhotoIds.length > 0) {
        toastSuccess(`${countNoun(newPhotoIds.length, 'Photo')} uploaded`, `Added ${newPhotoIds.length}`)
      }
      await fetchRows()
      refreshJobPhotos()
      // Vision captioning runs async. If column missing → silent.
      if (newPhotoIds.length > 0) {
        setCaptioningIds((prev) => {
          const next = new Set(prev)
          for (const { id } of newPhotoIds) next.add(id)
          return next
        })
        for (const { id, file } of newPhotoIds) {
          captionAndPersist(id, file)
        }
      }
    } catch (ex: any) {
      toastError('Upload failed', ex?.message || 'Try again')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function captionAndPersist(rowId: any, file: any) {
    try {
      const dataUrl = await compressImageToDataUrl(file, 900_000, 1280)
      const cap = await captionPhoto(dataUrl)
      if (!cap) return
      const { error } = await supabase
        .from('fh_job_files')
        .update({ caption: cap })
        .eq('id', rowId)
        .eq('user_id', userId)
      if (error) return
      setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, caption: cap } : r))
    } catch {
      // Vision call failed (network/quota), keep photo, drop caption.
    } finally {
      setCaptioningIds((prev) => {
        if (!prev.has(rowId)) return prev
        const next = new Set(prev)
        next.delete(rowId)
        return next
      })
    }
  }

  // Any teammate can caption or tag a photo, so these writes match by id
  // and leave the tenant check to RLS. A write that matches no row (the
  // photo was deleted meanwhile) returns no error, so ask for the id back.
  async function saveCaption(rowId: any, nextCaption: any) {
    const trimmed = (nextCaption || '').trim()
    setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, caption: trimmed || null } : r))
    const { data, error } = await supabase
      .from('fh_job_files')
      .update({ caption: trimmed || null })
      .eq('id', rowId)
      .select('id')
    if (error || !data?.length) {
      toastError("Couldn't save caption", error?.message || 'This photo may have been deleted.')
      fetchRows()
    }
  }

  // Tagging a photo to a scope section ("Roofing", "Demolition", …) lets
  // the proposal PDF + on-screen ProposalTemplate distribute the photo
  // to the matching ScopeSectionCard so the customer sees evidence per
  // trade. Column added by migration 020; the PDF loader falls back to
  // the photo caption for older rows.
  async function saveSectionTag(rowId: any, nextTag: any) {
    const trimmed = (nextTag || '').trim()
    setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, section_tag: trimmed || null } : r))
    const { data, error } = await supabase
      .from('fh_job_files')
      .update({ section_tag: trimmed || null })
      .eq('id', rowId)
      .select('id')
    if (error || !data?.length) {
      toastError("Couldn't save section tag", error?.message || 'This photo may have been deleted.')
      fetchRows()
    }
  }

  // Open the destructive-confirm sheet for this photo. The actual
  // storage + db delete happens in confirmRemove on commit.
  // The first tap arms the lightbox's delete button, the second closes the
  // lightbox and removes the photo from storage and the job record.
  function remove(row: any) {
    if (!row || deleting) return
    deleteTap.tap(row.id, () => { closeLightbox(); void confirmRemove(row) })
  }

  async function confirmRemove(row: any) {
    if (!row || deleting) return
    setDeleting(true)
    try {
      // Object first: the storage delete policy for teammates needs the
      // fh_job_files row to still exist. remove() reports failure in
      // { error } instead of throwing, and a failed remove must keep the
      // row, or the object is orphaned with nothing pointing at it.
      const { error: rmErr } = await supabase.storage.from(BUCKET).remove([row.storage_path])
      if (rmErr) throw rmErr
      const { data: gone, error: delErr } = await supabase
        .from('fh_job_files')
        .delete()
        .eq('id', row.id)
        .select('id')
      if (delErr) throw delErr
      if (!gone?.length) toastError('Delete failed', 'This photo may already be gone.')
      else toastSuccess('Deleted', row.filename)
      await fetchRows()
      refreshJobPhotos()
    } catch (ex: any) {
      toastError('Delete failed', ex?.message || 'Try again')
    } finally {
      setDeleting(false)
    }
  }

  // The grid's URL while it is fresh by when it was signed (the grid can
  // stay open past its hour); otherwise a fresh one.
  async function urlFor(row: any) {
    const thumb = thumbUrls[row.id]
    if (thumb && isSignedUrlFresh(thumb.signedAt)) return thumb.url
    const byPath = await signedUrlsFor(queryClient, BUCKET, [row.storage_path])
    return byPath.get(row.storage_path) || ''
  }

  async function openLightbox(idx: any) {
    const row = rows[idx]
    if (!row) return
    setLightboxIdx(idx)
    const url = await urlFor(row)
    setLightboxUrl(url)
  }

  function closeLightbox() {
    setLightboxIdx(-1)
    setLightboxUrl('')
  }

  async function goLightbox(delta: any) {
    const next = lightboxIdx + delta
    if (next < 0 || next >= rows.length) return
    setLightboxUrl('')
    setLightboxIdx(next)
    const url = await urlFor(rows[next])
    setLightboxUrl(url)
  }

  async function handleThumbTap(row: any) {
    hapticTap()
    if (!compareMode) {
      const idx = rows.findIndex((r) => r.id === row.id)
      openLightbox(idx)
      return
    }
    const url = await urlFor(row)
    if (!url) return
    if (!compareBefore) {
      setCompareBefore({ row, url })
    } else if (!compareAfter && row.id !== compareBefore.row.id) {
      setCompareAfter({ row, url })
    } else {
      setCompareBefore({ row, url })
      setCompareAfter(null)
    }
  }

  function exitCompare() {
    setCompareMode(false)
    setCompareBefore(null)
    setCompareAfter(null)
  }

  const lightboxRow = lightboxIdx >= 0 && lightboxIdx < rows.length ? rows[lightboxIdx] : null

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 24px 24px' }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        {loaded ? (
          <Eyebrow>
            {rows.length} {rows.length === 1 ? 'photo' : 'photos'}
          </Eyebrow>
        ) : loading ? (
          <LoadingValue label="Loading photos" width={72} height={12} />
        ) : <span aria-hidden="true" />}
        <div style={{ display: 'inline-flex', gap: 8 }}>
          {rows.length >= 2 && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => { hapticTap(); compareMode ? exitCompare() : setCompareMode(true) }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 8,
                padding: '8px 12px', borderRadius: 10,
                border: compareMode
                  ? '1px solid color-mix(in srgb, var(--v3-primary) 50%, transparent)'
                  : '1px solid var(--v3-border)',
                background: compareMode ? 'var(--v3-primary-soft)' : 'transparent',
                color: compareMode ? 'var(--v3-primary-text)' : 'var(--v3-text)',
                fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                letterSpacing: 0, cursor: 'pointer'
              }}
            >
              <GitCompareArrows size={12} aria-hidden="true" />
              {compareMode ? 'Exit compare' : 'Compare'}
            </motion.button>
          )}
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={pick}
            disabled={uploading}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 8,
              padding: '8px 12px', borderRadius: 10, border: 'none',
              background: 'var(--v3-primary)', color: 'var(--v3-on-primary)',
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
              letterSpacing: 0,
              cursor: uploading ? 'wait' : 'pointer',
              boxShadow: '0 6px 18px rgba(201, 150, 58, 0.28)',
              opacity: uploading ? 0.7 : 1
            }}
          >
            <Upload size={12} aria-hidden="true" />
            {uploading ? 'Uploading…' : 'Add Photos'}
          </motion.button>
        </div>
      </div>

      {/* Compare hint + slider */}
      {compareMode && (
        <div style={{
          padding: 12, borderRadius: 10,
          background: 'var(--v3-primary-soft)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
          display: 'flex', flexDirection: 'column', gap: 8
        }}>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
            letterSpacing: 0, color: 'var(--v3-primary-text)'
          }}>
            {!compareBefore ? 'Tap the before photo' :
              !compareAfter ? 'Now tap the after photo' :
                'Drag the slider'}
          </div>
          {compareBefore && compareAfter && (
            <BeforeAfterSlider
              beforeUrl={compareBefore.url}
              afterUrl={compareAfter.url}
              beforeLabel={compareBefore.row.caption}
              afterLabel={compareAfter.row.caption}
            />
          )}
        </div>
      )}

      <input ref={inputRef} type="file" accept="image/*" multiple hidden onChange={handleFile} />

      {/* The skeleton stands in only until a read lands: a reread (after an
          upload, or Try again) keeps what is on screen. */}
      {loading && !loaded && <SkeletonList rows={2} card={false} />}
      {!loading && failed && (
        <DataErrorState
          compact
          title={loaded ? "Couldn't refresh the photos" : "Couldn't load the photos"}
          message="Check your connection and try again."
          actionLabel="Try again"
          onRetry={() => {
            keepFocusOnRetry(rootRef.current?.closest<HTMLElement>('[data-job-section], [role="tabpanel"]') ?? rootRef.current)
            void fetchRows()
          }}
        />
      )}
      {loaded && rows.length === 0 && (
        <div style={{
          padding: '32px 24px', borderRadius: 10,
          background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
          color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
          fontSize: 14, textAlign: 'center', lineHeight: 1.5,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12
        }}>
          <ImageIcon size={28} aria-hidden="true" color="var(--v3-text-muted)" />
          <div>Photos tell the story. Tap <strong>Add Photos</strong> above to start.</div>
        </div>
      )}

      {/* Photo grid */}
      {rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {rows.map((r, i) => {
            const url = thumbUrls[r.id]?.url
            const captioning = captioningIds.has(r.id)
            const compareLabel = compareBefore?.row.id === r.id
              ? 'Before'
              : compareAfter?.row.id === r.id ? 'After' : ''
            const selected = compareMode && !!compareLabel
            return (
              <motion.button
                key={r.id}
                type="button"
                whileTap={{ scale: 0.98 }}
                onClick={() => handleThumbTap(r)}
                style={{
                  aspectRatio: '1 / 1',
                  position: 'relative',
                  overflow: 'hidden',
                  borderRadius: 10,
                  border: selected
                    ? `2px solid var(--v3-primary)`
                    : '1px solid var(--v3-border)',
                  background: 'var(--v3-surface-2)',
                  cursor: 'pointer',
                  padding: 0,
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                {url ? (
                  <img
                    src={url}
                    alt={r.caption || r.filename}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                ) : (
                  <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--v3-text-muted)' }}>
                    <ImageIcon size={20} aria-hidden="true" />
                  </div>
                )}
                {selected && (
                  <div style={{
                    position: 'absolute', top: 4, left: 4,
                    padding: '4px 8px', borderRadius: 10,
                    background: 'var(--v3-primary)', color: 'var(--v3-on-primary)',
                    fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                    letterSpacing: 0
                  }}>
                    {compareLabel}
                  </div>
                )}
                {captioning && (
                  <div style={{
                    position: 'absolute', bottom: 4, left: 4,
                    padding: '4px 8px', borderRadius: 10,
                    background: 'rgba(20, 20, 20, 0.5)', color: 'var(--v3-primary)',
                    fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                    letterSpacing: 0,
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    backdropFilter: 'blur(4px)'
                  }}>
                    <Sparkles size={9} aria-hidden="true" />
                    AI…
                  </div>
                )}
                {/* Section tag badge, bottom-right when set. Lets the
                    operator scan the grid and see which photos still
                    need to be tagged to a scope section. */}
                {r.section_tag && !captioning && (
                  <Eyebrow as="div" style={{ position: 'absolute', bottom: 4, right: 4, padding: '4px 8px', borderRadius: 10, background: 'color-mix(in srgb, var(--v3-primary) 80%, transparent)', color: 'var(--v3-on-primary, #141414)', maxWidth: 'calc(100% - 12px)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {r.section_tag}
                  </Eyebrow>
                )}
              </motion.button>
            )
          })}
        </div>
      )}

      {/* Lightbox */}
      <AnimatePresence>
        {lightboxRow && (
          <PhotoLightbox
            row={lightboxRow}
            url={lightboxUrl}
            hasPrev={lightboxIdx > 0}
            hasNext={lightboxIdx < rows.length - 1}
            onPrev={() => goLightbox(-1)}
            onNext={() => goLightbox(1)}
            onClose={closeLightbox}
            onSaveCaption={(c: any) => saveCaption(lightboxRow.id, c)}
            onSaveSectionTag={(t: any) => saveSectionTag(lightboxRow.id, t)}
            onDelete={() => remove(lightboxRow)}
            deleteArmed={deleteTap.armedId === lightboxRow.id}
          />
        )}
      </AnimatePresence>

    </div>
  )
}

/* ============================================================
   PhotoLightbox, full-screen image with caption editor + nav
   ============================================================ */

function PhotoLightbox({ row, url, hasPrev, hasNext, onPrev, onNext, onClose, onSaveCaption, onSaveSectionTag, onDelete, deleteArmed = false }: any) {
  const dialogRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    return () => { document.body.style.overflow = overflow; previous?.focus({ preventScroll: true }) }
  }, [])
  const [caption, setCaption] = useState(row.caption || '')
  const [sectionTag, setSectionTag] = useState(row.section_tag || '')
  const [customTag, setCustomTag] = useState('')
  const [showCustom, setShowCustom] = useState(false)

  useEffect(() => {
    setCaption(row.caption || '')
    const tag = row.section_tag || ''
    setSectionTag(tag)
    setShowCustom(!!tag && !SCOPE_SECTIONS.includes(tag))
    setCustomTag(tag && !SCOPE_SECTIONS.includes(tag) ? tag : '')
  }, [row.id, row.caption, row.section_tag])

  function pickSection(value: any) {
    if (value === '__custom__') {
      setShowCustom(true)
      return
    }
    setShowCustom(false)
    setCustomTag('')
    setSectionTag(value)
    onSaveSectionTag?.(value)
  }

  function commitCustom() {
    const trimmed = customTag.trim()
    setSectionTag(trimmed)
    onSaveSectionTag?.(trimmed)
  }

  function clearTag() {
    setSectionTag('')
    setShowCustom(false)
    setCustomTag('')
    onSaveSectionTag?.('')
  }

  return createPortal(
    <>
      <motion.div
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(20, 20, 20,0.92)',
          backdropFilter: 'blur(8px)', zIndex: 90
        }}
      />
      <motion.div
        ref={dialogRef}
        className="fh-photo-lightbox fh-onyx-scope"
        role="dialog"
        aria-modal="true"
        aria-label="Photo viewer"
        onKeyDown={(event) => {
          if (event.key === 'Escape') { event.stopPropagation(); onClose(); return }
          if (event.key !== 'Tab') return
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), input, textarea, select, a[href]')).filter(el => el.getClientRects().length)
          const first = controls[0], last = controls[controls.length - 1]
          if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
          else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
        }}
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 91, overflowY: 'auto',
          display: 'flex', flexDirection: 'column',
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)'
        }}
      >
        {/* Top bar */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', gap: 8
        }}>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              width: 44, height: 44, borderRadius: 10,
              background: '#303030', border: '1px solid #626262',
              color: '#F5F5F5', cursor: 'pointer',
              display: 'grid', placeItems: 'center'
            }}
          >
            <X size={20} aria-hidden="true" />
          </button>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 12,
            color: '#C9C9C9',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {row.filename}
          </div>
          <button
            type="button"
            onClick={onDelete}
            aria-label={deleteArmed ? 'Tap again to delete' : 'Delete photo'}
            aria-pressed={deleteArmed ? true : undefined}
            style={{
              minWidth: 44, height: 44, borderRadius: 10, padding: deleteArmed ? '0 12px' : 0,
              background: deleteArmed ? 'rgba(192, 57, 43, 0.5)' : 'rgba(192, 57, 43, 0.18)', border: 'none',
              color: deleteArmed ? '#F5F5F5' : '#E3957F', cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700
            }}
          >
            <Trash2 size={18} aria-hidden="true" />
            {deleteArmed && <span>Tap again to delete</span>}
          </button>
        </div>

        {/* Image */}
        <div style={{
          flex: 1, minHeight: 160,
          display: 'grid', placeItems: 'center',
          padding: '0 8px', position: 'relative'
        }}>
          {url ? (
            <img loading="lazy"src={url}
              alt={row.caption || row.filename}
              style={{
                maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                display: 'block', borderRadius: 10
              }}
            />
          ) : (
            <div style={{ color: '#F5F5F5', fontFamily: 'var(--font-body)', fontSize: 14 }}>
              Loading…
            </div>
          )}
          {/* Nav arrows */}
          {hasPrev && (
            <button
              type="button"
              onClick={onPrev}
              aria-label="Previous photo"
              style={{
                position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)',
                width: 44, height: 44, borderRadius: 10,
                background: '#303030', border: '1px solid #626262',
                color: '#F5F5F5', cursor: 'pointer',
                display: 'grid', placeItems: 'center'
              }}
            >
              <ChevronLeft size={22} aria-hidden="true" />
            </button>
          )}
          {hasNext && (
            <button
              type="button"
              onClick={onNext}
              aria-label="Next photo"
              style={{
                position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                width: 44, height: 44, borderRadius: 10,
                background: '#303030', border: '1px solid #626262',
                color: '#F5F5F5', cursor: 'pointer',
                display: 'grid', placeItems: 'center'
              }}
            >
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Section tag picker, chooses which scope card the photo
            attaches to on the proposal. Auto-saves on pick. */}
        <div style={{ padding: '0 16px 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
            <Eyebrow tone="gold">
              Scope section
            </Eyebrow>
            {sectionTag && (
              <button
                type="button"
                onClick={clearTag}
                style={{
                  background: 'transparent', border: 'none',
                  color: '#C9C9C9',
                  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
                  cursor: 'pointer', padding: '8px 0', minHeight: 44
                }}
              >
                Clear
              </button>
            )}
          </div>
          <select
            aria-label="Scope section"
            value={showCustom ? '__custom__' : sectionTag}
            onChange={(event) => pickSection(event.target.value)}
            className="fh-photo-lightbox__scope"
          >
            <option value="">No section</option>
            {SCOPE_SECTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
            <option value="__custom__">Other…</option>
          </select>
          {showCustom && (
            <input
              type="text"
              aria-label="Custom scope section"
              value={customTag}
              onChange={(e) => setCustomTag(e.target.value)}
              onBlur={commitCustom}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.currentTarget.blur() } }}
              placeholder="Type a section name (e.g. Stairs)"
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 10,
                background: 'var(--v3-border-mid)', border: '1px solid var(--v3-border-mid)',
                color: '#F5F5F5', fontFamily: 'var(--font-body)',
                fontSize: 14, outline: 'none'
              }}
            />
          )}
        </div>

        {/* Caption editor */}
        <div style={{ padding: '4px 16px 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Eyebrow tone="gold">
            Caption
          </Eyebrow>
          <textarea
            aria-label="Photo caption"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => onSaveCaption(caption)}
            rows={2}
            placeholder="What's in this photo?"
            style={{
              width: '100%', padding: '12px 12px', borderRadius: 10,
              background: 'var(--v3-border-mid)', border: '1px solid var(--v3-border-mid)',
              color: '#F5F5F5', fontFamily: 'var(--font-body)',
              fontSize: 14, outline: 'none', resize: 'vertical', minHeight: 50
            }}
          />
        </div>
      </motion.div>
    </>,
    document.body
  )
}

/* ============================================================
   BeforeAfterSlider, drag a vertical divider to wipe between two photos
   ============================================================ */

function BeforeAfterSlider({ beforeUrl, afterUrl, beforeLabel, afterLabel }: any) {
  const containerRef = useRef<any>(null)
  const [pct, setPct] = useState(50)

  function onMove(clientX: any) {
    const el = containerRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left))
    setPct(Math.round((x / rect.width) * 100))
  }

  return (
    <div
      ref={containerRef}
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onMove(e.clientX) }}
      onPointerMove={(e) => { if (e.buttons === 1 || e.pointerType === 'touch') onMove(e.clientX) }}
      style={{
        position: 'relative',
        aspectRatio: '4 / 3',
        borderRadius: 10,
        overflow: 'hidden',
        background: '#141414',
        userSelect: 'none',
        touchAction: 'none',
        cursor: 'ew-resize'
      }}
    >
      {/* AFTER, full width underneath */}
      <img loading="lazy"src={afterUrl}
        alt={afterLabel || 'After'}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
      {/* BEFORE, clipped to pct */}
      <div style={{
        position: 'absolute', inset: 0,
        clipPath: `polygon(0 0, ${pct}% 0, ${pct}% 100%, 0 100%)`
      }}>
        <img loading="lazy"src={beforeUrl}
          alt={beforeLabel || 'Before'}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
      {/* Divider */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: `${pct}%`,
        width: 2, background: 'var(--v3-primary)',
        boxShadow: '0 0 12px rgba(201, 150, 58, 0.7)',
        transform: 'translateX(-1px)'
      }} />
      <div style={{
        position: 'absolute', top: '50%', left: `${pct}%`,
        transform: 'translate(-50%, -50%)',
        width: 32, height: 32, borderRadius: 10,
        background: 'var(--v3-primary)',
        display: 'grid', placeItems: 'center',
        color: 'var(--v3-on-primary)', boxShadow: '0 4px 12px rgba(20, 20, 20,0.4)',
        pointerEvents: 'none'
      }}>
        <GitCompareArrows size={14} aria-hidden="true" />
      </div>
      {/* Labels */}
      <div style={{
        position: 'absolute', top: 8, left: 8,
        padding: '4px 8px', borderRadius: 10,
        background: 'rgba(20, 20, 20, 0.6)', backdropFilter: 'blur(4px)',
        fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
        letterSpacing: 0, color: '#F5F5F5'
      }}>
        Before
      </div>
      <div style={{
        position: 'absolute', top: 8, right: 8,
        padding: '4px 8px', borderRadius: 10,
        background: 'rgba(20, 20, 20, 0.6)', backdropFilter: 'blur(4px)',
        fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
        letterSpacing: 0, color: '#F5F5F5'
      }}>
        After
      </div>
    </div>
  )
}
