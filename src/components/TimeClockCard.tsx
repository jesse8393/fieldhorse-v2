import { useEffect, useRef, useState } from 'react'
import { Clock, Play, Square, AlertTriangle } from 'lucide-react'
import { supabase } from '../lib/supabase.ts'
import { todayYmd } from '../lib/dates.ts'
import { recalcCost } from '../lib/stages.ts'
import { getActivePunchForContact, punchIn as dbPunchIn, punchOut as dbPunchOut } from '../lib/timePunches.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { hapticTap, hapticSuccess } from '../lib/haptics.ts'
import { Eyebrow } from './v3'

// Time clock card, Phase 19 / Upgrade Move #A2.
//
// Per-job clock in/out persisted in localStorage so a refresh or tab
// close doesn't lose the running meter. On clock out we prompt for an
// hourly rate (default from localStorage), insert an fh_expenses row
// with category='Labor', and call recalcCost so the job's cost +
// margin update everywhere they're shown.
//
// V1 scope:
//   - Local-device only. Clock in on phone, clock out on phone, same
//     device. Multi-device sync is a future enhancement (would need a
//     fh_time_punches table).
//   - One active punch per job. Clocking in elsewhere on the same job
//     overwrites the prior start.
//   - Hourly rate default is per-user preference (localStorage), not
//     per-job. Future: derive from active sub on the job.

const ACTIVE_PUNCH_KEY = (jobId: any) => `fh:timeclock:${jobId}:start`
const HOURLY_RATE_KEY = 'fh:timeclock:hourlyRate'

function readActiveStart(jobId: any) {
  if (typeof window === 'undefined') return null
  try {
    const v = window.localStorage.getItem(ACTIVE_PUNCH_KEY(jobId))
    if (!v) return null
    const t = parseInt(v, 10)
    return Number.isFinite(t) ? t : null
  } catch { return null }
}

function writeActiveStart(jobId: any, ts: any) {
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

function writePreferredRate(r: any) {
  if (typeof window === 'undefined') return
  try { window.localStorage.setItem(HOURLY_RATE_KEY, String(r)) } catch {}
}

function fmtElapsed(ms: any) {
  if (ms < 0) ms = 0
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`
  return `${m}m ${String(s).padStart(2, '0')}s`
}

export default function TimeClockCard({ contact, userId, onLogged }: any) {
  // start (ms) drives the running meter. punchId is the fh_time_punches
  // row we'll close on clock out. We seed start from localStorage so
  // the meter doesn't flicker before the DB read returns, then
  // reconcile against the DB in the effect below.
  const [start, setStart] = useState<number | null>(() => readActiveStart(contact.id))
  const [punchId, setPunchId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [confirming, setConfirming] = useState(false)
  const [rate, setRate] = useState(readPreferredRate())
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const tickRef = useRef<any>(null)

  // Re-read on jobId change (navigation between jobs).
  // We fall back to localStorage immediately for instant UI, then
  // reconcile against fh_time_punches. If the DB says "not actually
  // clocked in on this job," clear the localStorage seed so a stale
  // pre-rewrite punch doesn't trick the UI into showing a fake meter.
  useEffect(() => {
    let cancelled = false
    setStart(readActiveStart(contact.id))
    setPunchId(null)
    setConfirming(false)
    setNote('')
    if (!userId) return
    ;(async () => {
      const active = await getActivePunchForContact(userId, contact.id)
      if (cancelled) return
      if (active) {
        setPunchId(active.id)
        const ms = new Date(active.punch_in_at).getTime()
        if (Number.isFinite(ms)) {
          setStart(ms)
          writeActiveStart(contact.id, ms)
        }
      } else {
        // DB says no active punch for this job, discard any stale cache.
        setStart(null)
        writeActiveStart(contact.id, null)
      }
    })()
    return () => { cancelled = true }
  }, [contact.id, userId])

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

  async function handleClockIn() {
    hapticTap()
    try {
      const punch = await dbPunchIn({ userId, contactId: contact.id })
      const ts = new Date(punch.punch_in_at).getTime()
      setPunchId(punch.id)
      setStart(ts)
      writeActiveStart(contact.id, ts)
    } catch (ex: any) {
      const msg = String(ex?.message || '')
      // Postgres unique_violation surfaces as 23505 or a message that
      // mentions the partial index name. Either way it means the user
      // is already clocked in somewhere, on another job, on /crew,
      // or in another tab.
      if (msg.includes('one_active_per_user') || ex?.code === '23505') {
        toastError('Already on the clock', 'Clock out before starting a new shift.')
      } else {
        toastError("Couldn't clock in", msg || 'Try again')
      }
    }
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
      // 1) Close the punch row. If we don't have a punchId in state
      //    (e.g. the user's seed came from localStorage but the DB
      //    reconcile hadn't returned yet), submission proceeds with
      //    just the fh_expenses insert, fh_time_punches will be
      //    missing this shift but cost tracking still works.
      if (punchId) {
        try {
          await dbPunchOut({
            punchId,
            hourlyRate: rate,
            notes: note.trim() || null,
          })
        } catch (punchErr: any) {
          // Non-fatal, log it and continue with the cost insert so the
          // operator's job cost stays accurate.
          console.warn('[TimeClockCard] punch close failed', punchErr)
        }
      }

      // 2) Cost row (kept verbatim, feeds the per-job cost / margin
      //    rollup that the rest of the app already reads).
      const { error } = await supabase.from('fh_expenses').insert({
        user_id: userId,
        contact_id: contact.id,
        description: note.trim() || `Labor, ${hours.toFixed(2)} hrs @ $${rate}/hr`,
        amount: billable,
        category: 'Labor',
        expense_date: todayYmd()
      })
      if (error) throw error
      writePreferredRate(rate)
      writeActiveStart(contact.id, null)
      setStart(null)
      setPunchId(null)
      setConfirming(false)
      setNote('')
      hapticSuccess()
      toastSuccess('Time logged', `${hours.toFixed(2)} hrs · $${billable.toLocaleString()}`)
      // Refresh job cost / margin
      try { await recalcCost(contact.id, userId) } catch {}
      onLogged?.()
    } catch (ex: any) {
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
        padding: 12,
        borderRadius: 10,
        background: start
          ? 'linear-gradient(135deg, rgba(45, 122, 79,0.10), rgba(45, 122, 79,0.03))'
          : 'var(--surface-2)',
        border: start ? '1px solid rgba(45, 122, 79,0.35)' : '1px solid var(--rule)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
          <span aria-hidden="true" style={{ width: 32, height: 32, borderRadius: 10, display: 'grid', placeItems: 'center', background: start ? 'rgba(45, 122, 79,0.18)' : 'rgba(201,150,58,0.12)', border: start ? '1px solid rgba(45, 122, 79,0.35)' : '1px solid rgba(201,150,58,0.3)', color: start ? 'var(--signal-green)' : 'var(--field-gold-bright)' }}>
            <Clock size={14} />
          </span>
          <div>
            <Eyebrow as="div" style={{ color: 'var(--ink-muted)' }}>
              Time on this job
            </Eyebrow>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, lineHeight: 1, marginTop: 4, color: start ? 'var(--signal-green)' : 'var(--ink-strong)' }}>
              {start ? fmtElapsed(elapsedMs) : 'Not clocked in'}
            </div>
          </div>
        </div>
        {!start && (
          <button
            type="button"
            onClick={handleClockIn}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 12px', borderRadius: 10, border: 'none', background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))', color: 'var(--onyx)', fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: 0, cursor: 'pointer' }}
          >
            <Play size={12} /> CLOCK IN
          </button>
        )}
        {start && !confirming && (
          <button
            type="button"
            onClick={handleStopRequest}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 12px', borderRadius: 10, border: 'none', background: 'var(--alert-red)', color: '#F2EDE4', fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: 0, cursor: 'pointer' }}
          >
            <Square size={12} /> CLOCK OUT
          </button>
        )}
      </div>

      {confirming && (
        <div style={{ padding: 12, borderRadius: 10, background: 'rgba(20, 20, 20,0.25)', border: '1px solid var(--rule)', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
            Logging <strong style={{ color: 'var(--ink-strong)' }}>{fmtElapsed(elapsedMs)}</strong> as a Labor expense on this job.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Eyebrow style={{ color: 'var(--ink-muted)' }}>Hourly rate</Eyebrow>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontFamily: 'var(--font-display)', color: 'var(--ink-muted)' }}>$</span>
                <input
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step={1}
                  value={rate}
                  onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
                  style={{ flex: 1, minWidth: 0, padding: '8px 12px', borderRadius: 10, border: '1px solid var(--rule)', background: 'var(--surface-2)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, boxSizing: 'border-box' }}
                />
              </div>
            </label>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <Eyebrow style={{ color: 'var(--ink-muted)' }}>Billable</Eyebrow>
              <span style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--rule)', background: 'var(--surface-2)', fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--field-gold-bright)' }}>
                ${billablePreview.toLocaleString(undefined, { maximumFractionDigits: 2 })}
              </span>
            </div>
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What was done? (optional)"
            style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--rule)', background: 'var(--surface-2)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, boxSizing: 'border-box' }}
          />
          {hoursPreview < 0.05 && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--field-gold-bright)' }}>
              <AlertTriangle size={11} /> Less than 3 minutes, sure?
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              onClick={handleCancel}
              disabled={saving}
              style={{ padding: '8px 12px', borderRadius: 10, border: '1px solid var(--rule)', background: 'transparent', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 12, cursor: 'pointer' }}
            >
              Keep running
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={saving || rate <= 0}
              style={{ padding: '8px 12px', borderRadius: 10, border: 'none', background: saving ? 'rgba(45, 122, 79,0.5)' : 'var(--signal-green)', color: '#F2EDE4', fontFamily: 'var(--font-display)', fontSize: 12, letterSpacing: 0, cursor: saving ? 'default' : 'pointer' }}
            >
              {saving ? 'LOGGING…' : 'LOG TIME'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
