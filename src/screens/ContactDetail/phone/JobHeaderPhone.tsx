import { forwardRef } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronLeft, MoreHorizontal, Image as ImageIcon, Phone, MessageSquare, Navigation, Camera } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Chip, Icon, IconButton, StageRail } from '../../../components/fh'
import { cx } from '../../../components/fh/cx.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { navigateHrefHere } from '../../../lib/todayView.ts'
import type { JobMoney } from '../lib/spine.ts'
import type { JobPhotos } from './SpineList.tsx'
import JobStatus from '../../../components/fh/JobStatus.tsx'
import './job-phone.css'

// Compact mobile identity with customer actions and role-filtered job details.
// Tasks, photography, and visits live in the shared overview below navigation.

function photoLabel(count: number) {
  return count === 1 ? '1 photo' : `${count} photos`
}

export type JobHeaderPhoneProps = {
  contact: any
  photos: JobPhotos
  /** Contract, paid, balance and margin; null hides the strip (field roles). */
  money: JobMoney | null
  backLabel: string
  onBack: () => void
  /** Opens the job's More screen; omit to hide the more button. */
  onMore?: () => void
  onOpenPhotos: () => void
}

export default function JobHeaderPhone({ contact, photos, money, backLabel, onBack, onMore, onOpenPhotos }: JobHeaderPhoneProps) {

  const name = String(contact?.name || '').trim()
  const title = String(contact?.job_title || '').trim() || name || 'Untitled job'
  const address = String(contact?.address || '').trim()
  const sub = [contact?.job_title ? name : '', address].filter(Boolean).join(', ')
  const phone = String(contact?.phone || '').trim()
  const who = name || 'this customer'

  const countButton = photos.count > 0 && (
    <button
      type="button"
      className="fhj-hero__count"
      onClick={() => { hapticTap(); onOpenPhotos() }}
    >
      <Icon icon={ImageIcon} size={18} />
      {photoLabel(photos.count)}
    </button>
  )

  return (
    <div className="fhj-head">
      <header className="fh-job-phone-heading">
        <div className="fh-job-phone-heading__bar">
          <button type="button" className="fh-job-back" onClick={onBack} aria-label={`Back to ${backLabel.toLowerCase()}`}><ChevronLeft size={17} aria-hidden="true" />{backLabel}</button>
          <JobStatus record={contact} />
          {onMore && <IconButton variant="paper" icon={MoreHorizontal} aria-label="More actions for this job" onClick={onMore} />}
        </div>
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </header>

      <details className="fhj-facts fh-job-contact-disclosure">
        <summary>Contact and job details<ChevronDown size={16} aria-hidden="true" /></summary>
        {countButton}
        <details className="fh-job-finance-disclosure">
          <summary>{money ? 'Job finances & status' : 'Job status'}<ChevronDown size={16} aria-hidden="true" /></summary>
          <StageRail record={contact} aria-label="Stage" className="fhj-rail" />

        {money && (
          <div className="fhj-money">
            <dl className="fhj-money__list">
              <div className="fhj-money__item">
                <dt>Contract</dt>
                <dd>{money.contract}</dd>
              </div>
              <div className="fhj-money__item">
                <dt>Paid</dt>
                <dd>{money.paid}</dd>
              </div>
              <div className="fhj-money__item">
                <dt>Contract balance</dt>
                <dd>{money.balance}</dd>
              </div>
            </dl>
            {money.marginChip && (
              <Chip className="fhj-money__chip" tone={money.marginChip.tone} label={money.marginChip.label} />
            )}
          </div>
        )}

        </details>

        <ul className="fhj-quick" aria-label="Quick actions">
          <li>
            <QuickAction icon={Phone} label="Call" href={phone ? `tel:${phone}` : undefined} aria-label={phone ? `Call ${who}` : 'Call, no phone on file'} />
          </li>
          <li>
            <QuickAction icon={MessageSquare} label="Message" href={`/compose?contact=${encodeURIComponent(contact.id)}&channel=${contact?.email || !phone ? 'email' : 'sms'}`} aria-label={`Message ${who}`} />
          </li>
          <li>
            <QuickAction
              icon={Navigation}
              label="Navigate"
              href={address ? navigateHrefHere(address) : undefined}
              external
              aria-label={address ? `Navigate to ${address}` : 'Navigate, no address on file'}
            />
          </li>
          <li>
            <QuickAction
              icon={Camera}
              label={photos.count > 0 ? `Photos ${photos.count}` : 'Photos'}
              onClick={onOpenPhotos}
              aria-label={photos.count > 0 ? `Open ${photoLabel(photos.count)}` : 'Open photos'}
            />
          </li>
        </ul>
      </details>
    </div>
  )
}

/* A 48 px round paper disc with its label under it; the whole column is
   the control. A link for tel, sms and maps, a button otherwise, and a
   disabled button when there is nothing to call or find. */
function QuickAction({ icon, label, href, external, onClick, 'aria-label': ariaLabel }: {
  icon: LucideIcon
  label: string
  href?: string
  external?: boolean
  onClick?: () => void
  'aria-label': string
}) {
  const body = (
    <>
      <span className="fhj-quick__disc" aria-hidden="true"><Icon icon={icon} size={22} /></span>
      <span className="fhj-quick__label" aria-hidden="true">{label}</span>
    </>
  )
  if (href?.startsWith('/')) {
    return <Link className="fhj-quick__action" to={href} aria-label={ariaLabel} onClick={() => hapticTap()}>{body}</Link>
  }
  if (href) {
    return (
      <a
        className="fhj-quick__action"
        href={href}
        aria-label={ariaLabel}
        onClick={() => hapticTap()}
        {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
      >
        {body}
      </a>
    )
  }
  return (
    <button
      type="button"
      className="fhj-quick__action"
      aria-label={ariaLabel}
      disabled={!onClick}
      onClick={() => { hapticTap(); onClick?.() }}
    >
      {body}
    </button>
  )
}

export type JobSectionTab = { id: string; label: string }

const SECTION_GROUPS = [
  { label: 'Progress', ids: ['overview', 'logs'] },
  { label: 'Work plan', ids: ['details', 'tasks', 'schedule', 'inspections', 'selections', 'materials'] },
  { label: 'Money', ids: ['financials', 'draws', 'expenses', 'subs', 'change_orders', 'insurance'] },
  { label: 'Documents and people', ids: ['files', 'documents', 'messages', 'partner'] }
]

/** Every destination is one choice away. No nested tab state to reset. */
export const JobSectionTabs = forwardRef<HTMLDivElement, {
  tabs: JobSectionTab[]
  value: string
  onChange: (id: string) => void
  idBase: string
}>(function JobSectionTabs({ tabs, value, onChange, idBase }, ref) {
  const groups = SECTION_GROUPS.map(group => ({ ...group, tabs: tabs.filter(tab => group.ids.includes(tab.id)) })).filter(group => group.tabs.length)
  const shortcuts = tabs.filter(tab => ['overview', 'tasks', 'schedule'].includes(tab.id))
  const inShortcuts = shortcuts.some(tab => tab.id === value)
  return (
    <div className="fh-job-sections" ref={ref}>
      <label className={cx('fh-job-sections__picker', !inShortcuts && 'is-active')} htmlFor={`${idBase}-select`}>
        <span className="fhc-vh">Job section</span>
        <span className="fh-job-sections__current" aria-hidden="true">{inShortcuts ? 'All tools' : tabs.find(tab => tab.id === value)?.label || 'All tools'}</span>
        <ChevronDown size={15} aria-hidden="true" />
        <select id={`${idBase}-select`} aria-label="Job section" value={value} title="All job sections" onChange={event => { hapticTap(); onChange(event.target.value) }}>
          {groups.map(group => <optgroup key={group.label} label={group.label}>
            {group.tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
          </optgroup>)}
        </select>
      </label>
      <nav className="fh-job-sections__shortcuts" aria-label="Job shortcuts">
        {shortcuts.map(tab => <button key={tab.id} type="button" aria-current={value === tab.id ? 'page' : undefined}
          className={cx('fh-job-sections__link', value === tab.id && 'is-active')}
          onClick={() => { hapticTap(); onChange(tab.id) }}>{tab.label}</button>)}
      </nav>
    </div>
  )
})
