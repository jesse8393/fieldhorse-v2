// Customers in the redesign (PHASE9_PLAN.md Task 14, D57): the pop ups the
// Customers list and the customer page opened are screens. Reviewing
// duplicates is /clients/merge, a customer's statement is
// /clients/:id/statement (also where Money's Who owes you goes), and
// deleting a customer confirms with a second tap on the same button.
// Nothing here mounts a dialog.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
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
    await again.click()
    await expect.poll(() => writes.some((w) => w.startsWith('DELETE fh_clients'))).toBe(true)
    await expect(page.getByText('All clean.')).toBeVisible()

    // Back returns to the list.
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/clients$/)
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

  test('deleting a customer takes a second tap on the same button', async ({ context, page }) => {
    await signIn(context)
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
    await page.getByRole('button', { name: 'Tap again to delete' }).click()
    await expect.poll(() => writes.filter((w) => w.startsWith('DELETE fh_clients')).length).toBe(1)
  })
})
