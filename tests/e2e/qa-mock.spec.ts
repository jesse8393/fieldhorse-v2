import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn'

// The mock behind every spec answers PostgREST reads the way the database
// would, so a screen only shows rows its own query asks for. These checks
// fetch the mocked Supabase URL from inside a signed in page, through the
// same route the app's own requests take.
const REST = 'https://qa-mock.supabase.co/rest/v1/'

async function rest(page: Page, path: string, init: { method?: string; headers?: Record<string, string> } = {}) {
  return page.evaluate(async ([url, options]) => {
    const res = await fetch(url, { method: options.method ?? 'GET', headers: { apikey: 'qa', ...(options.headers ?? {}) } })
    const text = await res.text()
    return { status: res.status, range: res.headers.get('content-range'), body: text ? JSON.parse(text) : null }
  }, [`${REST}${path}`, init] as const)
}

test.beforeEach(async ({ context, page }) => {
  await signIn(context)
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
})

test('the mock honors in and limit on REST reads', async ({ page }) => {
  const jobs = await rest(page, 'fh_contacts?select=id,stage&stage=in.(job,invoice)')
  expect(jobs.status).toBe(200)
  expect(jobs.body.map((r: { stage: string }) => r.stage).sort()).toEqual(['invoice', 'job'])

  const two = await rest(page, 'fh_contacts?select=id&limit=2')
  expect(two.body).toHaveLength(2)
})

test('the mock sends the filtered count to the page', async ({ page }) => {
  const counted = await rest(page, 'fh_contacts?select=id&stage=in.(moved_lead,moved_quote)', { method: 'HEAD', headers: { Prefer: 'count=exact' } })
  expect(counted.status).toBe(200)
  expect(counted.range).toBe('0-3/4')
})

async function rpc(page: Page, name: string, body: Record<string, unknown>) {
  return page.evaluate(async ([url, payload]) => {
    const res = await fetch(url, { method: 'POST', headers: { apikey: 'qa', 'content-type': 'application/json' }, body: JSON.stringify(payload) })
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }, [`${REST}rpc/${name}`, body] as const)
}

// Both functions are applied in production, so the mock answers them as
// the database does instead of a 404 on every document screen (vibe audit
// console-4).
test('the mock answers the company details the documents read', async ({ page }) => {
  const branding = await rpc(page, 'fh_company_branding', { p_org_id: 'org-1' })
  expect(branding.status).toBe(200)
  expect(branding.body).toMatchObject({ org_id: 'org-1', company_name: 'Parker Construction Company', company_email: 'office@parker.co' })
  const elsewhere = await rpc(page, 'fh_company_branding', { p_org_id: 'org-other' })
  expect(elsewhere).toEqual({ status: 200, body: null })
})

test('the mock merges a duplicate client in one call and deletes nothing', async ({ context, page }) => {
  const client = (id: string, name: string) => ({ id, user_id: 'qa-user-1', name, phone: '555-0101', email: null })
  await signIn(context, { tables: {
    fh_clients: [client('cl-keep', 'Jeff Roy'), client('cl-dupe', 'Jeffrey Roy')],
    fh_contacts: [{ id: 'c-a', stage: 'job', client_id: 'cl-dupe', user_id: 'qa-user-1' }],
    fh_leads: [{ id: 'l-a', client_id: 'cl-dupe', user_id: 'qa-user-1' }, { id: 'l-b', client_id: 'cl-keep', user_id: 'qa-user-1' }]
  } })
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const merged = await rpc(page, 'fh_merge_client_into', { p_survivor: 'cl-keep', p_duplicates: ['cl-dupe'] })
  expect(merged).toEqual({ status: 200, body: { jobs: 1, leads: 1, quotes: 0, invoices: 0 } })
  expect((await rest(page, 'fh_leads?select=id&client_id=eq.cl-keep')).body).toHaveLength(2)
  expect((await rest(page, 'fh_clients?select=id&id=eq.cl-dupe')).body).toHaveLength(1)
})
