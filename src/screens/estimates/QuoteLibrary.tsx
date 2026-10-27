import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useActiveCompany, useQuotes } from '../../lib/queries.ts'
import { onlyActiveCompany } from '../../lib/activeCompany.ts'
import DataErrorState from '../../components/DataErrorState.tsx'
import { quoteTitle, quoteStatusView, type QuoteWithClient } from '../quotes/quoteShape.ts'
import { filterQuoteLibrary, QUOTE_FILTERS, quoteBucket, type QuoteFilter } from './estimateLibrary.ts'
import './estimate-library.css'

const money = (amount: number) => amount.toLocaleString('en-US', { style: 'currency', currency: 'USD' })

export default function QuoteLibrary() {
  const { user } = useAuth()
  const company = useActiveCompany()
  const query = useQuotes(user?.id)
  const [params, setParams] = useSearchParams()
  const search = params.get('q') || ''
  const rawStatus = params.get('status') || 'all'
  const status: QuoteFilter = QUOTE_FILTERS.some(filter => filter.id === rawStatus) ? rawStatus as QuoteFilter : 'all'
  const sort = params.get('sort') || 'recent'
  const [limit, setLimit] = useState(40)
  const quotes = useMemo(() => onlyActiveCompany((query.data || []) as QuoteWithClient[], company), [query.data, company])
  const matches = useMemo(() => filterQuoteLibrary(quotes, search, status, sort), [quotes, search, status, sort])
  function setFilter(key: string, value: string) {
    const next = new URLSearchParams(params)
    value ? next.set(key, value) : next.delete(key)
    setParams(next, { replace: true })
    setLimit(40)
  }
  return <section className="fh-estimate-library" aria-labelledby="quote-library-title">
    <div className="fh-estimate-library__heading">
      <div><h2 id="quote-library-title">Quote library</h2><p>Find drafts, follow up and open customer documents.</p></div>
      <Link className="fh-build-secondary-btn" to="/quotes/new">New quote</Link>
    </div>
    <div className="fh-estimate-library__filters">
      <label>Search quotes<input type="search" value={search} onChange={event => setFilter('q', event.target.value)} placeholder="Customer, project or quote reference" /></label>
      <label>Quote status<select value={status} onChange={event => setFilter('status', event.target.value)}>{QUOTE_FILTERS.map(filter => <option key={filter.id} value={filter.id}>{filter.label}</option>)}</select></label>
      <label>Sort quotes<select value={sort} onChange={event => setFilter('sort', event.target.value)}><option value="recent">Recently updated</option><option value="value">Highest value</option><option value="customer">Customer name</option></select></label>
    </div>
    {query.isError && <DataErrorState title="Quotes unavailable" message={quotes.length ? 'Showing saved records. Refresh before relying on their current status.' : 'Check your connection and try again.'} actionLabel="Try again" onRetry={() => { void query.refetch() }} />}
    {query.isPending ? <p role="status">Loading quotes…</p> : <>
      <p className="fh-estimate-library__count" aria-live="polite">{matches.length} of {quotes.length} quotes{query.isError ? ' in saved records' : ''}</p>
      {quotes.length === 0 && !query.isError ? <div className="fh-estimate-library__empty"><h3>No quotes yet</h3><p>Create a quote, or build an estimate from your scope.</p><Link to="/bid?view=builder">Open estimate builder</Link></div>
        : matches.length === 0 && quotes.length > 0 ? <div className="fh-estimate-library__empty"><h3>No matching quotes</h3><button type="button" onClick={() => { const next = new URLSearchParams(params); next.delete('q'); next.delete('status'); setParams(next, { replace: true }) }}>Clear search and status</button></div>
          : <ul className="fh-estimate-library__rows" aria-label="Estimate quotes">{matches.slice(0, limit).map(quote => {
            const href = `/quotes/${encodeURIComponent(quote.id)}`
            const state = quote.job_id ? 'Converted to job' : quoteStatusView(quote).label
            const action = quoteBucket(quote) === 'draft' || quoteBucket(quote) === 'changes_requested' ? 'Continue editing' : 'Open quote'
            return <li key={quote.id}>
              <div className="fh-estimate-library__record"><Link to={href}>{quoteTitle(quote)}</Link><span>{quote.fh_clients?.name || 'No customer linked'}</span><small>Ref {quote.id.slice(0, 8).toUpperCase()} · Updated {new Date(quote.updated_at).toLocaleDateString()}</small></div>
              <div className="fh-estimate-library__value"><strong>{money(Number(quote.amount || 0))}</strong><span>{state}</span></div>
              <div className="fh-estimate-library__actions"><Link to={href}>{action}</Link><Link to={`${href}/preview`} aria-label={`Preview ${quoteTitle(quote)}`}>Preview</Link>{quote.job_id && <Link to={`/jobs/${encodeURIComponent(quote.job_id)}`}>Open job</Link>}</div>
            </li>
          })}</ul>}
      {matches.length > limit && <button type="button" className="fh-build-secondary-btn" onClick={() => setLimit(value => value + 40)}>Load more quotes ({matches.length - limit} remaining)</button>}
    </>}
  </section>
}
