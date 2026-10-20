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
