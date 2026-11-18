import { Link } from 'react-router-dom'
import { formatMoney } from './fh'
import { invoiceReference } from '../lib/invoiceReference.ts'
import { reviewInvoice } from '../lib/invoiceReview.js'
export default function InvoiceBillingReview({ review, companyName, acknowledged, onAcknowledge }: { review: ReturnType<typeof reviewInvoice>; companyName?: string | null; acknowledged?: boolean; onAcknowledge?: (value: boolean) => void }) {
  if (!review.excess && !review.duplicates.length) return null
  return <section className="fhinv-review" aria-label="Billing review">
    <h2>Review billing before sending</h2>
    {review.excess > 0 && <p role="alert">Invoices and reserved drafts exceed approved contract value by {formatMoney(review.excess)}. Reduce this amount, void an unused draft, or record approved scope before sending.</p>}
    {review.duplicates.length > 0 && <>
      <p>Similar amount and purpose found. These may be separate installments. Review each record.</p>
      <ul>{review.duplicates.map((invoice: { id: string; title?: string | null; status?: string | null; sequence_number?: number | null; contact_id?: string | null; client_id?: string | null }) => <li key={invoice.id}><Link to={`/invoices/${invoice.id}`}>{invoiceReference(invoice, companyName)} · {invoice.title || 'Invoice'} · {invoice.status || 'draft'}</Link></li>)}</ul>
      {onAcknowledge && <label><input type="checkbox" checked={!!acknowledged} onChange={e => onAcknowledge(e.target.checked)} /> I reviewed these records. This bills a separate installment.</label>}
    </>}
  </section>
}
