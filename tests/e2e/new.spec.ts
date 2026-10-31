// The New screen and the create screens (PHASE9_PLAN Task 8, SPEC D57 to
// D59). One New button opens /new, a full screen with five rows; each row
// goes straight to that record's create screen, which saves with one gold
// button and lands on the record it made. The mock does not save writes:
// an insert answers with the first row of its table, so each test seeds
// the row the write would have made and expects to land on it.
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

// A job first in fh_contacts, so an insert there answers with a job and
// the screen lands on /jobs/:id instead of a moved row's redirect.
const JOB_FIRST = {
  fh_contacts: [
    contact({ id: 'c-job1', stage: 'job', name: 'Plumbing Bellevue', job_title: 'Slab + trench', amount: 33100 }),
    contact({ id: 'c-job2', stage: 'job', name: 'Harold Wickham', job_title: 'Driveway replacement', amount: 12800 })
  ],
  fh_payments: [
    { id: 'p1', user_id: 'qa-user-1', contact_id: 'c-job2', amount: 6400, method: 'check', reference: '1042', paid_on: '2026-10-02', created_at: '2026-10-02T12:00:00Z' }
  ]
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
}

test('New opens a full screen with five rows', async ({ context, page }) => {
  await signIn(context)
  await open(page, '/')
  await page.getByRole('link', { name: 'New', exact: true }).first().click()
  await expect(page).toHaveURL(/\/new$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'New' })).toBeVisible()
  // No sheet or dialog: the rows sit on the page itself.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  const rows = page.getByRole('list', { name: 'What to create' }).getByRole('link')
  await expect(rows).toHaveCount(5)
  await expect(rows).toHaveText([/^Lead/, /^Quote/, /^Job/, /^Invoice/, /^Client/])
  await expect(rows.nth(0)).toHaveAttribute('href', '/leads/new')
  await expect(rows.nth(1)).toHaveAttribute('href', '/quotes/new')
  await expect(rows.nth(2)).toHaveAttribute('href', '/jobs/new')
  await expect(rows.nth(3)).toHaveAttribute('href', '/invoices/new')
  await expect(rows.nth(4)).toHaveAttribute('href', '/clients/new')
  await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
})

test('New quote never shows the lead form', async ({ context, page }) => {
  await signIn(context)
  await open(page, '/new')
  await page.getByRole('link', { name: /^Quote/ }).click()
  await expect(page).toHaveURL(/\/quotes\/new$/, { timeout: 30_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'New quote' })).toBeVisible()
  await expect(page.getByLabel('Client')).toBeVisible()
  await expect(page.getByText('Pipeline step')).toHaveCount(0)
  await expect(page.getByText('Source')).toHaveCount(0)
  await expect(page.getByText('Lead intake')).toHaveCount(0)
  await expect(page.getByLabel('Phone')).toHaveCount(0)
  // One gold button on the screen: Save.
  await expect(page.locator('main .fhc-btn--primary')).toHaveCount(1)
  await expect(page.getByRole('button', { name: 'Save quote' })).toBeVisible()
})

test('a lead saves with only a name in two taps', async ({ context, page }) => {
  await signIn(context)
  await open(page, '/leads/new')
  await expect(page.getByRole('heading', { level: 1, name: 'New lead' })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Name').fill('Mike Salas')
  await page.getByRole('button', { name: 'Save lead' }).click()
  // The mock answers the fh_leads insert with its first row.
  await expect(page).toHaveURL(/\/leads\/l-lead1$/, { timeout: 30_000 })
})

test('a job saves with a client and a title', async ({ context, page }) => {
  await signIn(context, { tables: JOB_FIRST })
  const inserts: Record<string, unknown>[] = []
  await context.route(/\/rest\/v1\/fh_contacts(\?|$)/, async (route) => {
    if (route.request().method() === 'POST') inserts.push(route.request().postDataJSON())
    await route.fallback()
  })
  await open(page, '/jobs/new')
  await expect(page.getByRole('heading', { level: 1, name: 'New job' })).toBeVisible({ timeout: 30_000 })
  const client = page.getByLabel('Client')
  await client.fill('Jeff')
  await page.getByRole('option', { name: /Jeff Roy/ }).click()
  await page.getByLabel('Title').fill('Shed slab')
  await page.getByRole('button', { name: 'Save job' }).click()
  await expect(page).toHaveURL(/\/jobs\/c-job1/, { timeout: 30_000 })
  expect(inserts).toHaveLength(1)
  expect(inserts[0]).toMatchObject({ stage: 'job', client_id: 'cl-1', job_title: 'Shed slab', name: 'Jeff Roy' })
})

test('an invoice from a job prefills only unbilled contract value', async ({ context, page }) => {
  await signIn(context, { tables: {
    ...JOB_FIRST,
    // The paid deposit consumes half the contract. Do not inherit the
    // default sent progress invoice, which already bills the other half.
    fh_invoices: [{ id: 'inv0', user_id: 'qa-user-1', client_id: 'cl-1', contact_id: 'c-job2', title: 'Deposit', amount: 6400, status: 'paid', sequence_number: 1, issued_at: NOW, created_at: NOW }]
  } })
  await open(page, '/invoices/new?job=c-job2')
  await expect(page.getByRole('heading', { level: 1, name: 'New invoice' })).toBeVisible({ timeout: 30_000 })
  // Harold's $12,800 contract less the $6,400 already invoiced.
  await expect(page.getByLabel('Amount')).toHaveValue('6400', { timeout: 30_000 })
  await expect(page.getByLabel('Description')).toHaveValue('Driveway replacement')
  await expect(page.getByLabel('Client')).toHaveValue('Jeff Roy')
  await page.getByRole('button', { name: 'Save invoice' }).click()
  await expect(page).toHaveURL(/\/invoices\/inv0$/, { timeout: 30_000 })
})

test('a fully invoiced job never prefills or saves the unpaid balance again', async ({ context, page }) => {
  await signIn(context, { tables: JOB_FIRST })
  let invoiceWrites = 0
  await context.route(/\/rest\/v1\/fh_invoices(\?|$)/, async (route) => {
    if (route.request().method() === 'POST') invoiceWrites += 1
    await route.fallback()
  })
  await open(page, '/invoices/new?job=c-job2')
  // Default records already invoice the full 12800, despite 6400 remaining unpaid.
  await expect(page.getByLabel('Description')).toHaveValue('Driveway replacement')
  await expect(page.getByLabel('Client')).toHaveValue('Jeff Roy')
  await expect(page.getByLabel('Amount')).toHaveValue('')
  await page.getByLabel('Amount').fill('6400')
  await page.getByRole('button', { name: 'Save invoice' }).click()
  await expect(page.getByText(/Only \$0(?:\.00)? remains unreserved/)).toBeVisible()
  expect(invoiceWrites).toBe(0)
})

test('typing a new name on Quote creates the client', async ({ context, page }) => {
  await signIn(context)
  const clientInserts: Record<string, unknown>[] = []
  await context.route(/\/rest\/v1\/fh_clients(\?|$)/, async (route) => {
    if (route.request().method() === 'POST') clientInserts.push(route.request().postDataJSON())
    await route.fallback()
  })
  await open(page, '/quotes/new')
  await expect(page.getByRole('heading', { level: 1, name: 'New quote' })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Client').fill('Dana Whitfield')
  await expect(page.getByText('Checks for an existing client when saving. Adds a client only if no match exists.')).toBeVisible()
  await page.getByRole('button', { name: 'Save quote' }).click()
  await expect(page).toHaveURL(/\/quotes\/q-quote/, { timeout: 30_000 })
  expect(clientInserts).toHaveLength(1)
  expect(clientInserts[0]).toMatchObject({ name: 'Dana Whitfield' })
})
