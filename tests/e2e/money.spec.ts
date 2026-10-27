// The Money screen on a phone (docs/design/2026-10-redesign/SPEC.md,
// section 9.7, decisions D6, D57 and D62): the vault card, the four groups,
// a Remind button that opens the remind screen and sends only when Send
// reminder is tapped there, an invoice row that opens the invoice's own
// screen (no sheet anywhere), and everything the old screen offered still
// one tap away. The second describe at the bottom covers the same screen at
// 900 px and wider: the vault card and the four groups as tables.
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

// Every invoice points at its client (D62); most here bill a job too.
function invoice(partial: Record<string, unknown>) {
  return {
    user_id: 'qa-user-1',
    client_id: 'cl-1',
    description: null,
    notes: null,
    status: 'sent',
    sequence_number: 1,
    issued_at: '2026-09-28T12:00:00Z',
    created_at: '2026-09-28T12:00:00Z',
    updated_at: '2026-09-28T12:00:00Z',
    fh_clients: CLIENT,
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
    id: 'c-marco', stage: 'moved_quote', name: 'Marco Castellanos', job_title: 'Pool deck pour', amount: 18458,
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

const QUOTES = [{
  id: 'q-marco', org_id: 'org-1', user_id: 'qa-user-1', client_id: 'cl-marco',
  title: 'Pool deck pour', amount: 18458, status: 'sent', job_id: null,
  sent_at: '2026-10-07T11:00:00Z', created_at: '2026-09-01T12:00:00Z', updated_at: '2026-10-07T11:00:00Z',
  fh_clients: { id: 'cl-marco', name: 'Marco Castellanos', phone: '555-0101', email: 'marco@example.com', address: null }
}]
const TABLES = { fh_contacts: CONTACTS, fh_quotes: QUOTES, fh_invoices: INVOICES, fh_payments: PAYMENTS }

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
  fh_invoices: [invoice({ id: 'i-priya', contact_id: 'c-priya', title: 'Final', amount: 900, due_at: '2026-10-05', fh_clients: { ...CLIENT, email: '' } })],
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

// One open invoice, inv-1, due next week: the row the Task 12 test opens.
const ONE_INVOICE_TABLES = {
  fh_contacts: [CONTACTS[2]],
  fh_invoices: [invoice({ id: 'inv-1', contact_id: 'c-gail', title: 'Balance', amount: 2960, due_at: '2026-10-15' })],
  fh_payments: []
}

// An invoice with no job (D62): Jeff Roy owes $1,200 for a gravel delivery
// against no job at all, $200 of it paid.
const NO_JOB_TABLES = {
  fh_contacts: [CONTACTS[3]],
  fh_invoices: [invoice({ id: 'i-solo', contact_id: null, title: 'Gravel delivery', amount: 1200, due_at: '2026-10-01', description: 'Two loads of crusher run' })],
  fh_payments: [payment({ id: 'p-solo', contact_id: null, invoice_id: 'i-solo', amount: 200, paid_on: '2026-10-03', created_at: '2026-10-03T15:00:00Z' })]
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

// The screens an invoice's actions live on (D57).
const remindHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Send a reminder' })
const sendReminderButton = (page: Page) => page.getByRole('button', { name: 'Send reminder' })
const moneyHeading = (page: Page) => page.getByRole('heading', { level: 1, name: 'Money' })
const remindLink = (page: Page, who: string) => page.getByRole('link', { name: `Remind ${who}` })
const backButton = (page: Page) => page.getByRole('button', { name: 'Back', exact: true })

// Opens the remind screen for a customer from Money and waits for it.
async function openRemind(page: Page, who: string, invoiceId: string) {
  await remindLink(page, who).click()
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoiceId}/remind$`))
  await expect(remindHeading(page)).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

// Back from a screen under Money lands on Money again.
async function backToMoney(page: Page) {
  await backButton(page).click()
  await expect(moneyHeading(page)).toBeVisible({ timeout: 15_000 })
}

// Taps a button that shows it is busy. A plain click would wait for it to
// be ready, so the tap is forced.
async function tapBusy(button: Locator) {
  await expect(button).toBeInViewport({ ratio: 1 })
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
  const send = sendReminderButton(page)

  await openRemind(page, 'Rosa Delgado', 'i-rosa')
  await send.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  // A second tap on the same invoice does nothing.
  await expect(send).toHaveAttribute('aria-busy', 'true')
  await tapBusy(send)
  await page.waitForTimeout(600)
  expect(sends).toHaveLength(1)

  // Leave the screen while Rosa's is in flight and remind Lorraine.
  await backToMoney(page)
  await openRemind(page, 'Lorraine Beasley', 'i-lorraine')
  await expect(page.getByText('$4,850.00', { exact: true })).toBeVisible()
  await send.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(2)
  expect(sends.map((s) => s.contact)).toEqual(['c-rosa', 'c-lorraine'])

  // Lorraine's going out did not free Rosa's: back on Rosa, her button is
  // still busy and a tap sends nothing.
  await backToMoney(page)
  await openRemind(page, 'Rosa Delgado', 'i-rosa')
  await expect(page.getByText('$1,240.00', { exact: true })).toBeVisible()
  await expect(send).toHaveAttribute('aria-busy', 'true')
  await tapBusy(send)
  await page.waitForTimeout(600)
  expect(sends).toHaveLength(2)

  // Back on Lorraine, still busy.
  await backToMoney(page)
  await openRemind(page, 'Lorraine Beasley', 'i-lorraine')
  await expect(page.getByText('$4,850.00', { exact: true })).toBeVisible()
  await expect(send).toHaveAttribute('aria-busy', 'true')

  // Rosa's goes through. Lorraine's screen stays and her button stays busy.
  sends[0].release()
  await expect(page.getByText('Reminder sent to rosa@example.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(800)
  await expect(page).toHaveURL(/\/invoices\/i-lorraine\/remind$/)
  await expect(send).toHaveAttribute('aria-busy', 'true')
  await tapBusy(send)
  await page.waitForTimeout(800)
  expect(sends).toHaveLength(2)
  await expect(page).toHaveURL(/\/invoices\/i-lorraine\/remind$/)

  // Then Lorraine's: her screen leaves once the email is out.
  sends[1].release()
  await expect(moneyHeading(page)).toBeVisible({ timeout: 15_000 })
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
  const send = sendReminderButton(page)

  await openRemind(page, 'Rosa Delgado', 'i-rosa')
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
  await expect(moneyHeading(page)).toBeVisible({ timeout: 15_000 })
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
  await expect(moneyHeading(page)).toHaveCount(0)
  await go('Money').click()
  await expect(page).toHaveURL(/\/invoices/)
  await expect(moneyHeading(page)).toBeVisible({ timeout: 30_000 })
  expect(await page.evaluate(() => (window as unknown as { fhSameDocument?: boolean }).fhSameDocument)).toBe(true)
}

// Opens an invoice's screen from its row in a Money group: the row is a
// link on a phone and a table row on a desktop.
async function openInvoiceRow(page: Page, group: string, who: RegExp, invoiceId: string) {
  const region = page.getByRole('region', { name: group, exact: true })
  await expect(region).toBeVisible({ timeout: 15_000 })
  const row = region.getByRole('row', { name: who })
  if (await row.count()) await row.first().click()
  else await region.getByRole('link', { name: who }).first().click()
  await expect(page).toHaveURL(new RegExp(`/invoices/${invoiceId}$`))
  await expect(page.locator('.fhinv-actions')).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
}

// Remind Rosa, leave Money while her reminder is still going out, and come
// back. The invoice screen still shows her Resend busy and the remind screen
// its Send reminder busy, a tap on either sends nothing, and the remind
// screen leaves once the first reminder is out: one email in all.
async function remindLeaveAndComeBack(page: Page, sends: HeldSend[], phone: boolean) {
  const send = sendReminderButton(page)

  await openRemind(page, 'Rosa Delgado', 'i-rosa')
  await send.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  await backToMoney(page)

  await leaveMoneyAndComeBack(page, phone)

  // Her invoice's screen: Resend is busy and a tap sends nothing.
  await openInvoiceRow(page, 'Overdue', /^Rosa Delgado/, 'i-rosa')
  const resend = page.getByRole('button', { name: 'Resend', exact: true })
  await expect(resend).toHaveAttribute('aria-busy', 'true')
  await tapBusy(resend)
  await page.waitForTimeout(600)
  expect(sends).toHaveLength(1)
  await backToMoney(page)

  // The remind screen too.
  await openRemind(page, 'Rosa Delgado', 'i-rosa')
  await expect(page.getByText('$1,240.00', { exact: true })).toBeVisible()
  await expect(send).toHaveAttribute('aria-busy', 'true')
  await tapBusy(send)
  await page.waitForTimeout(800)
  expect(sends).toHaveLength(1)

  sends[0].release()
  await expect(page.getByText('Reminder sent to rosa@example.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await expect(moneyHeading(page)).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(800)
  expect(sends).toHaveLength(1)

  // Once it is out, a new reminder is a new tap away.
  await openRemind(page, 'Rosa Delgado', 'i-rosa')
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
// out, and the click made at the moment the button was freed.
type Landing = { busyTaps: number; freed: number }

// Lets the held email go and keeps tapping its busy button with real input,
// a finger on a phone and the mouse on a desktop, at the spot where the
// button sits, while the email lands and the screen leaves (the remind
// screen) or the button frees (the invoice screen). The moment the button
// no longer looks busy, the page also clicks it once, the way a tap landing
// then would, so every run covers that instant. A tap that lands then must
// send nothing (review of Phase 8, task 6).
async function tapThroughTheLanding(page: Page, phone: boolean, button: Locator, held: HeldSend, leaves: boolean): Promise<Landing> {
  await expect(button).toBeInViewport({ ratio: 1 })
  await expect(button).toHaveAttribute('aria-busy', 'true')
  const box = await button.boundingBox()
  if (!box) throw new Error('The button has no box')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await button.evaluate((node) => node.setAttribute('data-test-button', ''))
  await page.evaluate(() => {
    const w = window as unknown as { fhLanding?: Landing }
    const buttonNode = document.querySelector<HTMLElement>('[data-test-button]')
    if (!buttonNode) throw new Error('The button is not marked')
    const landing: Landing = { busyTaps: 0, freed: 0 }
    w.fhLanding = landing
    buttonNode.addEventListener('click', (event) => {
      if (event.isTrusted && buttonNode.getAttribute('aria-busy') === 'true') landing.busyTaps++
    }, true)
    // The instant the button frees: one click.
    new MutationObserver(() => {
      if (!landing.freed && buttonNode.isConnected && buttonNode.getAttribute('aria-busy') !== 'true') {
        landing.freed++
        buttonNode.click()
      }
    }).observe(buttonNode, { attributes: true, attributeFilter: ['aria-busy'] })
  })
  // What the spot hits: the busy button, the freed button, or something else.
  const spot = () => page.evaluate(([px, py]) => {
    const buttonNode = document.querySelector('[data-test-button]')
    if (!buttonNode) return 'gone'
    const hit = document.elementFromPoint(px, py)
    if (!hit || !buttonNode.contains(hit)) return 'off'
    return buttonNode.getAttribute('aria-busy') === 'true' ? 'busy' : 'free'
  }, [x, y])
  // Bind input to this particular button. A page.mouse.click at frozen
  // coordinates can race the automatic return to Money and activate an
  // unrelated link underneath it. That is a different action, not another
  // attempt to send this invoice. Detached buttons end this stress input;
  // every other input failure still fails the test.
  const target = await button.elementHandle()
  if (!target) throw new Error('The send button is no longer available')
  const tap = async () => {
    try {
      if (phone) await target.tap({ force: true, timeout: 1_000 })
      else await target.click({ force: true, timeout: 1_000 })
    } catch (error) {
      if (await target.evaluate((node) => !node.isConnected)) return
      throw error
    }
  }

  // A few taps while the email is still going out, then on through its landing.
  for (let n = 0; n < 3; n++) {
    expect(await spot()).toBe('busy')
    await tap()
  }
  held.release()
  const until = Date.now() + 15_000
  let where = await spot()
  while (where === 'busy' && Date.now() < until) {
    await tap()
    where = await spot()
  }
  // Keep tapping the freed spot for a beat: a tap on a screen that is
  // leaving, or on a button just freed, sends nothing.
  for (let n = 0; n < 3; n++) {
    const now = await spot()
    if (now === 'busy' || (leaves && now === 'free')) await tap()
    else if (now === 'free') {
      // On a screen that stays, one tap the instant the button frees.
      if (n === 0) await tap()
      break
    }
  }
  if (leaves) {
    await expect(page.locator('[data-test-button]')).toHaveCount(0, { timeout: 15_000 })
  } else {
    await expect(button).not.toHaveAttribute('aria-busy', 'true', { timeout: 15_000 })
  }
  const landing = await page.evaluate(() => (window as unknown as { fhLanding: Landing }).fhLanding)
  expect(landing.busyTaps).toBeGreaterThan(0)
  return landing
}

// Send reminder, tapped again and again while Rosa's reminder goes out and
// lands: one email.
async function remindTapsThroughTheLanding(page: Page, phone: boolean, sends: HeldSend[]) {
  const send = sendReminderButton(page)
  await openRemind(page, 'Rosa Delgado', 'i-rosa')
  await expect(send).toBeInViewport({ ratio: 1 })
  await send.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  await tapThroughTheLanding(page, phone, send, sends[0], true)
  await expect(page.getByText('Reminder sent to rosa@example.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1_000)
  expect(sends.map((s) => s.contact)).toEqual(['c-rosa'])
}

// Resend, tapped again and again while Rosa's invoice goes out and lands:
// one email. The invoice screen stays; its button simply frees.
async function resendTapsThroughTheLanding(page: Page, phone: boolean, sends: HeldSend[]) {
  await openInvoiceRow(page, 'Overdue', /^Rosa Delgado/, 'i-rosa')
  const resend = page.getByRole('button', { name: 'Resend', exact: true })
  await expect(resend).toBeInViewport({ ratio: 1 })
  await resend.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  await tapThroughTheLanding(page, phone, resend, sends[0], false)
  await expect(page.getByText('Invoice sent to rosa@example.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1_000)
  // Taps that landed as the button freed sent nothing more; a tap now would
  // be a new, deliberate send.
  expect(sends.map((s) => s.contact)).toEqual(['c-rosa'])
}

// Any email of an invoice going out keeps both of its screens busy, and
// when it lands, a remind screen still showing that invoice leaves instead
// of turning live under a finger that is still tapping. First Rosa's remind
// screen, opened while her Resend goes out, then Lorraine's invoice screen,
// opened while her reminder goes out. One email each.
async function otherScreenSettlesWhenTheEmailLands(page: Page, phone: boolean, sends: HeldSend[]) {
  const sendReminder = sendReminderButton(page)

  await openInvoiceRow(page, 'Overdue', /^Rosa Delgado/, 'i-rosa')
  const resend = page.getByRole('button', { name: 'Resend', exact: true })
  await expect(resend).toBeInViewport({ ratio: 1 })
  await resend.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  await backToMoney(page)
  await openRemind(page, 'Rosa Delgado', 'i-rosa')
  await expect(page.getByText('$1,240.00', { exact: true })).toBeVisible()
  await tapThroughTheLanding(page, phone, sendReminder, sends[0], true)
  await expect(page.getByText('Invoice sent to rosa@example.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await expect(moneyHeading(page)).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1_000)
  expect(sends.map((s) => s.contact)).toEqual(['c-rosa'])

  await openRemind(page, 'Lorraine Beasley', 'i-lorraine')
  await expect(page.getByText('$4,850.00', { exact: true })).toBeVisible()
  await expect(sendReminder).toBeInViewport({ ratio: 1 })
  await sendReminder.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(2)
  await backToMoney(page)
  await openInvoiceRow(page, 'Overdue', /^Lorraine Beasley/, 'i-lorraine')
  const lorraineResend = page.getByRole('button', { name: 'Resend', exact: true })
  await tapThroughTheLanding(page, phone, lorraineResend, sends[1], false)
  await expect(page.getByText('Reminder sent to x@y.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1_000)
  expect(sends.map((s) => s.contact)).toEqual(['c-rosa', 'c-lorraine'])
}

// Collect payment and Void wait while the invoice's email is going out: the
// email landing marks the invoice sent, so a payment or a void recorded
// meanwhile would read as sent again (review of Phase 8, task 6). Once it
// is out, both work again. Every send here is held until the test lets it go.
async function payAndVoidWaitForTheEmail(page: Page, sends: HeldSend[]) {
  const why = 'Collect payment and Void are paused while the email goes out.'

  // Rosa's reminder goes out, and her invoice's screen opens meanwhile.
  await openRemind(page, 'Rosa Delgado', 'i-rosa')
  await sendReminderButton(page).click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
  await backToMoney(page)
  await openInvoiceRow(page, 'Overdue', /^Rosa Delgado/, 'i-rosa')
  const actions = page.locator('.fhinv-actions')
  const resend = actions.getByRole('button', { name: 'Resend', exact: true })
  const collect = actions.getByRole('link', { name: 'Collect payment', exact: true })
  const voidIt = actions.getByRole('button', { name: 'Void', exact: true })
  await expect(resend).toHaveAttribute('aria-busy', 'true')
  await expect(collect).toHaveAttribute('aria-disabled', 'true')
  await expect(voidIt).toBeDisabled()
  // A line says why, and both point to it.
  await expect(actions.getByText(why, { exact: true })).toBeVisible()
  await expect(collect).toHaveAccessibleDescription(why)
  await expect(voidIt).toHaveAccessibleDescription(why)
  // The PDF and the job stay one tap away.
  await expect(actions.getByRole('button', { name: 'PDF', exact: true })).toBeEnabled()
  await expect(actions.getByRole('link', { name: 'Open job' })).toBeVisible()
  // A tap on either does nothing.
  await collect.click({ force: true })
  await voidIt.click({ force: true })
  await page.waitForTimeout(600)
  await expect(page).toHaveURL(/\/invoices\/i-rosa$/)
  await expect(actions.getByRole('button', { name: 'Tap again to void' })).toHaveCount(0)

  // The reminder lands. The screen stays, and all of it works again.
  sends[0].release()
  await expect(page.getByText('Reminder sent to rosa@example.com', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
  await expect(resend).not.toHaveAttribute('aria-busy', 'true')
  await expect(collect).not.toHaveAttribute('aria-disabled', 'true')
  await expect(voidIt).toBeEnabled()
  await expect(actions.getByText(why, { exact: true })).toHaveCount(0)

  // The same while its own Resend goes out. A tap in the beat after an
  // email lands is taken as aimed at the busy button, so this one waits.
  await page.waitForTimeout(1_000)
  await expect(resend).toBeInViewport({ ratio: 1 })
  await resend.click()
  await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(2)
  await expect(resend).toHaveAttribute('aria-busy', 'true')
  await expect(collect).toHaveAttribute('aria-disabled', 'true')
  await expect(voidIt).toBeDisabled()
  sends[1].release()
  await expect(resend).not.toHaveAttribute('aria-busy', 'true', { timeout: 15_000 })

  // Void asks with a second tap, as before, and no sheet.
  await voidIt.click()
  await expect(actions.getByRole('button', { name: 'Tap again to void' })).toBeVisible()
  await expect(page.getByRole('dialog')).toHaveCount(0)
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
    await expect(page.getByText('Remaining contract value', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Loading money', { exact: true })).toBeAttached()
  }

  // The membership arrives, and Job balances shows what is really owed.
  release()
  const aging = page.getByRole('region', { name: 'Contract balances by reference age' })
  await expect(aging.getByText('Remaining contract value', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(aging.getByText('$21,792.00', { exact: true })).toBeVisible()
  await expect(page.getByText('Loading money', { exact: true })).toHaveCount(0)
}

// An invoice with no job (D62) on Money and on its screen: the client names
// the row, what it owes is its amount less its payments, and its PDF has no
// Contract position block.
async function expectInvoiceWithoutAJob(page: Page) {
  const overdue = page.getByRole('region', { name: 'Overdue', exact: true })
  await expect(overdue.getByText('Jeff Roy', { exact: true })).toBeVisible()
  await expect(overdue.getByText('$1,000.00', { exact: true })).toBeVisible()
  await openInvoiceRow(page, 'Overdue', /^Jeff Roy/, 'i-solo')
  await expect(page.getByRole('heading', { level: 1, name: 'Gravel delivery' })).toBeVisible()
  await expect(page.locator('.fhinv-hero').getByText('$1,000.00', { exact: true })).toBeVisible()
  await expect(page.locator('.fhinv-hero').getByText('$1,200.00 invoice amount, $200.00 paid on it', { exact: true })).toBeVisible()
  await expect(page.locator('.fhinv-actions').getByRole('link', { name: 'Open client' })).toHaveAttribute('href', '/clients/cl-1')
  await expect(page.locator('.fhinv-actions').getByRole('link', { name: 'Open job' })).toHaveCount(0)
  await page.locator('.fhinv-actions').getByRole('link', { name: 'Collect payment' }).click()
  await expect(page).toHaveURL(/\/invoices\/i-solo\/payment$/)
  await expect(page.locator('#fhinv-pay-amount')).toHaveValue('1000')
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
    await expect(vault.getByText('Tracked margin', { exact: true })).toBeVisible()
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
    // Remind is a link to the remind screen.
    await expect(remindLink(page, 'Rosa Delgado')).toHaveAttribute('href', '/invoices/i-rosa/remind')
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
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('groups without rows stay out', async ({ context, page }) => {
    await openMoney(context, page, { tables: { fh_invoices: [], fh_quotes: [], fh_contacts: [CONTACTS[3]] } })
    await expect(page.getByRole('heading', { level: 2, name: 'Paid', exact: true })).toBeVisible()
    for (const title of ['Overdue', 'Due soon', 'Waiting on approval']) {
      await expect(page.getByRole('heading', { level: 2, name: title, exact: true })).toHaveCount(0)
    }
  })

  test('remind needs an email', async ({ context, page }) => {
    await openMoney(context, page, { tables: NO_EMAIL_TABLES })
    await openRemind(page, 'Priya Shah', 'i-priya')
    await expect(page.getByText('Add an email to send reminders.', { exact: true })).toBeVisible()
    await expect(sendReminderButton(page)).toBeDisabled()
    await expect(page.getByRole('link', { name: 'Open job' })).toHaveAttribute('href', '/jobs/c-priya?tab=financials')
  })

  test('Remind is a screen and sends only on tap', async ({ context, page }) => {
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

    await openRemind(page, 'Rosa Delgado', 'i-rosa')
    await expect(page.getByText('rosa@example.com', { exact: true })).toBeVisible()
    await expect(page.getByText('$1,240.00', { exact: true })).toBeVisible()
    // Opening the screen sends nothing.
    await page.waitForTimeout(800)
    expect(sends).toHaveLength(0)
    expect(uploads).toHaveLength(0)
    // The one gold button on the screen.
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(1)

    await sendReminderButton(page).click()
    await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
    const body = JSON.parse(sends[0])
    expect(body.recipient_email).toBe('rosa@example.com')
    expect(body.contact_id).toBe('c-rosa')
    expect(body.invoice_id).toBe('i-rosa')
    expect(body.amount_due).toBe(1240)
    // Once the email is out the screen leaves, back to Money.
    await expect(moneyHeading(page)).toBeVisible({ timeout: 15_000 })
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

    // The reminder asks for the same $3,000.00, on the screen and in the email.
    await openRemind(page, 'Sam Whitfield', 'i-sam-1')
    await expect(page.getByText('$3,000.00', { exact: true })).toBeVisible()
    await sendReminderButton(page).click()
    await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
    expect(JSON.parse(sends[0]).amount_due).toBe(3000)
    await expect(moneyHeading(page)).toBeVisible({ timeout: 15_000 })

    // The invoice screen shows $3,000.00, and Collect payment prefills it.
    await openInvoiceRow(page, 'Overdue', /^Sam Whitfield/, 'i-sam-1')
    await expect(page.locator('.fhinv-hero').getByText('$3,000.00', { exact: true })).toBeVisible()
    await page.locator('.fhinv-actions').getByRole('link', { name: 'Collect payment' }).click()
    await expect(page).toHaveURL(/\/invoices\/i-sam-1\/payment$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Collect payment' })).toBeVisible()
    await expect(page.locator('#fhinv-pay-amount')).toHaveValue('3000')
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
    await expect(moneyHeading(page)).toHaveCount(0)
  })

  test('empty money', async ({ context, page }) => {
    await openMoney(context, page, { tables: { fh_invoices: [], fh_payments: [] } })
    await expect(page.locator('.fhc-vault').getByText('$0.00').first()).toBeVisible()
    await expect(page.getByText('No open invoices', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Create an invoice' })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Overdue', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 2, name: 'Due soon', exact: true })).toHaveCount(0)
  })

  test('a new invoice starts on its own screen, not a picker', async ({ context, page }) => {
    await openMoney(context, page, { tables: { fh_invoices: [], fh_payments: [] } })
    // The create screen (/invoices/new, Task 8) asks for the client and an
    // optional job itself; Money only links there.
    await expect(page.getByRole('link', { name: 'Create an invoice' })).toHaveAttribute('href', '/invoices/new')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('an invoice row opens the invoice screen', async ({ context, page }) => {
    await openMoney(context, page, { tables: ONE_INVOICE_TABLES })
    await page.getByRole('region', { name: 'Due soon' }).getByRole('link', { name: /Gail Abernathy/ }).click()
    await expect(page).toHaveURL(/\/invoices\/inv-1$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Balance' })).toBeVisible()
    const actions = page.locator('.fhinv-actions')
    for (const name of ['Resend', 'PDF', 'Share link', 'Void']) {
      await expect(actions.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(actions.getByRole('link', { name: 'Collect payment' })).toHaveAttribute('href', '/invoices/inv-1/payment')
    await expect(actions.getByRole('link', { name: 'Open job' })).toHaveAttribute('href', '/jobs/c-gail?tab=financials')
    // Back returns to Money.
    await backToMoney(page)
  })

  test('Collect payment is a screen', async ({ context, page }) => {
    await openMoney(context, page, { tables: ONE_INVOICE_TABLES })
    await openInvoiceRow(page, 'Due soon', /Gail Abernathy/, 'inv-1')
    await page.locator('.fhinv-actions').getByRole('link', { name: 'Collect payment' }).click()
    await expect(page).toHaveURL(/\/invoices\/inv-1\/payment$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Collect payment' })).toBeVisible()
    await expect(page.locator('#fhinv-pay-amount')).toHaveValue('2960')
    await expect(page.getByRole('radio', { name: 'Check' })).toHaveAttribute('aria-checked', 'true')
    // The one gold button records it.
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Record $2,960.00' })).toBeEnabled()
    // Back returns to the invoice.
    await backButton(page).click()
    await expect(page).toHaveURL(/\/invoices\/inv-1$/)
  })

  test('Remind is a screen', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    await openRemind(page, 'Rosa Delgado', 'i-rosa')
    await expect(page.getByText('rosa@example.com', { exact: true })).toBeVisible()
    await expect(page.getByText('Concrete steps, Final', { exact: true })).toBeVisible()
    await expect(page.getByText('$1,240.00', { exact: true })).toBeVisible()
    await expect(sendReminderButton(page)).toBeEnabled()
    // The invoice screen links here too.
    await backToMoney(page)
    await openInvoiceRow(page, 'Overdue', /^Rosa Delgado/, 'i-rosa')
    await expect(page.locator('.fhinv-actions').getByRole('link', { name: 'Remind' })).toHaveAttribute('href', '/invoices/i-rosa/remind')
  })

  test('an invoice with no job stands on its own', async ({ context, page }) => {
    await openMoney(context, page, { tables: NO_JOB_TABLES })
    await expectInvoiceWithoutAJob(page)
  })

  test('resend sends once from the invoice screen', async ({ context, page }) => {
    await openMoney(context, page)
    const sends: string[] = []
    await context.route('**/storage/v1/object/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'job-files/test.pdf' }) })
    )
    await context.route('**/api/send-invoice', (route) => {
      sends.push(route.request().postData() || '')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    await openInvoiceRow(page, 'Due soon', /Gail Abernathy/, 'i-gail')
    await page.waitForTimeout(800)
    expect(sends).toHaveLength(0)
    const resend = page.locator('.fhinv-actions').getByRole('button', { name: 'Resend', exact: true })
    await resend.click()
    await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
    await expect(page.getByText('Invoice sent to', { exact: false }).first()).toBeVisible({ timeout: 15_000 })
    await expect(resend).not.toHaveAttribute('aria-busy', 'true')
    expect(JSON.parse(sends[0]).recipient_email).toBe('x@y.com')
    await page.waitForTimeout(800)
    expect(sends).toHaveLength(1)
  })

  test('void asks with a second tap, not a sheet', async ({ context, page }) => {
    await openMoney(context, page)
    await openInvoiceRow(page, 'Due soon', /Gail Abernathy/, 'i-gail')
    const voidIt = page.locator('.fhinv-actions').getByRole('button', { name: 'Void', exact: true })
    await voidIt.click()
    await expect(page.locator('.fhinv-actions').getByRole('button', { name: 'Tap again to void' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // The arming wears off after 4 seconds.
    await page.waitForTimeout(4_300)
    await expect(voidIt).toBeVisible()
  })

  test('a waiting quote opens its canonical quote screen', async ({ context, page }) => {
    await openMoney(context, page)
    await page.getByRole('region', { name: 'Waiting on approval' }).getByText('Marco Castellanos', { exact: true }).click()
    await expect(page).toHaveURL(/\/quotes\/q-marco$/)
  })

  test('statements, all invoices and job balances stay reachable', async ({ context, page }) => {
    await openMoney(context, page)

    // Who owes you, with a statement for each customer.
    await page.getByRole('link', { name: /^Statements/ }).click()
    await expect(page).toHaveURL(/panel=statements/)
    await expect(page.getByRole('heading', { level: 1, name: 'Who owes you' })).toBeVisible()
    await page.getByRole('button', { name: /^Statement for/ }).first().click()
    // The customer's statement screen opens (Task 14, D57); Back returns here.
    await expect(page).toHaveURL(/\/clients\/cl-1\/statement$/)
    await expect(page.getByRole('heading', { level: 1, name: /^Statement for/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/panel=statements/)
    await page.getByRole('button', { name: 'Back to Money' }).click()
    await expect(moneyHeading(page)).toBeVisible()

    // All invoices: the draft and the one due in three weeks are here, and
    // the filter keeps the old Outstanding and All choice. A row opens the
    // invoice's screen.
    await page.getByRole('link', { name: /^All invoices/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'All invoices' })).toBeVisible()
    await expect(page.getByText('Draft', { exact: true })).toBeVisible()
    await expect(page.getByText('Due Oct 29', { exact: true })).toBeVisible()
    await page.getByRole('link', { name: /Gail Abernathy.*progress draw 2/i }).click()
    await expect(page).toHaveURL(/\/invoices\/i-later$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Progress draw 2' })).toBeVisible()
    await backButton(page).click()
    await expect(page.getByRole('heading', { level: 1, name: 'All invoices' })).toBeVisible()
    await page.getByRole('radio', { name: 'All', exact: true }).click({ force: true })
    await expect(page).toHaveURL(/view=all/)
    await expect(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked()
    // All adds the paid and void invoices the Outstanding view leaves out.
    await page.getByRole('button', { name: 'Back to Money' }).click()

    // Job balances: the aging summary and a link to each job's money tab.
    await page.getByRole('link', { name: /^Job balances/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Job balances' })).toBeVisible()
    const aging = page.getByRole('region', { name: 'Contract balances by reference age' })
    for (const label of ['Up to 30 days', '31 to 60 days', 'Over 60 days']) {
      await expect(aging.getByText(label, { exact: true })).toBeVisible()
    }
    await expect(aging.getByText('Remaining contract value', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: /Rosa Delgado/ })).toHaveAttribute('href', '/jobs/c-rosa?tab=financials')
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

  test('a screen opened while another email of its invoice goes out settles when it lands', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeFirstSendsHeld(context)
    await otherScreenSettlesWhenTheEmailLands(page, true, sends)
  })

  test('collect payment and void wait while the invoice email goes out', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeHeldSends(context)
    await payAndVoidWaitForTheEmail(page, sends)
  })
})

// The desktop Money screen (Phase 4, task 4.6): the same numbers and
// the same screens as the phone, laid out as a vault card and four tables
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
    await expect(vault.getByText('Tracked margin', { exact: true })).toBeVisible()
    await expect(vault.getByText('27.5%', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Reports' })).toHaveAttribute('href', '/analytics')
    // New invoice is a link to the create screen (Task 8).
    await expect(page.getByRole('link', { name: 'New invoice', exact: true })).toHaveAttribute('href', '/invoices/new')

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
    await expect(rosa.getByText('Concrete steps, final · Invoice 2 · i-rosa', { exact: true })).toBeVisible()
    await expect(rosa.getByText('$1,240.00', { exact: true })).toBeVisible()
    await expect(rosa.getByText('6 days overdue', { exact: true })).toBeVisible()
    await expect(rosa.getByRole('link', { name: 'Remind Rosa Delgado' })).toHaveAttribute('href', '/invoices/i-rosa/remind')
    await expect(overdue.getByText('1 invoice', { exact: true })).toBeVisible()

    // Due soon: today and next Thursday, each with Open and no Remind.
    const soon = page.getByRole('region', { name: 'Due soon', exact: true })
    await expect(soon.getByText('Due today', { exact: true })).toBeVisible()
    await expect(soon.getByText('Due Oct 15', { exact: true })).toBeVisible()
    await expect(soon.getByText('2 invoices', { exact: true })).toBeVisible()
    await expect(soon.getByRole('link', { name: /^Open Lorraine Beasley/ })).toHaveAttribute('href', '/invoices/i-lorraine')
    await expect(soon.getByRole('link', { name: /^Remind/ })).toHaveCount(0)

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

    // Nothing gold on the page, and no sheet anywhere.
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('desktop remind is a screen and sends only on tap', async ({ context, page }) => {
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

    await openRemind(page, 'Rosa Delgado', 'i-rosa')
    await expect(page.getByText('rosa@example.com', { exact: true })).toBeVisible()
    await expect(page.getByText('$1,240.00', { exact: true })).toBeVisible()
    // Opening the screen sends nothing.
    await page.waitForTimeout(800)
    expect(sends).toHaveLength(0)
    expect(uploads).toHaveLength(0)

    await sendReminderButton(page).click()
    await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
    const body = JSON.parse(sends[0])
    expect(body.recipient_email).toBe('rosa@example.com')
    expect(body.contact_id).toBe('c-rosa')
    expect(body.amount_due).toBe(1240)
    await expect(moneyHeading(page)).toBeVisible({ timeout: 15_000 })
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

    await row.getByRole('link', { name: 'Remind Sam Whitfield' }).click()
    await expect(remindHeading(page)).toBeVisible()
    await expect(page.getByText('$3,000.00', { exact: true })).toBeVisible()
    await sendReminderButton(page).click()
    await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
    expect(JSON.parse(sends[0]).amount_due).toBe(3000)
    await expect(moneyHeading(page)).toBeVisible({ timeout: 15_000 })

    await overdue.getByRole('button', { name: 'Sam Whitfield', exact: true }).click()
    await expect(page).toHaveURL(/\/invoices\/i-sam-1$/)
    await expect(page.locator('.fhinv-hero').getByText('$3,000.00', { exact: true })).toBeVisible()
    await page.locator('.fhinv-actions').getByRole('link', { name: 'Collect payment' }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Collect payment' })).toBeVisible({ timeout: 15_000 })
    await expect(page.locator('#fhinv-pay-amount')).toHaveValue('3000')
  })

  test('desktop old open invoice still counts when 620 invoices outgrow the list', async ({ context, page }) => {
    await openMoney(context, page, { tables: MANY_TABLES })
    const overdue = page.getByRole('region', { name: 'Overdue', exact: true })
    await expect(overdue.getByRole('row', { name: /Rosa Delgado/ }).getByText('$1,240.00', { exact: true })).toBeVisible()
    await expect(page.locator('.fhc-vault').getByText('$1,240.00', { exact: true })).toBeVisible()
  })

  test('desktop remind needs an email', async ({ context, page }) => {
    await openMoney(context, page, { tables: NO_EMAIL_TABLES })
    await openRemind(page, 'Priya Shah', 'i-priya')
    await expect(page.getByText('Add an email to send reminders.', { exact: true })).toBeVisible()
    await expect(sendReminderButton(page)).toBeDisabled()
  })

  test('a row and its Open button open the invoice screen', async ({ context, page }) => {
    await openMoney(context, page)
    const soon = page.getByRole('region', { name: 'Due soon', exact: true })

    // A click anywhere on the row.
    await soon.getByRole('cell', { name: 'Roof repair, balance · Invoice 1 · i-gail', exact: true }).click()
    await expect(page).toHaveURL(/\/invoices\/i-gail$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const actions = page.locator('.fhinv-actions')
    for (const name of ['Resend', 'PDF', 'Share link', 'Void']) {
      await expect(actions.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(actions.getByRole('link', { name: 'Open job' })).toHaveAttribute('href', '/jobs/c-gail?tab=financials')
    await backToMoney(page)

    // The Open link in the Action column does the same.
    await soon.getByRole('link', { name: /^Open Gail Abernathy/ }).click()
    await expect(page).toHaveURL(/\/invoices\/i-gail$/)
    // Collect payment hands over to its screen.
    await actions.getByRole('link', { name: 'Collect payment' }).click()
    await expect(page).toHaveURL(/\/invoices\/i-gail\/payment$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Collect payment' })).toBeVisible({ timeout: 15_000 })
  })

  test('an overdue row opens the invoice screen from the keyboard', async ({ context, page }) => {
    await openMoney(context, page)
    const overdue = page.getByRole('region', { name: 'Overdue', exact: true })
    await overdue.getByRole('button', { name: 'Rosa Delgado', exact: true }).press('Enter')
    await expect(page).toHaveURL(/\/invoices\/i-rosa$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Final' })).toBeVisible()
  })

  test('desktop void asks with a second tap', async ({ context, page }) => {
    await openMoney(context, page)
    await page.getByRole('region', { name: 'Due soon', exact: true }).getByRole('link', { name: /^Open Gail Abernathy/ }).click()
    await expect(page).toHaveURL(/\/invoices\/i-gail$/)
    await page.locator('.fhinv-actions').getByRole('button', { name: 'Void', exact: true }).click()
    await expect(page.locator('.fhinv-actions').getByRole('button', { name: 'Tap again to void' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('desktop invoice with no job stands on its own', async ({ context, page }) => {
    await openMoney(context, page, { tables: NO_JOB_TABLES })
    await expectInvoiceWithoutAJob(page)
  })

  test('a waiting quote opens its quote screen and a paid row opens its job', async ({ context, page }) => {
    await openMoney(context, page)
    const waiting = page.getByRole('region', { name: 'Waiting on approval', exact: true })
    await expect(waiting.getByRole('link', { name: /^Open Marco Castellanos/ })).toHaveAttribute('href', '/quotes/q-marco')
    const paid = page.getByRole('region', { name: 'Paid', exact: true })
    await expect(paid.getByRole('link', { name: 'Open Darnell Whitcomb, Garage slab, deposit' })).toHaveAttribute('href', '/jobs/c-darnell?tab=financials')
    // A click on the row does what Open does.
    await waiting.getByText('Pool deck pour', { exact: true }).click()
    await expect(page).toHaveURL(/\/quotes\/q-marco$/)
  })

  test('empty money', async ({ context, page }) => {
    await openMoney(context, page, { tables: { fh_invoices: [], fh_payments: [] } })
    await expect(page.locator('.fhc-vault').getByText('$0.00').first()).toBeVisible()
    await expect(page.getByText('No open invoices', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 2, name: 'Overdue', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 2, name: 'Due soon', exact: true })).toHaveCount(0)
    // An invoice starts on its own screen, from the empty state or the toolbar.
    await expect(page.getByRole('link', { name: 'Create an invoice' })).toHaveAttribute('href', '/invoices/new')
    await expect(page.getByRole('link', { name: 'New invoice', exact: true })).toHaveAttribute('href', '/invoices/new')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('crew cannot open money', async ({ context, page }) => {
    await signIn(context, { role: 'crew', tables: TABLES })
    await page.goto('/invoices', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await page.waitForURL((url) => !url.pathname.startsWith('/invoices'), { timeout: 30_000 })
    await expect(moneyHeading(page)).toHaveCount(0)
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
    await expect(page).toHaveURL(/\/clients\/cl-1\/statement$/)
    await expect(page.getByRole('heading', { level: 1, name: /^Statement for/ })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/panel=statements/)
    await page.getByRole('button', { name: 'Back to Money' }).click()
    await expect(moneyHeading(page)).toBeVisible()

    // All invoices: drafts and invoices due later are here, with the old
    // Outstanding and All choice. Open goes to the invoice's screen.
    await page.getByRole('link', { name: /^All invoices/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'All invoices' })).toBeVisible()
    await expect(page.getByText('Draft', { exact: true })).toBeVisible()
    await expect(page.getByText('Due Oct 29', { exact: true })).toBeVisible()
    await page.getByRole('row', { name: /Gail Abernathy.*progress draw 2/i }).getByRole('link', { name: /^Open/ }).click()
    await expect(page).toHaveURL(/\/invoices\/i-later$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Progress draw 2' })).toBeVisible()
    await backButton(page).click()
    await expect(page.getByRole('heading', { level: 1, name: 'All invoices' })).toBeVisible()
    await page.getByRole('radio', { name: 'All', exact: true }).click({ force: true })
    await expect(page).toHaveURL(/view=all/)
    await expect(page.getByRole('radio', { name: 'All', exact: true })).toBeChecked()
    await page.getByRole('button', { name: 'Back to Money' }).click()

    // Job balances: the aging summary, a sortable table with each job's
    // balance, Log payment, and the CSV export.
    await page.getByRole('link', { name: /^Job balances/ }).click()
    await expect(page.getByRole('heading', { level: 1, name: 'Job balances' })).toBeVisible()
    const aging = page.getByRole('region', { name: 'Contract balances by reference age' })
    for (const label of ['Up to 30 days', '31 to 60 days', 'Over 60 days']) {
      await expect(aging.getByText(label, { exact: true })).toBeVisible()
    }
    await expect(aging.getByText('Remaining contract value', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Rosa Delgado', exact: true })).toHaveAttribute('href', '/jobs/c-rosa?tab=financials')
    await page.getByRole('button', { name: 'Sort by Balance' }).click()
    await page.getByRole('button', { name: 'Log payment for Rosa Delgado' }).click()
    // Log payment is the job's payment screen (Task 14, D57).
    await expect(page).toHaveURL(/\/jobs\/[^/]+\/payment$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Log payment' })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('dialog')).toHaveCount(0)
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

  test('desktop screen opened while another email of its invoice goes out settles when it lands', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeFirstSendsHeld(context)
    await otherScreenSettlesWhenTheEmailLands(page, false, sends)
  })

  test('desktop collect payment and void wait while the invoice email goes out', async ({ context, page }) => {
    await openMoney(context, page, { tables: TWO_OVERDUE_TABLES })
    const sends = await routeHeldSends(context)
    await payAndVoidWaitForTheEmail(page, sends)
  })

  test('desktop new invoice is a link while money loads', async ({ context, page }) => {
    await signIn(context, { tables: TABLES })
    const release = await holdRequests(context, '**/rest/v1/fh_invoices**')
    await page.clock.setFixedTime(MORNING)
    await page.goto('/invoices', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(moneyHeading(page)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Loading money', { exact: true })).toBeAttached()

    // The toolbar link works at once: the create screen asks for the client
    // and the job itself, so nothing here waits for the jobs.
    await expect(page.getByRole('link', { name: 'New invoice', exact: true })).toHaveAttribute('href', '/invoices/new')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    release()
    await expect(page.getByRole('region', { name: 'Overdue', exact: true })).toBeVisible({ timeout: 15_000 })
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
    await expect(moneyHeading(page)).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Loading money', { exact: true })).toBeAttached()
    expect(await page.locator('.fhc-skel').count()).toBeGreaterThan(3)
    // No number and no count stands in for data that has not arrived.
    await expect(page.getByText('$0.00', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Remaining contract value', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Nobody owes you', { exact: true })).toHaveCount(0)
    await expect(page.getByText('0 open', { exact: true })).toHaveCount(0)
    await expect(page.getByText('0 jobs with a balance', { exact: true })).toHaveCount(0)

    release()
    const aging = page.getByRole('region', { name: 'Contract balances by reference age' })
    await expect(aging.getByText('Remaining contract value', { exact: true })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByRole('link', { name: /^All invoices/ })).toContainText('5 open')
    await expect(page.getByRole('link', { name: /^Statements/ })).toContainText('1 customer owes you')
  })
})
