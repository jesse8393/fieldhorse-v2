// DailyLogs section — backed by fh_daily_logs.
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
import { CloudSun, Trash2, Users, Clock, Sparkles, ImagePlus, X } from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { toastSuccess, toastError } from '../../../lib/toast.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { SkeletonList } from '../../../components/Skeleton.tsx'
import { compressImageToBlob } from '../../../lib/docIntelligence.ts'

const SkeletonAny = SkeletonList as any
const PHOTO_BUCKET = 'job-photos'
const SIGN_TTL_SECONDS = 3600
const MAX_BYTES = 10 * 1024 * 1024

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

type DraftPhoto = { local_id: string; preview_url: string; storage_path: string; size: number; uploading: boolean }

export default function DailyLogsSection({ jobId, userId }: any) {
  const [rows, setRows] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
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
      // Batch-sign every photo path referenced by these rows so the
      // <img> tags get a fresh signed URL. One round-trip regardless
      // of how many logs returned.
      const paths = new Set<string>()
      for (const r of list) {
        const arr = Array.isArray(r.photos) ? r.photos : []
        for (const p of arr) {
          if (typeof p?.storage_path === 'string') paths.add(p.storage_path)
        }
      }
      if (paths.size > 0) {
        const { data: signed } = await supabase.storage
          .from(PHOTO_BUCKET)
          .createSignedUrls(Array.from(paths), SIGN_TTL_SECONDS)
        const next: Record<string, string> = {}
        for (const s of (signed || [])) {
          if (s?.path && s.signedUrl && !s.error) next[s.path] = s.signedUrl
        }
        setPhotoUrls(next)
      } else {
        setPhotoUrls({})
      }
    }
    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load])

  function clearDraft() {
    setSummary('')
    setNextSteps('')
    setWeatherText('')
    setCrewCount('')
    setHoursWorked('')
    // Revoke any blob: URLs we created for previews so we don't leak.
    for (const p of draftPhotos) {
      if (p.preview_url.startsWith('blob:')) URL.revokeObjectURL(p.preview_url)
    }
    setDraftPhotos([])
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
    for (let i = 0; i < files.length; i++) {
      const ph = placeholders[i]
      const done = await uploadOnePhoto(files[i])
      setDraftPhotos((cur) => {
        if (!done) return cur.filter((p) => p.local_id !== ph.local_id)
        return cur.map((p) => (p.local_id === ph.local_id ? done : p))
      })
      // Revoke the placeholder blob URL — we now have a real one (or none).
      URL.revokeObjectURL(ph.preview_url)
    }
  }

  function removeDraftPhoto(localId: string) {
    setDraftPhotos((cur) => {
      const removed = cur.find((p) => p.local_id === localId)
      if (removed?.preview_url?.startsWith('blob:')) URL.revokeObjectURL(removed.preview_url)
      if (removed?.storage_path) {
        // Best-effort cleanup of the just-uploaded object — silent failure.
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
    const payload: Record<string, any> = {
      user_id: userId,
      contact_id: jobId,
      summary: text,
    }
    if (nextSteps.trim()) payload.next_steps = nextSteps.trim()
    if (weatherText.trim()) payload.weather_text = weatherText.trim()
    if (crewCount && Number.isFinite(Number(crewCount))) payload.crew_count = parseInt(crewCount, 10)
    if (hoursWorked && Number.isFinite(Number(hoursWorked))) payload.hours_worked = Number(hoursWorked)
    const readyPhotos = draftPhotos
      .filter((p) => !p.uploading && p.storage_path)
      .map((p) => ({ storage_path: p.storage_path, size: p.size }))
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
    const ok = window.confirm('Delete this daily log? This cannot be undone.')
    if (!ok) return
    setRows((rs) => rs.filter((r) => r.id !== id))
    const { error } = await supabase.from('fh_daily_logs').delete().eq('id', id).eq('user_id', userId)
    if (error) {
      toastError("Couldn't delete", error.message)
      load()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v3-text-muted)' }}>
          Daily logs
        </span>
        {!composing && (
          <button
            type="button"
            onClick={() => setComposing(true)}
            style={{
              padding: '7px 14px',
              borderRadius: 8,
              border: 'none',
              background: 'var(--v3-primary)',
              color: 'var(--v3-on-primary, #141414)',
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: '0.04em',
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
            display: 'flex', flexDirection: 'column', gap: 10,
            padding: 14, borderRadius: 12,
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
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--v3-border)',
              background: 'var(--v3-surface-2, rgba(0,0,0,.20))',
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
              padding: '10px 12px',
              borderRadius: 8,
              border: '1px solid var(--v3-border)',
              background: 'var(--v3-surface-2, rgba(0,0,0,.20))',
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

          {/* Photo strip — drafts during compose. Tap a thumb's X to
              remove (deletes from storage too). */}
          {draftPhotos.length > 0 && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {draftPhotos.map((p) => (
                <div
                  key={p.local_id}
                  style={{
                    position: 'relative',
                    width: 72, height: 72,
                    borderRadius: 8,
                    overflow: 'hidden',
                    background: 'rgba(0,0,0,.3)',
                    border: '1px solid var(--v3-border)',
                  }}
                >
                  <img loading="lazy"src={p.preview_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: p.uploading ? 0.45 : 1 }} />
                  {p.uploading && (
                    <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', color: 'var(--v3-text)', fontSize: 10, fontWeight: 700 }}>
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
                        width: 22, height: 22, borderRadius: 999,
                        border: 'none', background: 'rgba(0,0,0,.65)',
                        color: '#fff', cursor: 'pointer',
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
              onClick={() => { clearDraft(); setComposing(false) }}
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
              {saving ? 'Posting…' : 'Post log'}
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
            fontSize: 13,
            border: '1px dashed var(--v3-border)',
            borderRadius: 12,
          }}
        >
          <Sparkles size={18} aria-hidden="true" style={{ display: 'block', margin: '0 auto 8px', color: 'var(--v3-primary)' }} />
          No daily logs yet. Tap <strong style={{ color: 'var(--v3-text)' }}>+ New log</strong> after a shift to capture what got done.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                  padding: '14px 16px',
                  borderRadius: 12,
                  background: 'var(--v3-surface)',
                  border: '1px solid var(--v3-border)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                    <strong style={{ fontFamily: 'var(--font-display, "Bebas Neue", Impact, sans-serif)', fontSize: 22, letterSpacing: '.01em', color: 'var(--v3-text)' }}>
                      {fmtDay(r.log_date)}
                    </strong>
                    <span style={{ fontSize: 11, color: 'var(--v3-text-muted)' }}>
                      posted {fmtTime(r.created_at)}
                    </span>
                  </div>
                  {r.user_id === userId && (
                    <button
                      type="button"
                      onClick={() => remove(r.id)}
                      aria-label="Delete log"
                      title="Delete"
                      style={{
                        width: 28, height: 28, borderRadius: 8,
                        border: 'none', background: 'transparent',
                        color: 'var(--v3-text-muted)', cursor: 'pointer',
                        display: 'grid', placeItems: 'center',
                      }}
                    >
                      <Trash2 size={13} aria-hidden="true" />
                    </button>
                  )}
                </div>

                <p style={{ margin: 0, color: 'var(--v3-text)', fontSize: 14, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                  {r.summary}
                </p>

                {r.next_steps && (
                  <div style={{
                    padding: '8px 10px',
                    borderLeft: '2px solid var(--v3-primary)',
                    background: 'color-mix(in srgb, var(--v3-primary) 6%, transparent)',
                    borderRadius: '0 8px 8px 0',
                    fontSize: 13,
                    color: 'var(--v3-text)',
                    whiteSpace: 'pre-wrap',
                  }}>
                    <strong style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase', color: 'var(--v3-primary)', display: 'block', marginBottom: 4 }}>
                      Next
                    </strong>
                    {r.next_steps}
                  </div>
                )}

                {Array.isArray(r.photos) && r.photos.length > 0 && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(96px, 1fr))', gap: 6 }}>
                    {(r.photos as any[]).map((p, i) => {
                      const url = p?.storage_path ? photoUrls[p.storage_path] : null
                      return (
                        <div
                          key={(p?.storage_path || '') + i}
                          style={{
                            position: 'relative',
                            aspectRatio: '1 / 1',
                            borderRadius: 8,
                            overflow: 'hidden',
                            background: 'rgba(0,0,0,.3)',
                            border: '1px solid var(--v3-border)',
                          }}
                        >
                          {url ? (
                            <img loading="lazy"src={url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: 'var(--v3-text-muted)', fontSize: 10 }}>
                              …
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}

                {(r.weather_text || r.crew_count != null || r.hours_worked != null) && (
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', fontSize: 11, color: 'var(--v3-text-muted)', alignItems: 'center' }}>
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
  padding: '10px 12px',
  borderRadius: 8,
  border: '1px solid var(--v3-border)',
  background: 'var(--v3-surface-2, rgba(0,0,0,.20))',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  outline: 'none',
}

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  padding: '9px 16px',
  borderRadius: 8,
  border: 'none',
  background: 'var(--v3-primary)',
  color: 'var(--v3-on-primary, #141414)',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.04em',
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? 'not-allowed' : 'pointer',
})

const secondaryBtn: React.CSSProperties = {
  padding: '9px 14px',
  borderRadius: 8,
  border: '1px solid var(--v3-border)',
  background: 'transparent',
  color: 'var(--v3-text-muted)',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
}

const metaChip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 8px',
  borderRadius: 999,
  background: 'rgba(255,255,255,.04)',
  border: '1px solid var(--v3-border)',
}
