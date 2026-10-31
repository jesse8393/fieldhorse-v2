// The command palette on a desktop (docs/design/2026-10-redesign/SPEC.md
// 9.12, PHASE4_PLAN.md Task 4.4, render base/desktop-command.jpg): opened
// with Control+K, search groups Jobs, Actions, Customers and Documents,
// job actions with key caps, and shortcuts that live only inside the open
// palette. Plain letters are never a shortcut: they type into the search
// field, and with the palette closed they do nothing anywhere.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const JOB = {
  id: 'c-job1',
  stage: 'job',
  name: 'Plumbing Bellevue',
  job_title: 'Slab + trench',
  amount: 33100,
  phone: '555-0101',
  email: 'x@y.com',
  address: '412 Burkitt Station Rd',
  user_id: 'qa-user-1',
  client_id: 'cl-1',
  created_at: '2026-10-01T12:00:00Z',
  updated_at: '2026-10-09T12:00:00Z'
}
const CLIENT = { id: 'cl-1', user_id: 'qa-user-1', name: 'Jeff Roy', company_name: null, phone: '555-0101', email: 'jeff@roy.com' }
const FILE = { id: 'f1', user_id: 'qa-user-1', filename: 'Quote 1042.pdf', kind: 'file', job_id: 'c-job1' }

async function open(page: Page, path = '/schedule') {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
}

async function openPalette(page: Page) {
  await page.keyboard.press('Control+k')
  const palette = page.getByRole('dialog', { name: 'Command palette' })
  await expect(palette).toBeVisible()
  return palette
}

test.describe('command palette', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop palette')
  })

  test('Control+K then Plumb lists the job actions with key caps', async ({ context, page }) => {
    await signIn(context, { tables: { fh_contacts: [JOB], fh_clients: [CLIENT] } })
    await open(page)
    const palette = await openPalette(page)
    await palette.getByRole('combobox').fill('Plumb')

    const jobs = palette.getByRole('group', { name: 'Jobs' })
    await expect(jobs).toBeVisible()
    await expect(jobs.getByRole('option', { name: /Slab \+ trench.*Plumbing Bellevue/ })).toBeVisible()

    const actions = palette.getByRole('group', { name: 'Actions' })
    const invoice = actions.getByRole('option', { name: /Create invoice for Slab \+ trench/ })
    await expect(invoice).toBeVisible()
    await expect(invoice.locator('kbd', { hasText: /^I$/ })).toBeVisible()
    await expect(actions.getByRole('option', { name: /Message Plumbing Bellevue/ }).locator('kbd', { hasText: /^M$/ })).toBeVisible()
    await expect(actions.getByRole('option', { name: /Add a note to Slab \+ trench/ }).locator('kbd', { hasText: /^N$/ })).toBeVisible()
    const navigate = actions.getByRole('option', { name: /Navigate to 412 Burkitt Station Rd/ })
    await expect(navigate).toBeVisible()
    await expect(navigate.locator('kbd')).toHaveCount(0)

    // The key caps are honest about the modifier.
    await expect(invoice.locator('kbd', { hasText: /^(Alt|⌥)$/ })).toBeVisible()

    await expect(palette.getByRole('group', { name: 'Customers' })).toBeVisible()
    // No files match, so there is no Documents group.
    await expect(palette.getByRole('group', { name: 'Documents' })).toHaveCount(0)

    // Header and footer: esc key cap, hints for arrows, enter and esc.
    await expect(palette.locator('kbd', { hasText: /^esc$/ })).toHaveCount(2)
    await expect(palette.getByText('to move,')).toBeVisible()
    await expect(palette.getByText('to open,')).toBeVisible()
    await expect(palette.getByText('to close.')).toBeVisible()
  })

  // Phase 9, Task 15: leads, quotes and invoices are records of their own
  // (D53) and the search finds a lead by the name of its client.
  test('search finds a lead by name', async ({ context, page }) => {
    const LEAD = {
      id: 'l-justin', user_id: 'qa-user-1', client_id: 'cl-justin', title: 'Vintage Burkitt Station Drainage',
      status: 'open', job_type: 'Drainage', follow_up_on: null, notes: null, last_contact: null, quote_id: null,
      created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-09T12:00:00Z',
      fh_clients: { id: 'cl-justin', name: 'Justin Bryan' }
    }
    // The mock does not filter by text, so only the lead is seeded: a job
    // would bring its Actions group along.
    await signIn(context, { tables: { fh_contacts: [], fh_clients: [CLIENT], fh_leads: [LEAD], fh_quotes: [], fh_invoices: [] } })
    await open(page)
    const palette = await openPalette(page)
    await palette.getByRole('combobox').fill('Justin')

    const leads = palette.getByRole('group', { name: 'Leads' })
    await expect(leads).toBeVisible()
    const row = leads.getByRole('option', { name: /Justin Bryan.*Vintage Burkitt Station Drainage.*Lead/ })
    await expect(row).toBeVisible()
    // A lead has no job actions.
    await expect(palette.getByRole('group', { name: 'Actions' })).toHaveCount(0)
    await row.click()
    await expect(palette).toBeHidden()
    await expect(page).toHaveURL(/\/leads\/l-justin$/)
  })

  test('Documents appears only when files match', async ({ context, page }) => {
    await signIn(context, { tables: { fh_contacts: [JOB], fh_clients: [CLIENT], fh_job_files: [FILE] } })
    await open(page)
    const palette = await openPalette(page)
    await palette.getByRole('combobox').fill('Quote')
    const docs = palette.getByRole('group', { name: 'Documents' })
    await expect(docs).toBeVisible()
    await expect(docs.getByRole('option', { name: /Quote 1042\.pdf/ })).toBeVisible()
  })

  test('search waits for company resolution before reading documents', async ({ context, page }) => {
    await signIn(context, { tables: { fh_contacts: [JOB], fh_clients: [CLIENT], fh_job_files: [FILE] } })
    let releaseMembership = () => {}
    const membershipGate = new Promise<void>((resolve) => { releaseMembership = resolve })
    let heldMembership = 0
    const fileScopes: string[] = []
    await context.route(/\/rest\/v1\/org_members(\?|$)/, async (route) => {
      heldMembership += 1
      await membershipGate
      await route.fallback()
    })
    await context.route(/\/rest\/v1\/fh_job_files(\?|$)/, async (route) => {
      fileScopes.push(new URL(route.request().url()).searchParams.get('org_id') || 'owner fallback')
      await route.fallback()
    })
    await open(page)
    const palette = await openPalette(page)
    await palette.getByRole('combobox').fill('Quote')
    await expect.poll(() => heldMembership).toBeGreaterThan(0)
    await page.waitForTimeout(350)
    expect(fileScopes).toEqual([])
    releaseMembership()
    await expect(palette.getByRole('option', { name: /Quote 1042\.pdf/ })).toBeVisible()
    expect(fileScopes).toEqual(['eq.org-1'])
  })

  test('company changes refresh an open search and reject a late previous-company answer', async ({ context, page }) => {
    const previousFile = { ...FILE, filename: 'Previous company contract.pdf' }
    const currentFile = { ...FILE, id: 'f2', org_id: 'org-2', filename: 'Current company contract.pdf' }
    await signIn(context, { tables: {
      fh_contacts: [JOB], fh_clients: [CLIENT], fh_job_files: [previousFile, currentFile],
      organizations: [{ id: 'org-1', name: 'Previous company' }, { id: 'org-2', name: 'Current company' }],
    } })
    let currentOrg = 'org-1'
    await context.route(/\/rest\/v1\/org_members(\?|$)/, async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'membership', org_id: currentOrg, user_id: 'qa-user-1', role: 'owner', revoked_at: null, joined_at: '2026-01-01T00:00:00Z' },
      ]) })
    })
    let holdPrevious = false
    let heldPrevious = 0
    let releasePrevious = () => {}
    const previousGate = new Promise<void>((resolve) => { releasePrevious = resolve })
    await context.route(/\/rest\/v1\/fh_job_files(\?|$)/, async (route) => {
      const org = new URL(route.request().url()).searchParams.get('org_id')
      if (holdPrevious && org === 'eq.org-1') {
        heldPrevious += 1
        await previousGate
      }
      await route.fallback()
    })
    await open(page)
    const palette = await openPalette(page)
    const input = palette.getByRole('combobox')
    await input.fill('contract')
    await expect(palette.getByRole('option', { name: /Previous company contract/ })).toBeVisible()
    holdPrevious = true
    await input.fill('contract revised')
    await expect.poll(() => heldPrevious).toBe(1)
    currentOrg = 'org-2'
    // Membership refresh may select a different company after an access change.
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    await expect(palette.getByRole('option', { name: /Current company contract/ })).toBeVisible()
    await expect(palette.getByRole('option', { name: /Previous company contract/ })).toHaveCount(0)
    releasePrevious()
    await page.waitForTimeout(350)
    await expect(palette.getByRole('option', { name: /Current company contract/ })).toBeVisible()
    await expect(palette.getByRole('option', { name: /Previous company contract/ })).toHaveCount(0)
    await expect(input).toHaveValue('contract revised')
  })

  test('crew do not get Create invoice', async ({ context, page }) => {
    await signIn(context, { role: 'crew', tables: { fh_contacts: [JOB], fh_clients: [CLIENT] } })
    await open(page)
    const palette = await openPalette(page)
    await palette.getByRole('combobox').fill('Plumb')

    const actions = palette.getByRole('group', { name: 'Actions' })
    await expect(actions.getByRole('option', { name: /Add a note to Slab \+ trench/ })).toBeVisible()
    await expect(actions.getByRole('option', { name: /Message Plumbing Bellevue/ })).toBeVisible()
    await expect(actions.getByRole('option', { name: /Create invoice/ })).toHaveCount(0)
    await expect(palette.locator('kbd', { hasText: /^I$/ })).toHaveCount(0)
  })

  test('Alt and the letter run the action on the highlighted job', async ({ context, page }) => {
    await signIn(context, { tables: { fh_contacts: [JOB], fh_clients: [CLIENT] } })
    await open(page)
    const palette = await openPalette(page)
    await palette.getByRole('combobox').fill('Plumb')
    await expect(palette.getByRole('option', { name: /Create invoice for Slab \+ trench/ })).toBeVisible()

    await page.keyboard.press('Alt+KeyI')
    await expect(palette).toBeHidden()
    await expect(page).toHaveURL(/\/jobs\/c-job1\?action=send_invoice/)
  })

  test('Alt N opens Capture attached to the job', async ({ context, page }) => {
    await signIn(context, { tables: { fh_contacts: [JOB], fh_clients: [CLIENT] } })
    await open(page)
    const palette = await openPalette(page)
    await palette.getByRole('combobox').fill('Plumb')
    await expect(palette.getByRole('option', { name: /Add a note to Slab \+ trench/ })).toBeVisible()

    await page.keyboard.press('Alt+KeyN')
    await expect(palette).toBeHidden()
    // Capture is a screen (D57), opened on the job.
    await expect(page).toHaveURL(/\/capture\?job=c-job1$/)
    await expect(page.getByText('Attached to Slab + trench.')).toBeVisible()
  })

  test('plain letters type into the search field and run nothing', async ({ context, page }) => {
    await signIn(context, { tables: { fh_contacts: [JOB], fh_clients: [CLIENT] } })
    await open(page)
    const before = page.url()
    const palette = await openPalette(page)
    const search = palette.getByRole('combobox')

    // Highlight the job first, so a shortcut would have something to act on.
    await search.fill('Plumb')
    await expect(palette.getByRole('option', { name: /Create invoice for Slab \+ trench/ })).toBeVisible()
    await search.press('End')
    await page.keyboard.type('ing in')
    await expect(search).toHaveValue('Plumbing in')
    await page.keyboard.type('m')
    await page.keyboard.type('n')
    await expect(search).toHaveValue('Plumbing inmn')

    await expect(palette).toBeVisible()
    expect(page.url()).toBe(before)
  })

  test('a shortcut needs a job or one of its actions highlighted', async ({ context, page }) => {
    // Only the job and its customer, so the arrow count below holds: the
    // mock does not filter by text, and the default leads, quotes and
    // invoices would add rows of their own (Task 15).
    await signIn(context, { tables: { fh_contacts: [JOB], fh_clients: [CLIENT], fh_leads: [], fh_quotes: [], fh_invoices: [] } })
    await open(page)
    const before = page.url()
    const palette = await openPalette(page)
    await palette.getByRole('combobox').fill('Plumb')
    const customer = palette.getByRole('option', { name: /Darnell Plumb|Jeff Roy/ })
    await expect(customer).toBeVisible()

    // Job, invoice, message, note, navigate, then the customer row.
    for (let i = 0; i < 5; i += 1) await page.keyboard.press('ArrowDown')
    await expect(customer).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Alt+KeyI')
    await page.keyboard.press('Alt+KeyN')
    await expect(palette).toBeVisible()
    expect(page.url()).toBe(before)
  })

  test('Message opens the job when there is no phone number', async ({ context, page }) => {
    await signIn(context, { tables: { fh_contacts: [{ ...JOB, phone: null }], fh_clients: [CLIENT] } })
    await open(page)
    const palette = await openPalette(page)
    await palette.getByRole('combobox').fill('Plumb')
    await expect(palette.getByRole('option', { name: /Message Plumbing Bellevue/ })).toBeVisible()
    await page.keyboard.press('Alt+KeyM')
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)
  })

  test('Navigate opens a maps link in a new tab', async ({ context, page }) => {
    await signIn(context, { tables: { fh_contacts: [JOB], fh_clients: [CLIENT] } })
    await page.addInitScript(() => {
      ;(window as unknown as { __opened: unknown[][] }).__opened = []
      window.open = (...args: unknown[]) => {
        ;(window as unknown as { __opened: unknown[][] }).__opened.push(args)
        return null
      }
    })
    await open(page)
    const palette = await openPalette(page)
    await palette.getByRole('combobox').fill('Plumb')
    await palette.getByRole('option', { name: /Navigate to 412 Burkitt Station Rd/ }).click()
    await expect(palette).toBeHidden()
    const opened = await page.evaluate(() => (window as unknown as { __opened: unknown[][] }).__opened)
    expect(opened).toHaveLength(1)
    expect(String(opened[0][0])).toContain('destination=412%20Burkitt%20Station%20Rd')
  })

  test('Enter on a job row opens the job', async ({ context, page }) => {
    await signIn(context, { tables: { fh_contacts: [JOB], fh_clients: [CLIENT] } })
    await open(page)
    const palette = await openPalette(page)
    await palette.getByRole('combobox').fill('Plumb')
    await expect(palette.getByRole('option', { name: /Slab \+ trench.*Plumbing Bellevue/ })).toHaveAttribute('aria-selected', 'true')
    await page.keyboard.press('Enter')
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)
  })

  test('with the palette closed, i, m and n in a text field do nothing', async ({ context, page }) => {
    await signIn(context, { tables: { fh_contacts: [JOB], fh_clients: [CLIENT] } })
    const requests: string[] = []
    await open(page)
    // The board is drawn, so the page listeners are in place. Network idle
    // is not a usable signal here: the weather and font requests may never
    // settle on a slow runner.
    await expect(page.getByRole('region', { name: 'Unscheduled jobs' })).toBeVisible()

    // A real textarea: Universal Capture's, on its own screen, opened by
    // its own shortcut.
    await page.keyboard.press('Control+j')
    await expect(page).toHaveURL(/\/capture$/)
    const before = page.url()
    const field = page.getByRole('textbox', { name: 'Or type it' })
    await field.click()

    page.on('request', (req) => {
      if (req.url().includes('/api/') || ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method())) requests.push(`${req.method()} ${req.url()}`)
    })
    await page.keyboard.type('i m n')
    await page.keyboard.press('Alt+KeyI')
    await page.keyboard.press('Alt+KeyM')
    await page.keyboard.press('Alt+KeyN')
    await expect(field).toHaveValue('i m n')

    expect(page.url()).toBe(before)
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toHaveCount(0)
    expect(requests).toEqual([])
  })

  test('the quick actions and Capture anything are still there', async ({ context, page }) => {
    await signIn(context)
    await open(page)
    const palette = await openPalette(page)
    const capture = palette.getByRole('option', { name: /Capture anything/ })
    await expect(capture).toBeVisible()
    await expect(palette.getByRole('option', { name: /New lead/ })).toBeVisible()
    await expect(palette.getByRole('option', { name: /Collect money/ })).toBeVisible()

    await capture.click()
    await expect(palette).toBeHidden()
    await expect(page).toHaveURL(/\/capture$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Capture' })).toBeVisible()
  })

  test('Escape closes immediately and restores launcher focus on repeated openings', async ({ context, page }) => {
    await signIn(context)
    await open(page)
    const launcher = page.getByRole('button', { name: 'Search everything', exact: true })
    await launcher.focus()
    for (let opening = 0; opening < 3; opening += 1) {
      const palette = await openPalette(page)
      // Keep the immediate keypress: do not hide a startup race with a delay.
      await page.keyboard.press('Escape')
      await expect(palette).toBeHidden()
      await expect(launcher).toBeFocused()
    }
  })
})
