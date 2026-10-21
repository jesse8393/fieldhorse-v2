// Scope and terms, /quotes/:id/terms (Phase 9, Task 10, D57). The three
// customer facing blocks, the title and the expiry date, saved with one tap
// on Save terms through the quote's patch (blank text stored as null). The
// PDF, the send and the customer page read what is saved. Saving goes back
// to the quote, where the deposit follows what the payment terms name.

import { useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, Field, SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { dateInputToTimestamp, timestampToDateInput } from '../../lib/dueDate.ts'
import { recordRoute } from '../../lib/records.ts'
import QuoteHeader, { useGoBack } from './QuoteHeader.tsx'
import { useQuote } from './useQuote.ts'
import type { QuoteWithClient } from './quoteShape.ts'
import './quotes.css'

function normText(value: string | null | undefined) {
  const t = String(value || '').trim()
  return t.length === 0 ? null : t
}

export default function QuoteTerms() {
  const { id = '' } = useParams()
  const state = useQuote(id)
  const home = recordRoute('quote', id)
  if (state.status === 'loading' || state.status === 'missing' || (state.status === 'failed' && !state.quote)) {
    return (
      <div className="fhqt-page">
        <QuoteHeader kicker="Scope and terms" home={home} />
        {state.status === 'loading' ? (
          <div className="fhqt-loading"><SkeletonRows rows={4} label="Loading the quote" /></div>
        ) : (
          <DataErrorState
            title="Couldn't load the quote"
            message={state.status === 'missing' ? 'This quote is gone.' : 'Check your connection and try again.'}
            actionLabel={state.status === 'missing' ? '' : 'Try again'}
            onRetry={() => { void state.refresh() }}
          />
        )}
      </div>
    )
  }
  return <TermsForm key={state.quote?.id} quote={state.quote as QuoteWithClient} patch={state.patch} home={home} />
}

function TermsForm({ quote, patch, home }: { quote: QuoteWithClient; patch: ReturnType<typeof useQuote>['patch']; home: string }) {
  const goBack = useGoBack(home)
  const [title, setTitle] = useState(quote.title || '')
  const [scope, setScope] = useState(quote.scope_text || '')
  const [exclusions, setExclusions] = useState(quote.exclusions_text || '')
  const [terms, setTerms] = useState(quote.terms_text || '')
  const [expires, setExpires] = useState(timestampToDateInput(quote.expires_at))
  const [saving, setSaving] = useState(false)
  const titleRef = useRef<HTMLHeadingElement>(null)

  async function save() {
    if (saving) return
    const updates: Record<string, unknown> = {}
    if (normText(title) !== normText(quote.title)) updates.title = normText(title)
    if (normText(scope) !== normText(quote.scope_text)) updates.scope_text = normText(scope)
    if (normText(exclusions) !== normText(quote.exclusions_text)) updates.exclusions_text = normText(exclusions)
    if (normText(terms) !== normText(quote.terms_text)) updates.terms_text = normText(terms)
    if (expires !== timestampToDateInput(quote.expires_at)) updates.expires_at = dateInputToTimestamp(expires)
    if (Object.keys(updates).length === 0) { goBack(); return }
    setSaving(true)
    const res = await patch(updates)
    setSaving(false)
    // patch already said why it failed; keep the text for a retry.
    if (res.error) return
    goBack()
  }

  return (
    <div className="fhqt-page">
      <QuoteHeader kicker="Quote" home={home} />
      <h1 className="fhqt-title" ref={titleRef} tabIndex={-1}>Scope and terms</h1>
      <p className="fhqt-sub">These blocks and the lines become the quote the customer sees.</p>
      <form className="fhqt-form fhqt-form--page" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <Field
          label="Title"
          value={title}
          placeholder="Such as Parking lot repour"
          autoComplete="off"
          onChange={(e) => setTitle(e.target.value)}
        />
        <Field
          label="Scope of work"
          multiline
          rows={5}
          value={scope}
          helper="What you will do, in plain English. Two or three sentences is fine."
          onChange={(e) => setScope(e.target.value)}
        />
        <Field
          label="Exclusions"
          multiline
          rows={4}
          value={exclusions}
          helper="What is not included. Spelling it out prevents change order surprises."
          onChange={(e) => setExclusions(e.target.value)}
        />
        <Field
          label="Payment terms"
          multiline
          rows={4}
          value={terms}
          helper="Deposit, progress payments, warranty. Name the deposit, such as 30% deposit, $2,500 deposit or no deposit, and the quote and the customer page follow it."
          onChange={(e) => setTerms(e.target.value)}
        />
        <Field
          label="Quote expires"
          type="date"
          value={expires}
          helper="Optional. Helps customers act before pricing changes."
          onChange={(e) => setExpires(e.target.value)}
        />
        <Button type="submit" variant="primary" size="lg" block loading={saving}>Save terms</Button>
      </form>
    </div>
  )
}
