import { forwardRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, MoreHorizontal, Image as ImageIcon, Phone, MessageSquare, Navigation, Camera } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Chip, Icon, IconButton, OnyxStage, StageRail } from '../../../components/fh'
import { cx } from '../../../components/fh/cx.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { navigateHrefHere } from '../../../lib/todayView.ts'
import type { JobMoney } from '../lib/spine.ts'
import type { JobPhotos } from './SpineList.tsx'
import './job-phone.css'

// The top of the Job page on a phone (spec 9.4, render glamor/g-job.jpg):
//
// 1. The newest job photo, full bleed under the status bar, fading into
//    the onyx band. With no photo, or one that fails to sign or load,
//    the band stands alone with the same text and no image box.
// 2. The band: job title in Barlow Condensed, then the client and the
//    address in smoke, closed by the gold hairline.
// 3. The stage rail (a lost job shows the neutral Lost chip).
// 4. The money strip, for money roles only.
// 5. Quick actions: Call, Message, Navigate, Photos.
//
// JobSectionTabs (decision D5) lives here too. The more button opens the
// job's More screen, /jobs/:id/more (Phase 9, Task 13, D57).

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
  const cover = photos.cover
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null)
  const hasPhoto = !!cover && cover.url !== failedSrc

  const name = String(contact?.name || '').trim()
  const title = String(contact?.job_title || '').trim() || name || 'Untitled job'
  const address = String(contact?.address || '').trim()
  const sub = [contact?.job_title ? name : '', address].filter(Boolean).join(', ')
  const phone = String(contact?.phone || '').trim()
  const who = name || 'this customer'

  const countButton = photos.count > 0 && (
    <button
      type="button"
      className={cx('fhj-hero__count', hasPhoto && 'is-on-photo')}
      onClick={() => { hapticTap(); onOpenPhotos() }}
    >
      <Icon icon={ImageIcon} size={18} />
      {photoLabel(photos.count)}
    </button>
  )

  return (
    <div className="fhj-head">
      <OnyxStage as="header" className={cx('fhj-hero', hasPhoto && 'has-photo')}>
        {hasPhoto && (
          <div className="fhj-hero__photo">
            <img
              className={cx('fhj-hero__img', loadedSrc === cover.url && 'is-loaded')}
              src={cover.url}
              alt={cover.alt}
              decoding="async"
              onLoad={() => setLoadedSrc(cover.url)}
              onError={() => setFailedSrc(cover.url)}
            />
            {countButton}
          </div>
        )}

        <div className="fhj-hero__bar">
          <IconButton variant="onyx" icon={ChevronLeft} aria-label={`Back to ${backLabel.toLowerCase()}`} onClick={onBack} />
          <div className="fhj-hero__bar-end">
            {!hasPhoto && countButton}
            {onMore && <IconButton variant="onyx" icon={MoreHorizontal} aria-label="More actions for this job" onClick={onMore} />}
          </div>
        </div>

        <div className="fhj-hero__band">
          <h1 className="fhj-hero__title">{title}</h1>
          {sub && <p className="fhj-hero__sub">{sub}</p>}
        </div>
      </OnyxStage>

      <div className="fhj-facts">
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
      </div>
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
  return (
    <div className="fh-job-sections" ref={ref}>
      <label className="fh-job-sections__picker" htmlFor={`${idBase}-select`}>
        Job section
        <select id={`${idBase}-select`} value={value} onChange={event => { hapticTap(); onChange(event.target.value) }}>
          {groups.map(group => <optgroup key={group.label} label={group.label}>
            {group.tabs.map(tab => <option key={tab.id} value={tab.id}>{tab.label}</option>)}
          </optgroup>)}
        </select>
      </label>
      <nav className="fh-job-sections__shortcuts" aria-label="Job shortcuts">
        {tabs.filter(tab => ['overview', 'tasks', 'schedule', 'draws', 'files'].includes(tab.id)).map(tab => <button key={tab.id} type="button" aria-current={value === tab.id ? 'page' : undefined}
          className={cx('fh-job-sections__link', value === tab.id && 'is-active')}
          onClick={() => { hapticTap(); onChange(tab.id) }}>{tab.label}</button>)}
      </nav>
    </div>
  )
})
