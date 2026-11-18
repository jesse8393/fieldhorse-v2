// The New screen and the create screens (PHASE9_PLAN Task 8, SPEC D57 to
// D59). One New button opens /new, a full screen with five rows; each row
// goes straight to that record's create screen, which saves with one gold
// button and lands on the record it made. The mock does not save writes:
// an insert answers with the first row of its table, so each test seeds
// the row the write would have made and expects to land on it.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { isReadOnlyRpc } from './helpers/readRpc.ts'
import { FAIL, expectPlain, failRest } from './helpers/rawErrors.ts'

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

// dead-ends-3: crew and foremen cannot create leads, quotes, jobs or
// invoices, so the header offers them no New to tap and bounce off.
for (const role of ['crew', 'foreman']) {
  test(`${role} see no New button in the header`, async ({ context, page }) => {
    await signIn(context, { role })
    for (const path of ['/crew', '/schedule', '/jobs']) {
      await open(page, path)
      const header = page.locator('.fh-app-header')
      await expect(header.getByRole('button', { name: 'Search everything' })).toBeVisible({ timeout: 30_000 })
      await expect(header.getByRole('link', { name: 'New', exact: true })).toHaveCount(0)
      await expect(page).toHaveURL(new RegExp(`${path}$`))
    }
  })
}

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

// raw-errors-2: a refused or dropped save on New job showed the database's
// words or "TypeError: Failed to fetch" above Save job.
test('a refused or dropped save on New job says what to do in plain words', async ({ context, page }) => {
  await signIn(context, { tables: JOB_FIRST })
  let answer: 'refuse' | 'drop' = 'refuse'
  await context.route(/\/rest\/v1\/fh_contacts(\?|$)/, (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    return answer === 'drop' ? route.abort('failed') : route.fulfill(FAIL.rls('fh_contacts'))
  })
  await open(page, '/jobs/new')
  await expect(page.getByRole('heading', { level: 1, name: 'New job' })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Client').fill('Jeff')
  await page.getByRole('option', { name: /Jeff Roy/ }).click()
  await page.getByLabel('Title').fill('Shed slab')
  await page.getByRole('button', { name: 'Save job' }).click()
  await expectPlain(page.locator('.fhnew-error'), 'Could not save this job. Your role does not allow this. Ask an owner or admin.')
  answer = 'drop'
  await page.getByRole('button', { name: 'Save job' }).click()
  await expectPlain(page.locator('.fhnew-error'), 'Could not save this job. No signal right now. Your work is still here, so try again when the signal is back.')
  await expect(page.getByLabel('Title')).toHaveValue('Shed slab')
})

// raw-errors-3: the quote helper let the database's refusal through.
test('a refused save on New quote says so in plain words', async ({ context, page }) => {
  await signIn(context)
  await failRest(context, 'fh_quotes', 'POST', FAIL.rls('fh_quotes'))
  await open(page, '/quotes/new')
  await expect(page.getByRole('heading', { level: 1, name: 'New quote' })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Client').fill('Jeff')
  await page.getByRole('option', { name: /Jeff Roy/ }).click()
  await page.getByRole('button', { name: 'Save quote' }).click()
  await expectPlain(page.locator('.fhnew-error'), 'Could not save this quote. Your role does not allow this. Ask an owner or admin.')
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

// The job type picked on the last saved job or quote starts the next New
// job and New quote, as the old lead sheet did (vibe audit
// settings-wiped-2). A company that pours concrete picks it once.
test('the job type of the last saved job starts the next New job and New quote', async ({ context, page }) => {
  await signIn(context, { tables: JOB_FIRST })
  await open(page, '/jobs/new')
  await expect(page.getByRole('heading', { level: 1, name: 'New job' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel(/Job type/)).toHaveValue('')
  await page.getByLabel('Client').fill('Jeff')
  await page.getByRole('option', { name: /Jeff Roy/ }).click()
  await page.getByLabel('Title').fill('Shed slab')
  await page.getByLabel(/Job type/).selectOption('Concrete')
  await page.getByRole('button', { name: 'Save job' }).click()
  await expect(page).toHaveURL(/\/jobs\/c-job1/, { timeout: 30_000 })

  await open(page, '/quotes/new')
  await expect(page.getByLabel(/Job type/)).toHaveValue('Concrete', { timeout: 30_000 })
  await page.getByLabel('Client').fill('Dana Whitfield')
  await page.getByLabel(/Job type/).selectOption('Roofing')
  await page.getByRole('button', { name: 'Save quote' }).click()
  await expect(page).toHaveURL(/\/quotes\/q-quote/, { timeout: 30_000 })
  await open(page, '/jobs/new')
  await expect(page.getByLabel(/Job type/)).toHaveValue('Roofing', { timeout: 30_000 })
})

// A Save right after a change left the draft timer running. It wrote the
// saved job back as the draft once the job screen was loading, so the next
// New job opened refilled with the job just saved.
test('a saved job leaves no draft behind', async ({ context, page }) => {
  await signIn(context, { tables: JOB_FIRST })
  await open(page, '/jobs/new')
  await expect(page.getByRole('heading', { level: 1, name: 'New job' })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Client').fill('Jeff')
  await page.getByRole('option', { name: /Jeff Roy/ }).click()
  await page.getByLabel('Title').fill('Shed slab')
  await page.getByLabel(/Job type/).selectOption('Concrete')
  await page.getByRole('button', { name: 'Save job' }).click()
  await expect(page).toHaveURL(/\/jobs\/c-job1/, { timeout: 30_000 })
  await page.waitForTimeout(1000)
  expect(await page.evaluate(() => localStorage.getItem('fh:draft:job'))).toBeNull()
})

// Most leads carry no job type, because New lead has no such field. Quote
// this on one of them kept the remembered job type only when the lead
// named none of its own.
function lead(partial: Record<string, unknown>) {
  return {
    user_id: 'qa-user-1', client_id: 'cl-1', status: 'open', notes: null, last_contact: null, quote_id: null, follow_up_on: null,
    source: 'Google', referred_by: null, origin_contact_id: null, created_at: NOW, updated_at: NOW,
    fh_clients: { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' },
    ...partial
  }
}
const LEAD_PLAIN = lead({ id: 'l-plain', title: 'Backyard patio', job_type: null })
const LEAD_ROOF = lead({ id: 'l-roof', title: 'Garage roof', job_type: 'Roofing' })

test('Quote this on a lead with no job type keeps the remembered job type', async ({ context, page }) => {
  await signIn(context, { tables: { fh_leads: [LEAD_PLAIN, LEAD_ROOF] } })
  await context.addInitScript(() => { localStorage.setItem('fh:last-job-type', 'Concrete') })
  await open(page, '/quotes/new?lead=l-plain')
  await expect(page.getByLabel('Title')).toHaveValue('Backyard patio', { timeout: 30_000 })
  await expect(page.getByLabel('Client')).toHaveValue('Jeff Roy')
  await expect(page.getByLabel(/Job type/)).toHaveValue('Concrete')
  // A lead that names its own job type still starts the quote with it.
  await open(page, '/quotes/new?lead=l-roof')
  await expect(page.getByLabel('Title')).toHaveValue('Garage roof', { timeout: 30_000 })
  await expect(page.getByLabel(/Job type/)).toHaveValue('Roofing')
})

test('the job type the old lead sheet remembered still starts New job', async ({ context, page }) => {
  await signIn(context)
  // The build before the October redesign kept it under fh:lastJobType.
  await context.addInitScript(() => {
    if (sessionStorage.getItem('old-job-type-seeded')) return
    sessionStorage.setItem('old-job-type-seeded', '1')
    localStorage.setItem('fh:lastJobType', 'Concrete')
  })
  await open(page, '/jobs/new')
  await expect(page.getByLabel(/Job type/)).toHaveValue('Concrete', { timeout: 30_000 })
  expect(await page.evaluate(() => localStorage.getItem('fh:lastJobType'))).toBeNull()
  await open(page, '/quotes/new')
  await expect(page.getByLabel(/Job type/)).toHaveValue('Concrete', { timeout: 30_000 })
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

// Audit finding DATA-12: a save whose answer is lost, tapped again, must
// address the same quote, so the database cannot hold it twice.
test('saving a quote again after a lost answer sends the same id', async ({ context, page }) => {
  await signIn(context)
  const inserts: Record<string, unknown>[] = []
  await context.route(/\/rest\/v1\/fh_quotes(\?|$)/, async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    inserts.push(route.request().postDataJSON())
    if (inserts.length === 1) return route.abort('connectionreset')
    return route.fallback()
  })
  await open(page, '/quotes/new?client=cl-1')
  await expect(page.getByRole('heading', { level: 1, name: 'New quote' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('Client')).toHaveValue('Jeff Roy')
  await page.getByRole('button', { name: 'Save quote' }).click()
  await expect.poll(() => inserts.length).toBe(1)
  await expect(page).toHaveURL(/\/quotes\/new/)
  await page.getByRole('button', { name: 'Save quote' }).click()
  await expect(page).toHaveURL(/\/quotes\/q-quote/, { timeout: 30_000 })
  expect(inserts).toHaveLength(2)
  expect(typeof inserts[0].id).toBe('string')
  expect(inserts[1].id).toBe(inserts[0].id)
})

const LEAD_WITH_NOTES = {
  id: 'l-notes', user_id: 'qa-user-1', client_id: 'cl-1', status: 'open', title: 'Backyard drainage', job_type: 'Drainage',
  notes: 'Husband says no more than 5k. Dog bites. Gate code 4411.', last_contact: null, quote_id: null, follow_up_on: null,
  source: 'Google', referred_by: null, origin_contact_id: null, created_at: NOW, updated_at: NOW,
  fh_clients: { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }
}

// Phone sales audit finding S11: lead notes are internal and never become
// the scope of work the customer reads.
test('Quote this keeps the lead notes off the scope of work', async ({ context, page }) => {
  await signIn(context, { tables: { fh_leads: [LEAD_WITH_NOTES] } })
  await open(page, '/quotes/new?lead=l-notes')
  await expect(page.getByLabel('Title')).toHaveValue('Backyard drainage', { timeout: 30_000 })
  await expect(page.getByLabel('Client')).toHaveValue('Jeff Roy')
  await expect(page.getByLabel('Scope')).toHaveValue('')
})

// Phone sales audit finding S21: a Quote this visit never becomes the next
// New quote's draft.
test('backing out of Quote this leaves the next New quote blank', async ({ context, page }) => {
  await signIn(context, { tables: { fh_leads: [LEAD_WITH_NOTES] } })
  await open(page, '/quotes/new?lead=l-notes')
  await expect(page.getByLabel('Title')).toHaveValue('Backyard drainage', { timeout: 30_000 })
  await page.waitForTimeout(800)
  await open(page, '/quotes/new')
  await expect(page.getByRole('heading', { level: 1, name: 'New quote' })).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('Title')).toHaveValue('')
  await expect(page.getByLabel('Client')).toHaveValue('')
})

// Phone sales audit finding S23: when the lead could not be read, Quote
// this opened a blank quote with nothing to say why.
test('Quote this says when the lead could not be read, and fills it on Retry', async ({ context, page }) => {
  await signIn(context, { tables: { fh_leads: [LEAD_WITH_NOTES] } })
  let signal = false
  await context.route(/\/rest\/v1\/fh_leads\?/, route => {
    if (route.request().method() !== 'GET' || signal) return route.fallback()
    return route.abort('internetdisconnected')
  })
  await open(page, '/quotes/new?lead=l-notes')
  const notice = page.getByRole('alert').filter({ hasText: 'Could not fill this quote from the lead' })
  await expect(notice).toBeVisible({ timeout: 30_000 })
  await expect(page.getByLabel('Title')).toHaveValue('')
  signal = true
  await notice.getByRole('button', { name: 'Retry', exact: true }).click()
  await expect(page.getByLabel('Title')).toHaveValue('Backyard drainage')
  await expect(page.getByLabel('Client')).toHaveValue('Jeff Roy')
  await expect(notice).toHaveCount(0)
})

// The client field read only the 200 most recently active clients, so an
// older client was never suggested and Save made a duplicate (DATA-09).
test('the client field finds a client outside the 200 most recently active', async ({ context, page }) => {
  const recent = Array.from({ length: 200 }, (_, i) => ({
    id: `cl-r${i}`, user_id: 'qa-user-1', name: `Recent Client ${i}`, phone: null, email: null, address: null,
    company_name: null, last_activity_at: new Date(Date.parse(NOW) - i * 60_000).toISOString(), created_at: NOW
  }))
  const zelda = {
    id: 'cl-zelda', user_id: 'qa-user-1', name: 'Zelda Oldcustomer & Family', phone: '615.555.0199', email: null,
    address: '9 Old Mill Rd', company_name: null, last_activity_at: '2024-01-01T00:00:00.000Z', created_at: '2023-01-01T00:00:00.000Z'
  }
  await signIn(context, { tables: { fh_clients: [...recent, zelda] } })
  // The mock ignores or= and ilike filters, so answer the search here the
  // way the database would: name, company, email or phone contains the text.
  await page.route(/\/rest\/v1\/fh_clients\?.*or=/, async (route) => {
    const params = new URL(route.request().url()).searchParams
    const typed = (params.get('or') || '').match(/name\.ilike\."%(.*?)%"/)?.[1]?.toLowerCase() || ''
    const rows = [...recent, zelda].filter((c) => c.name.toLowerCase().includes(typed))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows.slice(0, 25)) })
  })
  const writes: string[] = []
  page.on('request', (req) => { if (req.method() === 'POST' && req.url().includes('/rest/v1/')) writes.push(new URL(req.url()).pathname.split('/rest/v1/')[1]) })
  await open(page, '/leads/new')
  await expect(page.getByRole('heading', { level: 1, name: 'New lead' })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Name').fill('Zelda Old')
  const option = page.getByRole('option', { name: /Zelda Oldcustomer & Family/ })
  await expect(option).toBeVisible()
  await option.click()
  await expect(page.getByText('Saves to Zelda Oldcustomer & Family.')).toBeVisible()
  await page.getByRole('button', { name: 'Save lead' }).click()
  await expect(page).toHaveURL(/\/leads\/l-lead1$/, { timeout: 30_000 })
  expect(writes).not.toContain('fh_clients')
  expect(writes).toContain('fh_leads')
})

/**
 * Answers the first insert into `table` with a dropped connection after
 * recording it, the way a weak signal loses the answer to a save the
 * server made. Returns every insert body sent.
 */
async function loseFirstAnswer(page: Page, table: string): Promise<string[]> {
  const bodies: string[] = []
  await page.route(new RegExp(`/rest/v1/${table}(\\?|$)`), async (route) => {
    const req = route.request()
    if (req.method() !== 'POST') return route.fallback()
    bodies.push(req.postData() ?? '')
    if (bodies.length === 1) return route.abort('connectionreset')
    return route.fallback()
  })
  return bodies
}

const rowId = (body: string) => {
  const j = JSON.parse(body)
  return (Array.isArray(j) ? j[0] : j).id ?? null
}

test('a lead save whose answer was lost is retried on the same row (DATA-12)', async ({ context, page }) => {
  await signIn(context)
  const bodies = await loseFirstAnswer(page, 'fh_leads')
  await open(page, '/leads/new')
  await page.getByLabel('Name').fill('Jeff')
  await page.locator('.fhnew-client__pick').first().click()
  await page.getByRole('button', { name: 'Save lead' }).click()
  await expect(page.locator('.fhnew-error')).toBeVisible()
  await page.getByRole('button', { name: 'Save lead' }).click()
  await expect(page).toHaveURL(/\/leads\/l-lead1$/, { timeout: 30_000 })
  expect(bodies).toHaveLength(2)
  expect(rowId(bodies[0])).toBeTruthy()
  expect(rowId(bodies[1])).toBe(rowId(bodies[0]))
})

test('a client save whose answer was lost is retried on the same row (DATA-12)', async ({ context, page }) => {
  await signIn(context)
  const bodies = await loseFirstAnswer(page, 'fh_clients')
  await open(page, '/clients/new')
  await page.getByLabel('Name').fill('Mike Salas')
  await page.getByRole('button', { name: 'Save client' }).click()
  await expect(page.locator('.fhnew-error')).toBeVisible()
  await page.getByRole('button', { name: 'Save client' }).click()
  await expect(page).toHaveURL(/\/clients\/cl-1$/, { timeout: 30_000 })
  expect(bodies).toHaveLength(2)
  expect(rowId(bodies[0])).toBeTruthy()
  expect(rowId(bodies[1])).toBe(rowId(bodies[0]))
})

test('an invoice save whose answer was lost is retried on the same invoice (DATA-12)', async ({ context, page }) => {
  await signIn(context)
  const bodies = await loseFirstAnswer(page, 'fh_invoices')
  await open(page, '/invoices/new?client=cl-1')
  await expect(page.getByLabel('Client')).toHaveValue('Jeff Roy', { timeout: 30_000 })
  await page.getByLabel('Amount').fill('1240')
  await page.getByRole('button', { name: 'Save invoice' }).click()
  await expect(page.locator('.fhnew-error')).toBeVisible()
  await page.getByRole('button', { name: 'Save invoice' }).click()
  await expect(page).toHaveURL(/\/invoices\/inv0$/, { timeout: 30_000 })
  expect(bodies).toHaveLength(2)
  expect(rowId(bodies[0])).toBeTruthy()
  expect(rowId(bodies[1])).toBe(rowId(bodies[0]))
})

test('a lost connection on New lead and New client reads as a plain sentence (DATA-22)', async ({ context, page }) => {
  await signIn(context)
  await page.route(/\/rest\/v1\/fh_(leads|clients)(\?|$)/, (route) => route.request().method() === 'POST' ? route.abort('failed') : route.fallback())
  await open(page, '/leads/new')
  await page.getByLabel('Name').fill('Jeff')
  await page.locator('.fhnew-client__pick').first().click()
  await page.getByRole('button', { name: 'Save lead' }).click()
  await expect(page.locator('.fhnew-error')).toHaveText('Could not save this lead. Check your connection and try again.')

  await open(page, '/clients/new')
  await page.getByLabel('Name').fill('Mike Salas')
  await page.getByRole('button', { name: 'Save client' }).click()
  await expect(page.locator('.fhnew-error')).toHaveText('Could not save this client. Check your connection and try again.')
})

test('a new lead shows in Leads when the person goes back (DATA-13)', async ({ context, page }) => {
  await signIn(context)
  let leadReads = 0
  page.on('request', (req) => { if (req.method() === 'GET' && /\/rest\/v1\/fh_leads\?/.test(req.url())) leadReads++ })
  await open(page, '/leads')
  await expect(page.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible({ timeout: 30_000 })
  await page.getByRole('link', { name: 'New lead' }).click()
  await page.getByLabel('Name').fill('Jeff')
  await page.locator('.fhnew-client__pick').first().click()
  const before = leadReads
  await page.getByRole('button', { name: 'Save lead' }).click()
  await expect(page).toHaveURL(/\/leads\/l-lead1$/, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Back' }).first().click()
  await expect(page).toHaveURL(/\/leads$/)
  // The list read again after the save instead of showing its old copy.
  await expect.poll(() => leadReads - before, { timeout: 5000 }).toBeGreaterThan(0)
})

test('a new invoice shows in Money when the person goes back (DATA-13)', async ({ context, page }) => {
  await signIn(context)
  // Money's own list read (the 500 most recent invoices), not the invoice screen's.
  let listReads = 0
  page.on('request', (req) => {
    const url = decodeURIComponent(req.url())
    if (req.method() === 'GET' && /\/rest\/v1\/fh_invoices\?/.test(url) && url.includes('order=created_at.desc') && url.includes('limit=500')) listReads++
  })
  await open(page, '/invoices')
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible({ timeout: 30_000 })
  await expect.poll(() => listReads).toBeGreaterThan(0)
  await page.getByRole('link', { name: 'New invoice' }).first().click()
  await expect(page.getByRole('heading', { level: 1, name: 'New invoice' })).toBeVisible({ timeout: 30_000 })
  await page.getByLabel('Client').fill('Jeff')
  await page.locator('.fhnew-client__pick').first().click()
  await page.getByLabel('Amount').fill('1240')
  const before = listReads
  await page.getByRole('button', { name: 'Save invoice' }).click()
  await expect(page).toHaveURL(/\/invoices\/inv0$/, { timeout: 30_000 })
  await page.getByRole('button', { name: 'Back' }).first().click()
  await expect(page).toHaveURL(/\/invoices$/)
  // Money read its list again after the save instead of showing its old copy.
  await expect.poll(() => listReads - before, { timeout: 5000 }).toBeGreaterThan(0)
})

// D23: a create form's draft was written 0.4 s after the last keystroke,
// and the timer died with the screen, so the last words typed before Back
// or a reload were lost. Each step types and leaves in the same moment.
test('a create form keeps what was typed just before Back or a reload (D23)', async ({ context, page }) => {
  await signIn(context)
  await open(page, '/new')
  const newJob = page.getByRole('list', { name: 'What to create' }).getByRole('link', { name: /^Job/ })
  await newJob.click()
  const title = page.getByLabel('Title')
  await expect(title).toBeVisible({ timeout: 30_000 })
  await title.evaluate((el) => {
    const input = el as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Shed slab')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    document.querySelector<HTMLButtonElement>('.fhnew-head button[aria-label="Back"]')!.click()
  })
  await expect(page).toHaveURL(/\/new$/)
  await newJob.click()
  await expect(title).toHaveValue('Shed slab', { timeout: 30_000 })

  await title.evaluate((el) => {
    const input = el as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Shed slab and apron')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    window.location.reload()
  })
  await expect(page.getByRole('heading', { level: 1, name: 'New job' })).toBeVisible({ timeout: 30_000 })
  await expect(title).toHaveValue('Shed slab and apron', { timeout: 30_000 })
})

test('the first field keeps its focus on New lead and New client (S20)', async ({ context, page }) => {
  await signIn(context)
  await open(page, '/leads/new')
  await expect(page.getByLabel('Name')).toBeFocused({ timeout: 30_000 })
  await open(page, '/clients/new')
  await expect(page.getByLabel('Name')).toBeFocused({ timeout: 30_000 })
})

test('New client points to a client who already exists before making a second one (S25)', async ({ context, page }) => {
  await signIn(context)
  const posts: string[] = []
  page.on('request', (req) => { if (req.method() === 'POST' && req.url().includes('/rest/v1/fh_clients')) posts.push(req.postData() ?? '') })
  await open(page, '/clients/new')
  await page.getByLabel('Name').fill('Jeff Roy')
  await page.getByRole('button', { name: 'Save client' }).click()
  await expect(page.getByText('Jeff Roy is already a client.', { exact: false })).toBeVisible()
  await page.waitForTimeout(300)
  expect(posts).toEqual([])
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.getByRole('button', { name: 'Open Jeff Roy' }).click()
  await expect(page).toHaveURL(/\/clients\/cl-1$/)
  expect(posts).toEqual([])
})

test('New client saves a second client with the same name only when asked (S25)', async ({ context, page }) => {
  await signIn(context)
  const posts: string[] = []
  page.on('request', (req) => { if (req.method() === 'POST' && req.url().includes('/rest/v1/fh_clients')) posts.push(req.postData() ?? '') })
  await open(page, '/clients/new')
  await page.getByLabel('Name').fill('Jeff Roy')
  await page.getByRole('button', { name: 'Save client' }).click()
  await page.getByRole('button', { name: 'Save a new client' }).click()
  await expect(page).toHaveURL(/\/clients\/cl-1$/, { timeout: 30_000 })
  expect(posts).toHaveLength(1)
})

test('New client refuses an email that is not one (S25)', async ({ context, page }) => {
  await signIn(context)
  const posts: string[] = []
  // The bell's reminder read is a POST that changes nothing.
  page.on('request', (req) => { if (req.method() === 'POST' && req.url().includes('/rest/v1/') && !isReadOnlyRpc(req.url())) posts.push(req.url()) })
  await open(page, '/clients/new')
  await page.getByLabel('Name').fill('Maria Lopez')
  for (const bad of ['Not-An-Email', 'MARIA@@bad']) {
    await page.getByLabel('Email').fill(bad)
    await page.getByRole('button', { name: 'Save client' }).click()
    await expect(page.getByText('Enter an email like name@example.com.')).toBeVisible()
  }
  await page.waitForTimeout(300)
  expect(posts).toEqual([])
})

// D14: on a wide screen the create forms sit in the middle like New does,
// so the column does not jump sideways from New to the form it opens.
test('create forms are centred on desktop, in line with New', async ({ context, page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop width')
  await signIn(context)
  await page.setViewportSize({ width: 1440, height: 900 })
  const centre = async (path: string) => {
    await open(page, path)
    await expect(page.locator('.fhnew').first()).toBeVisible({ timeout: 30_000 })
    return page.evaluate(() => {
      const r = document.querySelector('.fhnew')!.getBoundingClientRect()
      const main = document.querySelector('#fh-main')!.getBoundingClientRect()
      return { mid: Math.round(r.left + r.width / 2), mainMid: Math.round(main.left + main.width / 2) }
    })
  }
  const quote = await centre('/quotes/new')
  expect(Math.abs(quote.mid - quote.mainMid)).toBeLessThanOrEqual(2)
  const lead = await centre('/leads/new')
  expect(Math.abs(lead.mid - lead.mainMid)).toBeLessThanOrEqual(2)
})

// A11Y-08: a save that fails on one field marks that field: aria-invalid,
// the message tied to it with aria-describedby, and focus on the field,
// so tabbing back to it still says what is wrong (WCAG 3.3.1, 1.3.1).
for (const { path, save, field, message, clear = false } of [
  { path: '/leads/new', save: 'Save lead', field: { role: 'combobox', name: /^Name/ }, message: 'Enter a name.' },
  { path: '/quotes/new', save: 'Save quote', field: { role: 'combobox', name: /^Client/ }, message: 'Enter a client.' },
  // The amount starts at the balance; the test empties it.
  { path: '/jobs/c-job1/payment', save: 'Record payment', field: { role: 'textbox', name: /^Amount/ }, message: 'Enter an amount above zero.', clear: true },
  { path: '/miles/new', save: 'Save miles', field: { role: 'spinbutton', name: /^Miles/ }, message: 'Enter the miles driven.' },
  { path: '/subs/new', save: 'Add sub', field: { role: 'textbox', name: /^Name/ }, message: 'Enter the sub or company name.' },
] as const) {
  test(`an empty save on ${path} marks the field that needs it`, async ({ context, page }) => {
    await signIn(context)
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const input = page.getByRole(field.role, { name: field.name }).first()
    await expect(input).toBeVisible({ timeout: 30_000 })
    if (clear) await input.fill('')
    await page.getByRole('button', { name: save, exact: true }).click()
    await expect(input).toHaveAttribute('aria-invalid', 'true')
    await expect(input).toHaveAccessibleDescription(new RegExp(message.replace('.', '\\.')))
    await expect(input).toBeFocused()
  })
}

// A11Y-09: New lead says which field it cannot save without before a save
// fails: Name reads Required on screen and to assistive tech (WCAG 3.3.2).
test('New lead marks its name as required', async ({ context, page }) => {
  await signIn(context)
  await open(page, '/leads/new')
  const name = page.getByRole('combobox', { name: /^Name/ })
  await expect(name).toBeVisible()
  const required = (field: typeof name) => field.evaluate(el => (el as HTMLInputElement).required || el.getAttribute('aria-required') === 'true')
  expect(await required(name)).toBe(true)
  await expect(page.locator('label', { has: page.getByText('Required', { exact: true }) })).toHaveText(/^Name\s*Required$/)
  // The optional fields stay optional.
  expect(await required(page.getByRole('textbox', { name: /^Phone/ }))).toBe(false)
})
