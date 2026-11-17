// src/components/public/invoiceView.ts
//
// The figures the customer invoice page (/p/:token, kind invoice) prints,
// as a pure function of the /api/public-link payload.
//
// What an invoice still owes comes from allocateInvoiceDue, the one
// allocator Money, the invoice PDF and the invoice email read, so the link
// asks for the same amount to the cent. The server works the figure out
// with every invoice on the job, unsent drafts included, and sends it as
// `amount_due` on each issued row; a payload without it is allocated here
// from the rows it carries.
//
// Rules the page relies on:
// * A job that has invoice rows is never asked for its contract balance.
//   The page asks for the oldest issued invoice that still owes something,
//   and for nothing once every issued invoice is settled.
// * Only a job with no invoice rows at all (billed before invoices were
//   rows) keeps the whole job balance.
// * Money is compared in whole cents. Nothing is "paid" while a cent is owed.

import { allocateInvoiceDue, isOpenInvoice, knownContractTotal } from '../../lib/invoiceSettlement.ts'

type Row = Record<string, any>

export type PublicInvoiceView = {
  /** Issued invoices (sent, viewed, overdue, paid), for the billing schedule. */
  rows: Row[]
  /** The invoice this page asks for, or null when nothing issued is owed. */
  current: Row | null
  /** The invoice whose number and dates head the page: current, else the last one issued. */
  shown: Row | null
  /** What the page asks for, in dollars. */
  amountDue: number
  /** The job price before change orders; 0 when there is no contract to show. */
  contractTotal: number
  paid: number
  /** What is still owed overall: on the contract when there is one, else on the issued invoices. */
  balance: number
  /** False when no contract stands behind the invoices (no job, or a job saved with no price). */
  showContractPosition: boolean
  status: 'paid' | 'outstanding'
}

const VISIBLE = new Set(['sent', 'viewed', 'overdue', 'paid'])

const cents = (n: unknown): number => {
  const v = Math.round(Number(n || 0) * 100)
  return Number.isFinite(v) ? v : 0
}
const statusOf = (inv: Row) => String(inv?.status || '').toLowerCase()

export function publicInvoiceView({ contact, payments, changeOrders, invoices }: {
  contact?: Row | null
  payments?: Row[] | null
  changeOrders?: Row[] | null
  invoices?: Row[] | null
}): PublicInvoiceView {
  const pays = payments || []
  const rows = (invoices || [])
    .filter((inv) => inv && VISIBLE.has(statusOf(inv)))
    .sort((a, b) => Number(a.sequence_number || 0) - Number(b.sequence_number || 0))
  const open = rows.filter((inv) => isOpenInvoice(inv))
  const paidCents = pays.reduce((s, p) => s + cents(p?.amount), 0)
  const contract = knownContractTotal({ amount: contact?.amount, changeOrders })
  // An invoice that bills the client directly (D62) has no job behind it.
  const clientBilled = rows.length > 0 && rows.every((inv) => !inv.contact_id)

  // A job from before invoices were rows: the whole job balance is the bill.
  if (rows.length === 0) {
    const balanceCents = Math.max(0, cents(contract ?? 0) - paidCents)
    return {
      rows, current: null, shown: null,
      amountDue: balanceCents / 100,
      contractTotal: Number(contact?.amount || 0),
      paid: paidCents / 100,
      balance: balanceCents / 100,
      showContractPosition: true,
      status: balanceCents > 0 ? 'outstanding' : 'paid'
    }
  }

  let due: Map<string, number>
  if (open.every((inv) => typeof inv.amount_due === 'number' && Number.isFinite(inv.amount_due))) {
    due = new Map(open.map((inv) => [inv.id, inv.amount_due]))
  } else if (clientBilled) {
    // Each is a contract of its own amount, paid by the payments linked to it.
    due = new Map()
    for (const inv of open) {
      const own = allocateInvoiceDue({
        invoices: [inv as any],
        payments: pays.filter((p) => p?.invoice_id === inv.id),
        contractTotal: cents(inv.amount) / 100
      })
      due.set(inv.id, own.get(inv.id) ?? 0)
    }
  } else {
    due = allocateInvoiceDue({ invoices: rows as any, payments: pays, contractTotal: contract })
  }

  const dueCents = (inv: Row) => Math.max(0, cents(due.get(inv.id)))
  const current = open.find((inv) => dueCents(inv) > 0) || null
  const amountCents = current ? dueCents(current) : 0
  const owedOnInvoices = open.reduce((s, inv) => s + dueCents(inv), 0)
  const hasContract = !clientBilled && contract != null
  const balanceCents = hasContract ? Math.max(0, cents(contract) - paidCents) : owedOnInvoices

  return {
    rows,
    current,
    shown: current || rows[rows.length - 1] || null,
    amountDue: amountCents / 100,
    contractTotal: hasContract ? Number(contact?.amount || 0) : 0,
    paid: paidCents / 100,
    balance: balanceCents / 100,
    showContractPosition: hasContract,
    status: amountCents > 0 ? 'outstanding' : 'paid'
  }
}
