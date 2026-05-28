// DailyLogs section — backed by fh_daily_logs.
//
// Per-job feed of foreman end-of-day posts: summary, what's next,
// weather window, crew count, hours worked. Anyone in the org can
// READ; the author can EDIT / DELETE their own. New log goes at the
// top with optional next_steps + weather + crew_count + hours.
//
// Lives inside the Job Detail tab strip alongside Overview / Quote /
// Details / Financials / Files.

import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { CloudSun, Trash2, Users, Clock, Sparkles } from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { toastSuccess, toastError } from '../../../lib/toast.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { SkeletonList } from '../../../components/Skeleton.tsx'

const SkeletonAny = SkeletonList as any

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

export default function DailyLogsSection({ jobId, userId }: any) {
  const [rows, setRows] = useState<LogRow[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)

  // Draft state (inline form, expanded on demand)
  const [summary, setSummary] = useState('')
  const [nextSteps, setNextSteps] = useState('')
  const [weatherText, setWeatherText] = useState('')
  const [crewCount, setCrewCount] = useState('')
  const [hoursWorked, setHoursWorked] = useState('')
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('fh_daily_logs')
      .select('id, user_id, contact_id, log_date, summary, next_steps, weather_text, crew_count, hours_worked, created_at')
      .eq('contact_id', jobId)
      .order('log_date', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50)
    if (error) {
      toastError("Couldn't load daily logs", error.message)
      setRows([])
    } else {
      setRows((data || []) as LogRow[])
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
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
