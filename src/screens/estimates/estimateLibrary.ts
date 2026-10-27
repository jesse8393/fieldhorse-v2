import type { Json } from '../../lib/database.types.ts'
import { preferenceObject } from '../../lib/profilePreferences.ts'
import type { QuoteWithClient } from '../quotes/quoteShape.ts'

export type TemplateCategory = 'reusable' | 'imported'
export type TemplatePreferences = { favorite: boolean; category: TemplateCategory }

export function templatePreferences(preferences: unknown, id: string): TemplatePreferences {
  const root = preferenceObject(preferences)
  const templates = preferenceObject(root.estimate_library)
  const entry = preferenceObject(templates[id])
  return { favorite: entry.favorite === true, category: entry.category === 'imported' ? 'imported' : 'reusable' }
}

export function changeTemplatePreferences(preferences: Record<string, Json | undefined>, id: string, patch: Partial<TemplatePreferences>): Record<string, Json | undefined> {
  return { ...preferences, estimate_library: { ...preferenceObject(preferences.estimate_library), [id]: { ...templatePreferences(preferences, id), ...patch } } }
}

export const QUOTE_FILTERS = [
  { id: 'all', label: 'All quotes' },
  { id: 'draft', label: 'Drafts' },
  { id: 'waiting', label: 'Awaiting reply' },
  { id: 'changes_requested', label: 'Needs revision' },
  { id: 'approved', label: 'Approved' },
  { id: 'converted', label: 'Converted to jobs' },
  { id: 'closed', label: 'Declined or expired' }
] as const
export type QuoteFilter = typeof QUOTE_FILTERS[number]['id']

export function quoteBucket(quote: Pick<QuoteWithClient, 'job_id' | 'status'> & { expires_at?: string | null }): QuoteFilter {
  if (quote.job_id) return 'converted'
  if (quote.status === 'sent' || quote.status === 'viewed') return quote.expires_at && new Date(quote.expires_at).getTime() < Date.now() ? 'closed' : 'waiting'
  if (quote.status === 'rejected' || quote.status === 'expired' || quote.status === 'lost') return 'closed'
  return quote.status === 'approved' || quote.status === 'changes_requested' ? quote.status : 'draft'
}

export function filterQuoteLibrary(quotes: QuoteWithClient[], query: string, status: QuoteFilter, sort: string): QuoteWithClient[] {
  const needle = query.trim().toLocaleLowerCase()
  return quotes.filter(quote => (status === 'all' || quoteBucket(quote) === status)
    && (!needle || [quote.title, quote.scope_text, quote.fh_clients?.name, quote.id].filter(Boolean).join(' ').toLocaleLowerCase().includes(needle)))
    .sort((a, b) => sort === 'value' ? Number(b.amount || 0) - Number(a.amount || 0)
      : sort === 'customer' ? (a.fh_clients?.name || '').localeCompare(b.fh_clients?.name || '')
        : new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
}
