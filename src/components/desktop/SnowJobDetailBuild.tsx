// SnowJobDetailBuild — desktop chrome for /jobs/:id.
//
// Presentational. Receives the existing tab content (Overview/Quote/
// Details/Financials/Files) as children. Forms, edit/save, invoice
// generation, quote acceptance, partner invite, and notes capture
// all stay in the parent.

import type { ReactNode } from 'react'
import {
  Bell, Search, ChevronLeft, Edit2, Trash2, Plus,
  AlertTriangle, ClipboardCheck, Receipt,
} from 'lucide-react'
import { money, moneyFull } from '../../lib/format.ts'
import MiniMetric from '../MiniMetric.tsx'

type Tab = { id: string; label: string }

type Props = {
  contact: any
  client?: any                    // resolved client record if joined
  tabs: Tab[]
  activeTab: string
  onTabChange: (id: string) => void
  onBack: () => void
  backLabel?: string
  onEdit?: () => void
  onDelete?: () => void
  onAddEvent?: () => void
  isEditing?: boolean
  // Derived signals — null when a field is not tracked yet.
  scheduleStatus?: { label: string; tone: 'good' | 'warn' | 'bad' } | null
  reportsMissing?: number | null
  billingStatus?: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } | null
  paid?: number | null
  outstanding?: number | null
  changeOrderTotals?: { count: number; pending: number; approved: number; total: number } | null
  children: ReactNode
}

const STAGE_LABEL: Record<string, string> = {
  lead: 'Lead',
  quote: 'Quote',
  job: 'Active',
  invoice: 'Invoicing',
  closed: 'Closed',
  lost: 'Lost',
}
const STAGE_TONE: Record<string, 'lead' | 'quote' | 'job' | 'invoice' | 'won' | 'neutral'> = {
  lead: 'lead',
  quote: 'quote',
  job: 'job',
  invoice: 'invoice',
  closed: 'won',
  lost: 'neutral',
}

export default function SnowJobDetailBuild(props: Props) {
  const {
    contact, client, tabs, activeTab, onTabChange,
    onBack, backLabel = 'Jobs', onEdit, onDelete, onAddEvent,
    isEditing,
    scheduleStatus, reportsMissing, billingStatus, paid, outstanding, changeOrderTotals,
    children,
  } = props

  const stage = String(contact?.stage || '').toLowerCase()
  const stageLabel = STAGE_LABEL[stage] || stage || '—'
  const stageTone = STAGE_TONE[stage] || 'neutral'

  // Stage-aware chrome (audit §D). Execution panels (health, schedule,
  // reports, billing, change orders) and contract/paid/outstanding
  // stats only exist once the deal is actually being delivered. A $0
  // unquoted lead showing "JOB HEALTH — AT RISK" and three "—" money
  // stats read as broken, not premium.
  const isExecution = stage === 'job' || stage === 'invoice' || stage === 'closed'
  const recordNoun = stage === 'lead' ? 'Lead'
    : stage === 'quote' ? 'Quote'
    : stage === 'lost' ? 'Lost deal'
    : 'Job file'

  // Overall job health — best of available signals; honest "Not tracked"
  // when no data points exist yet.
  const healthSignals = [
    scheduleStatus?.tone,
    reportsMissing != null ? (reportsMissing > 0 ? 'bad' : 'good') : null,
    billingStatus?.tone,
  ].filter(Boolean) as ('good' | 'warn' | 'bad' | 'neutral')[]
  const health = healthSignals.length === 0
    ? { label: 'Not tracked', tone: 'neutral' as const }
    : healthSignals.includes('bad')
      ? { label: 'At risk', tone: 'bad' as const }
      : healthSignals.includes('warn')
        ? { label: 'Watch', tone: 'warn' as const }
        : { label: 'On track', tone: 'good' as const }

  // The rail's "Next action" card was removed — the Overview tab's
  // NextActionCard is the single NEXT ACTION source of truth (audit
  // found the two derivations disagreeing on the same record).

  return (
    <div className="fh-build-page fh-build-detail" data-build-screen="SnowJobDetailBuild">
      <header className="fh-build-topbar fh-build-topbar--detail">
        <button type="button" className="fh-build-back" onClick={onBack} aria-label={`Back to ${backLabel.toLowerCase()}`}>
          <ChevronLeft size={16} /> {backLabel}
        </button>
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
          <span>{(contact?.name || 'Job').toString()}</span>
          <span className="fh-build-vline" />
          <span style={{ opacity: 0.6 }}>Weather not set</span>
        </div>
        <button className="fh-build-icon-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))} aria-label="Open activity" title="Activity"><Bell size={16} /></button>
        {onEdit && (
          <button
            type="button"
            className={`fh-build-icon-btn${isEditing ? ' is-on' : ''}`}
            onClick={onEdit}
            aria-label="Edit"
            title="Edit"
          >
            <Edit2 size={14} />
          </button>
        )}
        {onDelete && (
          <button
            type="button"
            className="fh-build-icon-btn"
            onClick={onDelete}
            aria-label="Delete"
            title="Delete"
          >
            <Trash2 size={14} />
          </button>
        )}
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--detail">
          <div>
            <div className="fh-build-good">{recordNoun}</div>
            <h1 className="fh-build-title fh-build-title--name">{contact?.name || 'Untitled job'}</h1>
            <div className="fh-build-detail-sub">
              <span className={`fh-build-dot is-${stageToneClass(stageTone)}`}>{stageLabel}</span>
              {(client?.name || contact?.client_name) && (
                <>
                  <span className="fh-build-dot-sep">·</span>
                  <span className="fh-build-rel">For {client?.name || contact?.client_name}</span>
                </>
              )}
              {(contact?.job_address || contact?.address) && (
                <>
                  <span className="fh-build-dot-sep">·</span>
                  <span className="fh-build-rel">{contact?.job_address || contact?.address}</span>
                </>
              )}
            </div>
          </div>

          <div className="fh-build-mini-grid fh-build-mini-grid--detail">
            {isExecution ? (
              <>
                <MiniMetric
                  label="Contract"
                  value={Number(contact?.amount || 0) > 0 ? money(contact?.amount) : '—'}
                  accent={Number(contact?.amount || 0) > 0}
                />
                <MiniMetric
                  label="Paid"
                  value={paid == null ? '—' : moneyFull(paid)}
                />
                <MiniMetric
                  label="Outstanding"
                  value={outstanding == null ? '—' : outstanding > 0 ? moneyFull(outstanding) : 'Paid'}
                  tone={outstanding != null && outstanding > 0 ? 'warn' : undefined}
                />
                <MiniMetric label="Stage" value={stageLabel} />
              </>
            ) : (
              <>
                {/* Pre-deal stats: a lead has no contract/paid/outstanding —
                    show what matters for winning it instead. */}
                <MiniMetric
                  label="Est. value"
                  value={Number(contact?.amount || 0) > 0 ? money(contact?.amount) : '—'}
                  accent={Number(contact?.amount || 0) > 0}
                />
                <MiniMetric
                  label="Source"
                  value={contact?.referred_by || '—'}
                />
                <MiniMetric
                  label="Last touch"
                  value={relDate(contact?.last_contact || contact?.updated_at)}
                />
                <MiniMetric label="Stage" value={stageLabel} />
              </>
            )}
          </div>
        </section>

        {tabs.length > 0 && (
          <nav className="fh-build-tabs" aria-label="Sections">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`fh-build-tab${activeTab === t.id ? ' is-active' : ''}`}
                onClick={() => onTabChange(t.id)}
              >
                {t.label}
              </button>
            ))}
            {onAddEvent && (
              <button type="button" className="fh-build-tabs__cta" onClick={onAddEvent}>
                <Plus size={13} /> Schedule
              </button>
            )}
          </nav>
        )}

        <section className="fh-build-content-grid fh-build-content-grid--detail">
          <div className="fh-build-detail-main">
            {children}
          </div>

          <aside className="fh-build-rail fh-build-rail--page">
            {/* Pre-deal rail — contact + source context, no execution
                signals (a deal with no scheduled work can't be
                "behind"). The Overview tab's NextActionCard is the
                single NEXT ACTION source of truth; the duplicate rail
                card was removed (audit §B4/§D4). */}
            {!isExecution && (
              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Deal</div>
                <strong>{contact?.referred_by ? `via ${contact.referred_by}` : 'Source not set'}</strong>
                <span>
                  {contact?.phone || contact?.email
                    ? [contact?.phone, contact?.email].filter(Boolean).join(' · ')
                    : 'No contact info yet'}
                </span>
              </section>
            )}
            {isExecution && (<>
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Job health</div>
              <strong style={{
                color: health.tone === 'bad' ? 'var(--v3-danger-bright)'
                     : health.tone === 'warn' ? 'var(--v3-primary-bright)'
                     : health.tone === 'good' ? 'var(--v3-success-bright)'
                     : undefined,
              }}>
                {health.label}
              </strong>
              <span>
                {health.tone === 'neutral'
                  ? 'No health signals yet'
                  : `${healthSignals.length} signal${healthSignals.length === 1 ? '' : 's'} tracked`}
              </span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Schedule</div>
              {scheduleStatus ? (
                <>
                  <strong style={{
                    color: scheduleStatus.tone === 'bad' ? 'var(--v3-danger-bright)'
                         : scheduleStatus.tone === 'warn' ? 'var(--v3-primary-bright)'
                         : 'var(--v3-success-bright)',
                  }}>
                    {scheduleStatus.label}
                  </strong>
                  <span>vs planned timeline</span>
                </>
              ) : (
                <>
                  <strong>—</strong>
                  <span>Schedule not tracked</span>
                </>
              )}
              {onAddEvent && (
                <button type="button" className="fh-build-rail-card__action" onClick={onAddEvent}>
                  <Plus size={13} /> Add event
                </button>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Reports</div>
              {reportsMissing != null ? (
                <>
                  <strong style={{ color: reportsMissing > 0 ? 'var(--v3-primary-bright)' : 'var(--v3-success-bright)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {reportsMissing > 0 ? <AlertTriangle size={14} /> : <ClipboardCheck size={14} />}
                    {reportsMissing > 0 ? `${reportsMissing} missing` : 'Up to date'}
                  </strong>
                  <span>{reportsMissing > 0 ? 'Capture today’s field report' : 'Recent reports filed'}</span>
                </>
              ) : (
                <>
                  <strong>—</strong>
                  <span>No report cadence set</span>
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Billing</div>
              {billingStatus ? (
                <>
                  <strong style={{
                    color: billingStatus.tone === 'bad' ? 'var(--v3-danger-bright)'
                         : billingStatus.tone === 'warn' ? 'var(--v3-primary-bright)'
                         : billingStatus.tone === 'good' ? 'var(--v3-success-bright)'
                         : undefined,
                    display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                    <Receipt size={14} /> {billingStatus.label}
                  </strong>
                  <span>
                    {outstanding == null
                      ? 'Open balance unknown'
                      : outstanding > 0 ? `${moneyFull(outstanding)} outstanding`
                      : 'Paid in full'}
                  </span>
                </>
              ) : (
                <>
                  <strong>—</strong>
                  <span>No invoicing yet</span>
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Change orders</div>
              {changeOrderTotals == null ? (
                <>
                  <strong>—</strong>
                  <span>No change orders yet</span>
                </>
              ) : (
                <>
                  <strong style={{
                    color: changeOrderTotals.total < 0 ? 'var(--v3-danger-bright)' : undefined,
                  }}>
                    {moneyFull(changeOrderTotals.total)}
                  </strong>
                  <span>
                    {changeOrderTotals.count} CO{changeOrderTotals.count === 1 ? '' : 's'}
                    {changeOrderTotals.pending !== 0 && (
                      <> · <span style={{ color: 'var(--v3-primary-bright)' }}>
                        {moneyFull(changeOrderTotals.pending)} pending
                      </span></>
                    )}
                    {changeOrderTotals.approved !== 0 && (
                      <> · <span style={{ color: 'var(--v3-success-bright)' }}>
                        {moneyFull(changeOrderTotals.approved)} approved
                      </span></>
                    )}
                  </span>
                </>
              )}
            </section>
            </>)}
          </aside>
        </section>
      </main>
    </div>
  )
}

function stageToneClass(tone: string) {
  // Map the pipeline stage tone to one of the existing .fh-build-dot
  // tone classes (good / warn / bad / neutral).
  if (tone === 'job' || tone === 'won') return 'good'
  if (tone === 'lead' || tone === 'invoice') return 'warn'
  return 'neutral'
}

// Compact relative date for the pre-deal "Last touch" stat.
function relDate(iso: string | null | undefined) {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const days = Math.floor((Date.now() - t) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

