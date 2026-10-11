// scripts/qa-mock.mjs — shared hermetic Supabase mock for the QA rig.
// One backend simulation used by qa-tour.mjs (route screenshots) and
// qa-interact.mjs (sheet/drawer/overlay states). Everything is
// intercepted at the network layer; zero real network.

export const USER = { id: 'qa-user-1', email: 'qa@fieldhorse.local', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-01-01T00:00:00Z' }
// QA_NOW (an ISO time) fixes the clock the mock builds its dates from, so a
// screenshot run is repeatable. Unset or empty, the mock uses the real time
// as before. Any other value must be an ISO date and time with a zone (Z or
// an offset), or the run stops here: a value that does not parse would turn
// every seeded date into "Invalid Date", and one without a zone would move
// with the host's zone, since Node reads it as local time.
// ISO_TEXT matches 2026-10-08, 2026-10-08T14:00, 2026-10-08 14:00:00.123+00
// and the like; the read filters below use it too. Groups: date, hours and
// minutes, seconds, fraction, zone.
const ISO_TEXT = /^(\d{4}-\d{2}-\d{2})(?:[Tt ](\d{2}:\d{2})(?::(\d{2})(?:\.(\d+))?)?\s*([Zz]|[+\- ]\d{2}(?::?\d{2})?)?)?$/
function readQaNow(raw) {
  if (!raw) return Date.now()
  const m = ISO_TEXT.exec(raw.trim())
  const ms = m && m[2] && m[5] ? asInstant(raw) : null
  if (ms === null) {
    throw new Error(`QA_NOW must be an ISO date and time with a zone, such as 2026-10-08T14:00:00.000Z, but it is ${JSON.stringify(raw)}`)
  }
  return ms
}
const now = readQaNow(process.env.QA_NOW)
const day = 86400000
const iso = (d) => new Date(d).toISOString()
const CLIENT = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }
const contacts = [
  { id: 'c-lead1', stage: 'lead',    name: 'Justin Bryan',     job_title: 'Vintage Burkitt Station Drainage', amount: 24400, follow_up_on: iso(now - 10 * day).slice(0, 10), referred_by: 'Google', job_type: 'Drainage' },
  { id: 'c-lead2', stage: 'lead',    name: 'Lily Grace North', job_title: 'Retaining wall + pad', amount: 18750, referred_by: 'Referral', job_type: 'Concrete' },
  { id: 'c-quote', stage: 'quote',   name: 'MMC Properties',   job_title: 'Parking lot repour', amount: 46200, proposal_status: 'sent', quote_sent_at: iso(now - day), follow_up_on: iso(now + 2 * day).slice(0, 10) },
  { id: 'c-change', stage: 'quote',  name: 'Taylor Reed',      job_title: 'Kitchen renovation', amount: 18400, proposal_status: 'changes_requested', quote_change_request_note: 'Please separate the cabinet allowance.', quote_change_requested_at: iso(now - 2 * 3600e3) },
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
  profiles: [{ user_id: USER.id, full_name: 'Jesse Parker', company_name: 'Parker Construction Company', onboarded_at: iso(now - 90 * day), logo_url: null, location_lat: 35.84, location_lon: -86.36, services: ['Concrete'], company_email: 'office@parker.co', brand_accent_hex: null, preferences: { quote_follow_up: { enabled: true, days: 3 } } }],
  // Role is env-overridable so QA can exercise the in-view permission
  // gates (e.g. QA_ROLE=crew to verify Work hides leads/quotes/$).
  org_members: [{ id: 'm1', org_id: 'org-1', user_id: USER.id, role: process.env.QA_ROLE || 'owner', revoked_at: null, joined_at: iso(now - 90 * day), default_hourly_rate: null, status: 'active' }],
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
  fh_documents: [], fh_files: [],
  // Growth Engine tables behind the Inbox (Phase 6). Empty by default, which
  // means the engine is off (no fh_org_settings row) and the Inbox is hidden.
  // A test turns it on and seeds conversations with signIn's `tables`:
  //   fh_org_settings: [{ engine_enabled: true }]
  //   fh_v_inbox, fh_messages, fh_agent_runs
  fh_v_inbox: [], fh_messages: [], fh_agent_runs: [], fh_org_settings: []
}

// Every row belongs to org-1, mirroring production where migration 032
// backfilled org_id and the 035 trigger fills it on insert. Without
// this, org-scoped queries (Home dashboard) return zero rows in the
// rig while working fine in production — a fidelity gap that hid the
// dashboard from QA. Row-level org_id (if a seed ever sets one) wins.
for (const rows of Object.values(TABLES)) {
  for (let i = 0; i < rows.length; i++) rows[i] = { org_id: 'org-1', ...rows[i] }
}

// ---- REST reads -------------------------------------------------------------
// GET and HEAD to /rest/v1/<table> honor the PostgREST query the app sends,
// so a seeded row shows up only where the real database would return it:
//   col=eq.v  neq.v  gt.v  gte.v  lt.v  lte.v   compare one column
//   col=in.(a,"b c")                           any of a list (quotes allowed)
//   col=is.null  is.true  is.false
//   order=col.asc,col2.desc.nullslast           (asc by default; nulls last
//                                                 on asc, first on desc)
//   limit=n  offset=n
// Several filters on one column all apply (start_at=gte.x&start_at=lt.y).
// Values compare as numbers when both sides are finite numbers, as instants
// when both are ISO dates or times (a time without a zone is UTC, as on the
// database), as booleans for true and false, and as text otherwise. A row
// value that is a date alone (2026-10-05) reads a time filter by its date
// as written, as Postgres casts the literal to a date column's type. A null
// or missing column matches only is.null, as in SQL.
// The mock does not know column types, so text that looks like a number
// compares as a number: a zip of '01234' equals eq.1234 here, where a text
// column in Postgres would not.
// Everything else is ignored, as the mock always has: not. prefixes, or= and
// and=, like, ilike, cs, ov, fts and the other operators, filters on embedded
// columns (a dot in the name, such as fh_contacts.stage) and ordering,
// limits or offsets on embedded tables.
// A count (Prefer: count=exact, planned or estimated) is the filtered total
// before limit and offset, sent in Content-Range and exposed to the page as
// PostgREST does. A single object request (Accept vnd.pgrst.object, what
// .single() sends) gets the one matching row, or PostgREST's 406 PGRST116
// when none match or when several do. When the mock ignored part of the
// query (an unmodeled filter, or an !inner embed) it cannot know how many
// rows the database would return, so several matches still get the first.
// Writes (POST, PATCH, PUT, DELETE) keep the older rule: only eq and is.null
// apply, and their count stays hidden from the page.
const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])
const PLAIN_COLUMN = /^[A-Za-z_][A-Za-z0-9_]*$/
const NUMBER_TEXT = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function asNumber(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && NUMBER_TEXT.test(value.trim())) return Number(value)
  return null
}

function asInstant(value) {
  if (typeof value !== 'string') return null
  const m = ISO_TEXT.exec(value.trim())
  if (!m) return null
  const [, date, hm, sec = '00', frac = '', zone] = m
  if (!hm) return finiteOrNull(Date.parse(`${date}T00:00:00Z`))
  let offset = 'Z'
  if (zone && zone.toUpperCase() !== 'Z') {
    const zoneSign = zone[0] === '-' ? '-' : '+'
    const digits = zone.slice(1).replace(':', '')
    offset = `${zoneSign}${digits.slice(0, 2)}:${(digits.slice(2) || '00').padEnd(2, '0')}`
  }
  const ms = frac ? `.${frac.slice(0, 3).padEnd(3, '0')}` : ''
  return finiteOrNull(Date.parse(`${date}T${hm}:${sec}${ms}${offset}`))
}

function finiteOrNull(n) {
  return Number.isFinite(n) ? n : null
}

function asBoolean(value) {
  if (typeof value === 'boolean') return value
  if (value === 'true') return true
  if (value === 'false') return false
  return null
}

function asText(value) {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

const sign = (n) => (n < 0 ? -1 : n > 0 ? 1 : 0)

// Compares two non null values: a row value with a filter value (text from
// the URL) or two row values when ordering. Returns -1, 0 or 1.
function compareValues(a, b) {
  const na = asNumber(a), nb = asNumber(b)
  if (na !== null && nb !== null) return sign(na - nb)
  const ia = asInstant(a), ib = asInstant(b)
  if (ia !== null && ib !== null) return sign(ia - ib)
  const ba = asBoolean(a), bb = asBoolean(b)
  if (ba !== null && bb !== null) return sign(Number(ba) - Number(bb))
  const ta = asText(a), tb = asText(b)
  return ta < tb ? -1 : ta > tb ? 1 : 0
}

// A filter value as the database reads it against this row's value. A date
// column (a row value such as 2026-10-05) compared with a time casts the
// literal to a date, which keeps the date as written and drops the time and
// zone. Everything else compares as it is.
function asColumnValue(cellValue, value) {
  if (typeof cellValue !== 'string' || !DATE_ONLY.test(cellValue)) return value
  const m = ISO_TEXT.exec(value.trim())
  return m && m[2] ? m[1] : value
}

// in.(a,b,"c, d") to ['a', 'b', 'c, d']. Inside double quotes a backslash
// escapes the next character. Returns null when it is not a list.
function parseInList(text) {
  const t = text.trim()
  if (!t.startsWith('(') || !t.endsWith(')')) return null
  const body = t.slice(1, -1)
  const items = []
  let cur = ''
  let quoted = false
  let wasQuoted = false
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (quoted) {
      if (ch === '\\' && i + 1 < body.length) cur += body[++i]
      else if (ch === '"') quoted = false
      else cur += ch
    } else if (ch === '"') {
      quoted = true
      wasQuoted = true
    } else if (ch === ',') {
      items.push(wasQuoted ? cur : cur.trim())
      cur = ''
      wasQuoted = false
    } else {
      cur += ch
    }
  }
  if (body.trim() !== '' || wasQuoted) items.push(wasQuoted ? cur : cur.trim())
  return items
}

// One col=op.value pair to a row test, or null when the mock ignores it.
function rowTest(column, raw) {
  if (RESERVED_PARAMS.has(column) || !PLAIN_COLUMN.test(column)) return null
  const dot = raw.indexOf('.')
  if (dot < 0) return null
  const op = raw.slice(0, dot)
  const value = raw.slice(dot + 1)
  const cell = (row) => row[column] ?? null
  // Compares the row's value with a filter value; null when the row has none.
  const against = (row, filterValue) => {
    const v = cell(row)
    return v === null ? null : compareValues(v, asColumnValue(v, filterValue))
  }
  const holds = (row, accept) => {
    const c = against(row, value)
    return c !== null && accept(c)
  }
  switch (op) {
    case 'eq': return (row) => holds(row, (c) => c === 0)
    case 'neq': return (row) => holds(row, (c) => c !== 0)
    case 'gt': return (row) => holds(row, (c) => c > 0)
    case 'gte': return (row) => holds(row, (c) => c >= 0)
    case 'lt': return (row) => holds(row, (c) => c < 0)
    case 'lte': return (row) => holds(row, (c) => c <= 0)
    case 'in': {
      const list = parseInList(value)
      if (!list) return null
      return (row) => list.some((item) => against(row, item) === 0)
    }
    case 'is': {
      const want = value.toLowerCase()
      if (want === 'null') return (row) => cell(row) === null
      if (want === 'true' || want === 'false') return (row) => asBoolean(cell(row)) === (want === 'true')
      return null
    }
    default:
      return null
  }
}

// order=a.desc,b.asc.nullsfirst to a sort comparator, or null when no term
// names a plain column of this table.
function orderComparator(text) {
  const terms = []
  for (const part of text.split(',')) {
    const [column, ...mods] = part.trim().split('.')
    if (!PLAIN_COLUMN.test(column)) continue
    const desc = mods.includes('desc')
    const nullsFirst = mods.includes('nullsfirst') ? true : mods.includes('nullslast') ? false : desc
    terms.push({ column, desc, nullsFirst })
  }
  if (terms.length === 0) return null
  return (a, b) => {
    for (const { column, desc, nullsFirst } of terms) {
      const va = a[column] ?? null, vb = b[column] ?? null
      if (va === null && vb === null) continue
      if (va === null) return nullsFirst ? -1 : 1
      if (vb === null) return nullsFirst ? 1 : -1
      const c = compareValues(va, vb)
      if (c !== 0) return desc ? -c : c
    }
    return 0
  }
}

// True when the mock applied every part of the query that can drop rows, so
// its row count is the one the database would return. A filter it ignores,
// or an inner join on an embedded table, means the database could return
// fewer rows than the mock.
function appliedWholeQuery(params) {
  for (const [column, raw] of params) {
    if (column === 'select') {
      if (raw.includes('!inner')) return false
      continue
    }
    if (RESERVED_PARAMS.has(column)) continue
    if (!rowTest(column, raw)) return false
  }
  return true
}

function wholeNumber(text) {
  if (text == null || !/^\d+$/.test(text.trim())) return null
  return Number(text)
}

/**
 * Runs a PostgREST read query (the URL's search part) over rows the way the
 * database would for the operators listed above.
 * @param {object[]} rows
 * @param {string | URLSearchParams} query
 * @returns {{ rows: object[], total: number, offset: number }}
 *   rows after filters, order, offset and limit; total is the filtered count
 *   before offset and limit.
 */
export function queryRows(rows, query) {
  const params = typeof query === 'string' ? new URLSearchParams(query.startsWith('?') ? query.slice(1) : query) : query
  let out = rows.slice()
  for (const [column, raw] of params) {
    const test = rowTest(column, raw)
    if (test) out = out.filter(test)
  }
  const total = out.length
  const order = params.get('order')
  const comparator = order ? orderComparator(order) : null
  if (comparator) out.sort(comparator)
  const offset = wholeNumber(params.get('offset')) ?? 0
  const limit = wholeNumber(params.get('limit'))
  out = out.slice(offset, limit === null ? undefined : offset + limit)
  return { rows: out, total, offset }
}

// The rule writes still use: eq. and is.null on any column.
function applyWriteFilters(rows, url) {
  const params = new URL(url).searchParams
  let out = rows
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(k)) continue
    if (v.startsWith('eq.')) out = out.filter((r) => String(r[k]) === v.slice(3))
    else if (v === 'is.null') out = out.filter((r) => r[k] == null)
  }
  return out
}

function contentRange(offset, count, total) {
  const range = count === 0 ? '*' : `${offset}-${offset + count - 1}`
  return `${range}/${total ?? '*'}`
}

/**
 * The mock's answer to one REST request. Exported for the mock's own tests.
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, tables?: Record<string, object[]> }} [request]
 * @returns {{ status: number, body: string, headers: Record<string, string> }}
 */
export function restResponse(url, { method = 'GET', headers = {}, tables = TABLES } = {}) {
  const parsed = new URL(url)
  const path = parsed.pathname
  const table = path.split('/rest/v1/')[1]?.split('?')[0] || ''
  if (path.includes('/rpc/')) return { status: 200, body: JSON.stringify([]), headers: {} }
  const header = (name) => {
    const hit = Object.keys(headers).find((key) => key.toLowerCase() === name)
    return hit ? String(headers[hit]) : ''
  }
  const wantsObject = header('accept').includes('vnd.pgrst.object')
  const verb = method.toUpperCase()
  if (verb !== 'GET' && verb !== 'HEAD') {
    const rows = applyWriteFilters(tables[table] ?? [], url)
    const legacy = { 'content-range': '0-9/10' }
    if (wantsObject) {
      if (rows.length === 0) return { status: 406, body: JSON.stringify({ message: 'no rows' }), headers: legacy }
      return { status: 200, body: JSON.stringify(rows[0]), headers: legacy }
    }
    return { status: 200, body: JSON.stringify(rows), headers: legacy }
  }
  const { rows, total, offset } = queryRows(tables[table] ?? [], parsed.searchParams)
  const wantsCount = /count=(exact|planned|estimated)/.test(header('prefer'))
  const shown = wantsObject ? Math.min(rows.length, 1) : rows.length
  const out = {
    'content-range': contentRange(offset, shown, wantsCount ? total : null),
    'access-control-expose-headers': 'Content-Range'
  }
  const several = rows.length > 1 && appliedWholeQuery(parsed.searchParams)
  if (wantsObject && (rows.length === 0 || several)) {
    return {
      status: 406,
      body: JSON.stringify({
        code: 'PGRST116',
        details: `The result contains ${rows.length} rows`,
        hint: null,
        message: 'JSON object requested, multiple (or no) rows returned'
      }),
      headers: out
    }
  }
  if (verb === 'HEAD') return { status: 200, body: '', headers: out }
  return { status: 200, body: JSON.stringify(wantsObject ? rows[0] : rows), headers: out }
}


// ---- RPC calls (Phase 6) ----------------------------------------------------
// Every POST to /rest/v1/rpc/<name> is recorded as { name, body, at } and
// answered. Read the record for a browser context with rpcCalls(context) or
// rpcCalls(context, 'fh_agent_run_approve'), or pass your own array as
// installMock's `rpcLog` option and read that. Callers that never look at the
// record are unaffected. To make one call fail, register a later
// context.route for that function in the test (Playwright runs the most
// recently registered matching route first).
//
// The four Inbox functions also change this context's own copy of the inbox
// tables, so the screen behaves as it would against the real database:
//   fh_send_message          adds an outbound message and returns its id
//   fh_conversation_mark_read  sets unread_count to 0 on the conversation
//   fh_agent_run_approve     marks the run approved, adds the sent message
//                            (the body passed as p_body wins) and returns its id
//   fh_agent_run_reject      marks the run rejected
// Nothing is ever really sent. Every other function answers [] as before.
const RPC_LOGS = new WeakMap()
const INBOX_TABLES = ['fh_v_inbox', 'fh_messages', 'fh_agent_runs', 'fh_org_settings']

export function rpcCalls(ctx, name) {
  const log = RPC_LOGS.get(ctx) ?? []
  return name ? log.filter((call) => call.name === name) : [...log]
}

// Copies of the inbox tables that belong to one browser context, so the state
// an RPC changes never leaks into another context or the shared defaults.
function withOwnInboxTables(tables) {
  const own = { ...tables }
  for (const name of INBOX_TABLES) own[name] = (tables[name] ?? []).map((row) => ({ ...row }))
  return own
}

let rpcSeq = 0
function nextId(prefix) {
  rpcSeq += 1
  return `${prefix}-${rpcSeq}`
}

function proposalBody(proposal) {
  if (typeof proposal === 'string') return proposal
  if (!proposal || typeof proposal !== 'object') return ''
  for (const key of ['body', 'text', 'message', 'draft', 'reply', 'content']) {
    if (typeof proposal[key] === 'string' && proposal[key].trim()) return proposal[key]
  }
  return ''
}

function touchConversation(tables, conversationId, patch) {
  const row = tables.fh_v_inbox.find((r) => r.conversation_id === conversationId)
  if (row) Object.assign(row, typeof patch === 'function' ? patch(row) : patch)
}

function addOutbound(tables, message) {
  const sentAt = new Date().toISOString()
  const row = {
    id: nextId('msg-out'), org_id: 'org-1', direction: 'outbound', subject: null, status: 'sent',
    read_at: sentAt, hold_reason: null, sent_by_kind: 'user', agent_run_id: null,
    created_at: sentAt, sent_at: sentAt, call_status: null, ...message
  }
  tables.fh_messages.push(row)
  touchConversation(tables, row.conversation_id, { last_preview: row.body, last_message_at: sentAt, last_channel: row.channel })
  return row
}

function rpcResponse(name, body, tables) {
  const json = (data) => ({ status: 200, body: JSON.stringify(data) })
  const empty = { status: 204, body: '' }
  switch (name) {
    case 'fh_send_message': {
      const inbox = tables.fh_v_inbox.find((r) => r.client_id === body.p_client_id)
      const conversationId = inbox?.conversation_id ?? tables.fh_messages.find((m) => m.client_id === body.p_client_id)?.conversation_id ?? null
      const sent = addOutbound(tables, {
        conversation_id: conversationId, client_id: body.p_client_id, channel: body.p_channel,
        subject: body.p_subject ?? null, body: body.p_body
      })
      return json(sent.id)
    }
    case 'fh_conversation_mark_read': {
      const readAt = new Date().toISOString()
      touchConversation(tables, body.p_conversation_id, { unread_count: 0 })
      for (const m of tables.fh_messages) {
        if (m.conversation_id === body.p_conversation_id && m.direction === 'inbound' && !m.read_at) m.read_at = readAt
      }
      return empty
    }
    case 'fh_agent_run_approve': {
      const run = tables.fh_agent_runs.find((r) => r.id === body.p_agent_run_id)
      if (!run) return { status: 400, body: JSON.stringify({ code: 'P0002', message: 'agent run not found' }) }
      run.status = 'approved'
      const text = body.p_body ?? proposalBody(run.proposal)
      const channel = body.p_channel ?? run.proposal?.channel ?? 'sms'
      const sent = addOutbound(tables, {
        conversation_id: run.conversation_id, client_id: run.client_id ?? tables.fh_v_inbox.find((r) => r.conversation_id === run.conversation_id)?.client_id,
        channel, body: text, sent_by_kind: 'agent', agent_run_id: run.id
      })
      run.executed_message_id = sent.id
      touchConversation(tables, run.conversation_id, (row) => ({ pending_drafts: Math.max(0, (row.pending_drafts ?? 0) - 1) }))
      return json(sent.id)
    }
    case 'fh_agent_run_reject': {
      const run = tables.fh_agent_runs.find((r) => r.id === body.p_agent_run_id)
      if (run) {
        run.status = 'rejected'
        touchConversation(tables, run.conversation_id, (row) => ({ pending_drafts: Math.max(0, (row.pending_drafts ?? 0) - 1) }))
      }
      return empty
    }
    default:
      return json([])
  }
}

export const session = {
  access_token: 'qa.fake.token', refresh_token: 'qa-refresh', token_type: 'bearer',
  expires_in: 86400, expires_at: Math.floor(now / 1000) + 86400, user: USER
}


// Per context table set. options.tables replaces whole tables for this
// browser context only (rows get org-1 like the defaults), and
// options.role overrides the org_members role instead of the QA_ROLE
// env var. Callers that pass neither get the shared defaults unchanged.
function tablesFor(options) {
  if (!options.tables && !options.role) return TABLES
  const tables = { ...TABLES }
  for (const [name, rows] of Object.entries(options.tables || {})) {
    tables[name] = (rows || []).map((row) => ({ org_id: 'org-1', ...row }))
  }
  if (options.role) tables.org_members = tables.org_members.map((m) => ({ ...m, role: options.role }))
  return tables
}

export async function installMock(ctx, options = {}) {
  const supabaseHosts = new Set(options.supabaseHosts || ['qa-mock.supabase.co'])
  const tables = withOwnInboxTables(tablesFor(options))
  const rpcLog = Array.isArray(options.rpcLog) ? options.rpcLog : []
  RPC_LOGS.set(ctx, rpcLog)
  await ctx.route((u) => supabaseHosts.has(u.hostname), async (route) => {
    const req = route.request()
    const url = req.url()
    if (url.includes('/auth/v1/user')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(USER) })
    if (url.includes('/auth/v1/token')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(session) })
    if (url.includes('/auth/v1/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    if (url.includes('/realtime/')) return route.abort()
    if (url.includes('/storage/')) return route.fulfill({ status: 404, body: '' })
    if (url.includes('/rest/v1/rpc/')) {
      const name = new URL(url).pathname.split('/rpc/')[1]?.split('?')[0] || ''
      let body = {}
      try { body = req.postDataJSON() ?? {} } catch { /* no JSON body */ }
      rpcLog.push({ name, body, at: Date.now() })
      const r = rpcResponse(name, body, tables)
      return route.fulfill({ status: r.status, contentType: 'application/json', body: r.body })
    }
    if (url.includes('/rest/v1/')) {
      const r = restResponse(url, { method: req.method(), headers: req.headers(), tables })
      return route.fulfill({ status: r.status, contentType: 'application/json', body: r.body, headers: r.headers })
    }
    return route.fulfill({ status: 200, body: '{}' })
  })
  await ctx.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
}
