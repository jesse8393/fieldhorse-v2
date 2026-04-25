import { useEffect, useRef, useState } from 'react'
import { Clock, Play, Square, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { recalcCost } from '../lib/stages.js'
import { toastSuccess, toastError } from '../lib/toast.js'
import { hapticTap, hapticSuccess } from '../lib/haptics.js'

// Time clock card — Phase 19 / Upgrade Move #A2.
//
// Per-job clock in/out persisted in localStorage so a refresh or tab
// close doesn't lose the running meter. On clock-out we prompt for an
// hourly rate (default from localStorage), insert an fh_expenses row
// with category='Labor', and call recalcCost so the job's cost +
// margin update everywhere they're shown.
//
// V1 scope:
//   - Local-device only. Clock in on phone, clock out on phone — same
//     device. Multi-device sync is a future enhancement (would need a
//     fh_time_punches table).
//   - One active punch per job. Clocking in elsewhere on the same job
//     overwrites the prior start.
//   - Hourly rate default is per-user preference (localStorage), not
//     per-job. Future: derive from active sub on the job.

const ACTIVE_PUNCH_KEY = (jobId) => `fh:timeclock:${jobId}:start`
const HOURLY_RATE_KEY = 'fh:timeclock:hourlyRate'

function readActiveStart(jobId) {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(ACTIVE_PUNCH_KEY(jobId))
    if (!v) return null
    const t = parseInt(v, 10)
    return Number.isFinite(t) ? t : null
  } catch { return null }
}

function writeActiveStart(jobId, ts) {
  if (typeof window === 'undefined') return
  try {
    if (ts == null) window.localStorage.removeItem(ACTIVE_PUNCH_KEY(jobId))
    else window.localStorage.setItem(ACTIVE_PUNCH_KEY(jobId), String(ts))
  } catch {}
}

function readPreferredRate() {
  if (typeof window === 'undefined') return 65
  try {
    const v = parseFloat(window.localStorage.getItem(HOURLY_RATE_KEY) || '65')
    return Number.isFinite(v) && v > 0 ? v : 65
  } catch { return 65 }
}

function writePreferredRate(r) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(HOURLY_RATE_KEY, String(r)) } catch {}
}

function fmtElapsed(ms) {
  if (ms < 0) ms = 0
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export default function TimeClockCard({ contact, userId, onLogged }) {
  const [start, setStart] = useState(() => readActiveStart(contact.id))
  const [now, setNow] = useState(Date.now())
  const [confirming, setConfirming] = useState(false)
  const [rate, setRate] = useState(readPreferredRate())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const tickRef = useRef(null)

  // Re-read on jobId change (navigation between jobs)
  useEffect(() => {
    setStart(readActiveStart(contact.id))
    setConfirming(false)
    setNote('')
  }, [contact.id])

  // Tick once a second only when running so the card doesn't waste
  // battery when nobody is on the clock.
  useEffect(() => {
    if (!start) {
      if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      return
    }
    setNow(Date.now())
    tickRef.current = setInterval(() => setNow(Date.now()), 1000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [start])

  function handleClockIn() {
    hapticTap()
    const ts = Date.now()
    writeActiveStart(contact.id, ts)
    setStart(ts)
  }

  function handleStopRequest() {
    hapticTap()
    setConfirming(true)
  }

  function handleCancel() {
    setConfirming(false)
  }

  async function handleSubmit() {
    if (!start) return
    const elapsedMs = Date.now() - start
    const hours = elapsedMs / 3_600_000
    const billable = Math.round(hours * rate * 100) / 100
    setSaving(true)
    try {
      const { error } = await supabase.from('fh_expenses').insert({
        user_id: userId,
        contact_id: contact.id,
        description: note.trim() || `Labor — ${hours.toFixed(2)} hrs @ $${rate}/hr`,
        amount: billable,
        category: 'Labor',
        expense_date: new Date().toISOString().slice(0, 10)
      })
      if (error) throw error
      writePreferredRate(rate)
      writeActiveStart(contact.id, null)
      setStart(null)
      setConfirming(false)
      setNote('')
      hapticSuccess()
      toastSuccess('Time logged', `${hours.toFixed(2)} hrs · $${billable.toLocaleString()}`)
      // Refresh job cost / margin
      try { await recalcCost(contact.id) } catch {}
      onLogged?.()
    } catch (ex) {
      toastError("Couldn't log time", ex?.message || 'Try again')
    } finally {
      setSaving(false)
    }
  }

  const elapsedMs = start ? now - start : 0
  const hoursPreview = elapsedMs / 3_600_000
  const billablePreview = hoursPreview * (rate || 0)

  return (
    <div
      style={{
        padding: 14,
        borderRadius: 14,
        background: start
          ? 'linear-gradient(135deg, rgba(72,130,95,0.10), rgba(72,130,95,0.03))'
          : 'var(--surface-2)',
        border: start ? '1px solid rgba(72,130,95,0.35)' : '1px solid var(--rule)',
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 9, display: 'grid', placeItems: 'center', background: start ? 'rgba(72,130,95,0.18)' : 'rgba(201,150,58,0.12)', border: start ? '1px solid rgba(72,130,95,0.35)' : '1px solid rgba(201,150,58,0.3)', color: start ? 'var(--signal-green)' : 'var(--field-gold-bright)' }}>
            <Clock size={14} />
          </span>
          <div>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
              Time on this job
            </div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, lineHeight: 1, marginTop: 4, color: start ? 'var(--signal-green)' : 'var(--ink-strong)' }}>
              {start ? fmtElapsed(elapsedMs) : 'Not clocked in'}
            </div>
          </div>
        </div>
        {!start && (
          <button
            type="button"
            onClick={handleClockIn}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 11, border: 'none', background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))', color: 'var(--onyx)', fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.12em', cursor: 'pointer' }}
          >
            <Play size={12} /> CLOCK IN
          </button>
        )}
        {start && !confirming && (
          <button
            type="button"
            onClick={handleStopRequest}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 14px', borderRadius: 11, border: 'none', background: 'var(--alert-red)', color: '#fff', fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.12em', cursor: 'pointer' }}
          >
            <Square size={12} /> CLOCK OUT
          </button>
        )}
      </div>

      {confirming && (
        <div style={{ padding: 12, borderRadius: 10, background: 'rgba(0,0,0,0.25)', border: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 11, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
            Logging <strong style={{ color: 'var(--ink-strong)' }}>{fmtElapsed(elapsedMs)}</strong> as a Labor expense on this job.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Hourly rate</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-display)', color: 'var(--ink-muted)' }}>$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={1}
                  value={rate}
                  onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
                  style={{ flex: 1, minWidth: 0, padding: '8px 10px', borderRadius: 8, border: '1px solid var(--rule)', background: 'var(--surface-2)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, boxSizing: 'border-box' }}
                />
              </div>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Billable</span>
              <span style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--rule)', background: 'rgba(255,255,255,0.02)', fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--field-gold-bright)' }}>
                ${billablePreview.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was done? (optional)"
            style={{ padding: '8px 10px', borderRadius: 8, border: '1px solid var(--rule)', background: 'var(--surface-2)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, boxSizing: 'border-box' }}
          />
          {hoursPreview < 0.05 && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--field-gold-bright)' }}>
              <AlertTriangle size={11} /> Less than 3 minutes — sure?
            </div>
          )}
          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              style={{ padding: '8px 12px', borderRadius: 9, border: '1px solid var(--rule)', background: 'transparent', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 12, cursor: 'pointer' }}
            >
              Keep running
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving || rate <= 0}
              style={{ padding: '8px 14px', borderRadius: 9, border: 'none', background: saving ? 'rgba(72,130,95,0.5)' : 'var(--signal-green)', color: '#fff', fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.12em', cursor: saving ? 'default' : 'pointer' }}
            >
              {saving ? 'LOGGING…' : 'LOG TIME'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
