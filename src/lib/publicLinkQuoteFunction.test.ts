// The customer link, send and approve read the quote (PHASE9_PLAN Task 11).
// A proposal link that carries quote_id loads fh_quotes with its client,
// lines and versions by quote id; approving and asking for changes write
// the quote's own status fields; the number on the document is seeded by
// the quote id. The contact paths stay for links minted before quotes had
// a table of their own.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In memory stand in for the supabase-js query builder, the same pattern
// docusignFunctions.test.ts uses, plus in, match, rpc and storage.
type Row = Record<string, any>

// Splits a PostgREST or() expression on the commas between clauses, not
// the ones inside an in.(a,b) list.
function orClauses(expr: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of expr) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function fakeSupabase(tables: Record<string, Row[]>) {
  let nextId = 1
  const matchOr = (row: Row, expr: string) => orClauses(expr).some((part) => {
    const [col, op, ...rest] = part.split('.')
    const value = rest.join('.')
    if (op === 'is') return value === 'null' ? row[col] == null : row[col] === value
    if (op === 'neq') return row[col] !== value
    if (op === 'eq') return row[col] === value
    if (op === 'in') return value.replace(/^\(|\)$/g, '').split(',').includes(String(row[col]))
    return false
  })
  function from(table: string) {
    const rows = (tables[table] ||= [])
    const filters: Array<(r: Row) => boolean> = []
    let mode: 'select' | 'update' | 'insert' | 'delete' = 'select'
    let payload: any = null
    let returning = false
    let order: { col: string; asc: boolean } | null = null
    let limit = Infinity
    const matching = () => rows.filter((r) => filters.every((f) => f(r)))
    const run = (): { data: any; error: any } => {
      if (mode === 'insert') {
        const inserted = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: `row-${nextId++}`, created_at: new Date().toISOString(), ...p }))
        rows.push(...inserted)
        return { data: inserted, error: null }
      }
      if (mode === 'update') {
        const hit = matching()
        hit.forEach((r) => Object.assign(r, payload))
        return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null }
      }
      if (mode === 'delete') {
        const hit = matching()
        tables[table] = rows.filter((r) => !hit.includes(r))
        return { data: null, error: null }
      }
      let out = matching()
      if (order) {
        const { col, asc } = order
        out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
      }
      return { data: out.slice(0, limit).map((r) => ({ ...r })), error: null }
    }
    const api: any = {
      select: () => { returning = true; return api },
      insert: (p: any) => { mode = 'insert'; payload = p; return api },
      update: (p: any) => { mode = 'update'; payload = p; return api },
      delete: () => { mode = 'delete'; return api },
      eq: (col: string, v: any) => { filters.push((r) => r[col] === v); return api },
      neq: (col: string, v: any) => { filters.push((r) => r[col] !== v); return api },
      is: (col: string, v: any) => { filters.push((r) => (r[col] ?? null) === v); return api },
      in: (col: string, vs: any[]) => { filters.push((r) => vs.includes(r[col])); return api },
      match: (obj: Row) => { filters.push((r) => Object.entries(obj).every(([k, v]) => r[k] === v)); return api },
      or: (expr: string) => { filters.push((r) => matchOr(r, expr)); return api },
      order: (col: string, o: any) => { order = { col, asc: o?.ascending !== false }; return api },
      limit: (n: number) => { limit = n; return api },
      maybeSingle: async () => { const { data, error } = run(); return { data: data?.[0] ?? null, error } },
      single: async () => { const { data, error } = run(); return { data: data?.[0] ?? null, error: data?.[0] ? error : { message: 'no rows' } } },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject)
    }
    return api
  }
  const rpcCalls: Array<{ name: string; params: any }> = []
  const rpc = async (name: string, params: any) => {
    rpcCalls.push({ name, params })
    if (name === 'fh_increment_rate_limit') return { data: [{ request_count: 1, allowed: true }], error: null }
    return { data: null, error: null }
  }
  const storage = { from: () => ({ createSignedUrls: async () => ({ data: [], error: null }) }) }
  return { from, rpc, storage, tables, rpcCalls }
}

let currentFake: ReturnType<typeof fakeSupabase> | null = null
vi.mock('@supabase/supabase-js', () => ({ createClient: () => currentFake }))
vi.mock('../../netlify/functions/lib/push.js', () => ({ sendPushToUser: async () => {} }))

const { default: linkHandler, quoteStage } = await import('../../netlify/functions/public-link.js')
const { default: approveHandler } = await import('../../netlify/functions/public-link-approve.js')
const { default: changesHandler } = await import('../../netlify/functions/public-link-request-changes.js')
const { buildQuoteSendPatch } = await import('../../netlify/functions/send-quote.js')
const { recordDocusignApproval } = await import('../../netlify/functions/docusign-webhook.js')

const QUOTE_ID = 'q-portal'

function quoteTables(quote: Partial<Row> = {}, extra: Record<string, Row[]> = {}) {
  return {
    fh_public_links: [{
      id: 'link-1', token: 't1', kind: 'proposal', user_id: 'owner', org_id: 'org-1',
      contact_id: null, quote_id: QUOTE_ID, client_id: null, change_order_id: null,
      revoked_at: null, expires_at: null, last_viewed_at: null, view_count: 0
    }],
    fh_quotes: [{
      id: QUOTE_ID, user_id: 'owner', org_id: 'org-1', client_id: 'cl-1', lead_id: null, job_id: null,
      title: 'Pool deck pour', job_type: 'Concrete', scope_text: 'Pour and finish', terms_text: null,
      exclusions_text: null, amount: 3000, status: 'sent', sent_at: '2026-10-02T12:00:00.000Z',
      expires_at: null, change_request_note: null, change_requested_at: null, approved_version_id: null,
      created_at: '2026-10-01T12:00:00.000Z', ...quote
    }],
    fh_clients: [{ id: 'cl-1', org_id: 'org-1', user_id: 'owner', name: 'Marco Castellanos', phone: '615 555 0101', email: 'marco@example.com', address: '1150 Cherry Blossom Ln', created_at: '2026-09-01T00:00:00.000Z' }],
    fh_quote_items: [
      { id: 'i1', quote_id: QUOTE_ID, contact_id: null, description: 'Excavate', qty: 1, rate: 1000, amount: 1000, sort_order: 1 },
      { id: 'i2', quote_id: QUOTE_ID, contact_id: null, description: 'Pour', qty: 1, rate: 2000, amount: 2000, sort_order: 2 },
      { id: 'i3', quote_id: QUOTE_ID, contact_id: null, description: 'Sealer', qty: 1, rate: 400, amount: 400, is_optional: true, sort_order: 3 },
      // A line on some job, never on this quote.
      { id: 'j1', quote_id: null, contact_id: 'job-9', description: 'Other job', qty: 1, rate: 50, amount: 50, sort_order: 1 }
    ],
    fh_quote_versions: [],
    fh_contacts: [],
    fh_payments: [],
    fh_change_orders: [],
    fh_invoices: [],
    fh_job_files: [],
    fh_insurance_claims: [],
    fh_notifications: [],
    fh_notes: [],
    profiles: [{ user_id: 'owner', company_name: 'Parker Construction', estimate_template: 'fieldhorse' }],
    org_members: [{ org_id: 'org-1', user_id: 'owner', role: 'owner', revoked_at: null, joined_at: '2026-01-01T00:00:00.000Z' }],
    ...extra
  }
}

beforeEach(() => {
  vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
})
afterEach(() => { vi.unstubAllEnvs(); currentFake = null })

const getLink = (token = 't1') => linkHandler(new Request(`https://x.test/api/public-link?token=${token}`))
const postApprove = (body: Row) => approveHandler(new Request('https://x.test/api/public-link-approve', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}))
const postChanges = (body: Row) => changesHandler(new Request('https://x.test/api/public-link-request-changes', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
}))

describe('a proposal link with quote_id', () => {
  it('loads the quote and its items', async () => {
    currentFake = fakeSupabase(quoteTables())
    const res = await getLink()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.kind).toBe('proposal')
    expect(body.quote_id).toBe(QUOTE_ID)
    expect(body.status).toBe('sent')
    // Only the quote's lines, in order.
    expect(body.items.map((i: Row) => i.id)).toEqual(['i1', 'i2', 'i3'])
    // The same payload shape the contact path returns, so the page keeps
    // working: the client stands in for the contact, the quote for the job.
    expect(body.contact).toMatchObject({
      id: QUOTE_ID,
      name: 'Marco Castellanos',
      email: 'marco@example.com',
      address: '1150 Cherry Blossom Ln',
      job_title: 'Pool deck pour',
      stage: 'quote',
      proposal_status: 'sent',
      quote_sent_at: '2026-10-02T12:00:00.000Z',
      scope_text: 'Pour and finish',
      amount: 3000
    })
    expect(body.company.name).toBe('Parker Construction')
    // The view was recorded against the link.
    expect(currentFake.rpcCalls.map((c) => c.name)).toContain('fh_record_public_link_view')
  })

  it('maps the quote status to a stage the portal already reads', () => {
    expect(quoteStage({ status: 'sent', job_id: null }, null)).toBe('quote')
    expect(quoteStage({ status: 'lost', job_id: null }, null)).toBe('lost')
    expect(quoteStage({ status: 'rejected', job_id: null }, null)).toBe('lost')
    // An approved quote whose job was closed out reads as a finished job.
    expect(quoteStage({ status: 'approved', job_id: 'job-1' }, { stage: 'closed' })).toBe('closed')
    expect(quoteStage({ status: 'approved', job_id: 'job-1' }, { stage: 'job' })).toBe('job')
    expect(quoteStage({ status: 'approved', job_id: null }, null)).toBe('quote')
  })

  it('carries the approval from the quote version', async () => {
    currentFake = fakeSupabase(quoteTables(
      { status: 'approved', approved_version_id: 'v-1' },
      { fh_quote_versions: [{ id: 'v-1', quote_id: QUOTE_ID, contact_id: null, status: 'approved', approved_by_name: 'Marco Castellanos', approved_at: '2026-10-10T14:00:00.000Z', version_number: 1 }] }
    ))
    const body = await (await getLink()).json()
    expect(body.status).toBe('approved')
    expect(body.contact.approved_by_name).toBe('Marco Castellanos')
    expect(body.contact.approved_at).toBe('2026-10-10T14:00:00.000Z')
  })

  it('still answers gone when the quote belongs to another company', async () => {
    currentFake = fakeSupabase(quoteTables({ org_id: 'org-2' }))
    const res = await getLink()
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('gone')
  })
})

describe('approving a quote through its link', () => {
  it('writes fh_quotes.status and approved_version_id', async () => {
    currentFake = fakeSupabase(quoteTables())
    const res = await postApprove({ token: 't1', signature_name: 'Marco Castellanos' })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body).toMatchObject({ ok: true, version_number: 1, signed_by: 'Marco Castellanos' })

    const t = currentFake.tables
    const version = t.fh_quote_versions[0]
    expect(version).toMatchObject({
      quote_id: QUOTE_ID, status: 'approved', version_number: 1,
      base_total: 3000, optional_total: 400, excluded_count: 0,
      approved_by_name: 'Marco Castellanos', approved_by_email: 'marco@example.com'
    })
    expect(version.contact_id ?? null).toBeNull()
    expect(t.fh_quotes[0]).toMatchObject({ status: 'approved', approved_version_id: version.id })
    expect(t.fh_notifications[0].link).toBe(`/quotes/${QUOTE_ID}`)
  })

  it('the quote number uses the quote id', async () => {
    currentFake = fakeSupabase(quoteTables())
    await postApprove({ token: 't1', signature_name: 'Marco Castellanos' })
    const snapshot = currentFake.tables.fh_quote_versions[0].snapshot
    expect(snapshot.quote_number).toBe('PC-2026-RTAL')
    expect(snapshot.quote.id).toBe(QUOTE_ID)
  })

  it('keeps every refusal rule', async () => {
    currentFake = fakeSupabase(quoteTables({ status: 'approved' }))
    expect((await postApprove({ token: 't1', signature_name: 'M' })).status).toBe(409)

    currentFake = fakeSupabase(quoteTables({ status: 'lost' }))
    let res = await postApprove({ token: 't1', signature_name: 'M' })
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('not_approvable')

    currentFake = fakeSupabase(quoteTables({ expires_at: '2020-01-01T00:00:00.000Z' }))
    res = await postApprove({ token: 't1', signature_name: 'M' })
    expect(res.status).toBe(410)
    expect((await res.json()).error).toBe('quote_expired')

    currentFake = fakeSupabase(quoteTables({ status: 'expired' }))
    expect((await postApprove({ token: 't1', signature_name: 'M' })).status).toBe(410)

    currentFake = fakeSupabase(quoteTables({}, { fh_quote_items: [] }))
    res = await postApprove({ token: 't1', signature_name: 'M' })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('empty_proposal')
    expect(currentFake.tables.fh_quotes[0].status).toBe('sent')
  })

  it('supersedes an earlier approved version of the same quote', async () => {
    currentFake = fakeSupabase(quoteTables(
      { status: 'changes_requested' },
      { fh_quote_versions: [{ id: 'v-old', quote_id: QUOTE_ID, version_number: 3, status: 'approved' }] }
    ))
    const res = await postApprove({ token: 't1', signature_name: 'Marco' })
    expect(res.status).toBe(200)
    const versions = currentFake.tables.fh_quote_versions
    const created = versions.find((v) => v.id !== 'v-old')!
    expect(created.version_number).toBe(4)
    expect(versions.find((v) => v.id === 'v-old')).toMatchObject({ status: 'superseded', superseded_by: created.id })
  })
})

describe('asking for changes through a quote link', () => {
  it('writes the change request on the quote', async () => {
    currentFake = fakeSupabase(quoteTables())
    const res = await postChanges({ token: 't1', requester_name: 'Marco', request_text: 'Please add the sealer.' })
    expect(res.status).toBe(200)
    const t = currentFake.tables
    expect(t.fh_quotes[0]).toMatchObject({ status: 'changes_requested', change_request_note: 'Please add the sealer.' })
    expect(t.fh_quotes[0].change_requested_at).toBeTruthy()
    expect(t.fh_notes[0]).toMatchObject({ quote_id: QUOTE_ID, category: 'activity' })
    expect(t.fh_notifications[0].link).toBe(`/quotes/${QUOTE_ID}`)
  })

  it('refuses once approved, lost or made into a job', async () => {
    currentFake = fakeSupabase(quoteTables({ status: 'approved' }))
    expect((await postChanges({ token: 't1', requester_name: 'M', request_text: 'Change it.' })).status).toBe(409)
    currentFake = fakeSupabase(quoteTables({ status: 'lost' }))
    expect((await postChanges({ token: 't1', requester_name: 'M', request_text: 'Change it.' })).status).toBe(410)
    currentFake = fakeSupabase(quoteTables({ job_id: 'job-1' }))
    expect((await postChanges({ token: 't1', requester_name: 'M', request_text: 'Change it.' })).status).toBe(410)
  })
})

describe('sending a quote', () => {
  it('marks the quote sent unless it is already decided', () => {
    const sentAtIso = '2026-10-10T14:00:00.000Z'
    expect(buildQuoteSendPatch({ status: 'draft', sentAtIso })).toEqual({ status: 'sent', sent_at: sentAtIso })
    expect(buildQuoteSendPatch({ status: 'changes_requested', sentAtIso })).toEqual({ status: 'sent', sent_at: sentAtIso })
    expect(buildQuoteSendPatch({ status: 'approved', sentAtIso })).toEqual({ status: 'approved', sent_at: sentAtIso })
    expect(buildQuoteSendPatch({ status: 'lost', sentAtIso })).toEqual({ status: 'lost', sent_at: sentAtIso })
  })
})

describe('a DocuSign completion on a quote envelope', () => {
  it('records the approval on the quote', async () => {
    const fake = fakeSupabase(quoteTables())
    const env = { id: 'env-row', user_id: 'owner', contact_id: null, quote_id: QUOTE_ID, recipient_name: 'Marco Castellanos', recipient_email: 'marco@example.com', status: 'delivered', sent_at: '2026-10-01T00:00:00Z' }
    const result = await recordDocusignApproval(fake as any, env, 'ENV-9', new Date('2026-10-09T12:00:00Z'))
    expect(result.ok).toBe(true)
    const version = fake.tables.fh_quote_versions.find((v) => v.id === result.versionId)!
    expect(version).toMatchObject({ quote_id: QUOTE_ID, status: 'approved', base_total: 3000, optional_total: 400 })
    expect(version.snapshot.quote_number).toBe('PC-2026-RTAL')
    expect(fake.tables.fh_quotes[0]).toMatchObject({ status: 'approved', approved_version_id: version.id })
  })

  it('keeps an approval that already exists', async () => {
    const fake = fakeSupabase(quoteTables({ status: 'approved' }))
    const env = { id: 'env-row', user_id: 'owner', contact_id: null, quote_id: QUOTE_ID, recipient_name: 'M', recipient_email: null, status: 'delivered', sent_at: null }
    expect(await recordDocusignApproval(fake as any, env, 'ENV-9')).toEqual({ ok: true, skipped: 'already_approved' })
    expect(fake.tables.fh_quote_versions).toHaveLength(0)
  })
})
