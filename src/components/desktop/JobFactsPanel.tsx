// JobFactsPanel, the right column of the desktop Job page (spec 9.11,
// render glamor/g-desktop-job.jpg).
//
// A VaultCard for the balance, then Customer, Address, Crew, Documents and
// Shared with as hairline sections on plaster, never nested cards. The
// money (the vault card, the quote and invoices under Documents, change
// orders) reaches money roles only; crew and field roles get everything
// else. Sections never draw a blank: each has one quiet line for when
// there is nothing to show yet.
//
// Rows that lead somewhere are real buttons that open the section tab
// that holds the record, and are plain text when the job's stage does
// not offer that tab.

import type { ReactNode } from 'react'
import { Plus } from 'lucide-react'
import { Button, VaultCard } from '../fh/index.ts'
import type { VaultFact } from '../fh/index.ts'
import { initialsFor } from '../fh/Monogram.tsx'
import { moneyCents } from '../../lib/format.ts'
import type { JobMoney } from '../../screens/ContactDetail/lib/spine.ts'
import { documentRows, MAX_FILE_ROWS } from '../../screens/ContactDetail/lib/jobDesktop.ts'
import type { DocumentRow } from '../../screens/ContactDetail/lib/jobDesktop.ts'
import { useJobCrew, useJobDocumentSources, useJobPartners } from '../../screens/ContactDetail/hooks/useJobFacts.ts'
import './job-desktop.css'

export type JobFactsPanelProps = {
  contact: any
  /** The linked client record, when the viewer may read it. */
  client?: { name?: string | null } | null
  /** Contract, paid, balance and margin; null for field roles. */
  money: JobMoney | null
  canSeeMoney: boolean
  /** The section tabs this stage and role offer. */
  tabs: { id: string }[]
  /** Teammates assigned to open tasks and visits on this job. */
  crewIds: string[]
  /** "2 upcoming", drawn beside Crew when the job has a schedule. */
  scheduleLabel?: string | null
  changeOrderTotals?: { count: number; pending: number; approved: number; total: number } | null
  onOpenTab: (id: string) => void
  onInvitePartner?: () => void
  onOpenClient?: () => void
  onEdit?: () => void
}

const PRE_DEAL_LABEL: Record<string, string> = {
  lead: 'Estimated value',
  quote: 'Quote total',
  lost: 'Estimated value'
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  manager: 'Manager',
  foreman: 'Foreman',
  crew: 'Crew'
}

function mapsHref(address: string) {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`
}

/** "31.2% margin" reads "31.2%" beside the Margin label; "12.0% loss" keeps its word. */
function marginValue(label: string) {
  return label.replace(/ margin$/, '')
}

function Avatar({ name }: { name: string }) {
  return <span className="fhd-avatar" aria-hidden="true">{initialsFor(name)}</span>
}

function Section({ title, aside, children }: { title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section className="fhd-sec">
      <div className="fhd-sec__head">
        <h2 className="fhd-sec__title">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  )
}

export default function JobFactsPanel({
  contact, client, money, canSeeMoney, tabs, crewIds, scheduleLabel, changeOrderTotals,
  onOpenTab, onInvitePartner, onOpenClient, onEdit
}: JobFactsPanelProps) {
  const jobId: string | undefined = contact?.id
  const stage = String(contact?.stage || '').toLowerCase()
  const has = (id: string) => tabs.some((t) => t.id === id)

  const partners = useJobPartners(jobId)
  const sources = useJobDocumentSources(jobId, canSeeMoney)
  const crew = useJobCrew(crewIds)

  const documents = documentRows({
    contact,
    invoices: sources.invoices,
    files: sources.files,
    canSeeMoney,
    now: new Date()
  })
  const hasMoreFiles = sources.files.length > MAX_FILE_ROWS

  const customerName = String(contact?.name || client?.name || '').trim() || 'This customer'
  const phone = String(contact?.phone || '').trim()
  const email = String(contact?.email || '').trim()
  const referredBy = String(contact?.referred_by || '').trim()
  const address = String(contact?.address || contact?.job_address || '').trim()

  const preDealLabel = PRE_DEAL_LABEL[stage]
  const facts: VaultFact[] = money && !preDealLabel
    ? [
        { label: 'Contract', value: money.contract },
        { label: 'Paid', value: money.paid },
        ...(money.marginChip ? [{ label: 'Margin', value: marginValue(money.marginChip.label) }] : [])
      ]
    : []

  function docRow(row: DocumentRow) {
    const body = (
      <>
        <span className="fhd-doc__label">{row.label}</span>
        {row.detail && <span className="fhd-doc__detail">{row.detail}</span>}
      </>
    )
    return has(row.tab) ? (
      <li key={row.id}>
        <button type="button" className="fhd-doc fhd-doc--link" onClick={() => onOpenTab(row.tab)}>{body}</button>
      </li>
    ) : (
      <li key={row.id}><div className="fhd-doc">{body}</div></li>
    )
  }

  return (
    <aside className="fhd-facts" aria-label="Job facts">
      {money && (
        <VaultCard
          className="fhd-vault"
          as="div"
          label={preDealLabel ?? 'Balance'}
          amount={preDealLabel ? money.contract : money.balance}
          facts={facts}
          factsLayout="rows"
        />
      )}

      <Section title="Customer">
        <div className="fhd-person">
          <Avatar name={customerName} />
          <div className="fhd-person__text">
            {onOpenClient ? (
              <button type="button" className="fhd-link fhd-person__name" onClick={onOpenClient}>{customerName}</button>
            ) : (
              <p className="fhd-person__name">{customerName}</p>
            )}
            {phone && <a className="fhd-link fhd-person__line" href={`tel:${phone}`}>{phone}</a>}
            {email && <a className="fhd-link fhd-person__line" href={`mailto:${email}`}>{email}</a>}
          </div>
        </div>
        {!phone && !email && (
          <p className="fhd-empty">
            No contact details yet.{' '}
            {onEdit && <button type="button" className="fhd-link" onClick={onEdit}>Add contact details</button>}
          </p>
        )}
        {referredBy && (
          <dl className="fhd-pairs">
            <div><dt>Referred by</dt><dd>{referredBy}</dd></div>
          </dl>
        )}
      </Section>

      <Section title="Address">
        {address ? (
          <>
            <p className="fhd-text">{address}</p>
            <a className="fhd-link fhd-nav" href={mapsHref(address)} target="_blank" rel="noopener noreferrer">
              Navigate<span className="fhc-vh"> to {address}, opens in a new tab</span>
            </a>
          </>
        ) : (
          <p className="fhd-empty">
            No address yet.{' '}
            {onEdit && <button type="button" className="fhd-link" onClick={onEdit}>Add an address</button>}
          </p>
        )}
      </Section>

      <Section title="Crew" aside={scheduleLabel ? <span className="fhd-sec__aside">{scheduleLabel}</span> : undefined}>
        {crew.length > 0 ? (
          <ul className="fhd-list">
            {crew.map((m) => (
              <li key={m.id} className="fhd-person fhd-person--row">
                <Avatar name={m.name} />
                <span className="fhd-person__name">{m.name}</span>
                {m.role && <span className="fhd-person__role">{ROLE_LABEL[m.role] ?? m.role}</span>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="fhd-empty">No one is assigned yet.</p>
        )}
      </Section>

      {changeOrderTotals && canSeeMoney && (
        <Section title="Change orders">
          {has('change_orders') ? (
            <button type="button" className="fhd-doc fhd-doc--link" onClick={() => onOpenTab('change_orders')}>
              <span className="fhd-doc__label">{changeOrderTotals.count === 1 ? '1 change order' : `${changeOrderTotals.count} change orders`}</span>
              <span className="fhd-doc__detail">{moneyCents(changeOrderTotals.total)}</span>
            </button>
          ) : (
            <div className="fhd-doc">
              <span className="fhd-doc__label">{changeOrderTotals.count === 1 ? '1 change order' : `${changeOrderTotals.count} change orders`}</span>
              <span className="fhd-doc__detail">{moneyCents(changeOrderTotals.total)}</span>
            </div>
          )}
          {changeOrderTotals.pending !== 0 && (
            <p className="fhd-note">{moneyCents(changeOrderTotals.pending)} waiting on the customer</p>
          )}
        </Section>
      )}

      <Section title="Documents">
        {documents.length > 0 ? (
          <ul className="fhd-list">{documents.map(docRow)}</ul>
        ) : (
          <p className="fhd-empty">No documents yet.</p>
        )}
        {hasMoreFiles && has('files') && (
          <Button variant="quiet" size="mini" className="fhd-more" onClick={() => onOpenTab('files')}>All files</Button>
        )}
      </Section>

      <Section
        title="Shared with"
        aside={onInvitePartner ? (
          <Button variant="quiet" size="mini" icon={Plus} className="fhd-sec__action" onClick={onInvitePartner} aria-label="Invite a partner to this job">
            Invite
          </Button>
        ) : undefined}
      >
        {(partners.data ?? []).length > 0 ? (
          <ul className="fhd-list">
            {(partners.data ?? []).map((p) => {
              const name = p.partner_name?.trim() || p.partner_email
              return (
                <li key={p.id} className="fhd-person fhd-person--stack">
                  <Avatar name={name} />
                  <div className="fhd-person__text">
                    <p className="fhd-person__name">{name}</p>
                    <p className="fhd-person__line">
                      {[p.partner_role?.trim() || 'Partner', p.status === 'pending' ? 'invited, not accepted yet' : 'sees schedule, milestones and notes'].join(', ')}
                    </p>
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="fhd-empty">Not shared with anyone.</p>
        )}
      </Section>
    </aside>
  )
}
