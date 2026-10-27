// The customer quote page (docs/design/2026-10-redesign/SPEC.md, section
// 9.9, decisions D7, D12 and D13) in the Fieldhorse proposal theme.
//
// The page is public, so none of these tests sign in. Every /api call is
// mocked with context.route: /api/public-link serves a proposal, and the
// approve and request changes endpoints are spies, so nothing is ever sent
// except by a tap the test makes. Any other /api request, or any request to
// a Supabase host, fails the test.
import { readFileSync } from 'node:fs'
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'

test.use({ viewport: { width: 390, height: 844 } })

// A real photograph (a crop of the portal render) for the cover photo
// tests, bright enough that header text over it needs the scrim.
const BRIGHT_COVER = readFileSync(new URL('./fixtures/bright-cover.jpg', import.meta.url))

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

type Overrides = {
  contact?: Record<string, unknown>
  company?: Record<string, unknown>
  photos?: Array<Record<string, unknown>>
  items?: Array<Record<string, unknown>>
  payments?: Array<Record<string, unknown>>
}

const DEFAULT_ITEMS = [
  { id: 'i1', section: 'Site', description: 'Excavate and grade, 1,100 sq ft', qty: 1, rate: 2200, amount: 2200, is_optional: false, is_excluded: false, sort_order: 1 },
  { id: 'i2', section: 'Steel', description: 'Rebar, #4 at 18 in on center', qty: 1, rate: 2860, amount: 2860, is_optional: false, is_excluded: false, sort_order: 2 },
  { id: 'i3', section: 'Concrete', description: '4 in slab, 4,000 psi fiber mix, broom finish', qty: 1, rate: 9350, amount: 9350, is_optional: false, is_excluded: false, sort_order: 3 },
  { id: 'i4', section: 'Finish', description: 'Joints, pump truck and haul off', qty: 1, rate: 4048, amount: 4048, is_optional: false, is_excluded: false, sort_order: 4 },
  { id: 'i5', section: 'Finish', description: 'Stamped ashlar pattern', qty: 1, rate: 4950, amount: 4950, is_optional: true, is_excluded: false, sort_order: 5 },
  { id: 'i6', section: 'Site', description: 'Fence removal', qty: 1, rate: 700, amount: 700, is_optional: false, is_excluded: true, sort_order: 6 }
]

function proposalPayload({ contact = {}, company = {}, photos = [], items, payments = [] }: Overrides = {}) {
  return {
    ok: true,
    kind: 'proposal',
    contact: {
      id: 'c-portal',
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
    },
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
    items: items ?? DEFAULT_ITEMS,
    payments,
    changeOrders: [],
    insurance: null,
    invoices: [],
    photos
  }
}

type Payload = ReturnType<typeof proposalPayload>

// What the approve or request changes endpoint answers instead of what the
// server does, and what the link serves after that answer: a new payload,
// or 'down' (the link is gone).
type PostReply = { status: number; body: Record<string, unknown>; after?: Payload | 'down' }

// How a read of the link fails: an answer other than the quote, or no
// answer at all.
type LinkFailure = { status: number; body: Record<string, unknown> } | 'abort'

const LINK_NOT_FOUND: LinkFailure = { status: 404, body: { ok: false, error: 'not_found', message: 'This link is no longer available.' } }

type Spies = {
  approve: Array<Record<string, unknown>>
  requestChanges: Array<Record<string, unknown>>
  stray: string[]
  /** How many times the page has read the link. */
  reads: number
  setPayload: (next: Payload) => void
  /** The link itself stops answering (a 404) from now on, or works again. */
  setLinkDown: (down: boolean) => void
  /** Each read of the link fails this way from now on, or works again. */
  setLinkFailure: (failure: LinkFailure | null) => void
  setApproveReply: (reply: PostReply | null) => void
  setRequestReply: (reply: PostReply | null) => void
}

// Serves /api/public-link?token=t1 and records everything else.
async function mockPortal(context: BrowserContext, initial: Payload): Promise<Spies> {
  let current = initial
  let linkFailure: LinkFailure | null = null
  let approveReply: PostReply | null = null
  let requestReply: PostReply | null = null
  const spies: Spies = {
    approve: [],
    requestChanges: [],
    stray: [],
    reads: 0,
    setPayload: (next) => { current = next },
    setLinkDown: (down) => { linkFailure = down ? LINK_NOT_FOUND : null },
    setLinkFailure: (failure) => { linkFailure = failure },
    setApproveReply: (reply) => { approveReply = reply },
    setRequestReply: (reply) => { requestReply = reply }
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
  await context.route('https://img.example.com/**', (route) => {
    const bright = route.request().url().endsWith('/bright.jpg')
    return route.fulfill({ status: 200, contentType: bright ? 'image/jpeg' : 'image/png', body: bright ? BRIGHT_COVER : TINY_PNG })
  })
  await context.route(
    (url) => url.pathname === '/api/public-link' && url.searchParams.get('token') === 't1',
    async (route) => {
      spies.reads += 1
      if (linkFailure === 'abort') return route.abort()
      return route.fulfill({
        status: linkFailure ? linkFailure.status : 200,
        contentType: 'application/json',
        headers: { 'Cache-Control': 'no-store' },
        body: JSON.stringify(linkFailure ? linkFailure.body : current)
      })
    }
  )
  await context.route('**/api/public-link-approve', async (route) => {
    const body = route.request().postDataJSON()
    spies.approve.push(body)
    if (approveReply) {
      if (approveReply.after === 'down') linkFailure = LINK_NOT_FOUND
      else if (approveReply.after) current = approveReply.after
      await route.fulfill({ status: approveReply.status, contentType: 'application/json', body: JSON.stringify(approveReply.body) })
      return
    }
    // What the server does: the proposal is approved from now on.
    current = proposalPayload({
      contact: { ...current.contact, proposal_status: 'approved' },
      company: current.company,
      photos: current.photos,
      items: current.items,
      payments: current.payments
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, signed_by: body.signature_name, approved_at: '2026-10-10T14:00:00.000Z' })
    })
  })
  await context.route('**/api/public-link-request-changes', async (route) => {
    const body = route.request().postDataJSON()
    spies.requestChanges.push(body)
    if (requestReply) {
      if (requestReply.after === 'down') linkFailure = LINK_NOT_FOUND
      else if (requestReply.after) current = requestReply.after
      await route.fulfill({ status: requestReply.status, contentType: 'application/json', body: JSON.stringify(requestReply.body) })
      return
    }
    // What the server does: the quote waits on a revised proposal from now on.
    current = proposalPayload({
      contact: {
        ...current.contact,
        proposal_status: 'changes_requested',
        quote_change_request_note: body.request_text,
        quote_change_requested_at: '2026-10-10T14:00:00.000Z'
      },
      company: current.company,
      photos: current.photos,
      items: current.items,
      payments: current.payments
    })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ok: true, requested_by: body.requester_name, requested_at: '2026-10-10T14:00:00.000Z' })
    })
  })
  return spies
}

async function setThemeMode(context: BrowserContext, mode: 'day' | 'night') {
  await context.addInitScript((m) => {
    try { localStorage.setItem('fh:theme-mode', m) } catch { /* private window */ }
  }, mode)
}

async function openPortal(page: Page) {
  await page.goto('/p/t1', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
}

// Types the signature and ticks the authority box, as a customer would.
async function fillApproval(page: Page, name = 'Marco Castellanos') {
  await page.getByLabel('Your full name').fill(name)
  await page.getByRole('checkbox', { name: /I have the authority to approve this proposal/ }).check()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toBeEnabled()
}

/* ---- Contrast, as WCAG measures it ---- */

function channel(c: number): number {
  const s = c / 255
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
}

function luminanceOf(r: number, g: number, b: number): number {
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
}

function contrastRatio(a: number, b: number): number {
  const [hi, lo] = a > b ? [a, b] : [b, a]
  return (hi + 0.05) / (lo + 0.05)
}

function rgbOf(css: string): [number, number, number] {
  const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(css)
  if (!m) throw new Error(`Not an rgb color: ${css}`)
  return [Number(m[1]), Number(m[2]), Number(m[3])]
}

test.beforeEach(async ({ context }) => {
  await setThemeMode(context, 'day')
})

test('shows the headline, the address and the total with cents', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)

  await expect(page.getByRole('heading', { level: 1, name: 'Hi Marco, your quote is ready.' })).toBeVisible()
  await expect(page.getByText('Pool deck pour at 1150 Cherry Blossom Ln, La Vergne.')).toBeVisible()
  await expect(page.getByText('Parker Construction', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Licensed and insured', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Total' }).getByText('$18,458.00', { exact: true })).toBeVisible()
  // Empty terms: the default schedule's 50 percent, with no fixed promise
  // about a walkthrough the schedule never mentions (decision D31).
  await expect(page.getByText('Pay $9,229.00 now to reserve your start date.', { exact: true })).toBeVisible()
  await expect(page.getByText(/walkthrough/)).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Call Parker Construction' })).toHaveAttribute('href', 'tel:6155550100')
  // Included rows are priced, optional and excluded items are not in them.
  await expect(page.getByRole('heading', { name: "What's included" })).toBeVisible()
  await expect(page.getByText('$2,200.00', { exact: true })).toBeVisible()
  await expect(page.getByText('Fence removal', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Powered by Fieldhorse')).toBeVisible()

  expect(spies.stray).toEqual([])
})

test('the approve bar is on the page and posts only when approving is tapped', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)

  const approve = page.getByRole('button', { name: 'Approve this quote' })
  await expect(approve).toBeVisible()
  // Name and authority are still required. The signature starts empty: the
  // customer types it, nothing types it for them.
  await expect(page.getByLabel('Your full name')).toHaveValue('')
  await expect(approve).toBeDisabled()
  await page.getByRole('checkbox', { name: /I have the authority to approve this proposal/ }).check()
  await expect(approve).toBeDisabled()
  await page.getByLabel('Your full name').fill('Marco Castellanos')
  await expect(approve).toBeEnabled()
  // Filling everything in sends nothing.
  expect(spies.approve).toHaveLength(0)

  await approve.click()
  await expect.poll(() => spies.approve.length).toBe(1)
  expect(spies.approve[0]).toEqual({ token: 't1', signature_name: 'Marco Castellanos', note: null })

  // The page reloads the proposal: approved, so the bar is gone.
  await expect(page.getByText('Approved', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
  expect(spies.approve).toHaveLength(1)
  expect(spies.stray).toEqual([])
})

test('with no photos the header is onyx alone, with no image', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({ photos: [] }))
  await openPortal(page)

  const header = page.locator('header').first()
  await expect(header).toBeVisible()
  await expect(header.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(header.locator('img')).toHaveCount(0)
})

test('with photos the newest one is the cover, fading into the header', async ({ page, context }) => {
  // The server sends photos oldest first.
  await mockPortal(context, proposalPayload({
    photos: [
      { url: 'https://img.example.com/first.png', caption: 'Before' },
      { url: 'https://img.example.com/newest.png', caption: 'Finished deck' }
    ]
  }))
  await openPortal(page)

  const cover = page.locator('header img')
  await expect(cover).toHaveCount(1)
  await expect(cover).toHaveAttribute('src', 'https://img.example.com/newest.png')
  await expect.poll(() => cover.evaluate((img) => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
})

test('a cover photo that fails to load leaves no broken image behind', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({ photos: [{ url: 'https://img.example.com/missing.png' }] }))
  await context.route('https://img.example.com/missing.png', (route) => route.fulfill({ status: 404, body: '' }))
  await openPortal(page)

  await expect(page.locator('header img')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
})

test('an approved quote shows Approved and no approve bar', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({ contact: { proposal_status: 'approved' } }))
  await openPortal(page)

  await expect(page.getByText('Approved', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
  await expect(page.getByLabel('Your full name')).toHaveCount(0)
  // The payload has no approver, so the page claims none (D12).
  await expect(page.getByText(/Approved by/)).toHaveCount(0)
  // Nothing to ask once the quote is closed: the optional row has no dead button.
  await expect(page.getByText('Stamped ashlar pattern', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
})

test('an approved quote shows who approved and when only when the payload has it', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({
    contact: { proposal_status: 'approved', approved_by_name: 'Marco Castellanos', approved_at: '2026-10-09T15:30:00.000Z' }
  }))
  await openPortal(page)

  await expect(page.getByText(/Approved by Marco Castellanos on October 9/)).toBeVisible()
})

test('with no payment link there is no Pay deposit button', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({ contact: { proposal_status: 'approved' }, company: { payment_link: '' } }))
  await openPortal(page)

  await expect(page.getByText('Approved', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Pay deposit/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Pay deposit/ })).toHaveCount(0)
})

test('after approval with a payment link, Pay deposit opens the company link', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({
    contact: { proposal_status: 'approved' },
    company: { payment_link: 'venmo.com/u/parker' }
  }))
  await openPortal(page)

  const pay = page.getByRole('link', { name: 'Pay deposit $9,229.00' })
  await expect(pay).toBeVisible()
  await expect(pay).toHaveAttribute('href', 'https://venmo.com/u/parker')
  await expect(pay).toHaveAttribute('target', '_blank')
  await expect(pay).toHaveAttribute('rel', /noopener/)
})

test('before approval there is no Pay deposit button even when a link is set', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({ company: { payment_link: 'venmo.com/u/parker' } }))
  await openPortal(page)

  await expect(page.getByRole('button', { name: 'Approve this quote' })).toBeVisible()
  await expect(page.getByRole('link', { name: /Pay deposit/ })).toHaveCount(0)
})

test('an unsafe payment link never becomes a button', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({
    contact: { proposal_status: 'approved' },
    company: { payment_link: 'javascript:alert(1)' }
  }))
  await openPortal(page)

  await expect(page.getByText('Approved', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Pay deposit/ })).toHaveCount(0)
})

test('optional items are read only rows, and Ask about this opens request changes with the item name', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)

  await expect(page.getByRole('heading', { name: 'Optional additions' })).toBeVisible()
  const optionalRow = page.getByRole('listitem').filter({ hasText: 'Stamped ashlar pattern' })
  await expect(optionalRow).toHaveCount(1)
  await expect(optionalRow.getByText('+$4,950.00', { exact: true })).toBeVisible()
  // Read only: no switch, no checkbox on the optional row.
  await expect(page.getByRole('switch')).toHaveCount(0)

  await page.getByRole('button', { name: /Ask about this/ }).click()
  const note = page.getByLabel('Changes needed')
  await expect(note).toBeVisible()
  await expect(note).toHaveValue('About “Stamped ashlar pattern”: ')
  // Nothing is sent until the customer writes something and taps Send.
  expect(spies.requestChanges).toHaveLength(0)
  await expect(page.getByRole('button', { name: 'Send request' })).toBeDisabled()

  await page.getByLabel('Your full name').fill('Marco Castellanos')
  await note.fill('About “Stamped ashlar pattern”: Can you show me a photo?')
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect.poll(() => spies.requestChanges.length).toBe(1)
  expect(spies.requestChanges[0]).toEqual({
    token: 't1',
    requester_name: 'Marco Castellanos',
    request_text: 'About “Stamped ashlar pattern”: Can you show me a photo?'
  })
  expect(spies.approve).toHaveLength(0)
})

test('the question link under the approve button opens request changes', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)

  await page.getByRole('button', { name: 'Ask Parker a question first' }).click()
  await expect(page.getByLabel('Changes needed')).toBeVisible()
  await expect(page.getByLabel('Changes needed')).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
  // Back returns to the approve bar without sending anything.
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toBeVisible()
  expect(spies.requestChanges).toHaveLength(0)
  expect(spies.approve).toHaveLength(0)
})

test('Back from the question form never approves, even with the approval filled in', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  await fillApproval(page)

  // Open the question form and come back without asking anything.
  await page.getByRole('button', { name: 'Ask Parker a question first' }).click()
  await expect(page.getByLabel('Changes needed')).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toBeVisible()
  await page.waitForTimeout(500)
  expect(spies.approve).toHaveLength(0)
  expect(spies.requestChanges).toHaveLength(0)
  await expect(page.getByText('Approved', { exact: true })).toHaveCount(0)

  // Only the Approve button approves.
  await page.getByRole('button', { name: 'Approve this quote' }).click()
  await expect.poll(() => spies.approve.length).toBe(1)
  expect(spies.requestChanges).toHaveLength(0)
})

test('what happens next is three numbered steps', async ({ page, context }) => {
  await mockPortal(context, proposalPayload())
  await openPortal(page)

  await expect(page.getByRole('heading', { name: 'What happens next' })).toBeVisible()
  const steps = page.getByRole('list', { name: 'What happens next' }).getByRole('listitem')
  await expect(steps).toHaveText([
    'You approve and pay the deposit.',
    'Parker sends you a start date.',
    'You pay 40% at material delivery and 10% at completion.'
  ])
})

// The deposit, the sentence under the total and the steps follow the
// payment terms (decision D31), the same rule the Quote tab capsule uses.
test('terms that name no deposit say payment follows the terms', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({ contact: { terms_text: '50% down at rough in, 50% at completion.' } }))
  await openPortal(page)

  const total = page.getByRole('region', { name: 'Total' })
  await expect(total.getByText('$18,458.00', { exact: true })).toBeVisible()
  await expect(total.getByText('Payment follows the terms below.', { exact: true })).toBeVisible()
  await expect(page.getByText(/Pay \$/)).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'What happens next' }).getByRole('listitem')).toHaveText([
    'You approve the quote.',
    'Parker sends you a start date.',
    'You pay as the payment terms say.'
  ])
  await page.getByRole('button', { name: 'Full details' }).click()
  await expect(page.getByText('50% down at rough in, 50% at completion.')).toBeVisible()
})

test('a quote with no deposit says so plainly', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({ contact: { terms_text: 'No deposit required. Net 30 after completion.' } }))
  await openPortal(page)

  await expect(page.getByRole('region', { name: 'Total' }).getByText('No deposit is due. Payment follows the terms below.', { exact: true })).toBeVisible()
  await expect(page.getByText(/Pay \$/)).toHaveCount(0)
  await expect(page.getByText('You approve the quote.', { exact: true })).toBeVisible()
})

test('a deposit the terms name as an amount is the amount asked for', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({ contact: { terms_text: '$2,500 deposit on signing, balance after the final walkthrough.' } }))
  await openPortal(page)

  await expect(page.getByText('Pay $2,500.00 now to reserve your start date.', { exact: true })).toBeVisible()
  // The terms mention the walkthrough, so the last step does too.
  await expect(page.getByRole('list', { name: 'What happens next' }).getByRole('listitem')).toHaveText([
    'You approve and pay the deposit.',
    'Parker sends you a start date.',
    'You pay the balance after the walkthrough.'
  ])
})

test('after approval, Pay deposit asks for the deposit the terms name', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({
    contact: { proposal_status: 'approved', terms_text: '30% deposit on signing.' },
    company: { payment_link: 'venmo.com/u/parker' }
  }))
  await openPortal(page)
  await expect(page.getByRole('link', { name: 'Pay deposit $5,537.40' })).toBeVisible()
})

test('after approval with no deposit, the payment link asks for no deposit', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({
    contact: { proposal_status: 'approved', terms_text: 'No deposit required. Net 30 after completion.' },
    company: { payment_link: 'venmo.com/u/parker' }
  }))
  await openPortal(page)
  const pay = page.getByRole('link', { name: 'Make a payment' })
  await expect(pay).toBeVisible()
  await expect(pay).toHaveAttribute('href', 'https://venmo.com/u/parker')
  await expect(page.getByRole('link', { name: /Pay deposit/ })).toHaveCount(0)
})

test('full details keep the terms, warranty and exclusions reachable', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({
    contact: { terms_text: 'Half down, half at the walkthrough.', exclusions_text: 'Permits' },
    company: { warranty_default: 'One year on workmanship.' }
  }))
  await openPortal(page)

  await page.getByRole('button', { name: 'Full details' }).click()
  await expect(page.getByText('Half down, half at the walkthrough.')).toBeVisible()
  await expect(page.getByText('One year on workmanship.')).toBeVisible()
  await expect(page.getByText('Permits', { exact: true })).toBeVisible()
  await expect(page.getByText('Fence removal', { exact: true })).toBeVisible()
})

test('a quote without the Fieldhorse theme keeps its own look (decision D13)', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({ company: { estimate_template: 'classic' } }))
  await page.goto('/p/t1', { waitUntil: 'domcontentloaded' })

  // The classic approve bar, untouched.
  await expect(page.getByRole('button', { name: 'Approve & notify contractor' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hi Marco, your quote is ready.' })).toHaveCount(0)
  await expect(page.getByText('Powered by Fieldhorse')).toHaveCount(0)
})

test('a quote with no template set keeps resolving to classic (decision D13)', async ({ page, context }) => {
  const payload = proposalPayload()
  delete (payload.company as Record<string, unknown>).estimate_template
  await mockPortal(context, payload)
  await page.goto('/p/t1', { waitUntil: 'domcontentloaded' })

  await expect(page.getByRole('button', { name: 'Approve & notify contractor' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Hi Marco, your quote is ready.' })).toHaveCount(0)
})

test('the page ground follows Day and Night from the tokens, with no sign in', async ({ page, context }) => {
  await mockPortal(context, proposalPayload())
  await openPortal(page)
  const ground = () => page.locator('.fhp').evaluate((el) => getComputedStyle(el).backgroundColor)
  // Day plaster, #EDE8DF.
  expect(await ground()).toBe('rgb(237, 232, 223)')

  const night = await context.newPage()
  await context.addInitScript(() => { try { localStorage.setItem('fh:theme-mode', 'night') } catch { /* private window */ } })
  await night.goto('/p/t1', { waitUntil: 'domcontentloaded' })
  await expect(night.getByRole('heading', { level: 1 })).toBeVisible()
  // Night plaster, #171611.
  expect(await night.locator('.fhp').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe('rgb(23, 22, 17)')
})

test('nothing scrolls sideways on a phone, even with a long company and job name', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({
    contact: { job_title: 'Rear pool deck pour with stamped border and integrated planters', address: '1150 Cherry Blossom Lane Extended, La Vergne, Tennessee' },
    company: { name: 'Parker Construction and Concrete Company of Rutherford County' }
  }))
  await openPortal(page)

  await nothingRunsOffTheSide(page)
})

/* ---- Task 10: after approval and on bad data ---- */

test('after the deposit is paid, the capsule says Deposit received and has no Pay deposit button', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({
    contact: { proposal_status: 'approved' },
    company: { payment_link: 'venmo.com/u/parker' },
    payments: [{ id: 'p1', amount: 9229, kind: 'deposit', paid_on: '2026-10-09' }]
  }))
  await openPortal(page)

  await expect(page.getByText('Approved', { exact: true })).toBeVisible()
  await expect(page.getByText('Deposit received', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Pay deposit/ })).toHaveCount(0)
  await expect(page.getByRole('link', { name: /Make a payment/ })).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Total' }).getByText('Deposit of $9,229.00 received.', { exact: true })).toBeVisible()
})

test('payments of any kind that add up to the deposit count as the deposit', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({
    contact: { proposal_status: 'approved' },
    company: { payment_link: 'venmo.com/u/parker' },
    payments: [
      { id: 'p1', amount: 5000, kind: 'progress', paid_on: '2026-10-08' },
      { id: 'p2', amount: 4229, kind: 'other', paid_on: '2026-10-09' }
    ]
  }))
  await openPortal(page)

  await expect(page.getByText('Deposit received', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /Pay / })).toHaveCount(0)
})

test('a partial payment keeps a pay button for the rest of the deposit', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({
    contact: { proposal_status: 'approved' },
    company: { payment_link: 'venmo.com/u/parker' },
    payments: [{ id: 'p1', amount: 5000, kind: 'deposit', paid_on: '2026-10-09' }]
  }))
  await openPortal(page)

  await expect(page.getByText('Deposit received', { exact: true })).toHaveCount(0)
  const pay = page.getByRole('link', { name: 'Pay remaining deposit $4,229.00' })
  await expect(pay).toBeVisible()
  await expect(pay).toHaveAttribute('href', 'https://venmo.com/u/parker')
  await expect(page.getByRole('region', { name: 'Total' })
    .getByText('$5,000.00 paid so far. Pay the remaining $4,229.00 to reserve your start date.', { exact: true })).toBeVisible()
})

test('shows the quote number, the issue date and valid until, and leaves out what the payload lacks', async ({ page, context }) => {
  await page.clock.setFixedTime(new Date('2026-10-10T14:00:00.000Z'))
  const spies = await mockPortal(context, proposalPayload({ contact: { quote_expires_at: '2026-11-02T04:59:59.999Z' } }))
  await openPortal(page)

  await expect(page.getByText('Quote PC-2026-RTAL', { exact: true })).toBeVisible()
  await expect(page.getByText('Issued October 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Valid until November 1', { exact: true })).toBeVisible()
  // Still open: the approve bar is on the page.
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toBeVisible()

  // Sending an existing quote again changes delivery history, not the
  // document's issue date, number or validity date.
  spies.setPayload(proposalPayload({ contact: { quote_sent_at: '2026-10-08T12:00:00.000Z', quote_expires_at: '2026-11-02T04:59:59.999Z' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByText('Quote PC-2026-RTAL', { exact: true })).toBeVisible()
  await expect(page.getByText('Issued October 1', { exact: true })).toBeVisible()
  await expect(page.getByText('Valid until November 1', { exact: true })).toBeVisible()

  spies.setPayload(proposalPayload({ contact: { quote_sent_at: null, created_at: null } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Quote PC-2026-RTAL', { exact: true })).toBeVisible()
  await expect(page.getByText(/^Issued /)).toHaveCount(0)
  await expect(page.getByText(/^Valid until /)).toHaveCount(0)
})

test('an expired quote replaces the approve area with an expired note and the call link', async ({ page, context }) => {
  await page.clock.setFixedTime(new Date('2026-10-10T14:00:00.000Z'))
  const spies = await mockPortal(context, proposalPayload({ contact: { quote_expires_at: '2026-10-06T04:59:59.999Z' } }))
  await openPortal(page)

  await expect(page.getByText('Expired October 5', { exact: true })).toBeVisible()
  const capsule = page.getByRole('region', { name: 'Quote expired' })
  await expect(capsule.getByText('This quote has expired.')).toBeVisible()
  await expect(capsule.getByText('Ask Parker Construction for an updated one.')).toBeVisible()
  await expect(capsule.getByRole('link', { name: 'Call Parker Construction' })).toHaveAttribute('href', 'tel:6155550100')
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
  await expect(page.getByLabel('Your full name')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
  await expect(page.getByText(/Pay \$/)).toHaveCount(0)
  // Approving is not a next step any more, so the steps are gone.
  await expect(page.getByRole('heading', { name: 'What happens next' })).toHaveCount(0)
  await expect(page.getByText('You approve and pay the deposit.')).toHaveCount(0)
  expect(spies.approve).toHaveLength(0)
  expect(spies.stray).toEqual([])
})

test('after approval the deposit note and the pay button stay past the valid until date', async ({ page, context }) => {
  // Approved October 1, valid until October 5, reopened October 10 to pay.
  await page.clock.setFixedTime(new Date('2026-10-10T14:00:00.000Z'))
  const spies = await mockPortal(context, proposalPayload({
    contact: { proposal_status: 'approved', quote_expires_at: '2026-10-06T04:59:59.999Z' },
    company: { payment_link: 'https://venmo.com/u/parker' }
  }))
  await openPortal(page)

  await expect(page.getByText('Valid until October 5', { exact: true })).toBeVisible()
  await expect(page.getByText(/^Expired/)).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Total' }).getByText('Pay $9,229.00 now to reserve your start date.')).toBeVisible()
  await expect(page.getByRole('link', { name: 'Pay deposit $9,229.00' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Quote expired' })).toHaveCount(0)

  // Once the deposit is in, the tray and the capsule both say so.
  spies.setPayload(proposalPayload({
    contact: { proposal_status: 'approved', quote_expires_at: '2026-10-06T04:59:59.999Z' },
    company: { payment_link: 'https://venmo.com/u/parker' },
    payments: [{ id: 'p1', amount: 9229, kind: 'deposit', paid_on: '2026-10-09' }]
  }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByText('Valid until October 5', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Total' }).getByText('Deposit of $9,229.00 received.')).toBeVisible()
  await expect(page.getByText('Deposit received', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /^Pay / })).toHaveCount(0)
})

test('on the classic page an approval on the stated day still reaches the server', async ({ page, context }) => {
  // Valid until October 9 (end of day, Central); the customer approves at
  // 9 in the morning on October 10. The server allows the whole next day,
  // so the approval posts and the server decides, as it always did.
  await page.clock.setFixedTime(new Date('2026-10-10T14:00:00.000Z'))
  const spies = await mockPortal(context, proposalPayload({
    company: { estimate_template: 'classic' },
    contact: { quote_expires_at: '2026-10-10T04:59:59.999Z' }
  }))
  await page.goto('/p/t1', { waitUntil: 'domcontentloaded' })

  const approve = page.getByRole('button', { name: 'Approve & notify contractor' })
  await expect(approve).toBeVisible()
  await page.getByRole('checkbox', { name: /I have the authority to approve this proposal/ }).check()
  await expect(approve).toBeEnabled()
  await approve.click()

  await expect.poll(() => spies.approve.length).toBe(1)
  expect(spies.approve[0]).toEqual({ token: 't1', signature_name: 'Marco Castellanos', note: null })
  await expect(page.getByText('Proposal approved')).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(spies.stray).toEqual([])
})

test('a quote with changes requested shows the request and no way to approve or ask', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({
    contact: {
      proposal_status: 'changes_requested',
      quote_change_request_note: 'Can you price a sealer too?',
      quote_change_requested_at: '2026-10-08T15:00:00.000Z'
    }
  }))
  await openPortal(page)

  await expect(page.getByText('Changes requested', { exact: true })).toBeVisible()
  await expect(page.getByText('Waiting on a revised proposal.')).toBeVisible()
  await expect(page.getByText('Can you price a sealer too?')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
  await expect(page.getByLabel('Your full name')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
  // Nothing can be paid for until the revised proposal comes, so neither the
  // line under the total nor the first step asks for the deposit.
  await expect(page.getByRole('region', { name: 'Total' }).getByText('Nothing is due while you wait for a revised proposal.', { exact: true })).toBeVisible()
  await expect(page.getByText(/Pay \$/)).toHaveCount(0)
  await expect(page.getByRole('list', { name: 'What happens next' }).getByRole('listitem')).toHaveText([
    'Parker sends you a revised proposal.',
    'You approve and pay the deposit.',
    'Parker sends you a start date.',
    'You pay 40% at material delivery and 10% at completion.'
  ])
})

test('a total that changed since the page loaded stops the approval and shows the new total', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  await fillApproval(page)

  // The contractor adds a line while the customer reads.
  spies.setPayload(proposalPayload({
    items: [...DEFAULT_ITEMS, { id: 'i7', section: 'Finish', description: 'Sealer', qty: 1, rate: 1000, amount: 1000, is_optional: false, is_excluded: false, sort_order: 7 }]
  }))
  await page.getByRole('button', { name: 'Approve this quote' }).click()

  await expect(page.getByRole('alert')).toHaveText('This quote was just updated. Please review the new total.')
  expect(spies.approve).toHaveLength(0)
  await expect(page.getByRole('region', { name: 'Total' }).getByText('$19,458.00', { exact: true })).toBeVisible()
  await expect(page.getByText('Sealer', { exact: true })).toBeVisible()
  await expect(page.getByText(/The approved contract total is/)).toContainText('$19,458.00')

  // Reviewed: the next tap approves the new total.
  await page.getByRole('button', { name: 'Approve this quote' }).click()
  await expect.poll(() => spies.approve.length).toBe(1)
  expect(spies.approve[0]).toEqual({ token: 't1', signature_name: 'Marco Castellanos', note: null })
  await expect(page.getByText('Approved', { exact: true })).toBeVisible()
  expect(spies.stray).toEqual([])
})

test('a 409 from the approve endpoint shows the quote as it is now', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  await fillApproval(page)

  // Approved by someone else between the check and the post.
  spies.setApproveReply({
    status: 409,
    body: { ok: false, error: 'already_approved', message: 'This proposal has already been approved.' },
    after: proposalPayload({ contact: { proposal_status: 'approved' } })
  })
  await page.getByRole('button', { name: 'Approve this quote' }).click()

  await expect.poll(() => spies.approve.length).toBe(1)
  await expect(page.getByText('Approved', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
  await expect(page.getByText('Unavailable')).toHaveCount(0)
  expect(spies.stray).toEqual([])
})

test('a 410 from the approve endpoint shows the reason and keeps the page', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  await fillApproval(page)

  spies.setApproveReply({ status: 410, body: { ok: false, error: 'revoked' }, after: 'down' })
  await page.getByRole('button', { name: 'Approve this quote' }).click()

  await expect(page.getByRole('alert')).toHaveText('This link has been revoked.')
  expect(spies.approve).toHaveLength(1)
  // The quote stays on the page; no error card replaces it.
  await expect(page.getByRole('heading', { level: 1, name: 'Hi Marco, your quote is ready.' })).toBeVisible()
  await expect(page.getByText('Unavailable')).toHaveCount(0)
  await expect(page.getByRole('region', { name: 'Total' }).getByText('$18,458.00', { exact: true })).toBeVisible()
})

test('a 410 for an expired quote shows the expired note', async ({ page, context }) => {
  // October 10: the reread after the 410 says valid until October 5.
  await page.clock.setFixedTime(new Date('2026-10-10T14:00:00.000Z'))
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  await fillApproval(page)

  spies.setApproveReply({
    status: 410,
    body: { ok: false, error: 'quote_expired', message: 'This proposal has expired. Ask your contractor for updated pricing.' },
    after: proposalPayload({ contact: { quote_expires_at: '2026-10-06T04:59:59.999Z' } })
  })
  await page.getByRole('button', { name: 'Approve this quote' }).click()

  await expect.poll(() => spies.approve.length).toBe(1)
  await expect(page.getByRole('region', { name: 'Quote expired' }).getByText('This quote has expired.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
})

test('a failed read before approving posts nothing and keeps the quote on the page', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  await fillApproval(page)

  // The read fails for a moment just as the customer taps Approve: a server
  // error, too many requests, or no answer at all. Each is worth a retry.
  const failures: LinkFailure[] = [
    { status: 503, body: { ok: false } },
    { status: 429, body: { ok: false, error: 'rate_limited', message: 'Too many requests. Please try again in a minute.' } },
    'abort'
  ]
  for (const failure of failures) {
    spies.setLinkFailure(failure)
    const reads = spies.reads
    await page.getByRole('button', { name: 'Approve this quote' }).click()
    // The tap clears the last message before it reads, so this one is new.
    await expect.poll(() => spies.reads).toBe(reads + 1)
    await expect(page.getByRole('alert')).toHaveText('We could not check this quote for updates. Please try again.')
  }
  expect(spies.approve).toHaveLength(0)
  await expect(page.getByRole('heading', { level: 1, name: 'Hi Marco, your quote is ready.' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Total' }).getByText('$18,458.00', { exact: true })).toBeVisible()
  await expect(page.getByText('Unavailable')).toHaveCount(0)

  // Back up: the next tap checks again and approves.
  spies.setLinkFailure(null)
  await page.getByRole('button', { name: 'Approve this quote' }).click()
  await expect.poll(() => spies.approve.length).toBe(1)
  await expect(page.getByText('Approved', { exact: true })).toBeVisible()
  expect(spies.stray).toEqual([])
})

test('a link revoked, expired or removed while the page is open says why when Approve is tapped', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  await fillApproval(page)

  // What /api/public-link answers once the sender revokes the link, the
  // link passes its own expiry, the job is deleted, or the link is gone,
  // and what the customer reads: the same words the approve endpoint's
  // answer gets, never a retry that cannot work.
  const refusals: Array<[Record<string, unknown>, string]> = [
    [{ ok: false, error: 'revoked', message: 'This link has been revoked by the sender.' }, 'This link has been revoked.'],
    [{ ok: false, error: 'expired', message: 'This link has expired.' }, 'This link has expired. Please ask the contractor for a fresh one.'],
    [{ ok: false, error: 'gone', message: 'This document is no longer available.' }, 'This proposal is no longer open for approval.'],
    [{ ok: false, error: 'not_found', message: 'This link is no longer available.' }, 'This link is no longer available.']
  ]
  for (const [body, said] of refusals) {
    spies.setLinkFailure({ status: 404, body })
    const reads = spies.reads
    await page.getByRole('button', { name: 'Approve this quote' }).click()
    await expect.poll(() => spies.reads).toBe(reads + 1)
    await expect(page.getByRole('alert')).toHaveText(said)
  }

  // Nothing posted, and the quote stays on the page to read.
  expect(spies.approve).toHaveLength(0)
  await expect(page.getByRole('heading', { level: 1, name: 'Hi Marco, your quote is ready.' })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Total' }).getByText('$18,458.00', { exact: true })).toBeVisible()
  await expect(page.getByText('Unavailable')).toHaveCount(0)
  // A refused link takes no question either, so none is offered.
  await expect(page.getByText('Stamped ashlar pattern', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /question first/ })).toHaveCount(0)
  expect(spies.requestChanges).toHaveLength(0)
  expect(spies.stray).toEqual([])
})

test('terms changed with the same total stop the approval and show the new terms', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  const total = page.getByRole('region', { name: 'Total' })
  await expect(total.getByText('Pay $9,229.00 now to reserve your start date.', { exact: true })).toBeVisible()
  await fillApproval(page)

  // The contractor changes the deposit to 30 percent; no line changes.
  spies.setPayload(proposalPayload({ contact: { terms_text: '30% deposit on signing.' } }))
  await page.getByRole('button', { name: 'Approve this quote' }).click()

  await expect(page.getByRole('alert')).toHaveText('This quote was just updated. Please review it before approving.')
  expect(spies.approve).toHaveLength(0)
  await expect(total.getByText('$18,458.00', { exact: true })).toBeVisible()
  await expect(total.getByText('Pay $5,537.40 now to reserve your start date.', { exact: true })).toBeVisible()

  // Reviewed: the next tap approves the quote as it now reads.
  await page.getByRole('button', { name: 'Approve this quote' }).click()
  await expect.poll(() => spies.approve.length).toBe(1)
  await expect(page.getByText('Approved', { exact: true })).toBeVisible()
  expect(spies.stray).toEqual([])
})

test('a warranty changed while the page was open stops the approval and shows the new warranty', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload({ company: { warranty_default: 'Two year workmanship warranty.' } }))
  await openPortal(page)
  await page.getByRole('button', { name: 'Full details' }).click()
  await expect(page.getByText('Two year workmanship warranty.', { exact: true })).toBeVisible()
  await fillApproval(page)

  // The owner changes the default warranty in Settings while the customer
  // reads; the approval would record the new one.
  spies.setPayload(proposalPayload({ company: { warranty_default: '90 day workmanship warranty.' } }))
  await page.getByRole('button', { name: 'Approve this quote' }).click()

  await expect(page.getByRole('alert')).toHaveText('This quote was just updated. Please review it before approving.')
  expect(spies.approve).toHaveLength(0)
  await expect(page.getByText('90 day workmanship warranty.', { exact: true })).toBeVisible()
  await expect(page.getByText('Two year workmanship warranty.', { exact: true })).toHaveCount(0)

  // Reviewed: the next tap approves the quote as it now reads.
  await page.getByRole('button', { name: 'Approve this quote' }).click()
  await expect.poll(() => spies.approve.length).toBe(1)
  expect(spies.stray).toEqual([])
})

test('after a question is sent the page shows the request, with no Ask about this left on it', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)

  await page.getByRole('button', { name: /Ask about this/ }).click()
  await page.getByLabel('Your full name').fill('Marco Castellanos')
  await page.getByLabel('Changes needed').fill('About “Stamped ashlar pattern”: Can you show me a photo?')
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect.poll(() => spies.requestChanges.length).toBe(1)

  // The page reads the link again, as reopening it would: the quote now
  // waits on a revised proposal, and nothing on it asks or approves.
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
  const capsule = page.getByRole('region', { name: 'Changes requested' })
  await expect(capsule.getByText('Waiting on a revised proposal.')).toBeVisible()
  await expect(capsule.getByText('About “Stamped ashlar pattern”: Can you show me a photo?')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Total' }).getByText('Nothing is due while you wait for a revised proposal.', { exact: true })).toBeVisible()
  await expect(page.getByText('Stamped ashlar pattern', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /question first/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
  await expect(page.getByLabel('Changes needed')).toHaveCount(0)
  expect(spies.requestChanges).toHaveLength(1)
  expect(spies.approve).toHaveLength(0)
  expect(spies.stray).toEqual([])
})

test('after a question is sent, Ask about this stays gone even when the page cannot read the link again', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  spies.setRequestReply({
    status: 200,
    body: { ok: true, requested_by: 'Marco Castellanos', requested_at: '2026-10-10T14:00:00.000Z' },
    after: 'down'
  })

  await page.getByRole('button', { name: /Ask about this/ }).click()
  await page.getByLabel('Your full name').fill('Marco Castellanos')
  await page.getByLabel('Changes needed').fill('About “Stamped ashlar pattern”: Can you show me a photo?')
  await page.getByRole('button', { name: 'Send request' }).click()
  await expect.poll(() => spies.requestChanges.length).toBe(1)

  await expect(page.getByText('Your feedback is with the contractor.')).toBeVisible()
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
  await expect(page.getByText('Stamped ashlar pattern', { exact: true })).toBeVisible()
  await expect(page.getByText('Unavailable')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: 'Hi Marco, your quote is ready.' })).toBeVisible()
  expect(spies.requestChanges).toHaveLength(1)
  expect(spies.stray).toEqual([])
})

// Review round 4: a question the server refuses (404, 409 or 410) reads the
// link again, as a refused approval does, so the page shows the quote as it
// now is and offers no question the server would refuse again.
async function askAboutTheOption(page: Page) {
  await page.getByRole('button', { name: /Ask about this/ }).click()
  await page.getByLabel('Your full name').fill('Marco Castellanos')
  await page.getByLabel('Changes needed').fill('About “Stamped ashlar pattern”: Can you show me a photo?')
  await page.getByRole('button', { name: 'Send request' }).click()
}

test('a question sent after the quote was declined reads the link again and leaves no Ask button', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(1)

  // The contractor marks the quote declined while the customer reads. The
  // request changes endpoint refuses a question for it; the approve
  // endpoint still takes an approval.
  spies.setPayload(proposalPayload({ contact: { proposal_status: 'rejected' } }))
  spies.setRequestReply({ status: 410, body: { ok: false, error: 'gone' } })
  const reads = spies.reads
  await askAboutTheOption(page)

  await expect.poll(() => spies.requestChanges.length).toBe(1)
  await expect.poll(() => spies.reads).toBeGreaterThan(reads)
  // The question form closes on the reason, and nothing offers to ask again.
  const alert = page.getByRole('alert')
  await expect(alert).toHaveText('This proposal is no longer open for changes.')
  await expect(alert).toBeFocused()
  await expect(page.getByRole('button', { name: 'Send request' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /question first/ })).toHaveCount(0)
  await expect(page.getByText('Stamped ashlar pattern', { exact: true })).toBeVisible()
  // A declined quote can still be approved.
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toBeVisible()
  expect(spies.requestChanges).toHaveLength(1)
  expect(spies.approve).toHaveLength(0)
  expect(spies.stray).toEqual([])
})

test('a question sent after the quote was approved on another phone shows it approved', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)

  spies.setPayload(proposalPayload({ contact: { proposal_status: 'approved' } }))
  spies.setRequestReply({ status: 409, body: { ok: false, error: 'already_approved' } })
  await page.getByRole('button', { name: 'Ask Parker a question first' }).click()
  await page.getByLabel('Your full name').fill('Marco Castellanos')
  await page.getByLabel('Changes needed').fill('Can you start in May?')
  await page.getByRole('button', { name: 'Send request' }).click()

  await expect.poll(() => spies.requestChanges.length).toBe(1)
  // The page reads the link again: the capsule says Approved, and nothing on
  // the page asks or approves.
  await expect(page.getByRole('region', { name: 'Approval' }).getByText('Approved', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Send request' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /question first/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
  expect(spies.requestChanges).toHaveLength(1)
  expect(spies.approve).toHaveLength(0)
  expect(spies.stray).toEqual([])
})

test('a question sent after the link was revoked says so and leaves no Ask button', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)

  // The sender revokes the link while the customer reads: the link and the
  // request changes endpoint both answer 404 revoked from now on.
  spies.setLinkFailure({ status: 404, body: { ok: false, error: 'revoked', message: 'This link has been revoked by the sender.' } })
  spies.setRequestReply({ status: 404, body: { ok: false, error: 'revoked' } })
  const reads = spies.reads
  await askAboutTheOption(page)

  await expect.poll(() => spies.requestChanges.length).toBe(1)
  await expect.poll(() => spies.reads).toBeGreaterThan(reads)
  await expect(page.getByRole('alert')).toHaveText('This link has been revoked.')
  await expect(page.getByRole('button', { name: 'Send request' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /question first/ })).toHaveCount(0)
  // The quote stays on the page to read.
  await expect(page.getByRole('heading', { level: 1, name: 'Hi Marco, your quote is ready.' })).toBeVisible()
  await expect(page.getByText('Stamped ashlar pattern', { exact: true })).toBeVisible()
  await expect(page.getByText('Unavailable')).toHaveCount(0)
  expect(spies.requestChanges).toHaveLength(1)
  expect(spies.approve).toHaveLength(0)
  expect(spies.stray).toEqual([])
})

test('Back from the question form puts focus back on the control that opened it', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  await fillApproval(page)

  // Opened with the keyboard from the question link under Approve.
  await page.getByRole('button', { name: 'Ask Parker a question first' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Changes needed')).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.getByRole('button', { name: 'Ask Parker a question first' })).toBeFocused()

  // Opened from Ask about this on the optional row; Space on Back.
  const ask = page.getByRole('button', { name: 'Ask about this, Stamped ashlar pattern' })
  await ask.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByLabel('Changes needed')).toBeVisible()
  await page.getByRole('button', { name: 'Back' }).focus()
  await page.keyboard.press(' ')
  await expect(ask).toBeFocused()

  // A tap on Back does the same.
  await ask.click()
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(ask).toBeFocused()

  await page.waitForTimeout(300)
  expect(spies.requestChanges).toHaveLength(0)
  expect(spies.approve).toHaveLength(0)
})

test('an approval tapped just after midnight on the last valid day posts nothing and shows the expired note', async ({ page, context }) => {
  // Valid until October 9. The customer opens the page at 11:50 pm and
  // taps Approve at 12:01 am, October 10.
  await page.clock.setFixedTime(new Date('2026-10-10T04:50:00.000Z'))
  const spies = await mockPortal(context, proposalPayload({ contact: { quote_expires_at: '2026-10-10T04:59:59.999Z' } }))
  await openPortal(page)
  await expect(page.getByText('Valid until October 9', { exact: true })).toBeVisible()
  await fillApproval(page)

  await page.clock.setFixedTime(new Date('2026-10-10T05:01:00.000Z'))
  await page.getByRole('button', { name: 'Approve this quote' }).click()

  await expect(page.getByRole('region', { name: 'Quote expired' }).getByText('This quote has expired.')).toBeVisible()
  await page.waitForTimeout(500)
  expect(spies.approve).toHaveLength(0)
  await expect(page.getByRole('region', { name: 'Quote expired' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
  await expect(page.getByText('Approved', { exact: true })).toHaveCount(0)
  expect(spies.stray).toEqual([])
})

test('a quote marked lost says it is no longer open, with no way to approve or ask', async ({ page, context }) => {
  // Sent October 2, then marked lost: the stage moves, the status stays sent.
  // The server refuses an approval (409) and a question (410) for it. Read
  // on October 10, so the dates print without a year and the quote is still
  // inside its valid until date (closed has to win over that date, not over
  // an expiry).
  await page.clock.setFixedTime(new Date('2026-10-10T14:00:00.000Z'))
  const spies = await mockPortal(context, proposalPayload({ contact: { stage: 'lost', quote_expires_at: '2026-11-02T04:59:59.999Z' } }))
  await openPortal(page)
  // A closed quote is good until no date any more.
  await expect(page.getByText('Issued October 1', { exact: true })).toBeVisible()
  await expect(page.getByText(/^(Valid until|Expired) /)).toHaveCount(0)

  const capsule = page.getByRole('region', { name: 'Quote closed' })
  await expect(capsule.getByText('Closed', { exact: true })).toBeVisible()
  await expect(capsule.getByText('This quote is no longer open.')).toBeVisible()
  await expect(capsule.getByText('Ask Parker Construction for an updated one.')).toBeVisible()
  await expect(capsule.getByRole('link', { name: 'Call Parker Construction' })).toHaveAttribute('href', 'tel:6155550100')
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
  await expect(page.getByLabel('Your full name')).toHaveCount(0)
  // The optional row is still there to read, with no dead button on it.
  await expect(page.getByText('Stamped ashlar pattern', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /question first/ })).toHaveCount(0)
  // Approving is not a next step, and nothing is due now.
  await expect(page.getByRole('heading', { name: 'What happens next' })).toHaveCount(0)
  await expect(page.getByText(/Pay \$/)).toHaveCount(0)

  // A closed job reads the same.
  spies.setPayload(proposalPayload({ contact: { stage: 'closed' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('region', { name: 'Quote closed' }).getByText('This quote is no longer open.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)

  expect(spies.approve).toHaveLength(0)
  expect(spies.requestChanges).toHaveLength(0)
  expect(spies.stray).toEqual([])
})

test('a declined quote, or one already moved to a job, can still be approved but offers no question', async ({ page, context }) => {
  // The approve endpoint accepts both; the request changes endpoint refuses
  // both (410), so neither Ask button may show.
  const spies = await mockPortal(context, proposalPayload({ contact: { proposal_status: 'rejected' } }))
  await openPortal(page)
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toBeVisible()
  await expect(page.getByText('Stamped ashlar pattern', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: /question first/ })).toHaveCount(0)

  for (const stage of ['job', 'invoice']) {
    spies.setPayload(proposalPayload({ contact: { stage } }))
    await page.reload({ waitUntil: 'domcontentloaded' })
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve this quote' })).toBeVisible()
    await expect(page.getByText('Stamped ashlar pattern', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /question first/ })).toHaveCount(0)
  }

  // Approving still works and reaches the server.
  await fillApproval(page)
  await page.getByRole('button', { name: 'Approve this quote' }).click()
  await expect.poll(() => spies.approve.length).toBe(1)
  expect(spies.requestChanges).toHaveLength(0)
  expect(spies.stray).toEqual([])
})

test('a failed reload after approval keeps the thank you, not an error', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)
  await fillApproval(page)

  spies.setApproveReply({
    status: 200,
    body: { ok: true, signed_by: 'Marco Castellanos', approved_at: '2026-10-10T14:00:00.000Z' },
    after: 'down'
  })
  await page.getByRole('button', { name: 'Approve this quote' }).click()

  await expect.poll(() => spies.approve.length).toBe(1)
  await expect(page.getByText('Thanks, Marco.')).toBeVisible()
  await expect(page.getByText('Unavailable')).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: 'Hi Marco, your quote is ready.' })).toBeVisible()
  // The quote is approved, so the optional row offers no question, even
  // though the page could not read the link again to learn it.
  await expect(page.getByText('Stamped ashlar pattern', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /Ask about this/ })).toHaveCount(0)
})

test('the signature field starts empty, capitalizes words, and Return does not submit', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload())
  await openPortal(page)

  const name = page.getByLabel('Your full name')
  await expect(name).toHaveValue('')
  await expect(name).toHaveAttribute('autocapitalize', 'words')
  await fillApproval(page)
  await name.press('Enter')
  await page.waitForTimeout(500)
  expect(spies.approve).toHaveLength(0)
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toBeVisible()

  // Return on the ticked authority box does not submit either; it stays ticked.
  const authority = page.getByRole('checkbox', { name: /I have the authority to approve this proposal/ })
  await authority.press('Enter')
  await page.waitForTimeout(500)
  expect(spies.approve).toHaveLength(0)
  await expect(authority).toBeChecked()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toBeVisible()

  // Nor does Return in the question form's name field; the note takes new lines.
  await page.getByRole('button', { name: 'Ask Parker a question first' }).click()
  const note = page.getByLabel('Changes needed')
  await note.fill('Can you start in May?')
  await page.getByLabel('Your full name').press('Enter')
  await note.press('Enter')
  await page.waitForTimeout(500)
  expect(spies.requestChanges).toHaveLength(0)
  await expect(note).toHaveValue(/Can you start in May\?/)
  await expect(note).toHaveValue(/\n/)
  await page.getByRole('button', { name: 'Back' }).click()
  await expect(page.getByRole('button', { name: 'Approve this quote' })).toBeVisible()
  await page.waitForTimeout(500)
  expect(spies.approve).toHaveLength(0)

  await page.getByRole('button', { name: 'Approve this quote' }).click()
  await expect.poll(() => spies.approve.length).toBe(1)
})

test('the greeting uses a first name written last name first, and Hi there for a company', async ({ page, context }) => {
  const spies = await mockPortal(context, proposalPayload({ contact: { name: 'Castellanos, Marco' } }))
  await openPortal(page)
  await expect(page.getByRole('heading', { level: 1, name: 'Hi Marco, your quote is ready.' })).toBeVisible()

  spies.setPayload(proposalPayload({ contact: { name: 'The Roof Doctor' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Hi there, your quote is ready.' })).toBeVisible()

  // A company typed in capitals that starts with an acronym, and a person
  // with a middle initial.
  spies.setPayload(proposalPayload({ contact: { name: 'JB CONTRACTING' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Hi there, your quote is ready.' })).toBeVisible()
  spies.setPayload(proposalPayload({ contact: { name: 'John Q. Public' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Hi John, your quote is ready.' })).toBeVisible()

  // A name saved in sentence case, as a phone keyboard types it, is still a
  // person's; a household label is not a first name.
  spies.setPayload(proposalPayload({ contact: { name: 'Marco castellanos' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Hi Marco, your quote is ready.' })).toBeVisible()
  spies.setPayload(proposalPayload({ contact: { name: 'Johnson Residence' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Hi there, your quote is ready.' })).toBeVisible()

  // A first name typed with its own capitals keeps them when the surname is
  // in lower case, and a name joined with "and" is a company's.
  spies.setPayload(proposalPayload({ contact: { name: 'DeShawn jones' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Hi DeShawn, your quote is ready.' })).toBeVisible()
  spies.setPayload(proposalPayload({ contact: { name: 'Smith and sons' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Hi there, your quote is ready.' })).toBeVisible()

  // Letters outside ASCII are still a person's name, in the headline and
  // in the thanks after approving. The link stops answering after the
  // approval (as in the failed reload test) so the thanks line stays put.
  spies.setPayload(proposalPayload({ contact: { name: 'José García' } }))
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Hi José, your quote is ready.' })).toBeVisible()
  spies.setApproveReply({
    status: 200,
    body: { ok: true, signed_by: 'José García', approved_at: '2026-10-10T14:00:00.000Z' },
    after: 'down'
  })
  await fillApproval(page, 'José García')
  await page.getByRole('button', { name: 'Approve this quote' }).click()
  await expect.poll(() => spies.approve.length).toBe(1)
  await expect(page.getByText('Thanks, José.')).toBeVisible()
})

test('the header text stays readable over a bright cover photo', async ({ page, context }) => {
  // An open quote, valid until November 1, read on October 10.
  await page.clock.setFixedTime(new Date('2026-10-10T14:00:00.000Z'))
  await mockPortal(context, proposalPayload({
    contact: { quote_expires_at: '2026-11-02T04:59:59.999Z' },
    photos: [{ url: 'https://img.example.com/bright.jpg', caption: 'Finished pool deck' }]
  }))
  await openPortal(page)
  await expect(page.getByText('Valid until November 1', { exact: true })).toBeVisible()

  const header = page.locator('header').first()
  const cover = header.locator('img')
  await expect(cover).toHaveCount(1)
  await expect.poll(() => cover.evaluate((img) => {
    const el = img as HTMLImageElement
    return el.complete && el.naturalWidth > 0
  })).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))

  // Every line of text in the header, its color and where it sits.
  const SELECTORS = ['.fhp-brand__name', '.fhp-brand__trust', '.fhp-headline', '.fhp-address', '.fhp-meta']
  const texts = await page.evaluate((selectors) => selectors.flatMap((sel) => {
    const el = document.querySelector<HTMLElement>(sel)
    if (!el) return []
    const r = el.getBoundingClientRect()
    return [{ sel, color: getComputedStyle(el).color, x: r.left, y: r.top, w: r.width, h: r.height }]
  }), SELECTORS)
  expect(texts.length).toBeGreaterThanOrEqual(4)

  // Hide the words, photograph the header, and read the brightest pixel
  // under each line: that is the worst ground any letter sits on.
  await page.addStyleTag({ content: `${SELECTORS.join(', ')} { color: transparent !important; -webkit-text-fill-color: transparent !important; }` })
  const box = await header.boundingBox()
  if (!box) throw new Error('The header has no box')
  const shot = (await header.screenshot()).toString('base64')
  const grounds = await page.evaluate(async ({ b64, lines, frame }) => {
    const img = new Image()
    img.src = `data:image/png;base64,${b64}`
    await img.decode()
    const canvas = document.createElement('canvas')
    canvas.width = img.width
    canvas.height = img.height
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('No canvas')
    ctx.drawImage(img, 0, 0)
    const scale = img.width / frame.width
    const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
    return lines.map((t) => {
      const sx = Math.max(0, Math.round((t.x - frame.x) * scale))
      const sy = Math.max(0, Math.round((t.y - frame.y) * scale))
      const sw = Math.max(1, Math.min(img.width - sx, Math.round(t.w * scale)))
      const sh = Math.max(1, Math.min(img.height - sy, Math.round(t.h * scale)))
      const d = ctx.getImageData(sx, sy, sw, sh).data
      let brightest = 0
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * lin(d[i]) + 0.7152 * lin(d[i + 1]) + 0.0722 * lin(d[i + 2])
        if (l > brightest) brightest = l
      }
      return { sel: t.sel, brightest }
    })
  }, { b64: shot, lines: texts, frame: box })

  for (const ground of grounds) {
    const line = texts.find((t) => t.sel === ground.sel)
    if (!line) continue
    const ratio = contrastRatio(luminanceOf(...rgbOf(line.color)), ground.brightest)
    expect(ratio, `${ground.sel} over the brightest pixel under it`).toBeGreaterThanOrEqual(4.5)
  }
})
