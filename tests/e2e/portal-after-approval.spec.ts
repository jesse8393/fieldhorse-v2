// The customer page after approval, continued (Phase 8 follow up B, on top
// of decisions D22, D24, D31 and D44): the headline says where the quote
// stands, What happens next leaves out what the customer has already done,
// a job closed out after approval promises nothing more, and the company
// is called by a name that stands on its own.
//
// The page is public, so its tests do not sign in. /api/public-link is
// routed to a proposal payload, the same pattern as portal.spec.ts, and the
// approve and request changes endpoints are spies, so nothing is ever sent
// except by a tap the test makes. Any other /api request, or any request to
// a Supabase host, fails the test. The last test signs in to the mocked
// project instead, to open the in app "Preview as", which draws the same
// page from the job.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn'

type Overrides = {
  /** The quote's own status (fh_quotes.status); defaults to the contact block's proposal_status. */
  status?: string
  contact?: Record<string, unknown>
  company?: Record<string, unknown>
  payments?: Array<Record<string, unknown>>
  items?: typeof ITEMS
}

const ITEMS = [
  { id: 'i1', section: 'Site', description: 'Excavate and grade, 1,100 sq ft', qty: 1, rate: 2200, amount: 2200, is_optional: false, is_excluded: false, sort_order: 1 },
  { id: 'i2', section: 'Steel', description: 'Rebar, #4 at 18 in on center', qty: 1, rate: 2860, amount: 2860, is_optional: false, is_excluded: false, sort_order: 2 },
  { id: 'i3', section: 'Concrete', description: '4 in slab, 4,000 psi fiber mix, broom finish', qty: 1, rate: 9350, amount: 9350, is_optional: false, is_excluded: false, sort_order: 3 },
  { id: 'i4', section: 'Finish', description: 'Joints, pump truck and haul off', qty: 1, rate: 4048, amount: 4048, is_optional: false, is_excluded: false, sort_order: 4 },
  { id: 'i5', section: 'Finish', description: 'Stamped ashlar pattern', qty: 1, rate: 4950, amount: 4950, is_optional: true, is_excluded: false, sort_order: 5 },
  { id: 'i6', section: 'Site', description: 'Fence removal', qty: 1, rate: 700, amount: 700, is_optional: false, is_excluded: true, sort_order: 6 }
]

// $18,458.00 of base lines, so the default schedule's deposit is $9,229.00.
// The link points at an fh_quotes row (Task 11): the payload carries the
// quote id and the quote's status, and keeps the contact block the page
// has always read, with the client standing in for the contact.
function proposalPayload({ status, contact = {}, company = {}, payments = [], items = ITEMS }: Overrides = {}) {
  const contactBlock = {
    id: 'q-portal',
    name: 'Marco Castellanos',
    address: '1150 Cherry Blossom Ln, La Vergne',
    phone: '615 555 0101',
    email: 'marco@example.com',
    job_title: 'Pool deck pour',
    stage: 'quote',
    proposal_status: 'sent',
    amount: 18458,
    created_at: '2026-10-01T12:00:00.000Z',
    quote_sent_at: '2026-10-02T12:00:00.000Z',
    terms_text: '',
    ...contact
  }
  return {
    ok: true,
    kind: 'proposal',
    quote_id: 'q-portal',
    status: status ?? contactBlock.proposal_status,
    contact: contactBlock,
    company: {
      name: 'Parker Construction',
      phone: '615 555 0100',
      email: 'office@parker.co',
      insured_text: 'Licensed and insured',
      license_number: '',
      logo_url: null,
      estimate_template: 'fieldhorse',
      payment_link: '',
      ...company
    },
    items,
    payments,
    changeOrders: [],
    insurance: null,
    invoices: [],
    photos: []
  }
}

type Payload = ReturnType<typeof proposalPayload>

const LINK = { payment_link: 'venmo.com/u/parker' }
const DEPOSIT_IN = [{ id: 'p1', amount: 9229, kind: 'deposit', paid_on: '2026-10-09' }]
const PART = [{ id: 'p1', amount: 5000, kind: 'deposit', paid_on: '2026-10-08' }]
// The deposit and the final payment: the whole $18,458.00.
const PAID_IN_FULL = [...DEPOSIT_IN, { id: 'p2', amount: 9229, kind: 'final', paid_on: '2026-10-12' }]

type Spies = {
  approve: Array<Record<string, unknown>>
  requestChanges: Array<Record<string, unknown>>
  stray: string[]
  setPayload: (next: Payload) => void
  /** The link stops answering (a 404) right after the next approval. */
  dropLinkAfterApproval: () => void
}

// Serves /api/public-link?token=t1 and records everything else.
async function mockPortal(context: BrowserContext, initial: Payload): Promise<Spies> {
  let current = initial
  let linkDown = false
  let dropAfterApproval = false
  const spies: Spies = {
    approve: [],
    requestChanges: [],
    stray: [],
    setPayload: (next) => { current = next },
    dropLinkAfterApproval: () => { dropAfterApproval = true }
  }

  // Registered first, so every specific route below wins over it.
  await context.route((url) => url.pathname.startsWith('/api/'), async (route) => {
    spies.stray.push(route.request().url())
    await route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' })
  })
  await context.route(/supabase\.co/, async (route) => {
    spies.stray.push(route.request().url())
    await route.abort()
  })
  await context.route(
    (url) => url.pathname === '/api/public-link' && url.searchParams.get('token') === 't1',
    async (route) => {
      await route.fulfill({
        status: linkDown ? 404 : 200,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify(linkDown ? { ok: false, error: 'not_found', message: 'This link is no longer available.' } : current)
      })
    }
  )
  await context.route('**/api/public-link-approve', async (route) => {
    const body = route.request().postDataJSON()
    spies.approve.push(body)
    // What the server does: the quote is approved from now on.
    current = proposalPayload({
      status: 'approved',
      contact: { ...current.contact, proposal_status: 'approved' },
      company: current.company,
      payments: current.payments
    })
    if (dropAfterApproval) linkDown = true
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, signed_by: body.signature_name, approved_at: '2026-10-10T14:00:00.000Z' })
    })
  })
  await context.route('**/api/public-link-request-changes', async (route) => {
    spies.requestChanges.push(route.request().postDataJSON())
    await route.fulfill({ status: 409, contentType: 'application/json', body: '{"ok":false,"error":"already_approved"}' })
  })
  return spies
}

async function openPortal(page: Page) {
  await page.goto('/p/t1', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

const steps = (page: Page) => page.getByRole('list', { name: 'What happens next' }).getByRole('listitem')
const headline = (page: Page) => page.getByRole('heading', { level: 1 })
const total = (page: Page) => page.getByRole('region', { name: 'Total' })
const capsule = (page: Page) => page.getByRole('region', { name: 'Approval' })

test.beforeEach(async ({ context, page }) => {
  await context.addInitScript(() => {
    try { localStorage.setItem('fh:theme-mode', 'day') } catch { /* private window */ }
  })
  // October 10, so a quote valid until October 5 has expired.
  await page.clock.setFixedTime(new Date('2026-10-10T14:00:00.000Z'))
})

test('an approved quote with the deposit received says approved and lists only what is left', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload({
    contact: { proposal_status: 'approved', stage: 'job' },
    company: LINK,
    payments: DEPOSIT_IN
  }))
  await openPortal(page)

  await expect(headline(page)).toHaveText('Hi Marco, your quote is approved.')
  // Approving and paying the deposit are done, so the steps start at the
  // start date and the balance stays named.
  await expect(steps(page)).toHaveText([
    'Parker sends you a start date.',
    'You pay 40% at material delivery and 10% at completion.'
  ])
  await expect(page.getByText(/You approve/)).toHaveCount(0)
  await expect(page.getByText('You pay the deposit.', { exact: true })).toHaveCount(0)

  // D44 as it was: Deposit received, its note under the total, and no pay button.
  await expect(capsule(page).getByText('Approved', { exact: true })).toBeVisible()
  await expect(capsule(page).getByText('Deposit received', { exact: true })).toBeVisible()
  await expect(capsule(page).getByText('Parker Construction has your approval and your $9,229.00 deposit, and will be in touch with your start date.')).toBeVisible()
  await expect(total(page).getByText('Deposit of $9,229.00 received.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Pay / })).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Make a payment' })).toHaveCount(0)

  expect(spies.approve).toHaveLength(0)
  expect(spies.requestChanges).toHaveLength(0)
  expect(spies.stray).toEqual([])
})

test('a finished job promises no start date and no next steps, and its payment link reads Make a payment until the deposit is in', async ({ page, context }) => {
  // Closeout moved the job to closed and left the quote approved. Nothing
  // recorded as paid: before, this asked for a $9,229.00 deposit.
  const finished = { proposal_status: 'approved', stage: 'closed' }
  const spies = await mockPortal(context, proposalPayload({ contact: finished, company: LINK }))
  await openPortal(page)

  await expect(headline(page)).toHaveText('Hi Marco, your quote is approved.')
  await expect(total(page).getByText('$18,458.00', { exact: true })).toBeVisible()
  // No deposit sentence under the total, and no next steps.
  await expect(total(page).getByText(/deposit|due|start date|paid/i)).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'What happens next' })).toHaveCount(0)
  await expect(page.getByText(/start date|next steps/)).toHaveCount(0)
  await expect(page.getByText(/Pay \$/)).toHaveCount(0)

  await expect(capsule(page).getByText('Approved', { exact: true })).toBeVisible()
  await expect(capsule(page).getByText('Parker Construction has your approval.', { exact: true })).toBeVisible()
  const pay = page.getByRole('link', { name: 'Make a payment' })
  await expect(pay).toBeVisible()
  await expect(pay).toHaveAttribute('href', 'https://venmo.com/u/parker')
  await expect(pay).toHaveAttribute('target', '_blank')
  await expect(page.getByRole('link', { name: /Pay deposit|Pay remaining deposit/ })).toHaveCount(0)
  // Still nothing to ask and nothing to approve.
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Ask about this|question first/ })).toHaveCount(0)

  // With the deposit in, the capsule still says so, the page still
  // promises nothing, and it asks for no money (D44: once the deposit is
  // received no pay button shows). Paid in full, the same.
  for (const payments of [DEPOSIT_IN, PAID_IN_FULL]) {
    spies.setPayload(proposalPayload({ contact: finished, company: LINK, payments }))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(headline(page)).toHaveText('Hi Marco, your quote is approved.')
    await expect(capsule(page).getByText('Deposit received', { exact: true })).toBeVisible()
    await expect(capsule(page).getByText('Parker Construction has your approval.', { exact: true })).toBeVisible()
    await expect(total(page).getByText(/deposit|due|start date|paid/i)).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'What happens next' })).toHaveCount(0)
    await expect(page.getByText(/start date|next steps/)).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Make a payment' })).toHaveCount(0)
    await expect(capsule(page).getByRole('link')).toHaveCount(0)
  }

  // Part paid, the button that asked for the rest of the deposit asks
  // for a payment instead.
  spies.setPayload(proposalPayload({ contact: finished, company: LINK, payments: PART }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(capsule(page).getByText('Parker Construction has your approval.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Make a payment' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Pay deposit|Pay remaining deposit/ })).toHaveCount(0)

  // Without a payment link there is no button at all.
  spies.setPayload(proposalPayload({ contact: finished }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(capsule(page).getByText('Parker Construction has your approval.', { exact: true })).toBeVisible()
  await expect(capsule(page).getByRole('link')).toHaveCount(0)

  expect(spies.approve).toHaveLength(0)
  expect(spies.requestChanges).toHaveLength(0)
  expect(spies.stray).toEqual([])
})

// On terms with no deposit there is no deposit to be received, so the
// button read "Make a payment" whatever was paid, and paying the contract
// in full is what closes such a job out (Phase 8 follow up B, second
// review). Paid in full, a finished job asks for nothing.
test('a finished job on terms with no deposit asks for no payment once it is paid in full', async ({ page, context }) => {
  const finished = { proposal_status: 'approved', stage: 'closed', terms_text: 'No deposit required. Net 30 after completion.' }
  const FULL = [{ id: 'p1', amount: 18458, kind: 'final', paid_on: '2026-10-12' }]
  const spies = await mockPortal(context, proposalPayload({ contact: finished, company: LINK, payments: FULL }))
  await openPortal(page)
  await expect(headline(page)).toHaveText('Hi Marco, your quote is approved.')
  await expect(capsule(page).getByText('Parker Construction has your approval.', { exact: true })).toBeVisible()
  await expect(capsule(page).getByRole('link')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Make a payment' })).toHaveCount(0)

  // With part of it paid, it still offers one.
  spies.setPayload(proposalPayload({ contact: finished, company: LINK, payments: PART }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(capsule(page).getByText('Parker Construction has your approval.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Make a payment' })).toBeVisible()
  expect(spies.stray).toEqual([])
})

test('an approved quote with the deposit still due asks for the deposit first', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload({ contact: { proposal_status: 'approved' }, company: LINK }))
  await openPortal(page)

  await expect(headline(page)).toHaveText('Hi Marco, your quote is approved.')
  await expect(steps(page)).toHaveText([
    'You pay the deposit.',
    'Parker sends you a start date.',
    'You pay 40% at material delivery and 10% at completion.'
  ])
  await expect(page.getByRole('link', { name: 'Pay deposit $9,229.00' })).toBeVisible()

  // Part paid: the same first step, and the pay button for the rest (D44).
  spies.setPayload(proposalPayload({ contact: { proposal_status: 'approved' }, company: LINK, payments: PART }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(steps(page)).toHaveText([
    'You pay the deposit.',
    'Parker sends you a start date.',
    'You pay 40% at material delivery and 10% at completion.'
  ])
  await expect(page.getByRole('link', { name: 'Pay remaining deposit $4,229.00' })).toBeVisible()

  // No deposit due: the steps start with the start date.
  spies.setPayload(proposalPayload({ contact: { proposal_status: 'approved', terms_text: 'No deposit required. Net 30 after completion.' }, company: LINK }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(steps(page)).toHaveText([
    'Parker sends you a start date.',
    'You pay as the payment terms say.'
  ])
  await expect(page.getByRole('link', { name: 'Make a payment' })).toBeVisible()
  expect(spies.stray).toEqual([])
})

test('approving on the page turns the headline to approved, unless the page cannot read the link again', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  await expect(headline(page)).toHaveText('Hi Marco, your quote is ready.')
  await expect(steps(page).first()).toHaveText('You approve and pay the deposit.')

  await page.getByLabel('Your full name').fill('Marco Castellanos')
  await page.getByRole('checkbox', { name: /I have the authority to approve this proposal/ }).check()
  await page.getByRole('button', { name: 'Approve this quote' }).click()
  await expect.poll(() => spies.approve.length).toBe(1)

  // The page reads the link again: approved, with the deposit still to pay.
  await expect(headline(page)).toHaveText('Hi Marco, your quote is approved.')
  await expect(steps(page)).toHaveText([
    'You pay the deposit.',
    'Parker sends you a start date.',
    'You pay 40% at material delivery and 10% at completion.'
  ])

  // A reread that fails keeps the quote the page already shows, open, so
  // its headline stays as it was beside the thanks.
  const second = await context.newPage()
  await second.clock.setFixedTime(new Date('2026-10-10T14:00:00.000Z'))
  spies.setPayload(proposalPayload())
  spies.dropLinkAfterApproval()
  await openPortal(second)
  await second.getByLabel('Your full name').fill('Marco Castellanos')
  await second.getByRole('checkbox', { name: /I have the authority to approve this proposal/ }).check()
  // The read before the approval works; the one after it is refused.
  const failedReread = second.waitForResponse((r) => new URL(r.url()).pathname === '/api/public-link' && r.status() === 404)
  await second.getByRole('button', { name: 'Approve this quote' }).click()
  await expect.poll(() => spies.approve.length).toBe(2)
  await expect(second.getByText('Thanks, Marco.')).toBeVisible()
  // Only once the page has read that answer does the headline say what a
  // failed reread leaves: the open quote's, as before.
  const refused = await failedReread
  await refused.finished()
  await second.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
  await expect(headline(second)).toHaveText('Hi Marco, your quote is ready.')
  await expect(second.getByText('Thanks, Marco.')).toBeVisible()
  expect(spies.stray).toEqual([])
})

test('the headline reads here is your quote while changes are requested, after expiry and once closed', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload({ contact: { proposal_status: 'changes_requested' } }))
  await openPortal(page)
  await expect(headline(page)).toHaveText('Hi Marco, here is your quote.')
  // The steps while it waits stay as D44 has them.
  await expect(steps(page).first()).toHaveText('Parker sends you a revised proposal.')

  spies.setPayload(proposalPayload({ contact: { quote_expires_at: '2026-10-06T04:59:59.999Z' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('region', { name: 'Quote expired' })).toBeVisible()
  await expect(headline(page)).toHaveText('Hi Marco, here is your quote.')

  spies.setPayload(proposalPayload({ contact: { stage: 'lost' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('region', { name: 'Quote closed' })).toBeVisible()
  await expect(headline(page)).toHaveText('Hi Marco, here is your quote.')

  // A company still gets Hi there.
  spies.setPayload(proposalPayload({ contact: { name: 'MMC Properties', stage: 'closed' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(headline(page)).toHaveText('Hi there, here is your quote.')
  expect(spies.stray).toEqual([])
})

test('an approved quote whose job was marked lost reads as approved, not as a finished job', async ({ page, context }) => {
  // What a lost job that was approved should say is Jesse's call; until
  // then it reads as any approved quote does.
  const spies = await mockPortal(context, proposalPayload({ contact: { proposal_status: 'approved', stage: 'lost' }, company: LINK }))
  await openPortal(page)
  await expect(headline(page)).toHaveText('Hi Marco, your quote is approved.')
  await expect(steps(page)).toHaveText([
    'You pay the deposit.',
    'Parker sends you a start date.',
    'You pay 40% at material delivery and 10% at completion.'
  ])
  await expect(capsule(page).getByText('Parker Construction has your approval and will be in touch with next steps.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pay deposit $9,229.00' })).toBeVisible()
  expect(spies.stray).toEqual([])
})

test('a company is called by its first word only when that word stands alone', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload({ company: { name: 'The Concrete Guys' } }))
  await openPortal(page)
  await expect(page.getByRole('button', { name: 'Ask The Concrete Guys a question first' })).toBeVisible()
  await expect(steps(page).nth(1)).toHaveText('The Concrete Guys sends you a start date.')
  await expect(page.getByText(/\bThe sends\b|Ask The a /)).toHaveCount(0)

  spies.setPayload(proposalPayload({ company: { name: 'Smith & Sons Paving' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Ask Smith & Sons Paving a question first' })).toBeVisible()
  await expect(steps(page).nth(1)).toHaveText('Smith & Sons Paving sends you a start date.')

  // After approval, the first step names the company in full too.
  spies.setPayload(proposalPayload({ contact: { proposal_status: 'approved' }, company: { name: 'The Concrete Guys' }, payments: DEPOSIT_IN }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(steps(page).first()).toHaveText('The Concrete Guys sends you a start date.')

  // A first word that stands alone is still the short name.
  spies.setPayload(proposalPayload())
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('button', { name: 'Ask Parker a question first' })).toBeVisible()
  await expect(steps(page).nth(1)).toHaveText('Parker sends you a start date.')
  expect(spies.approve).toHaveLength(0)
  expect(spies.requestChanges).toHaveLength(0)
  expect(spies.stray).toEqual([])
})

// Task 11: the link resolves the quote record, so the payload's own status
// is what the page reads, and the number on the page is seeded by the quote
// id (q-portal), not by whatever id the contact block carries.
test('the page reads the quote record: its status and its id drive the headline and the number', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload({ status: 'approved', contact: { id: 'c-elsewhere', proposal_status: 'sent' }, company: LINK, payments: DEPOSIT_IN }))
  await openPortal(page)
  await expect(headline(page)).toHaveText('Hi Marco, your quote is approved.')
  await expect(page.getByText('Quote PC-2026-RTAL', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)

  spies.setPayload(proposalPayload({ status: 'changes_requested', contact: { id: 'c-elsewhere', proposal_status: 'sent' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(headline(page)).toHaveText('Hi Marco, here is your quote.')
  await expect(steps(page).first()).toHaveText('Parker sends you a revised proposal.')
  expect(spies.approve).toHaveLength(0)
  expect(spies.stray).toEqual([])
})

// "Preview as" says it is what the customer sees, and draws this page from
// the job (the Fieldhorse theme, D22). The customer page reads the job's
// payments, so the preview reads them too: an approved quote with its
// deposit in shows the same steps and the same capsule in both.

// An approved $3,150.00 quote with half of it, the deposit the default
// terms name, paid, for the signed in "Preview as" tests below.
function previewTables() {
  const line = (id: string, description: string, amount: number, sort_order: number) => ({
    id, user_id: 'qa-user-1', contact_id: 'c-quote', section: null, description, qty: 1, unit: null,
    rate: amount, amount, notes: null, is_optional: false, is_excluded: false, sort_order
  })
  return {
    profiles: [{
      user_id: 'qa-user-1', full_name: 'Jesse Parker', company_name: 'Parker Construction Company',
      onboarded_at: '2026-07-10T14:00:00.000Z', logo_url: null, company_email: 'office@parker.co',
      brand_accent_hex: null, estimate_template: 'fieldhorse', preferences: {}
    }],
    fh_contacts: [{
      id: 'c-quote', stage: 'quote', name: 'MMC Properties', job_title: 'Parking lot repour', amount: 3150,
      proposal_status: 'approved', quote_sent_at: '2026-10-02T12:00:00.000Z', user_id: 'qa-user-1',
      client_id: 'cl-1', phone: '555-0101', email: 'x@y.com', address: '412 Burkitt Station Rd',
      notes: null, scope_text: null, terms_text: null, milestones: [], follow_up_on: null,
      created_at: '2026-10-01T12:00:00.000Z', updated_at: '2026-10-09T12:00:00.000Z',
      completed_at: null, invoice_no: null, client_name: 'Jeff Roy',
      fh_clients: { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }
    }],
    fh_quote_items: [line('qi1', 'Excavate and grade', 2200, 0), line('qi2', 'Pump truck', 950, 1)],
    // Half of the $3,150.00 total, the deposit the default terms name.
    fh_payments: [{ id: 'pd1', user_id: 'qa-user-1', contact_id: 'c-quote', amount: 1575, kind: 'deposit', method: 'check', reference: '2210', paid_on: '2026-10-09', created_at: '2026-10-09T15:00:00.000Z' }]
  }
}

// Sends and links are never called from the preview; any call is recorded.
async function spyOnSends(context: BrowserContext) {
  const sends: string[] = []
  await context.route(/\/api\/(send-|docusign-send|public-link)/, (route) => {
    sends.push(route.request().url())
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{"ok":false}' })
  })
  return sends
}

async function openPreviewAs(page: Page) {
  await page.goto('/quotes/c-quote?tab=quote', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fhq-page')).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Preview as MMC Properties' }).click()
  return page.getByRole('dialog', { name: 'Proposal preview' })
}

// What the preview shows once it has read the payments: the deposit is in.
async function expectDepositIn(preview: Locator) {
  await expect(preview.getByRole('heading', { level: 1 })).toHaveText('Hi there, your quote is approved.', { timeout: 15_000 })
  // Approving and paying the deposit are done, as on the customer page.
  await expect(preview.getByRole('list', { name: 'What happens next' }).getByRole('listitem')).toHaveText([
    'Parker sends you a start date.',
    'You pay 40% at material delivery and 10% at completion.'
  ])
  await expect(preview.getByRole('region', { name: 'Total' }).getByText('Deposit of $1,575.00 received.', { exact: true })).toBeVisible()
  const approval = preview.getByRole('region', { name: 'Approval' })
  await expect(approval.getByText('Deposit received', { exact: true })).toBeVisible()
  await expect(approval.getByText('Parker Construction Company has your approval and your $1,575.00 deposit, and will be in touch with your start date.')).toBeVisible()
  await expect(preview.getByText('You pay the deposit.', { exact: true })).toHaveCount(0)
}

// Nothing in the preview reads as if nothing were paid.
async function expectNothingUnpaid(preview: Locator) {
  await expect(preview.getByRole('heading', { level: 1 })).toHaveCount(0)
  await expect(preview.getByRole('region', { name: 'Total' })).toHaveCount(0)
  await expect(preview.getByRole('region', { name: 'Approval' })).toHaveCount(0)
  await expect(preview.getByText(/to reserve your start date|You pay the deposit\.|Pay deposit/)).toHaveCount(0)
}

test('the in app preview shows an approved quote with its deposit in as the customer page does', async ({ context, page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Preview as is on the phone quote page; the desktop Document view draws the same preview pane')
  const sends = await spyOnSends(context)
  await signIn(context, { tables: previewTables() })
  const preview = await openPreviewAs(page)
  await expectDepositIn(preview)
  expect(sends).toEqual([])
})

// The preview drew the quote as if nothing were paid while the payments
// read was out, and for good when it failed: a deposit to pay, "You pay
// the deposit." and no Deposit received chip (Phase 8 follow up B, second
// review). It waits for the read as it waits for the photos, and a read
// that fails says so, with Try again, and draws no quote.
test('the in app preview waits for the payments, and says so when it cannot read them instead of showing nothing paid', async ({ context, page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Preview as is on the phone quote page; the desktop Document view draws the same preview pane')
  const sends = await spyOnSends(context)
  await signIn(context, { tables: previewTables() })
  // The preview's read of the job's payments: held until released, refused,
  // or answered by the mock. Registered after the mock, so it goes first.
  let answer: 'hold' | 'fail' | 'answer' = 'hold'
  let release: () => void = () => {}
  const released = new Promise<void>((resolve) => { release = resolve })
  const reads: string[] = []
  await context.route(
    (url) => url.pathname.endsWith('/rest/v1/fh_payments') && url.searchParams.get('select') === 'id,amount,kind,paid_on',
    async (route) => {
      const now = answer
      reads.push(now)
      if (now === 'hold') await released
      if (now === 'fail') {
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ code: 'XX000', message: 'Service unavailable' }) })
        return
      }
      await route.fallback()
    }
  )

  let preview = await openPreviewAs(page)
  // While the read is out: the wait, never the quote with nothing paid.
  // (React's strict mode reads twice as the pane mounts in development.)
  await expect.poll(() => reads.length).toBeGreaterThan(0)
  await expect(preview.getByText('Loading preview…')).toBeVisible()
  await expectNothingUnpaid(preview)
  release()
  await expectDepositIn(preview)
  await expect(preview.getByText('Loading preview…')).toHaveCount(0)

  // A read that fails says so, with Try again, and draws no quote.
  answer = 'fail'
  preview = await openPreviewAs(page)
  await expect(preview.getByRole('alert')).toContainText("Couldn't load the payments")
  await expect(preview.getByText('Loading preview…')).toHaveCount(0)
  await expectNothingUnpaid(preview)

  // Try again reads them again.
  const failedReads = reads.length
  expect(reads.slice(failedReads - 1)).toEqual(['fail'])
  answer = 'answer'
  await preview.getByRole('button', { name: 'Try again' }).click()
  await expectDepositIn(preview)
  await expect(preview.getByRole('alert')).toHaveCount(0)
  expect(reads.slice(failedReads)).toEqual(['answer'])
  expect(sends).toEqual([])
})

// Bullet 4 keeps a company's whole name where its first word cannot stand
// alone, and an fh Button holds its label on one line. In the capsule's
// one column grid the widest label set the width of every button, so a
// long name pushed the gold Approve button and the question link past the
// capsule and off a phone, with the question cut short (Phase 8 follow up
// B, second review). Every capsule control must end inside the capsule's
// padding and show its whole label, at every phone width, in every
// capsule: approving, asking, expired, and approved with a deposit to pay.
type ControlFit = {
  label: string
  left: number
  right: number
  labelLeft: number
  labelRight: number
  innerLeft: number
  innerRight: number
  cut: boolean
}

function capsuleControls(page: Page): Promise<ControlFit[]> {
  return page.evaluate(() => {
    const capsule = document.querySelector('.fhp-capsule')
    if (!capsule) return []
    const box = capsule.getBoundingClientRect()
    const style = getComputedStyle(capsule)
    const innerLeft = box.left + parseFloat(style.paddingLeft)
    const innerRight = box.right - parseFloat(style.paddingRight)
    return [...capsule.querySelectorAll<HTMLElement>('.fhc-btn')].map((control) => {
      const text = control.querySelector<HTMLElement>('.fhc-btn__text') || control
      const r = control.getBoundingClientRect()
      const t = text.getBoundingClientRect()
      return {
        label: (control.textContent || '').trim(),
        left: r.left,
        right: r.right,
        labelLeft: t.left,
        labelRight: t.right,
        innerLeft,
        innerRight,
        cut: text.scrollWidth > text.clientWidth + 1
      }
    })
  })
}

function misfits(controls: ControlFit[], where: string): string[] {
  const px = (n: number) => n.toFixed(1)
  const out: string[] = []
  if (controls.length === 0) out.push(`${where}: no capsule controls to measure`)
  for (const c of controls) {
    const at = `${where}, "${c.label}"`
    if (c.left < c.innerLeft - 0.5 || c.right > c.innerRight + 0.5) {
      out.push(`${at} runs ${px(c.left)} to ${px(c.right)}, the capsule holds ${px(c.innerLeft)} to ${px(c.innerRight)}`)
    }
    if (c.labelLeft < c.left - 0.5 || c.labelRight > c.right + 0.5) out.push(`${at}: its label runs past the button`)
    if (c.cut) out.push(`${at}: its label is cut short`)
  }
  return out
}

test('every capsule button stays inside the capsule and shows its whole label, whatever the company is called', async ({ page, context }, testInfo) => {
  test.setTimeout(150_000)
  const phone = testInfo.project.name.startsWith('mobile')
  const WIDTHS = phone ? [320, 360, 390, 412] : [900, 1280]
  const NAMES = [
    'Smith & Sons Paving Company',
    'Mr. Handyman of Nashville',
    'The Roof Doctor of Middle Tennessee',
    'The Concrete Guys',
    'Parker Construction'
  ]
  // A $218,458.00 job: after $5,000.00, $104,229.00 of the deposit is left.
  const BIG = [{ ...ITEMS[0], rate: 218458, amount: 218458 }]
  const spies = await mockPortal(context, proposalPayload())
  const problems: string[] = []
  const look = async (where: string) => {
    await page.evaluate(() => document.fonts.ready)
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))))
    problems.push(...misfits(await capsuleControls(page), where))
  }

  await openPortal(page)
  for (const name of NAMES) {
    const states: Array<[string, Payload]> = [
      ['open', proposalPayload({ company: { name } })],
      ['expired', proposalPayload({ contact: { quote_expires_at: '2026-10-06T04:59:59.999Z' }, company: { name } })],
      ['approved with part of the deposit paid', proposalPayload({ contact: { proposal_status: 'approved' }, company: { ...LINK, name }, payments: PART, items: BIG })]
    ]
    for (const [state, payload] of states) {
      spies.setPayload(payload)
      await page.setViewportSize({ width: WIDTHS[0], height: phone ? 844 : 900 })
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(headline(page)).toBeVisible()
      for (const width of WIDTHS) {
        await page.setViewportSize({ width, height: phone ? 844 : 900 })
        await look(`${width} px, ${state}, ${name}`)
        if (state === 'open') {
          // Asking: Back and Send request side by side.
          await page.getByRole('button', { name: /a question first$/ }).click()
          await expect(page.getByRole('button', { name: 'Send request' })).toBeVisible()
          await look(`${width} px, asking, ${name}`)
          await page.getByRole('button', { name: 'Back', exact: true }).click()
          await expect(page.getByRole('button', { name: 'Approve this quote' })).toBeVisible()
        }
      }
    }
  }

  expect(problems).toEqual([])
  expect(spies.approve).toHaveLength(0)
  expect(spies.requestChanges).toHaveLength(0)
  expect(spies.stray).toEqual([])
})
