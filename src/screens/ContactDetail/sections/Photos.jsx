import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Upload, GitCompareArrows, ChevronLeft, ChevronRight,
  X, Trash2, Sparkles, Image as ImageIcon
} from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { compressImageToDataUrl, captionPhoto } from '../../../lib/docIntelligence.js'
import { toastError, toastSuccess } from '../../../lib/toast.js'
import { hapticTap, hapticSuccess } from '../../../lib/haptics.js'
import { SkeletonList } from '../../../components/Skeleton.jsx'
import ActionSheet from '../../../components/ActionSheet.jsx'

const BUCKET = 'job-photos'
const MAX_BYTES = 10 * 1024 * 1024 // 10 MB per photo

/**
 * Photos section — fh_job_files where kind='photo'.
 *
 * Features (preserved from legacy UploadList):
 *   - Multi-upload from <input type="file" multiple accept="image/*">
 *   - Direct upload to private 'job-photos' Supabase Storage bucket
 *     (path: <userId>/<jobId>/<rowId>.<ext>); insert into fh_job_files.
 *   - Fire-and-forget Claude Vision auto-captioning post-upload
 *     (captionAndPersist). Caption column may be missing (migration 009
 *     not applied) — UPDATE silently no-ops in that case.
 *   - 3-col responsive grid with signed URL thumbnails (1h TTL).
 *   - Lightbox with swipe-between + caption editor.
 *   - Compare mode: select 2 photos, drag the before/after slider.
 */
export default function PhotosSection({ jobId, userId }) {
  const [rows, setRows] = useState([])
  const [thumbUrls, setThumbUrls] = useState({}) // { [rowId]: signedUrl }
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [captioningIds, setCaptioningIds] = useState(() => new Set())
  // Destructive-confirm sheet state for delete photo.
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const [lightboxIdx, setLightboxIdx] = useState(-1)
  const [lightboxUrl, setLightboxUrl] = useState('')

  const [compareMode, setCompareMode] = useState(false)
  const [compareBefore, setCompareBefore] = useState(null)
  const [compareAfter, setCompareAfter] = useState(null)

  const inputRef = useRef(null)

  const fetchRows = useCallback(async () => {
    if (!jobId || !userId) return
    setLoading(true)
    const { data } = await supabase
      .from('fh_job_files')
      .select('*')
      .eq('job_id', jobId)
      .eq('user_id', userId)
      .eq('kind', 'photo')
      .order('uploaded_at', { ascending: false })
    const list = data || []
    setRows(list)
    setLoading(false)

    // Batch sign URLs for the grid thumbnails.
    if (list.length > 0) {
      const paths = list.map((r) => r.storage_path)
      const { data: signed } = await supabase.storage
        .from(BUCKET)
        .createSignedUrls(paths, 3600)
      const next = {}
      const byPath = new Map()
      for (const s of signed || []) {
        if (s?.signedUrl && !s.error) byPath.set(s.path, s.signedUrl)
      }
      for (const r of list) {
        const url = byPath.get(r.storage_path)
        if (url) next[r.id] = url
      }
      setThumbUrls(next)
    } else {
      setThumbUrls({})
    }
  }, [jobId, userId])

  useEffect(() => { fetchRows() }, [fetchRows])

  function pick() { inputRef.current?.click() }

  async function handleFile(e) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploading(true)
    const newPhotoIds = []
    try {
      for (const file of files) {
        if (file.size > MAX_BYTES) {
          toastError('Photo too large', `${file.name} exceeds 10 MB`)
          continue
        }
        const ext = (file.name.split('.').pop() || 'jpg').toLowerCase()
        const rowId = crypto.randomUUID()
        const path = `${userId}/${jobId}/${rowId}.${ext}`
        const { error: upErr } = await supabase.storage
          .from(BUCKET)
          .upload(path, file, { upsert: false, contentType: file.type })
        if (upErr) throw upErr
        const { error: insErr } = await supabase.from('fh_job_files').insert({
          id: rowId,
          user_id: userId,
          job_id: jobId,
          filename: file.name,
          storage_path: path,
          mime_type: file.type || null,
          size_bytes: file.size,
          kind: 'photo'
        })
        if (insErr) throw insErr
        newPhotoIds.push({ id: rowId, file })
      }
      hapticSuccess()
      toastSuccess('Photos uploaded', `Added ${files.length}`)
      await fetchRows()
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
    } catch (ex) {
      toastError('Upload failed', ex?.message || 'Try again')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function captionAndPersist(rowId, file) {
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
      // Vision call failed (network/quota) — keep photo, drop caption.
    } finally {
      setCaptioningIds((prev) => {
        if (!prev.has(rowId)) return prev
        const next = new Set(prev)
        next.delete(rowId)
        return next
      })
    }
  }

  async function saveCaption(rowId, nextCaption) {
    const trimmed = (nextCaption || '').trim()
    setRows((prev) => prev.map((r) => r.id === rowId ? { ...r, caption: trimmed || null } : r))
    const { error } = await supabase
      .from('fh_job_files')
      .update({ caption: trimmed || null })
      .eq('id', rowId)
      .eq('user_id', userId)
    if (error) toastError("Couldn't save caption", error.message)
  }

  // Open the destructive-confirm sheet for this photo. The actual
  // storage + db delete happens in confirmRemove on commit.
  function remove(row) {
    if (!row) return
    setPendingDelete(row)
  }

  async function confirmRemove() {
    const row = pendingDelete
    if (!row || deleting) return
    setDeleting(true)
    try {
      await supabase.storage.from(BUCKET).remove([row.storage_path])
      await supabase.from('fh_job_files').delete().eq('id', row.id).eq('user_id', userId)
      toastSuccess('Deleted', row.filename)
      await fetchRows()
    } catch (ex) {
      toastError('Delete failed', ex?.message || 'Try again')
    } finally {
      setDeleting(false)
      setPendingDelete(null)
    }
  }

  async function urlFor(row) {
    if (thumbUrls[row.id]) return thumbUrls[row.id]
    const { data } = await supabase.storage.from(BUCKET).createSignedUrl(row.storage_path, 3600)
    return data?.signedUrl || ''
  }

  async function openLightbox(idx) {
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

  async function goLightbox(delta) {
    const next = lightboxIdx + delta
    if (next < 0 || next >= rows.length) return
    setLightboxUrl('')
    setLightboxIdx(next)
    const url = await urlFor(rows[next])
    setLightboxUrl(url)
  }

  async function handleThumbTap(row) {
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 20px 24px' }}>

      {/* Header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--v3-text-muted)'
        }}>
          {rows.length} {rows.length === 1 ? 'photo' : 'photos'}
        </span>
        <div style={{ display: 'inline-flex', gap: 6 }}>
          {rows.length >= 2 && (
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => { hapticTap(); compareMode ? exitCompare() : setCompareMode(true) }}
              style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '8px 12px', borderRadius: 10,
                border: compareMode
                  ? '1px solid color-mix(in srgb, var(--v3-primary) 50%, transparent)'
                  : '1px solid var(--v3-border)',
                background: compareMode ? 'var(--v3-primary-soft)' : 'transparent',
                color: compareMode ? 'var(--v3-primary)' : 'var(--v3-text)',
                fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
                letterSpacing: '0.06em', cursor: 'pointer'
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
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 10, border: 'none',
              background: 'var(--v3-primary)', color: 'var(--v3-on-primary)',
              fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.06em',
              cursor: uploading ? 'wait' : 'pointer',
              boxShadow: '0 6px 18px rgba(212, 175, 55, 0.28)',
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
          padding: 12, borderRadius: 12,
          background: 'var(--v3-primary-soft)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
          display: 'flex', flexDirection: 'column', gap: 8
        }}>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
            letterSpacing: '0.06em', color: 'var(--v3-primary)'
          }}>
            {!compareBefore ? 'Tap the BEFORE photo' :
              !compareAfter ? 'Now tap the AFTER photo' :
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

      {loading && <SkeletonList rows={2} card={false} />}
      {!loading && rows.length === 0 && (
        <div style={{
          padding: '32px 20px', borderRadius: 14,
          background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
          color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
          fontSize: 13, textAlign: 'center', lineHeight: 1.5,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10
        }}>
          <ImageIcon size={28} aria-hidden="true" color="var(--v3-text-muted)" />
          <div>Photos tell the story. Tap <strong>Add Photos</strong> above to start.</div>
        </div>
      )}

      {/* Photo grid */}
      {!loading && rows.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {rows.map((r, i) => {
            const url = thumbUrls[r.id]
            const captioning = captioningIds.has(r.id)
            const compareLabel = compareBefore?.row.id === r.id
              ? 'BEFORE'
              : compareAfter?.row.id === r.id ? 'AFTER' : ''
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
                  borderRadius: 12,
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
                    padding: '3px 7px', borderRadius: 6,
                    background: 'var(--v3-primary)', color: 'var(--v3-on-primary)',
                    fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
                    letterSpacing: '0.1em'
                  }}>
                    {compareLabel}
                  </div>
                )}
                {captioning && (
                  <div style={{
                    position: 'absolute', bottom: 4, left: 4,
                    padding: '3px 7px', borderRadius: 6,
                    background: 'rgba(0, 0, 0, 0.5)', color: 'var(--v3-primary)',
                    fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
                    letterSpacing: '0.1em',
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    backdropFilter: 'blur(4px)'
                  }}>
                    <Sparkles size={9} aria-hidden="true" />
                    AI…
                  </div>
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
            onSaveCaption={(c) => saveCaption(lightboxRow.id, c)}
            onDelete={() => { closeLightbox(); remove(lightboxRow) }}
          />
        )}
      </AnimatePresence>

      {/* Destructive-confirm sheet for delete photo. Storage + db
          delete + refresh happen in confirmRemove on commit. */}
      <ActionSheet
        open={!!pendingDelete}
        title="Delete this photo?"
        accentWord="Delete"
        sectionLabel="Destructive"
        stepCount={1}
        currentStep={1}
        commitLabel={deleting ? 'Deleting…' : 'Delete photo'}
        commitBusy={deleting}
        commitDisabled={deleting}
        destructive
        onClose={() => { if (!deleting) setPendingDelete(null) }}
        onCommit={confirmRemove}
      >
        <p style={{ margin: 0, color: 'var(--v3-text)', fontSize: '1rem', lineHeight: 1.45 }}>
          Removing <strong>{pendingDelete?.filename || 'this photo'}</strong> from storage and the job record. This can't be undone.
        </p>
      </ActionSheet>
    </div>
  )
}

/* ============================================================
   PhotoLightbox — full-screen image with caption editor + nav
   ============================================================ */

function PhotoLightbox({ row, url, hasPrev, hasNext, onPrev, onNext, onClose, onSaveCaption, onDelete }) {
  const [caption, setCaption] = useState(row.caption || '')

  useEffect(() => { setCaption(row.caption || '') }, [row.id, row.caption])

  return (
    <>
      <motion.div
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.92)',
          backdropFilter: 'blur(8px)', zIndex: 90
        }}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.96 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.96 }}
        style={{
          position: 'fixed', inset: 0, zIndex: 91,
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
              width: 40, height: 40, borderRadius: 12,
              background: 'rgba(255, 255, 255, 0.08)', border: 'none',
              color: '#fff', cursor: 'pointer',
              display: 'grid', placeItems: 'center'
            }}
          >
            <X size={20} aria-hidden="true" />
          </button>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 12,
            color: 'rgba(255, 255, 255, 0.7)',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {row.filename}
          </div>
          <button
            type="button"
            onClick={onDelete}
            aria-label="Delete photo"
            style={{
              width: 40, height: 40, borderRadius: 12,
              background: 'rgba(192, 57, 43, 0.18)', border: 'none',
              color: '#F47366', cursor: 'pointer',
              display: 'grid', placeItems: 'center'
            }}
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>

        {/* Image */}
        <div style={{
          flex: 1, minHeight: 0,
          display: 'grid', placeItems: 'center',
          padding: '0 8px', position: 'relative'
        }}>
          {url ? (
            <img
              src={url}
              alt={row.caption || row.filename}
              style={{
                maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                display: 'block', borderRadius: 8
              }}
            />
          ) : (
            <div style={{ color: '#fff', fontFamily: 'var(--font-body)', fontSize: 13 }}>
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
                width: 44, height: 44, borderRadius: 999,
                background: 'rgba(255, 255, 255, 0.12)', border: 'none',
                color: '#fff', cursor: 'pointer',
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
                width: 44, height: 44, borderRadius: 999,
                background: 'rgba(255, 255, 255, 0.12)', border: 'none',
                color: '#fff', cursor: 'pointer',
                display: 'grid', placeItems: 'center'
              }}
            >
              <ChevronRight size={22} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Caption editor */}
        <div style={{ padding: '12px 16px 20px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.16em', textTransform: 'uppercase',
            color: 'var(--v3-primary)'
          }}>
            Caption
          </span>
          <textarea
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            onBlur={() => onSaveCaption(caption)}
            rows={2}
            placeholder="What's in this photo?"
            style={{
              width: '100%', padding: '10px 12px', borderRadius: 10,
              background: 'rgba(255, 255, 255, 0.08)', border: '1px solid rgba(255, 255, 255, 0.12)',
              color: '#fff', fontFamily: 'var(--font-body)',
              fontSize: 13, outline: 'none', resize: 'vertical', minHeight: 50
            }}
          />
        </div>
      </motion.div>
    </>
  )
}

/* ============================================================
   BeforeAfterSlider — drag a vertical divider to wipe between two photos
   ============================================================ */

function BeforeAfterSlider({ beforeUrl, afterUrl, beforeLabel, afterLabel }) {
  const containerRef = useRef(null)
  const [pct, setPct] = useState(50)

  function onMove(clientX) {
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
        background: '#000',
        userSelect: 'none',
        touchAction: 'none',
        cursor: 'ew-resize'
      }}
    >
      {/* AFTER — full width underneath */}
      <img
        src={afterUrl}
        alt={afterLabel || 'After'}
        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
      />
      {/* BEFORE — clipped to pct */}
      <div style={{
        position: 'absolute', inset: 0,
        clipPath: `polygon(0 0, ${pct}% 0, ${pct}% 100%, 0 100%)`
      }}>
        <img
          src={beforeUrl}
          alt={beforeLabel || 'Before'}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      </div>
      {/* Divider */}
      <div style={{
        position: 'absolute', top: 0, bottom: 0, left: `${pct}%`,
        width: 2, background: 'var(--v3-primary)',
        boxShadow: '0 0 12px rgba(212, 175, 55, 0.7)',
        transform: 'translateX(-1px)'
      }} />
      <div style={{
        position: 'absolute', top: '50%', left: `${pct}%`,
        transform: 'translate(-50%, -50%)',
        width: 32, height: 32, borderRadius: 999,
        background: 'var(--v3-primary)',
        display: 'grid', placeItems: 'center',
        color: 'var(--v3-on-primary)', boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
        pointerEvents: 'none'
      }}>
        <GitCompareArrows size={14} aria-hidden="true" />
      </div>
      {/* Labels */}
      <div style={{
        position: 'absolute', top: 8, left: 8,
        padding: '3px 8px', borderRadius: 6,
        background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)',
        fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
        letterSpacing: '0.12em', color: '#fff'
      }}>
        BEFORE
      </div>
      <div style={{
        position: 'absolute', top: 8, right: 8,
        padding: '3px 8px', borderRadius: 6,
        background: 'rgba(0, 0, 0, 0.6)', backdropFilter: 'blur(4px)',
        fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
        letterSpacing: '0.12em', color: '#fff'
      }}>
        AFTER
      </div>
    </div>
  )
}
