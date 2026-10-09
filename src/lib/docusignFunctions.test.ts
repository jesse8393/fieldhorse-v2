import crypto from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// In memory stand in for the supabase-js query builder: enough of select,
// insert, update and the filters these functions use.
type Row = Record<string, any>
function fakeSupabase(tables: Record<string, Row[]>) {
  let nextId = 1
  const matchOr = (row: Row, expr: string) => expr.split(',').some((part) => {
    const [col, op, ...rest] = part.split('.')
    const value = rest.join('.')
    if (op === 'is') return value === 'null' ? row[col] == null : row[col] === value
    if (op === 'neq') return row[col] !== value
    if (op === 'eq') return row[col] === value
    return false
  })
  function from(table: string) {
    const rows = (tables[table] ||= [])
    const filters: Array<(r: Row) => boolean> = []
    let mode: 'select' | 'update' | 'insert' = 'select'
    let payload: any = null
    let returning = false
    let order: { col: string; asc: boolean } | null = null
    let limit = Infinity
    const matching = () => rows.filter((r) => filters.every((f) => f(r)))
    const run = (): { data: any; error: any } => {
      if (mode === 'insert') {
        const inserted = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: `row-${nextId++}`, ...p }))
        rows.push(...inserted)
        return { data: inserted, error: null }
      }
      if (mode === 'update') {
        const hit = matching()
        hit.forEach((r) => Object.assign(r, payload))
        return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null }
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
      eq: (col: string, v: any) => { filters.push((r) => r[col] === v); return api },
      neq: (col: string, v: any) => { filters.push((r) => r[col] !== v); return api },
      is: (col: string, v: any) => { filters.push((r) => (r[col] ?? null) === v); return api },
      or: (expr: string) => { filters.push((r) => matchOr(r, expr)); return api },
      order: (col: string, o: any) => { order = { col, asc: o?.ascending !== false }; return api },
      limit: (n: number) => { limit = n; return api },
      maybeSingle: async () => { const { data, error } = run(); return { data: data?.[0] ?? null, error } },
      single: async () => { const { data, error } = run(); return { data: data?.[0] ?? null, error: data?.[0] ? error : { message: 'no rows' } } },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject)
    }
    return api
  }
  return { from, tables }
}

let currentFake: ReturnType<typeof fakeSupabase> | null = null
vi.mock('@supabase/supabase-js', () => ({ createClient: () => currentFake }))

const { customerSignerTabs, envelopeSubject, SIGN_ANCHOR, DATE_ANCHOR, default: sendHandler } = await import('../../netlify/functions/docusign-send.js')
const { recordDocusignApproval, default: webhookHandler } = await import('../../netlify/functions/docusign-webhook.js')

// Allowed values of fh_quote_versions_approval_method_check in the live schema.
const ALLOWED_METHODS = ['verbal', 'text', 'email', 'in_person', 'signature_typed', 'signature_drawn', 'esign_link']

function jobTables(overrides: Partial<Row> = {}) {
  return {
    fh_contacts: [{ id: 'job-1', user_id: 'creator', org_id: null, name: 'Jane Customer', email: 'jane@example.com', proposal_status: 'sent', scope_text: 'Bath', ...overrides }],
    fh_quote_items: [
      { id: 'i1', contact_id: 'job-1', description: 'Tile', qty: 2, rate: 500, amount: 1000, sort_order: 1 },
      { id: 'i2', contact_id: 'job-1', description: 'Vanity', qty: 1, rate: 800, amount: null, sort_order: 2 },
      { id: 'i3', contact_id: 'job-1', description: 'Heated floor', qty: 1, rate: 600, amount: 600, is_optional: true, sort_order: 3 },
      { id: 'i4', contact_id: 'job-1', description: 'Permits', qty: 1, rate: 0, amount: 0, is_excluded: true, sort_order: 4 }
    ],
    profiles: [{ user_id: 'creator', company_name: 'Parker Construction Co.' }],
    fh_quote_versions: [{ id: 'v-old', contact_id: 'job-1', version_number: 1, status: 'approved' }],
    org_members: []
  }
}

describe('docusign-send envelope', () => {
  it('anchors both customer fields on the tokens every proposal PDF draws', () => {
    const tabs = customerSignerTabs()
    expect(tabs.signHereTabs).toHaveLength(1)
    expect(tabs.dateSignedTabs).toHaveLength(1)
    expect(tabs.signHereTabs[0]).toMatchObject({ anchorString: SIGN_ANCHOR, anchorUnits: 'mms', anchorIgnoreIfNotPresent: 'true' })
    expect(tabs.dateSignedTabs[0]).toMatchObject({ anchorString: DATE_ANCHOR, anchorUnits: 'mms', anchorIgnoreIfNotPresent: 'true' })
  })

  it('writes a plain subject and ignores a subject that is not a string', () => {
    expect(envelopeSubject(undefined, 'Bath remodel')).toBe('Please sign your proposal for Bath remodel')
    expect(envelopeSubject(42, null)).toBe('Please sign your proposal')
    expect(envelopeSubject('  Custom  ', 'x')).toBe('Custom')
    expect(envelopeSubject('x'.repeat(150), null)).toHaveLength(100)
    expect(envelopeSubject(undefined, 'Bath')).not.toMatch(/[\u2013\u2014]/)
  })
})

describe('docusign-send request validation', () => {
  beforeEach(() => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
    for (const k of ['DOCUSIGN_INTEGRATION_KEY', 'DOCUSIGN_USER_ID', 'DOCUSIGN_ACCOUNT_ID', 'DOCUSIGN_PRIVATE_KEY']) vi.stubEnv(k, 'x')
  })
  afterEach(() => { vi.unstubAllEnvs(); currentFake = null })

  const post = (body: any) => sendHandler(new Request('https://x.test/api/docusign-send', {
    method: 'POST',
    headers: { Authorization: 'Bearer token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }))

  it('answers 400, not a crash, when fields are not strings', async () => {
    for (const body of [
      { contact_id: 123, sender_user_id: 'u1', recipient_email: 'a@b.co', storage_path: 'u1/x.pdf' },
      { contact_id: 'job-1', sender_user_id: { id: 'u1' }, recipient_email: 'a@b.co', storage_path: 'u1/x.pdf' },
      { contact_id: 'job-1', sender_user_id: 'u1', recipient_email: ['a@b.co'], storage_path: 'u1/x.pdf' },
      { contact_id: 'job-1', sender_user_id: 'u1', recipient_email: 'a@b.co', storage_path: null },
      null
    ]) {
      const res = await post(body)
      expect(res.status).toBe(400)
      expect((await res.json()).error).toBe('missing_fields')
    }
  })
})

describe('DocuSign completion records the approval', () => {
  const env = { id: 'env-row', user_id: 'teammate', contact_id: 'job-1', recipient_name: 'Jane Customer', recipient_email: 'jane@example.com', status: 'delivered', sent_at: '2026-10-01T00:00:00Z' }

  it('snapshots items and totals, supersedes the old version and points the job at the new one', async () => {
    const fake = fakeSupabase(jobTables())
    const result = await recordDocusignApproval(fake as any, env, 'ENV-123', new Date('2026-10-09T12:00:00Z'))
    expect(result.ok).toBe(true)

    const versions = fake.tables.fh_quote_versions
    const created = versions.find((v) => v.id === result.versionId)!
    expect(created).toMatchObject({
      contact_id: 'job-1', user_id: 'teammate', version_number: 2, status: 'approved',
      base_total: 1800, optional_total: 600, excluded_count: 1,
      approved_by_name: 'Jane Customer', approved_by_email: 'jane@example.com',
      approved_at: '2026-10-09T12:00:00.000Z'
    })
    expect(ALLOWED_METHODS).toContain(created.approval_method)
    expect(created.snapshot).toMatchObject({ approval_origin: 'docusign', docusign: { envelope_id: 'ENV-123' } })
    expect(created.snapshot.items).toHaveLength(4)
    expect(created.snapshot.company.name).toBe('Parker Construction Co.')
    expect(versions.find((v) => v.id === 'v-old')).toMatchObject({ status: 'superseded', superseded_by: created.id })

    // The job was created by someone else than the sender and still flips.
    const job = fake.tables.fh_contacts[0]
    expect(job).toMatchObject({ proposal_status: 'approved', approved_quote_version_id: created.id })
  })

  it('keeps an approval that already exists', async () => {
    const fake = fakeSupabase(jobTables({ proposal_status: 'approved' }))
    const result = await recordDocusignApproval(fake as any, env, 'ENV-123')
    expect(result).toEqual({ ok: true, skipped: 'already_approved' })
    expect(fake.tables.fh_quote_versions).toHaveLength(1)
  })

  it('runs from a signed Connect event and notifies the sender', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://example.supabase.co')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'service')
    vi.stubEnv('DOCUSIGN_CONNECT_HMAC_KEY', 'hmac-secret')
    currentFake = fakeSupabase({
      ...jobTables(),
      fh_esign_envelopes: [{ ...env, envelope_id: 'ENV-123' }],
      fh_notifications: []
    })
    const raw = JSON.stringify({ event: 'envelope-completed', data: { envelopeId: 'ENV-123', envelopeSummary: { status: 'completed' } } })
    const sig = crypto.createHmac('sha256', 'hmac-secret').update(raw, 'utf8').digest('base64')
    const res = await webhookHandler(new Request('https://x.test/api/docusign-webhook', { method: 'POST', headers: { 'x-docusign-signature-1': sig }, body: raw }))
    expect(res.status).toBe(200)
    const t = currentFake.tables
    expect(t.fh_esign_envelopes[0].status).toBe('completed')
    expect(t.fh_contacts[0].proposal_status).toBe('approved')
    expect(t.fh_quote_versions.filter((v) => v.status === 'approved')).toHaveLength(1)
    expect(t.fh_notifications).toHaveLength(1)
    vi.unstubAllEnvs()
    currentFake = null
  })
})
