// Long names, long addresses and six or seven figure amounts for the large
// text and zoom checks in mobile-ui-ux.spec.ts. The clock is fixed at
// Thursday, October 8, 2026, 6:40 am Central.
//
// Sizes a person really uses on a phone:
//   zoom   a narrower window in CSS px: 206 px is a 412 px phone (Pixel 7)
//          at 200 percent, 180 px a 360 px phone at 200 percent.
//   text   the text alone made bigger with text-size-adjust on html, which
//          is how Chrome on Android applies the system font size. Lengths
//          in px and em stay put; only the drawn text grows.
import { expect, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { signIn } from './signIn.ts'

export const MORNING = new Date('2026-10-08T11:40:00Z')

export const BIG_NAME = 'Maximiliano Alessandro Castellanos Villanueva'
export const HOA_NAME = 'The Riverside Commons Homeowners Association of Rutherford County'
export const LONG_ADDR = '18450 Old Nashville Highway Building C Suite 2100, Murfreesboro, TN 37129'
export const LONG_TITLE = 'Commercial parking lot demolition, regrade and full depth concrete repour with new drainage'
const CO = 'Parker Brothers Concrete Flatwork and Foundation Repair Company of Middle Tennessee'
const BIG = 1234567.89

/** A phone at its usual size, and the same phone zoomed to 200 percent. */
export const PHONES = [
  { name: 'Pixel 7', width: 412, height: 839 },
  { name: '360 px phone', width: 360, height: 780 }
] as const
export const ZOOMED = [
  { name: 'Pixel 7 at 200 percent zoom', width: 206, height: 420 },
  { name: '360 px phone at 200 percent zoom', width: 180, height: 390 }
] as const

const CL_BIG = { id: 'cl-big', name: BIG_NAME, phone: '615-555-0199', email: 'maximiliano.castellanos.villanueva@riversidecommonshoa.org', address: LONG_ADDR }
const CL_HOA = { id: 'cl-hoa', name: HOA_NAME, phone: '615-555-0142', email: 'board@riversidecommonshoa.org', address: '2207 Stones River Greenway Access Road, La Vergne, TN 37086' }

function contact(p: Record<string, unknown>) {
  return {
    user_id: 'qa-user-1', client_id: 'cl-big', phone: CL_BIG.phone, email: CL_BIG.email, address: LONG_ADDR,
    notes: null, scope_text: null, milestones: [], created_at: '2026-09-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
    proposal_status: null, follow_up_on: null, completed_at: null, invoice_no: null, cost: null, fh_clients: CL_BIG,
    ...p
  }
}
function invoice(p: Record<string, unknown>) {
  return {
    user_id: 'qa-user-1', client_id: 'cl-big', description: null, notes: null, status: 'sent', sequence_number: 1,
    issued_at: '2026-09-20T12:00:00Z', created_at: '2026-09-20T12:00:00Z', updated_at: '2026-09-20T12:00:00Z', fh_clients: CL_BIG,
    ...p
  }
}
const item = (id: string, sort: number, description: string, qty: number, rate: number, extra: Record<string, unknown> = {}) => ({
  id, quote_id: 'q-big', contact_id: null, user_id: 'qa-user-1', description, qty, rate, amount: Math.round(qty * rate * 100) / 100,
  section: null, sort_order: sort, unit: null, notes: null, is_optional: false, is_excluded: false,
  created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-01T12:00:00Z', ...extra
})

const LINES = [
  item('qi-1', 1, 'Demolish and haul off existing asphalt and failed concrete across the entire north and east parking areas', 1, BIG),
  item('qi-2', 2, 'Full depth 6 inch 4,000 psi fiber reinforced concrete with #4 rebar at 18 inches on center', 12500, 98.76, { unit: 'sq ft' }),
  item('qi-3', 3, 'Trench drain', 1, 987654.32, { is_optional: true }),
  item('qi-4', 4, 'Stamped ashlar slate pattern with integral color and two coats of sealer on all walkways', 3450, 24.5, { unit: 'sq ft' })
]

const TABLES = {
  profiles: [{
    user_id: 'qa-user-1', full_name: 'Jesse Parker Montgomery', company_name: CO, company_address: LONG_ADDR, onboarded_at: '2026-07-01T12:00:00Z',
    logo_url: null, location_lat: 35.84, location_lon: -86.36, services: ['Concrete'], company_email: 'office@parkerbrothersconcrete.com',
    brand_accent_hex: null, preferences: { quote_follow_up: { enabled: true, days: 3 } }
  }],
  organizations: [{ id: 'org-1', name: CO, created_at: '2026-07-01T12:00:00Z' }],
  fh_clients: [
    { ...CL_BIG, user_id: 'qa-user-1', company_name: HOA_NAME, created_at: '2026-08-01T12:00:00Z' },
    { ...CL_HOA, user_id: 'qa-user-1', company_name: null, created_at: '2026-08-02T12:00:00Z' }
  ],
  fh_contacts: [
    contact({ id: 'c-big', stage: 'job', name: BIG_NAME, job_title: LONG_TITLE, amount: BIG, job_type: 'Concrete' }),
    contact({ id: 'c-hoa', stage: 'job', client_id: 'cl-hoa', name: HOA_NAME, job_title: 'Clubhouse pool deck tear out and replacement with stamped concrete', amount: 987654.32, address: CL_HOA.address, fh_clients: CL_HOA }),
    contact({ id: 'c-inv', stage: 'invoice', name: BIG_NAME, job_title: 'Equipment shed slab and approach apron', amount: 2485000 }),
    contact({ id: 'c-done', stage: 'closed', client_id: 'cl-hoa', name: HOA_NAME, job_title: 'Retaining wall along the greenway', amount: 1098765.43, cost: 765432.1, completed_at: '2026-09-29T12:00:00Z', fh_clients: CL_HOA })
  ],
  fh_leads: [{
    id: 'l-big', user_id: 'qa-user-1', client_id: 'cl-hoa', title: 'Tennis court resurfacing and new perimeter walkway with lighting', status: 'open',
    job_type: 'Concrete', referred_by: 'Referral', source: 'Referral', notes: null, last_contact: null, quote_id: null,
    follow_up_on: '2026-09-28', created_at: '2026-09-01T12:00:00Z', updated_at: '2026-09-28T12:00:00Z', fh_clients: CL_HOA
  }],
  fh_quotes: [
    {
      id: 'q-big', user_id: 'qa-user-1', client_id: 'cl-big', title: LONG_TITLE, amount: BIG, status: 'sent', scope_text: null, terms_text: null,
      exclusions_text: null, job_type: 'Concrete', sent_at: '2026-10-06T12:00:00Z', expires_at: null, change_request_note: null,
      change_requested_at: null, approved_version_id: null, lead_id: null, job_id: null, origin_contact_id: null,
      created_at: '2026-09-01T12:00:00Z', updated_at: '2026-10-06T12:00:00Z', fh_clients: CL_BIG
    },
    {
      id: 'q-hoa', user_id: 'qa-user-1', client_id: 'cl-hoa', title: 'Clubhouse pool deck tear out', amount: 987654.32, status: 'changes_requested',
      scope_text: null, terms_text: null, exclusions_text: null, job_type: null, sent_at: '2026-10-01T12:00:00Z', expires_at: null,
      change_request_note: 'Please separate the coping allowance and show the stamped walkway as its own line so the board can vote on it.',
      change_requested_at: '2026-10-08T09:00:00Z', approved_version_id: null, lead_id: null, job_id: null, origin_contact_id: null,
      created_at: '2026-09-02T12:00:00Z', updated_at: '2026-10-08T09:00:00Z', fh_clients: CL_HOA
    }
  ],
  fh_quote_items: LINES,
  fh_invoices: [
    invoice({ id: 'i-dep', contact_id: 'c-big', title: 'Deposit', amount: 246913.58, status: 'paid', sequence_number: 1, due_at: '2026-09-10', issued_at: '2026-09-01T12:00:00Z', created_at: '2026-09-01T12:00:00Z' }),
    invoice({ id: 'i-big', contact_id: 'c-big', title: 'Progress draw for demolition, regrade and the first pour', amount: BIG, sequence_number: 2, due_at: '2026-10-01' }),
    invoice({ id: 'i-hoa', contact_id: 'c-hoa', client_id: 'cl-hoa', title: 'Final balance', amount: 987654.32, sequence_number: 1, due_at: '2026-10-08', fh_clients: CL_HOA }),
    invoice({ id: 'i-inv', contact_id: 'c-inv', title: 'Balance', amount: 2485000, sequence_number: 1, due_at: '2026-10-15' })
  ],
  fh_payments: [
    { id: 'p-dep', user_id: 'qa-user-1', contact_id: 'c-big', invoice_id: 'i-dep', amount: 246913.58, method: 'check', reference: '100245', kind: 'deposit', paid_on: '2026-10-06', created_at: '2026-10-06T15:00:00Z' },
    { id: 'p-hoa', user_id: 'qa-user-1', contact_id: 'c-done', invoice_id: null, amount: 1098765.43, method: 'ach', reference: null, kind: null, paid_on: '2026-10-07', created_at: '2026-10-07T15:00:00Z' }
  ],
  fh_schedule: [
    { id: 's-1', contact_id: 'c-big', title: 'Pour north lot section A with crew A and the pump truck', start_at: '2026-10-08T12:30:00Z', end_at: '2026-10-08T16:00:00Z' },
    { id: 's-2', contact_id: 'c-hoa', title: 'Site walk with the board president and the property manager', start_at: '2026-10-08T16:30:00Z', end_at: '2026-10-08T17:30:00Z' },
    { id: 's-3', contact_id: 'c-inv', title: 'Final walkthrough', start_at: '2026-10-08T19:30:00Z', end_at: '2026-10-08T20:30:00Z' },
    { id: 's-4', contact_id: 'c-big', title: 'Saw cut joints', start_at: '2026-10-09T14:00:00Z', end_at: '2026-10-09T15:00:00Z' }
  ].map((r) => ({ user_id: 'qa-user-1', description: null, created_at: '2026-10-01T12:00:00Z', ...r })),
  fh_notes: [
    { id: 'n-1', user_id: 'qa-user-1', contact_id: 'c-big', text: 'Inspector confirmed Friday at the north gate.', category: 'note', created_at: '2026-10-06T12:00:00Z' }
  ]
}

/**
 * Makes the text alone bigger from the first paint, as the phone's font
 * size setting does. 100 leaves it alone.
 */
export async function textSize(context: BrowserContext, percent: number) {
  if (percent === 100) return
  await context.addInitScript((p) => {
    // The script can run before the document has its root element.
    const add = () => {
      const style = document.createElement('style')
      style.textContent = `html { -webkit-text-size-adjust: ${p}% !important; text-size-adjust: ${p}% !important; }`
      document.documentElement.appendChild(style)
    }
    if (document.documentElement) add()
    else new MutationObserver((_, watch) => { if (document.documentElement) { watch.disconnect(); add() } }).observe(document, { childList: true })
  }, percent)
}

/** Signs in with the long records above and opens a screen. */
export async function openBig(context: BrowserContext, page: Page, path: string) {
  await signIn(context, { tables: TABLES })
  await context.route('https://api.open-meteo.com/**', (route) => route.abort())
  await page.clock.setFixedTime(MORNING)
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await bigReady(page)
}

/** The screen has its heading and nothing still loading. */
export async function bigReady(page: Page) {
  await expect(page.locator('#fh-main h1').first()).toBeVisible({ timeout: 20_000 })
  await expect(page.locator('#fh-main [aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 })
  await page.waitForTimeout(500)
}

// The customer's quote link, answered here: the classic and Fieldhorse
// templates with the long records, and a six figure Fieldhorse quote.
const PORTAL_ITEMS = LINES.map((l, i) => ({ id: `pi-${i}`, section: i < 2 ? 'Site work and demolition' : 'Concrete and finish', description: l.description, qty: l.qty, rate: l.rate, amount: l.amount, unit: l.unit, is_optional: l.is_optional, is_excluded: false, sort_order: i + 1 }))
function proposal(template: string) {
  return {
    ok: true, kind: 'proposal',
    contact: {
      id: 'c-big', name: BIG_NAME, address: LONG_ADDR, phone: '615 555 0199', email: CL_BIG.email, job_title: LONG_TITLE,
      stage: 'quote', proposal_status: 'sent', amount: BIG, created_at: '2026-10-01T12:00:00.000Z', quote_sent_at: '2026-10-06T12:00:00.000Z', terms_text: ''
    },
    company: {
      name: CO, phone: '615 555 0100', email: 'office@parkerbrothersconcrete.com', insured_text: 'Licensed and insured', license_number: 'TN 0012345678',
      logo_url: null, estimate_template: template, payment_link: '', address: LONG_ADDR
    },
    items: PORTAL_ITEMS, payments: [], changeOrders: [], insurance: null, invoices: [], photos: []
  }
}

/** Opens /p/<token>: fh and classic carry the long quote, six a $184,580.00 one. */
export async function openBigPortal(context: BrowserContext, page: Page, token: 'fh' | 'classic' | 'six') {
  const six = proposal('fieldhorse')
  six.contact = { ...six.contact, name: 'Rosa Delgado', address: '412 Burkitt Station Rd, Murfreesboro', job_title: 'Shop slab', amount: 184580 }
  six.items = [{ id: 'six-1', section: 'Concrete', description: '6 inch shop slab with thickened edges', qty: 1, rate: 184580, amount: 184580, unit: null, is_optional: false, is_excluded: false, sort_order: 1 }]
  const payloads: Record<string, unknown> = { fh: proposal('fieldhorse'), classic: proposal('classic'), six }
  await context.route((u) => u.pathname === '/api/public-link', async (route) => {
    const t = new URL(route.request().url()).searchParams.get('token') || ''
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payloads[t] ?? {}) })
  })
  await context.route(/supabase\.co/, (route) => route.abort())
  await page.clock.setFixedTime(MORNING)
  await page.goto(`/p/${token}`, { waitUntil: 'domcontentloaded', timeout: 60_000 })
}

/** Where a block's text is drawn: the union of its line boxes, and how many lines. */
export function ink(loc: Locator) {
  return loc.evaluate((el) => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0)
    return {
      top: Math.min(...rects.map((r) => r.top)), bottom: Math.max(...rects.map((r) => r.bottom)),
      left: Math.min(...rects.map((r) => r.left)), right: Math.max(...rects.map((r) => r.right)),
      lines: new Set(rects.map((r) => Math.round(r.top))).size
    }
  })
}

/** A box's left and right edges, and the window's width. */
export function edges(loc: Locator) {
  return loc.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width), window: document.documentElement.clientWidth }
  })
}
