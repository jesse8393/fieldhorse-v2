// The Money screen on a phone (docs/design/2026-10-redesign/SPEC.md,
// section 9.7, decision D6): the vault card, the four groups, a Remind
// button that sends only when it is tapped, the invoice actions in a sheet,
// and everything the old screen offered still one tap away. The second
// describe at the bottom covers the same screen at 900 px and wider: the
// vault card and the four groups as tables.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { signIn, type SignInOptions } from './helpers/signIn.ts'

// The mock company sits in Murfreesboro, Tennessee, so the phone runs on
// Central time and the clock is fixed: Thursday, October 8, 2026, 6:40 am.
// The week runs Sunday Oct 4 to Saturday Oct 10.
test.use({ timezoneId: 'America/Chicago' })
const MORNING = new Date('2026-10-08T11:40:00Z')

const CLIENT = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }

function contact(partial: Record<string, unknown>) {
  return {
    user_id: 'qa-user-1',
    client_id: 'cl-1',
    phone: '555-0101',
    email: 'x@y.com',
    address: '412 Burkitt Station Rd',
    notes: null,
    scope_text: null,
    milestones: [],
    created_at: '2026-09-01T12:00:00Z',
    updated_at: '2026-10-01T12:00:00Z',
    proposal_status: null,
    follow_up_on: null,
    completed_at: null,
    invoice_no: null,
    cost: null,
    fh_clients: CLIENT,
    ...partial
  }
}

function invoice(partial: Record<string, unknown>) {
  return {
    user_id: 'qa-user-1',
    description: null,
    notes: null,
    status: 'sent',
    sequence_number: 1,
    issued_at: '2026-09-28T12:00:00Z',
    created_at: '2026-09-28T12:00:00Z',
    updated_at: '2026-09-28T12:00:00Z',
    ...partial
  }
}

function payment(partial: Record<string, unknown>) {
  return { user_id: 'qa-user-1', method: 'check', reference: null, invoice_id: null, kind: null, ...partial }
}

const CONTACTS = [
  contact({ id: 'c-rosa', stage: 'job', name: 'Rosa Delgado', email: 'rosa@example.com', job_title: 'Concrete steps', amount: 8000 }),
  contact({ id: 'c-lorraine', stage: 'job', name: 'Lorraine Beasley', job_title: 'Bath retile', amount: 9000 }),
  contact({ id: 'c-gail', stage: 'job', name: 'Gail Abernathy', job_title: 'Roof repair', amount: 6000 }),
  contact({ id: 'c-darnell', stage: 'closed', name: 'Darnell Whitcomb', job_title: 'Garage slab', amount: 9600, cost: 6960, completed_at: '2026-09-29T12:00:00Z' }),
  contact({
    id: 'c-marco', stage: 'quote', name: 'Marco Castellanos', job_title: 'Pool deck pour', amount: 18458,
    proposal_status: 'sent', quote_sent_at: '2026-10-07T11:00:00Z'
  })
]

const INVOICES = [
  // Rosa's deposit, paid by the $3,000 she sent on Tuesday. Her Final is
  // invoice 2; without its paid deposit, money logged against the job
  // would read as paying the Final (Phase 8, task 5).
  invoice({ id: 'i-rosa-dep', contact_id: 'c-rosa', title: 'Deposit', amount: 3000, status: 'paid', sequence_number: 1, due_at: '2026-09-25', issued_at: '2026-09-18T12:00:00Z', created_at: '2026-09-18T12:00:00Z' }),
  // Six days overdue.
  invoice({ id: 'i-rosa', contact_id: 'c-rosa', title: 'Final', amount: 1240, sequence_number: 2, due_at: '2026-10-02' }),
  // Due today and due next Thursday.
  invoice({ id: 'i-lorraine', contact_id: 'c-lorraine', title: 'Final balance', amount: 4850, due_at: '2026-10-08' }),
  invoice({ id: 'i-gail', contact_id: 'c-gail', title: 'Balance', amount: 2960, due_at: '2026-10-15' }),
  // Due in three weeks, and a draft: only the full list shows these.
  invoice({ id: 'i-later', contact_id: 'c-gail', title: 'Progress draw 2', amount: 500, sequence_number: 2, due_at: '2026-10-29' }),
  invoice({ id: 'i-draft', contact_id: 'c-lorraine', title: 'Deposit', amount: 700, status: 'draft', sequence_number: 2, due_at: null })
]

const PAYMENTS = [
  payment({ id: 'p-dep', contact_id: 'c-darnell', amount: 6187.5, paid_on: '2026-09-30', kind: 'deposit', created_at: '2026-09-30T15:00:00Z' }),
  payment({ id: 'p-oct1', contact_id: 'c-darnell', amount: 1000.5, paid_on: '2026-10-01', kind: 'progress', created_at: '2026-10-01T15:00:00Z' }),
  payment({ id: 'p-sun', contact_id: 'c-gail', amount: 620, paid_on: '2026-10-05', created_at: '2026-10-05T15:00:00Z' }),
  payment({ id: 'p-tue', contact_id: 'c-rosa', amount: 3000, paid_on: '2026-10-06', created_at: '2026-10-06T15:00:00Z' })
]

const TABLES = { fh_contacts: CONTACTS, fh_invoices: INVOICES, fh_payments: PAYMENTS }

async function openMoney(
  context: BrowserContext,
  page: Page,
  options: Omit<SignInOptions, 'tables'> & { tables?: SignInOptions['tables']; at?: Date } = {}
) {
  const { at = MORNING, ...signInOptions } = options
  await signIn(context, { ...signInOptions, tables: { ...TABLES, ...options.tables } })
  await page.clock.setFixedTime(at)
  await page.goto('/invoices', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible({ timeout: 30_000 })
}

// A job whose contact has no email anywhere, with one overdue invoice.
const NO_EMAIL_TABLES = {
  fh_contacts: [
    contact({
      id: 'c-priya', stage: 'job', name: 'Priya Shah', email: '', job_title: 'Fence', amount: 5000,
      fh_clients: { ...CLIENT, email: '' }
    })
  ],
  fh_invoices: [invoice({ id: 'i-priya', contact_id: 'c-priya', title: 'Final', amount: 900, due_at: '2026-10-05' })],
  fh_payments: []
}

// What each invoice actually owes (Phase 8, task 5), with the plan's
// numbers: a $10,000 job, invoice 1 for $5,000 overdue with a $2,000
// payment linked to it, and invoice 2 for $5,000 due Friday, October 9.
const PARTIAL_TABLES = {
  fh_contacts: [
    contact({ id: 'c-sam', stage: 'job', name: 'Sam Whitfield', email: 'sam@example.com', job_title: 'Patio pour', amount: 10000 })
  ],
  fh_invoices: [
    invoice({ id: 'i-sam-1', contact_id: 'c-sam', title: 'Deposit', amount: 5000, sequence_number: 1, due_at: '2026-10-02' }),
    invoice({ id: 'i-sam-2', contact_id: 'c-sam', title: 'Final', amount: 5000, sequence_number: 2, due_at: '2026-10-09' })
  ],
  fh_payments: [
    payment({ id: 'p-sam', contact_id: 'c-sam', invoice_id: 'i-sam-1', amount: 2000, paid_on: '2026-10-03', created_at: '2026-10-03T15:00:00Z' })
  ]
}

// 620 invoices: 619 paid in the last weeks and, oldest of all, an open
// one from January 2025. The screen lists the 500 newest; the totals must
// still count the old one.
const MANY_TABLES = {
  fh_contacts: [contact({ id: 'c-rosa', stage: 'job', name: 'Rosa Delgado', email: 'rosa@example.com', job_title: 'Concrete steps', amount: 200000 })],
  fh_invoices: [
    ...Array.from({ length: 619 }, (_, n) => invoice({
      id: `i-paid-${n}`, contact_id: 'c-rosa', title: `Progress draw ${n + 2}`, amount: 100, status: 'paid',
      sequence_number: n + 2, due_at: '2026-09-30', created_at: new Date(Date.UTC(2026, 8, 30, 12) - n * 3_600_000).toISOString()
    })),
    invoice({ id: 'i-old', contact_id: 'c-rosa', title: 'Final', amount: 1240, sequence_number: 1, due_at: '2025-01-15', issued_at: '2025-01-02T12:00:00Z', created_at: '2025-01-01T12:00:00Z' })
  ],
  fh_payments: []
}

// Mocks the reminder's PDF upload and send, and counts what reaches the
// send endpoint. Nothing is ever really sent.
async function routeSends(context: BrowserContext) {
  const sends: string[] = []
  await context.route('**/storage/v1/object/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'job-files/test.pdf' }) })
  )
  await context.route('**/api/send-invoice', (route) => {
    sends.push(route.request().postData() || '')
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  return sends
}

// Two overdue invoices for two customers who both have an email, for the
// test that two reminders in a row send exactly once each (Phase 8, task 6).
const TWO_OVERDUE_TABLES = {
  fh_contacts: [CONTACTS[0], CONTACTS[1]],
  fh_invoices: [
    invoice({ id: 'i-rosa', contact_id: 'c-rosa', title: 'Final', amount: 1240, due_at: '2026-10-02' }),
    invoice({ id: 'i-lorraine', contact_id: 'c-lorraine', title: 'Final balance', amount: 4850, due_at: '2026-10-05' })
  ],
  fh_payments: []
}

type HeldSend = { contact: string; release: () => void }

// Waits until the sheet holding this element has finished sliding in, so
// the element sits where a tap at its spot will find it. A tap aimed while
// the sheet still rises lands on whatever slides into that spot next.
async function sheetAtRest(inside: Locator) {
  await inside.evaluate(async (node) => {
    const sheetNode = node.closest('[role="dialog"]')
    await Promise.all((sheetNode?.getAnimations() ?? []).map((animation) => animation.finished))
  })
}

// Taps a button that shows it is busy. A plain click would wait for it to
// be ready, so the tap is forced, once the sheet has slid all the way in
// and the button sits where a finger would find it.
async function tapBusy(button: Locator) {
  await expect(button).toBeInViewport({ ratio: 1 })
  await sheetAtRest(button)
  await button.click({ force: true })
}

// Mocks the PDF upload, then holds every send until the test releases it,
// so two reminders can be in flight at once. Nothing is ever really sent.
async function routeHeldSends(context: BrowserContext): Promise<HeldSend[]> {
  const sends: HeldSend[] = []
  await context.route('**/storage/v1/object/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'job-files/test.pdf' }) })
  )
  await context.route('**/api/send-invoice', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { contact_id?: string }
    await new Promise<void>((release) => sends.push({ contact: String(body.contact_id), release }))
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  return sends
}

// Remind Rosa, then Lorraine while Rosa's is still going out. Each sends
// once: Lorraine's reminder cannot re enable Rosa's button, Rosa's
// finishing cannot re enable Lorraine's, and a tap on a button that is
// busy sends nothing.
async function remindTwoQuickly(page: Page, sends: HeldSend[]) {
  const sheet = page.getByRole('dialog', { name: 'Send a reminder' })
  const send = sheet.getByRole('button', { name: 'Send reminder' })

  await page.getByRole('button', { name: 'Remind Rosa Delgado' }).click()
  await expect(sheet).toBeVisible()
  await send.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  // A second tap on the same invoice does nothing.
  await expect(send).toHaveAttribute('aria-busy', 'true')
  await tapBusy(send)
  await page.waitForTimeout(600)
  expect(sends).toHaveLength(1)

  // Close the sheet while Rosa's is in flight and remind Lorraine.
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await page.getByRole('button', { name: 'Remind Lorraine Beasley' }).click()
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('$4,850.00', { exact: true })).toBeVisible()
  await send.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(2)
  expect(sends.map((s) => s.contact)).toEqual(['c-rosa', 'c-lorraine'])

  // Lorraine's going out did not free Rosa's: back on Rosa, her button is
  // still busy and a tap sends nothing.
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await page.getByRole('button', { name: 'Remind Rosa Delgado' }).click()
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('$1,240.00', { exact: true })).toBeVisible()
  await expect(send).toHaveAttribute('aria-busy', 'true')
  await tapBusy(send)
  await page.waitForTimeout(600)
  expect(sends).toHaveLength(2)

  // Back on Lorraine, still busy.
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()
  await page.getByRole('button', { name: 'Remind Lorraine Beasley' }).click()
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('$4,850.00', { exact: true })).toBeVisible()
  await expect(send).toHaveAttribute('aria-busy', 'true')

  // Rosa's goes through. Lorraine's sheet stays open and her button stays
  // busy. A sheet sliding away still counts as visible, so the check waits
  // until one that had started to close would be gone, then asks for an
  // open sheet.
  sends[0].release()
  await expect(page.getByText('Reminder sent to rosa@example.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(800)
  await expect(sheet).toHaveAttribute('data-state', 'open', { timeout: 1_000 })
  await expect(send).toHaveAttribute('aria-busy', 'true')
  await tapBusy(send)
  await page.waitForTimeout(800)
  expect(sends).toHaveLength(2)
  await expect(sheet).toHaveAttribute('data-state', 'open', { timeout: 1_000 })

  // Then Lorraine's.
  sends[1].release()
  await expect(sheet).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText('Reminder sent to x@y.com', { exact: false }).first()).toBeVisible()
  await page.waitForTimeout(800)
  expect(sends).toHaveLength(2)
}

// The numbers roll over at midnight while the screen stays open (Phase 8,
// task 6). The mock's session lasts a day from the real clock, so these
// fixed times sit in the past: Saturday, October 10, 2026, 11:30 pm
// Central, then Sunday, October 11, 8:00 am; and Wednesday, September 30,
// 11:30 pm, then Thursday, October 1, 8:00 am.
const SATURDAY_NIGHT = new Date('2026-10-11T04:30:00Z')
const SUNDAY_MORNING = new Date('2026-10-11T13:00:00Z')
const SEPTEMBER_NIGHT = new Date('2026-10-01T04:30:00Z')
const OCTOBER_MORNING = new Date('2026-10-01T13:00:00Z')

// Payments in the week of Sunday Oct 4 to Saturday Oct 10, and one bill
// due Sunday Oct 11.
const WEEK_TABLES = {
  fh_contacts: [CONTACTS[0], CONTACTS[3]],
  fh_invoices: [invoice({ id: 'i-rosa', contact_id: 'c-rosa', title: 'Final', amount: 1240, due_at: '2026-10-11' })],
  fh_payments: [
    payment({ id: 'p-mon', contact_id: 'c-darnell', amount: 1500, paid_on: '2026-10-05', kind: 'progress', created_at: '2026-10-05T15:00:00Z' }),
    payment({ id: 'p-sat', contact_id: 'c-darnell', amount: 2000, paid_on: '2026-10-10', kind: 'final', created_at: '2026-10-10T15:00:00Z' })
  ]
}

// One payment on Monday, September 28, in the week of Sep 27 to Oct 3.
const MONTH_TABLES = {
  fh_contacts: [CONTACTS[0], CONTACTS[3]],
  fh_invoices: [],
  fh_payments: [
    payment({ id: 'p-sep', contact_id: 'c-darnell', amount: 1500, paid_on: '2026-09-28', kind: 'progress', created_at: '2026-09-28T15:00:00Z' })
  ]
}

// Midnight passes while Money stays open, and the app comes back into
// view in the morning.
async function comeBackAt(page: Page, time: Date) {
  await page.clock.setFixedTime(time)
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')))
}

// Saturday night to Sunday morning: the week's total and "Due today" move.
async function expectWeekRollover(page: Page) {
  const vault = page.locator('.fhc-vault')
  const soon = page.getByRole('region', { name: 'Due soon', exact: true })
  await expect(vault.locator('.fhc-vault__amount')).toHaveText('$3,500.00')
  await expect(soon.getByText('Due Oct 11', { exact: true })).toBeVisible()

  await comeBackAt(page, SUNDAY_MORNING)

  await expect(vault.locator('.fhc-vault__amount')).toHaveText('$0.00')
  // Rosa's bill is due today, so it counts toward this week.
  await expect(vault.getByText('$1,240.00', { exact: true })).toBeVisible()
  await expect(soon.getByText('Due today', { exact: true })).toBeVisible()
  // October so far still holds the two payments.
  await expect(vault.getByText('$3,500.00', { exact: true })).toBeVisible()
}

// The last night of September to the first morning of October: the month
// label and its total move, and the week's total stays.
async function expectMonthRollover(page: Page) {
  const vault = page.locator('.fhc-vault')
  await expect(vault.getByText('September so far', { exact: true })).toBeVisible()
  await expect(vault.getByText('$1,500.00', { exact: true })).toHaveCount(2)

  await comeBackAt(page, OCTOBER_MORNING)

  await expect(vault.getByText('October so far', { exact: true })).toBeVisible()
  await expect(vault.getByText('September so far', { exact: true })).toHaveCount(0)
  await expect(vault.locator('.fhc-vault__amount')).toHaveText('$1,500.00')
  await expect(vault.getByText('$1,500.00', { exact: true })).toHaveCount(1)
}

// Two taps on Send reminder in one go, before the screen can redraw the
// button as busy, so the second tap reaches the send handler itself and
// only its own in flight guard can stop it.
async function doubleTapSendsOnce(page: Page, sends: HeldSend[]) {
  const sheet = page.getByRole('dialog', { name: 'Send a reminder' })
  const send = sheet.getByRole('button', { name: 'Send reminder' })

  await page.getByRole('button', { name: 'Remind Rosa Delgado' }).click()
  await expect(sheet).toBeVisible()
  await expect(send).toBeEnabled()
  await expect(send).not.toHaveAttribute('aria-busy', 'true')
  const busyAtSecondTap = await send.evaluate((button) => {
    const tap = () => (button as HTMLElement).click()
    tap()
    const busy = button.getAttribute('aria-busy')
    tap()
    return busy
  })
  // The second tap landed before the button turned busy, so the button
  // passed it on and only the handler stood in its way.
  expect(busyAtSecondTap).toBeNull()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  await page.waitForTimeout(1_500)
  expect(sends).toHaveLength(1)

  sends[0].release()
  await expect(sheet).toBeHidden({ timeout: 15_000 })
  await expect(page.getByText('Reminder sent to rosa@example.com', { exact: false }).first()).toBeVisible()
  await page.waitForTimeout(800)
  expect(sends).toHaveLength(1)
}

// Leaves Money for Today and comes back the way a person does, through the
// dock on a phone or the sidebar on a desktop: route changes inside the
// app, with no reload, so a send started before is still running.
async function leaveMoneyAndComeBack(page: Page, phone: boolean) {
  await page.evaluate(() => { (window as unknown as { fhSameDocument?: boolean }).fhSameDocument = true })
  const go = (label: string) => phone
    ? page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name: label })
    : page.getByRole('complementary', { name: 'Primary navigation' }).getByRole('button', { name: label, exact: true })
  await go('Today').click()
  await expect(page).not.toHaveURL(/\/invoices/)
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toHaveCount(0)
  await go('Money').click()
  await expect(page).toHaveURL(/\/invoices/)
  await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => (window as unknown as { fhSameDocument?: boolean }).fhSameDocument)).toBe(true)
}

// Remind Rosa, leave Money while her reminder is still going out, and come
// back. The new screen still shows her Resend and Send reminder busy, a
// tap on either sends nothing, and the Remind sheet closes once the first
// reminder is out: one email in all.
async function remindLeaveAndComeBack(page: Page, sends: HeldSend[], phone: boolean) {
  const sheet = page.getByRole('dialog', { name: 'Send a reminder' })
  const send = sheet.getByRole('button', { name: 'Send reminder' })

  await page.getByRole('button', { name: 'Remind Rosa Delgado' }).click()
  await expect(sheet).toBeVisible()
  await send.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  await page.keyboard.press('Escape')
  await expect(sheet).toBeHidden()

  await leaveMoneyAndComeBack(page, phone)

  // Her invoice's actions: Resend is busy and a tap sends nothing.
  await page.getByRole('region', { name: 'Overdue', exact: true }).getByRole('button', { name: /^Rosa Delgado/ }).click()
  const actions = page.getByRole('dialog', { name: 'Final' })
  await expect(actions).toBeVisible()
  const resend = actions.getByRole('button', { name: 'Resend', exact: true })
  await expect(resend).toHaveAttribute('aria-busy', 'true')
  await tapBusy(resend)
  await page.waitForTimeout(600)
  expect(sends).toHaveLength(1)
  await page.keyboard.press('Escape')
  await expect(actions).toBeHidden()

  // The Remind sheet too.
  await page.getByRole('button', { name: 'Remind Rosa Delgado' }).click()
  await expect(sheet).toBeVisible()
  await expect(sheet.getByText('$1,240.00', { exact: true })).toBeVisible()
  await expect(send).toHaveAttribute('aria-busy', 'true')
  await tapBusy(send)
  await page.waitForTimeout(800)
  expect(sends).toHaveLength(1)

  sends[0].release()
  await expect(page.getByText('Reminder sent to rosa@example.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await expect(sheet).toBeHidden({ timeout: 15_000 })
  await page.waitForTimeout(800)
  expect(sends).toHaveLength(1)

  // Once it is out, a new reminder is a new tap away.
  await page.getByRole('button', { name: 'Remind Rosa Delgado' }).click()
  await expect(sheet).toBeVisible()
  await expect(send).toBeEnabled()
  await expect(send).not.toHaveAttribute('aria-busy', 'true')
}

// Holds the first send to each customer until the test lets it go, and
// answers any later one at once, as a signal that clears up would: a
// second email to the same customer shows up as a second request straight
// away. Nothing is ever really sent.
async function routeFirstSendsHeld(context: BrowserContext): Promise<HeldSend[]> {
  const sends: HeldSend[] = []
  await context.route('**/storage/v1/object/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'job-files/test.pdf' }) })
  )
  await context.route('**/api/send-invoice', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}') as { contact_id?: string }
    const contact = String(body.contact_id)
    const again = sends.some((s) => s.contact === contact)
    await new Promise<void>((release) => {
      sends.push({ contact, release })
      if (again) release()
    })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  return sends
}

// What reached the send button: real taps while the email was still going
// out, and the two clicks made at the moments the email landed.
type Landing = { busyTaps: number; freed: number; closing: number }

// Lets the held email go and keeps tapping its busy button with real input,
// a finger on a phone and the mouse on a desktop, at the spot where the
// button sits, while the email lands and the sheet slides away, until that
// sheet has left the page. Two moments follow the landing in which the
// button no longer looks busy: it frees a beat before the sheet starts to
// close, and a closing sheet still takes taps. A tap in either used to send
// the email a second time (review of Phase 8, task 6). Real taps reach
// those moments only some of the time, so the page also clicks the button
// once at the instant each begins, the way a tap landing then would, which
// makes every run cover both. A tap goes out only while the spot is on the
// button or on bare sheet around it, never on another control of the sheet
// (PDF would close it) or on the page underneath.
async function tapThroughTheLanding(page: Page, phone: boolean, sheet: Locator, button: Locator, held: HeldSend): Promise<Landing> {
  await expect(button).toBeInViewport({ ratio: 1 })
  await expect(button).toHaveAttribute('aria-busy', 'true')
  await sheetAtRest(sheet)
  const box = await button.boundingBox()
  if (!box) throw new Error('The button has no box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await sheet.evaluate((node) => node.setAttribute('data-test-sheet', ''))
  await button.evaluate((node) => node.setAttribute('data-test-button', ''))
  await page.evaluate(() => {
    const w = window as unknown as { fhLanding?: Landing }
    const sheetNode = document.querySelector('[data-test-sheet]')
    const buttonNode = document.querySelector<HTMLElement>('[data-test-button]')
    if (!sheetNode || !buttonNode) throw new Error('The sheet and its button are not marked')
    const landing: Landing = { busyTaps: 0, freed: 0, closing: 0 }
    w.fhLanding = landing
    buttonNode.addEventListener('click', (event) => {
      if (event.isTrusted && buttonNode.getAttribute('aria-busy') === 'true') landing.busyTaps++
    }, true)
    // The instant the button frees, with the sheet still open, and the
    // instant the sheet starts to close: one click each.
    new MutationObserver(() => {
      if (!landing.freed && buttonNode.getAttribute('aria-busy') !== 'true') {
        landing.freed++
        buttonNode.click()
      }
      if (!landing.closing && sheetNode.getAttribute('data-state') === 'closed') {
        landing.closing++
        buttonNode.click()
      }
    }).observe(sheetNode, { attributes: true, attributeFilter: ['aria-busy', 'data-state'], subtree: true })
  })
  // What the spot hits: the button, bare sheet, another control of the
  // sheet, nothing of the sheet, the sheet sliding away, or the sheet is
  // gone. No tap goes in while the sheet slides away: the observer above
  // already clicks the button the instant it starts to close, and a tap
  // aimed at the moving sheet could land on the dock behind it once the
  // sheet has moved on (it opened Capture over Money in CI).
  const spot = () => page.evaluate(([px, py]) => {
    const sheetNode = document.querySelector('[data-test-sheet]')
    if (!sheetNode) return 'gone'
    if (sheetNode.getAttribute('data-state') === 'closed') return 'closing'
    const hit = document.elementFromPoint(px, py)
    if (!hit || !sheetNode.contains(hit)) return 'off'
    if (hit.closest('[data-test-button]')) return 'button'
    return hit.closest('button, a, input, textarea, select') ? 'control' : 'sheet'
  }, [x, y])
  const tap = () => (phone ? page.touchscreen.tap(x, y) : page.mouse.click(x, y))

  // A few taps while the email is still going out, then on through its landing.
  for (let n = 0; n < 3; n++) {
    expect(await spot()).toBe('button')
    await tap()
  }
  held.release()
  const until = Date.now() + 15_000
  let where = await spot()
  while (where !== 'gone' && Date.now() < until) {
    if (where === 'button' || where === 'sheet') await tap()
    where = await spot()
  }
  expect(where).toBe('gone')
  const landing = await page.evaluate(() => (window as unknown as { fhLanding: Landing }).fhLanding)
  expect(landing.busyTaps).toBeGreaterThan(0)
  expect(landing.freed).toBe(1)
  expect(landing.closing).toBe(1)
  return landing
}

// Send reminder, tapped again and again while Rosa's reminder goes out and
// lands: one email.
async function remindTapsThroughTheLanding(page: Page, phone: boolean, sends: HeldSend[]) {
  const sheet = page.getByRole('dialog', { name: 'Send a reminder' })
  const send = sheet.getByRole('button', { name: 'Send reminder' })

  await page.getByRole('button', { name: 'Remind Rosa Delgado' }).click()
  await expect(sheet).toBeVisible()
  await expect(send).toBeInViewport({ ratio: 1 })
  await send.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  await tapThroughTheLanding(page, phone, sheet, send, sends[0])
  await expect(page.getByText('Reminder sent to rosa@example.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1_000)
  expect(sends.map((s) => s.contact)).toEqual(['c-rosa'])
}

// Resend, tapped again and again while Rosa's invoice goes out and lands:
// one email.
async function resendTapsThroughTheLanding(page: Page, phone: boolean, sends: HeldSend[]) {
  const actions = page.getByRole('dialog', { name: 'Final' })
  const resend = actions.getByRole('button', { name: 'Resend', exact: true })

  await page.getByRole('region', { name: 'Overdue', exact: true }).getByRole('button', { name: /^Rosa Delgado/ }).click()
  await expect(actions).toBeVisible()
  await expect(resend).toBeInViewport({ ratio: 1 })
  await resend.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  await tapThroughTheLanding(page, phone, actions, resend, sends[0])
  await expect(page.getByText('Invoice sent to rosa@example.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1_000)
  expect(sends.map((s) => s.contact)).toEqual(['c-rosa'])
}

// Any email of an invoice going out keeps both of its sheets busy, and when
// it lands, a sheet still showing that invoice closes instead of turning
// live under a finger that is still tapping. First Rosa's Remind sheet,
// opened while her Resend goes out, then Lorraine's actions, opened while
// her reminder goes out. One email each.
async function otherSheetClosesWhenTheEmailLands(page: Page, phone: boolean, sends: HeldSend[]) {
  const overdue = page.getByRole('region', { name: 'Overdue', exact: true })
  const remind = page.getByRole('dialog', { name: 'Send a reminder' })
  const sendReminder = remind.getByRole('button', { name: 'Send reminder' })

  await overdue.getByRole('button', { name: /^Rosa Delgado/ }).click()
  const rosa = page.getByRole('dialog', { name: 'Final' })
  await expect(rosa).toBeVisible()
  const resend = rosa.getByRole('button', { name: 'Resend', exact: true })
  await expect(resend).toBeInViewport({ ratio: 1 })
  await resend.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  await page.keyboard.press('Escape')
  await expect(rosa).toBeHidden()
  await page.getByRole('button', { name: 'Remind Rosa Delgado' }).click()
  await expect(remind).toBeVisible()
  await expect(remind.getByText('$1,240.00', { exact: true })).toBeVisible()
  await tapThroughTheLanding(page, phone, remind, sendReminder, sends[0])
  await expect(page.getByText('Invoice sent to rosa@example.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1_000)
  expect(sends.map((s) => s.contact)).toEqual(['c-rosa'])

  await page.getByRole('button', { name: 'Remind Lorraine Beasley' }).click()
  await expect(remind).toBeVisible()
  await expect(remind.getByText('$4,850.00', { exact: true })).toBeVisible()
  await expect(sendReminder).toBeInViewport({ ratio: 1 })
  await sendReminder.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(2)
  await page.keyboard.press('Escape')
  await expect(remind).toBeHidden()
  await overdue.getByRole('button', { name: /^Lorraine Beasley/ }).click()
  const lorraine = page.getByRole('dialog', { name: 'Final balance' })
  await expect(lorraine).toBeVisible()
  await tapThroughTheLanding(page, phone, lorraine, lorraine.getByRole('button', { name: 'Resend', exact: true }), sends[1])
  await expect(page.getByText('Reminder sent to x@y.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1_000)
  expect(sends.map((s) => s.contact)).toEqual(['c-rosa', 'c-lorraine'])
}

// Mark paid and Void wait while the invoice's email is going out: the email
// landing marks the invoice sent, so a payment or a void recorded meanwhile
// would read as sent again (review of Phase 8, task 6). Once it is out,
// both work again. Every send here is held until the test lets it go.
async function payAndVoidWaitForTheEmail(page: Page, sends: HeldSend[]) {
  const overdue = page.getByRole('region', { name: 'Overdue', exact: true })
  const remind = page.getByRole('dialog', { name: 'Send a reminder' })
  const actions = page.getByRole('dialog', { name: 'Final' })
  const resend = actions.getByRole('button', { name: 'Resend', exact: true })
  const markPaid = actions.getByRole('button', { name: 'Mark paid', exact: true })
  const voidIt = actions.getByRole('button', { name: 'Void', exact: true })
  const why = 'Mark paid and Void are paused while the email goes out.'

  // Rosa's reminder goes out, and her invoice's actions open meanwhile.
  await page.getByRole('button', { name: 'Remind Rosa Delgado' }).click()
  await expect(remind).toBeVisible()
  await remind.getByRole('button', { name: 'Send reminder' }).click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  await page.keyboard.press('Escape')
  await expect(remind).toBeHidden()
  await overdue.getByRole('button', { name: /^Rosa Delgado/ }).click()
  await expect(actions).toBeVisible()
  await expect(resend).toHaveAttribute('aria-busy', 'true')
  await expect(markPaid).toBeDisabled()
  await expect(voidIt).toBeDisabled()
  // A line says why, and both buttons point to it.
  await expect(actions.getByText(why, { exact: true })).toBeVisible()
  await expect(markPaid).toHaveAccessibleDescription(why)
  await expect(voidIt).toHaveAccessibleDescription(why)
  // The PDF and the job stay one tap away.
  await expect(actions.getByRole('button', { name: 'PDF', exact: true })).toBeEnabled()
  await expect(actions.getByRole('link', { name: 'Open job' })).toBeVisible()
  // A tap on either does nothing.
  await sheetAtRest(actions)
  await markPaid.click({ force: true })
  await voidIt.click({ force: true })
  await page.waitForTimeout(600)
  await expect(page.getByText('Log what was paid.')).toHaveCount(0)
  await expect(page.getByText('Void final?', { exact: false })).toHaveCount(0)
  await expect(actions).toBeVisible()

  // The reminder lands and the sheet closes. Opened again, all of it works.
  sends[0].release()
  await expect(page.getByText('Reminder sent to rosa@example.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await expect(actions).toBeHidden()
  await overdue.getByRole('button', { name: /^Rosa Delgado/ }).click()
  await expect(actions).toBeVisible()
  await expect(markPaid).toBeEnabled()
  await expect(voidIt).toBeEnabled()
  await expect(actions.getByText(why, { exact: true })).toHaveCount(0)

  // The same while its own Resend goes out.
  await expect(resend).toBeInViewport({ ratio: 1 })
  await resend.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(2)
  await expect(resend).toHaveAttribute('aria-busy', 'true')
  await expect(markPaid).toBeDisabled()
  await expect(voidIt).toBeDisabled()
  sends[1].release()
  await expect(actions).toBeHidden({ timeout: 15_000 })

  // Void asks first, as before.
  await overdue.getByRole('button', { name: /^Rosa Delgado/ }).click()
  await expect(actions).toBeVisible()
  await voidIt.click()
  await expect(page.getByText('Void final?', { exact: false })).toBeVisible({ timeout: 15_000 })
  expect(sends).toHaveLength(2)
}

// Holds every request that matches until the test lets them through, then
// hands each to the shared mock. A request whose page is gone (the test
// opened another one meanwhile) is dropped quietly.
async function holdRequests(context: BrowserContext, pattern: string): Promise<() => void> {
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await context.route(pattern, async (route) => {
    await held
    await route.fallback().catch(() => {})
  })
  return release
}

// The pages behind Statements, All invoices and Job balances, opened by
// their link on a device that has not seen this company yet. The invoices
// query waits for the membership, and until it arrives nothing on the page
// may read $0.00, "Nobody owes you" or "paid in full".
const PANELS = [
  { panel: 'statements', title: 'Who owes you', empty: 'Nobody owes you right now.' },
  { panel: 'invoices', title: 'All invoices', empty: 'No open invoices.' },
  { panel: 'balances', title: 'Job balances', empty: 'Nothing outstanding. Every active job is paid in full.' }
]

async function expectPanelsWaitForTheCompany(context: BrowserContext, page: Page) {
  await signIn(context, { tables: TABLES })
  const release = await holdRequests(context, '**/rest/v1/org_members**')
  await page.clock.setFixedTime(MORNING)

  for (const { panel, title, empty } of PANELS) {
    await page.goto(`/invoices?panel=${panel}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByRole('heading', { level: 1, name: title })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('$0.00', { exact: true })).toHaveCount(0)
    await expect(page.getByText(empty, { exact: true })).toHaveCount(0)
    await expect(page.getByText('Total outstanding', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Loading money', { exact: true })).toBeAttached()
  }

  // The membership arrives, and Job balances shows what is really owed.
  release()
  const aging = page.getByRole('region', { name: 'Outstanding by age' })
  await expect(aging.getByText('Total outstanding', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(aging.getByText('$21,792.00', { exact: true })).toBeVisible()
  await expect(page.getByText('Loading money', { exact: true })).toHaveCount(0)
}

test.describe('money on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone Money screen')

  test('money vault and groups', async ({ context, page }) => {
    await openMoney(context, page)

    const vault = page.locator('.fhc-vault')
    await expect(vault.getByText('Collected this week', { exact: true })).toBeVisible()
    // Sunday $620.00 and Tuesday $3,000.00 fall in the week.
    await expect(vault.getByText('$3,620.00', { exact: true }).first()).toBeVisible()
    await expect(vault.getByText('Due this week', { exact: true })).toBeVisible()
    // Rosa $1,240.00 (overdue, counts by Saturday) and Lorraine $4,850.00.
    await expect(vault.getByText('$6,090.00', { exact: true })).toBeVisible()
    await expect(vault.getByText('October so far', { exact: true })).toBeVisible()
    await expect(vault.getByText('$4,620.50', { exact: true })).toBeVisible()
    await expect(vault.getByText('Margin', { exact: true })).toBeVisible()
    await expect(vault.getByText('27.5%', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/analytics')

    for (const title of ['Overdue', 'Due soon', 'Waiting on approval', 'Paid']) {
      await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible()
    }
    // Overdue: one invoice, with the word and the money in cents.
    const overdue = page.getByRole('region', { name: 'Overdue' })
    await expect(overdue.getByText('Rosa Delgado', { exact: true })).toBeVisible()
    await expect(overdue.getByText('$1,240.00', { exact: true })).toBeVisible()
    await expect(overdue.getByText('6 days overdue', { exact: true })).toBeVisible()
    await expect(overdue.getByText('1 invoice', { exact: true })).toBeVisible()
    // Due soon: today and next Thursday. The one due in three weeks is not here.
    const soon = page.getByRole('region', { name: 'Due soon' })
    await expect(soon.getByText('Due today', { exact: true })).toBeVisible()
    await expect(soon.getByText('Due Oct 15', { exact: true })).toBeVisible()
    await expect(soon.getByText('2 invoices', { exact: true })).toBeVisible()
    // Waiting on approval: the sent quote, with the total beside the title.
    const waiting = page.getByRole('region', { name: 'Waiting on approval' })
    await expect(waiting.getByText('Marco Castellanos', { exact: true })).toBeVisible()
    await expect(waiting.getByText('Sent yesterday', { exact: true })).toBeVisible()
    await expect(waiting.getByText('$18,458.00', { exact: true })).toHaveCount(2)
    // Paid: the last 10 days, newest first.
    const paid = page.getByRole('region', { name: 'Paid' })
    await expect(paid.getByText('Last 10 days', { exact: true })).toBeVisible()
    await expect(paid.getByText('Paid Sep 30', { exact: true })).toBeVisible()
    await expect(paid.getByText('Garage slab, deposit', { exact: true })).toBeVisible()
    await expect(paid.getByText('$6,187.50', { exact: true })).toBeVisible()
    // Nothing gold here: the Money screen has no primary button of its own.
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(0)
  })

  test('groups without rows stay out', async ({ context, page }) => {
    await openMoney(context, page, { tables: { fh_invoices: [], fh_contacts: [CONTACTS[3]] } })
    await expect(page.getByRole('heading', { level: 2, name: 'Paid', exact: true })).toBeVisible()
    for (const title of ['Overdue', 'Due soon', 'Waiting on approval']) {
      await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toHaveCount(0)
    }
  })

  test('remind needs an email', async ({ context, page }) => {
    await openMoney(context, page, { tables: NO_EMAIL_TABLES })
    await page.getByRole('button', { name: 'Remind Priya Shah' }).click()
    const sheet = page.getByRole('dialog', { name: 'Send a reminder' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('Add an email to send reminders.', { exact: true })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Send reminder' })).toBeDisabled()
  })

  test('remind sends only on tap', async ({ context, page }) => {
    // sendInvoiceEmail builds the PDF, uploads it to storage, posts to
    // /api/send-invoice, then marks the invoice sent. Mock each of them and
    // count what reaches the send endpoint. Routes are added after sign in:
    // the newest route wins, and the shared mock answers storage with 404.
    await openMoney(context, page)
    const sends: string[] = []
    const uploads: string[] = []
    await context.route('**/storage/v1/object/**', (route) => {
      uploads.push(route.request().url())
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'job-files/test.pdf' }) })
    })
    await context.route('**/api/send-invoice', (route) => {
      sends.push(route.request().postData() || '')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    // Any other send endpoint would be a bug: fail loudly if one is called.
    const stray: string[] = []
    await context.route(/\/api\/(send-(?!invoice$)|docusign-send)/, (route) => {
      stray.push(route.request().url())
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.getByRole('button', { name: 'Remind Rosa Delgado' }).click()
    const sheet = page.getByRole('dialog', { name: 'Send a reminder' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('rosa@example.com', { exact: true })).toBeVisible()
    await expect(sheet.getByText('$1,240.00', { exact: true })).toBeVisible()
    // Opening the sheet sends nothing.
    await page.waitForTimeout(800)
    expect(sends).toHaveLength(0)
    expect(uploads).toHaveLength(0)

    await sheet.getByRole('button', { name: 'Send reminder' }).click()
    await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
    const body = JSON.parse(sends[0])
    expect(body.recipient_email).toBe('rosa@example.com')
    expect(body.contact_id).toBe('c-rosa')
    expect(body.amount_due).toBe(1240)
    await expect(sheet).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('Reminder sent to rosa@example.com', { exact: false }).first()).toBeVisible()
    // Exactly one send, nothing else.
    await page.waitForTimeout(800)
    expect(sends).toHaveLength(1)
    expect(uploads).toHaveLength(1)
    expect(stray).toHaveLength(0)
  })

  test('a partial payment lowers what the invoice asks for everywhere', async ({ context, page }) => {
    await openMoney(context, page, { tables: PARTIAL_TABLES })
    const sends = await routeSends(context)

    const vault = page.locator('.fhc-vault')
    await expect(vault.getByText('Due this week', { exact: true })).toBeVisible()
    await expect(vault.getByText('$8,000.00', { exact: true })).toBeVisible()
    const overdue = page.getByRole('region', { name: 'Overdue' })
    await expect(overdue.getByText('$3,000.00', { exact: true })).toBeVisible()
    await expect(overdue.getByText('6 days overdue', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Due soon' }).getByText('$5,000.00', { exact: true })).toBeVisible()

    // The reminder asks for the same $3,000.00, in the sheet and the email.
    await page.getByRole('button', { name: 'Remind Sam Whitfield' }).click()
    const sheet = page.getByRole('dialog', { name: 'Send a reminder' })
    await expect(sheet.getByText('$3,000.00', { exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: 'Send reminder' }).click()
    await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
    expect(JSON.parse(sends[0]).amount_due).toBe(3000)
    await expect(sheet).toBeHidden({ timeout: 15_000 })

    // Mark paid prefills $3,000.
    await overdue.getByRole('button', { name: /^Sam Whitfield/ }).click()
    const actions = page.getByRole('dialog', { name: 'Deposit' })
    await expect(actions.getByText('$3,000.00', { exact: true })).toBeVisible()
    await actions.getByRole('button', { name: 'Mark paid', exact: true }).click()
    await expect(page.getByText('Log what was paid.')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('#v3-pay-amount')).toHaveValue('3000')
  })

  test('an old open invoice still counts when 620 invoices outgrow the list', async ({ context, page }) => {
    await openMoney(context, page, { tables: MANY_TABLES })
    const overdue = page.getByRole('region', { name: 'Overdue' })
    await expect(overdue.getByText('$1,240.00', { exact: true })).toBeVisible()
    await expect(overdue.getByText('1 invoice', { exact: true })).toBeVisible()
    await expect(page.locator('.fhc-vault').getByText('$1,240.00', { exact: true })).toBeVisible()
  })

  test('crew cannot open money', async ({ context, page }) => {
    await signIn(context, { role: 'crew', tables: TABLES })
    await page.goto('/invoices', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForURL((url) => !url.pathname.startsWith('/invoices'), { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toHaveCount(0)
  })

  test('empty money', async ({ context, page }) => {
    await openMoney(context, page, { tables: { fh_invoices: [], fh_payments: [] } })
    await expect(page.locator('.fhc-vault').getByText('$0.00').first()).toBeVisible()
    await expect(page.getByText('No open invoices', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Create an invoice' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Overdue', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 2, name: 'Due soon', exact: true })).toHaveCount(0)
  })

  test('create an invoice starts from a job', async ({ context, page }) => {
    await openMoney(context, page, { tables: { fh_invoices: [], fh_payments: [] } })
    await page.getByRole('button', { name: 'Create an invoice' }).click()
    const picker = page.getByRole('dialog', { name: 'Which job is it for?' })
    await expect(picker).toBeVisible()
    await expect(picker.getByText('Rosa Delgado', { exact: true })).toBeVisible()
    // Quotes and finished jobs are not offered.
    await expect(picker.getByText('Marco Castellanos', { exact: true })).toHaveCount(0)
    await picker.getByRole('button', { name: /Rosa Delgado/ }).click()
    // The existing send invoice sheet opens for that job.
    const bill = page.getByRole('dialog', { name: 'Bill this job.' })
    await expect(bill).toBeVisible({ timeout: 15_000 })
    await expect(bill.getByText('Rosa Delgado', { exact: true })).toBeVisible()
    await expect(picker).toBeHidden()
  })

  test('an invoice row opens its actions', async ({ context, page }) => {
    await openMoney(context, page)
    await page.getByRole('region', { name: 'Due soon' }).getByRole('button', { name: /Gail Abernathy/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Balance' })
    await expect(sheet).toBeVisible()
    for (const name of ['Resend', 'PDF', 'Mark paid', 'Void']) {
      await expect(sheet.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(sheet.getByRole('link', { name: 'Open job' })).toHaveAttribute('href', '/jobs/c-gail?tab=financials')
    // Mark paid hands over to the payment sheet.
    await sheet.getByRole('button', { name: 'Mark paid', exact: true }).click()
    await expect(page.getByText('Log what was paid.')).toBeVisible({ timeout: 15_000 })
    await expect(sheet).toBeHidden()
  })

  test('resend sends once and closes', async ({ context, page }) => {
    await openMoney(context, page)
    const sends: string[] = []
    await context.route('**/storage/v1/object/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'job-files/test.pdf' }) })
    )
    await context.route('**/api/send-invoice', (route) => {
      sends.push(route.request().postData() || '')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await page.getByRole('region', { name: 'Due soon' }).getByRole('button', { name: /Gail Abernathy/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Balance' })
    await expect(sheet).toBeVisible()
    await page.waitForTimeout(800)
    expect(sends).toHaveLength(0)
    await sheet.getByRole('button', { name: 'Resend', exact: true }).click()
    await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
    await expect(sheet).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('Invoice sent to', { exact: false }).first()).toBeVisible()
    expect(JSON.parse(sends[0]).recipient_email).toBe('x@y.com')
  })

  test('void asks first', async ({ context, page }) => {
    await openMoney(context, page)
    await page.getByRole('region', { name: 'Due soon' }).getByRole('button', { name: /Gail Abernathy/ }).click()
    await page.getByRole('dialog', { name: 'Balance' }).getByRole('button', { name: 'Void', exact: true }).click()
    await expect(page.getByText('Void balance?', { exact: false })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Void invoice' })).toBeVisible()
  })

  test('quotes and paid rows open the job', async ({ context, page }) => {
    await openMoney(context, page)
    await page.getByRole('region', { name: 'Waiting on approval' }).getByText('Marco Castellanos', { exact: true }).click()
    await expect(page).toHaveURL(/\/quotes\/c-marco/)
  })

  test('statements, all invoices and job balances stay reachable', async ({ context, page }) => {
    await openMoney(context, page)

    // Who owes you, with a statement for each customer.
    await page.getByRole('link', { name: /^Statements/ }).click()
    await expect(page).toHaveURL(/panel=statements/)
    await expect(page.getByRole('heading', { level: 1, name: 'Who owes you' })).toBeVisible()
    await page.getByRole('button', { name: /^Statement for/ }).first().click()
    // The existing statement sheet opens for that customer.
    await expect(page.getByRole('dialog', { name: /^Statement for/ })).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: /^Statement for/ })).toBeHidden()
    await page.getByRole('button', { name: 'Back to Money' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible()

    // All invoices: the draft and the one due in three weeks are here, and
    // the filter keeps the old Outstanding and All choice.
    await page.getByRole('link', { name: /^All invoices/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'All invoices' })).toBeVisible()
    await expect(page.getByText('Draft', { exact: true })).toBeVisible()
    await expect(page.getByText('Due Oct 29', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /Gail Abernathy.*progress draw 2/i }).click()
    await expect(page.getByRole('dialog', { name: 'Progress draw 2' })).toBeVisible()
    await page.getByRole('dialog', { name: 'Progress draw 2' }).getByRole('button', { name: 'Close' }).click()
    await page.getByRole('radio', { name: 'All', exact: true }).click({ force: true })
    await expect(page).toHaveURL(/view=all/)
    await expect(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked()
    // All adds the paid and void invoices the Outstanding view leaves out.
    await page.getByRole('button', { name: 'Back to Money' }).click()

    // Job balances: the aging summary and a link to each job's invoice page.
    await page.getByRole('link', { name: /^Job balances/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Job balances' })).toBeVisible()
    const aging = page.getByRole('region', { name: 'Outstanding by age' })
    for (const label of ['Current', 'Late', 'Overdue']) {
      await expect(aging.getByText(label, { exact: true })).toBeVisible()
    }
    await expect(aging.getByText('Total outstanding', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /Rosa Delgado/ })).toHaveAttribute('href', '/invoices/c-rosa')
  })

  test('remind A then B quickly sends exactly one request each', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeHeldSends(context)
    await remindTwoQuickly(page, sends)
  })

  test('the week rolls over while money stays open', async ({ context, page }) => {
    await openMoney(context, page, { tables: WEEK_TABLES, at: SATURDAY_NIGHT })
    await expectWeekRollover(page)
  })

  test('the month label rolls over while money stays open', async ({ context, page }) => {
    await openMoney(context, page, { tables: MONTH_TABLES, at: SEPTEMBER_NIGHT })
    await expectMonthRollover(page)
  })

  test('two taps in one go on Send reminder send one request', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeHeldSends(context)
    await doubleTapSendsOnce(page, sends)
  })

  test('money pages opened by their link wait for the company, never $0.00', async ({ context, page }) => {
    await expectPanelsWaitForTheCompany(context, page)
  })

  test('a reminder still going out when money is left and opened again sends once', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeHeldSends(context)
    await remindLeaveAndComeBack(page, sends, true)
  })

  test('tapping send reminder through the moment it lands sends one request', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeFirstSendsHeld(context)
    await remindTapsThroughTheLanding(page, true, sends)
  })

  test('tapping resend through the moment it lands sends one request', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeFirstSendsHeld(context)
    await resendTapsThroughTheLanding(page, true, sends)
  })

  test('a sheet opened while another email of its invoice goes out closes when it lands', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeFirstSendsHeld(context)
    await otherSheetClosesWhenTheEmailLands(page, true, sends)
  })

  test('mark paid and void wait while the invoice email goes out', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeHeldSends(context)
    await payAndVoidWaitForTheEmail(page, sends)
  })
})

// The desktop Money screen (Phase 4, task 4.6): the same numbers and
// the same sheets as the phone, laid out as a vault card and four tables
// with the columns Customer, Job, Amount, Status and Action.
test.describe('money on a desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop Money screen')
  test.use({ viewport: { width: 1440, height: 900 } })

  const COLUMNS = ['Customer', 'Job', 'Amount', 'Status', 'Action']

  test('desktop money vault and four group tables', async ({ context, page }) => {
    await openMoney(context, page)

    const vault = page.locator('.fhc-vault')
    await expect(vault.getByText('Collected this week', { exact: true })).toBeVisible()
    await expect(vault.getByText('$3,620.00', { exact: true }).first()).toBeVisible()
    await expect(vault.getByText('Due this week', { exact: true })).toBeVisible()
    await expect(vault.getByText('$6,090.00', { exact: true })).toBeVisible()
    await expect(vault.getByText('October so far', { exact: true })).toBeVisible()
    await expect(vault.getByText('$4,620.50', { exact: true })).toBeVisible()
    await expect(vault.getByText('Margin', { exact: true })).toBeVisible()
    await expect(vault.getByText('27.5%', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/analytics')

    // Four groups, each a table with the same five column heads.
    for (const title of ['Overdue', 'Due soon', 'Waiting on approval', 'Paid']) {
      const group = page.getByRole('region', { name: title, exact: true })
      await expect(group.getByRole('heading', { level: 2, name: title, exact: true })).toBeVisible()
      const table = group.getByRole('table')
      await expect(table).toBeVisible()
      for (const name of COLUMNS) {
        await expect(table.getByRole('columnheader', { name, exact: true })).toBeVisible()
      }
    }

    // Overdue: the customer, the job and what it is for, the money in cents,
    // the status as a word, and Remind in the Action column.
    const overdue = page.getByRole('region', { name: 'Overdue', exact: true })
    const rosa = overdue.getByRole('row', { name: /Rosa Delgado/ })
    await expect(rosa.getByText('Rosa Delgado', { exact: true })).toBeVisible()
    await expect(rosa.getByText('Concrete steps, final', { exact: true })).toBeVisible()
    await expect(rosa.getByText('$1,240.00', { exact: true })).toBeVisible()
    await expect(rosa.getByText('6 days overdue', { exact: true })).toBeVisible()
    await expect(rosa.getByRole('button', { name: 'Remind Rosa Delgado' })).toBeVisible()
    await expect(overdue.getByText('1 invoice', { exact: true })).toBeVisible()

    // Due soon: today and next Thursday, each with Open and no Remind.
    const soon = page.getByRole('region', { name: 'Due soon', exact: true })
    await expect(soon.getByText('Due today', { exact: true })).toBeVisible()
    await expect(soon.getByText('Due Oct 15', { exact: true })).toBeVisible()
    await expect(soon.getByText('2 invoices', { exact: true })).toBeVisible()
    await expect(soon.getByRole('button', { name: /^Open Lorraine Beasley/ })).toBeVisible()
    await expect(soon.getByRole('button', { name: /^Remind/ })).toHaveCount(0)

    // Waiting on approval: the sent quote, with its total.
    const waiting = page.getByRole('region', { name: 'Waiting on approval', exact: true })
    await expect(waiting.getByText('Marco Castellanos', { exact: true })).toBeVisible()
    await expect(waiting.getByText('Sent yesterday', { exact: true })).toBeVisible()
    await expect(waiting.getByText('$18,458.00', { exact: true })).toHaveCount(2)

    // Paid: the last 10 days.
    const paid = page.getByRole('region', { name: 'Paid', exact: true })
    await expect(paid.getByText('Last 10 days', { exact: true })).toBeVisible()
    await expect(paid.getByText('Paid Sep 30', { exact: true })).toBeVisible()
    await expect(paid.getByText('Garage slab, deposit', { exact: true })).toBeVisible()
    await expect(paid.getByText('$6,187.50', { exact: true })).toBeVisible()

    // Nothing gold on the page: the only brushed gold button is inside the
    // Remind sheet.
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(0)
  })

  test('desktop remind sends only on tap', async ({ context, page }) => {
    await openMoney(context, page)
    const sends: string[] = []
    const uploads: string[] = []
    await context.route('**/storage/v1/object/**', (route) => {
      uploads.push(route.request().url())
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'job-files/test.pdf' }) })
    })
    await context.route('**/api/send-invoice', (route) => {
      sends.push(route.request().postData() || '')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    const stray: string[] = []
    await context.route(/\/api\/(send-(?!invoice$)|docusign-send)/, (route) => {
      stray.push(route.request().url())
      return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
    })

    await page.getByRole('button', { name: 'Remind Rosa Delgado' }).click()
    const sheet = page.getByRole('dialog', { name: 'Send a reminder' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByText('rosa@example.com', { exact: true })).toBeVisible()
    await expect(sheet.getByText('$1,240.00', { exact: true })).toBeVisible()
    // Opening the sheet sends nothing.
    await page.waitForTimeout(800)
    expect(sends).toHaveLength(0)
    expect(uploads).toHaveLength(0)

    await sheet.getByRole('button', { name: 'Send reminder' }).click()
    await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
    const body = JSON.parse(sends[0])
    expect(body.recipient_email).toBe('rosa@example.com')
    expect(body.contact_id).toBe('c-rosa')
    expect(body.amount_due).toBe(1240)
    await expect(sheet).toBeHidden({ timeout: 15_000 })
    await expect(page.getByText('Reminder sent to rosa@example.com', { exact: false }).first()).toBeVisible()
    await page.waitForTimeout(800)
    expect(sends).toHaveLength(1)
    expect(uploads).toHaveLength(1)
    expect(stray).toHaveLength(0)
  })

  test('desktop partial payment lowers what the invoice asks for everywhere', async ({ context, page }) => {
    await openMoney(context, page, { tables: PARTIAL_TABLES })
    const sends = await routeSends(context)

    await expect(page.locator('.fhc-vault').getByText('$8,000.00', { exact: true })).toBeVisible()
    const overdue = page.getByRole('region', { name: 'Overdue', exact: true })
    const row = overdue.getByRole('row', { name: /Sam Whitfield/ })
    await expect(row.getByText('$3,000.00', { exact: true })).toBeVisible()
    await expect(row.getByText('6 days overdue', { exact: true })).toBeVisible()
    await expect(page.getByRole('region', { name: 'Due soon', exact: true }).getByText('$5,000.00', { exact: true })).toBeVisible()

    await row.getByRole('button', { name: 'Remind Sam Whitfield' }).click()
    const sheet = page.getByRole('dialog', { name: 'Send a reminder' })
    await expect(sheet.getByText('$3,000.00', { exact: true })).toBeVisible()
    await sheet.getByRole('button', { name: 'Send reminder' }).click()
    await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
    expect(JSON.parse(sends[0]).amount_due).toBe(3000)
    await expect(sheet).toBeHidden({ timeout: 15_000 })

    await overdue.getByRole('button', { name: 'Sam Whitfield', exact: true }).click()
    const actions = page.getByRole('dialog', { name: 'Deposit' })
    await expect(actions.getByText('$3,000.00', { exact: true })).toBeVisible()
    await actions.getByRole('button', { name: 'Mark paid', exact: true }).click()
    await expect(page.getByText('Log what was paid.')).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('#v3-pay-amount')).toHaveValue('3000')
  })

  test('desktop old open invoice still counts when 620 invoices outgrow the list', async ({ context, page }) => {
    await openMoney(context, page, { tables: MANY_TABLES })
    const overdue = page.getByRole('region', { name: 'Overdue', exact: true })
    await expect(overdue.getByRole('row', { name: /Rosa Delgado/ }).getByText('$1,240.00', { exact: true })).toBeVisible()
    await expect(page.locator('.fhc-vault').getByText('$1,240.00', { exact: true })).toBeVisible()
  })

  test('desktop remind needs an email', async ({ context, page }) => {
    await openMoney(context, page, { tables: NO_EMAIL_TABLES })
    await page.getByRole('button', { name: 'Remind Priya Shah' }).click()
    const sheet = page.getByRole('dialog', { name: 'Send a reminder' })
    await expect(sheet.getByText('Add an email to send reminders.', { exact: true })).toBeVisible()
    await expect(sheet.getByRole('button', { name: 'Send reminder' })).toBeDisabled()
  })

  test('a row and its Open button open the invoice actions', async ({ context, page }) => {
    await openMoney(context, page)
    const soon = page.getByRole('region', { name: 'Due soon', exact: true })

    // A click anywhere on the row.
    await soon.getByText('Roof repair, balance', { exact: true }).click()
    let sheet = page.getByRole('dialog', { name: 'Balance' })
    await expect(sheet).toBeVisible()
    for (const name of ['Resend', 'PDF', 'Mark paid', 'Void']) {
      await expect(sheet.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(sheet.getByRole('link', { name: 'Open job' })).toHaveAttribute('href', '/jobs/c-gail?tab=financials')
    await page.keyboard.press('Escape')
    await expect(sheet).toBeHidden()

    // The Open button in the Action column does the same.
    await soon.getByRole('button', { name: /^Open Gail Abernathy/ }).click()
    sheet = page.getByRole('dialog', { name: 'Balance' })
    await expect(sheet).toBeVisible()
    // Mark paid hands over to the existing payment sheet.
    await sheet.getByRole('button', { name: 'Mark paid', exact: true }).click()
    await expect(page.getByText('Log what was paid.')).toBeVisible({ timeout: 15_000 })
    await expect(sheet).toBeHidden()
  })

  test('an overdue row opens its actions from the keyboard', async ({ context, page }) => {
    await openMoney(context, page)
    const overdue = page.getByRole('region', { name: 'Overdue', exact: true })
    await overdue.getByRole('button', { name: 'Rosa Delgado', exact: true }).press('Enter')
    await expect(page.getByRole('dialog', { name: 'Final' })).toBeVisible()
  })

  test('void asks first', async ({ context, page }) => {
    await openMoney(context, page)
    await page.getByRole('region', { name: 'Due soon', exact: true }).getByRole('button', { name: /^Open Gail Abernathy/ }).click()
    await page.getByRole('dialog', { name: 'Balance' }).getByRole('button', { name: 'Void', exact: true }).click()
    await expect(page.getByText('Void balance?', { exact: false })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('button', { name: 'Void invoice' })).toBeVisible()
  })

  test('quote and paid rows open the job', async ({ context, page }) => {
    await openMoney(context, page)
    const waiting = page.getByRole('region', { name: 'Waiting on approval', exact: true })
    await expect(waiting.getByRole('link', { name: /^Open Marco Castellanos/ })).toHaveAttribute('href', /\/quotes\/c-marco/)
    const paid = page.getByRole('region', { name: 'Paid', exact: true })
    await expect(paid.getByRole('link', { name: 'Open Darnell Whitcomb, Garage slab, deposit' })).toHaveAttribute('href', '/jobs/c-darnell?tab=financials')
    // A click on the row does what Open does.
    await waiting.getByText('Pool deck pour', { exact: true }).click()
    await expect(page).toHaveURL(/\/quotes\/c-marco/)
  })

  test('empty money', async ({ context, page }) => {
    await openMoney(context, page, { tables: { fh_invoices: [], fh_payments: [] } })
    await expect(page.locator('.fhc-vault').getByText('$0.00').first()).toBeVisible()
    await expect(page.getByText('No open invoices', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Overdue', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 2, name: 'Due soon', exact: true })).toHaveCount(0)
    // An invoice starts from a job, from the empty state or the toolbar.
    await page.getByRole('button', { name: 'Create an invoice' }).click()
    const picker = page.getByRole('dialog', { name: 'Which job is it for?' })
    await expect(picker).toBeVisible()
    await expect(picker.getByText('Rosa Delgado', { exact: true })).toBeVisible()
    await expect(picker.getByText('Marco Castellanos', { exact: true })).toHaveCount(0)
    await page.keyboard.press('Escape')
    await expect(picker).toBeHidden()
    await page.getByRole('button', { name: 'New invoice', exact: true }).click()
    await expect(page.getByRole('dialog', { name: 'Which job is it for?' })).toBeVisible()
  })

  test('crew cannot open money', async ({ context, page }) => {
    await signIn(context, { role: 'crew', tables: TABLES })
    await page.goto('/invoices', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForURL((url) => !url.pathname.startsWith('/invoices'), { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toHaveCount(0)
  })

  test('statements, all invoices and job balances stay reachable', async ({ context, page }) => {
    await openMoney(context, page)

    // Who owes you, with a statement for each customer.
    await page.getByRole('link', { name: /^Statements/ }).click()
    await expect(page).toHaveURL(/panel=statements/)
    await expect(page.getByRole('heading', { level: 1, name: 'Who owes you' })).toBeVisible()
    for (const name of ['Customer', 'Properties', 'Status', 'Balance', 'Action']) {
      await expect(page.getByRole('columnheader', { name, exact: true })).toBeVisible()
    }
    await page.getByRole('button', { name: /^Statement for/ }).first().click()
    await expect(page.getByRole('dialog', { name: /^Statement for/ })).toBeVisible({ timeout: 15_000 })
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: /^Statement for/ })).toBeHidden()
    await page.getByRole('button', { name: 'Back to Money' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible()

    // All invoices: drafts and invoices due later are here, with the old
    // Outstanding and All choice.
    await page.getByRole('link', { name: /^All invoices/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'All invoices' })).toBeVisible()
    await expect(page.getByText('Draft', { exact: true })).toBeVisible()
    await expect(page.getByText('Due Oct 29', { exact: true })).toBeVisible()
    await page.getByRole('row', { name: /Gail Abernathy.*progress draw 2/i }).getByRole('button', { name: /^Open/ }).click()
    await expect(page.getByRole('dialog', { name: 'Progress draw 2' })).toBeVisible()
    await page.keyboard.press('Escape')
    await page.getByRole('radio', { name: 'All', exact: true }).click({ force: true })
    await expect(page).toHaveURL(/view=all/)
    await expect(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked()
    await page.getByRole('button', { name: 'Back to Money' }).click()

    // Job balances: the aging summary, a sortable table with each job's
    // balance, Log payment, and the CSV export.
    await page.getByRole('link', { name: /^Job balances/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Job balances' })).toBeVisible()
    const aging = page.getByRole('region', { name: 'Outstanding by age' })
    for (const label of ['Current', 'Late', 'Overdue']) {
      await expect(aging.getByText(label, { exact: true })).toBeVisible()
    }
    await expect(aging.getByText('Total outstanding', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Rosa Delgado', exact: true })).toHaveAttribute('href', '/invoices/c-rosa')
    await page.getByRole('button', { name: 'Sort by Balance' }).click()
    await page.getByRole('button', { name: 'Log payment for Rosa Delgado' }).click()
    await expect(page.getByText('Log what was paid.')).toBeVisible({ timeout: 15_000 })
  })

  test('job balances filter and export the rows on screen', async ({ context, page }) => {
    await openMoney(context, page)
    await page.goto('/invoices?panel=balances', { waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { level: 1, name: 'Job balances' })).toBeVisible()
    await page.getByRole('searchbox', { name: 'Filter jobs' }).fill('lorraine')
    await expect(page.getByRole('link', { name: 'Lorraine Beasley', exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Rosa Delgado', exact: true })).toHaveCount(0)
    const download = page.waitForEvent('download')
    await page.getByRole('button', { name: 'Export CSV' }).click()
    expect((await download).suggestedFilename()).toBe('fieldhorse-invoices-outstanding.csv')
  })

  test('desktop remind A then B quickly sends exactly one request each', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeHeldSends(context)
    await remindTwoQuickly(page, sends)
  })

  test('desktop week rolls over while money stays open', async ({ context, page }) => {
    await openMoney(context, page, { tables: WEEK_TABLES, at: SATURDAY_NIGHT })
    await expectWeekRollover(page)
  })

  test('desktop month label rolls over while money stays open', async ({ context, page }) => {
    await openMoney(context, page, { tables: MONTH_TABLES, at: SEPTEMBER_NIGHT })
    await expectMonthRollover(page)
  })

  test('desktop two taps in one go on Send reminder send one request', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeHeldSends(context)
    await doubleTapSendsOnce(page, sends)
  })

  test('desktop money pages opened by their link wait for the company, never $0.00', async ({ context, page }) => {
    await expectPanelsWaitForTheCompany(context, page)
  })

  test('desktop reminder still going out when money is left and opened again sends once', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeHeldSends(context)
    await remindLeaveAndComeBack(page, sends, false)
  })

  test('desktop clicking send reminder through the moment it lands sends one request', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeFirstSendsHeld(context)
    await remindTapsThroughTheLanding(page, false, sends)
  })

  test('desktop clicking resend through the moment it lands sends one request', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeFirstSendsHeld(context)
    await resendTapsThroughTheLanding(page, false, sends)
  })

  test('desktop sheet opened while another email of its invoice goes out closes when it lands', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeFirstSendsHeld(context)
    await otherSheetClosesWhenTheEmailLands(page, false, sends)
  })

  test('desktop mark paid and void wait while the invoice email goes out', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeHeldSends(context)
    await payAndVoidWaitForTheEmail(page, sends)
  })

  test('desktop new invoice while money loads waits for the jobs', async ({ context, page }) => {
    await signIn(context, { tables: TABLES })
    const release = await holdRequests(context, '**/rest/v1/fh_invoices**')
    await page.clock.setFixedTime(MORNING)
    await page.goto('/invoices', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Loading money', { exact: true })).toBeAttached()

    // The toolbar button works at once, and the picker waits for the jobs
    // instead of saying there are none.
    await page.getByRole('button', { name: 'New invoice' }).click()
    const picker = page.getByRole('dialog', { name: 'Which job is it for?' })
    await expect(picker).toBeVisible()
    await expect(picker.getByText('No jobs to invoice yet.', { exact: true })).toHaveCount(0)
    await expect(picker.getByRole('link', { name: 'Open jobs' })).toHaveCount(0)
    await expect(picker.getByText('Loading jobs', { exact: true })).toBeAttached()

    release()
    await expect(picker.getByText('Rosa Delgado', { exact: true })).toBeVisible({ timeout: 15_000 })
    for (const name of ['Lorraine Beasley', 'Gail Abernathy']) {
      await expect(picker.getByText(name, { exact: true })).toBeVisible()
    }
    await expect(picker.getByText('Loading jobs', { exact: true })).toHaveCount(0)
    await expect(picker.getByText('No jobs to invoice yet.', { exact: true })).toHaveCount(0)
  })

  test('desktop money shows skeletons, never $0.00, while it loads', async ({ context, page }) => {
    await signIn(context, { tables: TABLES })
    // Hold the invoices until the test lets them through; the shared mock
    // answers once the route falls back to it.
    let release = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    await context.route('**/rest/v1/fh_invoices**', async (route) => {
      await held
      await route.fallback()
    })
    await page.clock.setFixedTime(MORNING)
    await page.goto('/invoices', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Loading money', { exact: true })).toBeAttached()
    expect(await page.locator('.fhc-skel').count()).toBeGreaterThan(3)
    // No number and no count stands in for data that has not arrived.
    await expect(page.getByText('$0.00', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Total outstanding', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Nobody owes you', { exact: true })).toHaveCount(0)
    await expect(page.getByText('0 open', { exact: true })).toHaveCount(0)
    await expect(page.getByText('0 jobs with a balance', { exact: true })).toHaveCount(0)

    release()
    const aging = page.getByRole('region', { name: 'Outstanding by age' })
    await expect(aging.getByText('Total outstanding', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: /^All invoices/ })).toContainText('5 open')
    await expect(page.getByRole('link', { name: /^Statements/ })).toContainText('1 customer owes you')
  })
})
