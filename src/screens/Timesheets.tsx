// Timesheets — /timesheets. Owner / admin / manager approval flow.
//
// Lists pending punches (clocked out, not yet approved) for the
// caller's org. Approve individual rows or use the per-user batch
// button to approve everything for one teammate. The backend
// re-checks the role gate; hiding the UI from foreman/crew is a
// courtesy.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, CheckCheck, ChevronRight, Search, AlertTriangle } from 'lucide-react'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { orgPunchApprove, orgPunchFlag, orgTimesheetsList, type PendingPunch } from '../lib/orgApi.ts'
import { recalcCost } from '../lib/stages.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { toastSuccess, toastError } from '../lib/toast.ts'
import MiniMetric from '../components/MiniMetric.tsx'

// HH:MM format — see comment in screens/Crew.tsx. Bebas Neue
// (the display font on duration metrics) is uppercase-only, so
// "1h 30m" rendered as "1H 30M" which read as wrong. Digits +
// colon survive any case.
function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${String(m).padStart(2, '0')}`
}
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  } catch { return '—' }
}
function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch { return '—' }
}
function fmtMoney(n: number | null): string {
  if (n == null) return '—'
  return `$${Math.round(n).toLocaleString()}`
}

function startOfWeek(): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  // Treat Monday as the start of the week (ISO). Sunday → -6, Mon → 0, etc.
  const day = d.getDay()
  const diff = (day === 0 ? -6 : 1) - day
  d.setDate(d.getDate() + diff)
  return d
}

export default function Timesheets() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { orgName, role, loading: memLoading, canApproveTimesheets } = useMembership()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [punches, setPunches] = useState<PendingPunch[]>([])
  const [approving, setApproving] = useState<Record<string, boolean>>({})
  // Filter window: 'all' or 'thisWeek' (Mon–now)
  const [windowMode, setWindowMode] = useState<'all' | 'thisWeek'>('thisWeek')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const opts: { from?: string; to?: string } = {}
      if (windowMode === 'thisWeek') {
        opts.from = startOfWeek().toISOString()
      }
      const res = await orgTimesheetsList(opts)
      setPunches(res.punches || [])
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Could not load timesheets.')
    } finally {
      setLoading(false)
    }
  }, [windowMode])

  useEffect(() => { if (!memLoading) load() }, [memLoading, load])

  // Group by user for batch-approve.
  const groups = useMemo(() => {
    const map = new Map<string, { user_id: string; name: string; email: string | null; rows: PendingPunch[] }>()
    for (const p of punches) {
      const key = p.user_id
      if (!map.has(key)) {
        map.set(key, {
          user_id: p.user_id,
          name: p.user_name || p.user_email || 'Teammate',
          email: p.user_email,
          rows: [],
        })
      }
      map.get(key)!.rows.push(p)
    }
    return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name))
  }, [punches])

  // Refresh the cached job cost for the contacts behind these punch
  // ids — approval can stamp rates (repricing unrated hours) and
  // flag/unflag moves hours in and out of billable labor. Best-effort;
  // the cache also self-heals on the next owner-side recalc.
  function recalcAffected(ids: string[]) {
    if (!user?.id) return
    const contactIds = new Set(
      punches.filter((p) => ids.includes(p.id) && p.contact_id).map((p) => p.contact_id as string)
    )
    for (const cid of contactIds) {
      recalcCost(cid, user.id).catch(() => {})
    }
  }

  async function approve(ids: string[]) {
    if (ids.length === 0) return
    setApproving((m) => Object.fromEntries([...Object.entries(m), ...ids.map((id) => [id, true] as const)]))
    try {
      const res = await orgPunchApprove(ids)
      toastSuccess(`${res.approved_count} approved`)
      // Optimistic: drop the approved rows.
      setPunches((cur) => cur.filter((p) => !res.approved_ids.includes(p.id)))
      recalcAffected(res.approved_ids || ids)
    } catch (e: any) {
      toastError('Approve failed', e?.detail || e?.message || '')
    } finally {
      setApproving((m) => {
        const next = { ...m }
        for (const id of ids) delete next[id]
        return next
      })
    }
  }

  // Flag / reject a punch — prompts for a reason, marks it flagged (and
  // clears any approval server-side). Keeps the row visible so it can be
  // resolved; the "Flagged" KPI now reflects reality.
  async function flag(id: string) {
    const reason = window.prompt('Reason for flagging this punch? (e.g. GPS mismatch, wrong rate)')
    if (reason === null) return
    setApproving((m) => ({ ...m, [id]: true }))
    try {
      await orgPunchFlag([id], true, reason.trim())
      toastSuccess('Punch flagged')
      setPunches((cur) => cur.map((p) => p.id === id ? { ...p, flagged: true, flag_reason: reason.trim() || null } : p))
      recalcAffected([id])
    } catch (e: any) {
      toastError('Flag failed', e?.detail || e?.message || '')
    } finally {
      setApproving((m) => { const n = { ...m }; delete n[id]; return n })
    }
  }

  async function clearFlag(id: string) {
    setApproving((m) => ({ ...m, [id]: true }))
    try {
      await orgPunchFlag([id], false)
      toastSuccess('Flag cleared')
      setPunches((cur) => cur.map((p) => p.id === id ? { ...p, flagged: false, flag_reason: null } : p))
      recalcAffected([id])
    } catch (e: any) {
      toastError('Failed', e?.detail || e?.message || '')
    } finally {
      setApproving((m) => { const n = { ...m }; delete n[id]; return n })
    }
  }

  // KPI snapshot. Flagged punches are excluded from hours/cost — they
  // don't bill the job while disputed (lib/labor.ts skips them), so
  // counting them here made the approval screen disagree with job cost.
  // Zero-length punches (invalid) count as needing attention too — the
  // audit found 0:00 shifts sitting approvable with FLAGGED reading 0.
  const unflagged = punches.filter((p) => !p.flagged && !p.invalid)
  const totalMinutes = unflagged.reduce((s, p) => s + p.minutes, 0)
  const totalCost    = unflagged.reduce((s, p) => s + (p.cost ?? 0), 0)
  const flaggedCount = punches.filter((p) => p.flagged || p.invalid).length

  // Role-gate the entire screen at first paint; backend re-checks anyway.
  if (!memLoading && !canApproveTimesheets) {
    return (
      <div className="fh-build-page" data-build-screen="Timesheets">
        <main className="fh-build-main">
          <section className="fh-build-hero-row fh-build-hero-row--page">
            <div>
              <div className="fh-build-good">Timesheets</div>
              <h1 className="fh-build-title">RESTRICTED.</h1>
            </div>
          </section>
          <div className="fh-build-table__empty">
            Your role ({role || 'unknown'}) can't approve timesheets. Ask an owner or admin.
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="fh-build-page" data-build-screen="Timesheets" data-build-route="/timesheets">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
        >
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="fh-build-topbar__meta">
          <span>{orgName || 'Your team'}</span>
          <span className="fh-build-vline" />
          <span style={{ opacity: 0.6 }}>Weather not set</span>
        </div>
        <button
          className="fh-build-icon-btn"
          type="button"
          onClick={() => navigate('/activity')}
          aria-label="Open activity"
          title="Activity"
        >
          <Bell size={16} />
        </button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Timesheets</div>
            <h1 className="fh-build-title">APPROVE THE WEEK.</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Window</div>
            <div className="fh-build-view-toggle fh-build-view-toggle--inline">
              <button
                type="button"
                className={windowMode === 'thisWeek' ? 'is-active' : ''}
                onClick={() => setWindowMode('thisWeek')}
              >
                This week
              </button>
              <button
                type="button"
                className={windowMode === 'all' ? 'is-active' : ''}
                onClick={() => setWindowMode('all')}
              >
                All pending
              </button>
            </div>
            <p>
              {punches.length} {punches.length === 1 ? 'punch' : 'punches'} waiting ·
              {' '}{fmtMinutes(totalMinutes)} total
            </p>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Pending punches" value={String(punches.length)} accent />
            <MiniMetric label="Total hours" value={fmtMinutes(totalMinutes)} />
            <MiniMetric label="Est. labor cost" value={fmtMoney(totalCost)} />
            <MiniMetric label="Flagged" value={String(flaggedCount)} tone={flaggedCount > 0 ? 'warn' : undefined} />
          </div>
        </section>

        {error && (
          <div className="fh-build-banner is-warn" style={{ cursor: 'default' }}>
            <AlertTriangle size={14} />
            <span>{error}</span>
            <button type="button" className="fh-build-banner__cta" onClick={load} style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}>Retry →</button>
          </div>
        )}

        {loading && (
          <div className="fh-build-table__empty">Loading timesheets…</div>
        )}

        {!loading && groups.length === 0 && (
          <div className="fh-build-table__empty">
            All caught up. No punches waiting on approval.
          </div>
        )}

        {!loading && groups.map((g) => {
          const groupMinutes = g.rows.reduce((s, r) => s + r.minutes, 0)
          const groupCost    = g.rows.reduce((s, r) => s + (r.cost ?? 0), 0)
          return (
            <section key={g.user_id} className="fh-build-card" style={{ marginBottom: 18 }}>
              <header className="fh-build-card-head">
                <div>
                  <div className="fh-build-eyebrow">{g.name}</div>
                  {g.email && (
                    <div style={{ fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 2 }}>
                      {g.email}
                    </div>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--v3-text-secondary)' }}>
                    {g.rows.length} punch{g.rows.length === 1 ? '' : 'es'} ·
                    {' '}{fmtMinutes(groupMinutes)}
                    {groupCost > 0 ? ` · ${fmtMoney(groupCost)}` : ''}
                  </span>
                  <button
                    type="button"
                    className="fh-build-primary-btn"
                    // Flagged AND zero-length rows stay OUT of "Approve
                    // all" — disputed or invalid punches must be resolved
                    // (or explicitly approved) on their own row, not
                    // swept through with the batch.
                    onClick={() => approve(g.rows.filter((r) => !r.flagged && !r.invalid).map((r) => r.id))}
                    disabled={g.rows.every((r) => r.flagged || r.invalid) || g.rows.some((r) => approving[r.id])}
                  >
                    <CheckCheck size={13} /> Approve all
                  </button>
                </div>
              </header>

              <div className="fh-build-table__head is-timesheet">
                <span>Date</span>
                <span>Job</span>
                <span>In → Out</span>
                <span>Hours</span>
                <span>Cost</span>
                <span>Status</span>
                <span />
              </div>

              {g.rows.map((r) => (
                <div key={r.id} className="fh-build-table__row is-timesheet">
                  <span className="fh-build-rel">{fmtDate(r.punch_in_at)}</span>
                  {r.contact_id ? (
                    <button
                      type="button"
                      onClick={() => navigate(`/jobs/${r.contact_id}`)}
                      style={{ background: 'transparent', border: 'none', color: 'var(--v3-text)', textAlign: 'left', cursor: 'pointer', padding: 0, fontFamily: 'inherit', fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                    >
                      {r.contact_name || 'Open job'} <ChevronRight size={11} />
                    </button>
                  ) : (
                    <span className="fh-build-rel">No job linked</span>
                  )}
                  <span className="fh-build-rel">{fmtTime(r.punch_in_at)} – {fmtTime(r.punch_out_at)}</span>
                  <span className="fh-build-num">{fmtMinutes(r.minutes)}</span>
                  <span className="fh-build-num">{fmtMoney(r.cost)}</span>
                  <span>
                    {r.flagged ? (
                      <span className="fh-build-dot is-warn" title={r.flag_reason || ''}>Flagged</span>
                    ) : r.invalid ? (
                      <span className="fh-build-dot is-bad" title="Clock-out is not after clock-in">Invalid</span>
                    ) : (
                      <span className="fh-build-dot is-neutral">Pending</span>
                    )}
                  </span>
                  <span style={{ display: 'inline-flex', gap: 4 }}>
                    <button
                      type="button"
                      className="fh-build-icon-action"
                      onClick={() => r.flagged ? clearFlag(r.id) : flag(r.id)}
                      disabled={!!approving[r.id]}
                      aria-label={r.flagged ? 'Clear flag' : 'Flag punch'}
                      title={r.flagged ? 'Clear flag' : 'Flag / reject'}
                      style={{ color: r.flagged ? 'var(--v3-primary, #c9963a)' : undefined }}
                    >
                      <AlertTriangle size={14} />
                    </button>
                    <button
                      type="button"
                      className="fh-build-icon-action"
                      onClick={() => approve([r.id])}
                      disabled={!!approving[r.id]}
                      aria-label="Approve punch"
                      title="Approve"
                    >
                      <Check size={14} />
                    </button>
                  </span>
                </div>
              ))}
            </section>
          )
        })}
      </main>
    </div>
  )
}

