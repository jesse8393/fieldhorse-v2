import { useCallback, useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Upload, FileText, Download, Trash2, Paperclip } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { toastError, toastSuccess } from '../../../lib/toast.js'
import { hapticTap } from '../../../lib/haptics.js'
import { SkeletonList } from '../../../components/Skeleton.jsx'
import ActionSheet from '../../../components/ActionSheet.jsx'

const BUCKET = 'job-files'
const MAX_BYTES = 25 * 1024 * 1024 // 25 MB per file

function fmtSize(n) {
  if (!n) return ''
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

/**
 * Files section — fh_job_files where kind='file'. Same upload flow as Photos
 * but list rendering instead of grid + opens via signed URL in new tab.
 */
export default function FilesSection({ jobId, userId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  // Destructive-confirm sheet state for delete file.
  const [pendingDelete, setPendingDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)
  const inputRef = useRef(null)

  const fetchRows = useCallback(async () => {
    if (!jobId || !userId) return
    setLoading(true)
    const { data } = await supabase
      .from('fh_job_files')
      .select('*')
      .eq('job_id', jobId)
      .eq('user_id', userId)
      .eq('kind', 'file')
      .order('uploaded_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }, [jobId, userId])

  useEffect(() => { fetchRows() }, [fetchRows])

  function pick() { inputRef.current?.click() }

  async function handleFile(e) {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return
    setUploading(true)
    try {
      for (const file of files) {
        if (file.size > MAX_BYTES) {
          toastError('File too large', `${file.name} exceeds 25 MB`)
          continue
        }
        const ext = (file.name.split('.').pop() || 'bin').toLowerCase()
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
      }
      toastSuccess('Files uploaded', `Added ${files.length}`)
      await fetchRows()
    } catch (ex) {
      toastError('Upload failed', ex?.message || 'Try again')
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  async function open(row) {
    hapticTap()
    const { data, error } = await supabase.storage
      .from(BUCKET)
      .createSignedUrl(row.storage_path, 3600)
    if (error || !data?.signedUrl) {
      toastError('Could not open', error?.message || 'Try again')
      return
    }
    window.open(data.signedUrl, '_blank', 'noopener')
  }

  // Open the destructive-confirm sheet for this file. Storage + db
  // delete happens in confirmRemove on commit.
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 20px 24px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--v3-text-muted)'
        }}>
          {rows.length} {rows.length === 1 ? 'file' : 'files'}
        </span>
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
          {uploading ? 'Uploading…' : 'Add Files'}
        </motion.button>
      </div>

      <input ref={inputRef} type="file" multiple hidden onChange={handleFile} />

      {loading && <SkeletonList rows={2} card={false} />}
      {!loading && rows.length === 0 && (
        <div style={{
          padding: '32px 20px', borderRadius: 14,
          background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
          color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
          fontSize: 13, textAlign: 'center', lineHeight: 1.5,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10
        }}>
          <Paperclip size={28} aria-hidden="true" color="var(--v3-text-muted)" />
          <div>No files yet. Permits, contracts, plans — upload anything that supports the job.</div>
        </div>
      )}

      {!loading && rows.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map((r) => (
            <li key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 12,
              padding: '12px 14px', borderRadius: 12,
              background: 'var(--v3-surface)', border: '1px solid var(--v3-border)'
            }}>
              <span aria-hidden="true" style={{
                flexShrink: 0, width: 36, height: 36, borderRadius: 10,
                background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)',
                color: 'var(--v3-primary)',
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
                  fontFamily: 'var(--font-body)', fontSize: 11,
                  color: 'var(--v3-text-muted)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  {fmtSize(r.size_bytes)} · {new Date(r.uploaded_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </div>
              </button>
              <button
                type="button"
                onClick={() => open(r)}
                aria-label="Download"
                style={{
                  width: 32, height: 32, borderRadius: 9,
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
                aria-label="Delete file"
                style={{
                  width: 32, height: 32, borderRadius: 9,
                  background: 'transparent', border: 'none',
                  color: 'var(--v3-text-muted)', cursor: 'pointer',
                  display: 'grid', placeItems: 'center'
                }}
              >
                <Trash2 size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Destructive-confirm sheet for delete file. Storage + db delete
          + refresh happen in confirmRemove on commit. */}
      <ActionSheet
        open={!!pendingDelete}
        title="Delete this file?"
        accentWord="Delete"
        sectionLabel="Destructive"
        stepCount={1}
        currentStep={1}
        commitLabel={deleting ? 'Deleting…' : 'Delete file'}
        commitBusy={deleting}
        commitDisabled={deleting}
        destructive
        onClose={() => { if (!deleting) setPendingDelete(null) }}
        onCommit={confirmRemove}
      >
        <p style={{ margin: 0, color: 'var(--v3-text)', fontSize: '1rem', lineHeight: 1.45 }}>
          Removing <strong>{pendingDelete?.filename || 'this file'}</strong> from storage and the job record. This can't be undone.
        </p>
      </ActionSheet>
    </div>
  )
}
