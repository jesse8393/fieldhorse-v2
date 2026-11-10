import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { installMock, restResponse, session } from '../../scripts/qa-mock.mjs'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'
import { signIn } from './helpers/signIn.ts'

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
