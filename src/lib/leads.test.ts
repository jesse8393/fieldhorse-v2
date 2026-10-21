import { beforeEach, describe, expect, it, vi } from 'vitest'

type Call = [string, ...unknown[]]
const responses: { data: unknown; error: unknown }[] = []
const builders: Call[][] = []

function builder(): unknown {
  const calls: Call[] = []
  builders.push(calls)
  const response = responses.shift() ?? { data: null, error: null }
  const proxy: unknown = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(response).then(resolve, reject)
      }
      return (...args: unknown[]) => {
        calls.push([String(prop), ...args])
        return proxy
      }
    },
  })
  return proxy
}

vi.mock('./supabase.ts', () => ({ supabase: { from: (table: string) => { const b = builder(); builders[builders.length - 1].push(['from', table]); return b } } }))

const { createLead, leadToQuoteDraft, markLeadLost, markLeadQuoted } = await import('./leads.ts')

function callsOf(index: number, method: string) {
  return builders[index].filter((c) => c[0] === method)
}

beforeEach(() => {
  responses.length = 0
  builders.length = 0
})

const lead = {
  id: 'lead-1',
  client_id: 'client-1',
  title: 'Deck rebuild',
  job_type: 'deck',
  notes: 'Wants cedar, call after 5',
  source: 'referral',
  referred_by: 'Bob',
  status: 'open',
  quote_id: null,
  follow_up_on: null,
  last_contact: null,
  org_id: 'org-1',
  origin_contact_id: null,
  user_id: 'user-1',
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
}

describe('leadToQuoteDraft', () => {
  it('copies the client, title, job type and notes and points at the lead', () => {
    const draft = leadToQuoteDraft(lead)
    expect(draft.client_id).toBe('client-1')
    expect(draft.title).toBe('Deck rebuild')
    expect(draft.job_type).toBe('deck')
    expect(draft.scope_text).toBe('Wants cedar, call after 5')
    expect(draft.lead_id).toBe('lead-1')
  })

  it('leaves missing fields null', () => {
    const draft = leadToQuoteDraft({ ...lead, title: null, job_type: null, notes: null })
    expect(draft.title).toBeNull()
    expect(draft.job_type).toBeNull()
    expect(draft.scope_text).toBeNull()
  })
})

describe('createLead', () => {
  it('inserts an open lead and returns the row', async () => {
    responses.push({ data: { ...lead }, error: null })
    const row = await createLead({ userId: 'user-1', orgId: 'org-1', clientId: 'client-1', title: '  Deck rebuild ', notes: 'Wants cedar, call after 5' })
    expect(row.id).toBe('lead-1')
    expect(callsOf(0, 'from')[0][1]).toBe('fh_leads')
    const inserted = callsOf(0, 'insert')[0][1] as Record<string, unknown>
    expect(inserted).toMatchObject({ user_id: 'user-1', org_id: 'org-1', client_id: 'client-1', title: 'Deck rebuild', status: 'open' })
    expect(inserted.source).toBeNull()
  })

  it('throws when the insert fails', async () => {
    responses.push({ data: null, error: { message: 'boom' } })
    await expect(createLead({ userId: 'u', orgId: 'o', clientId: 'c' })).rejects.toThrow('boom')
  })
})

describe('markLeadQuoted', () => {
  it('sets the status and the quote id', async () => {
    await markLeadQuoted('lead-1', 'quote-9')
    expect(callsOf(0, 'from')[0][1]).toBe('fh_leads')
    expect(callsOf(0, 'update')[0][1]).toMatchObject({ status: 'quoted', quote_id: 'quote-9' })
    expect(callsOf(0, 'eq')[0]).toEqual(['eq', 'id', 'lead-1'])
  })
})

describe('markLeadLost', () => {
  it('sets the status to lost', async () => {
    await markLeadLost('lead-1')
    expect(callsOf(0, 'update')[0][1]).toMatchObject({ status: 'lost' })
    expect(callsOf(0, 'eq')[0]).toEqual(['eq', 'id', 'lead-1'])
  })
})
