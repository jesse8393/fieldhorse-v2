// The Money screen on a phone (docs/design/2026-10-redesign/SPEC.md,
// section 9.7, decision D6): the vault card, the four groups, a Remind
// button that sends only when it is tapped, the invoice actions in a sheet,
// and everything the old screen offered still one tap away.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
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
  options: Omit<SignInOptions, 'tables'> & { tables?: SignInOptions['tables'] } = {}
) {
  await signIn(context, { ...options, tables: { ...TABLES, ...options.tables } })
  await page.clock.setFixedTime(MORNING)
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
})
