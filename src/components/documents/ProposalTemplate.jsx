// src/components/documents/ProposalTemplate.jsx
//
// Customer-facing HTML preview of a contractor proposal. Composes the
// shared document primitives in the spec order:
//
//   1. Cover / header              (handled by DocumentShell)
//   2. Project overview            (boilerplate + project address)
//   3. Scope of work               (ScopeSectionCard × N, no pricing)
//   4. Materials                   (ScopeSectionCard with bullets)
//   5. Optional upgrades           (ScopeSectionCard with showPricing)
//   6. Pricing summary             (PricingSummaryCard)
//   7. Payment terms               (PaymentTermsBlock)
//   8. Warranty                    (paragraph block)
//   9. Exclusions                  (bullet list)
//  10. Insurance (optional)        (InsuranceModeBlock — auto-hides)
//  11. Approval / signature        (ApprovalBlock)
//
// Pure presentation: this component does not read Supabase or compute
// totals. The parent screen (Quote tab / preview pane) gathers + maps
// data and hands it down as props.

import DocumentShell from './DocumentShell.jsx'
import SectionHeading from './SectionHeading.jsx'
import ScopeSectionCard from './ScopeSectionCard.jsx'
import PricingSummaryCard from './PricingSummaryCard.jsx'
import PaymentTermsBlock, { DEFAULT_PAYMENT_SCHEDULE } from './PaymentTermsBlock.jsx'
import ApprovalBlock from './ApprovalBlock.jsx'
import InsuranceModeBlock from './InsuranceModeBlock.jsx'
import ChangeOrdersBlock from './ChangeOrdersBlock.jsx'
import { DOC_COLORS, typeStyle, resolveBrandGold } from './tokens.js'
import { longDate, cityState } from './format.js'
import { proposalNumber } from './numbers.js'

/**
 * @param {object}   props
 * @param {object}   props.company         (see DocumentShell)
 * @param {object}   props.contact         { name, address, phone, email, job_title }
 * @param {object}   props.project         { title, address, snapshot? }
 * @param {Array}    props.scopeSections   [{ id, title, description, bullets?,
 *                                              items?, photos?, internalNote? }]
 * @param {Array}    [props.upgrades]      optional [{ title, description, items, ... }]
 *                                          rendered separately with showPricing=true
 * @param {object}   props.pricing         { baseTotal, upgradeTotal, discount, taxRate }
 * @param {Array}    [props.paymentSchedule] override DEFAULT_PAYMENT_SCHEDULE
 * @param {string}   [props.warrantyText]
 * @param {Array}    [props.exclusions]    array of strings (bullets)
 * @param {object}   [props.insurance]     forwarded to InsuranceModeBlock
 * @param {object}   [props.approval]      { mode, clientName, clientSignatureDataUrl,
 *                                            clientApprovedAt, contractorSignatureDataUrl,
 *                                            contractorApprovedAt }
 * @param {object}   [props.meta]          { issuedAt, expiresAt, number } — number derived
 *                                          from company name + contact.id when not provided
 * @param {string}   [props.status]        'draft' | 'sent' | 'approved' | 'expired'
 * @param {boolean}  [props.showInternalNotes=false]  forward to scope cards
 */
export default function ProposalTemplate({
  company = {},
  contact = {},
  project,
  scopeSections = [],
  upgrades = [],
  pricing = { baseTotal: 0, upgradeTotal: 0, discount: 0, taxRate: 0 },
  paymentSchedule = DEFAULT_PAYMENT_SCHEDULE,
  warrantyText,
  exclusions = [],
  insurance = null,
  changeOrders = [],
  approval = null,
  meta = {},
  status = 'draft',
  showInternalNotes = false
}) {
  const gold = resolveBrandGold(company)

  const number = meta.number || proposalNumber(company?.name, contact?.id)
  const issuedAt = meta.issuedAt || new Date()
  const expiresAt = meta.expiresAt || null
  const resolvedProject = project || {
    title: contact?.job_title || 'Construction services',
    address: contact?.address || ''
  }

  const overviewCopy = buildOverviewCopy(company?.name, resolvedProject.address)

  const total = computeTotal(pricing)

  return (
    <DocumentShell
      company={company}
      docTypeEyebrow="PROPOSAL"
      title={resolvedProject.title}
      project={resolvedProject}
      status={statusPill(status, gold)}
      metaCols={[
        { label: 'CLIENT',        value: contact?.name || '—' },
        { label: 'ISSUED',        value: longDate(issuedAt) },
        { label: 'VALID UNTIL',   value: expiresAt ? longDate(expiresAt) : 'Open' },
        { label: 'PROPOSAL #',    value: number, accent: true }
      ]}
    >
      {/* ─── 2. Project overview ──────────────────────── */}
      <section style={{ breakInside: 'avoid' }}>
        <SectionHeading
          company={company}
          eyebrow="Project overview"
          title="What we'll build"
        />
        <p
          style={{
            ...typeStyle('body'),
            color: DOC_COLORS.inkMid,
            margin: 0,
            maxWidth: '64ch'
          }}
        >
          {overviewCopy}
        </p>
      </section>

      {/* ─── 3 + 4. Scope of work (incl. materials cards) ─── */}
      {scopeSections.length > 0 && (
        <section>
          <SectionHeading
            company={company}
            eyebrow="Scope of work"
            title="Trades and materials"
            meta={`${scopeSections.length} section${scopeSections.length === 1 ? '' : 's'}`}
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {scopeSections.map((s) => (
              <ScopeSectionCard
                key={s.id || s.title}
                title={s.title}
                description={s.description}
                bullets={s.bullets}
                items={s.items}
                photos={s.photos}
                internalNote={s.internalNote}
                showPricing={false}
                showInternalNotes={showInternalNotes}
              />
            ))}
          </div>
        </section>
      )}

      {/* ─── 5. Optional upgrades ───────────────────────── */}
      {upgrades.length > 0 && (
        <section>
          <SectionHeading
            company={company}
            eyebrow="Optional upgrades"
            title="Add at any time"
          />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {upgrades.map((u) => (
              <ScopeSectionCard
                key={u.id || u.title}
                title={u.title}
                description={u.description}
                bullets={u.bullets}
                items={u.items}
                photos={u.photos}
                internalNote={u.internalNote}
                showPricing={true}
                showInternalNotes={showInternalNotes}
              />
            ))}
          </div>
        </section>
      )}

      {/* ─── Change orders (when present, before pricing so the
              customer sees what got added before the final number) ─── */}
      {(changeOrders || []).filter((co) => co?.status !== 'void').length > 0 && (
        <section>
          <SectionHeading
            company={company}
            eyebrow="Change orders"
            title="Contract amendments"
            meta={`${(changeOrders || []).filter((co) => co?.status !== 'void').length} order${changeOrders.length === 1 ? '' : 's'}`}
          />
          <ChangeOrdersBlock changeOrders={changeOrders} company={company} />
        </section>
      )}

      {/* ─── 6. Pricing summary ─────────────────────────── */}
      <section>
        <SectionHeading
          company={company}
          eyebrow="Pricing summary"
          title="Investment"
        />
        <PricingSummaryCard
          company={company}
          baseTotal={pricing.baseTotal}
          upgradeTotal={pricing.upgradeTotal}
          discount={pricing.discount}
          taxRate={pricing.taxRate}
          heroLabel="Project investment"
        />
      </section>

      {/* ─── 7. Payment terms ───────────────────────────── */}
      <section>
        <SectionHeading
          company={company}
          eyebrow="Payment terms"
          title="Milestone schedule"
        />
        <PaymentTermsBlock
          total={total}
          schedule={paymentSchedule}
          company={company}
        />
      </section>

      {/* ─── 8. Warranty ────────────────────────────────── */}
      {warrantyText && (
        <section style={{ breakInside: 'avoid' }}>
          <SectionHeading company={company} eyebrow="Warranty" title="What we stand behind" />
          <p
            style={{
              ...typeStyle('body'),
              color: DOC_COLORS.inkMid,
              margin: 0,
              whiteSpace: 'pre-wrap',
              maxWidth: '64ch'
            }}
          >
            {warrantyText}
          </p>
        </section>
      )}

      {/* ─── 9. Exclusions ──────────────────────────────── */}
      {exclusions.length > 0 && (
        <section style={{ breakInside: 'avoid' }}>
          <SectionHeading company={company} eyebrow="Exclusions" title="Not included in this proposal" />
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              margin: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: 6
            }}
          >
            {exclusions.map((x, i) => (
              <li
                key={i}
                style={{
                  ...typeStyle('body'),
                  color: DOC_COLORS.inkMid,
                  display: 'grid',
                  gridTemplateColumns: '14px 1fr',
                  gap: 8,
                  alignItems: 'baseline'
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    display: 'inline-block',
                    width: 4,
                    height: 4,
                    borderRadius: '50%',
                    background: DOC_COLORS.inkMuted,
                    marginTop: 6
                  }}
                />
                <span>{x}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ─── 10. Insurance mode (optional) ──────────────── */}
      <InsuranceModeBlock insurance={insurance} company={company} />

      {/* ─── 11. Approval / signature ───────────────────── */}
      <section>
        <SectionHeading company={company} eyebrow="Approval" title="Authorization to proceed" />
        <ApprovalBlock
          company={company}
          contractorName={company?.name}
          mode={approval?.mode || 'blank'}
          clientName={approval?.clientName || contact?.name}
          clientSignatureDataUrl={approval?.clientSignatureDataUrl}
          clientApprovedAt={approval?.clientApprovedAt}
          contractorSignatureDataUrl={approval?.contractorSignatureDataUrl}
          contractorApprovedAt={approval?.contractorApprovedAt}
        />
      </section>
    </DocumentShell>
  )
}

function buildOverviewCopy(companyName, address) {
  const c = (companyName && String(companyName).trim()) || 'Our company'
  const a = (address && String(address).trim()) || 'the project site'
  return `${c} proposes the following scope of work for the improvement and restoration of the property located at ${a}. Our team will provide labor, materials, project coordination, site protection, cleanup, and installation services necessary to complete the project in accordance with manufacturer standards and applicable code requirements.`
}

function computeTotal({ baseTotal = 0, upgradeTotal = 0, discount = 0, taxRate = 0 }) {
  const base = Number(baseTotal || 0)
  const up = Number(upgradeTotal || 0)
  const disc = Math.max(0, Number(discount || 0))
  const preTax = Math.max(0, base + up - disc)
  return preTax + preTax * Number(taxRate || 0)
}

function statusPill(status, gold) {
  switch (status) {
    case 'approved': return { label: 'APPROVED', tone: 'green' }
    case 'expired':  return { label: 'EXPIRED',  tone: 'red' }
    case 'sent':     return { label: 'SENT',     tone: 'gold' }
    case 'draft':
    default:         return { label: 'DRAFT',    tone: 'slate' }
  }
}
