// move-counts.mjs
//
// Prints the counts migration 093 changes, so a run before and a run after
// can sit side by side. Read only. Needs SUPABASE_URL and
// SUPABASE_SERVICE_ROLE_KEY in the environment (the service role sees every
// org). Usage: node scripts/move-counts.mjs
import { createClient } from '@supabase/supabase-js'

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY first.')
  process.exit(2)
}
const db = createClient(url, key, { auth: { persistSession: false } })

async function count(table, filter) {
  let q = db.from(table).select('id', { count: 'exact', head: true })
  if (filter) q = filter(q)
  const { count: n, error } = await q
  if (error) throw new Error(`${table}: ${error.message}`)
  return n ?? 0
}

async function byColumn(table, column) {
  const { data, error } = await db.from(table).select(column)
  if (error) throw new Error(`${table}: ${error.message}`)
  const tally = {}
  for (const row of data) tally[row[column] ?? 'null'] = (tally[row[column] ?? 'null'] || 0) + 1
  return Object.entries(tally).sort().map(([k, v]) => `${k}=${v}`).join(' ')
}

const rows = [
  ['contacts by stage', await byColumn('fh_contacts', 'stage')],
  ['leads by status', await byColumn('fh_leads', 'status')],
  ['quotes by status', await byColumn('fh_quotes', 'status')],
  ['quote items with quote_id', await count('fh_quote_items', q => q.not('quote_id', 'is', null))],
  ['public links with quote_id', await count('fh_public_links', q => q.not('quote_id', 'is', null))],
  ['visits with lead_id or quote_id', await count('fh_schedule', q => q.or('lead_id.not.is.null,quote_id.not.is.null'))],
  ['invoices with client_id', `${await count('fh_invoices', q => q.not('client_id', 'is', null))} of ${await count('fh_invoices')}`],
  ['leads without origin', await count('fh_leads', q => q.is('origin_contact_id', null))],
  ['quotes without origin', await count('fh_quotes', q => q.is('origin_contact_id', null))],
]
const width = Math.max(...rows.map(r => r[0].length))
for (const [label, value] of rows) console.log(label.padEnd(width), ' ', value)
