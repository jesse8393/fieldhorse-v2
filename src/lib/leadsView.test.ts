import { describe, expect, it } from 'vitest'
import {
  buildLeadRows, buildQuoteRows, followUpLine, leadChip, listedLeads, nextVisitByLead, sortLeads, visitDay
} from './leadsView.ts'
import type { LeadRow, QuoteRow } from './queries.ts'

const CLIENT = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: null, address: '412 Burkitt Station Rd' }
const NOW = new Date(2026, 9, 8, 10, 0, 0)

function lead(partial: Partial<LeadRow>): LeadRow {
  return {
    id: 'l', user_id: 'u', org_id: 'o', client_id: 'cl-1', origin_contact_id: null, title: null, notes: null,
    source: null, referred_by: null, job_type: null, follow_up_on: null, last_contact: null, quote_id: null,
    status: 'open', created_at: '2026-10-01T12:00:00.000Z', updated_at: '2026-10-01T12:00:00.000Z',
    fh_clients: CLIENT, ...partial
  }
}

function quote(partial: Partial<QuoteRow>): QuoteRow {
  return {
    id: 'q', user_id: 'u', org_id: 'o', client_id: 'cl-1', origin_contact_id: null, lead_id: null, job_id: null,
    title: null, job_type: null, scope_text: null, terms_text: null, exclusions_text: null, amount: 0,
    status: 'draft', sent_at: null, expires_at: null, approved_version_id: null, change_request_note: null,
    change_requested_at: null, created_at: '2026-10-01T12:00:00.000Z', updated_at: '2026-10-01T12:00:00.000Z',
    fh_clients: CLIENT, ...partial
  }
}

describe('sortLeads', () => {
  it('puts the soonest follow up first, no date last, then the newest', () => {
    const rows = sortLeads([
      lead({ id: 'none-old', created_at: '2026-09-01T00:00:00.000Z' }),
      lead({ id: 'none-new', created_at: '2026-10-01T00:00:00.000Z' }),
      lead({ id: 'later', follow_up_on: '2026-10-12' }),
      lead({ id: 'soon', follow_up_on: '2026-10-09' })
    ])
    expect(rows.map((r) => r.id)).toEqual(['soon', 'later', 'none-new', 'none-old'])
  })
})

describe('listedLeads', () => {
  it('keeps open and quoted leads and drops lost ones', () => {
    const rows = listedLeads([lead({ id: 'a' }), lead({ id: 'b', status: 'quoted' }), lead({ id: 'c', status: 'lost' })])
    expect(rows.map((r) => r.id)).toEqual(['a', 'b'])
  })
})

describe('nextVisitByLead and leadChip', () => {
  it('finds the soonest visit from now on and names the chip', () => {
    const visits = nextVisitByLead([
      { lead_id: 'a', start_at: '2026-10-12T14:00:00.000Z' },
      { lead_id: 'a', start_at: '2026-10-10T14:00:00.000Z' },
      { lead_id: 'a', start_at: '2026-10-01T14:00:00.000Z' },
      { lead_id: null, start_at: '2026-10-09T14:00:00.000Z' }
    ], NOW)
    expect(visits.get('a')?.toISOString()).toBe('2026-10-10T14:00:00.000Z')
    expect(leadChip({ status: 'open' }, visits.get('a'))).toEqual({ label: 'Estimate booked', tone: 'info' })
    expect(leadChip({ status: 'open' }, undefined)).toBeNull()
    expect(leadChip({ status: 'quoted' }, undefined)).toEqual({ label: 'Quoted', tone: 'success' })
    expect(leadChip({ status: 'lost' }, visits.get('a'))).toEqual({ label: 'Lost', tone: 'neutral' })
  })

  it('writes the day without a year and no dash', () => {
    expect(visitDay(new Date(2026, 9, 10, 9))).toBe('Sat, Oct 10')
  })
})

describe('followUpLine', () => {
  it('says today, a past day or a coming day', () => {
    expect(followUpLine({ follow_up_on: '2026-10-08' }, NOW)).toBe('Follow up today')
    expect(followUpLine({ follow_up_on: '2026-10-02' }, NOW)).toBe('Follow up was Oct 2')
    expect(followUpLine({ follow_up_on: '2026-10-12' }, NOW)).toBe('Follow up Oct 12')
    expect(followUpLine({ follow_up_on: null }, NOW)).toBeNull()
  })
})

describe('buildLeadRows and buildQuoteRows', () => {
  it('links each row to its own record and narrows by the search', () => {
    const rows = buildLeadRows([lead({ id: 'a', title: 'Drainage' }), lead({ id: 'b', title: 'Patio' })], { search: 'pat', now: NOW })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ id: 'b', title: 'Jeff Roy', subline: 'Patio', to: '/leads/b', money: null })
  })

  it('shows quote money only to roles that may see it, and no lost quotes', () => {
    const quotes = [quote({ id: 'a', title: 'Repour', amount: 46200, status: 'sent' }), quote({ id: 'b', status: 'lost' })]
    const shown = buildQuoteRows(quotes, { showMoney: true })
    expect(shown).toHaveLength(1)
    expect(shown[0]).toMatchObject({ to: '/quotes/a', money: '$46,200.00', chip: { label: 'Sent', tone: 'info' } })
    expect(buildQuoteRows(quotes, { showMoney: false })[0].money).toBeNull()
  })
})
