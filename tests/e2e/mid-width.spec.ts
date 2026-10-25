// A desktop between 900 and 1279 px (docs/design/2026-10-redesign/
// PHASE8_PLAN.md, Task 14), at 1024 by 768. On Today, the job page,
// Schedule and Money nothing runs off the right edge, and each screen's
// main action is on screen without scrolling:
//
//   Today      the next stop's Navigate
//   Job page   the stage's gold action, Invoice this on a job in progress
//   Schedule   New job
//   Money      New invoice (the page has no gold button, decision D29)
//
// "Nothing runs off the right edge" measures every element on the page,
// because the page itself never grows a sideways scroll: html, body and
// #root clip whatever is wider than the window (overflow-x: clip in
// global.css), so the document's scroll width cannot tell.
//
// Below 1280 px the job page puts a compact strip with the balance, the
// customer's phone and the address above the composer, so the facts are
// not pushed below the whole Spine. Money's Action column is a fixed
// 96 px (112 for Who owes you, whose Statement button is wider), and
// below 1100 px the Job column steps aside and the job reads under the
// customer's name. Every money figure, seven figures with cents included,
// stays on one line inside its cell in every Money table. Job balances
// keeps every status chip inside its cell; below 1100 px its Paid column
// steps aside, the age reads under the status chip, and a sort by Paid
// reads as the biggest balance first. The sidebar shows the short company
// name in two lines at most (never a fragment such as "My" for "My
// Company"), with the full name as its title, and the city and logo of
// the person's own company only in a workspace that is theirs. The next
// stop with a photo keeps its text inside the photo where its column is
// narrowest, with the time and its am together.
//
// FH_MID_WIDTH runs the same checks at another width, for example
//   FH_MID_WIDTH=900 npx playwright test mid-width --project=desktop-chrome
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { signIn, type SignInOptions } from './helpers/signIn.ts'
import { nothingRunsOffTheSide, pastTheRightEdge } from './helpers/overflow.ts'

const WIDTH = Number(process.env.FH_MID_WIDTH) || 1024
test.use({ viewport: { width: WIDTH, height: 768 }, timezoneId: 'America/Chicago' })

// Thursday, October 8, 2026, 6:40 am in Murfreesboro.
const MORNING = new Date('2026-10-08T11:40:00Z')

// Three visits today, so Today has a next stop at 7:30.
const SCHEDULE = [
  { id: 's1', contact_id: 'c-job1', title: 'Pour slab, crew A', start_at: '2026-10-08T12:30:00Z', end_at: '2026-10-08T16:00:00Z' },
  { id: 's2', contact_id: 'c-lead1', title: 'Site visit and quote walk', start_at: '2026-10-08T16:30:00Z', end_at: '2026-10-08T17:30:00Z' },
  { id: 's3', contact_id: 'c-job2', title: 'Walkthrough', start_at: '2026-10-08T19:30:00Z', end_at: '2026-10-08T20:30:00Z' }
].map((row) => ({ user_id: 'qa-user-1', description: null, created_at: '2026-10-01T12:00:00Z', ...row }))

// Money with something in every group: Rosa six days overdue, Lorraine due
// today, Gail due next Thursday, Marco's quote waiting, two payments in
// the last ten days.
const CLIENT = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }
function contact(partial: Record<string, unknown>) {
  return {
    user_id: 'qa-user-1', client_id: 'cl-1', phone: '555-0101', email: 'x@y.com', address: '412 Burkitt Station Rd',
    notes: null, scope_text: null, milestones: [], created_at: '2026-09-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
    proposal_status: null, follow_up_on: null, completed_at: null, invoice_no: null, cost: null, fh_clients: CLIENT,
    ...partial
  }
}
function invoice(partial: Record<string, unknown>) {
  return {
    user_id: 'qa-user-1', description: null, notes: null, status: 'sent', sequence_number: 1,
    issued_at: '2026-09-28T12:00:00Z', created_at: '2026-09-28T12:00:00Z', updated_at: '2026-09-28T12:00:00Z',
    ...partial
  }
}
function payment(partial: Record<string, unknown>) {
  return { user_id: 'qa-user-1', method: 'check', reference: null, invoice_id: null, kind: null, ...partial }
}
const MONEY = {
  fh_contacts: [
    contact({ id: 'c-rosa', stage: 'job', name: 'Rosa Delgado', email: 'rosa@example.com', job_title: 'Concrete steps', amount: 8000 }),
    contact({ id: 'c-lorraine', stage: 'job', name: 'Lorraine Beasley', job_title: 'Bath retile', amount: 9000 }),
    contact({ id: 'c-gail', stage: 'job', name: 'Gail Abernathy', job_title: 'Roof repair', amount: 6000 }),
    contact({ id: 'c-darnell', stage: 'closed', name: 'Darnell Whitcomb', job_title: 'Garage slab', amount: 9600, cost: 6960, completed_at: '2026-09-29T12:00:00Z' }),
    contact({ id: 'c-marco', stage: 'quote', name: 'Marco Castellanos', job_title: 'Pool deck pour', amount: 18458, proposal_status: 'sent', quote_sent_at: '2026-10-07T11:00:00Z' })
  ],
  fh_invoices: [
    invoice({ id: 'i-rosa-dep', contact_id: 'c-rosa', title: 'Deposit', amount: 3000, status: 'paid', sequence_number: 1, due_at: '2026-09-25', issued_at: '2026-09-18T12:00:00Z', created_at: '2026-09-18T12:00:00Z' }),
    invoice({ id: 'i-rosa', contact_id: 'c-rosa', title: 'Final', amount: 1240, sequence_number: 2, due_at: '2026-10-02' }),
    invoice({ id: 'i-lorraine', contact_id: 'c-lorraine', title: 'Final balance', amount: 4850, due_at: '2026-10-08' }),
    invoice({ id: 'i-gail', contact_id: 'c-gail', title: 'Balance', amount: 2960, due_at: '2026-10-15' })
  ],
  fh_payments: [
    payment({ id: 'p-dep', contact_id: 'c-darnell', amount: 6187.5, paid_on: '2026-09-30', kind: 'deposit', created_at: '2026-09-30T15:00:00Z' }),
    payment({ id: 'p-tue', contact_id: 'c-rosa', amount: 3000, paid_on: '2026-10-06', created_at: '2026-10-06T15:00:00Z' })
  ]
}

// Job balances with the widest things it draws: a six figure job, part
// paid, whose draw has gone unpaid since June ("Overdue, 129 days").
const BALANCES = {
  ...MONEY,
  fh_contacts: [
    ...MONEY.fh_contacts,
    contact({ id: 'c-hollis', stage: 'job', name: 'Hollis Castellanos', job_title: 'Equipment shed slab', amount: 248500 })
  ],
  fh_invoices: [
    ...MONEY.fh_invoices,
    invoice({ id: 'i-hollis', contact_id: 'c-hollis', title: 'Progress draw', amount: 124250, due_at: '2026-06-01', issued_at: '2026-05-25T12:00:00Z', created_at: '2026-05-25T12:00:00Z' })
  ],
  fh_payments: [
    ...MONEY.fh_payments,
    payment({ id: 'p-hollis', contact_id: 'c-hollis', amount: 62125, paid_on: '2026-05-20', kind: 'deposit', created_at: '2026-05-20T15:00:00Z' })
  ]
}

// A seven figure job with a seven figure invoice a week overdue and
// nothing paid: the widest amounts the Money groups, All invoices, Who
// owes you and Job balances draw.
const SEVEN = {
  ...MONEY,
  fh_contacts: [
    ...MONEY.fh_contacts,
    contact({ id: 'c-hollis', stage: 'job', name: 'Hollis Castellanos', job_title: 'Equipment shed slab', amount: 2485000 })
  ],
  fh_invoices: [
    ...MONEY.fh_invoices,
    invoice({ id: 'i-hollis', contact_id: 'c-hollis', title: 'Progress draw', amount: 1242500, due_at: '2026-10-01' })
  ]
}

// The owner's profile when the company he runs is Shyld Roofing: its address
// and its logo (a small PNG, so the monogram can show it).
const PIXEL_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='
const SHYLD_PROFILE = {
  user_id: 'qa-user-1', full_name: 'Casey Harlow', company_name: 'Shyld Roofing Co.', company_address: '210 Lake Dr, Smyrna, TN 37167',
  logo_url: PIXEL_URL, onboarded_at: '2026-07-01T12:00:00Z', location_lat: 35.98, location_lon: -86.52, services: ['Roofing'],
  company_email: 'office@shyld.co', brand_accent_hex: null, preferences: {}
}

async function open(context: BrowserContext, page: Page, path: string, options: SignInOptions = {}) {
  await signIn(context, options)
  // No forecast from the network; every screen here reads fine without one.
  await context.route('https://api.open-meteo.com/**', (route) => route.abort())
  await page.clock.setFixedTime(MORNING)
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
}

// Wholly on screen with the page still at its top.
async function onScreenUnscrolled(page: Page, locator: Locator) {
  await expect(locator).toBeVisible()
  expect(await page.evaluate(() => window.scrollY), 'the page has not scrolled').toBe(0)
  await expect(locator).toBeInViewport({ ratio: 1 })
}

// Each Action button in a table: its label is not cut short, and it sits
// inside its cell.
function actionButtonsFit(table: Locator) {
  return table.locator('td.fhmd-end .fhc-btn').evaluateAll((buttons) => buttons.map((button) => {
    const text = (button.querySelector('.fhc-btn__text') || button) as HTMLElement
    const box = button.getBoundingClientRect()
    const cell = (button.closest('td') as HTMLElement).getBoundingClientRect()
    return {
      label: button.textContent,
      whole: text.scrollWidth <= text.clientWidth,
      inside: box.left >= cell.left - 0.5 && box.right <= cell.right + 0.5
    }
  }))
}

// Each money figure in the tables on one line and inside its cell's
// padding. Cut inside its digits a figure misreads ("$1,242,500.0" over
// "0", or "$33,10" over "0.00" for $33,100.00), and one that runs into the
// padding no longer lines up with the figures above it.
async function amountsOnOneLine(tables: Locator, where: string) {
  const amounts = await tables.locator('td.fhmd-num').evaluateAll((cells) => cells.filter((cell) => cell.textContent).map((cell) => {
    const range = document.createRange()
    range.selectNodeContents(cell)
    const lines = new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size
    const text = range.getBoundingClientRect()
    const box = cell.getBoundingClientRect()
    const style = getComputedStyle(cell)
    const left = box.left + parseFloat(style.paddingLeft)
    const right = box.right - parseFloat(style.paddingRight)
    return { amount: cell.textContent, lines, inside: text.left >= left - 0.5 && text.right <= right + 0.5 }
  }))
  expect(amounts.length, `${where}: money figures`).toBeGreaterThan(0)
  for (const a of amounts) expect(a, `${where}: ${a.amount}`).toEqual({ amount: a.amount, lines: 1, inside: true })
}

// How many lines a block of text shows, whether more lines wait below
// them (clamped, ending in an ellipsis), and whether it is cut sideways.
function lineState(locator: Locator) {
  return locator.evaluate((el) => {
    const style = getComputedStyle(el)
    return {
      lines: Math.round(el.getBoundingClientRect().height / parseFloat(style.lineHeight)),
      clamped: el.scrollHeight > el.clientHeight + 1,
      cutSideways: el.scrollWidth > el.clientWidth + 1
    }
  })
}

test.describe(`a desktop ${WIDTH} px wide`, () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop widths')

  // The check every screen below relies on, run against a page with a
  // block 3000 px wide on it. html, body and #root clip it out of sight,
  // and the document stays no wider than the window, so only measuring
  // the elements finds it. A block that wide inside a strip that scrolls
  // sideways is fine: the strip itself fits.
  test('the overflow check finds a block past the right edge, but not one inside a strip that scrolls sideways', async ({ context, page }) => {
    await open(context, page, '/invoices', { tables: MONEY })
    await expect(page.getByRole('link', { name: 'New invoice' })).toBeVisible({ timeout: 30_000 })
    await nothingRunsOffTheSide(page)

    await page.evaluate(() => {
      const screen = document.querySelector('[data-build-screen]') as HTMLElement
      const strip = document.createElement('div')
      strip.style.overflowX = 'auto'
      const inStrip = document.createElement('div')
      inStrip.style.cssText = 'width: 3000px; height: 8px'
      inStrip.textContent = 'scrolls with its strip'
      strip.append(inStrip)
      const wide = document.createElement('div')
      wide.style.cssText = 'width: 3000px; height: 8px'
      wide.textContent = 'runs off the side'
      screen.append(strip, wide)
    })
    const { edge, past } = await pastTheRightEdge(page)
    expect(await page.evaluate(() => document.documentElement.scrollWidth), 'the document stays no wider than the window').toBeLessThanOrEqual(edge)
    expect(past).toEqual([expect.stringMatching(/^div "runs off the side" ends at \d+ px$/)])
  })

  test('Today: nothing runs off the side and Navigate to the next stop is on screen', async ({ context, page }) => {
    await open(context, page, '/', { tables: { fh_schedule: SCHEDULE } })
    const next = page.getByRole('region', { name: 'Next stop' })
    await expect(next.getByText('Next stop, 7:30 am')).toBeVisible({ timeout: 30_000 })
    await onScreenUnscrolled(page, next.getByRole('link', { name: 'Navigate', exact: true }))
    await nothingRunsOffTheSide(page)
  })

  test('the job page: nothing runs off the side, Invoice this is on screen and the facts sit above the composer', async ({ context, page }) => {
    await open(context, page, '/jobs/c-job1')
    await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.fhj-spine').getByText('Inspector confirmed Friday.')).toBeVisible()
    await onScreenUnscrolled(page, page.locator('.fhd-banner').getByRole('button', { name: 'Invoice this' }))

    const strip = page.getByRole('region', { name: 'Job at a glance' })
    const composer = page.getByRole('button', { name: /Add a note, photos or a task/ })
    if (WIDTH < 1280) {
      // Balance, the customer's phone and the address with Navigate, right
      // under the stage rail and above the composer.
      await expect(strip.getByText('Balance', { exact: true })).toBeVisible()
      await expect(strip.getByText('$33,100.00', { exact: true })).toBeVisible()
      await expect(strip.getByRole('link', { name: /555-0101/ })).toHaveAttribute('href', 'tel:555-0101')
      await expect(strip.getByText('412 Burkitt Station Rd', { exact: true })).toBeVisible()
      // The shared navigateHref: Google Maps away from Apple devices.
      await expect(strip.getByRole('link', { name: /^Navigate/ })).toHaveAttribute(
        'href',
        'https://www.google.com/maps/dir/?api=1&destination=412%20Burkitt%20Station%20Rd'
      )
      const stripBox = (await strip.boundingBox())!
      const composerBox = (await composer.boundingBox())!
      expect(stripBox.y + stripBox.height, 'the strip ends above the composer').toBeLessThanOrEqual(composerBox.y)
      await onScreenUnscrolled(page, strip)
    } else {
      // Two columns: the facts panel stands beside the Spine, so no strip.
      await expect(strip).toHaveCount(0)
      const facts = (await page.getByRole('complementary', { name: 'Job facts' }).boundingBox())!
      const composerBox = (await composer.boundingBox())!
      expect(facts.x).toBeGreaterThanOrEqual(composerBox.x + composerBox.width)
    }
    await nothingRunsOffTheSide(page)
  })

  test('the job page for crew: the strip has the phone and the address but no money', async ({ context, page }) => {
    test.skip(WIDTH >= 1280, 'The strip shows below 1280 px')
    await open(context, page, '/jobs/c-job1', { role: 'crew' })
    const strip = page.getByRole('region', { name: 'Job at a glance' })
    await expect(strip.getByRole('link', { name: /555-0101/ })).toBeVisible({ timeout: 30_000 })
    await expect(strip.getByRole('link', { name: /^Navigate/ })).toBeVisible()
    await expect(page.getByText(/balance/i)).toHaveCount(0)
    await expect(page.getByText(/\$33,100/)).toHaveCount(0)
  })

  test('Schedule: nothing runs off the side and New job is on screen', async ({ context, page }) => {
    await open(context, page, '/schedule', { tables: { fh_schedule: SCHEDULE } })
    await expect(page.locator('[data-build-screen="SnowScheduleBuild"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Schedule' })).toBeVisible()
    // The toolbar draws before the week's visits load; the scan below has
    // to measure the visit blocks too, the likeliest thing to run wide.
    for (const visit of SCHEDULE) await expect(page.getByRole('button', { name: new RegExp(`^${visit.title}, `) })).toBeVisible()
    await onScreenUnscrolled(page, page.getByRole('button', { name: 'New job' }))
    await nothingRunsOffTheSide(page)
  })

  test('Money: nothing runs off the side, New invoice is on screen and every Action button fits its 96 px column', async ({ context, page }) => {
    await open(context, page, '/invoices', { tables: MONEY })
    await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible({ timeout: 30_000 })
    const overdue = page.getByRole('region', { name: 'Overdue', exact: true })
    await expect(overdue.getByRole('link', { name: 'Remind Rosa Delgado' })).toBeVisible({ timeout: 30_000 })
    await onScreenUnscrolled(page, page.getByRole('link', { name: 'New invoice' }))
    await nothingRunsOffTheSide(page)

    for (const title of ['Overdue', 'Due soon', 'Waiting on approval', 'Paid']) {
      const table = page.getByRole('region', { name: title, exact: true }).getByRole('table')
      const action = table.getByRole('columnheader', { name: 'Action', exact: true })
      expect(Math.round((await action.boundingBox())!.width), `${title}: Action column width`).toBe(96)
      for (const fit of await actionButtonsFit(table)) {
        expect(fit, `${title}: ${fit.label}`).toEqual({ label: fit.label, whole: true, inside: true })
      }
      // The Job column steps aside below 1100 px.
      await expect(table.getByRole('columnheader', { name: 'Job', exact: true })).toHaveCount(WIDTH < 1100 ? 0 : 1)
    }

    // The job and what the invoice is for still read on the row: in their
    // own column, or under the customer's name once that column is gone.
    const rosa = overdue.getByRole('row', { name: /Rosa Delgado/ })
    const nameCell = rosa.getByRole('cell').first()
    await expect(rosa.getByText('Concrete steps, final', { exact: true })).toBeVisible()
    await expect(nameCell.getByText('Concrete steps, final', { exact: true })).toHaveCount(WIDTH < 1100 ? 1 : 0)
  })

  test('Money pages: All invoices and Who owes you keep their buttons whole', async ({ context, page }) => {
    await open(context, page, '/invoices?panel=invoices', { tables: MONEY })
    const all = page.getByRole('table', { name: 'All invoices' })
    await expect(all.getByRole('row', { name: /Rosa Delgado/ })).toBeVisible({ timeout: 30_000 })
    expect(Math.round((await all.getByRole('columnheader', { name: 'Action', exact: true }).boundingBox())!.width)).toBe(96)
    for (const fit of await actionButtonsFit(all)) expect(fit, `All invoices: ${fit.label}`).toEqual({ label: fit.label, whole: true, inside: true })
    await expect(all.getByRole('columnheader', { name: 'Job', exact: true })).toHaveCount(WIDTH < 1100 ? 0 : 1)
    await nothingRunsOffTheSide(page)

    await page.getByRole('button', { name: 'Back to Money' }).click()
    await page.getByRole('link', { name: /^Statements/ }).click()
    const owes = page.getByRole('table', { name: 'Who owes you' })
    await expect(owes.getByRole('button', { name: /^Statement for/ }).first()).toBeVisible({ timeout: 30_000 })
    // Fixed too, at 112 px: Statement is the widest of the one button
    // actions and would read "Statem..." in 96.
    expect(Math.round((await owes.getByRole('columnheader', { name: 'Action', exact: true }).boundingBox())!.width)).toBe(112)
    for (const fit of await actionButtonsFit(owes)) expect(fit, `Who owes you: ${fit.label}`).toEqual({ label: fit.label, whole: true, inside: true })
    await nothingRunsOffTheSide(page)
  })

  // Job balances, where a money figure cut inside its digits misreads
  // ("$33,10" over "0.00" reads as $33.10): at 900 px, at 1100 px where
  // Paid has its own column again, and at the spec's own width.
  for (const width of [...new Set([900, 1100, WIDTH])]) {
    test(`Job balances at ${width} px: every amount on one line and every status chip inside its cell`, async ({ context, page }) => {
      await page.setViewportSize({ width, height: 768 })
      await open(context, page, '/invoices?panel=balances', { tables: BALANCES })
      const table = page.getByRole('table', { name: 'Job balances' })
      const hollis = table.getByRole('row', { name: /Hollis Castellanos/ })
      await expect(hollis).toBeVisible({ timeout: 30_000 })

      // Paid steps aside below 1100 px: it is Contract minus Balance, and
      // the CSV keeps it.
      await expect(table.getByRole('button', { name: 'Sort by Paid' })).toHaveCount(width < 1100 ? 0 : 1)
      await expect(hollis.getByText('$248,500.00', { exact: true })).toBeVisible()
      await expect(hollis.getByText('$186,375.00', { exact: true })).toBeVisible()
      await expect(hollis.getByText('$62,125.00', { exact: true })).toHaveCount(width < 1100 ? 0 : 1)
      // The age reads in the chip, or under it below 1100 px.
      if (width < 1100) {
        await expect(hollis.getByText('Overdue', { exact: true })).toBeVisible()
        await expect(hollis.getByText('129 days', { exact: true })).toBeVisible()
      } else {
        await expect(hollis.getByText('Overdue, 129 days', { exact: true })).toBeVisible()
      }

      // Each amount on one line, inside its cell (a Paid cell with nothing
      // paid yet is empty).
      await amountsOnOneLine(table, 'Job balances')

      const chips = await table.locator('td .fhc-chip').evaluateAll((list) => list.map((chip) => {
        const box = chip.getBoundingClientRect()
        const cell = (chip.closest('td') as HTMLElement).getBoundingClientRect()
        return { chip: chip.textContent, inside: box.left >= cell.left - 0.5 && box.right <= cell.right + 0.5 }
      }))
      expect(chips.length).toBeGreaterThan(0)
      for (const c of chips) expect(c, `${c.chip}`).toEqual({ chip: c.chip, inside: true })

      for (const fit of await actionButtonsFit(table)) expect(fit, `Job balances: ${fit.label}`).toEqual({ label: fit.label, whole: true, inside: true })
      await nothingRunsOffTheSide(page)
    })
  }

  // A seven figure amount in every Money table, where each Amount column
  // is narrowest: below 1100 px, from 1100 px where the Job column comes
  // back, up to 1279 px, and at the spec's own width.
  for (const width of [...new Set([900, 1100, 1130, 1279, WIDTH])]) {
    test(`Money at ${width} px: a seven figure amount stays on one line inside its cell in every table`, async ({ context, page }) => {
      await page.setViewportSize({ width, height: 768 })
      await open(context, page, '/invoices', { tables: SEVEN })
      const overdue = page.getByRole('region', { name: 'Overdue', exact: true })
      await expect(overdue.getByText('$1,242,500.00', { exact: true })).toBeVisible({ timeout: 30_000 })
      await amountsOnOneLine(page.locator('[data-build-screen] table'), 'Money groups')

      const panels = [
        { panel: 'invoices', table: 'All invoices', seven: '$1,242,500.00' },
        { panel: 'statements', table: 'Who owes you', seven: /^\$\d,\d{3},\d{3}\.\d{2}$/ },
        { panel: 'balances', table: 'Job balances', seven: '$2,485,000.00' }
      ]
      for (const { panel, table: name, seven } of panels) {
        await page.goto(`/invoices?panel=${panel}`, { waitUntil: 'domcontentloaded' })
        const table = page.getByRole('table', { name })
        await expect(table.locator('td.fhmd-num').filter({ hasText: seven }).first()).toBeVisible({ timeout: 30_000 })
        await amountsOnOneLine(table, name)
        await nothingRunsOffTheSide(page)
      }
    })
  }

  // Paid steps aside below 1100 px, so a sort by Paid made on a wider
  // window shows as the biggest balance first there, with the arrow on
  // Balance, and comes back when the window widens again.
  test('Job balances: a sort by Paid reads as the biggest balance first while Paid is hidden', async ({ context, page }) => {
    await page.setViewportSize({ width: 1280, height: 768 })
    await open(context, page, '/invoices?panel=balances', { tables: BALANCES })
    const table = page.getByRole('table', { name: 'Job balances' })
    await expect(table.getByRole('row', { name: /Hollis Castellanos/ })).toBeVisible({ timeout: 30_000 })
    const order = () => table.locator('tbody .fhmd-name').allTextContents()
    const sorted = (column: string) => table.locator('th', { has: page.getByRole('button', { name: `Sort by ${column}` }) })
    const byPaid = ['Hollis Castellanos', 'Darnell Whitcomb', 'Rosa Delgado', 'Lorraine Beasley', 'Gail Abernathy']
    const byBalance = ['Hollis Castellanos', 'Lorraine Beasley', 'Gail Abernathy', 'Rosa Delgado', 'Darnell Whitcomb']
    await expect.poll(order).toEqual(byBalance)

    await table.getByRole('button', { name: 'Sort by Paid' }).click()
    await expect.poll(order).toEqual(byPaid)
    await expect(sorted('Paid')).toHaveAttribute('aria-sort', 'descending')
    await expect(sorted('Balance')).not.toHaveAttribute('aria-sort', /./)

    await page.setViewportSize({ width: 1024, height: 768 })
    await expect(table.getByRole('button', { name: 'Sort by Paid' })).toHaveCount(0)
    await expect.poll(order).toEqual(byBalance)
    await expect(sorted('Balance')).toHaveAttribute('aria-sort', 'descending')

    await page.setViewportSize({ width: 1280, height: 768 })
    await expect.poll(order).toEqual(byPaid)
    await expect(sorted('Paid')).toHaveAttribute('aria-sort', 'descending')
    await expect(sorted('Balance')).not.toHaveAttribute('aria-sort', /./)
  })

  test('the sidebar shows the short company name whole, with the full name as its title', async ({ context, page }) => {
    await open(context, page, '/invoices', { tables: MONEY })
    const name = page.getByRole('complementary', { name: 'Primary navigation' }).locator('.fhs-side__company')
    await expect(name).toHaveText('Harlow Construction')
    await expect(name).toHaveAttribute('title', 'Harlow Construction Company')
    const state = await lineState(name)
    expect(state.lines).toBeLessThanOrEqual(2)
    expect(state, 'no ellipsis').toMatchObject({ clamped: false, cutSideways: false })
  })

  test('a long company name wraps to two lines at most, and the title keeps all of it', async ({ context, page }) => {
    const long = 'Harlow Construction and Concrete Restoration of Middle Tennessee'
    await open(context, page, '/invoices', { tables: { ...MONEY, organizations: [{ id: 'org-1', name: long }] } })
    const name = page.getByRole('complementary', { name: 'Primary navigation' }).locator('.fhs-side__company')
    await expect(name).toHaveText(long)
    await expect(name).toHaveAttribute('title', long)
    // Two lines, the rest behind an ellipsis and in the title.
    expect(await lineState(name)).toEqual({ lines: 2, clamped: true, cutSideways: false })
  })

  // "My Company" is the name the server gives a workspace made without one
  // (migrations 032 and 062). Dropping its legal word would leave "My".
  test('a workspace still called My Company reads My Company, never My', async ({ context, page }) => {
    await open(context, page, '/invoices', { tables: { ...MONEY, organizations: [{ id: 'org-1', name: 'My Company' }] } })
    const name = page.getByRole('complementary', { name: 'Primary navigation' }).locator('.fhs-side__company')
    await expect(name).toHaveText('My Company')
    await expect(name).toHaveAttribute('title', 'My Company')
  })

  // The profile is the person's, not the workspace's: it holds the city
  // and logo of the company they run. The owner runs Shyld Roofing and works
  // crew at Harlow Construction, so in Harlow the sidebar shows Harlow's
  // name with its initials, never Shyld's city or logo.
  test('in a workspace someone else owns, the sidebar has its name and initials, not the city and logo of the company the person runs', async ({ context, page }) => {
    await open(context, page, '/', { role: 'crew', tables: { fh_schedule: SCHEDULE, profiles: [SHYLD_PROFILE] } })
    const brand = page.getByRole('complementary', { name: 'Primary navigation' }).locator('.fhs-side__brand')
    await expect(brand.locator('.fhs-side__company')).toHaveText('Harlow Construction', { timeout: 30_000 })
    await expect(brand.locator('.fhc-monogram__initials')).toHaveText('HC')
    await expect(brand.locator('img')).toHaveCount(0)
    await expect(brand.getByText('Smyrna, TN')).toHaveCount(0)
  })

  // An owner keeps the city and logo in their own workspace, even under a
  // workspace name that no longer matches the company name in Settings.
  test('in the workspace the person owns, the sidebar keeps their city and logo', async ({ context, page }) => {
    await open(context, page, '/invoices', { tables: { ...MONEY, profiles: [SHYLD_PROFILE] } })
    const brand = page.getByRole('complementary', { name: 'Primary navigation' }).locator('.fhs-side__brand')
    await expect(brand.locator('.fhs-side__company')).toHaveText('Harlow Construction', { timeout: 30_000 })
    await expect(brand.locator('.fhs-side__city')).toHaveText('Smyrna, TN')
    await expect(brand.locator('img')).toHaveAttribute('src', PIXEL_URL)
  })

  // The narrowest next stop on a desktop is at 1100 px, where Today first
  // takes two columns; the spec's own width is checked too.
  for (const width of [...new Set([1100, WIDTH])]) {
    test(`at ${width} px the next stop with a photo keeps its eyebrow and name inside the photo`, async ({ context, page }) => {
      await page.setViewportSize({ width, height: 900 })
      await signIn(context, { tables: { fh_schedule: SCHEDULE } })
      await mockCoverPhoto(context)
      await context.route('https://api.open-meteo.com/**', (route) => route.abort())
      await page.clock.setFixedTime(MORNING)
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
      const next = page.getByRole('region', { name: 'Next stop' })
      await expect(next.getByText('Next stop, 7:30 am')).toBeVisible({ timeout: 30_000 })
      await expect(next.locator('img.fhc-photo__img.is-loaded')).toHaveCount(1, { timeout: 15_000 })
      const box = await next.evaluate((el) => {
        const frame = el.querySelector('.fhc-photo__frame')!.getBoundingClientRect()
        const eyebrow = el.querySelector('.fhc-photo__eyebrow')!.getBoundingClientRect()
        const title = el.querySelector('.fhc-photo__title')!.getBoundingClientRect()
        const action = el.querySelector('.fhc-photo__action')!.getBoundingClientRect()
        return {
          eyebrowInside: eyebrow.top >= frame.top && eyebrow.bottom <= frame.bottom,
          titleInside: title.top >= frame.top && title.bottom <= frame.bottom,
          actionInside: action.top >= frame.top && action.bottom <= frame.bottom,
          detail: `frame ${Math.round(frame.top)} to ${Math.round(frame.bottom)}, eyebrow from ${Math.round(eyebrow.top)}, title to ${Math.round(title.bottom)}`
        }
      })
      const { detail, ...inside } = box
      expect(inside, detail).toEqual({ eyebrowInside: true, titleInside: true, actionInside: true })

      // The time keeps its am: "Next stop, 7:30" over "am" reads wrong.
      const lineTops = await next.locator('.fhc-photo__eyebrow').evaluate((el) => {
        const node = el.firstChild as Text
        const at = node.data.indexOf('7:30')
        const top = (from: number, to: number) => {
          const range = document.createRange()
          range.setStart(node, from)
          range.setEnd(node, to)
          return Math.round(range.getBoundingClientRect().top)
        }
        return { time: top(at, at + 4), suffix: top(at + 5, at + 7) }
      })
      expect(lineTops.suffix, 'am on the line with 7:30').toBe(lineTops.time)
    })
  }
})

// A small PNG standing in for a job photo: Today's cover query finds one
// photo for the next stop's job, the storage signs it, and the url serves
// the image.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
async function mockCoverPhoto(context: BrowserContext) {
  await context.route((url) => url.hostname === 'qa-mock.supabase.co', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/rest/v1/fh_contacts') && (url.searchParams.get('select') || '').includes('fh_job_files')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'c-job1', fh_job_files: [{ storage_path: 'u/c-job1/f1.jpg', uploaded_at: '2026-10-07T11:50:00.000Z' }] }])
      })
    }
    if (url.pathname.endsWith('/storage/v1/object/sign/job-photos') && request.method() === 'POST') {
      const { paths = [] } = JSON.parse(request.postData() || '{}')
      const signed = paths.map((path: string) => ({ path, signedURL: `/object/sign/job-photos/${path}?token=qa`, error: null }))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(signed) })
    }
    if (url.pathname.includes('/storage/v1/object/sign/job-photos/')) {
      return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
    }
    return route.fallback()
  })
}
