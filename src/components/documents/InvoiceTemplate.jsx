// src/components/documents/InvoiceTemplate.jsx
//
// Customer-facing HTML preview of a contractor invoice. Composes the
// shared document primitives in the spec order:
//
//   1. Header                       (handled by DocumentShell — INVOICE eyebrow)
//   2. Bill to                      (BillToBlock — client + project snapshot)
//   3. Project snapshot             (folded into BillToBlock right column)
//   4. Invoice items                (line item list — synthesized from contract
//                                       amount when no fh_invoice_items exists)
//   5. Totals                       (subtotal / tax / amount due summary)
//   6. Payment history              (PaymentHistoryBlock — only when payments)
//   7. Balance remaining            (InvoiceBalanceBlock — hero KPI)
//   8. Payment instructions         (spec copy + remit-to line)
//   9. Insurance (optional)         (InsuranceModeBlock — auto-hides)
//
// Pure presentation: this component does not read Supabase. The parent
// (InvoiceDetail / Invoices list preview pane) gathers data + maps it.

import DocumentShell from './DocumentShell.jsx'
import SectionHeading from './SectionHeading.jsx'
import BillToBlock from './BillToBlock.jsx'
import PaymentHistoryBlock from './PaymentHistoryBlock.jsx'
import InvoiceBalanceBlock from './InvoiceBalanceBlock.jsx'
import InsuranceModeBlock from './InsuranceModeBlock.jsx'
import ChangeOrdersBlock from './ChangeOrdersBlock.jsx'
import { DOC_COLORS, typeStyle, resolveBrandGold } from './tokens.js'
import { money, longDate } from './format.js'
import { invoiceNumber } from './numbers.js'

const INVOICE_PAYMENT_COPY = `Please remit payment according to the payment terms listed on this invoice. Payments received will be applied to the project balance shown above.`

/**
 * @param {object}   props
 * @param {object}   props.company
 * @param {object}   props.contact         { name, address, phone, email, job_title }
 * @param {object}   [props.project]       { title, address, snapshot? }
 * @param {Array}    [props.lineItems]     [{ description, qty, rate, amount, unit, notes }]
 *                                          When omitted, synthesizes a single
 *                                          "Construction services per agreement"
 *                                          row from contractTotal.
 * @param {number}   props.contractTotal   sum-of-items / contract amount
 * @param {Array}    [props.payments]      [{ id, amount, method, reference, paid_on, note }]
 * @param {number}   [props.previouslyPaid] precomputed; falls back to sum(payments)
 * @param {number}   [props.thisInvoice]   optional override for progress billing
 * @param {number}   [props.balanceRemaining] optional override
 * @param {number}   [props.taxRate]       decimal; suppresses tax row when 0
 * @param {object}   [props.meta]          { issuedAt, dueDate, number }
 * @param {string}   [props.status]        'outstanding' | 'overdue' | 'paid' | 'closed'
 * @param {string}   [props.notes]         remit-to instructions, ACH details, etc.
 * @param {object}   [props.insurance]     forwarded to InsuranceModeBlock
 */
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
  changeOrders = []
}) {
  // Approved change orders bump the contract total. Drafts and rejected
  // COs are excluded from the math — they're not part of the contract
  // yet. Surfaces visually + arithmetically here so the customer sees
  // one cohesive number.
  const approvedCOAdjustment = (changeOrders || [])
    .filter((co) => co?.status === 'approved')
    .reduce((s, co) => s + Number(co.amount || 0), 0)
  const adjustedContractTotal = Number(contractTotal || 0) + approvedCOAdjustment
  const gold = resolveBrandGold(company)
  const number = meta.number || invoiceNumber(company?.name, contact?.id)
  const issuedAt = meta.issuedAt || new Date()
  const dueDate = meta.dueDate || null

  const resolvedProject = project || {
    title: contact?.job_title || 'Construction services',
    address: contact?.address || ''
  }

  // Synthesize a single line when no granular items are passed —
  // matches the spec: "If there is no invoice_items table, synthesize
  // invoice items from job title, contract amount, payments, change
  // orders if available."
  const rows = (lineItems && lineItems.length > 0)
    ? lineItems
    : [{
        description: resolvedProject.title || 'Construction services per agreement',
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
    : payments.reduce((s, p) => s + Number(p.amount || 0), 0)

  return (
    <DocumentShell
      company={company}
      docTypeEyebrow="INVOICE"
      title={resolvedProject.title}
      project={resolvedProject}
      status={statusPill(status)}
      metaCols={[
        { label: 'CLIENT',     value: contact?.name || '—' },
        { label: 'ISSUED',     value: longDate(issuedAt) },
        { label: 'DUE',        value: dueDate ? longDate(dueDate) : 'On receipt', color: dueDate ? DOC_COLORS.alertRed : undefined },
        { label: 'INVOICE #',  value: number, accent: true }
      ]}
    >
      {/* ─── 2 + 3. Bill to + project snapshot ─────────── */}
      <section>
        <BillToBlock
          clientLabel="BILL TO"
          client={contact}
          projectLabel="PROJECT"
          project={resolvedProject}
        />
      </section>

      {/* ─── 4. Invoice items ──────────────────────────── */}
      <section>
        <SectionHeading
          company={company}
          eyebrow="Invoice items"
          title="Work and materials"
          meta={`${rows.length} line${rows.length === 1 ? '' : 's'}`}
        />
        <LineItemsTable rows={rows} />
      </section>

      {/* ─── 5. Totals ─────────────────────────────────── */}
      <section style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <TotalsCard
          subtotal={subtotal}
          tax={tax}
          taxRate={taxRate}
          total={total}
          company={company}
        />
      </section>

      {/* ─── Change orders (when present) ─────────────── */}
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

      {/* ─── 6. Payment history (when present) ─────────── */}
      {payments.length > 0 && (
        <section>
          <SectionHeading
            company={company}
            eyebrow="Payment history"
            title="Received"
            meta={`${payments.length} payment${payments.length === 1 ? '' : 's'}`}
          />
          <PaymentHistoryBlock payments={payments} />
        </section>
      )}

      {/* ─── 7. Balance remaining (hero KPI) ──────────── */}
      <section>
        <SectionHeading
          company={company}
          eyebrow="Where the project stands"
          title="Balance summary"
        />
        <InvoiceBalanceBlock
          contractTotal={adjustedContractTotal || contractTotal || total}
          previouslyPaid={pp}
          thisInvoice={thisInvoice}
          balanceRemaining={balanceRemaining}
          company={company}
        />
      </section>

      {/* ─── 8. Payment instructions ──────────────────── */}
      <section style={{ breakInside: 'avoid' }}>
        <SectionHeading
          company={company}
          eyebrow="Payment instructions"
          title="How to pay"
        />
        <p
          style={{
            ...typeStyle('body'),
            color: DOC_COLORS.inkMid,
            margin: 0,
            maxWidth: '64ch'
          }}
        >
          {INVOICE_PAYMENT_COPY}
        </p>
        {notes && (
          <p
            style={{
              ...typeStyle('body'),
              color: DOC_COLORS.ink,
              margin: '12px 0 0',
              whiteSpace: 'pre-wrap',
              maxWidth: '64ch'
            }}
          >
            {notes}
          </p>
        )}
      </section>

      {/* ─── 9. Insurance mode (optional) ─────────────── */}
      <InsuranceModeBlock insurance={insurance} company={company} />
    </DocumentShell>
  )
}

/* ─────────────────────────────────────────────────────────
   Internal blocks (kept inline — small + invoice-specific)
   ───────────────────────────────────────────────────────── */

function LineItemsTable({ rows }) {
  return (
    <table
      style={{
        width: '100%',
        borderCollapse: 'collapse',
        ...typeStyle('body')
      }}
    >
      <thead>
        <tr>
          <Th align="left"  style={{ width: '48%' }}>Description</Th>
          <Th align="right" style={{ width: '12%' }}>Qty</Th>
          <Th align="right" style={{ width: '20%' }}>Rate</Th>
          <Th align="right" style={{ width: '20%' }}>Amount</Th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => {
          const q = Number(r.qty || 1)
          const rt = Number(r.rate || 0)
          const amt = Number(r.amount != null ? r.amount : q * rt)
          return (
            <tr key={r.id || i}>
              <Td>
                <div style={{ ...typeStyle('bodyBold'), color: DOC_COLORS.ink }}>
                  {r.description || '—'}
                </div>
                {r.notes && (
                  <div style={{ ...typeStyle('sub'), color: DOC_COLORS.inkMuted, marginTop: 2 }}>
                    {r.notes}
                  </div>
                )}
              </Td>
              <Td align="right" mono>
                {q}{r.unit ? ` ${r.unit}` : ''}
              </Td>
              <Td align="right" mono>{money(rt, { cents: true })}</Td>
              <Td align="right" mono bold>{money(amt, { cents: true })}</Td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

function Th({ children, align = 'left', style }) {
  return (
    <th
      scope="col"
      style={{
        ...typeStyle('label'),
        color: DOC_COLORS.inkMuted,
        textAlign: align,
        padding: '0 0 10px',
        borderBottom: `1px solid ${DOC_COLORS.ruleStrong}`,
        ...style
      }}
    >
      {children}
    </th>
  )
}

function Td({ children, align = 'left', mono = false, bold = false }) {
  return (
    <td
      style={{
        verticalAlign: 'top',
        padding: '12px 0',
        borderBottom: `1px solid ${DOC_COLORS.rule}`,
        textAlign: align,
        color: DOC_COLORS.ink,
        fontFamily: mono ? "'DM Sans', sans-serif" : undefined,
        fontVariantNumeric: mono ? 'tabular-nums' : undefined,
        fontWeight: bold ? 600 : undefined
      }}
    >
      {children}
    </td>
  )
}

function TotalsCard({ subtotal, tax, taxRate, total, company }) {
  const gold = resolveBrandGold(company)
  return (
    <div
      style={{
        width: '100%',
        maxWidth: 320,
        padding: '14px 18px',
        background: DOC_COLORS.paperSoft,
        border: `1px solid ${DOC_COLORS.rule}`,
        borderRadius: 6
      }}
    >
      <Row label="Subtotal" value={money(subtotal, { cents: true })} />
      {taxRate > 0 && (
        <Row label={`Tax · ${(taxRate * 100).toFixed(2)}%`} value={money(tax, { cents: true })} />
      )}
      <div
        style={{
          marginTop: 10,
          paddingTop: 10,
          borderTop: `1px solid ${gold}`,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline'
        }}
      >
        <span style={{ ...typeStyle('label'), color: DOC_COLORS.inkMuted }}>AMOUNT DUE</span>
        <span
          style={{
            ...typeStyle('h2'),
            color: gold,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {money(total)}
        </span>
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        padding: '6px 0',
        ...typeStyle('body'),
        color: DOC_COLORS.inkMuted
      }}
    >
      <span>{label}</span>
      <span
        style={{
          color: DOC_COLORS.ink,
          fontWeight: 600,
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {value}
      </span>
    </div>
  )
}

function statusPill(status) {
  switch (status) {
    case 'paid':        return { label: 'PAID',        tone: 'green' }
    case 'overdue':     return { label: 'OVERDUE',     tone: 'red' }
    case 'closed':      return { label: 'CLOSED',      tone: 'slate' }
    case 'outstanding':
    default:            return { label: 'OUTSTANDING', tone: 'gold' }
  }
}
