// Customers in the redesign (PHASE9_PLAN.md Task 14, D57): the pop ups the
// Customers list and the customer page opened are screens. Reviewing
// duplicates is /clients/merge, a customer's statement is
// /clients/:id/statement (also where Money's Who owes you goes), and
// deleting a customer confirms with a second tap on the same button.
// Nothing here mounts a dialog.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { isReadOnlyRpc } from './helpers/readRpc.ts'
import { USER } from '../../scripts/qa-mock.mjs'

const NOW = Date.now()
const DAY = 86400000
const iso = (ms: number) => new Date(ms).toISOString()

// Two records for the same person: the same phone, different spellings.
const JEFF = { id: 'cl-1', user_id: USER.id, name: 'Jeff Roy', company_name: null, phone: '555-0101', email: 'jeff@roy.com', address: '412 Burkitt Station Rd', created_at: iso(NOW - 60 * DAY) }
const JEFF_AGAIN = { id: 'cl-dup', user_id: USER.id, name: 'Jeffrey Roy', company_name: null, phone: '(555) 010-1', email: null, address: null, created_at: iso(NOW - 3 * DAY) }

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
}

/** Every write the page sends to the mocked database: "METHOD table". */
function watchWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (!['PATCH', 'DELETE', 'POST'].includes(req.method()) || !url.pathname.includes('/rest/v1/')) return
    // The bell's reminder read is a POST that changes nothing.
    if (isReadOnlyRpc(url)) return
    writes.push(`${req.method()} ${url.pathname.split('/rest/v1/')[1]}`)
  })
  return writes
}

test.describe('duplicates are reviewed on a screen', () => {
  test('the banner opens /clients/merge, and merging takes a second tap', async ({ context, page }) => {
    await signIn(context, { tables: { fh_clients: [JEFF, JEFF_AGAIN] } })
    const writes = watchWrites(page)
    await open(page, '/clients')
    await page.getByRole('button', { name: /duplicate/i }).first().click()
    await expect(page).toHaveURL(/\/clients\/merge$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Merge duplicates' })).toBeVisible()

    // One cluster, the oldest record kept by default.
    await expect(page.getByText('1 cluster to review', { exact: false })).toBeVisible()
    const kept = page.getByRole('button', { name: /^Jeff Roy/ })
    await expect(kept).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByRole('button', { name: /^Jeffrey Roy/ })).toHaveAttribute('aria-pressed', 'false')
    await expect(page.getByText('1 duplicate will be deleted.', { exact: false })).toBeVisible()

    // The first tap only arms the button; nothing is written.
    await page.getByRole('button', { name: 'Merge cluster' }).click()
    const again = page.getByRole('button', { name: 'Tap again to merge' })
    await expect(again).toBeVisible()
    await page.waitForTimeout(300)
    expect(writes).toEqual([])

    // The second tap merges: the duplicate is deleted and the cluster is done.
    await page.waitForTimeout(600) // a second tap within 500 ms is ignored (OPS-02)
    await again.click()
    await expect.poll(() => writes.some((w) => w.startsWith('DELETE fh_clients'))).toBe(true)
    await expect(page.getByText('All clean.')).toBeVisible()

    // Back returns to the list.
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/clients$/)
  })

  test("merging moves the duplicate's leads, quotes and invoices, and never deletes it while they are still there", async ({ context, page }) => {
    // The mock does not apply writes, so the moved rows still read as the
    // duplicate's afterwards: exactly the case where the delete must stop.
    await signIn(context, {
      tables: {
        fh_clients: [JEFF, JEFF_AGAIN],
        fh_leads: [{ id: 'lead-dup', user_id: USER.id, client_id: 'cl-dup', title: 'Back patio', status: 'open', created_at: iso(NOW - DAY) }],
        fh_quotes: [{ id: 'q-dup', user_id: USER.id, client_id: 'cl-dup', title: 'Driveway', status: 'approved', amount: 12000, created_at: iso(NOW - DAY) }],
        fh_invoices: [{ id: 'inv-dup', user_id: USER.id, client_id: 'cl-dup', contact_id: null, amount: 500, status: 'sent', created_at: iso(NOW - DAY) }]
      }
    })
    const writes = watchWrites(page)
    await open(page, '/clients/merge')
    await expect(page.getByText('Leads, quotes, jobs, invoices and notes move to the kept client.', { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Merge cluster' }).click()
    await page.getByRole('button', { name: 'Tap again to merge' }).click()

    await expect(page.getByText(/still has leads, quotes and invoices that could not be moved, so it was not deleted/)).toBeVisible()
    for (const table of ['fh_leads', 'fh_quotes', 'fh_invoices', 'fh_contacts']) {
      expect(writes.some((w) => w.startsWith(`PATCH ${table}`)), table).toBe(true)
    }
    expect(writes.some((w) => w.startsWith('DELETE fh_clients'))).toBe(false)
  })

  test('a failed clients read says so instead of "All clean" (S23)', async ({ context, page }) => {
    await signIn(context, { tables: { fh_clients: [JEFF, JEFF_AGAIN] } })
    await page.route(/\/rest\/v1\/fh_clients\?/, (route) => route.request().method() === 'GET'
      ? route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'upstream connect error' }) })
      : route.fallback())
    await open(page, '/clients/merge')
    await expect(page.getByText('Could not load your clients', { exact: false })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('All clean.')).toHaveCount(0)
    await expect(page.getByText(/Nice cleanup/)).toHaveCount(0)
    await expect(page.getByRole('button', { name: /Try again|Retry/ })).toBeVisible()
  })

  test('an unticked record is kept apart without a second tap, and stays unflagged', async ({ context, page }) => {
    await signIn(context, { tables: { fh_clients: [JEFF, JEFF_AGAIN] } })
    const writes = watchWrites(page)
    await open(page, '/clients/merge')
    await page.getByRole('checkbox', { name: /Merge Jeffrey Roy into the record you keep/ }).click()
    await expect(page.getByText("Nothing will be deleted.", { exact: false })).toBeVisible()
    await page.getByRole('button', { name: 'Keep separate' }).click()
    await expect(page.getByText('All clean.')).toBeVisible()
    expect(writes).toEqual([])

    // Remembered on this device: the list no longer flags them.
    await open(page, '/clients')
    await expect(page.getByText('Jeff Roy', { exact: true }).first()).toBeVisible()
    await expect(page.getByRole('button', { name: /duplicate/i })).toHaveCount(0)
  })
})

test.describe('phone search (S14)', () => {
  const MMC = { id: 'cl-mmc', user_id: USER.id, name: 'MMC Properties', company_name: null, phone: '615.555.0199', email: null, address: null, created_at: iso(NOW - 9 * DAY) }

  test('Customers finds a phone typed in any format', async ({ context, page }) => {
    await signIn(context, { tables: { fh_clients: [JEFF, MMC] } })
    await open(page, '/clients')
    // Phone layout: "Search customers"; desktop table: "Search clients".
    const search = page.getByLabel(/^Search (customers|clients)$/)
    await expect(search).toBeVisible({ timeout: 30_000 })
    for (const typed of ['6155550199', '615-555-0199', '(615) 555-0199']) {
      await search.fill(typed)
      await expect(page.getByText('MMC Properties').first()).toBeVisible()
      await expect(page.getByText('No customers match', { exact: false })).toHaveCount(0)
    }
  })

  test('the client field suggests a client by its phone in any format', async ({ context, page }) => {
    await signIn(context, { tables: { fh_clients: [JEFF, MMC] } })
    await open(page, '/jobs/new')
    await page.getByLabel('Client').fill('(615) 555-0199')
    await expect(page.getByRole('option', { name: /MMC Properties/ })).toBeVisible()
  })
})

test('a customer row on the phone has Call (S20)', async ({ context, page, isMobile }) => {
  test.skip(!isMobile, 'The desktop table is a separate component.')
  await signIn(context)
  await open(page, '/clients')
  const call = page.getByRole('link', { name: 'Call Jeff Roy' })
  await expect(call).toBeVisible({ timeout: 30_000 })
  await expect(call).toHaveAttribute('href', 'tel:555-0101')
  const box = await call.boundingBox()
  expect(box && box.width >= 44 && box.height >= 44).toBe(true)
})

test.describe('the customer page', () => {
  test('the statement is a screen with the per property balances', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/clients/cl-1')
    await page.getByRole('button', { name: /^Statement/ }).first().click()
    await expect(page).toHaveURL(/\/clients\/cl-1\/statement$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: /^Statement for/ })).toBeVisible()
    await expect(page.getByText('Total due')).toBeVisible()
    await expect(page.getByRole('list', { name: 'Open balances by property' }).getByRole('listitem').first()).toBeVisible()
    // One gold button: Email statement.
    const gold = page.locator('.fhc-btn--primary')
    await expect(gold).toHaveCount(1)
    await expect(gold).toHaveAccessibleName('Email statement')
    await expect(page.getByRole('button', { name: 'Download' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Copy share link' })).toBeVisible()

    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/clients\/cl-1$/)
  })

  // Audit 2026-11-16 (S05, M-13): Total due is what is owed on sent
  // invoices; a job with nothing invoiced is listed apart, outside it.
  test('the statement totals what is owed on sent invoices and keeps the unbilled contract apart', async ({ context, page }) => {
    const job = (id: string, title: string, amount: number) => ({ id, user_id: USER.id, client_id: 'cl-1', name: 'Jeff Roy', job_title: title, stage: 'job', amount, created_at: iso(NOW - 30 * DAY), updated_at: iso(NOW - DAY) })
    const bill = (id: string, contact: string | null, seq: number, amount: number, status: string, title = `Draw ${seq}`) => ({ id, user_id: USER.id, client_id: 'cl-1', contact_id: contact, sequence_number: seq, title, amount, status, due_at: iso(NOW + 10 * DAY).slice(0, 10), created_at: iso(NOW - 20 * DAY + seq), updated_at: iso(NOW - DAY) })
    await signIn(context, {
      tables: {
        fh_clients: [JEFF],
        fh_contacts: [job('j-drive', 'Driveway', 12800), job('j-garage', 'Garage slab', 33100)],
        fh_invoices: [
          bill('i-1', 'j-drive', 1, 6400, 'paid'),
          bill('i-2', 'j-drive', 2, 6400, 'sent'),
          bill('i-d', null, 1, 500.25, 'sent', 'Sealing')
        ],
        fh_payments: [{ id: 'p-1', user_id: USER.id, contact_id: 'j-drive', invoice_id: 'i-1', amount: 6400, paid_on: iso(NOW - 10 * DAY).slice(0, 10), created_at: iso(NOW - 10 * DAY) }],
        fh_change_orders: []
      }
    })
    const posted: Array<Record<string, unknown>> = []
    // The PDF upload the email step makes first.
    await context.route('**/storage/v1/object/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{"Key":"job-files/statement.pdf"}' }))
    await context.route('**/api/send-statement', async (route) => {
      posted.push(route.request().postDataJSON())
      await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' })
    })
    await open(page, '/clients/cl-1/statement')

    const owed = page.getByRole('list', { name: 'Open balances by property' })
    await expect(owed.getByRole('listitem')).toHaveCount(2)
    await expect(owed.getByText('Driveway')).toBeVisible()
    await expect(owed.getByText('Sealing')).toBeVisible()
    await expect(page.locator('.fhcs-total__amount')).toHaveText('$6,900.25')
    const apart = page.getByRole('list', { name: 'Not yet invoiced' })
    await expect(apart.getByText('Garage slab')).toBeVisible()
    await expect(apart.getByText('$33,100', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Email statement' }).click()
    await expect.poll(() => posted.length).toBe(1)
    expect(posted[0].total_due).toBe(6900.25)
  })

  test('Money opens the same statement screen from Who owes you', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/invoices?panel=statements')
    await page.getByRole('button', { name: /^Statement for/ }).first().click()
    await expect(page).toHaveURL(/\/clients\/cl-1\/statement$/)
    await expect(page.getByRole('heading', { level: 1, name: /^Statement for/ })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  // Phase 9, Task 15 (D53): a client's records are four kinds, each with
  // its own screen. The mock client has two leads, two quotes, four jobs
  // and two invoices.
  test("a client's Projects tab groups its four kinds", async ({ context, page }) => {
    await signIn(context)
    await open(page, '/clients/cl-1')
    // The phone draws the tabs as tabs, the desktop build as plain buttons.
    const projectsTab = page.getByRole('tab', { name: 'Projects' }).or(page.getByRole('button', { name: 'Projects', exact: true }))
    await projectsTab.click()

    for (const [heading, count] of [['Leads', 2], ['Quotes', 2], ['Jobs', 4], ['Invoices', 2]] as const) {
      const group = page.getByRole('region', { name: new RegExp(`^${heading}`) })
      await expect(group.getByRole('heading', { level: 3 })).toContainText(heading)
      await expect(group.getByRole('listitem')).toHaveCount(count)
    }
    const leads = page.getByRole('region', { name: /^Leads/ })
    await expect(leads.getByRole('button', { name: /Vintage Burkitt Station Drainage/ })).toBeVisible()
    await expect(page.getByRole('region', { name: /^Quotes/ }).getByRole('button', { name: /Parking lot repour/ })).toContainText('Sent')
    await expect(page.getByRole('region', { name: /^Invoices/ }).getByRole('button', { name: /Progress draw 1/ })).toBeVisible()

    // Each row opens its own record.
    await leads.getByRole('button', { name: /Vintage Burkitt Station Drainage/ }).click()
    await expect(page).toHaveURL(/\/leads\/l-lead1$/)
    await page.goBack()
    await projectsTab.click()
    await page.getByRole('region', { name: /^Quotes/ }).getByRole('button', { name: /Parking lot repour/ }).click()
    await expect(page).toHaveURL(/\/quotes\/q-quote$/)
    await page.goBack()
    await projectsTab.click()
    await page.getByRole('region', { name: /^Invoices/ }).getByRole('button', { name: /Progress draw 1/ }).click()
    await expect(page).toHaveURL(/\/invoices\/inv1$/)
  })

  test('a client billed directly shows what it was billed and what it owes (M-13)', async ({ context, page }) => {
    const DIRECT = { id: 'cl-direct', user_id: USER.id, name: 'Dana Whitfield', company_name: null, phone: '615-555-0144', email: null, address: null, created_at: iso(NOW - 30 * DAY) }
    await signIn(context, {
      tables: {
        fh_clients: [DIRECT],
        fh_invoices: [
          { id: 'inv-a', user_id: USER.id, client_id: 'cl-direct', contact_id: null, title: 'Gutter repair', amount: 800, status: 'paid', sequence_number: 1, issued_at: iso(NOW - 40 * DAY), due_at: iso(NOW - 30 * DAY), created_at: iso(NOW - 40 * DAY), updated_at: iso(NOW - 30 * DAY) },
          { id: 'inv-b', user_id: USER.id, client_id: 'cl-direct', contact_id: null, title: 'Fence post', amount: 500, status: 'sent', sequence_number: 2, issued_at: iso(NOW - 25 * DAY), due_at: iso(NOW - 20 * DAY), created_at: iso(NOW - 25 * DAY), updated_at: iso(NOW - 25 * DAY) }
        ],
        fh_payments: [{ id: 'pay-a', user_id: USER.id, contact_id: null, invoice_id: 'inv-a', amount: 800, method: 'check', paid_on: iso(NOW - 30 * DAY).slice(0, 10), created_at: iso(NOW - 30 * DAY) }]
      }
    })
    await open(page, '/clients/cl-direct')
    // Phone: "Lifetime $1.3K", "Contract balance $500". Desktop: "$1K
    // Lifetime value", "$500 Remaining contract value". Both read $0 before.
    const main = page.locator('main')
    await expect(main).toContainText(/Lifetime\s*\$1\.3K|\$1(\.3)?K\s*Lifetime value/, { timeout: 30_000 })
    await expect(main).toContainText(/Contract balance\s*\$500|\$500\s*Remaining contract value/)
  })

  test('Map opens the map app for this device, not Apple Maps on Android (S25)', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/clients/cl-1')
    const map = page.getByRole('link', { name: 'Map' }).first()
    await expect(map).toBeVisible({ timeout: 30_000 })
    const href = await map.getAttribute('href')
    expect(href).toContain(encodeURIComponent('412 Burkitt Station Rd').slice(0, 10))
    // Pixel 7 is Android; desktop Chrome is not an Apple device either.
    expect(href).not.toContain('maps.apple.com')
  })

  test('Back on the client page returns where the person came from (S19)', async ({ context, page }) => {
    // A lead whose client has no phone shows "Add phone", which opens the client page.
    const noPhone = { ...JEFF, phone: null }
    await signIn(context, {
      tables: {
        fh_clients: [noPhone],
        fh_leads: [{
          id: 'l-lead1', user_id: USER.id, client_id: 'cl-1', status: 'open', title: 'Back patio', notes: null, job_type: null,
          source: null, referred_by: null, follow_up_on: null, last_contact: null, quote_id: null, origin_contact_id: null,
          created_at: iso(NOW - DAY), updated_at: iso(NOW - DAY), fh_clients: noPhone
        }]
      }
    })
    await open(page, '/leads/l-lead1')
    await page.getByRole('link', { name: 'Add phone' }).click()
    await expect(page).toHaveURL(/\/clients\/cl-1/)
    await page.getByRole('button', { name: 'Back to clients' }).click()
    await expect(page).toHaveURL(/\/leads\/l-lead1$/)
  })

  test('Back on a client page opened directly goes to Customers (S19)', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/clients/cl-1')
    await page.getByRole('button', { name: 'Back to clients' }).click()
    await expect(page).toHaveURL(/\/clients$/)
  })

  test('the New button on the client page names what it opens (S24)', async ({ context, page, isMobile }) => {
    test.skip(!isMobile, 'The desktop client page is a separate component.')
    await signIn(context)
    await open(page, '/clients/cl-1')
    const create = page.getByRole('button', { name: 'New lead, quote, job or invoice' })
    await expect(create).toBeVisible({ timeout: 30_000 })
    await create.click()
    await expect(page).toHaveURL(/\/new\?client=cl-1$/)
  })

  test('a customer with leads, quotes or invoices is not deleted, and the page says what to do instead', async ({ context, page }) => {
    await signIn(context)
    const writes = watchWrites(page)
    await open(page, '/clients/cl-1')
    await page.getByRole('button', { name: /^Delete( client)?$/ }).click()
    await expect(page.getByText(/Jeff Roy has \d+ leads?, \d+ quotes? and \d+ invoices?/)).toBeVisible()
    await expect(page.getByText(/Merge this client into the right one to keep them/)).toBeVisible()
    // Not armed: a second tap cannot delete.
    await expect(page.getByRole('button', { name: 'Tap again to delete' })).toHaveCount(0)
    await page.getByRole('button', { name: /^Delete( client)?$/ }).click()
    await page.waitForTimeout(500)
    expect(writes.filter((w) => w.startsWith('DELETE'))).toEqual([])
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('deleting a customer takes a second tap on the same button', async ({ context, page }) => {
    // A customer with no leads, quotes or invoices (those would be lost).
    await signIn(context, { tables: { fh_leads: [], fh_quotes: [], fh_invoices: [] } })
    const writes = watchWrites(page)
    await open(page, '/clients/cl-1')
    const del = page.getByRole('button', { name: /^Delete( client)?$/ })
    await expect(del).toBeVisible()
    await del.click()
    const again = page.getByRole('button', { name: 'Tap again to delete' })
    await expect(again).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(writes).toEqual([])

    // Left alone, the button goes back to resting and nothing is written.
    await expect(del).toBeVisible({ timeout: 6000 })
    expect(writes).toEqual([])

    await del.click()
    await page.waitForTimeout(600) // a second tap within 500 ms is ignored (OPS-02)
    await page.getByRole('button', { name: 'Tap again to delete' }).click()
    await expect.poll(() => writes.filter((w) => w.startsWith('DELETE fh_clients')).length).toBe(1)
  })
})

// D19: the desktop Customers table sorts names without regard to case,
// keeps its sort while you search, and says the year of an old touch.
test.describe('the desktop Customers table', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop table')

  const client = (id: string, name: string, touchedDaysAgo: number) => ({
    id, user_id: USER.id, name, company_name: null, phone: null, email: null, address: null,
    created_at: iso(NOW - 400 * DAY), last_activity_at: iso(NOW - touchedDaysAgo * DAY)
  })

  test('sorts by name ignoring case, keeps the sort while searching, and shows the year of an old touch', async ({ context, page }) => {
    await signIn(context, { tables: { fh_clients: [client('c-z', 'Zed Builders', 2), client('c-a', 'alpha Concrete', 3), client('c-b', 'Bravo Paving', 395)] } })
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, '/clients')
    const names = page.locator('.fh-build-table__row.is-clients strong')
    await expect(names).toHaveCount(3)
    await page.getByRole('button', { name: 'Sort by Client' }).click()
    await expect(names).toHaveText(['alpha Concrete', 'Bravo Paving', 'Zed Builders'])

    await page.getByRole('textbox', { name: 'Search clients' }).fill('r')
    await expect(page).toHaveURL(/[?&]q=r\b/)
    await expect(page.getByRole('button', { name: 'Sort by Client' })).toContainText('Sorted ascending')
    await expect(names).toHaveText(['alpha Concrete', 'Bravo Paving', 'Zed Builders'])

    const old = page.locator('.fh-build-table__row.is-clients').filter({ hasText: 'Bravo Paving' }).locator('.fh-build-rel').first()
    await expect(old).toContainText(String(new Date(NOW - 395 * DAY).getFullYear()))
  })
})
