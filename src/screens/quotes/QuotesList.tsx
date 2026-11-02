import { useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { FileText, Plus, Search, SearchX, X } from 'lucide-react'
import { Button, Chip, EmptyState, Row, SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import WorkspaceHelp from '../../components/experience/WorkspaceHelp.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useQuotes } from '../../lib/queries.ts'
import { useNow } from '../../lib/useNow.ts'
import { QUOTE_FILTERS, quoteListView } from '../../lib/quoteListView.ts'
import { newRecordRoute, recordRoute } from '../../lib/records.ts'
import { statusChip } from '../ContactDetail/lib/quoteStatus.ts'
import { quoteStatusView, quoteTitle } from './quoteShape.ts'
import './quotes.css'

export default function QuotesList() {
  const { user } = useAuth()
  const quotes = useQuotes(user?.id)
  const [params, setParams] = useSearchParams()
  const query = params.get('q') ?? ''
  const filter = QUOTE_FILTERS.find(item => item.id === params.get('status'))?.id ?? 'all'
  const titleRef = useRef<HTMLHeadingElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const now = useNow()
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])
  const view = useMemo(() => quoteListView(quotes.data ?? [], query, filter, now.getTime()), [quotes.data, query, filter, now])
  function update(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (!value || value === 'all') next.delete(key)
    else next.set(key, value)
    setParams(next, { replace: true })
  }
  function clear() {
    const next = new URLSearchParams(params)
    next.delete('q'); next.delete('status')
    setParams(next, { replace: true })
    searchRef.current?.focus()
  }
  const known = !quotes.isPending && !quotes.isError
  return <div className="fhqt-page fhqt-page--list fh-quote-workspace">
    <header className="fhqt-list-head">
      <div><p className="fh-workspace-eyebrow">From scope to approval</p><h1 className="fhqt-list-title" ref={titleRef} tabIndex={-1}>Quotes</h1><p className="fh-workspace-subtitle">Clear proposals. Confident next steps.</p></div>
      <Button variant="primary" size="mini" icon={Plus} to={newRecordRoute('quote')}>New quote</Button>
    </header>
    <div className="fh-quote-metrics" aria-label="Quote summary">{(['draft', 'waiting', 'approved'] as const).map(id => <div key={id}><span>{id === 'draft' ? 'Drafts to finish' : id === 'waiting' ? 'Awaiting reply' : 'Approved'}</span><strong>{known ? view.counts[id] : <span aria-label={quotes.isError ? 'Unavailable' : 'Loading'}>…</span>}</strong></div>)}</div>
    <div className="fh-quote-search"><Search size={18} aria-hidden="true" /><input ref={searchRef} type="search" aria-label="Search quotes" placeholder="Search quotes" value={query} onChange={event => update('q', event.target.value)} />{query && <button type="button" aria-label="Clear quote search" onClick={() => { update('q', ''); searchRef.current?.focus() }}><X size={18} aria-hidden="true" /></button>}</div>
    <div className="fh-quote-filters" role="group" aria-label="Filter quotes">{QUOTE_FILTERS.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => update('status', item.id)}>{item.label}{known && <span>{view.counts[item.id]}</span>}</button>)}</div>
    {quotes.isError && <DataErrorState compact={Boolean(quotes.data?.length)} title={quotes.data?.length ? 'Quotes could not refresh' : 'Could not load quotes'} message={quotes.data?.length ? 'Showing saved results. Retry for current records.' : 'Check your connection and try again.'} onRetry={() => { void quotes.refetch() }} />}
    {quotes.isPending ? <div className="fhqt-loading"><SkeletonRows rows={5} label="Loading quotes" /></div> : quotes.isError && !quotes.data?.length ? null : !quotes.data?.length ? <EmptyState icon={FileText} title="No quotes yet." sub="Start with scope, pricing, and your customer." action={<Button variant="primary" icon={Plus} to={newRecordRoute('quote')}>New quote</Button>} /> : <>
      <p className="fh-quote-result-count" role="status">{view.visible.length} {view.visible.length === 1 ? 'quote' : 'quotes'}{query ? ' matching your search' : ''}</p>
      {view.visible.length ? <ul className="fhqt-rows" aria-label="Quotes">{view.visible.map(q => {
        const chip = statusChip(quoteStatusView(q))
        return <Row key={q.id} as="li" title={quoteTitle(q)} subline={q.fh_clients?.name || 'No client'} money={Number(q.amount) || 0} next={<Chip tone={chip.tone} label={chip.label} />} to={recordRoute('quote', q.id)} />
      })}</ul> : <EmptyState icon={SearchX} title="No matching quotes" sub="Try another status or customer name." action={<Button variant="secondary" onClick={clear}>Clear filters</Button>} />}
    </>}
    <WorkspaceHelp topic="quotes" />
  </div>
}
