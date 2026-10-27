import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileText, Download, Trash2, Paperclip } from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { toastError, toastSuccess } from '../../../lib/toast.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { SkeletonList } from '../../../components/Skeleton.tsx'
import DataErrorState from '../../../components/DataErrorState.tsx'
import LoadingValue from '../../../components/LoadingValue.tsx'
import { countNoun } from '../../../lib/format.ts'
import { keepFocusOnRetry } from '../../../lib/retryFocus.ts'
import { useArmedId } from '../../../lib/secondTap.ts'
import { Eyebrow } from '../../../components/v3'
import { extensionOf, isBlockedUpload, opensInline } from '../lib/fileTypes.ts'

const BUCKET = 'job-files'
const MAX_BYTES = 25 * 1024 * 1024 // 25 MB per file

function fmtSize(n: any) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Files section, fh_job_files where kind='file'. Same upload flow as Photos
 * but list rendering instead of grid + opens via signed URL in new tab.
 */
export default function FilesSection({ jobId, userId }: any) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  // A read of this job's files has landed, so the count and the empty card
  // can show; until then neither does.
  const [loaded, setLoaded] = useState(false)
  // The latest read failed. Files an earlier read brought stay on screen.
  const [failed, setFailed] = useState(false)
  const [uploading, setUploading] = useState(false)
  // Destructive-confirm sheet state for delete file.
  // Delete asks with a second tap on the same button (D57).
  const deleteTap = useArmedId()
  const [deleting, setDeleting] = useState(false)
  const inputRef = useRef<any>(null)
  // The section; Try again leaves focus on the sub tab's panel around it.
  const rootRef = useRef<HTMLDivElement>(null)
  // Each read takes the next number and sets state only while it is the
  // latest: an upload's reread that fails late never marks the files a
  // delete just read again as failed.
  const readSeq = useRef(0)
  useEffect(() => () => { readSeq.current += 1 }, [])

  const fetchRows = useCallback(async () => {
    if (!jobId || !userId) return
    const seq = ++readSeq.current
    setLoading(true)
    // Every file on the job, whoever added it: org RLS scopes the read
    // to teammates and accepted partners.
    const { data, error } = await supabase
      .from('fh_job_files')
      .select('*')
      .eq('job_id', jobId)
      .eq('kind', 'file')
      .order('uploaded_at', { ascending: false })
    // A newer read has gone out since: it decides.
    if (seq !== readSeq.current) return
    // A failed read is never "0 files" or the empty card: it says so, with
    // Try again, and keeps what an earlier read brought.
    if (error) {
      setFailed(true)
      setLoading(false)
      return
    }
    setRows(data || [])
    setLoaded(true)
    setFailed(false)
    setLoading(false)
  }, [jobId, userId])

  // Another job's files never stand in for this one's, nor does a read of
  // them still out.
  useEffect(() => {
    readSeq.current += 1
    setRows([])
    setLoaded(false)
    setFailed(false)
  }, [jobId])

  useEffect(() => { fetchRows() }, [fetchRows])

  function pick() { inputRef.current?.click() }

  async function handleFile(e: any) {
    const files: any[] = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploading(true)
    let added = 0
    try {
      for (const file of files) {
        if (file.size > MAX_BYTES) {
          toastError('File too large', `${file.name} exceeds 25 MB`)
          continue
        }
        if (isBlockedUpload(file)) {
          toastError("Can't add that file", `${file.name}: web pages, SVG and XML files can't be stored on a job. Save it as a PDF or zip it first.`)
          continue
        }
        const ext = extensionOf(file.name) || 'bin'
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
          kind: 'file'
        })
        if (insErr) throw insErr
        added += 1
      }
      if (added > 0) toastSuccess(`${countNoun(added, 'File')} uploaded`, `Added ${added}`)
      await fetchRows()
    } catch (ex: any) {
      toastError('Upload failed', ex?.message || 'Try again')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  // Only PDFs and plain images open in a tab. Anything else, and the
  // Download button, downloads under the file's own name, so a web page
  // or SVG that reached storage never renders on the storage domain.
  async function open(row: any, forceDownload = false) {
    hapticTap()
    const download = forceDownload || !opensInline(row)
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.storage_path, 3600, download ? { download: row.filename || true } : undefined)
    if (error || !data?.signedUrl) {
      toastError('Could not open', error?.message || 'Try again')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  // The first tap arms the row's delete button, the second removes the
  // file from storage and the job record (confirmRemove).
  function remove(row: any) {
    if (!row || deleting) return
    deleteTap.tap(row.id, () => { void confirmRemove(row) })
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
      // By id: any teammate can remove a job file, RLS scopes the tenant.
      const { data: gone, error: delErr } = await supabase
        .from('fh_job_files')
        .delete()
        .eq('id', row.id)
        .select('id')
      if (delErr) throw delErr
      if (!gone?.length) toastError('Delete failed', 'This file may already be gone.')
      else toastSuccess('Deleted', row.filename)
      await fetchRows()
    } catch (ex: any) {
      toastError('Delete failed', ex?.message || 'Try again')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div ref={rootRef} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 24px 24px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        {loaded ? (
          <Eyebrow>
            {rows.length} {rows.length === 1 ? 'file' : 'files'}
          </Eyebrow>
        ) : loading ? (
          <LoadingValue label="Loading files" width={64} height={12} />
        ) : <span aria-hidden="true" />}
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
          {uploading ? 'Uploading…' : 'Add Files'}
        </motion.button>
      </div>

      <input ref={inputRef} type="file" multiple hidden onChange={handleFile} />

      {/* The skeleton stands in only until a read lands: a reread (after an
          upload, or Try again) keeps what is on screen. */}
      {loading && !loaded && <SkeletonList rows={2} card={false} />}
      {!loading && failed && (
        <DataErrorState
          compact
          title={loaded ? "Couldn't refresh the files" : "Couldn't load the files"}
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
          <Paperclip size={28} aria-hidden="true" color="var(--v3-text-muted)" />
          <div>No files yet. Permits, contracts, plans, upload anything that supports the job.</div>
        </div>
      )}

      {rows.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {rows.map((r) => (
            <li key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 12px', borderRadius: 10,
              background: 'var(--v3-surface)', border: '1px solid var(--v3-border)'
            }}>
              <span aria-hidden="true" style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: 10,
                background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)',
                color: 'var(--v3-primary-text)',
                display: 'grid', placeItems: 'center'
              }}>
                <FileText size={15} />
              </span>
              <button
                type="button"
                onClick={() => open(r)}
                style={{
                  flex: 1, minWidth: 0, textAlign: 'left',
                  background: 'transparent', border: 'none', cursor: 'pointer',
                  padding: 0, color: 'var(--v3-text)'
                }}
              >
                <div style={{
                  fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}>
                  {r.filename}
                </div>
                <div style={{
                  marginTop: 2,
                  fontFamily: 'var(--font-body)', fontSize: 12,
                  color: 'var(--v3-text-muted)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  {fmtSize(r.size_bytes)} · {new Date(r.uploaded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </button>
              <button
                type="button"
                onClick={() => open(r, true)}
                aria-label="Download"
                style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: 'transparent', border: '1px solid var(--v3-border)',
                  color: 'var(--v3-text-muted)', cursor: 'pointer',
                  display: 'grid', placeItems: 'center'
                }}
              >
                <Download size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => remove(r)}
                aria-label={deleteTap.armedId === r.id ? 'Tap again to delete' : 'Delete file'}
                aria-pressed={deleteTap.armedId === r.id ? true : undefined}
                disabled={deleting}
                style={{
                  width: 32, height: 32, borderRadius: 10,
                  background: deleteTap.armedId === r.id ? 'var(--v3-danger-soft)' : 'transparent',
                  border: deleteTap.armedId === r.id ? '1px solid var(--v3-danger-bright)' : 'none',
                  color: deleteTap.armedId === r.id ? 'var(--v3-danger-text)' : 'var(--v3-text-muted)', cursor: 'pointer',
                  display: 'grid', placeItems: 'center'
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

    </div>
  )
}
