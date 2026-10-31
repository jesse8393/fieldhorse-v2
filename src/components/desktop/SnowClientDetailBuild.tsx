// SnowClientDetailBuild, desktop chrome for /clients/:id.
//
// Presentational. Receives the existing tab body as children plus
// presentational vitals computed by the parent. Forms, edit/save
// behavior, delete flows, and tab routing all stay in the parent.

import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell, Search, ChevronLeft, ChevronRight, Edit2, Trash2,
  Phone, Mail, MapPin, ArrowUpRight, Plus, ExternalLink, Receipt,
} from 'lucide-react'
import { money, moneyFull } from '../../lib/format.ts'
import { clientActivity } from '../../lib/clientActivity.ts'
import MiniMetric from '../MiniMetric.tsx'
import PaletteKeyCap, { paletteShortcut } from './PaletteKeyCap.tsx'

type Tab = { id: string; label: string }

type Props = {
  client: any
  lifetime: number
  outstanding: number
  activeCount: number
  jobs?: any[]
  payments?: any[]
  tabs: Tab[]
  activeTab: string
  onTabChange: (id: string) => void
  onBack: () => void
  onEdit?: () => void
  onDelete?: () => void
  /** The delete button was tapped once; the next tap deletes (D57). */
  deleteArmed?: boolean
  onNewDeal?: () => void
  onStatement?: () => void
  isEditing?: boolean
  children: ReactNode
}

function relTime(iso: any) {
  if (!iso) return '\u2003'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '\u2003'
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function SnowClientDetailBuild(props: Props) {
  const {
    client, lifetime, outstanding, activeCount, jobs = [],
    tabs, activeTab, onTabChange,
    onBack, onEdit, onDelete, deleteArmed = false, onNewDeal, onStatement, isEditing, children,
  } = props

  const activity = clientActivity(client?.last_activity_at)
  const status: { label: string; tone: 'good' | 'warn' | 'neutral' } = (() => {
    if (activeCount > 0) {
      return activity.state === 'stale' ? { label: 'Cooling', tone: 'warn' } : { label: 'Active', tone: 'good' }
    }
    return { label: 'Dormant', tone: 'neutral' }
  })()

  // Open value = sum of amount on active jobs (not invoiced/closed)
  const openValue = (jobs || [])
    .filter((j: any) => j.stage && j.stage !== 'invoice' && j.stage !== 'closed' && j.stage !== 'lost')
    .reduce((s: number, j: any) => s + Number(j.amount || 0), 0)

  // Recent activity for rail = last 4 jobs by updated_at
  const recent = [...(jobs || [])]
    .sort((a: any, b: any) =>
      new Date(b.updated_at || b.created_at || 0).getTime() -
      new Date(a.updated_at || a.created_at || 0).getTime())
    .slice(0, 4)

  // Each suggestion opens the workspace needed to act on it.
  const nextAction = outstanding > 0
    ? { label: 'Review contract balance', detail: 'Includes work not yet invoiced.', run: () => onTabChange('projects') }
    : activeCount === 0 && onNewDeal
      ? { label: 'Start new work', detail: 'Carry this customer into a new record.', run: onNewDeal }
      : status.tone === 'warn'
        ? { label: 'Review recent activity', detail: 'Last recorded activity exceeds 30 days.', run: () => onTabChange('activity') }
        : { label: 'Review active work', detail: 'Open linked jobs, quotes, and invoices.', run: () => onTabChange('projects') }

  return (
    <div className="fh-build-page fh-build-detail fh-client-workspace" data-build-screen="SnowClientDetailBuild">
      <header className="fh-build-topbar fh-build-topbar--detail">
        <button type="button" className="fh-build-back" onClick={onBack} aria-label="Back to clients">
          <ChevronLeft size={16} /> Clients
        </button>
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
          aria-keyshortcuts={paletteShortcut().combo}
        >
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <PaletteKeyCap />
        </button>
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
            aria-label={deleteArmed ? 'Tap again to delete' : 'Delete'}
            title={deleteArmed ? 'Tap again to delete this client' : 'Delete'}
            style={deleteArmed ? { width: 'auto', padding: '0 12px', gap: 8 } : undefined}
          >
            <Trash2 size={14} />
            {deleteArmed && <span style={{ fontSize: 12, fontWeight: 700 }}>Tap again to delete</span>}
          </button>
        )}
      </header>

      <div className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--detail">
          <div>
            <div className="fh-build-good">Relationship file</div>
            <h1 className="fh-build-title fh-build-title--name">{client?.name || 'Unnamed client'}</h1>
            <div className="fh-build-detail-sub">
              <span className={`fh-build-dot is-${status.tone}`}>{status.label}</span>
              <span className="fh-build-dot-sep">·</span>
              <span className="fh-build-rel">{activity.lastTouch ? `Last touch ${relTime(activity.lastTouch)}` : 'Activity date unavailable'}</span>
            </div>
          </div>

          <div className="fh-build-mini-grid fh-build-mini-grid--detail">
            <MiniMetric label="Lifetime value" value={money(lifetime)} accent />
            <MiniMetric label="Open value" value={openValue > 0 ? money(openValue) : '\u2003'} />
            <MiniMetric label="Active jobs" value={String(activeCount)} />
            <MiniMetric label="Remaining contract value" value={moneyFull(outstanding)} />
          </div>
        </section>

        {/* Tab strip, controlled by the parent */}
        {tabs.length > 0 && (
          <nav className="fh-build-tabs" aria-label="Sections">
            {tabs.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`fh-build-tab${activeTab === t.id ? ' is-active' : ''}`}
                onClick={() => onTabChange(t.id)}
                aria-current={activeTab === t.id ? 'page' : undefined}
              >
                {t.label}
              </button>
            ))}
            {onStatement && (
              <button type="button" className="fh-build-tabs__cta" onClick={onStatement} style={{ marginLeft: 'auto' }}>
                <Receipt size={13} /> Statement
              </button>
            )}
            {onNewDeal && (
              <button type="button" className="fh-build-tabs__cta fh-client-new" onClick={onNewDeal} style={onStatement ? undefined : { marginLeft: 'auto' }}>
                <Plus size={13} /> New deal
              </button>
            )}
          </nav>
        )}

        <section className="fh-build-content-grid fh-build-content-grid--detail">
          <div className="fh-build-detail-main">
            {children}
          </div>

          <aside className="fh-build-rail fh-build-rail--page" aria-label="Customer context">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Next action</div>
              <button type="button" className="fh-client-next" onClick={nextAction.run}>
                <span>{nextAction.label}</span><ArrowUpRight size={18} aria-hidden="true" />
              </button>
              <span>{nextAction.detail}</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Recently updated jobs</div>
              {recent.length === 0 ? (
                <span>No jobs yet</span>
              ) : (
                <ul className="fh-build-rail-list" style={{ marginTop: 10 }}>
                  {recent.map((j: any) => (
                    <li key={j.id}>
                      <Link className="fh-client-recent" to={`/jobs/${encodeURIComponent(j.id)}`}>
                        <span className="fh-build-rail-list__time">{relTime(j.updated_at || j.created_at)}</span>
                        <span className="fh-build-rail-list__title">{j.job_title || j.name || 'Untitled job'}</span>
                        <ChevronRight size={14} aria-hidden="true" />
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {activeTab !== 'overview' && <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Contact info</div>
              <div className="fh-build-contact-list">
                {client?.phone && (
                  <a className="fh-build-contact-row" href={`tel:${client.phone}`}>
                    <Phone size={12} /> <span>{client.phone}</span>
                    <ChevronRight size={12} className="fh-build-contact-row__chev" />
                  </a>
                )}
                {client?.email && (
                  <a className="fh-build-contact-row" href={`mailto:${client.email}`}>
                    <Mail size={12} /> <span>{client.email}</span>
                    <ExternalLink size={12} className="fh-build-contact-row__chev" />
                  </a>
                )}
                {client?.address && (
                  <div className="fh-build-contact-row">
                    <MapPin size={12} /> <span>{client.address}</span>
                  </div>
                )}
                {!client?.phone && !client?.email && !client?.address && (
                  <span className="fh-build-rel" style={{ display: 'block', padding: '8px 0' }}>
                    No contact info on file
                  </span>
                )}
              </div>
            </section>}
          </aside>
        </section>
      </div>
    </div>
  )
}

