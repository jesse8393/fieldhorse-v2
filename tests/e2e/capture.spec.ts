// Universal Capture in the redesign (docs/design/2026-10-redesign/SPEC.md,
// section 9.5, and PHASE2_PLAN.md task 13): the paper sheet the dock coin
// opens, its one brushed gold action, the "Or start with" rows wired to
// flows that already exist, and capture attached to the job it was opened
// from. The model proposes and the person confirms: nothing writes until
// Save.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
}

function openFromCoin(page: Page) {
  return page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: /Capture/ }).click()
}

function openOnJob(page: Page, jobId: string) {
  return page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('fh:open-capture', { detail: { jobId: id } }))
  }, jobId)
}

// The capture model's reply, as the /api/claude proxy returns it.
async function mockModel(page: Page, reply: object) {
  await page.route('**/api/claude', (route) => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(reply) }] })
  }))
}

test.describe('capture sheet', () => {
  // Each test signs in itself, some as crew.
  test.beforeEach(async ({ context: _context }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone capture sheet')
  })

  test('the coin opens Capture with File it as the one gold button', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/')
    await openFromCoin(page)

    const sheet = page.getByRole('dialog', { name: 'Capture' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('heading', { name: 'Capture', level: 2 })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Done' })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Start talking' })).toBeVisible()
    await expect(sheet.getByRole('textbox', { name: 'Or type it' })).toBeVisible()

    const gold = sheet.locator('.fhc-btn--primary')
    await expect(gold).toHaveCount(1)
    await expect(gold).toHaveAccessibleName('File it')
    // Brushed once there is something to file.
    await sheet.getByRole('textbox', { name: 'Or type it' }).fill('Pour moved to Friday')
    await expect(gold).toBeEnabled()
    expect(await gold.evaluate((el) => getComputedStyle(el).backgroundImage)).toContain('linear-gradient')
    await sheet.getByRole('textbox', { name: 'Or type it' }).fill('')

    await sheet.getByRole('button', { name: 'Done' }).click()
    await expect(sheet).toBeHidden()

    // Cmd or Ctrl+J still opens it.
    await page.keyboard.press('Control+j')
    await expect(page.getByRole('dialog', { name: 'Capture' })).toBeVisible()
  })

  test('Or start with lists the flows that exist', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/')
    await openFromCoin(page)

    const sheet = page.getByRole('dialog', { name: 'Capture' })
    const starts = sheet.getByRole('list', { name: 'Or start with' })
    await expect(starts).toBeVisible()
    await expect(starts.getByRole('listitem')).toHaveCount(5)
    await expect(starts.getByRole('link', { name: /^Note/ })).toHaveAttribute('href', '/notes')
    await expect(starts.getByRole('link', { name: /^Lead/ })).toHaveAttribute('href', '/work?new=1')
    await expect(starts.getByRole('link', { name: /^Quote/ })).toHaveAttribute('href', '/work?new=1&asStage=quote')
    await expect(starts.getByRole('button', { name: /^Expense/ })).toBeVisible()
    await expect(starts.getByRole('link', { name: /^Time/ })).toHaveAttribute('href', '/crew')
    // Photos and invoices always belong to a job, so they wait for one.
    await expect(starts.getByRole('link', { name: /^Photo/ })).toHaveCount(0)
    await expect(starts.getByRole('link', { name: /^Invoice/ })).toHaveCount(0)

    await starts.getByRole('link', { name: /^Lead/ }).click()
    await expect(page).toHaveURL(/\/work/)
    await expect(sheet).toBeHidden()
  })

  test('crew get no lead, quote or invoice rows', async ({ context, page }) => {
    await signIn(context, { role: 'crew' })
    await open(page, '/')
    await openFromCoin(page)
    const starts = page.getByRole('dialog', { name: 'Capture' }).getByRole('list', { name: 'Or start with' })
    await expect(starts.getByRole('link', { name: /^Note/ })).toBeVisible()
    await expect(starts.getByRole('button', { name: /^Expense/ })).toBeVisible()
    await expect(starts.getByRole('link', { name: /^Time/ })).toBeVisible()
    await expect(starts.getByRole('link', { name: /^Lead/ })).toHaveCount(0)
    await expect(starts.getByRole('link', { name: /^Quote/ })).toHaveCount(0)
  })

  test('opened on a job, it files there and nothing writes before Save', async ({ context, page }) => {
    await signIn(context)
    // The model leaves the job empty; the attached job fills it.
    await mockModel(page, { kind: 'note', summary: 'Save a note', job_id: null, confidence: 0.8, text: 'Laser level is in the truck' })
    const writes: string[] = []
    page.on('request', (req) => {
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method()) && req.url().includes('/rest/v1/fh_')) writes.push(req.url())
    })

    await open(page, '/')
    await openOnJob(page, 'c-job1')
    const sheet = page.getByRole('dialog', { name: 'Capture' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('Attached to Slab + trench.')).toBeVisible()

    const starts = sheet.getByRole('list', { name: 'Or start with' })
    await expect(starts.getByRole('link', { name: /^Photo/ })).toHaveAttribute('href', '/jobs/c-job1?tab=files')
    await expect(starts.getByRole('link', { name: /^Invoice/ })).toHaveAttribute('href', '/jobs/c-job1?action=send_invoice')

    await sheet.getByRole('textbox', { name: 'Or type it' }).fill('Laser level is in the truck')
    await sheet.getByRole('button', { name: 'File it' }).click()

    // Confirm phase: what was typed, what it files as, the job it lands on.
    await expect(sheet.getByText('Filed as')).toBeVisible()
    await expect(sheet.getByText('“Laser level is in the truck”')).toBeVisible()
    const chips = sheet.getByRole('list', { name: 'Filed as' })
    await expect(chips.getByRole('listitem')).toHaveText(['Note', 'Slab + trench'])
    await expect(sheet.getByText('Opened from Slab + trench, so it files there.')).toBeVisible()
    const gold = sheet.locator('.fhc-btn--primary')
    await expect(gold).toHaveCount(1)
    await expect(gold).toHaveAccessibleName('Save')
    await expect(sheet.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Just save it as a note' })).toHaveCount(0)
    expect(writes).toEqual([])

    // Change opens the existing job select.
    await sheet.getByRole('button', { name: 'Change job' }).click()
    await expect(sheet.getByRole('combobox', { name: 'Job' })).toHaveValue('c-job1')

    await gold.click()
    await expect(sheet).toBeHidden()
    expect(writes.filter((u) => u.includes('/rest/v1/fh_notes'))).toHaveLength(1)
  })

  test('a lead outside the roster can still be attached', async ({ context, page }) => {
    await signIn(context)
    // The roster query only returns active jobs here, so the lead has to
    // be fetched by its id when the sheet opens on it.
    await page.route((url) => url.pathname.endsWith('/rest/v1/fh_contacts') && url.searchParams.has('stage'), (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'c-job1', user_id: 'qa-user-1', name: 'Plumbing Bellevue', job_title: 'Slab + trench', stage: 'job', amount: 33100 }])
    }))
    await mockModel(page, { kind: 'payment', summary: 'Log a deposit', job_id: 'c-lead1', confidence: 0.9, amount: 2500, method: 'check', payment_kind: 'deposit' })
    await open(page, '/')
    await openOnJob(page, 'c-lead1')
    const sheet = page.getByRole('dialog', { name: 'Capture' })
    await expect(sheet.getByText('Attached to Vintage Burkitt Station Drainage.')).toBeVisible()
    // A lead has nothing to invoice yet.
    await expect(sheet.getByRole('list', { name: 'Or start with' }).getByRole('link', { name: /^Invoice/ })).toHaveCount(0)

    await sheet.getByRole('textbox', { name: 'Or type it' }).fill('Got a 2500 deposit check from Justin')
    await sheet.getByRole('button', { name: 'File it' }).click()
    // The model named the lead; normalizeIntent kept it because the
    // attached lead is in the roster it checks against.
    const chips = sheet.getByRole('list', { name: 'Filed as' })
    await expect(chips.getByRole('listitem')).toHaveText(['Payment', '$2,500.00', 'Deposit by check', 'Vintage Burkitt Station Drainage'])
    await expect(sheet.getByRole('button', { name: 'Just save it as a note' })).toBeVisible()
  })
})
