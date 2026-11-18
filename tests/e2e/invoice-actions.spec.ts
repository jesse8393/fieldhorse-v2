import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { installMock, restResponse, session } from '../../scripts/qa-mock.mjs'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'
import { signIn } from './helpers/signIn.ts'
import { FAIL, expectPlain, failRest } from './helpers/rawErrors.ts'

// The invoice screen's actions (Phase 9, Task 12, decisions D57 and D62):
// the gold Collect payment, then Resend (Send on a draft), PDF and Share
// link, stacked so they fit a 320 px phone and keep their labels at every
// width. /invoices/:id is an fh_invoices row; the default fixture inv1 is
// Harold Wickham's open progress draw.

async function installSession(context: BrowserContext) {
  await installMock(context)
  await context.addInitScript((savedSession) => {
    localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(savedSession))
    localStorage.setItem('fh-onboarding-seen', '1')
  }, session)
}

test.beforeEach(async ({ context }) => {
  await installSession(context)
})

const ACTIONS = ['Collect payment', 'Resend', 'PDF', 'Share link']

async function openInvoice(page: Page, id = 'inv1') {
  await page.goto(`/invoices/${id}`, { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await expect(page.locator('.fhinv-actions')).toBeVisible({ timeout: 30_000 })
}

// Collect payment is a link to its screen; the rest are buttons.
function action(page: Page, name: string) {
  const bar = page.locator('.fhinv-actions')
  return name === 'Collect payment'
    ? bar.getByRole('link', { name, exact: true })
    : bar.getByRole('button', { name, exact: true })
}

// How many lines a control's words take, from the line boxes of its text.
function labelLines(page: Page, name: string) {
  return action(page, name).evaluate((control) => {
    const tops = new Set<number>()
    const walker = document.createTreeWalker(control, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim()) continue
      const range = document.createRange()
      range.selectNodeContents(node)
      for (const rect of range.getClientRects()) if (rect.width > 0) tops.add(Math.round(rect.top))
    }
    return tops.size
  })
}

for (const size of [{ width: 320, height: 640 }, { width: 375, height: 667 }, { width: 390, height: 844 }, { width: 412, height: 915 }, { width: 599, height: 900 }]) {
  test(`the invoice actions fit a ${size.width} px phone`, async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'phone layout')
    await page.setViewportSize(size)
    await openInvoice(page)

    for (const name of ACTIONS) {
      const control = action(page, name)
      await expect(control).toBeVisible()
      const box = await control.boundingBox()
      expect(box!.height, `${name} keeps a 44 px target`).toBeGreaterThanOrEqual(44)
      expect(box!.width, `${name} keeps a 44 px target`).toBeGreaterThanOrEqual(44)
      expect(await labelLines(page, name), `${name} on one line`).toBe(1)
    }
    await nothingRunsOffTheSide(page, `/invoices/inv1 at ${size.width} px`)
    // No word or icon of a control is drawn outside the control's box.
    const spills = await page.locator('.fhinv-actions').evaluate((row) => Array.from(row.querySelectorAll('button, a')).filter((b) => {
      const box = b.getBoundingClientRect()
      const inside = (r: DOMRect) => r.left >= box.left - 1 && r.right <= box.right + 1 && r.top >= box.top - 1 && r.bottom <= box.bottom + 1
      const range = document.createRange()
      range.selectNodeContents(b)
      return !Array.from(range.getClientRects()).filter((r) => r.width > 0 && r.height > 0).every(inside)
    }).map((b) => b.getAttribute('aria-label') || b.textContent?.trim()))
    expect(spills).toEqual([])
    // One gold button on the screen: Collect payment.
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(1)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })
}

// Labels are drawn (not only present for a screen reader) and read on one
// line on a tablet in the phone layout and on a desktop at its narrowest.
for (const { width, project } of [{ width: 600, project: 'mobile' }, { width: 899, project: 'mobile' }, { width: 900, project: 'desktop' }]) {
  test(`the invoice actions keep their labels at ${width} px`, async ({ page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith(project), `${project} layout`)
    await page.setViewportSize({ width, height: 900 })
    await openInvoice(page)
    for (const label of ACTIONS) {
      await expect(action(page, label)).toContainText(label, { useInnerText: true })
      expect(await labelLines(page, label), `${label} on one line`).toBe(1)
    }
    await nothingRunsOffTheSide(page, `/invoices/inv1 at ${width} px`)
  })
}

test('Share link shows it is working and keeps its name', async ({ page }) => {
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await page.route('**/rest/v1/fh_public_links*', async (route) => {
    if (route.request().method() === 'POST') await held
    await route.fallback()
  })
  await openInvoice(page)
  const share = action(page, 'Share link')
  await share.click()
  await expect(share).toHaveAttribute('aria-busy', 'true')
  release()
  await expect(share).not.toHaveAttribute('aria-busy', 'true')
  await expect(share).toBeEnabled()
})

test('PDF and Share link keep their tooltips', async ({ page }) => {
  await openInvoice(page)
  for (const name of ['PDF', 'Share link']) {
    await expect(action(page, name)).toHaveAttribute('title', /.+/)
  }
})

test('a desktop keeps the invoice action labels', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'desktop layout')
  await openInvoice(page)
  for (const label of ACTIONS) {
    await expect(action(page, label)).toContainText(label, { useInnerText: true })
  }
  await nothingRunsOffTheSide(page, '/invoices/inv1 on a desktop')
})

// The invoice has a description of its own (D62). The screen's Description
// field holds it, not the job title, and the PDF prints the same words.
const CLIENT = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }

function shedJob() {
  return {
    id: 'c-job1', stage: 'job', name: 'Plumbing Bellevue', job_title: 'Slab + trench', amount: 33100,
    user_id: 'qa-user-1', client_id: 'cl-1', phone: '555-0101', email: 'x@y.com', address: '412 Burkitt Station Rd',
    created_at: '2026-09-20T15:00:00.000Z', updated_at: '2026-10-09T15:00:00.000Z', completed_at: null,
    proposal_status: null, milestones: [], follow_up_on: null, notes: null, scope_text: null, fh_clients: CLIENT
  }
}

function shedDeposit(status = 'sent') {
  return {
    id: 'inv-1', contact_id: 'c-job1', client_id: 'cl-1', user_id: 'qa-user-1', sequence_number: 1, title: 'Deposit', amount: 3000,
    status, issued_at: '2026-10-10T15:00:00.000Z', due_at: '2026-10-24T15:00:00.000Z', notes: null,
    description: 'Deposit for the shed slab', created_at: '2026-10-10T15:00:00.000Z', updated_at: '2026-10-10T15:00:00.000Z',
    fh_clients: CLIENT
  }
}

async function installShedInvoice(context: BrowserContext, status = 'sent') {
  let invoice = { org_id: 'org-1', ...shedDeposit(status) }
  await signIn(context, { tables: { fh_contacts: [shedJob()], fh_invoices: [invoice], fh_payments: [] } })
  // The shared fixture only acknowledges writes. This fixture persists
  // the row before returning it, like PostgREST, so reload and revision
  // assertions test confirmed storage rather than an optimistic cache.
  await context.route('**/rest/v1/fh_invoices*', async (route) => {
    const request = route.request()
    if (request.method() === 'PATCH') {
      const params = new URL(request.url()).searchParams
      const matched = params.get('id') === `eq.${invoice.id}` &&
        (!params.has('status') || params.get('status') === `eq.${invoice.status}`)
      const single = request.headers().accept?.includes('vnd.pgrst.object')
      if (!matched) {
        await route.fulfill({ status: single ? 406 : 200, json: single ? { code: 'PGRST116', message: 'No matching invoice' } : [] })
        return
      }
      const patch = request.postDataJSON()
      invoice = { ...invoice, ...patch, updated_at: patch.updated_at || '2026-11-10T20:45:00.000Z' }
      await route.fulfill({ status: 200, json: single ? invoice : [invoice] })
      return
    }
    const response = restResponse(request.url(), { method: request.method(), headers: request.headers(), tables: { fh_invoices: [invoice] } })
    await route.fulfill({ status: response.status, body: response.body, contentType: 'application/json', headers: response.headers })
  })
}

test("the Description field holds the invoice's own description, not the job title", async ({ page, context }) => {
  await installShedInvoice(context)
  await openInvoice(page, 'inv-1')
  const field = page.getByLabel('Description, shows on the invoice')
  await expect(field).toHaveValue('Deposit for the shed slab')
  await expect(page.locator('.fhinv-hero').getByText('Slab + trench', { exact: true })).toBeVisible()
})

test('the Description field edits in place and shows in the PDF text', async ({ page, context }) => {
  await installShedInvoice(context)
  const saves: string[] = []
  await context.route('**/rest/v1/fh_invoices*', async (route) => {
    if (route.request().method() === 'PATCH') saves.push(route.request().postData() || '')
    await route.fallback()
  })
  await openInvoice(page, 'inv-1')
  const field = page.getByLabel('Description, shows on the invoice')
  await field.fill('Gravel base for the shed pad')
  // Leaving the field saves it: no Save button, no sheet.
  await field.blur()
  await expect.poll(() => saves.length, { timeout: 15_000 }).toBe(1)
  expect(JSON.parse(saves[0]).description).toBe('Gravel base for the shed pad')
  await expect(field).toHaveValue('Gravel base for the shed pad')
  await expect(page.getByRole('dialog')).toHaveCount(0)

  const download = page.waitForEvent('download')
  await action(page, 'PDF').click()
  const file = await download
  const text = readFileSync((await file.path()) as string, 'latin1')
  expect(text).toContain('Gravel base for the shed pad')
  expect(text).not.toContain('Deposit for the shed slab')
})

test('PDF waits for a pending description save and downloads the saved words', async ({ page, context }) => {
  await installShedInvoice(context)
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  let saves = 0
  await context.route('**/rest/v1/fh_invoices*', async (route) => {
    if (route.request().method() === 'PATCH' && 'description' in route.request().postDataJSON()) {
      saves++
      await held
    }
    await route.fallback()
  })
  const downloads: string[] = []
  page.on('download', (file) => downloads.push(file.suggestedFilename()))
  await openInvoice(page, 'inv-1')
  const field = page.getByLabel('Description, shows on the invoice')
  await field.fill('Gravel base for the shed pad')
  await action(page, 'PDF').click()
  const download = page.waitForEvent('download')
  try {
    await expect.poll(() => saves).toBe(1)
    await expect(page.getByText('Saving', { exact: true })).toBeVisible()
    await expect(action(page, 'PDF')).toHaveAttribute('aria-busy', 'true')
    expect(downloads).toEqual([])
  } finally {
    release()
  }
  const file = await download
  const text = readFileSync((await file.path()) as string, 'latin1')
  expect(text).toContain('Gravel base for the shed pad')
  expect(text).not.toContain('Deposit for the shed slab')
  expect(saves).toBe(1)
  await page.reload()
  await expect(field).toHaveValue('Gravel base for the shed pad')
})

test('new description edits survive an older save and persist in order', async ({ page, context }) => {
  await installShedInvoice(context)
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  const saves: string[] = []
  await context.route('**/rest/v1/fh_invoices*', async (route) => {
    if (route.request().method() === 'PATCH' && 'description' in route.request().postDataJSON()) {
      saves.push(route.request().postDataJSON().description)
      if (saves.length === 1) await held
    }
    await route.fallback()
  })
  await openInvoice(page, 'inv-1')
  const field = page.getByLabel('Description, shows on the invoice')
  await field.fill('First revision')
  await field.blur()
  try {
    await expect.poll(() => saves).toEqual(['First revision'])
    await field.fill('Latest revision with drainage')
    await field.blur()
    // The second blur joins the pending save rather than racing it.
    expect(saves).toEqual(['First revision'])
    await expect(field).toHaveValue('Latest revision with drainage')
  } finally {
    release()
  }
  await expect.poll(() => saves).toEqual(['First revision', 'Latest revision with drainage'])
  await expect(page.getByText('Saving', { exact: true })).toHaveCount(0)
  await expect(field).toHaveValue('Latest revision with drainage')
  await page.reload()
  await expect(field).toHaveValue('Latest revision with drainage')
})

test('Resend waits for the saved description and uses its returned revision', async ({ page, context }) => {
  await installShedInvoice(context)
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  let saves = 0
  const revision = '2026-11-10T20:30:00.000Z'
  await context.route('**/rest/v1/fh_invoices*', async (route) => {
    const body = route.request().postDataJSON()
    if (route.request().method() === 'PATCH' && body && 'description' in body) {
      saves++
      await held
      await route.fallback({ postData: JSON.stringify({ ...body, updated_at: revision }) })
      return
    }
    await route.fallback()
  })
  const uploads: string[] = []
  await context.route('**/storage/v1/object/**', async (route) => {
    uploads.push(route.request().postDataBuffer()?.toString('latin1') || '')
    await route.fulfill({ status: 200, json: { Key: 'job-files/qa-invoice.pdf' } })
  })
  const sends: Array<{ description: string; invoice_updated_at: string }> = []
  await context.route('**/api/send-invoice', async (route) => {
    sends.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, json: { ok: true } })
  })
  await openInvoice(page, 'inv-1')
  await page.getByLabel('Description, shows on the invoice').fill('Gravel base and drainage')
  await action(page, 'Resend').click()
  try {
    await expect.poll(() => saves).toBe(1)
    await expect(action(page, 'Resend')).toHaveAttribute('aria-busy', 'true')
    await expect(page.getByText('Saving', { exact: true })).toBeVisible()
    expect(uploads).toEqual([])
    expect(sends).toEqual([])
  } finally {
    release()
  }
  await expect.poll(() => sends.length).toBe(1)
  expect(sends[0]).toMatchObject({ description: 'Gravel base and drainage', invoice_updated_at: revision })
  expect(uploads).toHaveLength(1)
  expect(uploads[0]).toContain('Gravel base and drainage')
  expect(uploads[0]).not.toContain('Deposit for the shed slab')
  expect(saves).toBe(1)
})

for (const name of ['PDF', 'Resend', 'Share link']) {
  test(`${name} stops after a failed description save and keeps an explicit retry`, async ({ page, context }) => {
    await installShedInvoice(context)
    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    let fail = true
    let saves = 0
    await context.route('**/rest/v1/fh_invoices*', async (route) => {
      if (route.request().method() === 'PATCH' && 'description' in route.request().postDataJSON()) {
        saves++
        if (fail) {
          await held
          await route.fulfill({ status: 403, json: { message: 'Description write rejected' } })
          return
        }
      }
      await route.fallback()
    })
    let outputs = 0
    page.on('download', () => outputs++)
    await context.route('**/storage/v1/object/**', async (route) => {
      outputs++
      await route.fulfill({ status: 200, json: { Key: 'job-files/qa-invoice.pdf' } })
    })
    await context.route('**/api/send-invoice', async (route) => {
      outputs++
      await route.fulfill({ status: 200, json: { ok: true } })
    })
    await context.route('**/rest/v1/fh_public_links*', async (route) => {
      if (route.request().method() === 'POST') outputs++
      await route.fallback()
    })
    await openInvoice(page, 'inv-1')
    const field = page.getByLabel('Description, shows on the invoice')
    await field.fill('Keep these unsaved words')
    await action(page, name).click()
    try {
      await expect.poll(() => saves).toBe(1)
      await expect(action(page, name)).toHaveAttribute('aria-busy', 'true')
      expect(outputs).toBe(0)
    } finally {
      release()
    }
    await expect(field).toHaveAttribute('aria-invalid', 'true')
    await expect(field).toHaveValue('Keep these unsaved words')
    await expect(action(page, name)).not.toHaveAttribute('aria-busy', 'true')
    expect(outputs).toBe(0)
    fail = false
    await page.getByRole('button', { name: 'Try again', exact: true }).click()
    await expect(field).not.toHaveAttribute('aria-invalid', 'true')
    await expect(page.getByText('Saving', { exact: true })).toHaveCount(0)
    expect(saves).toBe(2)
    expect(outputs).toBe(0)
    await page.reload()
    await expect(field).toHaveValue('Keep these unsaved words')
  })
}

test('an update returning no row keeps the description unsaved', async ({ page, context }) => {
  await installShedInvoice(context)
  await context.route('**/rest/v1/fh_invoices*', async (route) => {
    if (route.request().method() === 'PATCH') {
      await route.fulfill({ status: 200, json: null })
      return
    }
    await route.fallback()
  })
  let downloads = 0
  page.on('download', () => downloads++)
  await openInvoice(page, 'inv-1')
  const field = page.getByLabel('Description, shows on the invoice')
  await field.fill('Do not report this saved')
  await field.blur()
  await expect(field).toHaveAttribute('aria-invalid', 'true')
  await action(page, 'PDF').click()
  await expect(action(page, 'PDF')).not.toHaveAttribute('aria-busy', 'true')
  await expect(field).toHaveValue('Do not report this saved')
  expect(downloads).toBe(0)
})

// The job's money view (JobMoney, /jobs/:id?tab=financials) bills the whole
// balance when no draw is open, so a paid deposit's description must not
// stand in for it: the job title prints instead.
test('with no open draw the job money view shows the job title, not a paid draw\'s description', async ({ page, context }) => {
  await installShedInvoice(context, 'paid')
  await page.goto('/jobs/c-job1?tab=financials', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const service = page.locator('.fh-invoice-detail__service')
  await expect(service).toBeVisible({ timeout: 30_000 })
  await expect(service.getByText('Slab + trench')).toBeVisible()
  await expect(service.getByText('Deposit for the shed slab')).toHaveCount(0)
})

// DATA-05: a job keeps a copy of the client's email from when it was made
// (x@y.com here). The office corrects the email on the client (jeff@roy.com),
// so every way a job's invoice is emailed goes to the client's email.
async function captureInvoiceSends(context: BrowserContext) {
  await context.route('**/storage/v1/object/**', (route) => route.fulfill({ status: 200, json: { Key: 'job-files/qa-invoice.pdf' } }))
  const sends: Array<{ recipient_email: string }> = []
  await context.route('**/api/send-invoice', async (route) => {
    sends.push(route.request().postDataJSON())
    await route.fulfill({ status: 200, json: { ok: true } })
  })
  return sends
}

test("Resend on a job's invoice goes to the client's current email", async ({ page, context }) => {
  await installShedInvoice(context)
  const sends = await captureInvoiceSends(context)
  await openInvoice(page, 'inv-1')
  await action(page, 'Resend').click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  expect(sends[0].recipient_email).toBe('jeff@roy.com')
})

test("Email on the job's money view goes to the client's current email", async ({ page, context }) => {
  await installShedInvoice(context)
  const sends = await captureInvoiceSends(context)
  await page.goto('/jobs/c-job1?tab=financials', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const email = page.getByRole('button', { name: 'Email', exact: true })
  await expect(email).toBeVisible({ timeout: 30_000 })
  await email.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  expect(sends[0].recipient_email).toBe('jeff@roy.com')
})

// raw-errors-7: a refused send showed the provider's English, its HTTP code
// and web address; a send after the sign in ran out showed invalid_token.
test('a refused send says in plain words that the email did not go out', async ({ page, context }) => {
  await installShedInvoice(context)
  await context.route('**/storage/v1/object/**', (route) => route.fulfill({ status: 200, json: { Key: 'job-files/qa-invoice.pdf' } }))
  let answer: { status: number; json: object } = { status: 502, json: { error: 'send_failed', provider_status: 403, detail: 'The gmail.com domain is not verified. Please, add and verify your domain on https://resend.com/domains' } }
  await context.route('**/api/send-invoice', (route) => route.fulfill(answer))
  await openInvoice(page, 'inv-1')
  const toasts = page.locator('[data-sonner-toaster]')
  await action(page, 'Resend').click()
  await expectPlain(toasts, 'The email did not go out. Try again, or download the PDF and send it yourself.')
  await expect(page.getByText(/resend\.com|gmail\.com/)).toHaveCount(0)
  answer = { status: 401, json: { error: 'invalid_token' } }
  await action(page, 'Resend').click()
  await expectPlain(toasts, 'Your sign in ran out. Sign in again, then try again.')
})

// raw-errors-13: the job's money view told the owner to add Resend keys in
// Netlify.
test("Email on the job's money view with no email sender says what to do", async ({ page, context }) => {
  await installShedInvoice(context)
  await context.route('**/storage/v1/object/**', (route) => route.fulfill({ status: 200, json: { Key: 'job-files/qa-invoice.pdf' } }))
  await context.route('**/api/send-invoice', (route) => route.fulfill({ status: 503, json: { error: 'sender_not_configured', message: 'Email sender is not configured yet.' } }))
  await page.goto('/jobs/c-job1?tab=financials', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const email = page.getByRole('button', { name: 'Email', exact: true })
  await expect(email).toBeVisible({ timeout: 30_000 })
  await email.click()
  await expectPlain(page.locator('[data-sonner-toaster]'), 'Downloaded the PDF so you can email it manually.')
})

// raw-errors-6: Void refused by the database showed the policy's words.
test('a refused Void says so in plain words', async ({ page, context }) => {
  await installShedInvoice(context)
  await failRest(context, 'fh_invoices', 'PATCH', FAIL.rls('fh_invoices'))
  await openInvoice(page, 'inv-1')
  await page.getByRole('button', { name: /^void$/i }).click()
  await page.waitForTimeout(700)
  await page.getByRole('button', { name: /tap again/i }).click()
  await expectPlain(page.locator('[data-sonner-toaster]'), 'Your role does not allow this. Ask an owner or admin.')
})

// raw-errors-4: a payment on no signal said "TypeError: Failed to fetch",
// and after the sign in ran out it said "JWT expired".
test('a payment on the invoice with no signal or a lapsed sign in says so in plain words', async ({ page, context }) => {
  await installShedInvoice(context)
  let answer: 'drop' | 'jwt' = 'drop'
  await context.route((url) => url.pathname === '/rest/v1/fh_payments', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    return answer === 'drop' ? route.abort('failed') : route.fulfill(FAIL.jwt())
  })
  await page.goto('/invoices/inv-1/payment', { waitUntil: 'domcontentloaded' })
  const amount = page.getByLabel('Amount')
  await expect(amount).toBeVisible({ timeout: 30_000 })
  await amount.fill('500')
  const toasts = page.locator('[data-sonner-toaster]')
  await page.getByRole('button', { name: /^record/i }).click()
  await expectPlain(toasts, 'No signal right now. Your work is still here, so try again when the signal is back.')
  answer = 'jwt'
  await page.getByRole('button', { name: /^record/i }).click()
  await expectPlain(toasts, 'Your sign in ran out. Sign in again, then try again.')
})

test("emailing a draw from the job's invoices goes to the client's current email", async ({ page, context }) => {
  await installShedInvoice(context)
  const sends = await captureInvoiceSends(context)
  await page.goto('/jobs/c-job1?tab=draws', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const email = page.getByRole('button', { name: 'Email draw to client' }).first()
  await expect(email).toBeVisible({ timeout: 30_000 })
  await email.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  expect(sends[0].recipient_email).toBe('jeff@roy.com')
})

// M-08 and DATA-03: a payment on a job a teammate created carries the
// teammate's id. Delete goes by id, and a delete that removed nothing says
// so instead of "Payment deleted".
function teammatePaymentTables() {
  const job = { ...shedJob(), id: 'c-team', user_id: 'teammate-9', amount: 12800 }
  const payment = { id: 'pay-team', user_id: 'teammate-9', contact_id: 'c-team', amount: 6400, method: 'check', reference: '1042', kind: 'deposit', paid_on: '2026-11-10', created_at: '2026-11-10T15:00:00.000Z', invoice_id: null }
  return { fh_contacts: [job], fh_payments: [payment], fh_invoices: [], fh_change_orders: [], fh_closeouts: [] }
}

async function tapDeletePayment(page: Page) {
  await page.goto('/jobs/c-team?tab=financials', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const del = page.getByRole('button', { name: /delete the \$6,400(\.00)? payment/i }).first()
  await expect(del).toBeVisible({ timeout: 30_000 })
  await del.click()
  await page.waitForTimeout(600) // a second tap within 500 ms is ignored (OPS-02)
  await page.getByRole('button', { name: /tap again to delete/i }).first().click()
}

// OPS-02: a fast double tap on a payment's delete must not delete it. A
// second tap within half a second of arming is ignored; a later one deletes.
test('a fast double tap on a payment delete does not delete the payment', async ({ page, context }) => {
  await signIn(context, { tables: teammatePaymentTables() })
  const deletes: string[] = []
  page.on('request', (r) => { if (r.method() === 'DELETE' && r.url().includes('/fh_payments')) deletes.push(r.url()) })
  await page.goto('/jobs/c-team?tab=financials', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const del = page.getByRole('button', { name: /delete the \$6,400(\.00)? payment/i }).first()
  await expect(del).toBeVisible({ timeout: 30_000 })
  await del.click()
  await page.getByRole('button', { name: /tap again to delete/i }).first().click({ delay: 0 })
  await page.waitForTimeout(700)
  expect(deletes).toEqual([])
  await page.getByRole('button', { name: /tap again to delete/i }).first().click()
  await expect.poll(() => deletes.length).toBe(1)
})

test("deleting a teammate's payment deletes it by id", async ({ page, context }) => {
  await signIn(context, { tables: teammatePaymentTables() })
  const deletes: string[] = []
  page.on('request', (r) => { if (r.method() === 'DELETE' && r.url().includes('/fh_payments')) deletes.push(new URL(r.url()).search) })
  await tapDeletePayment(page)
  await expect(page.getByText('Payment deleted').first()).toBeVisible()
  expect(deletes.length).toBe(1)
  expect(deletes[0]).toContain('id=eq.pay-team')
  expect(deletes[0]).not.toContain('user_id')
})

test('a payment delete that removes nothing says it failed', async ({ page, context }) => {
  await signIn(context, { tables: teammatePaymentTables() })
  await context.route('**/rest/v1/fh_payments*', async (route) => {
    if (route.request().method() === 'DELETE') { await route.fulfill({ status: 200, json: [] }); return }
    await route.fallback()
  })
  await tapDeletePayment(page)
  await expect(page.getByText("Couldn't delete payment").first()).toBeVisible()
  await expect(page.getByText('Payment deleted')).toHaveCount(0)
})

// DATA-03: an expense a teammate logged carries the teammate's id. The
// delete goes by id, and one that removed nothing says so.
function teammateExpenseTables() {
  const job = { ...shedJob(), id: 'c-team', user_id: 'teammate-9', amount: 12800 }
  const expense = { id: 'exp-team', user_id: 'teammate-9', contact_id: 'c-team', description: 'Rebar', category: 'Materials', amount: 420, date: '2026-11-10', created_at: '2026-11-10T15:00:00.000Z' }
  return { fh_contacts: [job], fh_expenses: [expense], fh_payments: [], fh_invoices: [], fh_subs: [] }
}

test("deleting a teammate's expense deletes it by id", async ({ page, context }) => {
  await signIn(context, { tables: teammateExpenseTables() })
  const deletes: string[] = []
  page.on('request', (r) => { if (r.method() === 'DELETE' && r.url().includes('/fh_expenses')) deletes.push(new URL(r.url()).search) })
  await page.goto('/jobs/c-team?tab=expenses', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const del = page.getByRole('button', { name: 'Delete expense' }).first()
  await expect(del).toBeVisible({ timeout: 30_000 })
  await del.click()
  await expect(page.getByText('Expense removed').first()).toBeVisible()
  expect(deletes.length).toBe(1)
  expect(deletes[0]).toContain('id=eq.exp-team')
  expect(deletes[0]).not.toContain('user_id')
})

test('an expense delete that removes nothing says it failed', async ({ page, context }) => {
  await signIn(context, { tables: teammateExpenseTables() })
  await context.route('**/rest/v1/fh_expenses*', async (route) => {
    if (route.request().method() === 'DELETE') { await route.fulfill({ status: 200, json: [] }); return }
    await route.fallback()
  })
  await page.goto('/jobs/c-team?tab=expenses', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const del = page.getByRole('button', { name: 'Delete expense' }).first()
  await expect(del).toBeVisible({ timeout: 30_000 })
  await del.click()
  await expect(page.getByText("Couldn't delete").first()).toBeVisible()
  await expect(page.getByText('Expense removed')).toHaveCount(0)
})

// M-12: a paid draw keeps its amount and status. The Draws tab still lets
// its title, dates and words change, but the amount is read only, Draft is
// not offered, and the save sends neither, nor a new owner.
test('a paid draw cannot be edited to a new amount or set back to draft', async ({ page, context }) => {
  const draw = { ...shedDeposit('paid'), org_id: 'org-1', amount: 5000 }
  const payment = { id: 'pay-1', user_id: 'qa-user-1', contact_id: 'c-job1', invoice_id: 'inv-1', amount: 5000, method: 'check', kind: 'deposit', paid_on: '2026-10-12', created_at: '2026-10-12T15:00:00.000Z' }
  await signIn(context, { tables: { fh_contacts: [{ ...shedJob(), amount: 10000 }], fh_invoices: [draw], fh_payments: [payment], fh_change_orders: [] } })
  const patches: any[] = []
  page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/fh_invoices')) patches.push(r.postDataJSON()) })
  await page.goto('/jobs/c-job1?tab=draws', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const edit = page.getByRole('button', { name: 'Edit draw' }).first()
  await expect(edit).toBeVisible({ timeout: 30_000 })
  await edit.click()
  const editor = page.locator('.fh-draws-editor')
  const amount = editor.getByLabel('Amount')
  await expect(amount).toHaveAttribute('readonly', '')
  await amount.focus()
  await page.keyboard.press('End')
  await page.keyboard.type('8')
  await expect(amount).toHaveValue('5000')
  await expect(editor.getByRole('button', { name: 'Draft', exact: true })).toHaveCount(0)
  await expect(editor.getByRole('button', { name: 'Sent', exact: true })).toHaveCount(0)
  await editor.getByLabel('Title').fill('Deposit paid')
  await editor.getByRole('button', { name: 'Save changes' }).click()
  await expect.poll(() => patches.length).toBe(1)
  expect(patches[0].title).toBe('Deposit paid')
  expect(patches[0]).not.toHaveProperty('amount')
  expect(patches[0]).not.toHaveProperty('status')
  expect(patches[0]).not.toHaveProperty('user_id')
})

// M-20: the Expenses list keeps cents on each row and the total.
test('expenses show cents', async ({ page, context }) => {
  const tables = teammateExpenseTables()
  tables.fh_expenses = [{ ...tables.fh_expenses[0], amount: 420.5 }, { ...tables.fh_expenses[0], id: 'exp-2', description: 'Forms', amount: 79.25 }]
  await signIn(context, { tables })
  await page.goto('/jobs/c-team?tab=expenses', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await expect(page.getByText('$420.50').first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('$79.25').first()).toBeVisible()
  await expect(page.getByText('$499.75').first()).toBeVisible()
})

// DATA-07: after a payment the job's Money tab reads its money again, so
// it does not keep the old balance until the app refocuses.
test('after a payment the Money tab reads its money again', async ({ page, context }) => {
  await signIn(context, { tables: { fh_contacts: [shedJob()], fh_invoices: [], fh_payments: [], fh_change_orders: [] } })
  const reads: { at: number; url: string }[] = []
  page.on('request', (r) => {
    const url = r.url()
    if (r.method() === 'GET' && url.includes('/rest/v1/')) reads.push({ at: Date.now(), url: decodeURIComponent(url) })
  })
  await page.goto('/jobs/c-job1?tab=financials', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const collect = page.getByRole('button', { name: /collect payment/i }).first()
  await expect(collect).toBeVisible({ timeout: 30_000 })
  await collect.click()
  await page.waitForURL(/\/jobs\/c-job1\/payment/)
  await page.getByLabel('Amount').fill('500')
  const tapped = Date.now()
  await page.getByRole('button', { name: /^record/i }).click()
  await page.waitForURL((u) => !u.pathname.endsWith('/payment'), { timeout: 15_000 })
  // The Money tab's own bundle (the job read with its client embed), not
  // only the job header.
  const bundleReads = () => reads.filter((r) => r.at > tapped && r.url.includes('/fh_contacts') && r.url.includes('fh_clients!fh_contacts_client_id_fkey') && r.url.includes('id=eq.c-job1')).length
  await expect.poll(bundleReads, { timeout: 5_000 }).toBeGreaterThan(0)
})

// M-22: the invoice, payment, draw and change order editors keep amounts
// to two decimals, as the create screens do.
test.describe('money editors keep two decimals', () => {
  test('invoice edit', async ({ page, context }) => {
    await installShedInvoice(context)
    await page.goto('/invoices/inv-1/edit', { waitUntil: 'domcontentloaded' })
    const amount = page.getByLabel('Amount')
    await expect(amount).toBeVisible({ timeout: 30_000 })
    await amount.fill('')
    await amount.pressSequentially('1.005')
    await expect(amount).toHaveValue('1.00')
  })

  test('invoice payment', async ({ page, context }) => {
    await installShedInvoice(context)
    await page.goto('/invoices/inv-1/payment', { waitUntil: 'domcontentloaded' })
    const amount = page.getByLabel('Amount')
    await expect(amount).toBeVisible({ timeout: 30_000 })
    await amount.fill('')
    await amount.pressSequentially('1.005')
    await expect(amount).toHaveValue('1.00')
  })

  test('draw editor', async ({ page, context }) => {
    await installShedInvoice(context)
    await page.goto('/jobs/c-job1?tab=draws', { waitUntil: 'domcontentloaded' })
    const edit = page.getByRole('button', { name: 'Edit draw' }).first()
    await expect(edit).toBeVisible({ timeout: 30_000 })
    await edit.click()
    const amount = page.locator('.fh-draws-editor').getByLabel('Amount')
    await amount.fill('')
    await amount.pressSequentially('1.005')
    await expect(amount).toHaveValue('1.00')
  })

  test('change order editor keeps a credit and two decimals', async ({ page, context }) => {
    await signIn(context, { tables: { fh_contacts: [shedJob()], fh_invoices: [], fh_payments: [], fh_change_orders: [] } })
    await page.goto('/jobs/c-job1?tab=change_orders', { waitUntil: 'domcontentloaded' })
    const add = page.getByRole('button', { name: 'Add', exact: true })
    await expect(add).toBeVisible({ timeout: 30_000 })
    await add.click()
    const amount = page.locator('input[inputmode="decimal"]').first()
    await amount.pressSequentially('-12.345')
    await expect(amount).toHaveValue('-12.34')
  })
})

// DATA-18: a change order write that changed no row never says it saved.
// The change order here was written by a teammate; anyone who may edit the
// job's money may send or delete it, and row security decides.
test.describe('a change order write that finds nothing to change', () => {
  const teammateCo = { id: 'co-team', org_id: 'org-1', user_id: 'teammate-9', contact_id: 'c-job1', sequence_number: 3, title: 'Extra footing', description: null, amount: 1800, status: 'draft', created_at: '2026-11-10T15:00:00.000Z' }
  const tables = { fh_contacts: [shedJob()], fh_invoices: [], fh_payments: [], fh_change_orders: [teammateCo] }

  test('a delete that removed nothing does not say deleted', async ({ page, context }) => {
    await signIn(context, { tables })
    await context.route(url => url.pathname.endsWith('/rest/v1/fh_change_orders'), route => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await page.goto('/jobs/c-job1?tab=change_orders', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Delete change order', exact: true }).click()
    await page.waitForTimeout(600) // a second tap within 500 ms is ignored (OPS-02)
    await page.getByRole('button', { name: 'Tap again to delete', exact: true }).click()
    await expect(page.getByText("Couldn't delete change order", { exact: true })).toBeVisible()
    await expect(page.getByText('Change order deleted', { exact: true })).toHaveCount(0)
  })

  test("sending a teammate's change order marks it sent by id, and stops when it is gone", async ({ page, context }) => {
    await signIn(context, { tables })
    const patches: string[] = []
    await context.route(url => url.pathname.endsWith('/rest/v1/fh_change_orders'), route => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      patches.push(route.request().url())
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await context.route(url => url.pathname.endsWith('/rest/v1/fh_public_links'), route => {
      if (route.request().method() !== 'POST') return route.fallback()
      return route.fulfill({ status: 201, json: { id: 'link-co', ...route.request().postDataJSON() } })
    })
    await page.goto('/jobs/c-job1?tab=change_orders', { waitUntil: 'domcontentloaded' })
    await page.getByRole('button', { name: 'Send for signature', exact: true }).click()
    await expect.poll(() => patches.length).toBe(1)
    expect(new URL(patches[0]).searchParams.get('id')).toBe('eq.co-team')
    expect(new URL(patches[0]).searchParams.has('user_id')).toBe(false)
    await expect(page.getByText('This change order changed on another device. The list is read again.', { exact: true })).toBeVisible()
    await expect(page.getByText('Approval link copied', { exact: true })).toHaveCount(0)
  })
})

// OPS-11: one Back after saving an invoice edit or recording a payment
// leaves the invoice, instead of landing on the same invoice again.
for (const flow of ['edit', 'payment'] as const) {
  test(`one Back after the invoice ${flow} screen saves leaves the invoice`, async ({ page, context }) => {
    await installShedInvoice(context)
    await page.goto('/money', { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await page.goto('/invoices/inv-1', { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await expect(page.locator('.fhinv-actions')).toBeVisible({ timeout: 30_000 })
    if (flow === 'edit') await page.getByRole('link', { name: 'Edit', exact: true }).first().click()
    else await action(page, 'Collect payment').click()
    await expect(page).toHaveURL(new RegExp(`/invoices/inv-1/${flow}$`))
    const amount = page.getByLabel('Amount')
    await expect(amount).toBeVisible({ timeout: 30_000 })
    if (flow === 'edit') {
      await amount.fill('3000')
      await page.getByRole('button', { name: /^save/i }).click()
    } else {
      await amount.fill('100')
      await page.getByRole('button', { name: /^record/i }).click()
    }
    await expect(page).toHaveURL(/\/invoices\/inv-1$/)
    await expect(page.locator('.fhinv-actions')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Back' }).first().click()
    await expect(page).not.toHaveURL(/\/invoices\/inv-1/)
  })
}

// OPS-15: the payment form warns on an amount over what is owed and on a
// future date, and does not send a check number hidden by choosing cash.
test('the invoice payment form warns and drops a hidden check number', async ({ page, context }) => {
  await installShedInvoice(context)
  const posts: any[] = []
  page.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/rest/v1/fh_payments')) posts.push(r.postDataJSON()) })
  await page.goto('/invoices/inv-1/payment', { waitUntil: 'domcontentloaded' })
  const amount = page.getByLabel('Amount')
  await expect(amount).toBeVisible({ timeout: 30_000 })
  await amount.fill('99999')
  await expect(page.getByText(/more than the \$3,000(\.00)? still owed/i)).toBeVisible()
  await page.getByLabel('Paid on').fill('2027-03-01')
  await expect(page.getByText(/in the future/i)).toBeVisible()
  await amount.fill('100')
  await page.getByLabel('Paid on').fill('2026-11-10')
  await page.getByLabel('Check number').fill('1042')
  await page.getByLabel('Method').selectOption('cash')
  await page.getByRole('button', { name: /^record/i }).click()
  await expect.poll(() => posts.length).toBe(1)
  expect(posts[0].reference ?? null).toBeNull()
  expect(posts[0].method).toBe('cash')
})

// OPS-02: a fast double tap on Void must not void. A second tap within
// half a second of arming is ignored; a later one voids.
test('a fast double tap on Void does not void the invoice', async ({ page, context }) => {
  await installShedInvoice(context)
  const voids: string[] = []
  page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/fh_invoices') && (r.postData() || '').includes('"void"')) voids.push(r.url()) })
  await openInvoice(page, 'inv-1')
  const voidButton = page.getByRole('button', { name: /^void$/i })
  await expect(voidButton).toBeVisible()
  await voidButton.click()
  await page.getByRole('button', { name: /tap again/i }).click({ delay: 0 })
  await page.waitForTimeout(700)
  expect(voids).toEqual([])
  await page.getByRole('button', { name: /tap again/i }).click()
  await expect.poll(() => voids.length).toBe(1)
})

// OPS-14: on a phone a draw row keeps its title, dates and buttons apart,
// and Open is a full size target.
for (const width of [320, 390, 412]) {
  test(`a draw row fits a ${width} px phone`, async ({ page, context }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'phone layout')
    await page.setViewportSize({ width, height: 900 })
    await installShedInvoice(context)
    await page.goto('/jobs/c-job1?tab=draws', { waitUntil: 'domcontentloaded' })
    const row = page.locator('.fh-draws-row').first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    const title = row.getByText('Deposit', { exact: true })
    const titleBox = (await title.boundingBox())!
    for (const name of ['Email draw to client', 'Download draw PDF', 'Edit draw']) {
      const b = (await row.getByRole('button', { name }).boundingBox())!
      const overlaps = b.x < titleBox.x + titleBox.width && b.x + b.width > titleBox.x && b.y < titleBox.y + titleBox.height && b.y + b.height > titleBox.y
      expect(overlaps, `${name} covers the title`).toBe(false)
    }
    const due = row.getByText(/^Due /)
    const dueBox = (await due.boundingBox())!
    expect(dueBox.height, 'the due date stays on one line').toBeLessThan(24)
    const open = (await row.getByRole('link', { name: /open invoice/i }).boundingBox())!
    expect(open.height).toBeGreaterThanOrEqual(44)
    await nothingRunsOffTheSide(page, `/jobs/c-job1?tab=draws at ${width} px`)
  })
}

// D13: on a wide screen the intro and the To, Invoice and Amount facts
// sit in the same centred column as the actions, not at the left edge.
test('the remind screen keeps its intro and facts in the centred column', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop width')
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/invoices/inv1/remind', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await expect(page.locator('.fhinv-facts')).toBeVisible({ timeout: 30_000 })
  const lefts = await page.evaluate(() => ['.fhinv-intro', '.fhinv-facts', '.fhinv-actions']
    .map((sel) => Math.round(document.querySelector(sel)!.getBoundingClientRect().left)))
  expect(lefts[0]).toBe(lefts[2])
  expect(lefts[1]).toBe(lefts[2])
})
