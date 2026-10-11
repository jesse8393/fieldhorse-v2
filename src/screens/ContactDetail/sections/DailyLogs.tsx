// DailyLogs section, backed by fh_daily_logs.
//
// Per-job feed of foreman end-of-day posts: summary, what's next,
// weather window, crew count, hours worked. Anyone in the org can
// READ; the author can EDIT / DELETE their own. New log goes at the
// top with optional next_steps + weather + crew_count + hours.
//
// Lives inside the Job Detail tab strip alongside Overview / Quote /
// Details / Financials / Files.

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useQueryClient } from '@tanstack/react-query'
import { CloudSun, Trash2, Users, Clock, Sparkles, ImagePlus, X, Pencil } from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { signedUrlsFor } from '../../../lib/signedUrls.ts'
import { toastSuccess, toastError } from '../../../lib/toast.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { SkeletonList } from '../../../components/Skeleton.tsx'
import { useConfirm } from '../../../components/ConfirmSheet.tsx'
import { compressImageToBlob } from '../../../lib/docIntelligence.ts'
import { todayYmd } from '../../../lib/dates.ts'
import { Eyebrow } from '../../../components/v3'

const SkeletonAny = SkeletonList as any
const PHOTO_BUCKET = 'job-photos'
const MAX_BYTES = 10 * 1024 * 1024

// Storage paths a saved log's photo list points at.
function photoPaths(photos: any): string[] {
  return (Array.isArray(photos) ? photos : [])
    .map((p: any) => p?.storage_path)
    .filter((p: any): p is string => typeof p === 'string' && p.length > 0)
}

// Delete photo objects nothing points at any more. Best effort: a failed
// cleanup leaves a stray object, never a broken log, so it only warns.
function removeStoredPhotos(paths: string[]) {
  if (paths.length === 0) return
  supabase.storage.from(PHOTO_BUCKET).remove(paths)
    .then(({ error }) => { if (error) console.warn('[daily logs] photo cleanup failed', error.message) })
    .catch(() => {})
}

type LogRow = {
  id: string
  user_id: string
  contact_id: string
  log_date: string
  summary: string
  next_steps: string | null
  weather_text: string | null
  crew_count: number | null
  hours_worked: number | null
  photos: any
  created_at: string
}

function fmtDay(iso: string): string {
  try {
    const d = new Date(iso + 'T12:00:00')
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  } catch { return iso }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch { return '' }
}

type DraftPhoto = { local_id: string; preview_url: string; storage_path: string; size: number; uploading: boolean; existing?: boolean }

export default function DailyLogsSection({ jobId, userId }: any) {
  const confirm = useConfirm()
  const queryClient = useQueryClient()
  const [rows, setRows] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
  // Non-null when the compose form is editing an existing log rather
  // than posting a new one. save() branches on this.
  const [editingId, setEditingId] = useState<string | null>(null)
  // Map of storage_path → signed URL for photos referenced on rendered
  // log cards. Filled lazily as rows arrive.
  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})

  // Draft state (inline form, expanded on demand)
  const [summary, setSummary] = useState('')
  const [nextSteps, setNextSteps] = useState('')
  const [weatherText, setWeatherText] = useState('')
  const [crewCount, setCrewCount] = useState('')
  const [hoursWorked, setHoursWorked] = useState('')
  const [draftPhotos, setDraftPhotos] = useState<DraftPhoto[]>([])
  const [saving, setSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  // Bumped every time the draft is cleared (cancel, post, save, or a new
  // edit), so a photo that finishes uploading afterwards knows nothing
  // will point at it.
  const draftGenRef = useRef(0)

  const load = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('fh_daily_logs')
      .select('id, user_id, contact_id, log_date, summary, next_steps, weather_text, crew_count, hours_worked, photos, created_at')
      .eq('contact_id', jobId)
      .order('log_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      toastError("Couldn't load daily logs", error.message)
      setRows([])
    } else {
      const list = (data || []) as LogRow[]
      setRows(list)
      // Batch-sign every photo path referenced by these rows. One
      // round-trip regardless of how many logs returned, and URLs signed
      // in the last 50 minutes are reused, so reloading the feed after a
      // post lets the browser cache serve photos it already has.
      const paths = list.flatMap((r) => photoPaths(r.photos))
      if (paths.length > 0) {
        const byPath = await signedUrlsFor(queryClient, PHOTO_BUCKET, paths)
        setPhotoUrls(Object.fromEntries(byPath))
      } else {
        setPhotoUrls({})
      }
    }
    setLoading(false)
  }, [jobId, queryClient])

  useEffect(() => { load() }, [load])

  function clearDraft() {
    draftGenRef.current += 1
    setSummary('')
    setNextSteps('')
    setWeatherText('')
    setCrewCount('')
    setHoursWorked('')
    setEditingId(null)
    // Revoke any blob: URLs we created for previews so we don't leak.
    for (const p of draftPhotos) {
      if (p.preview_url.startsWith('blob:')) URL.revokeObjectURL(p.preview_url)
    }
    setDraftPhotos([])
  }

  // Photos uploaded for the open draft. Photos already on a saved log
  // (edit mode) are left out: that log still points at them.
  function draftUploads(): string[] {
    return draftPhotos
      .filter((p) => !p.existing && !p.uploading && p.storage_path)
      .map((p) => p.storage_path)
  }

  // Cancel throws the draft away, including the photos uploaded for it,
  // which no log will ever point at.
  function discardDraft() {
    removeStoredPhotos(draftUploads())
    clearDraft()
    setComposing(false)
  }

  // Open the compose form filled from an existing row. Existing
  // photos are loaded as drafts (flagged so cancel/remove doesn't purge
  // them from storage) using their already-signed URLs for preview.
  function startEdit(r: LogRow) {
    hapticTap()
    // The edit replaces whatever draft was open, uploads included.
    removeStoredPhotos(draftUploads())
    clearDraft()
    setEditingId(r.id)
    setSummary(r.summary || '')
    setNextSteps(r.next_steps || '')
    setWeatherText(r.weather_text || '')
    setCrewCount(r.crew_count != null ? String(r.crew_count) : '')
    setHoursWorked(r.hours_worked != null ? String(r.hours_worked) : '')
    const existing: DraftPhoto[] = (Array.isArray(r.photos) ? r.photos : [])
      .filter((p: any) => typeof p?.storage_path === 'string')
      .map((p: any) => ({
        local_id: p.storage_path,
        preview_url: photoUrls[p.storage_path] || '',
        storage_path: p.storage_path,
        size: Number(p.size) || 0,
        uploading: false,
        existing: true,
      }))
    setDraftPhotos(existing)
    setComposing(true)
  }

  // Upload one file at a time so failures don't poison the whole batch.
  // Matches the Photos.tsx pattern: compress → upload to job-photos →
  // we DON'T insert a fh_job_files row from here; the photo lives only
  // on the daily log. That keeps the Photos tab uncluttered with
  // every site-update snap.
  async function uploadOnePhoto(file: File): Promise<DraftPhoto | null> {
    if (file.size > MAX_BYTES) {
      toastError('Photo too large', `${file.name} exceeds 10 MB`)
      return null
    }
    let blob: Blob | null
    try {
      blob = await compressImageToBlob(file, 1_500_000, 1800)
    } catch (ex: any) {
      toastError("Couldn't process photo", ex?.message || file.name)
      return null
    }
    if (!blob) return null
    const localId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const path = `${userId}/${jobId}/daily-${localId}.jpg`
    const { error: upErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, blob, { upsert: false, contentType: 'image/jpeg' })
    if (upErr) {
      toastError('Upload failed', upErr.message)
      return null
    }
    const previewUrl = URL.createObjectURL(blob)
    return { local_id: localId, preview_url: previewUrl, storage_path: path, size: blob.size, uploading: false }
  }

  async function handlePickPhotos(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || [])
    e.target.value = ''
    if (files.length === 0) return
    hapticTap()
    // Optimistic placeholders so the user sees progress.
    const placeholders: DraftPhoto[] = files.map((f) => ({
      local_id: `pending-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      preview_url: URL.createObjectURL(f),
      storage_path: '',
      size: f.size,
      uploading: true,
    }))
    setDraftPhotos((cur) => [...cur, ...placeholders])
    const gen = draftGenRef.current
    for (let i = 0; i < files.length; i++) {
      const ph = placeholders[i]
      // The draft was cancelled or posted while this batch was uploading:
      // stop, and delete anything that landed after it went away.
      if (draftGenRef.current !== gen) break
      const done = await uploadOnePhoto(files[i])
      if (draftGenRef.current !== gen) {
        if (done) {
          removeStoredPhotos([done.storage_path])
          URL.revokeObjectURL(done.preview_url)
        }
        break
      }
      setDraftPhotos((cur) => {
        if (!done) return cur.filter((p) => p.local_id !== ph.local_id)
        return cur.map((p) => (p.local_id === ph.local_id ? done : p))
      })
      // Revoke the placeholder blob URL, we now have a real one (or none).
      URL.revokeObjectURL(ph.preview_url)
    }
  }

  function removeDraftPhoto(localId: string) {
    setDraftPhotos((cur) => {
      const removed = cur.find((p) => p.local_id === localId)
      if (removed?.preview_url?.startsWith('blob:')) URL.revokeObjectURL(removed.preview_url)
      // Only purge objects we uploaded this session. A pre-existing
      // photo (edit mode) is left in storage until save rewrites the
      // row's photo list, so a cancel can't destroy a saved photo.
      if (removed?.storage_path && !removed.existing) {
        // Best-effort cleanup of the just-uploaded object, silent failure.
        supabase.storage.from(PHOTO_BUCKET).remove([removed.storage_path]).catch(() => {})
      }
      return cur.filter((p) => p.local_id !== localId)
    })
  }

  async function save() {
    const text = summary.trim()
    if (!text) return
    hapticTap()
    setSaving(true)
    const readyPhotos = draftPhotos
      .filter((p) => !p.uploading && p.storage_path)
      .map((p) => ({ storage_path: p.storage_path, size: p.size }))

    if (editingId) {
      // Update in place. Optional fields are written explicitly (null
      // when cleared) so editing can remove a value, and photos are
      // rewritten to whatever survived the edit. The photos column is
      // NOT NULL (an empty list, never null), so a log with no photos
      // writes [].
      const patch: Record<string, any> = {
        summary: text,
        next_steps: nextSteps.trim() || null,
        weather_text: weatherText.trim() || null,
        crew_count: crewCount && Number.isFinite(Number(crewCount)) ? parseInt(crewCount, 10) : null,
        hours_worked: hoursWorked && Number.isFinite(Number(hoursWorked)) ? Number(hoursWorked) : null,
        photos: readyPhotos,
      }
      const { data: updated, error } = await supabase
        .from('fh_daily_logs')
        .update(patch as any)
        .eq('id', editingId)
        .eq('user_id', userId)
        .select('id')
      setSaving(false)
      if (error || !updated?.length) {
        toastError("Couldn't save changes", error?.message || 'This log may have been deleted, or you can no longer edit it.')
        return
      }
      // Photos taken off the log in this edit are no longer referenced.
      const kept = new Set(readyPhotos.map((p) => p.storage_path))
      const before = rows.find((r) => r.id === editingId)
      removeStoredPhotos(photoPaths(before?.photos).filter((p) => !kept.has(p)))
      clearDraft()
      setComposing(false)
      toastSuccess('Daily log updated')
      load()
      return
    }

    const payload: Record<string, any> = {
      user_id: userId,
      contact_id: jobId,
      summary: text,
      // The foreman's calendar day. The column default is the database's
      // current_date, which is UTC, so an evening post was dated tomorrow.
      log_date: todayYmd(),
    }
    if (nextSteps.trim()) payload.next_steps = nextSteps.trim()
    if (weatherText.trim()) payload.weather_text = weatherText.trim()
    if (crewCount && Number.isFinite(Number(crewCount))) payload.crew_count = parseInt(crewCount, 10)
    if (hoursWorked && Number.isFinite(Number(hoursWorked))) payload.hours_worked = Number(hoursWorked)
    if (readyPhotos.length > 0) payload.photos = readyPhotos
    const { error } = await supabase.from('fh_daily_logs').insert(payload as any)
    setSaving(false)
    if (error) {
      toastError("Couldn't post log", error.message)
      return
    }
    clearDraft()
    setComposing(false)
    toastSuccess('Daily log posted')
    load()
  }

  async function remove(id: string) {
    hapticTap()
    const ok = await confirm({ title: 'Delete this daily log?', body: 'This cannot be undone.', destructive: true })
    if (!ok) return
    const row = rows.find((r) => r.id === id)
    setRows((rs) => rs.filter((r) => r.id !== id))
    const { data: deleted, error } = await supabase
      .from('fh_daily_logs')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
      .select('id')
    if (error || !deleted?.length) {
      toastError("Couldn't delete", error?.message || 'This log may already be gone, or you can no longer delete it.')
      load()
      return
    }
    // The log was the only thing pointing at its photos.
    removeStoredPhotos(photoPaths(row?.photos))
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 24px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Eyebrow>
          Daily logs
        </Eyebrow>
        {!composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            style={{
              padding: '8px 12px',
              borderRadius: 10,
              border: 'none',
              background: 'var(--v3-primary)',
              color: 'var(--v3-on-primary, #141414)',
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0,
              cursor: 'pointer',
            }}
          >
            + New log
          </button>
        )}
      </div>

      {composing && (
        <div
          style={{
            display: 'flex', flexDirection: 'column', gap: 12,
            padding: 12, borderRadius: 10,
            background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
          }}
        >
          <textarea
            value={summary}
            onChange={(e) => setSummary(e.target.value)}
            placeholder="What happened on site today?"
            rows={3}
            autoFocus
            style={{
              width: '100%',
              padding: '12px 12px',
              borderRadius: 10,
              border: '1px solid var(--v3-border)',
              background: 'var(--v3-surface-2, rgba(20, 20, 20,.20))',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              outline: 'none',
              resize: 'vertical',
              minHeight: 80,
            }}
          />
          <textarea
            value={nextSteps}
            onChange={(e) => setNextSteps(e.target.value)}
            placeholder="What's next? (optional)"
            rows={2}
            style={{
              width: '100%',
              padding: '12px 12px',
              borderRadius: 10,
              border: '1px solid var(--v3-border)',
              background: 'var(--v3-surface-2, rgba(20, 20, 20,.20))',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              outline: 'none',
              resize: 'vertical',
              minHeight: 56,
            }}
          />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input
              value={weatherText}
              onChange={(e) => setWeatherText(e.target.value)}
              placeholder="Weather (e.g. 72°, light wind)"
              style={inputStyle}
            />
            <input
              type="number"
              min="0"
              value={crewCount}
              onChange={(e) => setCrewCount(e.target.value)}
              placeholder="Crew on site"
              style={{ ...inputStyle, maxWidth: 130 }}
            />
            <input
              type="number"
              min="0"
              step="0.25"
              value={hoursWorked}
              onChange={(e) => setHoursWorked(e.target.value)}
              placeholder="Hours"
              style={{ ...inputStyle, maxWidth: 100 }}
            />
          </div>

          {/* Photo strip, drafts during compose. Tap a thumb's X to
              remove (deletes from storage too). */}
          {draftPhotos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {draftPhotos.map((p) => (
                <div
                  key={p.local_id}
                  style={{
                    position: 'relative',
                    width: 72, height: 72,
                    borderRadius: 10,
                    overflow: 'hidden',
                    background: 'rgba(20, 20, 20,.3)',
                    border: '1px solid var(--v3-border)',
                  }}
                >
                  <img loading="lazy"src={p.preview_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: p.uploading ? 0.45 : 1 }} />
                  {p.uploading && (
                    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--v3-text)', fontSize: 12, fontWeight: 700 }}>
                      Uploading…
                    </div>
                  )}
                  {!p.uploading && (
                    <button
                      type="button"
                      onClick={() => removeDraftPhoto(p.local_id)}
                      aria-label="Remove photo"
                      style={{
                        position: 'absolute', top: 2, right: 2,
                        width: 22, height: 22, borderRadius: 10,
                        border: 'none', background: 'rgba(20, 20, 20,.65)',
                        color: '#F2EDE4', cursor: 'pointer',
                        display: 'grid', placeItems: 'center',
                      }}
                    >
                      <X size={11} aria-hidden="true" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handlePickPhotos}
              style={{ display: 'none' }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={saving}
              style={{ ...secondaryBtn, marginRight: 'auto' }}
            >
              <ImagePlus size={13} aria-hidden="true" style={{ display: 'inline', marginRight: 6, verticalAlign: '-1px' }} />
              Add photos
            </button>
            <button
              type="button"
              onClick={discardDraft}
              disabled={saving}
              style={secondaryBtn}
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || !summary.trim()}
              style={primaryBtn(saving || !summary.trim())}
            >
              {saving ? (editingId ? 'Saving…' : 'Posting…') : (editingId ? 'Save changes' : 'Post log')}
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <SkeletonAny rows={2} card={false} />
      ) : rows.length === 0 ? (
        <div
          style={{
            padding: '24px 16px',
            textAlign: 'center',
            color: 'var(--v3-text-muted)',
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            border: '1px dashed var(--v3-border)',
            borderRadius: 10,
          }}
        >
          <Sparkles size={18} aria-hidden="true" style={{ display: 'block', margin: '0 auto 8px', color: 'var(--v3-primary-text)' }} />
          No daily logs yet. Tap <strong style={{ color: 'var(--v3-text)' }}>+ New log</strong> after a shift to capture what got done.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AnimatePresence initial={false}>
            {rows.map((r) => (
              <motion.li
                key={r.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 8,
                  padding: '12px 16px',
                  borderRadius: 10,
                  background: 'var(--v3-surface)',
                  border: '1px solid var(--v3-border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
                    <strong style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: 0, color: 'var(--v3-text)' }}>
                      {fmtDay(r.log_date)}
                    </strong>
                    <span style={{ fontSize: 12, color: 'var(--v3-text-muted)' }}>
                      posted {fmtTime(r.created_at)}
                    </span>
                  </div>
                  {r.user_id === userId && (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button
                        type="button"
                        onClick={() => startEdit(r)}
                        aria-label="Edit log"
                        title="Edit"
                        style={{
                          width: 28, height: 28, borderRadius: 10,
                          border: 'none', background: 'transparent',
                          color: 'var(--v3-text-muted)', cursor: 'pointer',
                          display: 'grid', placeItems: 'center',
                        }}
                      >
                        <Pencil size={13} aria-hidden="true" />
                      </button>
                      <button
                        type="button"
                        onClick={() => remove(r.id)}
                        aria-label="Delete log"
                        title="Delete"
                        style={{
                          width: 28, height: 28, borderRadius: 10,
                          border: 'none', background: 'transparent',
                          color: 'var(--v3-text-muted)', cursor: 'pointer',
                          display: 'grid', placeItems: 'center',
                        }}
                      >
                        <Trash2 size={13} aria-hidden="true" />
                      </button>
                    </div>
                  )}
                </div>

                <p style={{ margin: 0, color: 'var(--v3-text)', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {r.summary}
                </p>

                {r.next_steps && (
                  <div style={{
                    padding: '8px 12px',
                    borderLeft: '2px solid var(--v3-primary)',
                    background: 'color-mix(in srgb, var(--v3-primary) 6%, transparent)',
                    borderRadius: '0 8px 8px 0',
                    fontSize: 14,
                    color: 'var(--v3-text)',
                    whiteSpace: 'pre-wrap',
                  }}>
                    <Eyebrow as="strong" tone="gold" style={{ display: 'block', marginBottom: 4 }}>
                      Next
                    </Eyebrow>
                    {r.next_steps}
                  </div>
                )}

                {Array.isArray(r.photos) && r.photos.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 8 }}>
                    {(r.photos as any[]).map((p, i) => {
                      const url = p?.storage_path ? photoUrls[p.storage_path] : null
                      return (
                        <div
                          key={(p?.storage_path || '') + i}
                          style={{
                            position: 'relative',
                            aspectRatio: '1 / 1',
                            borderRadius: 10,
                            overflow: 'hidden',
                            background: 'rgba(20, 20, 20,.3)',
                            border: '1px solid var(--v3-border)',
                          }}
                        >
                          {url ? (
                            <img loading="lazy"src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--v3-text-muted)', fontSize: 12 }}>
                              …
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {(r.weather_text || r.crew_count != null || r.hours_worked != null) && (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 12, color: 'var(--v3-text-muted)', alignItems: 'center' }}>
                    {r.weather_text && (
                      <span style={metaChip}><CloudSun size={11} aria-hidden="true" /> {r.weather_text}</span>
                    )}
                    {r.crew_count != null && (
                      <span style={metaChip}><Users size={11} aria-hidden="true" /> {r.crew_count} crew</span>
                    )}
                    {r.hours_worked != null && (
                      <span style={metaChip}><Clock size={11} aria-hidden="true" /> {r.hours_worked} h</span>
                    )}
                  </div>
                )}
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  flex: '1 1 180px',
  padding: '12px 12px',
  borderRadius: 10,
  border: '1px solid var(--v3-border)',
  background: 'var(--v3-surface-2, rgba(20, 20, 20,.20))',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  outline: 'none',
}

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '8px 16px',
  borderRadius: 10,
  border: 'none',
  background: 'var(--v3-primary)',
  color: 'var(--v3-on-primary, #141414)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  fontWeight: 700,
  letterSpacing: 0,
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? 'not-allowed' : 'pointer',
})

const secondaryBtn: React.CSSProperties = {
  padding: '8px 12px',
  borderRadius: 10,
  border: '1px solid var(--v3-border)',
  background: 'transparent',
  color: 'var(--v3-text-muted)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  fontWeight: 600,
  cursor: 'pointer',
}

const metaChip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '4px 8px',
  borderRadius: 10,
  background: 'var(--v3-glass-tint)',
  border: '1px solid var(--v3-border)',
}
