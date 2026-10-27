/** A stable reference distinguishes equal titles and amounts without changing billing. */
export function invoiceReference(invoice: { id: string; sequence_number?: number | null; doc_number?: string | null }): string {
  if (invoice.doc_number?.trim()) return invoice.doc_number.trim()
  const sequence = invoice.sequence_number ? `Invoice ${invoice.sequence_number}` : 'Invoice'
  return `${sequence} · ${invoice.id.slice(0, 8)}`
}
