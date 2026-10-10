import { forwardRef, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { ChevronLeft, MoreHorizontal, Image as ImageIcon, Phone, MessageSquare, Navigation, Camera } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Button, Chip, Field, Icon, IconButton, OnyxStage, Row, Sheet, StageRail } from '../../../components/fh'
import { cx } from '../../../components/fh/cx.ts'
import { handleTablistKeyDown, tabId, tabPanelId } from '../../../lib/tabs.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { FOLLOW_UP_PRESETS, followUpMeta, localYmd } from '../../../lib/followUp.ts'
import type { FollowUpWhen } from '../../../lib/followUp.ts'
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
// JobSectionTabs (decision D5) and JobMoreSheet live here too.

function photoLabel(count: number) {
  return count === 1 ? '1 photo' : `${count} photos`
}

function mapsHref(address: string) {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`
}

export type JobHeaderPhoneProps = {
  contact: any
  photos: JobPhotos
  /** Contract, paid, balance and margin; null hides the strip (field roles). */
  money: JobMoney | null
  backLabel: string
  onBack: () => void
  /** Opens the job's action sheet; omit to hide the more button. */
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
                <dt>Balance</dt>
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
            <QuickAction icon={MessageSquare} label="Message" href={phone ? `sms:${phone}` : undefined} aria-label={phone ? `Message ${who}` : 'Message, no phone on file'} />
          </li>
          <li>
            <QuickAction
              icon={Navigation}
              label="Navigate"
              href={address ? mapsHref(address) : undefined}
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

/* The job's sections as text tabs with the gold underline (decision D5).
   Overview reads "Spine". Manual activation per lib/tabs.ts; the strip
   scrolls sideways and keeps the selected tab in view. */
export const JobSectionTabs = forwardRef<HTMLDivElement, {
  tabs: JobSectionTab[]
  value: string
  onChange: (id: string) => void
  idBase: string
}>(function JobSectionTabs({ tabs, value, onChange, idBase }, ref) {
  const stripRef = useRef<HTMLDivElement | null>(null)
  const selectedIndex = Math.max(0, tabs.findIndex((t) => t.id === value))

  useEffect(() => {
    const strip = stripRef.current
    if (!strip || strip.scrollWidth <= strip.clientWidth) return
    const tab = strip.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
    if (!tab) return
    const stripBox = strip.getBoundingClientRect()
    const tabBox = tab.getBoundingClientRect()
    if (tabBox.left < stripBox.left) strip.scrollLeft -= stripBox.left - tabBox.left + 20
    else if (tabBox.right > stripBox.right) strip.scrollLeft += tabBox.right - stripBox.right + 20
  }, [value])

  return (
    <div className="fhj-tabs" ref={ref}>
      <div
        ref={stripRef}
        className="fhj-tabs__strip"
        role="tablist"
        aria-label="Job sections"
        onKeyDown={handleTablistKeyDown}
      >
        {tabs.map((t, i) => {
          const active = t.id === value
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={tabId(idBase, t.id)}
              aria-selected={active}
              aria-controls={active ? tabPanelId(idBase, t.id) : undefined}
              tabIndex={i === selectedIndex ? 0 : -1}
              className={cx('fhj-tabs__tab', active && 'is-active')}
              onClick={() => { if (!active) { hapticTap(); onChange(t.id) } }}
            >
              {t.id === 'overview' ? 'Spine' : t.label}
            </button>
          )
        })}
      </div>
    </div>
  )
})

export type JobMoreAction = {
  id: string
  label: string
  subline?: string
  onSelect: () => void
}

/* The more button's sheet: the job's less frequent actions (edit, open
   the client, set a follow up, schedule, invite a partner, mark lost),
   with Delete set apart at the bottom. "Set follow up" shows the current
   date and opens its own choices in the same sheet: tomorrow, in 3 days,
   next week, a picked date, or clear. */
export function JobMoreSheet({ open, onOpenChange, title, actions, followUp, onDelete }: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  actions: JobMoreAction[]
  /** Offered on open work; omit on lost and closed jobs. */
  followUp?: { current: string | null; onSet: (when: FollowUpWhen) => void }
  onDelete?: () => void
}) {
  const [view, setView] = useState<'main' | 'followup'>('main')
  const [picked, setPicked] = useState('')
  const [pickError, setPickError] = useState('')
  const today = localYmd(new Date())

  // Every opening starts on the main list.
  useEffect(() => {
    if (!open) {
      setView('main')
      setPicked('')
      setPickError('')
    }
  }, [open])

  function run(fn: () => void) {
    onOpenChange(false)
    fn()
  }

  const current = followUp?.current ?? null
  const currentLabel = followUpMeta(current)?.label

  if (view === 'followup' && followUp) {
    return (
      <Sheet
        open={open}
        onOpenChange={onOpenChange}
        title="Set follow up"
        description={currentLabel}
        className="fhj-more-sheet"
        headerAction={
          <Button variant="quiet" size="mini" onClick={() => setView('main')}>Back</Button>
        }
      >
        <ul className="fhj-more-sheet__list">
          {FOLLOW_UP_PRESETS.map((p) => (
            <Row key={p.days} as="li" title={p.label} onClick={() => run(() => followUp.onSet(p.days))} />
          ))}
        </ul>
        <form
          className="fhj-more-sheet__pick"
          onSubmit={(e) => {
            e.preventDefault()
            const d = picked ? new Date(`${picked}T00:00:00`) : null
            if (!d || Number.isNaN(d.getTime())) {
              setPickError('Pick a date, then tap Set date.')
              return
            }
            run(() => followUp.onSet(d))
          }}
        >
          <Field
            label="Pick a date"
            type="date"
            min={today}
            value={picked}
            error={pickError || undefined}
            onChange={(e) => { setPicked(e.target.value); setPickError('') }}
          />
          <Button type="submit" variant="secondary" block>Set date</Button>
        </form>
        {current && (
          <div className="fhj-more-sheet__danger">
            <Button variant="quiet" block onClick={() => run(() => followUp.onSet(null))}>Clear follow up</Button>
          </div>
        )}
      </Sheet>
    )
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} className="fhj-more-sheet">
      <ul className="fhj-more-sheet__list">
        {actions.slice(0, 1).map((a) => (
          <Row key={a.id} as="li" title={a.label} subline={a.subline} onClick={() => run(a.onSelect)} />
        ))}
        {followUp && (
          <Row
            as="li"
            title="Set follow up"
            subline={currentLabel}
            onClick={() => setView('followup')}
          />
        )}
        {actions.slice(1).map((a) => (
          <Row key={a.id} as="li" title={a.label} subline={a.subline} onClick={() => run(a.onSelect)} />
        ))}
      </ul>
      {onDelete && (
        <div className="fhj-more-sheet__danger">
          <Button variant="destructive" block onClick={() => run(onDelete)}>Delete job</Button>
        </div>
      )}
    </Sheet>
  )
}
