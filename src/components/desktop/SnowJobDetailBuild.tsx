// SnowJobDetailBuild, desktop chrome for /jobs/:id (spec 9.11, render
// glamor/g-desktop-job.jpg).
//
// Top to bottom: the photo banner (the newest job photo, or onyx alone)
// with the title, client and address and the actions; the full width stage
// rail with a note under each segment; then two columns. Left, a composer
// row that opens Capture on this job, the section tabs (Overview reads
// "Spine") and the open tab's content. Right, the facts panel.
//
// Presentational. Receives the existing tab content (Overview, Quote,
// Details, Financials, Files and the rest) as children. Forms, edit and
// save, invoice generation, quote acceptance, partner invite and notes
// capture all stay in the parent. The composer only opens Capture, which
// proposes and waits for the person's confirm, so nothing here writes.
//
// The old rail cards (job health, schedule, reports, billing, change
// orders) are replaced by what the render draws: schedule and balance are
// rail notes, billing is the Balance card, change orders are a facts
// section, and the health score and next action stay in the Spine tab's
// "More about this job". The props that fed them are still accepted.

import { useState } from 'react'
import type { ReactNode } from 'react'
import { Bell, ChevronLeft, MessageSquare, Pencil, Plus, Trash2 } from 'lucide-react'
import { Button, IconButton, OnyxStage, StageRail } from '../fh/index.ts'
import type { StageRailProps } from '../fh/index.ts'
import { cx } from '../fh/cx.ts'
import { initialsFor } from '../fh/Monogram.tsx'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { openCapture } from '../../lib/captureAttach.ts'
import { tabPanelProps } from '../../lib/tabs.ts'
import { JobSectionTabs } from '../../screens/ContactDetail/phone/JobHeaderPhone.tsx'
import type { JobMoney } from '../../screens/ContactDetail/lib/spine.ts'
import JobFactsPanel from './JobFactsPanel.tsx'
import TopbarWeather from './TopbarWeather.tsx'
import './job-desktop.css'

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
  /** The one gold action, following the stage (Send invoice, Approve quote, Reopen). */
  primaryAction?: { label: string; onClick: () => void } | null
  isEditing?: boolean
  /** The newest job photo that signed. Null or a photo that will not load leaves the onyx band. */
  coverUrl?: string | null
  coverAlt?: string
  /** Contract, paid, balance and margin, for money roles only; null hides the Balance card. */
  money?: JobMoney | null
  /** One short note per stage rail segment (lib/jobDesktop.ts railNotes). */
  railNotes?: StageRailProps['notes']
  /** Teammates assigned to open tasks and visits on this job. */
  crewIds?: string[]
  onInvitePartner?: () => void
  onOpenClient?: () => void
  // Derived signals, null when a field is not tracked yet.
  scheduleStatus?: { label: string; tone: 'good' | 'warn' | 'bad' } | null
  // Kept for callers; the redesigned page no longer draws these as cards.
  reportsMissing?: number | null
  billingStatus?: { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } | null
  health?: { score: number; tier: string; label: string } | null
  paid?: number | null
  outstanding?: number | null
  changeOrderTotals?: { count: number; pending: number; approved: number; total: number } | null
  // False for crew and foreman: the Balance card, quote, invoices and
  // change orders are hidden rather than rendered blank.
  showMoney?: boolean
  children: ReactNode
}

function mailOrSms(contact: any): { href: string } | null {
  const phone = String(contact?.phone || '').trim()
  if (phone) return { href: `sms:${phone}` }
  const email = String(contact?.email || '').trim()
  if (email) return { href: `mailto:${email}` }
  return null
}

export default function SnowJobDetailBuild(props: Props) {
  const {
    contact, client, tabs, activeTab, onTabChange,
    onBack, backLabel = 'Jobs', onEdit, onDelete, onAddEvent,
    primaryAction, isEditing,
    coverUrl, coverAlt, money, railNotes, crewIds = [],
    onInvitePartner, onOpenClient,
    scheduleStatus, changeOrderTotals,
    showMoney = true,
    children,
  } = props

  const { profile } = useProfile()
  // The cover that failed to load, and the one that has. Keyed by url so a
  // newer photo is tried again.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const hasPhoto = !!coverUrl && coverUrl !== failedSrc

  const name = String(contact?.name || '').trim()
  const jobTitle = String(contact?.job_title || '').trim()
  const title = jobTitle || name || 'Untitled job'
  const address = String(contact?.address || contact?.job_address || '').trim()
  const sub = [jobTitle ? name : '', address].filter(Boolean).join(', ')
  const message = mailOrSms(contact)
  const who = name || 'this customer'

  const wide = activeTab === 'quote'
  const me = String((profile as any)?.full_name || '').trim()

  return (
    <div className="fh-build-page fh-build-detail fhd-page" data-build-screen="SnowJobDetailBuild">
      <main className="fh-build-main">
        <OnyxStage as="header" hairline={false} className={cx('fhd-banner', hasPhoto && 'has-photo')}>
          {hasPhoto && (
            <div className="fhd-banner__photo">
              <img
                className={cx('fhd-banner__img', loadedSrc === coverUrl && 'is-loaded')}
                src={coverUrl as string}
                alt={coverAlt || 'Newest job photo'}
                decoding="async"
                onLoad={() => setLoadedSrc(coverUrl as string)}
                onError={() => setFailedSrc(coverUrl as string)}
              />
            </div>
          )}

          <div className="fhd-banner__util">
            <span className="fhd-weather"><TopbarWeather /></span>
            <IconButton
              variant="onyx"
              size={44}
              icon={Bell}
              aria-label="Open activity"
              onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))}
            />
            {onEdit && (
              <IconButton
                variant="onyx"
                size={44}
                icon={Pencil}
                aria-label={isEditing ? 'Stop editing' : 'Edit job details'}
                aria-pressed={isEditing ? true : undefined}
                onClick={onEdit}
              />
            )}
            {onDelete && (
              <IconButton variant="onyx" size={44} icon={Trash2} aria-label="Delete this job" onClick={onDelete} />
            )}
          </div>

          <div className="fhd-banner__body">
            <div className="fhd-banner__text">
              <button
                type="button"
                className="fhd-back"
                onClick={onBack}
                aria-label={`Back to ${backLabel.toLowerCase()}`}
              >
                <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
                {backLabel}
              </button>
              <h1 className="fhd-banner__title">{title}</h1>
              {sub && <p className="fhd-banner__sub">{sub}</p>}
            </div>

            <div className="fhd-banner__actions">
              {message ? (
                <Button variant="secondary" icon={MessageSquare} href={message.href} aria-label={`Message ${who}`}>
                  Message
                </Button>
              ) : (
                <Button variant="secondary" icon={MessageSquare} disabled aria-label="Message, no phone or email on file">
                  Message
                </Button>
              )}
              {onAddEvent && (
                <Button variant="secondary" onClick={onAddEvent}>Schedule</Button>
              )}
              {primaryAction && (
                <Button variant="primary" onClick={primaryAction.onClick}>{primaryAction.label}</Button>
              )}
            </div>
          </div>
        </OnyxStage>

        <StageRail record={contact} notes={railNotes} aria-label="Stage" className="fhd-rail" />

        <div className={cx('fhd-grid', wide && 'is-wide')}>
          <div className="fhd-main">
            <button
              type="button"
              className="fhd-composer"
              onClick={() => openCapture({ jobId: contact?.id })}
            >
              <span className="fhd-avatar" aria-hidden="true">{me ? initialsFor(me) : <Plus size={18} strokeWidth={1.75} />}</span>
              <span className="fhd-composer__hint">Add a note, photos or a task to this job</span>
              <span className="fhd-composer__pill" aria-hidden="true">Add</span>
            </button>

            {tabs.length > 0 && (
              <JobSectionTabs tabs={tabs} value={activeTab} onChange={onTabChange} idBase="fh-job-tabs" />
            )}

            <div {...tabPanelProps('fh-job-tabs', activeTab)} className="fhd-panel fh-build-detail-main">
              {children}
            </div>
          </div>

          {!wide && (
            <JobFactsPanel
              contact={contact}
              client={client}
              money={showMoney ? money ?? null : null}
              canSeeMoney={showMoney}
              tabs={tabs}
              crewIds={crewIds}
              scheduleLabel={scheduleStatus?.label ?? null}
              changeOrderTotals={showMoney ? changeOrderTotals ?? null : null}
              onOpenTab={onTabChange}
              onInvitePartner={onInvitePartner}
              onOpenClient={onOpenClient}
              onEdit={onEdit}
            />
          )}
        </div>
      </main>
    </div>
  )
}
