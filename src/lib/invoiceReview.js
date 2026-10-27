/** Shared by the invoice editor and delivery endpoint. Amounts compare in cents.
 * @typedef {Object} ReviewInvoice
 * @property {string} id
 * @property {string | null} [contact_id]
 * @property {string | null} [client_id]
 * @property {string | null} [title]
 * @property {string | null} [description]
 * @property {number | string | null} [amount]
 * @property {string | null} [status]
 * @property {string | null} [due_at]
 * @property {number | null} [sequence_number]
 */
const cents = value => Math.round((Number(value) || 0) * 100)
const text = value => String(value || '').trim().toLowerCase().replace(/\s+/g, ' ')
const day = value => String(value || '').slice(0, 10)

/** @param {{ invoice: ReviewInvoice, invoices?: ReviewInvoice[], contractTotal?: number | null }} input */
export function reviewInvoice({ invoice, invoices = [], contractTotal = null }) {
  const siblings = invoices.filter(other => other.id !== invoice.id && other.status !== 'void')
  const sameObligation = other => invoice.contact_id
    ? other.contact_id === invoice.contact_id
    : !other.contact_id && !!invoice.client_id && other.client_id === invoice.client_id
  const related = siblings.filter(sameObligation)
  const duplicates = related.filter(other => {
    if (cents(other.amount) !== cents(invoice.amount)) return false
    const label = text(invoice.title || invoice.description)
    if (!label || label !== text(other.title || other.description)) return false
    // Equal installments on different due days are legitimate. Repeated final
    // balances deserve review even when their due dates differ.
    return day(other.due_at) === day(invoice.due_at) || /final\s+balance/.test(label)
  })
  const reserved = related.reduce((sum, other) => sum + (Number.isFinite(Number(other.amount)) ? Math.max(0, cents(other.amount)) : 0), 0)
  const contract = contractTotal == null ? null : cents(contractTotal)
  const proposed = reserved + (invoice.status === 'void' ? 0 : cents(invoice.amount))
  return {
    invalidAmount: !Number.isFinite(Number(invoice.amount)) || Number(invoice.amount) <= 0,
    duplicates,
    contractTotal,
    reserved: reserved / 100,
    proposed: proposed / 100,
    available: contract == null ? null : Math.max(0, contract - reserved) / 100,
    excess: contract == null ? 0 : Math.max(0, proposed - contract) / 100
  }
}
