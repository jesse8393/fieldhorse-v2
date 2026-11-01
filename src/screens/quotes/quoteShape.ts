// The quote record as the older document code reads it (Phase 9, Task 10).
// The proposal preview, the PDF generator and the status derivation grew
// up on fh_contacts columns (proposal_status, quote_sent_at and so on). A
// quote now lives on fh_quotes with its own names for the same facts, and
// its client on fh_clients. This file maps one to the other in one place,
// so the document code keeps working untouched until Task 11 points it at
// the quote itself.

import type { QuoteRow } from '../../lib/quotes.ts'
import { deriveStatus } from '../ContactDetail/lib/quoteStatus.ts'

export type QuoteClientRow = {
  id: string
  name: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
}

/** An fh_quotes row with the client the mock and the live read embed. */
export type QuoteWithClient = QuoteRow & { fh_clients?: QuoteClientRow | null }

export const QUOTE_SELECT = '*, fh_clients!fh_quotes_client_id_fkey(id, name, phone, email, address)'

/**
 * The contact shaped object DocumentPreviewPane, generateQuote and
 * deriveStatus read. `email` is the address the send found (the client's,
 * read fresh), passed in so the document names where it went.
 */
export function quoteAsContact(quote: QuoteWithClient, email?: string | null) {
  const client = quote.fh_clients ?? null
  return {
    id: quote.id,
    client_id: quote.client_id,
    user_id: quote.user_id,
    org_id: quote.org_id,
    stage: 'quote',
    name: client?.name ?? null,
    address: client?.address ?? null,
    phone: client?.phone ?? null,
    email: email ?? client?.email ?? null,
    job_title: quote.title,
    amount: quote.amount,
    scope_text: quote.scope_text,
    terms_text: quote.terms_text,
    exclusions_text: quote.exclusions_text,
    proposal_status: quote.status,
    quote_sent_at: quote.sent_at,
    quote_expires_at: quote.expires_at,
    quote_change_request_note: quote.change_request_note,
    quote_change_requested_at: quote.change_requested_at,
    created_at: quote.created_at,
    updated_at: quote.updated_at
  }
}

export type QuoteStatusView = { label: string; tone: string; sub: string | null }

/** The status label, tone and short line the quote screen and the list show. */
export function quoteStatusView(quote: QuoteWithClient): QuoteStatusView {
  return deriveStatus(quoteAsContact(quote), false)
}

/** What the screen calls the quote when it has no title. */
export function quoteTitle(quote: Pick<QuoteRow, 'title'>): string {
  const t = quote.title?.trim()
  return t ? t : 'Untitled quote'
}
