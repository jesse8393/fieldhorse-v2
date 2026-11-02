import { quoteStatusView, quoteTitle, type QuoteWithClient } from '../screens/quotes/quoteShape.ts'

export const QUOTE_FILTERS = [
  { id: 'all', label: 'All' }, { id: 'draft', label: 'Drafts' },
  { id: 'waiting', label: 'Awaiting reply' }, { id: 'approved', label: 'Approved' },
  { id: 'attention', label: 'Needs attention' }
] as const
export type QuoteFilter = typeof QUOTE_FILTERS[number]['id']

export function quoteListView(rows: QuoteWithClient[], query: string, filter: QuoteFilter, now = Date.now()) {
  const counts: Record<QuoteFilter, number> = { all: rows.length, draft: 0, waiting: 0, approved: 0, attention: 0 }
  const needle = query.trim().toLocaleLowerCase()
  const visible = rows.filter(row => {
    const status = quoteStatusView(row, now).label.toLowerCase()
    const bucket = status === 'expired' || status === 'changes requested' ? 'attention'
      : status === 'sent' || status === 'viewed' ? 'waiting'
      : status === 'approved' ? 'approved' : status === 'draft' ? 'draft' : null
    if (bucket) counts[bucket] += 1
    return (filter === 'all' || filter === bucket) &&
      [quoteTitle(row), row.fh_clients?.name ?? '', row.scope_text ?? ''].join(' ').toLocaleLowerCase().includes(needle)
  })
  return { counts, visible }
}
