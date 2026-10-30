// Universal Capture in the redesign (docs/design/2026-10-redesign/SPEC.md,
// section 9.5; PHASE9_PLAN.md Task 14, D57): the screen /capture the dock
// coin opens, its one brushed gold action, the "Or start with" rows wired
// to flows that already exist, and capture attached to the job it was
// opened from. The model proposes and the person confirms: nothing writes
// until Save, and Save goes back to the screen the capture started on. On
// a desktop (PHASE8_PLAN.md Task 13, D33) there is no floating capture
// button: the sidebar carries a quiet Capture item under Search with its
// key cap, and Cmd or Ctrl J and the palette still open it.
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

// openCapture({ jobId }) from a screen: the event the app shell takes to /capture.
function openOnJob(page: Page, jobId: string) {
  return page.evaluate((id) => {
    window.dispatchEvent(new CustomEvent('fh:open-capture', { detail: { jobId: id } }))
  }, jobId)
}

// The Capture screen, by its heading.
function captureScreen(page: Page) {
  return page.locator('.fh-capture')
}

async function expectCaptureOpen(page: Page) {
  await expect(page).toHaveURL(/\/capture/)
  await expect(page.getByRole('heading', { name: 'Capture', level: 1 })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
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

test.describe('capture screen', () => {
  // Each test signs in itself, some as crew.
  test.beforeEach(async ({ context: _context }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone capture screen')
  })

  test('the coin opens Capture with File it as the one gold button', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/')
    await openFromCoin(page)
    await expectCaptureOpen(page)

    const screen = captureScreen(page)
    await expect(screen.getByRole('button', { name: 'Back' })).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Done' })).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Start talking' })).toBeVisible()
    await expect(screen.getByRole('textbox', { name: 'Or type it' })).toBeVisible()

    const gold = screen.locator('.fhc-btn--primary')
    await expect(gold).toHaveCount(1)
    await expect(gold).toHaveAccessibleName('File it')
    // Brushed once there is something to file.
    await screen.getByRole('textbox', { name: 'Or type it' }).fill('Pour moved to Friday')
    await expect(gold).toBeEnabled()
    await expect(gold).toHaveCSS('background-image', 'none')
    await expect(gold).toHaveCSS('background-color', 'rgb(173, 64, 41)')
    await screen.getByRole('textbox', { name: 'Or type it' }).fill('')

    // Done goes back to where the capture started.
    await screen.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/$/)
    await expect(screen).toHaveCount(0)

    // Cmd or Ctrl+J still opens it.
    await page.keyboard.press('Control+j')
    await expectCaptureOpen(page)
  })

  test('Done with words not saved yet asks with a second tap', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/')
    await openFromCoin(page)
    await expectCaptureOpen(page)
    const screen = captureScreen(page)
    await screen.getByRole('textbox', { name: 'Or type it' }).fill('Pour moved to Friday')
    await screen.getByRole('button', { name: 'Done' }).click()
    // Still here: the first tap only asks.
    await expectCaptureOpen(page)
    await expect(screen.getByText('What you said or typed is not saved yet.')).toBeVisible()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await screen.getByRole('button', { name: 'Tap again to discard' }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('Or start with lists the flows that exist, and carries the words along', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/')
    await openFromCoin(page)
    await expectCaptureOpen(page)

    const starts = page.getByRole('list', { name: 'Or start with' })
    await expect(starts).toBeVisible()
    await expect(starts.getByRole('listitem')).toHaveCount(5)
    await expect(starts.getByRole('link', { name: /^Note/ })).toHaveAttribute('href', '/notes')
    await expect(starts.getByRole('link', { name: /^Lead/ })).toHaveAttribute('href', '/leads/new')
    await expect(starts.getByRole('link', { name: /^Quote/ })).toHaveAttribute('href', '/quotes/new')
    await expect(starts.getByRole('button', { name: /^Expense/ })).toBeVisible()
    await expect(starts.getByRole('link', { name: /^Time/ })).toHaveAttribute('href', '/crew')
    // Photos and invoices always belong to a job, so they wait for one.
    await expect(starts.getByRole('link', { name: /^Photo/ })).toHaveCount(0)
    await expect(starts.getByRole('link', { name: /^Invoice/ })).toHaveCount(0)

    // Words typed so far go with the Lead and Quote rows as ?text=.
    await page.getByRole('textbox', { name: 'Or type it' }).fill('Deck rebuild for Henderson')
    await expect(starts.getByRole('link', { name: /^Lead/ })).toHaveAttribute('href', '/leads/new?text=Deck%20rebuild%20for%20Henderson')
    await expect(starts.getByRole('link', { name: /^Quote/ })).toHaveAttribute('href', '/quotes/new?text=Deck%20rebuild%20for%20Henderson')

    await starts.getByRole('link', { name: /^Lead/ }).click()
    await expect(page).toHaveURL(/\/leads\/new\?text=/)
    await expect(captureScreen(page)).toHaveCount(0)
  })

  test('crew get no lead, quote or invoice rows', async ({ context, page }) => {
    await signIn(context, { role: 'crew' })
    await open(page, '/')
    await openFromCoin(page)
    await expectCaptureOpen(page)
    const starts = page.getByRole('list', { name: 'Or start with' })
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
    await expect(page).toHaveURL(/\/capture\?job=c-job1$/)
    const screen = captureScreen(page)
    await expect(screen.getByText('Attached to Slab + trench.')).toBeVisible()

    const starts = page.getByRole('list', { name: 'Or start with' })
    await expect(starts.getByRole('link', { name: /^Photo/ })).toHaveAttribute('href', '/jobs/c-job1?tab=files')
    await expect(starts.getByRole('link', { name: /^Invoice/ })).toHaveAttribute('href', '/jobs/c-job1?action=send_invoice')

    await screen.getByRole('textbox', { name: 'Or type it' }).fill('Laser level is in the truck')
    await screen.getByRole('button', { name: 'File it' }).click()

    // Confirm phase: what was typed, what it files as, the job it lands on.
    await expect(screen.getByText('Filed as')).toBeVisible()
    await expect(screen.getByText('“Laser level is in the truck”')).toBeVisible()
    const chips = screen.getByRole('list', { name: 'Filed as' })
    await expect(chips.getByRole('listitem')).toHaveText(['Note', 'Slab + trench'])
    await expect(screen.getByText('Opened from Slab + trench, so it files there.')).toBeVisible()
    const gold = screen.locator('.fhc-btn--primary')
    await expect(gold).toHaveCount(1)
    await expect(gold).toHaveAccessibleName('Save')
    await expect(screen.getByRole('button', { name: 'Edit', exact: true })).toBeVisible()
    await expect(screen.getByRole('button', { name: 'Just save it as a note' })).toHaveCount(0)
    expect(writes).toEqual([])

    // Change opens the existing job select, which lists jobs, leads and quotes.
    await screen.getByRole('button', { name: 'Change job' }).click()
    const select = screen.getByRole('combobox', { name: 'Job' })
    await expect(select).toHaveValue('c-job1')
    await expect(select.locator('option', { hasText: 'Vintage Burkitt Station Drainage' })).toHaveCount(1)
    await expect(select.locator('option', { hasText: 'Parking lot repour' })).toHaveCount(1)

    await gold.click()
    // Save goes back to where the capture started.
    await expect(page).toHaveURL(/\/$/)
    expect(writes.filter((u) => u.includes('/rest/v1/fh_notes'))).toHaveLength(1)
  })

  test('a lead outside the roster can still be attached', async ({ context, page }) => {
    await signIn(context)
    // The job roster query only returns active jobs here, and the lead
    // tables are emptied, so the lead has to be fetched by its id when the
    // screen opens on it.
    await page.route((url) => url.pathname.endsWith('/rest/v1/fh_contacts') && url.searchParams.has('stage'), (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify([{ id: 'c-job1', user_id: 'qa-user-1', name: 'Plumbing Bellevue', job_title: 'Slab + trench', stage: 'job', amount: 33100 }])
    }))
    await page.route((url) => url.pathname.endsWith('/rest/v1/fh_leads') || url.pathname.endsWith('/rest/v1/fh_quotes'), (route) => route.fulfill({
      status: 200, contentType: 'application/json', body: '[]'
    }))
    await mockModel(page, { kind: 'payment', summary: 'Log a deposit', job_id: 'c-lead1', confidence: 0.9, amount: 2500, method: 'check', payment_kind: 'deposit' })
    await open(page, '/')
    await openOnJob(page, 'c-lead1')
    const screen = captureScreen(page)
    await expect(screen.getByText('Attached to Vintage Burkitt Station Drainage.')).toBeVisible()
    // A lead has nothing to invoice yet.
    await expect(page.getByRole('list', { name: 'Or start with' }).getByRole('link', { name: /^Invoice/ })).toHaveCount(0)

    await screen.getByRole('textbox', { name: 'Or type it' }).fill('Got a 2500 deposit check from Justin')
    await screen.getByRole('button', { name: 'File it' }).click()
    // The model named the lead; normalizeIntent kept it because the
    // attached lead is in the roster it checks against.
    const chips = screen.getByRole('list', { name: 'Filed as' })
    await expect(chips.getByRole('listitem')).toHaveText(['Payment', '$2,500.00', 'Deposit by check', 'Vintage Burkitt Station Drainage'])
    await expect(screen.getByRole('button', { name: 'Just save it as a note' })).toBeVisible()
  })

  test('a note captured from the job page shows on its Spine when the screen returns', async ({ context, page }) => {
    await signIn(context)
    await mockModel(page, { kind: 'note', summary: 'Save a note', job_id: null, confidence: 0.8, text: 'Rebar is four sticks short' })
    const posted = await keepNotes(page)

    await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const spine = page.locator('.fhj-spine')
    await expect(spine.getByText('Inspector confirmed Friday.')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('group', { name: 'Job actions' }).getByRole('button', { name: 'Capture a voice note for this job' }).click()
    await expect(page).toHaveURL(/\/capture\?job=c-job1$/)
    const screen = captureScreen(page)
    await expect(screen.getByText('Attached to Slab + trench.')).toBeVisible()
    await screen.getByRole('textbox', { name: 'Or type it' }).fill('Rebar is four sticks short')
    await screen.getByRole('button', { name: 'File it' }).click()
    await expect(screen.getByText('Opened from Slab + trench, so it files there.')).toBeVisible()
    await screen.getByRole('button', { name: 'Save' }).click()

    // Back on the job page, no reload: the Spine reads the note it just saved.
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)
    expect(posted).toHaveLength(1)
    expect(posted[0]).toMatchObject({ contact_id: 'c-job1', text: 'Rebar is four sticks short', category: 'note' })
    await expect(spine.getByText('Rebar is four sticks short')).toBeVisible()
    await expect(spine.getByText('Inspector confirmed Friday.')).toBeVisible()
  })

  test('with no signal on the job page, the note waits and lands on the job', async ({ context, page }) => {
    await signIn(context)
    const posted = await keepNotes(page)
    await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const spine = page.locator('.fhj-spine')
    await expect(spine.getByText('Inspector confirmed Friday.')).toBeVisible({ timeout: 30_000 })

    await page.getByRole('group', { name: 'Job actions' }).getByRole('button', { name: 'Capture a voice note for this job' }).click()
    await expect(page).toHaveURL(/\/capture\?job=c-job1$/)
    await setSignal(page, false)
    const screen = captureScreen(page)
    await screen.getByRole('textbox', { name: 'Or type it' }).fill('Pump truck at seven')
    await screen.getByRole('button', { name: 'File it' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)
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

    const sidebar = page.locator('.fh-glass-header')
    const search = sidebar.getByRole('button', { name: /^Search everything/ })
    const capture = sidebar.getByRole('button', { name: /^Capture/ })
    await expect(search).toBeVisible()
    await expect(capture).toBeVisible()

    // The header keeps capture and search visible and keyboard-discoverable.
    const [searchBox, captureBox] = await Promise.all([search.boundingBox(), capture.boundingBox()])
    expect(Math.abs(searchBox!.y - captureBox!.y)).toBeLessThanOrEqual(4)
    expect(captureBox!.height).toBeGreaterThanOrEqual(44)
    const isMac = await page.evaluate(() => /Macintosh/.test(navigator.userAgent))
    await expect(capture).toHaveAttribute('aria-keyshortcuts', isMac ? 'Meta+J' : 'Control+J')
    await expect(capture).toHaveAccessibleName(isMac ? 'Capture (Command J)' : 'Capture (Control J)')

    // The item opens the same screen the coin does.
    await capture.click()
    await expectCaptureOpen(page)
    const screen = captureScreen(page)
    await expect(screen.getByRole('textbox', { name: 'Or type it' })).toBeVisible()
    await screen.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)

    // Ctrl J and Cmd J still open it.
    await page.keyboard.press('Control+j')
    await expectCaptureOpen(page)
    await screen.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)
    await page.keyboard.press('Meta+j')
    await expectCaptureOpen(page)
    await screen.getByRole('button', { name: 'Done' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)

    // The palette action is still there.
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await palette.getByRole('option', { name: /Capture anything/ }).click()
    await expect(palette).toBeHidden()
    await expectCaptureOpen(page)
  })

  test('the Jobs create action stays visible and opens the lead screen without a Capture FAB', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(page, '/work')
    const create = page.getByRole('button', { name: 'New lead', exact: true })
    await expect(create).toBeVisible()
    await expect(create).toBeInViewport()
    await expect(page.locator('.fh-fab--capture')).toHaveCount(0)
    await create.click()
    await expect(page).toHaveURL(/\/leads\/new$/)
    await expect(page.getByRole('heading', { level: 1, name: 'New lead', exact: true })).toBeVisible()
  })
})
