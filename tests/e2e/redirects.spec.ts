// Old lead and quote links keep working (PHASE9_PLAN Task 7, SPEC D56).
// Production moved every lead and quote out of fh_contacts into fh_leads
// and fh_quotes; the old row stays with stage moved_lead or moved_quote
// and the new row points back through origin_contact_id. A link to the
// old id lands on the new record, and the marked rows show up nowhere.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const NOW = '2026-10-08T15:00:00.000Z'

function contact(partial: Record<string, unknown>) {
  return {
    user_id: 'qa-user-1', client_id: 'cl-1', phone: '555-0101', email: 'x@y.com', address: '412 Burkitt Station Rd',
    notes: null, scope_text: null, milestones: [], created_at: NOW, updated_at: NOW, proposal_status: null,
    follow_up_on: null, completed_at: null, invoice_no: null, client_name: 'Jeff Roy',
    fh_clients: { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' },
    ...partial
  }
}

const TABLES = {
  fh_contacts: [
    contact({ id: 'c-job1', stage: 'job', name: 'Plumbing Bellevue', job_title: 'Slab + trench', amount: 33100 }),
    contact({ id: 'c-old', stage: 'moved_lead', name: 'Moved Ghost Lead', job_title: 'Ghost drainage', amount: 2400, follow_up_on: '2026-09-20' }),
    contact({ id: 'c-old-q', stage: 'moved_quote', name: 'Moved Ghost Quote', job_title: 'Ghost repour', amount: 4600, proposal_status: 'sent', quote_sent_at: '2026-10-01T11:00:00Z' })
  ],
  // One visit this afternoon so Today has a day to show.
  fh_schedule: [
    { id: 's1', user_id: 'qa-user-1', contact_id: 'c-job1', title: 'Pour slab, crew A', description: null, start_at: '2026-10-08T17:30:00Z', end_at: '2026-10-08T20:00:00Z', created_at: '2026-10-01T12:00:00Z' }
  ],
  fh_leads: [
    { id: 'l-1', user_id: 'qa-user-1', client_id: 'cl-1', origin_contact_id: 'c-old', title: 'Ghost drainage', status: 'open', created_at: NOW, updated_at: NOW }
  ],
  fh_quotes: [
    { id: 'q-1', user_id: 'qa-user-1', client_id: 'cl-1', origin_contact_id: 'c-old-q', title: 'Ghost repour', status: 'sent', amount: 4600, created_at: NOW, updated_at: NOW }
  ]
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
}

test('an old lead link lands on the new lead', async ({ context, page }) => {
  await signIn(context, { tables: TABLES })
  await open(page, '/leads/c-old')
  await expect(page).toHaveURL(/\/leads\/l-1$/, { timeout: 30_000 })
})

test('an old quote link lands on the new quote', async ({ context, page }) => {
  await signIn(context, { tables: TABLES })
  await open(page, '/quotes/c-old-q?tab=quote')
  await expect(page).toHaveURL(/\/quotes\/q-1$/, { timeout: 30_000 })
})

test('an old job link to a moved row lands on the new record', async ({ context, page }) => {
  await signIn(context, { tables: TABLES })
  await open(page, '/jobs/c-old')
  await expect(page).toHaveURL(/\/leads\/l-1$/, { timeout: 30_000 })
})

test('moved rows never show on Jobs, Today or Money', async ({ context, page }) => {
  await signIn(context, { tables: TABLES })
  await page.clock.setFixedTime(new Date(NOW))

  await open(page, '/work')
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Plumbing Bellevue').first()).toBeVisible()
  await expect(page.getByText(/Moved Ghost/)).toHaveCount(0)

  // The ghost lead is ten days past its follow up and the ghost quote was
  // sent a week ago: both would be Today cards if the rows still counted.
  await open(page, '/')
  await expect(page.getByRole('region', { name: 'Your day' }).getByText('Pour slab, crew A')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Moved Ghost/)).toHaveCount(0)

  await open(page, '/invoices')
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/Moved Ghost/)).toHaveCount(0)
})

// The cut over (PHASE9_PLAN Task 17, SPEC D65): /jobs is the Jobs list,
// /work and /pipeline land on it, and Leads, Quotes and Money are lists of
// their own records.
test('/work lands on /jobs and keeps its stage', async ({ context, page }) => {
  await signIn(context, { tables: TABLES })
  await open(page, '/work')
  await expect(page).toHaveURL(/\/jobs$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Plumbing Bellevue').first()).toBeVisible()

  await open(page, '/work?stage=lost&q=mill')
  await expect(page).toHaveURL(/\/jobs\?stage=lost&q=mill$/, { timeout: 30_000 })
  await open(page, '/pipeline')
  await expect(page).toHaveURL(/\/jobs$/, { timeout: 30_000 })
})

test('/jobs, /leads, /quotes and /invoices are their own lists', async ({ context, page }) => {
  await signIn(context, { tables: TABLES })
  await open(page, '/jobs')
  await expect(page).toHaveURL(/\/jobs$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })

  await open(page, '/leads')
  await expect(page).toHaveURL(/\/leads$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Ghost drainage').first()).toBeVisible()

  await open(page, '/quotes')
  await expect(page).toHaveURL(/\/quotes$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Quotes' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Ghost repour').first()).toBeVisible()

  await open(page, '/invoices')
  await expect(page).toHaveURL(/\/invoices$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible({ timeout: 30_000 })
})

test('the phone dock keeps Today, Jobs, Capture, Money, Schedule and Jobs goes to /jobs', async ({ context, page, isMobile }) => {
  test.skip(!isMobile, 'The dock is the phone shell')
  await signIn(context, { tables: TABLES })
  await open(page, '/')
  const dock = page.getByRole('navigation', { name: 'Primary' })
  await expect(dock).toBeVisible({ timeout: 30_000 })
  for (const label of ['Today', 'Jobs', 'Money', 'Schedule']) {
    await expect(dock.getByRole('link', { name: label })).toBeVisible()
  }
  await expect(dock.getByRole('button', { name: /Capture/ })).toBeVisible()
  await expect(dock.getByRole('link', { name: 'Jobs' })).toHaveAttribute('href', '/jobs')
  await dock.getByRole('link', { name: 'Jobs' }).click()
  await expect(page).toHaveURL(/\/jobs$/)
  await expect(dock.getByRole('link', { name: 'Jobs' })).toHaveAttribute('aria-current', 'page')
})
