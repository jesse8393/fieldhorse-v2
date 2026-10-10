// The customer quote page (docs/design/2026-10-redesign/SPEC.md, section
// 9.9, decisions D7, D12 and D13) in the Fieldhorse proposal theme.
//
// The page is public, so none of these tests sign in. Every /api call is
// mocked with context.route: /api/public-link serves a proposal, and the
// approve and request changes endpoints are spies, so nothing is ever sent
// except by a tap the test makes. Any other /api request, or any request to
// a Supabase host, fails the test.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'

test.use({ viewport: { width: 390, height: 844 } })

const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
)

type Overrides = {
  contact?: Record<string, unknown>
  company?: Record<string, unknown>
  photos?: Array<Record<string, unknown>>
  items?: Array<Record<string, unknown>>
}

function proposalPayload({ contact = {}, company = {}, photos = [], items }: Overrides = {}) {
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
    items: items ?? [
      { id: 'i1', section: 'Site', description: 'Excavate and grade, 1,100 sq ft', qty: 1, rate: 2200, amount: 2200, is_optional: false, is_excluded: false, sort_order: 1 },
      { id: 'i2', section: 'Steel', description: 'Rebar, #4 at 18 in on center', qty: 1, rate: 2860, amount: 2860, is_optional: false, is_excluded: false, sort_order: 2 },
      { id: 'i3', section: 'Concrete', description: '4 in slab, 4,000 psi fiber mix, broom finish', qty: 1, rate: 9350, amount: 9350, is_optional: false, is_excluded: false, sort_order: 3 },
      { id: 'i4', section: 'Finish', description: 'Joints, pump truck and haul off', qty: 1, rate: 4048, amount: 4048, is_optional: false, is_excluded: false, sort_order: 4 },
      { id: 'i5', section: 'Finish', description: 'Stamped ashlar pattern', qty: 1, rate: 4950, amount: 4950, is_optional: true, is_excluded: false, sort_order: 5 },
      { id: 'i6', section: 'Site', description: 'Fence removal', qty: 1, rate: 700, amount: 700, is_optional: false, is_excluded: true, sort_order: 6 }
    ],
    payments: [],
    changeOrders: [],
    insurance: null,
    invoices: [],
    photos
  }
}

type Spies = {
  approve: Array<Record<string, unknown>>
  requestChanges: Array<Record<string, unknown>>
  stray: string[]
  setPayload: (next: ReturnType<typeof proposalPayload>) => void
}

// Serves /api/public-link?token=t1 and records everything else.
async function mockPortal(context: BrowserContext, initial: ReturnType<typeof proposalPayload>): Promise<Spies> {
  let current = initial
  const spies: Spies = {
    approve: [],
    requestChanges: [],
    stray: [],
    setPayload: (next) => { current = next }
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
  await context.route('https://img.example.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/png', body: TINY_PNG })
  )
  await context.route(
    (url) => url.pathname === '/api/public-link' && url.searchParams.get('token') === 't1',
    (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify(current)
    })
  )
  await context.route('**/api/public-link-approve', async (route) => {
    const body = route.request().postDataJSON()
    spies.approve.push(body)
    // What the server does: the proposal is approved from now on.
    current = proposalPayload({
      contact: { ...current.contact, proposal_status: 'approved' },
      company: current.company,
      photos: current.photos,
      items: current.items
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
  await expect(page.getByText('Pay $9,229.00 now to reserve your start date. The balance is due after the walkthrough.')).toBeVisible()
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
  // Name and authority are still required, as before.
  await expect(page.getByLabel('Your full name')).toHaveValue('Marco Castellanos')
  await expect(approve).toBeDisabled()
  await page.getByRole('checkbox', { name: /I have the authority to approve this proposal/ }).check()
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

test('with a photo the first one is the cover, fading into the header', async ({ page, context }) => {
  await mockPortal(context, proposalPayload({
    photos: [
      { url: 'https://img.example.com/cover.png', caption: 'Finished deck' },
      { url: 'https://img.example.com/second.png' }
    ]
  }))
  await openPortal(page)

  const cover = page.locator('header img')
  await expect(cover).toHaveCount(1)
  await expect(cover).toHaveAttribute('src', 'https://img.example.com/cover.png')
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

test('what happens next is three numbered steps', async ({ page, context }) => {
  await mockPortal(context, proposalPayload())
  await openPortal(page)

  await expect(page.getByRole('heading', { name: 'What happens next' })).toBeVisible()
  const steps = page.getByRole('list', { name: 'What happens next' }).getByRole('listitem')
  await expect(steps).toHaveText([
    'You approve and pay the deposit.',
    'Parker sends you a start date.',
    'You pay the balance after the walkthrough.'
  ])
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

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
  expect(overflow).toBeLessThanOrEqual(0)
})
