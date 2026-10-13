// JobFactsStrip, the job's facts at a glance on a desktop window below
// 1280 px, where the facts panel (JobFactsPanel) drops under the whole
// Spine: the balance, the customer's phone and the address with Navigate,
// in one hairline strip above the composer (PHASE8_PLAN.md Task 14). Its
// styles live with the job page's, in job-desktop.css.

import { navigateHrefHere } from '../../lib/todayView.ts'
import type { JobMoney } from '../../screens/ContactDetail/lib/spine.ts'
import { PRE_DEAL_LABEL } from './JobFactsPanel.tsx'
import './job-desktop.css'

/**
 * The facts reached for first, as one hairline strip on plaster: the
 * balance (money roles only, labeled as the facts panel labels it), the
 * customer's phone and the address with Navigate. The job page shows it
 * above the composer below 1280 px.
 */
export default function JobFactsStrip({ contact, client, money }: {
  contact: any
  client?: { name?: string | null } | null
  /** Null for field roles, who see no money. */
  money: JobMoney | null
}) {
  const stage = String(contact?.stage || '').toLowerCase()
  const preDealLabel = PRE_DEAL_LABEL[stage]
  const customerName = String(contact?.name || client?.name || '').trim() || 'the customer'
  const phone = String(contact?.phone || '').trim()
  const address = String(contact?.address || contact?.job_address || '').trim()

  return (
    <section className="fhd-strip" aria-label="Job at a glance">
      <dl className="fhd-strip__list">
        {money && (
          <div className="fhd-strip__fact">
            <dt>{preDealLabel ?? 'Balance'}</dt>
            <dd className="fhd-strip__money">{preDealLabel ? money.contract : money.balance}</dd>
          </div>
        )}
        <div className="fhd-strip__fact">
          <dt>Phone</dt>
          <dd>
            {phone ? (
              <a className="fhd-link" href={`tel:${phone}`} aria-label={`Call ${customerName}, ${phone}`}>{phone}</a>
            ) : (
              <span className="fhd-strip__none">No phone yet</span>
            )}
          </dd>
        </div>
        <div className="fhd-strip__fact fhd-strip__fact--address">
          <dt>Address</dt>
          <dd>
            {address ? (
              <>
                <span className="fhd-strip__text">{address}</span>
                <a className="fhd-link fhd-strip__nav" href={navigateHrefHere(address)} target="_blank" rel="noopener noreferrer">
                  Navigate<span className="fhc-vh"> to {address}, opens in a new tab</span>
                </a>
              </>
            ) : (
              <span className="fhd-strip__none">No address yet</span>
            )}
          </dd>
        </div>
      </dl>
    </section>
  )
}
