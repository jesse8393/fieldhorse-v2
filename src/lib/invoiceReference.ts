import { invoiceNumber, invoiceNumberFromSequence } from '../components/documents/numbers.ts'

type ReferencedInvoice = {
  id: string
  sequence_number?: number | null
  doc_number?: string | null
  contact_id?: string | null
  client_id?: string | null
  issued_at?: string | null
  created_at?: string | null
}

/**
 * The invoice's number as the customer reads it on the PDF and the
 * customer link (PCC-2D3E-01), so a number a customer calls about can be
 * found in the app (formats-1). The PDF seeds it from the job, or from the
 * client for an invoice billed to the client directly, and so does this.
 * `companyName` is the company the document is printed for.
 */
export function invoiceReference(invoice: ReferencedInvoice, companyName?: string | null): string {
  if (invoice.doc_number?.trim()) return invoice.doc_number.trim()
  const seed = invoice.contact_id || invoice.client_id || invoice.id
  if (invoice.sequence_number) return invoiceNumberFromSequence(companyName, invoice.sequence_number, seed)
  // With no sequence the printed number is the same for every invoice on
  // the job, so the short id tells two of them apart.
  return `${invoiceNumber(companyName, seed, invoice.issued_at || invoice.created_at)} · ${String(invoice.id).slice(0, 8)}`
}

/**
 * The job tail and sequence of a typed invoice number ("PCC-2D3E-01" gives
 * tail "2D3E" and sequence 1), or null when the text is not one.
 */
export function parseInvoiceReference(text: string): { tail: string; sequence: number } | null {
  const m = /^\s*[A-Za-z]{2,3}-([A-Za-z0-9]{1,4})-(\d{1,3})\s*$/.exec(String(text || ''))
  if (!m) return null
  const sequence = Number(m[2])
  return sequence > 0 ? { tail: m[1].toUpperCase(), sequence } : null
}
