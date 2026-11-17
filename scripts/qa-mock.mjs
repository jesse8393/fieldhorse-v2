// scripts/qa-mock.mjs — shared hermetic Supabase mock for the QA rig.
// One backend simulation used by qa-tour.mjs (route screenshots) and
// qa-interact.mjs (sheet/drawer/overlay states). Everything is
// intercepted at the network layer; zero real network.

import fs from 'node:fs'
import { parseDatabaseTypes, parseSelect } from './lib/schemaRefs.mjs'

// The schema the mock answers for: every table, view and function in
// src/lib/database.types.ts. A request for anything else gets the error the
// real database gives, so a call production cannot serve fails here too.
export const SCHEMA = parseDatabaseTypes(fs.readFileSync(new URL('../src/lib/database.types.ts', import.meta.url), 'utf8'))

// The /api paths the Netlify functions serve (each file's config.path).
const API_PATHS = new Set(
  fs.readdirSync(new URL('../netlify/functions/', import.meta.url))
    .filter((name) => name.endsWith('.js'))
    .map((name) => /export const config = \{ path: '([^']+)' \}/.exec(fs.readFileSync(new URL(`../netlify/functions/${name}`, import.meta.url), 'utf8'))?.[1])
    .filter(Boolean)
)

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
const CLIENT = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com', address: '412 Burkitt Station Rd' }
// Leads and quotes live in fh_leads and fh_quotes (SPEC D55). The four
// contact rows the migration moved stay here with stage moved_lead or
// moved_quote, as production has them, so an old /leads/c-lead1 link can
// follow origin_contact_id to its new row. No screen may show them.
const contacts = [
  { id: 'c-lead1', stage: 'moved_lead',  name: 'Justin Bryan',     job_title: 'Vintage Burkitt Station Drainage', amount: 24400, follow_up_on: iso(now - 10 * day).slice(0, 10), referred_by: 'Google', job_type: 'Drainage' },
  { id: 'c-lead2', stage: 'moved_lead',  name: 'Lily Grace North', job_title: 'Retaining wall + pad', amount: 18750, referred_by: 'Referral', job_type: 'Concrete' },
  { id: 'c-quote', stage: 'moved_quote', name: 'MMC Properties',   job_title: 'Parking lot repour', amount: 46200, proposal_status: 'sent', quote_sent_at: iso(now - day), follow_up_on: iso(now + 2 * day).slice(0, 10) },
  { id: 'c-change', stage: 'moved_quote', name: 'Taylor Reed',     job_title: 'Kitchen renovation', amount: 18400, proposal_status: 'changes_requested', quote_change_request_note: 'Please separate the cabinet allowance.', quote_change_requested_at: iso(now - 2 * 3600e3) },
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

const leads = [
  { id: 'l-lead1', origin_contact_id: 'c-lead1', title: 'Vintage Burkitt Station Drainage', job_type: 'Drainage', referred_by: 'Google', source: 'Google', follow_up_on: iso(now - 10 * day).slice(0, 10), created_at: iso(now - 30 * day), updated_at: iso(now) },
  { id: 'l-lead2', origin_contact_id: 'c-lead2', title: 'Retaining wall + pad', job_type: 'Concrete', referred_by: 'Referral', source: 'Referral', created_at: iso(now - 29 * day), updated_at: iso(now - day) }
].map((l) => ({
  user_id: USER.id, client_id: 'cl-1', status: 'open', notes: null, last_contact: null, quote_id: null, follow_up_on: null,
  fh_clients: CLIENT, ...l
}))

const quotes = [
  { id: 'q-quote', origin_contact_id: 'c-quote', title: 'Parking lot repour', amount: 46200, status: 'sent', sent_at: iso(now - day), created_at: iso(now - 28 * day), updated_at: iso(now - 2 * day) },
  { id: 'q-change', origin_contact_id: 'c-change', title: 'Kitchen renovation', amount: 18400, status: 'changes_requested', change_request_note: 'Please separate the cabinet allowance.', change_requested_at: iso(now - 2 * 3600e3), created_at: iso(now - 27 * day), updated_at: iso(now - 3 * day) }
].map((q) => ({
  user_id: USER.id, client_id: 'cl-1', scope_text: null, terms_text: null, exclusions_text: null, job_type: null,
  sent_at: null, expires_at: null, change_request_note: null, change_requested_at: null,
  approved_version_id: null, lead_id: null, job_id: null, fh_clients: CLIENT, ...q
}))

const payments = [
  { id: 'p1', user_id: USER.id, contact_id: 'c-job2', amount: 6400, method: 'check', reference: '1042', paid_on: iso(now - 6 * day).slice(0, 10), created_at: iso(now - 6 * day) }
]
// Harold's $6,400 payment paid his deposit; progress draw 1 is the open
// bill. Without the paid deposit, Money (Phase 8, task 5) reads money
// logged against a job as paying its oldest open bill, as logPayment would
// have marked the draw paid.
// Every invoice points at its client (D62); these two also bill a job.
const invoices = [
  { id: 'inv0', user_id: USER.id, client_id: 'cl-1', contact_id: 'c-job2', title: 'Deposit', amount: 6400, status: 'paid', sequence_number: 1, issued_at: iso(now - 14 * day), due_at: iso(now - 7 * day), created_at: iso(now - 14 * day), description: null, notes: null, fh_clients: CLIENT },
  { id: 'inv1', user_id: USER.id, client_id: 'cl-1', contact_id: 'c-job2', title: 'Progress draw 1', amount: 6400, status: 'sent', sequence_number: 2, issued_at: iso(now - 8 * day), due_at: iso(now + 6 * day), created_at: iso(now - 8 * day), description: null, notes: null, fh_clients: CLIENT }
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
  fh_leads: leads,
  fh_quotes: quotes,
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
//   col=not.<op>.<value>                       the negation of any of those
//                                               (a null row value never matches)
// Everything else is ignored, as the mock always has: or= and
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
// Writes (POST, PATCH, PUT, DELETE) apply the same operators. A write filter
// the mock does not model (or=, like, an embedded column) answers 501 rather
// than touching every row. A write's count stays hidden from the page.
//
// Against SCHEMA, as PostgREST would answer:
//   a table or view it does not have             404 42P01
//   an unknown column in select, insert or patch 400 PGRST204
//   an unknown embedded table                    400 PGRST200
//   an unknown column in a filter or an order    400 42703
// Pass schema: null to restResponse to skip these checks (the mock's own
// tests do, for made up tables).
const RESERVED_PARAMS = new Set(['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'])
const PLAIN_COLUMN = /^[A-Za-z_][A-Za-z0-9_]*$/
// or= and and= hold filters rather than name a column.
const LOGIC_PARAMS = new Set(['or', 'and', 'not.or', 'not.and'])
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
  // not.<op>.<value> is the negation of the test, with the SQL rule that a
  // null never matches either way.
  if (op === 'not') {
    const inner = rowTest(column, value)
    if (!inner) return null
    return (row) => (row[column] ?? null) !== null && !inner(row)
  }
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

// The rows a write's filters select, or the first filter the mock does not
// apply (as { unsupported }), since guessing would write every row.
function applyWriteFilters(rows, params) {
  let out = rows
  for (const [column, raw] of params) {
    if (RESERVED_PARAMS.has(column)) continue
    const test = rowTest(column, raw)
    if (!test) return { unsupported: `${column}=${raw}` }
    out = out.filter(test)
  }
  return { rows: out }
}

const pgError = (status, code, message) => ({ status, body: JSON.stringify({ code, details: null, hint: null, message }), headers: {} })

// Checks a select list against the schema; returns an error answer or null.
function selectError(table, text) {
  const walk = (tbl, items) => {
    const known = SCHEMA_COLUMNS(tbl)
    for (const item of items) {
      if (item.kind === 'column') {
        if (known && !known.has(item.name)) return pgError(400, 'PGRST204', `Could not find the '${item.name}' column of '${tbl}' in the schema cache`)
        continue
      }
      if (activeSchema.tables[item.name]) {
        const err = walk(item.name, item.children)
        if (err) return err
      } else if (!(known && known.has(item.name))) {
        return pgError(400, 'PGRST200', `Could not find a relationship between '${tbl}' and '${item.name}' in the schema cache`)
      }
    }
    return null
  }
  return walk(table, parseSelect(text))
}

// The schema restResponse checks against for the current call.
let activeSchema = null
function SCHEMA_COLUMNS(table) {
  const t = activeSchema?.tables[table]
  return t ? new Set(t.columns) : null
}

// A schema error for this request, or null when the schema has all it names.
function schemaError(table, params, verb, body) {
  if (!activeSchema) return null
  if (!activeSchema.tables[table]) return pgError(404, '42P01', `relation "public.${table}" does not exist`)
  const columns = SCHEMA_COLUMNS(table)
  const select = params.get('select')
  if (select) {
    const err = selectError(table, select)
    if (err) return err
  }
  for (const [column, raw] of params) {
    if (column === 'order') {
      for (const part of raw.split(',')) {
        const name = part.trim().split('.')[0].split('->')[0]
        if (PLAIN_COLUMN.test(name) && !columns.has(name)) return pgError(400, '42703', `column ${table}.${name} does not exist`)
      }
      continue
    }
    if (column === 'columns') {
      for (const name of raw.split(',').map((c) => c.trim().replace(/^"|"$/g, ''))) {
        if (name && !columns.has(name)) return pgError(400, 'PGRST204', `Could not find the '${name}' column of '${table}' in the schema cache`)
      }
      continue
    }
    if (RESERVED_PARAMS.has(column) || LOGIC_PARAMS.has(column)) continue
    const name = column.split('->')[0]
    if (PLAIN_COLUMN.test(name) && !columns.has(name)) return pgError(400, '42703', `column ${table}.${name} does not exist`)
  }
  if (verb === 'POST' || verb === 'PATCH' || verb === 'PUT') {
    for (const row of Array.isArray(body) ? body : body && typeof body === 'object' ? [body] : []) {
      for (const key of Object.keys(row ?? {})) {
        if (!columns.has(key)) return pgError(400, 'PGRST204', `Could not find the '${key}' column of '${table}' in the schema cache`)
      }
    }
  }
  return null
}

function parseJson(text) {
  try { return JSON.parse(text) } catch { return null }
}

function contentRange(offset, count, total) {
  const range = count === 0 ? '*' : `${offset}-${offset + count - 1}`
  return `${range}/${total ?? '*'}`
}

/**
 * The mock's answer to one REST request. Exported for the mock's own tests.
 * @param {string} url
 * @param {{ method?: string, headers?: Record<string, string>, tables?: Record<string, object[]>, body?: unknown, schema?: import('./lib/schemaRefs.mjs').Schema | null }} [request]
 *   body is the write's JSON (text or parsed); schema null skips the schema checks.
 * @returns {{ status: number, body: string, headers: Record<string, string> }}
 */
export function restResponse(url, { method = 'GET', headers = {}, tables = TABLES, body = null, schema = SCHEMA } = {}) {
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
  activeSchema = schema
  const refused = schemaError(table, parsed.searchParams, verb, typeof body === 'string' ? parseJson(body) : body)
  if (refused) return refused
  if (verb !== 'GET' && verb !== 'HEAD') {
    const filtered = applyWriteFilters(tables[table] ?? [], parsed.searchParams)
    if (filtered.unsupported) {
      return pgError(501, 'QA501', `The QA mock does not apply ${filtered.unsupported} to a write. Model it in scripts/qa-mock.mjs or stub this request in the spec.`)
    }
    const rows = filtered.rows
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
//   fh_money_visible         true for an owner, admin or manager of the org
// Nothing is ever really sent. A function SCHEMA does not have, or a call
// whose arguments no version of it takes, answers 404 PGRST202 as PostgREST
// does. Every other function answers [] as before.
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

// True when the body's keys fit one version of the function: every key is a
// parameter and every parameter without a default is given.
function argsFit(fn, body) {
  const keys = Object.keys(body ?? {})
  return fn.overloads.some((params) => params === null || (
    keys.every((k) => params.some((p) => p.name === k)) && params.every((p) => p.optional || keys.includes(p.name))
  ))
}

/**
 * @param {string} name
 * @param {Record<string, any>} body
 * @param {Record<string, any[]>} [tables]
 * @param {import('./lib/schemaRefs.mjs').Schema | null} [schema]
 */
export function rpcResponse(name, body, tables = TABLES, schema = SCHEMA) {
  const json = (data) => ({ status: 200, body: JSON.stringify(data) })
  const empty = { status: 204, body: '' }
  const fn = schema ? schema.functions[name] : { overloads: [null] }
  if (!fn || !argsFit(fn, body)) {
    const args = Object.keys(body ?? {}).join(', ')
    return {
      status: 404,
      body: JSON.stringify({
        code: 'PGRST202', details: null, hint: null,
        message: `Could not find the function public.${name}(${args}) in the schema cache`
      })
    }
  }
  switch (name) {
    case 'fh_money_visible': {
      // Owners, admins and managers of the company see money.
      const member = (tables.org_members ?? []).find((m) => m.org_id === body.p_org_id && m.user_id === USER.id && !m.revoked_at)
      return json(Boolean(member && ['owner', 'admin', 'manager'].includes(member.role)))
    }
    case 'fh_company_branding': {
      // As the function does (20261117161700_company_branding): the
      // document fields of the company's earliest active owner, for a
      // member of that company only; anyone else reads null.
      const members = (tables.org_members ?? []).filter((m) => m.org_id === body.p_org_id && !m.revoked_at)
      const org = (tables.organizations ?? []).find((o) => o.id === body.p_org_id)
      if (!org || !members.some((m) => m.user_id === USER.id)) return json(null)
      const owner = members.filter((m) => m.role === 'owner').sort((a, b) => String(a.joined_at).localeCompare(String(b.joined_at)))[0]
      const p = (owner && (tables.profiles ?? []).find((r) => r.user_id === owner.user_id)) || {}
      const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null)
      const fields = ['full_name', 'company_address', 'company_phone', 'company_email', 'company_website', 'logo_url', 'brand_accent_hex',
        'license_number', 'insured_text', 'payment_link', 'payment_instructions', 'estimate_template', 'warranty_default']
      return json({
        org_id: org.id,
        company_name: text(p.company_name) ?? text(org.name),
        ...Object.fromEntries(fields.map((f) => [f, p[f] ?? null]))
      })
    }
    case 'fh_merge_client_into': {
      // As the function does (20261117090100_merge_client_into): moves
      // what points at each duplicate onto the kept client and deletes
      // nothing. A row kept once per client (tags, fields, a thread) moves
      // only when the kept client has none with that key.
      const keep = body.p_survivor
      const kept = (tables.fh_clients ?? []).find((c) => c.id === keep)
      if (!kept) return { status: 400, body: JSON.stringify({ code: 'P0002', message: 'the client to keep was not found' }) }
      const member = (tables.org_members ?? []).find((m) => m.org_id === (kept.org_id ?? 'org-1') && m.user_id === USER.id && !m.revoked_at)
      if (!member || !['owner', 'admin', 'manager'].includes(member.role)) {
        return { status: 403, body: JSON.stringify({ code: '42501', message: 'not allowed to merge clients in this company' }) }
      }
      const counted = { fh_contacts: 'jobs', fh_leads: 'leads', fh_quotes: 'quotes', fh_invoices: 'invoices' }
      const moved = { jobs: 0, leads: 0, quotes: 0, invoices: 0 }
      const plain = ['fh_contacts', 'fh_leads', 'fh_quotes', 'fh_invoices', 'fh_follow_ups', 'fh_public_links', 'fh_selections', 'fh_appointments',
        'fh_reviews', 'fh_review_requests', 'fh_messages', 'fh_events', 'fh_outbox', 'fh_agent_runs', 'fh_workflow_runs', 'fh_form_submissions']
      const byKey = { fh_client_tags: 'tag', fh_client_fields: 'key', fh_campaign_recipients: 'campaign_id', fh_conversations: null, fh_consent: null, fh_client_attribution: null }
      for (const dup of body.p_duplicates ?? []) {
        if (!dup || dup === keep) continue
        for (const table of plain) {
          for (const row of tables[table] ?? []) {
            if (row.client_id !== dup) continue
            row.client_id = keep
            if (counted[table]) moved[counted[table]] += 1
          }
        }
        for (const [table, key] of Object.entries(byKey)) {
          const rows = tables[table] ?? []
          for (const row of rows) {
            if (row.client_id !== dup) continue
            const taken = rows.some((k) => k.client_id === keep && (key === null || k[key] === row[key]))
            if (!taken) row.client_id = keep
          }
        }
      }
      return json(moved)
    }
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
      const r = restResponse(url, { method: req.method(), headers: req.headers(), tables, body: req.postData() })
      return route.fulfill({ status: r.status, contentType: 'application/json', body: r.body, headers: r.headers })
    }
    return route.fulfill({ status: 200, body: '{}' })
  })
  // A path a Netlify function serves answers {} unless the spec stubs it
  // (a route registered later wins). Any other /api path is a 404, as on
  // Netlify, so a call to a function that does not exist fails here too.
  await ctx.route('**/api/**', (route) => {
    const status = apiStatus(route.request().url())
    return route.fulfill({ status, contentType: 'application/json', body: status === 200 ? '{}' : JSON.stringify({ error: 'Not found' }) })
  })
}

/** 200 for a path a Netlify function serves, 404 for any other. */
export function apiStatus(url) {
  return API_PATHS.has(new URL(url).pathname) ? 200 : 404
}
