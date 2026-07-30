// src/components/documents/InvoiceBalanceBlock.tsx
//
// "Where the project stands" panel for an invoice. Four KPIs in a grid:
//
//   Contract total  ·  Previously paid  ·  This invoice  ·  Balance remaining
//
// Balance remaining is the hero, large, brand-accent gold, the number
// the customer's eye lands on first. Other rows are subordinated stamps.
//
// Progress-billing aware: in the current single-invoice-per-job data
// model (each fh_contact at stage='invoice' IS the invoice), the four
// numbers collapse cleanly:
//
//   contractTotal     = contact.amount                 (sum of items)
//   previouslyPaid    = sum(fh_payments before now)    (running paid total)
//   thisInvoice       = contractTotal − previouslyPaid (what this invoice asks for)
//   balanceRemaining  = thisInvoice                    (same)
//
// When a future schema introduces a real fh_invoices table with
// progress-billing (e.g. "draw 2 of 4"), the parent screen can pass
// the four values explicitly and this block renders without changes.

import { DOC_COLORS, DOC_FONTS, typeStyle, resolveBrandGold } from './tokens.ts'
import { money } from './format.ts'

export default function InvoiceBalanceBlock({
  contractTotal = 0,
  previouslyPaid = 0,
  thisInvoice = null,    // null → derived from contractTotal − previouslyPaid
  balanceRemaining = null, // null → derived: same as thisInvoice in the
                            // single-invoice case; passed in for progress billing
  payments = [],          // optional, when present, retainage rows
                          //   (kind='retainage') get called out on a
                          //   separate line so the customer sees what
                          //   the contractor is holding back vs already
                          //   collected.
  company
}: any) {
  const gold = resolveBrandGold(company)
  const ct = Number(contractTotal || 0)
  const pp = Math.max(0, Number(previouslyPaid || 0))
  const ti = thisInvoice != null ? Number(thisInvoice) : Math.max(0, ct - pp)
  const br = balanceRemaining != null ? Number(balanceRemaining) : ti

  // Sum retainage-tagged payments. When > 0, surfaces as its own
  // subordinate row + the "Previously paid" row label flips to
  // "Progress paid" so the meaning is unambiguous.
  const retainage = (payments || [])
    .filter((p: any) => p?.kind === 'retainage')
    .reduce((s: any, p: any) => s + Number(p.amount || 0), 0)
  const hasRetainage = retainage > 0

  const subordinate = [
    { label: 'Contract total', value: money(ct) },
    {
      label: hasRetainage ? 'Progress paid' : 'Previously paid',
      value: pp > 0 ? `−${money(pp - retainage)}` : money(0),
      muted: pp > 0
    },
    hasRetainage && {
      label: 'Retainage held',
      value: `−${money(retainage)}`,
      muted: true
    },
    { label: 'This invoice', value: money(ti) }
  ].filter(Boolean) as Array<{ label: string; value: string; muted?: boolean }>

  return (
    <section
      style={{
        padding: '24px 24px',
        background: DOC_COLORS.paperSoft,
        border: `1px solid ${DOC_COLORS.ruleStrong}`,
        borderRadius: 10,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 24,
        alignItems: 'center',
        breakInside: 'avoid'
      }}
    >
      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {subordinate.map((r, i) => (
          <li
            key={r.label}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'baseline',
              padding: '8px 0',
              borderTop: i > 0 ? `1px solid ${DOC_COLORS.rule}` : 'none'
            }}
          >
            <span style={{ ...typeStyle('body'), color: DOC_COLORS.inkMuted }}>
              {r.label}
            </span>
            <span
              style={{
                ...typeStyle('stamp'),
                color: r.muted ? DOC_COLORS.inkMuted : DOC_COLORS.ink,
                fontVariantNumeric: 'tabular-nums'
              }}
            >
              {r.value}
            </span>
          </li>
        ))}
      </ul>

      <div style={{ textAlign: 'right' }}>
        <div style={{ ...typeStyle('label'), color: DOC_COLORS.inkMuted, marginBottom: 6 }}>
          BALANCE REMAINING
        </div>
        <div
          style={{
            ...typeStyle('hero'),
            color: br > 0.5 ? gold : DOC_COLORS.signalGreen,
            fontFamily: DOC_FONTS.serif,
            lineHeight: 1,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {br > 0.5 ? money(br) : 'PAID'}
        </div>
      </div>
    </section>
  )
}
