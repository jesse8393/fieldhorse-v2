// scripts/qa-mock.mjs — shared hermetic Supabase mock for the QA rig.
// One backend simulation used by qa-tour.mjs (route screenshots) and
// qa-interact.mjs (sheet/drawer/overlay states). Everything is
// intercepted at the network layer; zero real network.

export const USER = { id: 'qa-user-1', email: 'qa@fieldhorse.local', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
const now = Date.now()
const day = 86400000
const iso = (d) => new Date(d).toISOString()
const CLIENT = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }
const contacts = [
  { id: 'c-lead1', stage: 'lead',    name: 'Justin Bryan',     job_title: 'Vintage Burkitt Station Drainage', amount: 24400, follow_up_on: iso(now - 10 * day).slice(0, 10), referred_by: 'Google', job_type: 'Drainage' },
  { id: 'c-lead2', stage: 'lead',    name: 'Lily Grace North', job_title: 'Retaining wall + pad', amount: 18750, referred_by: 'Referral', job_type: 'Concrete' },
  { id: 'c-quote', stage: 'quote',   name: 'MMC Properties',   job_title: 'Parking lot repour', amount: 46200, proposal_status: 'sent' },
  { id: 'c-job1',  stage: 'job',     name: 'Plumbing Bellevue', job_title: 'Slab + trench', amount: 33100 },
  { id: 'c-job2',  stage: 'invoice', name: 'Harold Wickham',   job_title: 'Driveway replacement', amount: 12800 },
  { id: 'c-done',  stage: 'closed',  name: 'Danielle Ortiz',   job_title: 'Patio + walkway', amount: 9600, completed_at: iso(now - 20 * day) },
  { id: 'c-lost',  stage: 'lost',    name: 'Old Mill HOA',     job_title: 'Culvert bid', amount: 15000 }
].map((c, i) => ({
  user_id: USER.id, client_id: 'cl-1', phone: '555-0101', email: 'x@y.com',
  address: '412 Burkitt Station Rd', notes: null, scope_text: null, milestones: [],
  created_at: iso(now - (30 - i) * day), updated_at: iso(now - i * day),
  proposal_status: null, follow_up_on: null, completed_at: null, invoice_no: null,
  client_name: CLIENT.name, fh_clients: CLIENT, ...c
}))

const payments = [
  { id: 'p1', user_id: USER.id, contact_id: 'c-job2', amount: 6400, method: 'check', reference: '1042', paid_on: iso(now - 6 * day).slice(0, 10), created_at: iso(now - 6 * day) }
]
const invoices = [
  { id: 'inv1', user_id: USER.id, contact_id: 'c-job2', title: 'Progress draw 1', amount: 6400, status: 'sent', sequence_number: 1, issued_at: iso(now - 8 * day), due_at: iso(now + 6 * day), created_at: iso(now - 8 * day) }
]
const schedule = [
  { id: 's1', user_id: USER.id, contact_id: 'c-job1', title: 'Pour slab — crew A', description: 'Bellevue site', start_at: iso(now + 2 * 3600e3), end_at: iso(now + 6 * 3600e3), created_at: iso(now - day) }
]
const notesRows = [
  { id: 'n1', user_id: USER.id, contact_id: 'c-job1', text: 'Inspector confirmed Friday.', category: 'note', created_at: iso(now - 2 * day) }
]

const TABLES = {
  profiles: [{ user_id: USER.id, full_name: 'Jesse Parker', company_name: 'Parker Construction Company', onboarded_at: iso(now - 90 * day), logo_url: null, location_lat: 35.84, location_lon: -86.36, services: ['Concrete'], company_email: 'office@parker.co', brand_accent_hex: null }],
  org_members: [{ id: 'm1', org_id: 'org-1', user_id: USER.id, role: 'owner', revoked_at: null, joined_at: iso(now - 90 * day), default_hourly_rate: null, status: 'active' }],
  organizations: [{ id: 'org-1', name: 'Parker Construction', created_at: iso(now - 90 * day) }],
  fh_contacts: contacts,
  fh_clients: [{ ...CLIENT, user_id: USER.id, company_name: null, address: '412 Burkitt Station Rd', created_at: iso(now - 60 * day) }],
  fh_payments: payments,
  fh_invoices: invoices,
  fh_change_orders: [],
  fh_schedule: schedule,
  fh_notes: notesRows,
  fh_subs: [], fh_expenses: [], fh_inspections: [], fh_job_todos: [],
  fh_insurance_claims: [], fh_stage_transitions: [], fh_notifications: [],
  fh_public_links: [], fh_partnerships: [], fh_push_subscriptions: [],
  fh_documents: [], fh_files: []
}

function applyFilters(rows, url) {
  // Honor PostgREST eq./is.null query filters so .eq('id', x).maybeSingle()
  // resolves the right row instead of erroring on a multi-row response.
  const params = new URL(url).searchParams
  let out = rows
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3))
    else if (v === 'is.null') out = out.filter((r) => r[k] == null)
  }
  return out
}

function restResponse(url, headers) {
  const path = new URL(url).pathname
  const table = path.split('/rest/v1/')[1]?.split('?')[0] || ''
  if (path.includes('/rpc/')) return { status: 200, body: JSON.stringify([]) }
  const rows = applyFilters(TABLES[table] ?? [], url)
  const wantsObject = (headers['accept'] || '').includes('vnd.pgrst.object')
  if (wantsObject) {
    if (rows.length === 0) return { status: 406, body: JSON.stringify({ message: 'no rows' }) }
    return { status: 200, body: JSON.stringify(rows[0]) }
  }
  return { status: 200, body: JSON.stringify(rows) }
}


export const session = {
  access_token: 'qa.fake.token', refresh_token: 'qa-refresh', token_type: 'bearer',
  expires_in: 86400, expires_at: Math.floor(now / 1000) + 86400, user: USER
}


export async function installMock(ctx) {
  await ctx.route((u) => u.hostname === 'qa-mock.supabase.co', async (route) => {
    const req = route.request()
    const url = req.url()
    if (url.includes('/auth/v1/user')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) })
    if (url.includes('/auth/v1/token')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) })
    if (url.includes('/auth/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    if (url.includes('/realtime/')) return route.abort()
    if (url.includes('/storage/')) return route.fulfill({ status: 404, body: '' })
    if (url.includes('/rest/v1/')) {
      const r = restResponse(url, req.headers())
      return route.fulfill({ status: r.status, contentType: 'application/json', body: r.body, headers: { 'content-range': '0-9/10' } })
    }
    return route.fulfill({ status: 200, body: '{}' })
  })
  await ctx.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
}
