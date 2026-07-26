// src/components/documents/InvoiceTemplate.tsx
//
// Customer-facing HTML preview of a contractor invoice, built to the
// standard of the best SaaS invoices (Stripe/Ramp): the amount due and
// due date are the first thing on the page, the billing schedule shows
// every draw with its paid/due status, and the contract position
// (total → changes → paid → balance) reconciles in one place.
//
// Composes:
//   1. DocumentShell       (letterhead + real invoice number + dates)
//   2. Hero band           (AMOUNT DUE · due date · collection progress)
//   3. Line items          (only when real items exist — no filler table)
//   4. Billing schedule    (fh_invoices draws w/ PAID/DUE, current row marked)
//   5. Contract position   (contract → change orders → paid → balance)
//   6. Payment history     (every payment: date, method, reference)
//   7. How to pay          (instructions + terms)
//   8. Insurance / photos  (when present)
//   9. Disclaimer footer

import DocumentShell from './DocumentShell.tsx'
import LineItemsTable from './LineItemsTable.tsx'
import PaymentHistoryBlock from './PaymentHistoryBlock.tsx'
import InsuranceModeBlock from './InsuranceModeBlock.tsx'
import ChangeOrdersBlock from './ChangeOrdersBlock.tsx'
import { DOC_COLORS, DOC_FONTS, resolveBrandGold } from './tokens.ts'
import { money, longDate, shortDate } from './format.ts'
import { parseDateOnly } from '../../lib/dates.ts'
import { invoiceNumber, invoiceNumberFromSequence } from './numbers.ts'

const DEFAULT_PAYMENT_COPY = 'Please remit payment by the due date above. Payments are applied to the project balance.'
const DEFAULT_DISCLAIMER = 'Pricing covers labor, material, standard equipment, placement, finishing, and cleanup for the scope as billed. Hidden conditions, field changes, or scope deviations may require a separate change order. Past-due balances may accrue at 1.5% per month.'

export default function InvoiceTemplate({
  company = {},
  contact = {},
  project,
  lineItems,
  contractTotal = 0,
  payments = [],
  previouslyPaid,
  thisInvoice,
  balanceRemaining,
  taxRate = 0,
  meta = {},
  status = 'outstanding',
  notes,
  insurance = null,
  changeOrders = [],
  invoices = [],          // fh_invoices draw rows — billing schedule
  currentInvoice = null,  // the fh_invoices row this document bills
  photos = []
}: any) {
  const issuedAt = meta.issuedAt || currentInvoice?.issued_at || new Date()
  const number = meta.number
    || (currentInvoice?.sequence_number
      ? invoiceNumberFromSequence(company?.name, currentInvoice.sequence_number, contact?.id)
      : invoiceNumber(company?.name, contact?.id, issuedAt))
  const dueDate = meta.dueDate || currentInvoice?.due_at || null
  const brand = resolveBrandGold(company)

  const approvedCOAdjustment = (changeOrders || [])
    .filter((co: any) => co?.status === 'approved')
    .reduce((s: any, co: any) => s + Number(co.amount || 0), 0)
  const adjustedContractTotal = Number(contractTotal || 0) + approvedCOAdjustment

  const paid = previouslyPaid != null
    ? Number(previouslyPaid)
    : (payments || []).reduce((s: any, p: any) => s + Number(p.amount || 0), 0)

  const balance = balanceRemaining != null
    ? Number(balanceRemaining)
    : Math.max(0, adjustedContractTotal - paid)
  const amountDue = thisInvoice != null ? Number(thisInvoice) : balance
  const isPaid = String(status).toLowerCase() === 'paid' || balance < 0.5
  // due_at can be a date-only string — parse LOCAL (the codebase rule,
  // see format.ts) and don't flag "Past due" until the due DAY has
  // fully passed; the raw UTC parse flipped the chip red the evening
  // before the due date in every US timezone.
  const dueParsed = parseDateOnly(dueDate)
  const isOverdue = !isPaid && dueParsed != null && dueParsed.getTime() + 86400000 <= Date.now()

  const rows = (lineItems && lineItems.length > 0)
    ? lineItems.map((li: any) => ({
        id: li.id,
        title: li.description || 'Item',
        descriptionLines: li.notes ? [li.notes] : [],
        qty: li.qty || 1,
        unit: li.unit,
        rate: li.rate,
        amount: li.amount
      }))
    : []

  // Match the PDF and public link: drafts are never shown to customers,
  // so the in-app preview must hide them too or the operator previews a
  // billing schedule the customer will never receive.
  const scheduleRows = (invoices || []).filter((inv: any) => inv && inv.status !== 'void' && inv.status !== 'draft')

  const paymentInstructions = (company?.payment_instructions || '').trim()

  return (
    <DocumentShell
      company={company}
      docType="Invoice"
      number={number}
      metaRows={[
        { label: 'Issued', value: longDate(issuedAt) || '—' },
        dueDate && { label: 'Due', value: longDate(dueDate), strong: true }
      ].filter(Boolean)}
      status={statusToChip(status, isOverdue)}
      recipient={contact}
      recipientLabel="Billed to"
      project={project?.title ? { title: project.title, address: project?.address || '' } : null}
      hero={
        <HeroBand
          brand={brand}
          amountDue={amountDue}
          dueDate={dueDate}
          isPaid={isPaid}
          isOverdue={isOverdue}
          paid={paid}
          contractTotal={adjustedContractTotal}
        />
      }
      footer={DEFAULT_DISCLAIMER}
    >
      {/* Line items — only when the invoice actually has them. A fake
          one-row "Qty 1 × contract" table communicates nothing. */}
      {rows.length > 0 && (
        <section>
          <SectionLabel>Billed this invoice</SectionLabel>
          <LineItemsTable rows={rows} company={company} />
        </section>
      )}

      {/* Billing schedule — the draw plan with live status. */}
      {scheduleRows.length > 0 && (
        <section>
          <SectionLabel>Billing schedule</SectionLabel>
          {/* Scroll guard: five columns don't fit a 390px phone; the
              table keeps its letter-width geometry and pans instead of
              clipping the Status column. */}
          <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
            <div style={{ minWidth: 480 }}>
              <BillingSchedule
                invoices={scheduleRows}
                currentId={currentInvoice?.id || null}
                company={company}
                brand={brand}
                jobSeed={contact?.id}
              />
            </div>
          </div>
        </section>
      )}

      {/* Contract amendments */}
      {(changeOrders || []).filter((co: any) => co?.status !== 'void').length > 0 && (
        <section>
          <SectionLabel>Contract amendments</SectionLabel>
          <ChangeOrdersBlock changeOrders={changeOrders} company={company} />
        </section>
      )}

      {/* Contract position — one reconciliation the customer can check. */}
      <section>
        <SectionLabel>Contract position</SectionLabel>
        <ContractPosition
          contractTotal={Number(contractTotal || 0)}
          coAdjustment={approvedCOAdjustment}
          paid={paid}
          balance={balance}
          brand={brand}
        />
      </section>

      {/* Payment history */}
      {payments.length > 0 && (
        <section>
          <SectionLabel>Payment history</SectionLabel>
          <PaymentHistoryBlock payments={payments} />
        </section>
      )}

      {/* How to pay */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 20,
          borderTop: `1px solid ${DOC_COLORS.rule}`,
          paddingTop: 20
        }}
      >
        <Detail label="How to pay">
          {paymentInstructions || DEFAULT_PAYMENT_COPY}
        </Detail>
        {notes && <Detail label="Notes">{notes}</Detail>}
      </section>

      {/* Insurance */}
      <InsuranceModeBlock insurance={insurance} company={company} />

      {/* Project photos — quiet "here's the work" footnote. */}
      {photos.length > 0 && (
        <section>
          <SectionLabel>Project photos</SectionLabel>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8 }}>
            {photos.slice(0, 4).map((p: any, i: any) => p?.url && (
              <figure key={i} style={{ margin: 0 }}>
                <div style={{ width: '100%', aspectRatio: '4 / 3', background: '#e8e2d4', borderRadius: 4, overflow: 'hidden' }}>
                  <img
                    src={p.url}
                    alt={p.caption || p.section_tag || 'Project photo'}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </div>
                {(p.caption || p.section_tag) && (
                  <figcaption style={{ marginTop: 4, fontFamily: DOC_FONTS.body, fontSize: 10, color: DOC_COLORS.inkMuted, lineHeight: 1.35 }}>
                    {p.caption || p.section_tag}
                  </figcaption>
                )}
              </figure>
            ))}
          </div>
        </section>
      )}
    </DocumentShell>
  )
}

/* ─── Internal blocks ─── */

function HeroBand({ brand, amountDue, dueDate, isPaid, isOverdue, paid, contractTotal }: any) {
  const pct = contractTotal > 0 ? Math.max(0, Math.min(1, paid / contractTotal)) : 0
  return (
    <section
      style={{
        padding: '18px 22px',
        background: DOC_COLORS.paperSoft,
        border: `1px solid ${DOC_COLORS.rule}`,
        borderRadius: 6
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 24, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: DOC_COLORS.inkMuted, marginBottom: 4 }}>
            {isPaid ? 'Balance' : 'Amount due'}
          </div>
          <div
            style={{
              fontFamily: DOC_FONTS.serif,
              fontSize: 40,
              fontWeight: 500,
              letterSpacing: '-0.02em',
              lineHeight: 1,
              color: isPaid ? DOC_COLORS.signalGreen : DOC_COLORS.ink,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {isPaid ? 'Paid in full' : money(amountDue)}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontSize: 11.5, color: DOC_COLORS.inkMuted, lineHeight: 1.6 }}>
          {!isPaid && dueDate && (
            <div>
              Due <span style={{ color: isOverdue ? DOC_COLORS.alertRed : DOC_COLORS.ink, fontWeight: 700 }}>{longDate(dueDate)}</span>
              {isOverdue ? <span style={{ color: DOC_COLORS.alertRed, fontWeight: 700 }}> · past due</span> : null}
            </div>
          )}
          {contractTotal > 0 && (
            <div>
              {money(paid)} of {money(contractTotal)} collected
            </div>
          )}
        </div>
      </div>
      {contractTotal > 0 && (
        <div
          role="progressbar"
          aria-valuenow={Math.round(pct * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
          style={{ marginTop: 14, height: 4, borderRadius: 999, background: DOC_COLORS.rule, overflow: 'hidden' }}
        >
          <div
            style={{
              width: `${pct * 100}%`,
              height: '100%',
              borderRadius: 999,
              background: isPaid ? DOC_COLORS.signalGreen : brand
            }}
          />
        </div>
      )}
    </section>
  )
}

function BillingSchedule({ invoices, currentId, company, brand, jobSeed }: any) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: DOC_FONTS.body, fontSize: 12.5 }}>
      <thead>
        <tr>
          {['Invoice', 'Issued', 'Due', 'Amount', 'Status'].map((h, i) => (
            <th
              key={h}
              scope="col"
              style={{
                textAlign: i >= 3 ? 'right' : 'left',
                padding: '0 0 7px',
                borderBottom: `2px solid ${DOC_COLORS.ink}`,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: DOC_COLORS.inkMuted
              }}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {invoices.map((inv: any) => {
          const isCurrent = currentId != null && inv.id === currentId
          const paid = String(inv.status || '').toLowerCase() === 'paid'
          return (
            <tr key={inv.id} style={{ background: isCurrent ? DOC_COLORS.paperSoft : undefined }}>
              <td style={cell()}>
                <span style={{ fontWeight: isCurrent ? 700 : 500, color: DOC_COLORS.ink, fontVariantNumeric: 'tabular-nums' }}>
                  {invoiceNumberFromSequence(company?.name, inv.sequence_number, jobSeed || inv.contact_id || inv.id)}
                </span>
                {inv.title && <span style={{ color: DOC_COLORS.inkMuted }}> · {inv.title}</span>}
                {isCurrent && (
                  <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: brand }}>
                    This invoice
                  </span>
                )}
              </td>
              <td style={{ ...cell(), color: DOC_COLORS.inkMuted, whiteSpace: 'nowrap' }}>{shortDate(inv.issued_at || inv.created_at)}</td>
              <td style={{ ...cell(), color: DOC_COLORS.inkMuted, whiteSpace: 'nowrap' }}>{paid ? '—' : shortDate(inv.due_at) || '—'}</td>
              <td style={{ ...cell(), textAlign: 'right', fontWeight: 600, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                {money(Number(inv.amount || 0), { cents: true })}
              </td>
              <td style={{ ...cell(), textAlign: 'right' }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: paid ? DOC_COLORS.signalGreen : DOC_COLORS.inkMid
                  }}
                >
                  {paid ? 'Paid' : 'Due'}
                </span>
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function cell() {
  return {
    padding: '9px 12px 9px 0',
    borderBottom: `1px solid ${DOC_COLORS.rule}`,
    verticalAlign: 'top' as const,
    lineHeight: 1.45
  }
}

function ContractPosition({ contractTotal, coAdjustment, paid, balance, brand }: any) {
  const rows = [
    { label: 'Original contract', value: money(contractTotal, { cents: true }) },
    coAdjustment !== 0 && {
      label: 'Approved change orders',
      value: `${coAdjustment >= 0 ? '+' : '−'}${money(Math.abs(coAdjustment), { cents: true })}`
    },
    coAdjustment !== 0 && {
      label: 'Contract to date',
      value: money(contractTotal + coAdjustment, { cents: true }),
      strong: true
    },
    { label: 'Paid to date', value: paid > 0 ? `−${money(paid, { cents: true })}` : money(0, { cents: true }), green: paid > 0 }
  ].filter(Boolean) as any[]

  return (
    <div
      style={{
        border: `1px solid ${DOC_COLORS.rule}`,
        borderRadius: 6,
        padding: '6px 18px 14px',
        maxWidth: 420,
        marginLeft: 'auto'
      }}
    >
      <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: DOC_FONTS.body }}>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <td style={{ padding: '7px 0', fontSize: 12.5, color: DOC_COLORS.inkMuted, borderBottom: `1px solid ${DOC_COLORS.rule}` }}>
                {r.label}
              </td>
              <td
                style={{
                  padding: '7px 0',
                  fontSize: 12.5,
                  fontWeight: r.strong ? 700 : 600,
                  color: r.green ? DOC_COLORS.signalGreen : DOC_COLORS.ink,
                  textAlign: 'right',
                  fontVariantNumeric: 'tabular-nums',
                  borderBottom: `1px solid ${DOC_COLORS.rule}`
                }}
              >
                {r.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', paddingTop: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: DOC_COLORS.ink }}>
          Balance remaining
        </span>
        <span
          style={{
            fontFamily: DOC_FONTS.body,
            fontSize: 18,
            fontWeight: 700,
            color: balance > 0.5 ? DOC_COLORS.ink : DOC_COLORS.signalGreen,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {balance > 0.5 ? money(balance, { cents: true }) : 'Paid in full'}
        </span>
      </div>
    </div>
  )
}

function SectionLabel({ children }: any) {
  return (
    <div
      style={{
        fontFamily: DOC_FONTS.body,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: DOC_COLORS.ink,
        marginBottom: 10
      }}
    >
      {children}
    </div>
  )
}

function Detail({ label, children }: any) {
  return (
    <div>
      <div style={{ fontFamily: DOC_FONTS.body, fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: DOC_COLORS.inkFaint, marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ fontFamily: DOC_FONTS.body, fontSize: 12, color: DOC_COLORS.inkMid, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>
        {children}
      </div>
    </div>
  )
}

function statusToChip(status: any, isOverdue: boolean) {
  if (isOverdue) return { label: 'Past due', tone: 'red' }
  switch (String(status || 'outstanding').toLowerCase()) {
    case 'paid':    return { label: 'Paid',    tone: 'green' }
    case 'overdue': return { label: 'Past due', tone: 'red' }
    case 'closed':  return { label: 'Closed',  tone: 'slate' }
    default:        return { label: 'Open',    tone: 'gold' }
  }
}
