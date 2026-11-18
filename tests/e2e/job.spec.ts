// The Job page on a phone (docs/design/2026-10-redesign/SPEC.md 9.4,
// PHASE2_PLAN.md Task 12, render glamor/g-job.jpg): the photo header that
// falls back to the onyx band, the stage rail, the money strip, the
// section tabs with the Spine first, and the floating action capsule
// that takes the dock's place.
import { expect, test, type Page, type Route } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { contrastOf } from './helpers/contrast.ts'
import { FAIL, expectPlain } from './helpers/rawErrors.ts'
import { goInApp, holdPosts, postsTo, twoTaps } from './helpers/doubleTap.ts'
import { NOW as FORMATS_NOW, TABLES as FORMATS_TABLES } from './helpers/formatsSeed.ts'

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fhj-page')).toBeVisible({ timeout: 30_000 })
}

// Opens the Spine's "More about this job" disclosure. The page can render
// again right after it mounts (its data and the viewer's role arrive), so a
// tap that landed before that is tried once more.
async function openMoreAboutJob(page: Page) {
  const toggle = page.getByRole('button', { name: 'More about this job' })
  const body = page.locator('#fhj-more-body')
  for (let attempt = 0; attempt < 3; attempt++) {
    await toggle.click()
    try {
      await expect(body).toBeVisible({ timeout: 3000 })
      return
    } catch {
      if (await toggle.getAttribute('aria-expanded') === 'true') return
    }
  }
  await expect(body).toBeVisible()
}

test.describe('job page on a phone', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone layout')
  })

  test('job header and rail', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')

    const title = page.getByRole('heading', { level: 1, name: 'Slab + trench' })
    await expect(title).toBeVisible()
    const client = page.locator('.fh-job-phone-heading').getByText(/Plumbing Bellevue/)
    await expect(client).toBeVisible()
    const titleBox = await title.boundingBox()
    const clientBox = await client.boundingBox()
    expect(clientBox!.y).toBeGreaterThan(titleBox!.y)

    await page.locator('.fh-job-contact-disclosure > summary').click()
    // One disclosure reveals both project and financial details.
    await expect(page.locator('.fh-job-finance-disclosure')).toBeVisible()
    const current = page.getByRole('list', { name: 'Stage' }).locator('[aria-current="step"]')
    await expect(current).toHaveText(/^Job/)

    await expect(page.getByText('Contract', { exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden()

    const gold = page.locator('.fhj-capsule .fhc-btn--primary')
    await expect(gold).toHaveCount(1)
    await expect(gold).toBeVisible()
    await expect(gold).toHaveText('Invoice this')
    const box = await gold.boundingBox()
    const viewport = page.viewportSize()!
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)

    // The capsule keeps Capture one tap away.
    await expect(page.locator('.fhj-capsule').getByRole('button', { name: /photo/i })).toBeVisible()
    await expect(page.locator('.fhj-capsule').getByRole('button', { name: /voice note/i })).toBeVisible()
  })

  test('job without photos', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    const hero = page.locator('.fh-job-phone-heading')
    await expect(hero.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(hero.getByText(/Plumbing Bellevue/)).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(hero.locator('img')).toHaveCount(0)
    await expect(hero.getByRole('button', { name: /photos/i })).toHaveCount(0)
  })

  test('photo signing fails', async ({ context, page }) => {
    // Rows exist but the mock's storage answers 404, so no url signs.
    const now = Date.now()
    await signIn(context, {
      tables: {
        fh_job_files: [
          { id: 'f1', job_id: 'c-job1', kind: 'photo', storage_path: 'u/c-job1/f1.jpg', filename: 'f1.jpg', uploaded_at: new Date(now - 60_000).toISOString(), caption: null },
          { id: 'f2', job_id: 'c-job1', kind: 'photo', storage_path: 'u/c-job1/f2.jpg', filename: 'f2.jpg', uploaded_at: new Date(now - 120_000).toISOString(), caption: null }
        ]
      }
    })
    await open(page, '/jobs/c-job1')
    const hero = page.locator('.fh-job-phone-heading')
    await expect(hero.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Latest from site', exact: true }).getByRole('button', { name: 'Photos', exact: true })).toBeVisible()
    await expect(hero.locator('img')).toHaveCount(0)
    await expect(page.locator('.fhj-spine img')).toHaveCount(0)
    // The count still opens the photos.
    await page.locator('.fh-job-contact-disclosure > summary').click()
    await page.getByRole('button', { name: '2 photos', exact: true }).click()
    await expect(page.getByRole('region', { name: 'Photos workspace', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue('files')
  })

  test('spine first', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue('overview')
    await expect(page.locator('.fhj-spine').getByText('Inspector confirmed Friday.')).toBeVisible()
  })

  // ai-copy-4: the open task's button and the progress label use sentence
  // case, so the card no longer spells Mark complete two ways.
  test('the next action and progress read in sentence case', async ({ context, page }) => {
    await signIn(context, {
      tables: {
        fh_schedule: [],
        fh_job_todos: [{ id: 't1', job_id: 'c-job1', user_id: 'qa-user-1', org_id: 'org-1', text: 'Order rebar', done: false, due_at: null, completed_at: null, assigned_to: null, created_at: new Date().toISOString() }]
      }
    })
    await open(page, '/jobs/c-job1')
    await openMoreAboutJob(page)
    const more = page.locator('#fhj-more-body')
    await expect(more.getByText('Order rebar')).toBeVisible()
    await expect(more.getByText('Job progress', { exact: true })).toBeVisible()
    expect(await more.innerText()).not.toMatch(/Mark Complete|Job Progress/)
  })

  // ai-copy-3: the empty Files and Expenses lines read as sentences.
  test('the empty files and expenses lines read as sentences', async ({ context, page }) => {
    await signIn(context, { tables: { fh_files: [], fh_expenses: [] } })
    await open(page, '/jobs/c-job1?tab=documents')
    await expect(page.getByText('No files yet.', { exact: false })).toBeVisible()
    await expect(page.getByText('No files yet. Upload permits, contracts, plans or anything else that supports the job.')).toBeVisible()
    await open(page, '/jobs/c-job1?tab=expenses')
    await expect(page.getByText('No expenses yet. Log materials, fuel and permits as you go so the margin stays real.')).toBeVisible()
  })

  test('every section stays one tap away', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    const sections = page.getByRole('combobox', { name: 'Job section', exact: true })
    for (const name of ['Activity', 'Milestones', 'Tasks', 'Schedule', 'Selections', 'Materials', 'Change orders', 'Daily logs', 'Contract balance', 'Invoices', 'Photos', 'Files']) {
      await expect(sections.getByRole('option', { name, exact: true })).toHaveCount(1)
    }
    await sections.selectOption('financials')
    await expect(sections).toHaveValue('financials')
    await expect(page).toHaveURL(/tab=financials/)

    // A quote is its own screen (Phase 9, D53): its lines are one tap away too.
    await page.goto('/quotes/q-quote', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('.fhqt-page')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Parking lot repour' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add a line' })).toBeVisible()
  })

  test('the section selector fits a narrow phone without horizontal scrolling', async ({ context, page }) => {
    await signIn(context)
    await page.setViewportSize({ width: 320, height: 740 })
    await open(page, '/jobs/c-job1')
    const selector = page.getByRole('combobox', { name: 'Job section', exact: true })
    const box = (await selector.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
    expect(box.height).toBeGreaterThanOrEqual(44)
    await expect(page.getByRole('tablist')).toHaveCount(0)
  })

  for (const id of ['change_orders', 'logs', 'financials', 'files', 'documents', 'tasks']) {
    test(`deep linked ${id} stays selected on reload`, async ({ context, page }) => {
      await signIn(context)
      await open(page, `/jobs/c-job1?tab=${id}`)
      await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue(id)
      await page.reload()
      await expect(page.locator('.fhj-page')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue(id)
    })
  }

  test('section selection survives membership loading', async ({ context, page }) => {
    await signIn(context)
    const isMembers = (url: URL) => url.pathname.endsWith('/rest/v1/org_members')
    let release = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const hold = async (route: Route) => { await held; await route.fallback() }
    await context.route(isMembers, hold)
    await open(page, '/jobs/c-job1?tab=logs')
    const selector = page.getByRole('combobox', { name: 'Job section', exact: true })
    await expect(selector).toHaveValue('logs')
    await expect(selector.locator('option[value="change_orders"]')).toHaveCount(0)
    release()
    await expect(selector.locator('option[value="change_orders"]')).toHaveCount(1)
    await expect(selector).toHaveValue('logs')
    await context.unroute(isMembers, hold)
  })

  test('native keyboard selection opens a section without a second tab row', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    const selector = page.getByRole('combobox', { name: 'Job section', exact: true })
    await selector.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(selector).not.toHaveValue('overview')
    await expect(page.getByRole('tablist')).toHaveCount(0)
  })

  test('opened from the Jobs list, the header spans the page and the section selector fits', async ({ context, page }) => {
    await signIn(context)
    // By tapping a row, so the Jobs list's styles are already on the page
    // when the job draws: the way most people reach a job.
    await page.goto('/work', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
    await page.getByText('Plumbing Bellevue', { exact: true }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)
    await expect(page.locator('.fhj-page')).toBeVisible({ timeout: 30_000 })
    const width = page.viewportSize()!.width
    const near = (a: number, b: number) => Math.abs(a - b) <= 1

    // One column: the onyx hero spans the page and the facts sit under it.
    const hero = page.locator('.fh-job-phone-heading')
    await expect(hero.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    expect(await page.locator('.fhj-page .fhj-head').evaluate((el) => getComputedStyle(el).display)).not.toBe('flex')
    const heroBox = (await hero.boundingBox())!
    expect(near(heroBox.x, 0) && near(heroBox.width, width), `hero ${heroBox.x}, ${heroBox.width} wide`).toBe(true)
    const factsBox = (await page.locator('.fhj-facts').boundingBox())!
    expect(factsBox.y).toBeGreaterThanOrEqual(heroBox.y + heroBox.height - 1)

    const selector = page.getByRole('combobox', { name: 'Job section', exact: true })
    const box = (await selector.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
  })

  test('the page scrolls clear of the capsule', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    await expect(page.locator('.fhj-spine').getByText('Inspector confirmed Friday.')).toBeVisible()
    await page.getByRole('button', { name: 'More about this job' }).click()
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await page.waitForTimeout(150)
    const capsuleTop = await page.locator('.fhj-capsule').evaluate((el) => el.getBoundingClientRect().top)
    const contentBottom = await page.locator('.fhj-page').evaluate((el) => {
      const panel = el.querySelector('[role="region"][aria-label$=" workspace"]')
      const last = panel?.lastElementChild ?? panel
      return last ? last.getBoundingClientRect().bottom : 0
    })
    expect(contentBottom).toBeLessThanOrEqual(capsuleTop)
  })

  test('the more menu is a screen, and sets a follow up on its own screen', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    await page.getByRole('button', { name: 'More actions for this job' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1\/more$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Set follow up/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Edit job details/ })).toBeVisible()
    await page.getByRole('link', { name: /Set follow up/ }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1\/follow-up$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    for (const name of ['Tomorrow', 'In 3 days', 'Next week']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByLabel('Pick a date')).toBeVisible()
    await page.getByRole('button', { name: 'Tomorrow', exact: true }).click()
    await expect(page.getByText('Follow up set', { exact: true })).toBeVisible()
    // Saving lands back on the job.
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)
  })

  // The sheets the job page used to open are screens of their own (D57):
  // each button changes the URL and nothing with role dialog ever mounts.
  test('the job page opens no dialog for payment, event, partner, complete or invoice', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    const steps: [string, RegExp][] = [
      ['Log payment', /\/jobs\/c-job1\/payment$/],
      ['Schedule event', /\/schedule\/new\?job=c-job1$/],
      ['Invite partner', /\/jobs\/c-job1\/partner$/],
      ['Mark complete', /\/jobs\/c-job1\/complete$/]
    ]
    for (const [name, url] of steps) {
      await openMoreAboutJob(page)
      await page.locator('#fhj-more-body').getByRole('button', { name, exact: true }).click()
      await expect(page).toHaveURL(url)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
      await page.goBack()
      await expect(page.locator('.fhj-page')).toBeVisible()
    }
    await page.locator('.fhj-capsule').getByRole('button', { name: 'Invoice this' }).click()
    await expect(page).toHaveURL(/\/invoices\/new\?job=c-job1$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  // OPS-19: Harold's $12,800 driveway is fully invoiced with $6,400 still
  // owed. A new invoice has nothing left to bill, so the main action moves
  // the job on instead.
  test('with everything invoiced the main action is Mark complete', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job2')
    const gold = page.locator('.fhj-capsule .fhc-btn--primary')
    await expect(gold).toHaveText('Mark complete')
    await gold.click()
    await expect(page).toHaveURL(/\/jobs\/c-job2\/complete$/)
  })

  test('Invoice this opens the new invoice screen with the balance', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    await page.locator('.fhj-capsule').getByRole('button', { name: 'Invoice this' }).click()
    await expect(page).toHaveURL(/\/invoices\/new\?job=c-job1$/)
    await expect(page.getByRole('heading', { level: 1, name: 'New invoice' })).toBeVisible()
    await expect(page.getByLabel('Amount')).toHaveValue('33100')
    await expect(page.getByLabel('Description')).toHaveValue('Slab + trench')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Delete asks with a second tap, not a sheet', async ({ context, page }) => {
    await signIn(context)
    const deletes: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/rest/v1/fh_contacts')) deletes.push(req.url())
    })
    await open(page, '/jobs/c-job1')
    await page.getByRole('button', { name: 'More actions for this job' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1\/more$/)
    await page.getByRole('button', { name: 'Delete job' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const again = page.getByRole('button', { name: 'Tap again to delete' })
    await expect(again).toBeVisible()
    expect(deletes).toEqual([])
    await page.waitForTimeout(600) // a second tap within 500 ms is ignored (OPS-02)
    await again.click()
    await expect.poll(() => deletes.length).toBe(1)
    expect(deletes[0]).toMatch(/id=eq\.c-job1/)
    await expect(page).toHaveURL(/\/(jobs|work)\b/)
    await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
  })

  test('the capsule camera hands its photos to the Files tab', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    const camera = page.locator('.fhj-capsule input[type="file"]')
    await expect(camera).toHaveAttribute('accept', 'image/*')
    await camera.setInputFiles({
      name: 'slab.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
    })
    await expect(page.getByRole('region', { name: 'Photos workspace', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue('files')
  })

  test('deep links into the job keep working', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1?tab=files')
    await expect(page.getByRole('region', { name: 'Photos workspace', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue('files')

    await open(page, '/jobs/c-job1?tab=financials&action=send_invoice')
    const cue = page.getByRole('region', { name: 'Dashboard action cue' })
    await expect(cue).toBeVisible()
    await cue.getByRole('button', { name: 'Invoice this' }).click()
    await expect(page).toHaveURL(/\/invoices\/new\?job=c-job1$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  // dead-ends-8: a walk up customer's job with no phone and no address. The
  // tiles say what is missing in words, and open the job's details to add
  // it. Crew, who cannot edit the job, read the same reason on a still tile.
  const BARE_JOB = {
    id: 'c-bare', user_id: 'qa-user-1', client_id: null, stage: 'job', name: 'Walk Up Customer', job_title: 'Stoop repair',
    amount: 2400, phone: null, email: null, address: null, notes: null, scope_text: null, milestones: [],
    created_at: '2026-10-01T15:00:00.000Z', updated_at: '2026-10-09T15:00:00.000Z', proposal_status: null,
    follow_up_on: null, completed_at: null, invoice_no: null, client_name: 'Walk Up Customer'
  }

  test('with no phone or address, Call and Navigate say so and open the details to add them', async ({ context, page }) => {
    await signIn(context, { tables: { fh_contacts: [BARE_JOB] } })
    await open(page, '/jobs/c-bare')
    const quick = page.getByRole('list', { name: 'Quick actions' })
    await expect(quick.locator('button:disabled')).toHaveCount(0)
    const addPhone = quick.getByRole('link', { name: 'Add a phone number for Walk Up Customer' })
    await expect(addPhone).toHaveText('Add phone')
    await expect(quick.getByRole('link', { name: 'Add the job site address' })).toHaveText('Add address')
    await addPhone.click()
    await expect(page.getByLabel('Phone', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByLabel('Address', { exact: true })).toBeVisible()
  })

  test('crew read why Call and Navigate do nothing', async ({ context, page }) => {
    await signIn(context, { role: 'crew', tables: { fh_contacts: [BARE_JOB] } })
    await open(page, '/jobs/c-bare')
    const quick = page.getByRole('list', { name: 'Quick actions' })
    await expect(quick.getByRole('button', { name: 'Call, no phone on file' })).toHaveText('No phone')
    await expect(quick.getByRole('button', { name: 'Navigate, no address on file' })).toHaveText('No address')
  })

  // dead-ends-1: a past due link Today wrote before Remind opened the
  // reminder itself lands on the job's invoices, never on a new invoice
  // that could bill the customer twice.
  test('an old past due link opens the job\'s invoices, not a new invoice', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job2?tab=financials&action=nudge_invoice')
    const cue = page.getByRole('region', { name: 'Dashboard action cue' })
    await expect(cue).toBeVisible()
    await cue.getByRole('button', { name: 'Open invoices' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job2\?tab=draws$/)
    await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue('draws')
  })

  test('lost job', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-lost')
    await page.locator('.fh-job-contact-disclosure > summary').click()
    await expect(page.locator('.fh-job-finance-disclosure')).toBeVisible()
    const rail = page.locator('.fhc-rail')
    await expect(rail.getByText('Lost', { exact: true })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Stage' }).locator('[aria-current="step"]')).toHaveCount(0)
    await expect(page.locator('.fhj-capsule .fhc-btn--primary')).toHaveText('Reopen')
  })

  test('crew sees no money', async ({ context, page }) => {
    await signIn(context, { role: 'crew' })
    await open(page, '/jobs/c-job1')
    await expect(page.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(page.locator('.fhj-spine').getByText('Inspector confirmed Friday.')).toBeVisible()
    await expect(page.getByText('Contract', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/\$33,100/)).toHaveCount(0)
    await expect(page.locator('.fhj-capsule .fhc-btn--primary')).toHaveCount(0)
  })
})

test.describe('job page on a desktop', () => {
  test('keeps the desktop build', async ({ context, page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop layout')
    await signIn(context)
    await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.fhj-page')).toHaveCount(0)
    await expect(page.locator('.fhj-capsule')).toHaveCount(0)
  })
})

// The Job page on a desktop (SPEC.md 9.11, PHASE4_PLAN.md Task 4.3, render
// glamor/g-desktop-job.jpg): the photo banner that falls back to onyx, the
// full width stage rail with notes, the composer and section tabs on the
// left, the facts panel on the right with the Balance vault card for money
// roles only, and the weather slot that reads real conditions.
test.describe('job page on a desktop, redesigned', () => {
  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop layout')
    // The banner reads the weather; answer it here so no test waits on the network.
    await context.route('https://api.open-meteo.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ current: { temperature_2m: 71, weather_code: 2 } })
    }))
  })

  // A tiny PNG standing in for a signed job photo.
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')

  const SLAB_PHOTOS = [
    { id: 'f1', job_id: 'c-job1', kind: 'photo', storage_path: 'u/c-job1/f1.jpg', filename: 'f1.jpg', uploaded_at: '2026-10-10T11:50:00.000Z', caption: 'Forms and rebar in' },
    { id: 'f2', job_id: 'c-job1', kind: 'photo', storage_path: 'u/c-job1/f2.jpg', filename: 'f2.jpg', uploaded_at: '2026-10-10T11:45:00.000Z', caption: null }
  ]

  async function openDesktop(page: Page, path: string) {
    await page.clock.setFixedTime(new Date('2026-10-10T12:40:00.000Z'))
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toBeVisible({ timeout: 30_000 })
  }

  // Signed urls for the job photos bucket, and what the image behind them does.
  async function mockPhotoStorage(context: import('@playwright/test').BrowserContext, image: 'ok' | 'missing') {
    await context.route((u) => u.hostname === 'qa-mock.supabase.co', async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      if (url.pathname.endsWith('/storage/v1/object/sign/job-photos') && req.method() === 'POST') {
        const { paths = [] } = JSON.parse(req.postData() || '{}')
        const signed = paths.map((path: string) => ({ path, signedURL: `/object/sign/job-photos/${path}?token=qa`, error: null }))
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(signed) })
      }
      if (url.pathname.includes('/storage/v1/object/sign/job-photos/')) {
        return image === 'ok'
          ? route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
          : route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' })
      }
      return route.fallback()
    })
  }

  test('rail, balance and weather', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')

    await page.locator('.fh-job-lifecycle summary').click()
    const rail = page.getByRole('list', { name: 'Stage' })
    await expect(rail).toBeVisible()
    await expect(rail.locator('[aria-current="step"]')).toHaveText(/^Job/)

    const facts = page.getByRole('complementary', { name: 'Job facts' })
    await expect(facts.getByText('Contract balance', { exact: true })).toBeVisible()
    await expect(facts.getByText('$33,100.00').first()).toBeVisible()
    await expect(facts.getByText('Contract', { exact: true })).toBeVisible()
    await expect(facts.getByText('Paid', { exact: true })).toBeVisible()

    await expect(page.getByText('Weather not set')).toHaveCount(0)
    await expect(page.locator('.fh-job-workspace').getByText(/71°/)).toBeVisible()
  })

  test('the banner, the one gold action and no key cap', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    const banner = page.locator('.fh-job-workspace')

    // Job title as the heading, the client and address under it.
    await expect(banner.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(banner.getByText('Plumbing Bellevue · 412 Burkitt Station Rd')).toBeVisible()
    await expect(banner.getByRole('link', { name: 'Back to jobs' }).or(banner.getByRole('button', { name: 'Back to jobs' }))).toBeVisible()

    // Message and Add a visit are secondary; the stage action is the one gold button.
    await expect(banner.getByRole('link', { name: /^Message/ })).toHaveAttribute('href', '/compose?contact=c-job1&channel=email')
    await expect(page.locator('.fh-job-secondary-actions').getByRole('button', { name: 'Add a visit', exact: true })).toBeVisible()
    const gold = page.locator('.fhc-btn--primary')
    await expect(gold).toHaveCount(1)
    await expect(gold).toHaveText('Add update')
    // Shortcuts only fire inside the command palette, so the button draws no key cap.
    await expect(banner.locator('kbd')).toHaveCount(0)

    // More is the job's More screen at every width (D08), not a menu.
    await banner.getByRole('link', { name: 'More actions for this job' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1\/more$/)
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect(page.getByRole('link', { name: /Edit job details/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Delete job' })).toBeVisible()
  })

  test('job without photos keeps a compact visit summary', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    await page.waitForLoadState('networkidle')
    const banner = page.locator('.fh-job-workspace')
    await expect(banner.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(banner.locator('img')).toHaveCount(0)
    await expect(banner.locator('.fh-work-execution .fh-job-visit')).toBeVisible()
    await expect(banner.getByRole('heading', { name: /^Open tasks/ })).toBeVisible()
    await expect(banner.locator('.fh-work-photo')).toHaveCount(0)
  })

  test('photo signing fails', async ({ context, page }) => {
    // Rows exist but the mock's storage answers 404, so no url signs.
    await signIn(context, { tables: { fh_job_files: SLAB_PHOTOS } })
    await openDesktop(page, '/jobs/c-job1')
    const banner = page.locator('.fh-job-workspace')
    await expect(banner.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Latest from site', exact: true }).getByRole('button', { name: 'Photos', exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(banner.locator('img')).toHaveCount(0)
  })

  test('the newest photo opens the site gallery, and a failed photo is dropped', async ({ context, page }) => {
    await signIn(context, { tables: { fh_job_files: SLAB_PHOTOS } })
    await mockPhotoStorage(context, 'ok')
    await openDesktop(page, '/jobs/c-job1')
    const banner = page.locator('.fh-job-workspace')
    await expect(banner.locator('.fh-work-photo img')).toHaveCount(1)
    await expect(banner.locator('.fh-work-photo img')).toHaveAttribute('alt', 'Forms and rebar in')
    await expect(banner.getByRole('button', { name: 'Open photos: Forms and rebar in' })).toBeVisible()
    await expect(banner.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()

    // The same job, the image behind the url gone: no broken image box.
    const second = await context.newPage()
    await mockPhotoStorage(context, 'missing')
    await second.clock.setFixedTime(new Date('2026-10-10T12:40:00.000Z'))
    await second.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(second.locator('.fh-job-workspace').getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible({ timeout: 30_000 })
    await second.waitForLoadState('networkidle')
    await expect(second.locator('.fh-job-workspace img')).toHaveCount(0)
  })

  test('the composer opens Capture on this job and writes nothing', async ({ context, page }) => {
    await signIn(context)
    const writes: string[] = []
    page.on('request', (req) => {
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method()) && req.url().includes('/rest/v1/fh_')) writes.push(req.url())
    })
    await openDesktop(page, '/jobs/c-job1')
    await page.evaluate(() => {
      const w = window as unknown as { __captureDetail?: unknown }
      window.addEventListener('fh:open-capture', (e) => { w.__captureDetail = (e as CustomEvent).detail })
    })
    await page.getByRole('button', { name: 'Add update', exact: true }).click()
    expect(await page.evaluate(() => (window as unknown as { __captureDetail?: unknown }).__captureDetail)).toEqual({ jobId: 'c-job1' })
    // Capture is a screen (D57), opened on this job.
    await expect(page).toHaveURL(/\/capture\?job=c-job1$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Capture' })).toBeVisible()
    expect(writes).toEqual([])
  })

  test('desktop section destinations fit without horizontal scrolling', async ({ context, page }, testInfo) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    const nav = page.getByRole('navigation', { name: 'Job shortcuts', exact: true })
    await expect(nav.getByRole('button', { name: 'Schedule', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Job section' }).getByRole('option', { name: 'Photos', exact: true })).toHaveCount(1)
    expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    for (const button of await nav.getByRole('button').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await page.screenshot({ path: testInfo.outputPath('workspace-job.png'), fullPage: true })
  })

  test('the Spine is the first tab and every section stays one click away', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    const nav = page.getByRole('navigation', { name: 'Job shortcuts', exact: true })
    await expect(nav.getByRole('button', { name: 'Activity', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.fhj-spine').getByText('Inspector confirmed Friday.')).toBeVisible()
    for (const name of ['Milestones', 'Tasks', 'Schedule', 'Selections', 'Materials', 'Change orders', 'Daily logs', 'Contract balance', 'Invoices', 'Photos', 'Files']) {
      await expect(page.getByRole('combobox', { name: 'Job section', exact: true }).getByRole('option', { name, exact: true })).toHaveCount(1)
    }
    await page.getByRole('combobox', { name: 'Job section', exact: true }).selectOption('financials')
    await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue('financials')
    await expect(page).toHaveURL(/tab=financials/)

    // A quote is its own screen (Phase 9, D53), the same one as on a phone,
    // and its lines open first.
    await page.goto('/quotes/q-quote', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('.fhqt-page')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Parking lot repour' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add a line' })).toBeVisible()
  })

  // dead-ends-10: an invoice in the facts panel's Documents opens that
  // invoice, from the Contract balance tab as from anywhere else.
  test('an invoice in Documents opens the invoice', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job2?tab=financials')
    const invoice = page.getByRole('complementary', { name: 'Job facts' }).getByRole('link', { name: /^Invoice 2, Progress draw 1/ })
    await expect(invoice).toHaveAttribute('href', '/invoices/inv1')
    await invoice.click()
    await expect(page).toHaveURL(/\/invoices\/inv1$/)
  })

  test('deep links and the action cue keep working', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1?tab=files')
    await expect(page.getByRole('region', { name: 'Photos workspace', exact: true })).toBeVisible()
    await openDesktop(page, '/jobs/c-job1?tab=financials&action=send_invoice')
    const cue = page.getByRole('region', { name: 'Dashboard action cue' })
    await expect(cue).toBeVisible()
  })

  // OPS-19: with the whole contract invoiced and money still owed, the
  // stage action is Mark complete, not a new invoice with nothing to bill.
  test('with everything invoiced the main action is Mark complete', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job2')
    const actions = page.locator('.fh-job-secondary-actions')
    const complete = actions.getByRole('button', { name: 'Mark complete', exact: true })
    await expect(complete).toBeVisible()
    await expect(actions.getByRole('button', { name: 'Invoice this', exact: true })).toHaveCount(0)
    await complete.click()
    await expect(page).toHaveURL(/\/jobs\/c-job2\/complete$/)
  })

  test('Invoice this opens the new invoice screen with the balance', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    await page.locator('.fh-job-workspace').getByRole('button', { name: 'Invoice this' }).click()
    await expect(page).toHaveURL(/\/invoices\/new\?job=c-job1$/)
    await expect(page.getByRole('heading', { level: 1, name: 'New invoice' })).toBeVisible()
    await expect(page.getByLabel('Amount')).toHaveValue('33100')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('the job page opens no dialog for payment, event, partner, complete or invoice', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    const banner = page.locator('.fh-job-workspace')
    await page.locator('.fh-job-secondary-actions').getByRole('button', { name: 'Add a visit', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule\/new\?job=c-job1$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.goBack()
    await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toBeVisible({ timeout: 30_000 })
    const steps: [string, RegExp][] = [
      ['Log payment', /\/jobs\/c-job1\/payment$/],
      ['Invite partner', /\/jobs\/c-job1\/partner$/],
      ['Mark complete', /\/jobs\/c-job1\/complete$/]
    ]
    for (const [name, url] of steps) {
      await openMoreAboutJob(page)
      await page.locator('#fhj-more-body').getByRole('button', { name, exact: true }).click()
      await expect(page).toHaveURL(url)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.goBack()
      await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toBeVisible({ timeout: 30_000 })
    }
    await page.locator('.fh-job-secondary-actions').getByRole('button', { name: 'Invoice this', exact: true }).click()
    await expect(page).toHaveURL(/\/invoices\/new\?job=c-job1$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Delete asks with a second tap, not a sheet', async ({ context, page }) => {
    await signIn(context)
    const deletes: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/rest/v1/fh_contacts')) deletes.push(req.url())
    })
    await openDesktop(page, '/jobs/c-job1')
    const banner = page.locator('.fh-job-workspace')
    await banner.getByRole('link', { name: 'More actions for this job' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1\/more$/)
    await page.getByRole('button', { name: 'Delete job' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const again = page.getByRole('button', { name: 'Tap again to delete' })
    await expect(again).toBeVisible()
    expect(deletes).toEqual([])
    await page.waitForTimeout(600) // a second tap within 500 ms is ignored (OPS-02)
    await again.click()
    await expect.poll(() => deletes.length).toBe(1)
    expect(deletes[0]).toMatch(/id=eq\.c-job1/)
    // The job is gone, so the page leaves it for the jobs list.
    await expect(page).toHaveURL(/\/(jobs|work)\b/)
    await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toHaveCount(0)
  })

  test('rail notes from the job', async ({ context, page }) => {
    const job = {
      id: 'c-job1', stage: 'job', name: 'Whitcomb', job_title: 'Garage slab', amount: 12375, source: 'website',
      user_id: 'qa-user-1', client_id: null, phone: '615 555 0148', email: 'd@w.com', address: '2210 Ridgecrest Dr',
      created_at: '2026-09-23T15:00:00.000Z', updated_at: '2026-10-09T15:00:00.000Z', completed_at: null,
      proposal_status: 'approved', milestones: [], follow_up_on: null, notes: null, scope_text: null
    }
    await signIn(context, {
      tables: {
        fh_contacts: [job],
        fh_clients: [],
        fh_payments: [{ id: 'p1', user_id: 'qa-user-1', contact_id: 'c-job1', amount: 6187.5, method: 'check', reference: '1', paid_on: '2026-09-30', created_at: '2026-09-30T15:00:00.000Z' }],
        fh_stage_transitions: [{ id: 't1', contact_id: 'c-job1', from_stage: 'quote', to_stage: 'job', transitioned_at: '2026-09-28T15:00:00.000Z', transitioned_by: null, user_id: 'qa-user-1' }],
        fh_schedule: [
          { id: 's1', user_id: 'qa-user-1', contact_id: 'c-job1', title: 'Pour slab', description: null, start_at: '2026-10-10T12:30:00.000Z', end_at: '2026-10-10T16:30:00.000Z', created_at: '2026-10-01T15:00:00.000Z' },
          { id: 's2', user_id: 'qa-user-1', contact_id: 'c-job1', title: 'Inspection', description: null, start_at: '2026-10-16T14:00:00.000Z', end_at: '2026-10-16T15:00:00.000Z', created_at: '2026-10-01T15:00:00.000Z' }
        ]
      }
    })
    await openDesktop(page, '/jobs/c-job1')
    await page.locator('.fh-job-lifecycle summary').click()
    const rail = page.getByRole('list', { name: 'Stage' })
    await expect(rail.getByText('Sep 23, website')).toBeVisible()
    await expect(rail.getByText('Approved Sep 28')).toBeVisible()
    await expect(rail.getByText('Pour slab today, Inspection Fri')).toBeVisible()
    await expect(rail.getByText('$6,187.50 contract balance')).toBeVisible()
    const facts = page.getByRole('complementary', { name: 'Job facts' })
    await expect(facts.getByText('$6,187.50').first()).toBeVisible()
    await expect(facts.getByText('$12,375.00')).toBeVisible()
  })

  test('a lost job shows the Lost chip and offers Reopen', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-lost')
    await page.locator('.fh-job-lifecycle summary').click()
    await expect(page.locator('.fhc-rail').getByText('Lost', { exact: true })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Stage' }).locator('[aria-current="step"]')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toBeVisible()
  })

  test('crew see no money and no gold action', async ({ context, page }) => {
    await signIn(context, { role: 'crew' })
    await openDesktop(page, '/jobs/c-job1')
    await expect(page.locator('.fh-job-workspace').getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await page.locator('.fh-job-lifecycle summary').click()
    await expect(page.getByRole('list', { name: 'Stage' })).toBeVisible()
    await expect(page.getByText('Contract balance')).toHaveCount(0)
    await expect(page.getByText('Contract', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Margin', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/\$33,100/)).toHaveCount(0)
    await expect(page.getByText(/balance/i)).toHaveCount(0)
    await expect(page.locator('.fhc-btn--primary')).toHaveText('Add update')
    await expect(page.getByRole('button', { name: 'Invoice this', exact: true })).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: 'Job facts' })).toBeVisible()
  })
})

// dead-ends-4: Message on a job opens Compose, whose Back returns to that
// job. Opened straight from a link, with nothing to go back to, Back still
// lands on the job it writes to.
test('Compose opened from a job has a Back to the job', async ({ context, page }) => {
  await signIn(context)
  await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.getByRole('link', { name: /^Message/ }).first().click()
  await expect(page).toHaveURL(/\/compose\?contact=c-job1/, { timeout: 30_000 })
  const back = page.locator('#fh-main').getByRole('button', { name: 'Back', exact: true })
  await back.click()
  await expect(page).toHaveURL(/\/jobs\/c-job1$/)

  await page.goto('/compose?contact=c-job1&channel=email', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await back.click()
  await expect(page).toHaveURL(/\/jobs\/c-job1$/)
})

// M-20 and OPS-08: Log payment keeps cents on the balance, the button and
// the one toast it shows.
test('Log payment shows cents and one toast', async ({ context, page }) => {
  const job = {
    id: 'c-cents', stage: 'job', name: 'Whitcomb', job_title: 'Garage slab', amount: 10000,
    user_id: 'qa-user-1', client_id: null, phone: '615 555 0148', email: 'd@w.com', address: '2210 Ridgecrest Dr',
    created_at: '2026-09-23T15:00:00.000Z', updated_at: '2026-10-09T15:00:00.000Z', completed_at: null,
    proposal_status: 'approved', milestones: [], follow_up_on: null, notes: null, scope_text: null
  }
  await signIn(context, {
    tables: {
      fh_contacts: [job], fh_clients: [], fh_invoices: [], fh_change_orders: [],
      fh_payments: [{ id: 'p1', user_id: 'qa-user-1', contact_id: 'c-cents', amount: 5000.5, method: 'check', reference: '1', paid_on: '2026-09-30', created_at: '2026-09-30T15:00:00.000Z' }]
    }
  })
  await page.goto('/jobs/c-cents/payment', { waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Balance $4,999.50')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Record $4,999.50' })).toBeVisible()
  const amount = page.getByLabel('Amount')
  await amount.fill('1234.50')
  const record = page.getByRole('button', { name: 'Record $1,234.50' })
  await expect(record).toBeVisible()
  await record.click()
  await expect(page.getByText(/\$1,234\.50/).first()).toBeVisible()
  await expect(page.getByText(/\$1,235\b/)).toHaveCount(0)
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: /payment/i })).toHaveCount(1)
})

// raw-errors-4: a gateway's 502 page showed as HTML twice, on the line and
// in a toast, and a refusal showed the constraint's name.
test('a failed payment on the job says what to do once, in plain words', async ({ context, page }) => {
  await signIn(context)
  let answer: 'gateway' | 'refuse' = 'gateway'
  await context.route((url) => url.pathname === '/rest/v1/fh_payments', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    return route.fulfill(answer === 'gateway' ? FAIL.gateway() : FAIL.check('fh_payments', 'fh_payments_kind_check'))
  })
  await page.goto('/jobs/c-job2/payment', { waitUntil: 'domcontentloaded' })
  const amount = page.getByLabel('Amount')
  await expect(amount).toBeVisible({ timeout: 30_000 })
  await amount.fill('500')
  await page.getByRole('button', { name: /^Record/ }).click()
  await expectPlain(page.locator('.fhnew-error'), 'The payment was not recorded. Something went wrong on our side. Try again in a minute.')
  await expect(page.locator('[data-sonner-toast]').filter({ hasText: "Couldn't record payment" })).toHaveCount(0)
  answer = 'refuse'
  await page.getByRole('button', { name: /^Record/ }).click()
  await expectPlain(page.locator('.fhnew-error'), 'The payment was not recorded. Check the amount and kind, then try again.')
  await expect(amount).toHaveValue('500')
})

// raw-errors-6: Delete job on no signal said "TypeError: Failed to fetch".
test('Delete job on no signal says so in plain words and keeps the job', async ({ context, page }) => {
  await signIn(context)
  await context.route((url) => url.pathname === '/rest/v1/fh_contacts', (route) => route.request().method() === 'DELETE' ? route.abort('failed') : route.fallback())
  await page.goto('/jobs/c-job1/more', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'Delete job' }).click()
  await page.waitForTimeout(600)
  await page.getByRole('button', { name: 'Tap again to delete' }).click()
  await expectPlain(page.locator('[data-sonner-toaster]'), 'No signal right now. Try again when the signal is back.')
  await expect(page).toHaveURL(/\/jobs\/c-job1\/more$/)
})

// M-15: the job page measures margin and health against the contract
// with its approved change orders.
test('margin and health count an approved change order', async ({ context, page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'the money strip is the phone layout')
  const job = {
    id: 'c-co', stage: 'job', name: 'Whitcomb', job_title: 'Garage slab', amount: 10000, cost: 12000,
    user_id: 'qa-user-1', client_id: null, phone: '615 555 0148', email: 'd@w.com', address: '2210 Ridgecrest Dr',
    created_at: '2026-09-23T15:00:00.000Z', updated_at: '2026-10-09T15:00:00.000Z', completed_at: null,
    proposal_status: 'approved', milestones: [], follow_up_on: null, notes: null, scope_text: null
  }
  await signIn(context, {
    tables: {
      fh_contacts: [job], fh_clients: [], fh_invoices: [], fh_schedule: [],
      fh_change_orders: [{ id: 'co1', user_id: 'qa-user-1', contact_id: 'c-co', sequence_number: 1, title: 'Extra footing', amount: 5000, status: 'approved', created_at: '2026-10-01T15:00:00.000Z' }],
      fh_payments: [{ id: 'p1', user_id: 'qa-user-1', contact_id: 'c-co', amount: 12000, method: 'check', reference: '1', paid_on: '2026-09-30', created_at: '2026-09-30T15:00:00.000Z' }]
    }
  })
  await open(page, '/jobs/c-co')
  await openMoreAboutJob(page)
  await expect(page.getByText('80% collected').filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
  // The margin chip sits in the header strip, which this layout keeps in
  // the page but out of view.
  await expect(page.getByText('20.0% margin').first()).toBeAttached()
  await expect(page.getByText('20.0% loss')).toHaveCount(0)
  await expect(page.getByText('Overpaid')).toHaveCount(0)
})

// PERF-09: the job screen read its to-dos twice (the job's bundle and the
// to-do section) and its photos twice (the header and the photo section).
// One read each now feeds every part of the screen that shows them.
test('a job page reads its to-dos and photos once each', async ({ context, page }, testInfo) => {
  // The desktop job screen is its own build (SnowJobDetailBuild).
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone layout')
  await signIn(context)
  const reads: string[] = []
  page.on('request', request => {
    if (request.method() !== 'GET') return
    const url = new URL(request.url())
    const table = url.pathname.split('/rest/v1/')[1]
    if (table === 'fh_job_todos') reads.push('todos')
    if (table === 'fh_job_files' && url.searchParams.get('kind') === 'eq.photo') reads.push('photos')
  })
  await open(page, '/jobs/c-job1')
  await page.waitForLoadState('networkidle')
  expect(reads.filter(read => read === 'todos')).toHaveLength(1)
  expect(reads.filter(read => read === 'photos')).toHaveLength(1)
})

// A job opened straight on its Tasks, Contract balance or Invoices tab (a
// link or a reload) read the same rows twice: the tab's own read came on
// top of the job's (vibe audit console-2). One read each now feeds both.
test.describe('a job opened on a tab reads each table once', () => {
  async function countReads(page: Page, path: string) {
    const reads: Record<string, number> = {}
    page.on('request', (request) => {
      if (request.method() !== 'GET') return
      const url = new URL(request.url())
      const table = url.pathname.split('/rest/v1/')[1]
      if (!table || (url.searchParams.get('contact_id') ?? url.searchParams.get('job_id')) !== 'eq.c-job1') return
      // Whole rows only: the desktop job panel's short list of invoice
      // numbers and dates is a read of its own.
      if (url.searchParams.get('select') !== '*') return
      reads[table] = (reads[table] ?? 0) + 1
    })
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForLoadState('networkidle')
    return reads
  }

  test('Tasks', async ({ context, page }) => {
    await signIn(context)
    const reads = await countReads(page, '/jobs/c-job1?tab=tasks')
    expect(reads.fh_job_todos).toBe(1)
  })

  test('Contract balance', async ({ context, page }) => {
    await signIn(context)
    const reads = await countReads(page, '/jobs/c-job1?tab=financials')
    expect({ payments: reads.fh_payments, insurance: reads.fh_insurance_claims, changeOrders: reads.fh_change_orders, invoices: reads.fh_invoices })
      .toEqual({ payments: 1, insurance: 1, changeOrders: 1, invoices: 1 })
  })

  test('Invoices', async ({ context, page }) => {
    await signIn(context)
    const reads = await countReads(page, '/jobs/c-job1?tab=draws')
    expect(reads.fh_invoices).toBe(1)
  })
})

// Mark complete writes the closeout record and moves the job to Closed.
// Before this test nothing submitted the screen.
test('Mark complete saves the closeout and closes the job', async ({ context, page }) => {
  await signIn(context)
  const writes: { method: string; url: string; body: any }[] = []
  page.on('request', (req) => {
    if (req.method() !== 'GET' && req.url().includes('/rest/v1/')) writes.push({ method: req.method(), url: req.url(), body: req.postDataJSON() })
  })
  await page.goto('/jobs/c-job1/complete', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByText('Mark this job complete', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  const save = page.getByRole('button', { name: 'Mark complete', exact: true })
  await expect(save).toBeEnabled()
  await save.click()

  await expect.poll(() => writes.some((w) => w.method === 'PATCH' && w.url.includes('/fh_contacts'))).toBe(true)
  const closeout = writes.find((w) => w.method === 'POST' && w.url.includes('/fh_closeouts'))
  expect(closeout?.url).toContain('on_conflict=contact_id')
  expect(closeout?.body).toMatchObject({ user_id: 'qa-user-1', contact_id: 'c-job1', signoff_method: 'verbal', warranty_months: 12, final_amount: 33100 })
  const stage = writes.find((w) => w.method === 'PATCH' && w.url.includes('/fh_contacts'))
  expect(stage?.url).toContain('id=eq.c-job1')
  expect(stage?.body).toEqual({ stage: 'closed' })
})

// A11Y-06: the keyboard focus ring on the dark visit card's View schedule
// can be seen (3 to 1 against the card), by day and at night.
for (const mode of ['day', 'night'] as const) {
  test(`the focus ring on the visit card can be seen in ${mode} mode`, async ({ context, page }) => {
    await signIn(context, { mode })
    await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const view = page.locator('.fh-job-visit').getByRole('button', { name: /^(View schedule|Schedule a visit)$/ }).first()
    await expect(view).toBeVisible({ timeout: 30_000 })
    await view.focus()
    await expect(view).toBeFocused()
    expect(await view.evaluate(element => element.matches(':focus-visible'))).toBe(true)
    await expect.poll(() => contrastOf(view, 'outline')).toBeGreaterThanOrEqual(3)
  })
}

// A11Y-13: one name, one action: on the desktop job page the Schedule tab
// and the button that adds a visit no longer share the name "Schedule".
test('the desktop job page has one control named Schedule', async ({ context, page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop job page')
  await signIn(context)
  await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Add a visit', exact: true })).toBeVisible()
  // In the screen: the header's Schedule link goes to the Schedule screen.
  const named = page.locator('#fh-main').locator('button, [role="tab"], a').filter({ hasText: /^Schedule$/ })
  await expect(named).toHaveCount(1)
})

// M-20: the Overview's contract card keeps cents on what was collected
// and what remains, as Log payment does.
test('the contract card shows cents', async ({ context, page }) => {
  const job = {
    id: 'c-card', stage: 'job', name: 'Whitcomb', job_title: 'Garage slab', amount: 10000,
    user_id: 'qa-user-1', client_id: null, phone: '615 555 0148', email: 'd@w.com', address: '2210 Ridgecrest Dr',
    created_at: '2026-09-23T15:00:00.000Z', updated_at: '2026-10-09T15:00:00.000Z', completed_at: null,
    proposal_status: 'approved', milestones: [], follow_up_on: null, notes: null, scope_text: null
  }
  await signIn(context, {
    tables: {
      fh_contacts: [job], fh_clients: [], fh_invoices: [], fh_schedule: [], fh_change_orders: [],
      fh_payments: [{ id: 'p1', user_id: 'qa-user-1', contact_id: 'c-card', amount: 5000.5, method: 'check', reference: '1', paid_on: '2026-09-30', created_at: '2026-09-30T15:00:00.000Z' }]
    }
  })
  // The phone page and the desktop build both carry the Overview.
  await page.goto('/jobs/c-card', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByRole('button', { name: 'More about this job' })).toBeVisible({ timeout: 30_000 })
  await openMoreAboutJob(page)
  const card = page.locator('.cockpit-headline')
  await expect(card).toBeVisible({ timeout: 30_000 })
  await expect(card.locator('.cockpit-headline__amt')).toHaveText('$10,000.00')
  await expect(card.locator('.cockpit-headline__bar-meta')).toContainText('$5,000.50 collected')
  await expect(card.locator('.cockpit-headline__bar-meta')).toContainText('$4,999.50 remaining')
})

// A double tap while the write is still out wrote twice: two lines for one
// material, the bulk list twice, two inspection results for one visit. Each
// add or save now takes no second tap until the first settles.
test.describe('one tap writes once on the job sections', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'touch taps')
  })

  test('Add material sends one row', async ({ context, page }) => {
    await signIn(context, { tables: { fh_materials: [] } })
    const posts = postsTo(context, '/rest/v1/fh_materials')
    await holdPosts(context, '**/rest/v1/fh_materials*', 1500, () => ({ status: 201, json: [] }))
    await page.goto('/jobs/c-job1?tab=materials', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const name = page.getByLabel('Material name')
    await expect(name).toBeVisible({ timeout: 30_000 })
    await name.fill('2x4 studs')
    await twoTaps(page, page.getByRole('button', { name: 'Add material' }))
    await expect(page.getByText('Added', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(500)
    expect(posts.length, 'one tap, one material').toBe(1)
  })

  test('Bulk add sends the list once', async ({ context, page }) => {
    await signIn(context, { tables: { fh_materials: [] } })
    const posts = postsTo(context, '/rest/v1/fh_materials')
    await holdPosts(context, '**/rest/v1/fh_materials*', 1500, () => ({ status: 201, json: [] }))
    await page.goto('/jobs/c-job1?tab=materials', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const bulk = page.getByRole('button', { name: /Bulk add/ })
    await expect(bulk).toBeVisible({ timeout: 30_000 })
    await bulk.click()
    await page.getByLabel('Materials to add, one per line').fill('4 of 2x4 studs\n1 box of #10 screws\nDrywall mud (3)')
    await twoTaps(page, page.getByRole('button', { name: 'Add 3', exact: true }))
    await expect(page.getByText('Added 3 items', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(500)
    expect(posts.length, 'one tap, one bulk insert').toBe(1)
  })

  test('Pull from notes adds the picked materials once', async ({ context, page }) => {
    const note = { id: 'n-mat', user_id: 'qa-user-1', contact_id: 'c-job1', text: 'Need studs', category: 'note', created_at: '2026-11-10T15:00:00.000Z', parsed: { materials_needed: ['4 of 2x4 studs', 'Drywall mud (3)'] } }
    await signIn(context, { tables: { fh_materials: [], fh_notes: [note] } })
    const posts = postsTo(context, '/rest/v1/fh_materials')
    await holdPosts(context, '**/rest/v1/fh_materials*', 1500, () => ({ status: 201, json: [] }))
    await page.goto('/jobs/c-job1?tab=materials', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const pull = page.getByRole('button', { name: /Pull from notes/ })
    await expect(pull).toBeVisible({ timeout: 30_000 })
    await pull.click()
    const add = page.getByRole('button', { name: 'Add 2', exact: true })
    await expect(add).toBeEnabled({ timeout: 10_000 })
    await twoTaps(page, add)
    await expect(page.getByText('Added 2', { exact: true }).first()).toBeVisible({ timeout: 10_000 })
    await page.waitForTimeout(500)
    expect(posts.length, 'one tap, one insert').toBe(1)
  })

  test('Save on an inspection logs one result', async ({ context, page }) => {
    const job = {
      id: 'c-job1', stage: 'job', name: 'Plumbing Bellevue', job_title: 'Slab + trench', amount: 33100,
      user_id: 'qa-user-1', client_id: null, phone: '555-0101', email: 'x@y.com', address: '412 Burkitt Station Rd',
      created_at: '2026-09-20T15:00:00.000Z', updated_at: '2026-10-09T15:00:00.000Z', completed_at: null,
      proposal_status: null, milestones: [], follow_up_on: null, notes: null, scope_text: null, has_inspections: true
    }
    await signIn(context, { tables: { fh_contacts: [job], fh_inspections: [] } })
    const posts = postsTo(context, '/rest/v1/fh_inspections')
    await holdPosts(context, '**/rest/v1/fh_inspections*', 1500, () => ({ status: 201, json: [] }))
    await page.goto('/jobs/c-job1?tab=inspections', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const trade = page.getByRole('button', { name: /^Concrete/ }).first()
    await expect(trade).toBeVisible({ timeout: 30_000 })
    await trade.click()
    const form = page.locator('form[aria-label="Log Concrete"]')
    await expect(form).toBeVisible()
    await twoTaps(page, form.getByRole('button', { name: 'Save' }))
    await expect(form).toHaveCount(0, { timeout: 10_000 })
    await page.waitForTimeout(500)
    expect(posts.length, 'one tap, one inspection').toBe(1)
  })
})

// Send certificate kept its busy state on the closeout screen. Leave it
// while the email is still going out and come back, and the button was
// free again: one more tap emailed the completion certificate twice. The
// send is now kept app wide, so the certificate is busy until it lands.
test('leaving the closeout while the certificate emails and coming back does not email it twice', async ({ context, page }) => {
  const closeout = {
    id: 'co1', user_id: 'qa-user-1', contact_id: 'c-done', warranty_start_date: '2026-09-20', warranty_months: 12,
    signoff_method: 'verbal', signoff_name: 'Danielle Ortiz', notes: 'Walkthrough done.', final_amount: 9600, created_at: '2026-10-28T15:00:00.000Z'
  }
  await signIn(context, { tables: { fh_closeouts: [closeout] } })
  await context.route('**/storage/v1/object/**', (route) => route.fulfill({ status: 200, json: { Key: 'job-files/certificate.pdf' } }))
  const sends = postsTo(context, '/api/send-certificate')
  await holdPosts(context, '**/api/send-certificate', 6000, () => ({ status: 200, json: { ok: true } }))
  await page.goto('/jobs/c-done/complete', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const send = page.getByRole('button', { name: 'Send certificate' })
  await expect(send).toBeEnabled({ timeout: 30_000 })
  await send.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  await goInApp(page, '/jobs/c-done')
  await page.waitForTimeout(800)
  await goInApp(page, '/jobs/c-done/complete')
  const again = page.getByRole('button', { name: 'Send certificate' })
  await expect(again).toBeVisible({ timeout: 30_000 })
  // Once the screen has read what it needs, the button takes a tap or says it is busy.
  await expect.poll(async () => await again.isEnabled() || await again.getAttribute('aria-busy') === 'true', { timeout: 30_000 }).toBe(true)
  const busy = await again.getAttribute('aria-busy')
  await again.click({ force: true })
  await page.waitForTimeout(1500)
  expect(sends.length, 'one certificate, one email').toBe(1)
  expect(busy, 'Send certificate shows the email going out').toBe('true')
})

// formats-6: a whole amount prints .00 on the job the way the invoice page
// and the PDF print it, so $6,400 never sits next to $6,400.00.
test('whole amounts keep .00 on Log payment and the Invoices tab', async ({ context, page }) => {
  await signIn(context)
  await page.goto('/jobs/c-job2/payment', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByText('Balance $6,400.00')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByRole('button', { name: 'Record $6,400.00' })).toBeVisible()
  await page.goto('/jobs/c-job2?tab=draws', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByText(/Unbilled/).first()).toBeVisible({ timeout: 30_000 })
  const text = await page.locator('main').innerText()
  expect(text).toContain('$6,400.00')
  expect(text).not.toMatch(/\$[\d,]+(?![\d,]*\.\d\d)\b/)
})

// formats-9: an expense date reads like every other date on the job
// ("Nov 12, 2026"), never as raw "2026-11-12".
test('the Expenses tab prints the expense date as a date', async ({ context, page }) => {
  await signIn(context, { tables: { ...FORMATS_TABLES, fh_expenses: [{ id: 'e-h1', user_id: 'qa-user-1', org_id: 'org-1', contact_id: 'c-h', description: 'Rebar and chairs', amount: 412.38, category: 'Materials', expense_date: '2026-11-12', created_at: '2026-11-12T18:00:00Z' }] } })
  await page.clock.setFixedTime(FORMATS_NOW)
  await page.goto('/jobs/c-h?tab=expenses', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByText('Rebar and chairs')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('Materials · Nov 12, 2026')).toBeVisible()
  await expect(page.getByText(/2026-11-12/)).toHaveCount(0)
})

// formats-12: the job's spine writes a time with its am or pm, so a payment
// logged at 8:15 pm never reads as "8:15" beside a morning visit.
test('the job spine writes an evening payment as 8:15 pm', async ({ context, page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone layout')
  await signIn(context, { tables: FORMATS_TABLES })
  await page.clock.setFixedTime(FORMATS_NOW)
  await open(page, '/jobs/c-h')
  const spine = page.locator('.fhj-spine')
  await expect(spine.getByText('8:15 pm', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
  await expect(spine.getByText('8:15', { exact: true })).toHaveCount(0)
})

// formats-4: a sub's rate and the insurance claim's figures print to the
// cent on the job, the way SubDetail and the customer document print them,
// and the wide desktop job rail names each job's amount in full.
test('the job prints sub rates, insurance figures and the rail amount to the cent', async ({ context, page }, testInfo) => {
  await signIn(context, { tables: {
    ...FORMATS_TABLES,
    fh_subs: [{ id: 'sub-h1', user_id: 'qa-user-1', org_id: 'org-1', contact_id: 'c-h', name: 'Tri-Star Pumping', trade: 'Pump truck', phone: null, rate: 42.5, status: 'scheduled', created_at: '2026-11-10T12:00:00Z' }],
    fh_insurance_claims: [{ id: 'ins-h1', user_id: 'qa-user-1', org_id: 'org-1', contact_id: 'c-h', claim_number: 'CL-1', carrier: 'State Farm', adjuster: null, deductible: 1000.5, rcv: 24800, acv: 18200.25, depreciation: 6599.75, supplement_amount: null, mortgage_company: null, created_at: '2026-11-10T12:00:00Z' }]
  } })
  await page.clock.setFixedTime(FORMATS_NOW)
  await page.goto('/jobs/c-h?tab=subs', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByText('Tri-Star Pumping').filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('$42.50', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText('$43', { exact: true })).toHaveCount(0)
  await page.goto('/jobs/c-h?tab=insurance', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByText('$1,000.50', { exact: true }).filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('$24,800.00', { exact: true }).filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByText('$1,001', { exact: true })).toHaveCount(0)
  if (testInfo.project.name.startsWith('desktop')) {
    await page.setViewportSize({ width: 1720, height: 1000 })
    const rail = page.locator('.fh-detail-rail')
    await expect(rail.getByText('$12,345.50', { exact: true })).toBeVisible({ timeout: 30_000 })
    await expect(rail.getByText(/\$\d+(\.\d)?K\b/)).toHaveCount(0)
  }
})

// formats-12: the job's own Schedule tab writes the visit time as 7:00 am,
// the way the spine and Today write it, never "7:00 AM".
test('the job Schedule tab writes the visit time as 7:00 am', async ({ context, page }) => {
  await signIn(context, { tables: FORMATS_TABLES })
  await page.clock.setFixedTime(FORMATS_NOW)
  await page.goto('/jobs/c-h?tab=schedule', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByText('Pour driveway').filter({ visible: true }).first()).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(/7:00 am/).filter({ visible: true }).first()).toBeVisible()
  await expect(page.locator('main').getByText(/\d:\d\d\s?(AM|PM)\b/)).toHaveCount(0)
})

// Finding lost-work-2: a half written daily log or job note is not lost to
// a reload or a tap on another section.
const TYPED = 'Saw cut joints at 10 ft, broom finish, no curing compound'
const jobSections = (page: Page) => page.getByRole('combobox', { name: 'Job section', exact: true })
async function openJob(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(jobSections(page)).toBeVisible({ timeout: 30_000 })
}

test.describe('typed words in the job sections', () => {
  const WORDS = TYPED
  const sections = jobSections

  test('a half written daily log survives a tap on another section and a reload', async ({ context, page }) => {
    await signIn(context)
    await openJob(page, '/jobs/c-job1?tab=logs')
    await page.getByRole('button', { name: '+ New log' }).click()
    await page.getByLabel('Site summary').fill(WORDS)
    await page.getByLabel('Crew on site (optional)').fill('4')
    await sections(page).selectOption('tasks')
    await expect(page.getByLabel('Site summary')).toHaveCount(0)
    await sections(page).selectOption('logs')
    await expect(page.getByLabel('Site summary')).toHaveValue(WORDS)
    await expect(page.getByLabel('Crew on site (optional)')).toHaveValue('4')
    await page.reload()
    await expect(page.getByLabel('Site summary')).toHaveValue(WORDS)
    await expect(page.getByText('Unsaved changes restored')).toBeVisible()
    // Cancel throws the draft away for good.
    await page.getByRole('button', { name: 'Cancel', exact: true }).click()
    await page.reload()
    await expect(page.getByRole('button', { name: '+ New log' })).toBeVisible()
    await expect(page.getByLabel('Site summary')).toHaveCount(0)
  })

  // Review of lost-work-2: an edit to a saved log is kept against that log,
  // and only once something in it changed.
  const SAVED_LOG = {
    id: 'log-saved-1', user_id: 'qa-user-1', contact_id: 'c-job1', log_date: '2026-10-09', summary: 'Formed and set rebar',
    next_steps: null, weather_text: null, crew_count: 3, hours_worked: null, photos: [], created_at: '2026-10-09T15:00:00.000Z'
  }

  test('opening a saved daily log to edit it keeps nothing until something changes', async ({ context, page }) => {
    await signIn(context, { tables: { fh_daily_logs: [SAVED_LOG] } })
    await openJob(page, '/jobs/c-job1?tab=logs')
    await page.getByRole('button', { name: 'Edit log' }).click()
    await expect(page.getByLabel('Site summary')).toHaveValue(SAVED_LOG.summary)
    await page.waitForTimeout(600)
    await page.reload()
    await expect(page.getByRole('button', { name: '+ New log' })).toBeVisible()
    await expect(page.getByLabel('Site summary')).toHaveCount(0)
    await expect(page.getByText('Unsaved changes restored')).toHaveCount(0)
  })

  test('an edit to a saved daily log comes back after a reload and saves to that log', async ({ context, page }) => {
    await signIn(context, { tables: { fh_daily_logs: [SAVED_LOG] } })
    await openJob(page, '/jobs/c-job1?tab=logs')
    await page.getByRole('button', { name: 'Edit log' }).click()
    await page.getByLabel('Site summary').fill(WORDS)
    await page.reload()
    await expect(page.getByLabel('Site summary')).toHaveValue(WORDS)
    await expect(page.getByText('Unsaved changes restored')).toBeVisible()
    const writes: string[] = []
    page.on('request', (request) => { if (/\/rest\/v1\/fh_daily_logs/.test(request.url()) && request.method() !== 'GET') writes.push(request.method()) })
    await page.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByLabel('Site summary')).toHaveCount(0)
    expect(writes).toEqual(['PATCH'])
  })

  test('an edit to a daily log saved differently since is dropped', async ({ context, page }) => {
    await signIn(context, { tables: { fh_daily_logs: [SAVED_LOG] } })
    await context.addInitScript(() => {
      if (localStorage.getItem('e2e:stale-log')) return
      localStorage.setItem('e2e:stale-log', '1')
      const base = { summary: 'An older summary', nextSteps: '', weatherText: '', crewCount: '3', hoursWorked: '', photos: [] }
      localStorage.setItem('fh:draft:edit:job-log:log-saved-1', JSON.stringify({ form: { summary: 'Edit made before the log changed' }, base, savedAt: Date.now(), userId: 'qa-user-1' }))
    })
    await openJob(page, '/jobs/c-job1?tab=logs')
    await expect(page.getByText(SAVED_LOG.summary)).toBeVisible()
    await expect(page.getByLabel('Site summary')).toHaveCount(0)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('fh:draft:edit:job-log:log-saved-1'))).toBeNull()
    await page.getByRole('button', { name: 'Edit log' }).click()
    await expect(page.getByLabel('Site summary')).toHaveValue(SAVED_LOG.summary)
    await expect(page.getByText('Unsaved changes restored')).toHaveCount(0)
  })

  test('a half written job note survives a tap on another section and a reload', async ({ context, page }) => {
    await signIn(context)
    await openJob(page, '/jobs/c-job1?tab=messages')
    const box = page.getByPlaceholder('Log a note, call, touchpoint…')
    await box.fill(WORDS)
    await sections(page).selectOption('tasks')
    await expect(box).toHaveCount(0)
    await sections(page).selectOption('messages')
    await expect(box).toHaveValue(WORDS)
    await page.reload()
    await expect(page.getByPlaceholder('Log a note, call, touchpoint…')).toHaveValue(WORDS)
  })
})

// Finding lost-work-6: Edit job details keeps its edits through a stray
// tap on another section and a reload.
test.describe('typed words in edit job details', () => {
  const WORDS = TYPED
  const sections = jobSections

  test('edit job details keeps its edits through a tap on another section and a reload', async ({ context, page }) => {
    await signIn(context)
    await openJob(page, '/jobs/c-job1?edit=1')
    const form = page.getByRole('form', { name: 'Edit job details' })
    await form.getByLabel('Scope notes').fill(WORDS)
    await sections(page).selectOption('tasks')
    await sections(page).selectOption('overview')
    await expect(page.getByRole('form', { name: 'Edit job details' }).getByLabel('Scope notes')).toHaveValue(WORDS)
    await page.reload()
    await expect(page.getByRole('form', { name: 'Edit job details' }).getByLabel('Scope notes')).toHaveValue(WORDS)
    await expect(page.getByText('Unsaved changes restored')).toBeVisible()
    // Cancel closes the edit and forgets it.
    await page.getByRole('form', { name: 'Edit job details' }).getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(page.getByRole('form', { name: 'Edit job details' })).toHaveCount(0)
    await page.reload()
    await expect(sections(page)).toBeVisible()
    await expect(page.getByRole('form', { name: 'Edit job details' })).toHaveCount(0)
  })
})

// Finding lost-work-8: a milestone the server refuses stays in the box.
/** Answers one table's writes with a server refusal. */
async function refuseWrites(context: import('@playwright/test').BrowserContext, table: string) {
  const hits = { count: 0 }
  await context.route((url) => url.pathname === `/rest/v1/${table}`, (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    hits.count += 1
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: '57014', message: 'canceling statement due to statement timeout', details: null, hint: null }) })
  })
  return hits
}

test.describe('a milestone that fails to save', () => {
  test('a milestone the server refuses stays in the box', async ({ context, page }) => {
    await signIn(context)
    const refused = await refuseWrites(context, 'fh_contacts')
    await openJob(page, '/jobs/c-job1?tab=details')
    const box = page.getByPlaceholder('Add milestone…')
    await box.fill('Forms inspected before pour')
    await page.getByRole('button', { name: 'Add milestone' }).click()
    await expect.poll(() => refused.count).toBeGreaterThan(0)
    await expect(page.getByText("Couldn't save", { exact: false }).first()).toBeVisible()
    await expect(box).toHaveValue('Forms inspected before pour')
  })
})

// Finding lost-work-9: a photo caption the server refuses stays in the field.
test.describe('a photo caption that fails to save', () => {
  test('a photo caption the server refuses stays in the field', async ({ context, page }) => {
    await signIn(context, { tables: { fh_job_files: [{
      id: 'ph-1', user_id: 'qa-user-1', job_id: 'c-job1', contact_id: 'c-job1', kind: 'photo', storage_path: 'qa-user-1/c-job1/a.jpg',
      filename: 'a.jpg', caption: 'Old caption', section_tag: null, size: 1000, mime_type: 'image/jpeg', uploaded_at: new Date().toISOString(), created_at: new Date().toISOString()
    }] } })
    const refused = await refuseWrites(context, 'fh_job_files')
    await openJob(page, '/jobs/c-job1?tab=files&photo=ph-1')
    const caption = page.getByRole('textbox', { name: 'Photo caption' })
    await expect(caption).toHaveValue('Old caption')
    await caption.fill('Rebar tied at 12 inch centers')
    await caption.blur()
    await expect.poll(() => refused.count).toBeGreaterThan(0)
    await expect(page.getByText("Couldn't save caption")).toBeVisible()
    await page.waitForTimeout(1500)
    await expect(caption).toHaveValue('Rebar tied at 12 inch centers')
  })
})

// Finding lost-work-12: the closing note on Mark complete survives a reload.
test.describe('typed words on Mark complete', () => {
  const WORDS = TYPED

  test('the closing note on Mark complete survives a reload', async ({ context, page }) => {
    await signIn(context)
    await page.goto('/jobs/c-job2/complete', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.getByLabel('Closing note').fill(WORDS)
    await page.reload()
    await expect(page.getByLabel('Closing note')).toHaveValue(WORDS)
  })

  // Review of lost-work-12: a closeout that could not be read is not a
  // reason to throw the closing note away.
  test('a closing note edit is kept when the closeout cannot be read', async ({ context, page }) => {
    const closeout = { id: 'co-1', user_id: 'qa-user-1', contact_id: 'c-job2', notes: 'Saved closing note', warranty_months: 12, warranty_start_date: '2026-10-01', signoff_method: 'verbal', signoff_name: 'Dana', created_at: '2026-10-01T15:00:00.000Z' }
    await signIn(context, { tables: { fh_closeouts: [closeout] } })
    await page.goto('/jobs/c-job2/complete', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByLabel('Closing note')).toHaveValue(closeout.notes)
    await page.getByLabel('Closing note').fill(WORDS)
    await expect.poll(() => page.evaluate(() => localStorage.getItem('fh:draft:edit:closeout:c-job2'))).not.toBeNull()
    const refused = (route: Route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'upstream timeout' }) })
    await context.route('**/rest/v1/fh_closeouts**', refused)
    await page.reload()
    await expect(page.getByLabel('Closing note')).toBeVisible()
    await page.waitForTimeout(800)
    expect(await page.evaluate(() => localStorage.getItem('fh:draft:edit:closeout:c-job2'))).not.toBeNull()
    await context.unroute('**/rest/v1/fh_closeouts**', refused)
    await page.reload()
    await expect(page.getByLabel('Closing note')).toHaveValue(WORDS)
  })
})
