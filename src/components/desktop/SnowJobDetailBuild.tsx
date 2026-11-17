// Light glass job workspace. Existing role-filtered sections and action handlers stay in the parent.
import type { ReactNode } from 'react'
import { ChevronLeft, MessageSquare, MoreHorizontal, Plus } from 'lucide-react'
import { Button, IconButton, StageRail } from '../fh/index.ts'
import type { StageRailProps } from '../fh/index.ts'
import { cx } from '../fh/cx.ts'
import { openCapture } from '../../lib/captureAttach.ts'
import { JobSectionTabs } from '../../screens/ContactDetail/phone/JobHeaderPhone.tsx'
import type { JobMoney } from '../../screens/ContactDetail/lib/spine.ts'
import JobFactsPanel from './JobFactsPanel.tsx'
import JobStatus from '../fh/JobStatus.tsx'
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
  /** Whether this viewer may delete the job; Delete lives on the More screen. */
  onDelete?: () => void
  /** Kept for callers; Delete asks for its second tap on the More screen. */
  deleteArmed?: boolean
  onAddEvent?: () => void
  /** The one gold action, following the stage (Send invoice, Approve quote, Reopen). */
  primaryAction?: { label: string; onClick: () => void } | null
  isEditing?: boolean
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

export default function SnowJobDetailBuild(props: Props) {
  const {
    contact, client, tabs, activeTab, onTabChange,
    onBack, backLabel = 'Jobs', onEdit, onDelete, onAddEvent,
    primaryAction, money, railNotes, crewIds = [],
    onInvitePartner, onOpenClient, scheduleStatus, changeOrderTotals,
    showMoney = true, children,
  } = props
  const title = String(contact?.job_title || contact?.name || 'Untitled job').trim()
  const subtitle = [contact?.job_title ? contact?.name : '', contact?.address || contact?.job_address].filter(Boolean).join(' · ')

  return (
    <div className="fh-build-page fh-build-detail fhd-page fh-job-workspace" data-build-screen="SnowJobDetailBuild">
      <div className="fh-build-main">
        <header className="fh-job-heading">
          <button type="button" className="fh-job-back" onClick={onBack} aria-label={`Back to ${backLabel.toLowerCase()}`}><ChevronLeft size={16} aria-hidden="true" />{backLabel}</button>
          <div className="fh-job-heading__row">
            <div className="fh-job-heading__identity"><div className="fh-job-heading__title"><h1>{title}</h1><JobStatus record={contact} /></div>{subtitle && <p>{subtitle}</p>}<TopbarWeather className="fh-job-weather" /></div>
            <div className="fh-job-heading__actions">
              <Button variant="primary" icon={Plus} onClick={() => openCapture({ jobId: contact.id })}>Add update</Button>
              {/* The job's More screen holds Edit, follow up and Delete (with
                  its second tap), the same route the phone uses (D57). */}
              {(onEdit || onDelete) && <IconButton variant="paper" icon={MoreHorizontal} aria-label="More actions for this job" to={`/jobs/${encodeURIComponent(contact.id)}/more`} />}
            </div>
          </div>
        </header>
        <div className="fh-job-toolbar">
          <JobSectionTabs tabs={tabs} value={activeTab} onChange={onTabChange} idBase="fh-job-tabs" />
        </div>
        <div className={cx('fh-job-columns', activeTab === 'overview' && 'fh-job-columns--overview')}>
          <div className="fhd-main">
            <div role="region" aria-label={`${tabs.find(item => item.id === activeTab)?.label || 'Job section'} workspace`} className="fhd-panel fh-build-detail-main">{children}</div>
          </div>
          <div className="fh-job-sidebar">
            <div className="fh-job-secondary-actions">
              <Button variant="secondary" icon={MessageSquare} to={`/compose?contact=${encodeURIComponent(contact.id)}&channel=${contact?.email || !contact?.phone ? 'email' : 'sms'}`}>Message</Button>
              {/* Not "Schedule": that is the section tab, which does something else. */}
              {onAddEvent && <Button variant="secondary" onClick={onAddEvent}>Add a visit</Button>}
              {primaryAction && <Button variant="secondary" onClick={primaryAction.onClick}>{primaryAction.label}</Button>}
            </div>
            <JobFactsPanel contact={contact} client={client} money={showMoney ? money ?? null : null} canSeeMoney={showMoney} tabs={tabs} crewIds={crewIds} scheduleLabel={scheduleStatus?.label ?? null} changeOrderTotals={showMoney ? changeOrderTotals ?? null : null} onOpenTab={onTabChange} onInvitePartner={onInvitePartner} onOpenClient={onOpenClient} onEdit={onEdit} />
            <details className="fh-job-lifecycle"><summary>Job lifecycle</summary><StageRail record={contact} notes={railNotes} aria-label="Stage" /></details>
          </div>
        </div>
      </div>
    </div>
  )
}
