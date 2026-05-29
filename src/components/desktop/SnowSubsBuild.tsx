// SnowSubsBuild — desktop /subs in the Build direction.
//
// Drop-in for SnowSubs at >=900px. Treats subs/vendors as a
// controlled labor network, not a directory.

import {
  Bell,
  ChevronRight,
  Search,
  Sun,
  Plus,
  ShieldCheck,
  Hammer,
} from 'lucide-react'
import { money } from '../../lib/format.ts'
import MiniMetric from '../MiniMetric.tsx'

type Sub = {
  key: string
  name?: string | null
  trades?: string[] | null
  totalRate?: number
  jobsCount?: number
  lastWorked?: Date | null
  // True only when upstream actually carries an insurance/expiry
  // field. The current fh_subs schema doesn't, so Subs.tsx sets this
  // to false and the column renders "Not tracked" rather than
  // implying an unknown date.
  insuranceTracked?: boolean
  insurance_expires_at?: string | null
  status?: string | null
  rating?: number | null
}

type Props = {
  filtered: Sub[]
  loading: boolean
  q: string
  setQ: (s: string) => void
  tradeFilter: string
  setTradeFilter: (s: string) => void
  allTrades: string[]
  screenStats: { totalBilled: number; activeRecent: number }
  onAddSub: () => void
  onOpenSub: (key: string) => void
}

function relDate(d: Date | null | undefined) {
  if (!d) return '—'
  const t = d.getTime()
  if (!Number.isFinite(t)) return '—'
  const diff = Date.now() - t
  if (diff < 86_400_000) return 'today'
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  if (diff < 30 * 86_400_000) return `${Math.floor(diff / (7 * 86_400_000))}w ago`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Insurance pill resolver. When `tracked` is false (upstream has no
// insurance column for this sub) we render "Not tracked" honestly
// instead of pretending the value is "Unknown" — which used to imply
// the data existed but was missing.
function insuranceStatus(
  tracked: boolean | undefined,
  iso: string | null | undefined,
): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  if (tracked === false) return { label: 'Not tracked', tone: 'neutral' }
  if (!iso) return { label: 'Unknown', tone: 'neutral' }
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return { label: 'Unknown', tone: 'neutral' }
  const days = (t - Date.now()) / 86_400_000
  if (days < 0) return { label: 'Expired', tone: 'bad' }
  if (days < 30) return { label: 'Expires soon', tone: 'warn' }
  return { label: 'Current', tone: 'good' }
}

export default function SnowSubsBuild(props: Props) {
  const {
    filtered, loading, q, setQ, tradeFilter, setTradeFilter, allTrades, screenStats,
    onAddSub, onOpenSub,
  } = props

  // Derived metrics — only count insurance signals on subs where the
  // field is actually tracked. Untracked rows don't contribute either
  // way (they're neither "expiring" nor "needs review").
  const insuranceIsTracked = filtered.some((s) => s.insuranceTracked === true)
  const insuranceExpiring = insuranceIsTracked
    ? filtered.filter((s) => {
        if (s.insuranceTracked === false) return false
        const st = insuranceStatus(s.insuranceTracked, s.insurance_expires_at)
        return st.tone === 'warn' || st.tone === 'bad'
      }).length
    : 0
  const needsReview = insuranceIsTracked
    ? filtered.filter((s) => s.insuranceTracked !== false && !s.insurance_expires_at && (s.jobsCount || 0) > 0).length
    : 0

  // Trade coverage — count of distinct trades present in the filtered list.
  // s.trades upstream may be a Set, array, plain object, or a single
  // string depending on the bundle shape; normalize before iterating.
  const tradeCoverage = (() => {
    const set = new Set<string>()
    for (const s of filtered) for (const t of normalizeTrades(s.trades)) set.add(t)
    return set.size
  })()

  return (
    <div className="fh-build-page" data-build-screen="SnowSubsBuild">
      <header className="fh-build-topbar">
        <div className="fh-build-search">
          <Search size={14} />
          <input
            className="fh-build-search__input"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search teams, trades..."
          />
          <kbd>⌘K</kbd>
        </div>
        <div className="fh-build-topbar__meta">
          <span>{filtered.length.toLocaleString()} on the bench</span>
          <span className="fh-build-vline" />
          <span>72° · Clear</span>
          <Sun size={16} className="fh-build-sun" />
        </div>
        <button className="fh-build-icon-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))} aria-label="Open activity" title="Activity"><Bell size={16} /></button>
        <button className="fh-build-new-btn" type="button" onClick={onAddSub}>
          <Plus size={15} /> Add Team
        </button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Teams</div>
            <h1 className="fh-build-title">FIELD BENCH.</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Trade</div>
            <select
              className="fh-build-select"
              value={tradeFilter}
              onChange={(e) => setTradeFilter(e.target.value)}
            >
              <option value="">All trades</option>
              {allTrades.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <p>
              {tradeCoverage} {tradeCoverage === 1 ? 'trade' : 'trades'} covered ·
              {' '}{screenStats.activeRecent} worked in 30d
            </p>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Active subs" value={String(screenStats.activeRecent)} accent />
            <MiniMetric
              label={insuranceIsTracked ? 'Insurance expiring' : 'Insurance'}
              value={insuranceIsTracked ? String(insuranceExpiring) : 'Not tracked'}
              tone={insuranceIsTracked && insuranceExpiring > 0 ? 'warn' : undefined}
            />
            <MiniMetric label="Total billed" value={money(screenStats.totalBilled)} />
            <MiniMetric label="Trade coverage" value={String(tradeCoverage)} />
          </div>
        </section>

        <section className="fh-build-content-grid fh-build-content-grid--subs">
          <section className="fh-build-card fh-build-table fh-build-subs-table">
            <header className="fh-build-card-head">
              <div className="fh-build-eyebrow">Field bench · {filtered.length.toLocaleString()}</div>
              <button type="button">Export CSV</button>
            </header>

            <div className="fh-build-table__head is-subs">
              <span>Team / Sub</span>
              <span>Trade</span>
              <span>Active jobs</span>
              <span>Insurance</span>
              <span>Last used</span>
              <span>Billed</span>
              <span />
            </div>

            {loading && (
              <div className="fh-build-table__empty">Loading subs…</div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="fh-build-table__empty">No teams match. <button type="button" className="fh-build-inline-link" onClick={onAddSub}>+ Add Team</button>.</div>
            )}
            {!loading && filtered.slice(0, 60).map((s: any) => {
              const ins = insuranceStatus(s.insuranceTracked, s.insurance_expires_at)
              const allTradesForRow = normalizeTrades(s.trades)
              const trades = allTradesForRow.slice(0, 2)
              const extra = allTradesForRow.length - trades.length
              return (
                <button
                  key={s.key}
                  type="button"
                  className="fh-build-table__row is-subs"
                  onClick={() => onOpenSub(s.key)}
                >
                  <strong className="fh-build-truncate" title={s.name || 'Unnamed'}>{s.name || 'Unnamed'}</strong>
                  <span className="fh-build-trade-chips">
                    {trades.length === 0 ? (
                      <span className="fh-build-rel">—</span>
                    ) : trades.map((t: string) => (
                      <span key={t} className="fh-build-chip">{t}</span>
                    ))}
                    {extra > 0 && <span className="fh-build-chip is-muted">+{extra}</span>}
                  </span>
                  <span className="fh-build-num">{s.jobsCount || 0}</span>
                  <span className={`fh-build-dot is-${ins.tone}`}>{ins.label}</span>
                  <span className="fh-build-rel">{relDate(s.lastWorked)}</span>
                  <span className="fh-build-num">{money(s.totalRate || 0)}</span>
                  <ChevronRight size={13} />
                </button>
              )
            })}

            {!loading && filtered.length > 60 && (
              <div className="fh-build-table__more">
                Showing first 60 of {filtered.length.toLocaleString()}.
              </div>
            )}
          </section>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Active subs</div>
              <strong>{screenStats.activeRecent}</strong>
              <span>worked in last 30d</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Insurance expiring</div>
              {insuranceIsTracked ? (
                <>
                  <strong style={{ color: insuranceExpiring > 0 ? '#e0a141' : undefined }}>
                    {insuranceExpiring}
                  </strong>
                  <span>{insuranceExpiring > 0 ? 'Verify before next use' : 'All current'}</span>
                  {insuranceExpiring > 0 && <div className="fh-build-spark is-gold" />}
                </>
              ) : (
                <>
                  <strong>—</strong>
                  <span>Insurance not tracked yet</span>
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">On jobs today</div>
              <strong>—</strong>
              <span>Schedule integration coming</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Crew portal</div>
              <strong>Not connected</strong>
              <span>No employee/crew roster yet</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Owner / admin access</div>
              <strong>Single owner</strong>
              <span>Multi-user roles not yet configured</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Needs review</div>
              {insuranceIsTracked ? (
                <>
                  <strong>{needsReview}</strong>
                  <span>used without insurance on file</span>
                </>
              ) : (
                <>
                  <strong>—</strong>
                  <span>Enable insurance tracking to surface</span>
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Trade coverage</div>
              <strong>{tradeCoverage}</strong>
              <span>distinct trades on bench</span>
              <div className="fh-build-rail-card__spark">
                <ShieldCheck size={14} />
                <span>{tradeCoverage >= 5 ? 'broad' : 'narrow'}</span>
              </div>
            </section>
          </aside>
        </section>
      </main>
    </div>
  )
}

// Silence unused icon import.
void Hammer

// normalizeTrades — Subs.tsx aggregates each sub's trades into a Set
// (`new Set()`), so passing the grouped object straight into a
// component that expects an array crashes on .slice / .map. Bundles
// from older snapshots can also expose trades as a single string or
// a plain object map, so the helper covers all four shapes.
function normalizeTrades(input: any): string[] {
  if (Array.isArray(input)) return input.filter(Boolean)
  if (input instanceof Set) return Array.from(input).filter(Boolean)
  if (typeof input === 'string') return input ? [input] : []
  if (input && typeof input === 'object') return Object.values(input).filter(Boolean) as string[]
  return []
}
