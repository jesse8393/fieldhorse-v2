// Universal Capture in the redesign (docs/design/2026-10-redesign/SPEC.md,
// section 9.5, and PHASE2_PLAN.md task 13): the paper sheet the dock coin
// opens, its one brushed gold action, the "Or start with" rows wired to
// flows that already exist, and capture attached to the job it was opened
// from. The model proposes and the person confirms: nothing writes until
// Save. On a desktop (PHASE8_PLAN.md Task 13, D33) there is no floating
// capture button: the sidebar carries a quiet Capture item under Search
// with its key cap, and Cmd or Ctrl J and the palette still open it.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { USER, restResponse } from '../../scripts/qa-mock.mjs'

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

// The mock answers writes without keeping them. This keeps fh_notes for one
// page: a POST adds its rows, and every read is answered from the rows so
// far through the mock's own filters, as the database would. Returns the
// rows that were posted.
async function keepNotes(page: Page) {
  const posted: Record<string, unknown>[] = []
  const notes: Record<string, unknown>[] = [{
    id: 'n1', org_id: 'org-1', user_id: USER.id, contact_id: 'c-job1', text: 'Inspector confirmed Friday.',
    category: 'note', created_at: new Date(Date.now() - 2 * 86400000).toISOString()
  }]
  await page.route((url) => url.pathname.endsWith('/rest/v1/fh_notes'), async (route) => {
    const req = route.request()
    if (req.method() === 'POST') {
      const body = req.postDataJSON()
      for (const row of Array.isArray(body) ? body : [body]) {
        const saved = { org_id: 'org-1', created_at: new Date().toISOString(), ...row }
        posted.push(saved)
        notes.push(saved)
      }
      return route.fulfill({ status: 201, contentType: 'application/json', body: '' })
    }
    const r = restResponse(req.url(), { method: req.method(), headers: req.headers(), tables: { fh_notes: notes } })
    return route.fulfill({ status: r.status, contentType: 'application/json', body: r.body, headers: r.headers })
  })
  return posted
}

// No signal, as the app reads it: navigator.onLine and the online and
// offline events. The page keeps its real connection, since a module cut
// off mid load makes the app reload itself onto Chrome's offline page.
async function setSignal(page: Page, online: boolean) {
  await page.evaluate((on) => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on })
    window.dispatchEvent(new Event(on ? 'online' : 'offline'))
  }, online)
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

  test('a note captured from the job page shows on its Spine without leaving the page', async ({ context, page }) => {
    await signIn(context)
    await mockModel(page, { kind: 'note', summary: 'Save a note', job_id: null, confidence: 0.8, text: 'Rebar is four sticks short' })
    const posted = await keepNotes(page)

    await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const spine = page.locator('.fhj-spine')
    await expect(spine.getByText('Inspector confirmed Friday.')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('group', { name: 'Job actions' }).getByRole('button', { name: 'Capture a voice note for this job' }).click()
    const sheet = page.getByRole('dialog', { name: 'Capture' })
    await expect(sheet.getByText('Attached to Slab + trench.')).toBeVisible()
    await sheet.getByRole('textbox', { name: 'Or type it' }).fill('Rebar is four sticks short')
    await sheet.getByRole('button', { name: 'File it' }).click()
    await expect(sheet.getByText('Opened from Slab + trench, so it files there.')).toBeVisible()
    await sheet.getByRole('button', { name: 'Save' }).click()
    await expect(sheet).toBeHidden()

    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ contact_id: 'c-job1', text: 'Rebar is four sticks short', category: 'note' })
    // Same page, no reload: the job's Spine reads the note it just saved.
    await expect(spine.getByText('Rebar is four sticks short')).toBeVisible()
    await expect(spine.getByText('Inspector confirmed Friday.')).toBeVisible()
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)
  })

  test('with no signal on the job page, the note waits and lands on the job', async ({ context, page }) => {
    await signIn(context)
    const posted = await keepNotes(page)
    await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const spine = page.locator('.fhj-spine')
    await expect(spine.getByText('Inspector confirmed Friday.')).toBeVisible({ timeout: 30_000 })

    await setSignal(page, false)
    await page.getByRole('group', { name: 'Job actions' }).getByRole('button', { name: 'Capture a voice note for this job' }).click()
    const sheet = page.getByRole('dialog', { name: 'Capture' })
    await sheet.getByRole('textbox', { name: 'Or type it' }).fill('Pump truck at seven')
    await sheet.getByRole('button', { name: 'File it' }).click()
    await expect(sheet).toBeHidden()
    const queued = await page.evaluate(() => JSON.parse(localStorage.getItem('fh:capture-outbox') || '[]'))
    expect(queued).toMatchObject([{ text: 'Pump truck at seven', user_id: USER.id, job_id: 'c-job1' }])
    expect(posted).toEqual([])

    // Back in signal: the note lands on the job and its Spine shows it.
    await setSignal(page, true)
    await expect(spine.getByText(/^Pump truck at seven/)).toBeVisible()
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ contact_id: 'c-job1', category: 'note' })
    expect(await page.evaluate(() => localStorage.getItem('fh:capture-outbox'))).toBeNull()
  })
})

test.describe('desktop capture', () => {
  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop sidebar')
    await signIn(context)
  })

  test('no floating button; the sidebar item under Search opens Capture, and Cmd or Ctrl J still works', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })

    // Today, Money and the Job page, where the gold microphone sat over
    // the Needs an answer buttons, the Money count and the facts panel.
    for (const path of ['/', '/invoices', '/jobs/c-job1']) {
      await open(page, path)
      await expect(page.locator('.fh-fab--capture')).toHaveCount(0)
      // Whatever its class, nothing floats here, and the only way to
      // Capture is the sidebar row.
      await expect(page.locator('.fh-fab')).toHaveCount(0)
      await expect(page.getByRole('button', { name: /^Capture/ })).toHaveCount(1)
    }

    const sidebar = page.getByRole('complementary', { name: 'Primary navigation' })
    const search = sidebar.getByRole('button', { name: /^Search everything/ })
    const capture = sidebar.getByRole('button', { name: /^Capture/ })
    await expect(search).toBeVisible()
    await expect(capture).toBeVisible()

    // Under Search and above the main list.
    const [s, c, t] = await Promise.all([
      search.boundingBox(),
      capture.boundingBox(),
      sidebar.getByRole('button', { name: 'Today', exact: true }).boundingBox()
    ])
    expect(c!.y).toBeGreaterThan(s!.y + s!.height - 1)
    expect(t!.y).toBeGreaterThan(c!.y + c!.height - 1)
    // A real control: at least 40 px tall like the rows around it, and quiet (no brushed gold).
    expect(c!.height).toBeGreaterThanOrEqual(40)
    expect(await capture.evaluate((el) => getComputedStyle(el).backgroundImage)).toBe('none')

    // The key cap prints the platform's modifier and the shortcut is declared.
    const cap = capture.locator('kbd')
    await expect(cap).toBeVisible()
    const isMac = await page.evaluate(() => /Macintosh/.test(navigator.userAgent))
    await expect(cap).toHaveText(isMac ? '⌘J' : 'Ctrl J')
    await expect(capture).toHaveAttribute('aria-keyshortcuts', isMac ? 'Meta+J' : 'Control+J')
    await expect(capture).toHaveAccessibleName(isMac ? 'Capture (Command J)' : 'Capture (Control J)')
    // The Capture cap lines up under the Search cap: the same right edge.
    const [searchCap, captureCap] = await Promise.all([search.locator('kbd').boundingBox(), cap.boundingBox()])
    expect(Math.abs((captureCap!.x + captureCap!.width) - (searchCap!.x + searchCap!.width))).toBeLessThanOrEqual(0.5)

    // The item opens the same sheet the button did.
    await capture.click()
    const sheet = page.getByRole('dialog', { name: 'Capture' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByRole('textbox', { name: 'Or type it' })).toBeVisible()
    await sheet.getByRole('button', { name: 'Done' }).click()
    await expect(sheet).toBeHidden()

    // Ctrl J and Cmd J still open it.
    await page.keyboard.press('Control+j')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Done' }).click()
    await expect(sheet).toBeHidden()
    await page.keyboard.press('Meta+j')
    await expect(sheet).toBeVisible()
    await sheet.getByRole('button', { name: 'Done' }).click()
    await expect(sheet).toBeHidden()

    // The palette action is still there.
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await palette.getByRole('option', { name: /Capture anything/ }).click()
    await expect(palette).toBeHidden()
    await expect(sheet).toBeVisible()
  })

  test('the Jobs plus button keeps the corner now that nothing stacks above it', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, '/work')
    const fabs = page.locator('.fh-fab')
    await expect(fabs).toHaveCount(1)
    await expect(fabs).toHaveAccessibleName('New deal')
    await expect(page.locator('.fh-fab--capture')).toHaveCount(0)
    const box = await fabs.boundingBox()
    // 24 px from the right and bottom edges (global.css, desktop .fh-fab).
    // html keeps a stable scrollbar gutter, so a fixed element's right
    // edge resolves against the html box, 15 px short of the window.
    const edge = await page.evaluate(() => {
      const r = document.documentElement.getBoundingClientRect()
      return { right: r.right, bottom: window.innerHeight }
    })
    expect(Math.round(edge.right - (box!.x + box!.width))).toBe(24)
    expect(Math.round(edge.bottom - (box!.y + box!.height))).toBe(24)
  })
})
