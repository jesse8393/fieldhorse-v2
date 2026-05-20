// src/components/documents/InvoiceTemplate.jsx
//
// Customer-facing HTML preview of a contractor invoice — same
// restrained editorial layout as the proposal. Composes:
//
//   1. DocumentShell           (logo + INVOICE # + recipient / sender)
//   2. LineItemsTable          (work + materials, dark header bar)
//   3. Totals + AMOUNT DUE     (bordered total box on the right)
//   4. Optional change orders  (when present)
//   5. Payment history table   (when payments)
//   6. Balance summary block   (Contract / Paid / Balance — boxed)
//   7. Payment instructions    (paragraph)
//   8. Insurance (optional)
//   9. Disclaimer footer

import DocumentShell from './DocumentShell.jsx'
import LineItemsTable from './LineItemsTable.tsx'
import PaymentHistoryBlock from './PaymentHistoryBlock.tsx'
import InvoiceBalanceBlock from './InvoiceBalanceBlock.jsx'
import InsuranceModeBlock from './InsuranceModeBlock.tsx'
import ChangeOrdersBlock from './ChangeOrdersBlock.tsx'
import { DOC_COLORS, DOC_FONTS } from './tokens.ts'
import { money } from './format.ts'
import { invoiceNumber } from './numbers.ts'

const PAYMENT_COPY = 'Please remit payment according to the terms above. Payments will be applied to the project balance shown below.'
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
  photos = []   // [{ url, section_tag, caption }] — quiet strip at end
}) {
  const number = meta.number || invoiceNumber(company?.name, contact?.id)
  const issuedAt = meta.issuedAt || new Date()
  const dueDate = meta.dueDate || null

  const approvedCOAdjustment = (changeOrders || [])
    .filter((co) => co?.status === 'approved')
    .reduce((s, co) => s + Number(co.amount || 0), 0)
  const adjustedContractTotal = Number(contractTotal || 0) + approvedCOAdjustment

  // Single canonical row when no granular items — matches the existing
  // synth pattern the screens were already using.
  const rows = (lineItems && lineItems.length > 0)
    ? lineItems.map((li) => ({
        id: li.id,
        title: li.description || 'Item',
        descriptionLines: li.notes ? [li.notes] : [],
        qty: li.qty || 1,
        unit: li.unit,
        rate: li.rate,
        amount: li.amount
      }))
    : [{
        id: 'default',
        title: contact?.job_title || 'Construction services per agreement',
        descriptionLines: [],
        qty: 1,
        rate: contractTotal,
        amount: contractTotal
      }]

  const subtotal = rows.reduce((s, r) => {
    const q = Number(r.qty || 1)
    const rt = Number(r.rate || 0)
    return s + Number(r.amount != null ? r.amount : q * rt)
  }, 0)
  const tax = subtotal * Number(taxRate || 0)
  const total = subtotal + tax

  const pp = previouslyPaid != null
    ? Number(previouslyPaid)
    : (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)

  const statusChip = statusToChip(status, dueDate)

  return (
    <DocumentShell
      company={company}
      docType="INVOICE"
      number={shortNumber(number)}
      issuedAt={issuedAt}
      recipient={contact}
      status={statusChip}
      footer={DEFAULT_DISCLAIMER}
    >
      {/* Items */}
      <LineItemsTable rows={rows} company={company} />

      {/* Totals + AMOUNT DUE box */}
      <TotalsBlock
        subtotal={subtotal}
        tax={tax}
        taxRate={taxRate}
        total={total}
        dueDate={dueDate}
      />

      {/* Change orders */}
      {(changeOrders || []).filter((co) => co?.status !== 'void').length > 0 && (
        <section>
          <SectionLabel>Contract amendments</SectionLabel>
          <ChangeOrdersBlock changeOrders={changeOrders} company={company} />
        </section>
      )}

      {/* Payment history */}
      {payments.length > 0 && (
        <section>
          <SectionLabel>Payment history</SectionLabel>
          <PaymentHistoryBlock payments={payments} />
        </section>
      )}

      {/* Balance summary */}
      <section>
        <SectionLabel>Balance summary</SectionLabel>
        <InvoiceBalanceBlock
          contractTotal={adjustedContractTotal || contractTotal || total}
          previouslyPaid={pp}
          thisInvoice={thisInvoice}
          balanceRemaining={balanceRemaining}
          payments={payments}
          company={company}
        />
      </section>

      {/* Payment instructions */}
      <Detail label="PAYMENT INSTRUCTIONS">
        {PAYMENT_COPY}
        {notes && (
          <div style={{ marginTop: 10, color: DOC_COLORS.ink, whiteSpace: 'pre-wrap' }}>
            {notes}
          </div>
        )}
      </Detail>

      {/* Insurance */}
      <InsuranceModeBlock insurance={insurance} company={company} />

      {/* Project photos — final strip. On invoices the photos serve as
          a quiet "here's the work you paid for" footnote rather than
          a sales pitch, so we cap at 4 and skip the section grouping
          the proposal uses. */}
      {photos.length > 0 && (
        <section>
          <SectionLabel>Project photos</SectionLabel>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
            gap: 8
          }}>
            {photos.slice(0, 4).map((p, i) => p?.url && (
              <figure key={i} style={{ margin: 0 }}>
                <div style={{
                  width: '100%',
                  aspectRatio: '4 / 3',
                  background: '#e8e2d4',
                  borderRadius: 4,
                  overflow: 'hidden'
                }}>
                  <img
                    src={p.url}
                    alt={p.caption || p.section_tag || 'Project photo'}
                    loading="lazy"
                    style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                  />
                </div>
                {(p.caption || p.section_tag) && (
                  <figcaption style={{
                    marginTop: 4,
                    fontFamily: DOC_FONTS.body,
                    fontSize: 10,
                    color: DOC_COLORS.inkMuted,
                    lineHeight: 1.35
                  }}>
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

function SectionLabel({ children }) {
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

function Detail({ label, children }) {
  return (
    <div>
      <div
        style={{
          fontFamily: DOC_FONTS.body,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: DOC_COLORS.ink,
          marginBottom: 4
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: DOC_FONTS.body,
          fontSize: 13,
          color: DOC_COLORS.inkMid,
          lineHeight: 1.5
        }}
      >
        {children}
      </div>
    </div>
  )
}

function TotalsBlock({ subtotal, tax, taxRate, total, dueDate }) {
  return (
    <section style={{ display: 'flex', justifyContent: 'flex-end', marginTop: -8 }}>
      <div style={{ minWidth: 320 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
          <tbody>
            <Row label="Subtotal" value={money(subtotal, { cents: true })} />
            {taxRate > 0 && <Row label={`Tax · ${(taxRate * 100).toFixed(2)}%`} value={money(tax, { cents: true })} />}
            {dueDate && <Row label="Due" value={formatDateShort(dueDate)} />}
          </tbody>
        </table>
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 18,
            paddingTop: 6
          }}
        >
          <span
            style={{
              fontFamily: DOC_FONTS.body,
              fontSize: 14,
              fontWeight: 600,
              color: DOC_COLORS.ink
            }}
          >
            Amount due
          </span>
          <span
            style={{
              fontFamily: DOC_FONTS.body,
              fontSize: 16,
              fontWeight: 700,
              color: DOC_COLORS.ink,
              border: `1px solid ${DOC_COLORS.ink}`,
              padding: '8px 18px',
              borderRadius: 2,
              minWidth: 130,
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {money(total, { cents: true })}
          </span>
        </div>
      </div>
    </section>
  )
}

function Row({ label, value, muted }) {
  return (
    <tr>
      <td style={{ padding: '6px 0', fontFamily: DOC_FONTS.body, fontSize: 13, color: DOC_COLORS.inkMuted, textAlign: 'left' }}>
        {label}
      </td>
      <td style={{ padding: '6px 0', fontFamily: DOC_FONTS.body, fontSize: 13, color: muted ? DOC_COLORS.inkMuted : DOC_COLORS.ink, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </td>
    </tr>
  )
}

function formatDateShort(d) {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function shortNumber(num) {
  if (!num) return ''
  const parts = String(num).split('-')
  return parts[parts.length - 1] || String(num)
}

function statusToChip(status, dueDate) {
  switch (String(status || 'outstanding').toLowerCase()) {
    case 'paid':    return { label: 'PAID',    tone: 'green' }
    case 'overdue': return { label: 'OVERDUE', tone: 'red' }
    case 'closed':  return { label: 'CLOSED',  tone: 'slate' }
    default:        return { label: dueDate ? 'OUTSTANDING' : 'NEW', tone: 'gold' }
  }
}
