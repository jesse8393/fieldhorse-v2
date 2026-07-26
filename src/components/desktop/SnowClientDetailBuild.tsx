// SnowClientDetailBuild — desktop chrome for /clients/:id.
//
// Presentational. Receives the existing tab body as children plus
// presentational vitals computed by the parent. Forms, edit/save
// behavior, delete flows, and tab routing all stay in the parent.

import type { ReactNode } from 'react'
import {
  Bell, Search, ChevronLeft, ChevronRight, Edit2, Trash2,
  Phone, Mail, MapPin, AlertTriangle, Plus, ExternalLink, Receipt,
} from 'lucide-react'
import { money, moneyFull } from '../../lib/format.ts'
import MiniMetric from '../MiniMetric.tsx'
import TopbarWeather from './TopbarWeather.tsx'

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
  onNewDeal?: () => void
  onStatement?: () => void
  isEditing?: boolean
  children: ReactNode
}

function relTime(iso: any) {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function SnowClientDetailBuild(props: Props) {
  const {
    client, lifetime, outstanding, activeCount, jobs = [], payments = [],
    tabs, activeTab, onTabChange,
    onBack, onEdit, onDelete, onNewDeal, onStatement, isEditing, children,
  } = props

  const status: { label: string; tone: 'good' | 'warn' | 'neutral' } = (() => {
    if (activeCount > 0) {
      const last = new Date(client?.last_activity_at || 0).getTime()
      const stale = Number.isFinite(last) && Date.now() - last > 30 * 24 * 60 * 60 * 1000
      return stale ? { label: 'Cooling', tone: 'warn' } : { label: 'Active', tone: 'good' }
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

  // Next action heuristic — honest derivations from data
  const nextAction = outstanding > 0
    ? { label: 'Chase outstanding invoice', tone: 'warn' as const }
    : activeCount === 0
      ? { label: 'Re-engage client', tone: 'neutral' as const }
      : status.tone === 'warn'
        ? { label: 'Follow up on stale jobs', tone: 'warn' as const }
        : { label: 'On track', tone: 'good' as const }

  return (
    <div className="fh-build-page fh-build-detail" data-build-screen="SnowClientDetailBuild">
      <header className="fh-build-topbar fh-build-topbar--detail">
        <button type="button" className="fh-build-back" onClick={onBack} aria-label="Back to clients">
          <ChevronLeft size={16} /> Clients
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
          <span>{(client?.name || 'Client').toString()}</span>
          <span className="fh-build-vline" />
          <TopbarWeather />
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
            <div className="fh-build-good">Relationship file</div>
            <h1 className="fh-build-title fh-build-title--name">{client?.name || 'Unnamed client'}</h1>
            <div className="fh-build-detail-sub">
              <span className={`fh-build-dot is-${status.tone}`}>{status.label}</span>
              {client?.last_activity_at && (
                <>
                  <span className="fh-build-dot-sep">·</span>
                  <span className="fh-build-rel">Last touch {relTime(client.last_activity_at)}</span>
                </>
              )}
            </div>
          </div>

          <div className="fh-build-mini-grid fh-build-mini-grid--detail">
            <MiniMetric label="Lifetime value" value={money(lifetime)} accent />
            <MiniMetric label="Open value" value={openValue > 0 ? money(openValue) : '—'} />
            <MiniMetric label="Active jobs" value={String(activeCount)} />
            <MiniMetric label="Outstanding AR" value={outstanding > 0 ? money(outstanding) : '—'} tone={outstanding > 0 ? 'warn' : undefined} />
          </div>
        </section>

        {/* Tab strip — controlled by the parent */}
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
            {onStatement && (
              <button type="button" className="fh-build-tabs__cta" onClick={onStatement} style={{ marginLeft: 'auto' }}>
                <Receipt size={13} /> Statement
              </button>
            )}
            {onNewDeal && (
              <button type="button" className="fh-build-tabs__cta" onClick={onNewDeal} style={onStatement ? undefined : { marginLeft: 'auto' }}>
                <Plus size={13} /> New deal
              </button>
            )}
          </nav>
        )}

        <section className="fh-build-content-grid fh-build-content-grid--detail">
          <div className="fh-build-detail-main">
            {children}
          </div>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Next action</div>
              <strong style={{ color: nextAction.tone === 'warn' ? 'var(--v3-primary-bright)' : nextAction.tone === 'good' ? 'var(--v3-success-bright)' : undefined }}>
                {nextAction.label}
              </strong>
              <span>derived from open work + AR</span>
            </section>

            {outstanding > 0 && (
              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Outstanding AR</div>
                <strong style={{ color: 'var(--v3-primary, #c9963a)' }}>{moneyFull(outstanding)}</strong>
                <span>owed across {(payments || []).length || activeCount} job{(payments || []).length === 1 ? '' : 's'}</span>
                <div className="fh-build-spark is-gold" />
              </section>
            )}

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Open risks</div>
              {activeCount === 0 ? (
                <>
                  <strong>—</strong>
                  <span>No active jobs</span>
                </>
              ) : status.tone === 'warn' ? (
                <>
                  <strong style={{ color: 'var(--v3-primary-bright)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <AlertTriangle size={14} /> Cooling
                  </strong>
                  <span>30+ days since last touch</span>
                </>
              ) : (
                <>
                  <strong style={{ color: 'var(--v3-success-bright)' }}>None</strong>
                  <span>Relationship healthy</span>
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Recent activity</div>
              {recent.length === 0 ? (
                <>
                  <strong>—</strong>
                  <span>No jobs yet</span>
                </>
              ) : (
                <ul className="fh-build-rail-list" style={{ marginTop: 10 }}>
                  {recent.map((j: any) => (
                    <li key={j.id}>
                      <span className="fh-build-rail-list__time">{relTime(j.updated_at || j.created_at)}</span>
                      <span className="fh-build-rail-list__title" title={j.name || ''}>{j.name || 'Untitled'}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="fh-build-rail-card">
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
                  <span className="fh-build-rel" style={{ display: 'block', padding: '6px 0' }}>
                    No contact info on file
                  </span>
                )}
              </div>
            </section>
          </aside>
        </section>
      </main>
    </div>
  )
}

