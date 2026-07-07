// Customer-document QA — screenshots the public /p/:token pages
// (proposal, invoice, statement, change order) the way a CUSTOMER
// sees them: phone + desktop, via the hermetic mock plus a stubbed
// /api/public-link payload shaped exactly like the Netlify function's
// real response.
import { chromium } from 'playwright-core'
import { installMock, session } from './qa-mock.mjs'
import { mkdirSync } from 'node:fs'

const scratch = process.env.QA_OUT || './qa-shots'
mkdirSync(scratch, { recursive: true })

const now = Date.now()
const day = 86400000
const iso = (d) => new Date(d).toISOString()

const company = {
  name: 'Parker Construction Company',
  address: '412 Burkitt Station Rd, Nolensville, TN 37135',
  phone: '(615) 555-0142',
  email: 'office@parkerconstruction.co',
  website: 'parkerconstruction.co',
  logo_url: null,
  brand_accent_hex: null,
  estimate_template: 'classic',
  license_number: 'TN GC-7741208',
  insured_text: 'Licensed, bonded & insured · GL $2M',
  warranty_default: 'All workmanship is guaranteed for two (2) years from the date of substantial completion. Manufacturer warranties on materials pass through to the owner. This proposal is valid for 30 days from the issue date; pricing may be revised thereafter due to material cost changes.',
  payment_link: 'https://buy.stripe.com/example',
  payment_instructions: 'We accept check, ACH, and all major cards. Make checks payable to Parker Construction Company.'
}

const contact = {
  id: 'c-quote',
  name: 'Margaret & Tom Whitfield',
  address: '1214 Copperstone Dr, Brentwood, TN 37027',
  phone: '(615) 555-0177',
  email: 'mwhitfield@gmail.com',
  job_title: 'Backyard patio + retaining wall',
  job_type: 'Concrete',
  stage: 'quote',
  proposal_status: 'sent',
  quote_sent_at: iso(now - 2 * day),
  quote_expires_at: iso(now + 28 * day),
  created_at: iso(now - 9 * day),
  terms_text: '',
  scope_text: '',
  exclusions_text: 'Landscaping restoration beyond rough grade\nIrrigation repair or rerouting',
  amount: 48750
}

const items = [
  { id: 'i1', section: 'Site preparation', description: 'Demo + haul-off of existing 380 sf concrete patio', qty: 1, unit: 'ls', rate: 2400, amount: 2400, is_optional: false, is_excluded: false, sort_order: 1 },
  { id: 'i2', section: 'Site preparation', description: 'Excavation and grading for new patio + wall footing', qty: 1, unit: 'ls', rate: 3150, amount: 3150, is_optional: false, is_excluded: false, sort_order: 2 },
  { id: 'i3', section: 'Retaining wall', description: 'Poured concrete retaining wall, 42 ft × 4 ft, with footing drain', qty: 42, unit: 'lf', rate: 385, amount: 16170, is_optional: false, is_excluded: false, sort_order: 3 },
  { id: 'i4', section: 'Retaining wall', description: 'Stone veneer facing, dry-stack ledgestone', qty: 168, unit: 'sf', rate: 38, amount: 6384, is_optional: false, is_excluded: false, sort_order: 4 },
  { id: 'i5', section: 'Patio', description: 'Stamped concrete patio, 520 sf, ashlar slate pattern, two-tone', qty: 520, unit: 'sf', rate: 24, amount: 12480, is_optional: false, is_excluded: false, sort_order: 5 },
  { id: 'i6', section: 'Patio', description: 'Steps to lawn (3 risers, 6 ft wide) with bullnose edge', qty: 1, unit: 'ls', rate: 2850, amount: 2850, is_optional: false, is_excluded: false, sort_order: 6 },
  { id: 'i7', section: 'Drainage', description: 'French drain behind wall, tied to daylight at side yard', qty: 60, unit: 'lf', rate: 52, amount: 3120, is_optional: false, is_excluded: false, sort_order: 7 },
  { id: 'i8', section: 'Patio', description: 'OPTION — Gas fire pit rough-in + paver surround', qty: 1, unit: 'ls', rate: 4400, amount: 4400, is_optional: true, is_excluded: false, sort_order: 8 },
  { id: 'i9', section: 'Lighting', description: 'OPTION — Low-voltage wall + step lighting (12 fixtures)', qty: 1, unit: 'ls', rate: 2950, amount: 2950, is_optional: true, is_excluded: false, sort_order: 9 }
]

const invoiceContact = {
  ...contact,
  id: 'c-job2',
  stage: 'invoice',
  proposal_status: 'approved',
  job_title: 'Backyard patio + retaining wall',
  amount: 48750
}

const payments = [
  { id: 'p1', contact_id: 'c-job2', amount: 16250, method: 'check', reference: '2205', paid_on: iso(now - 24 * day).slice(0, 10), created_at: iso(now - 24 * day) },
  { id: 'p2', contact_id: 'c-job2', amount: 16250, method: 'ach', reference: 'draw 2', paid_on: iso(now - 10 * day).slice(0, 10), created_at: iso(now - 10 * day) }
]

const changeOrders = [
  { id: 'co1', contact_id: 'c-job2', sequence_number: 1, title: 'Extend patio 60 sf at grill area', description: 'Owner-requested bump-out at the northeast corner.', amount: 1440, status: 'approved', approved_at: iso(now - 12 * day), approved_by_name: 'Tom Whitfield' },
  { id: 'co2', contact_id: 'c-job2', sequence_number: 2, title: 'Upgrade to smooth-trowel steps', description: '', amount: 0, status: 'void' }
]

const invoicesRows = [
  { id: 'inv1', contact_id: 'c-job2', title: 'Deposit', amount: 16250, status: 'paid', sequence_number: 1, issued_at: iso(now - 26 * day), due_at: iso(now - 19 * day), created_at: iso(now - 26 * day) },
  { id: 'inv2', contact_id: 'c-job2', title: 'Progress draw', amount: 16250, status: 'paid', sequence_number: 2, issued_at: iso(now - 12 * day), due_at: iso(now - 5 * day), created_at: iso(now - 12 * day) },
  { id: 'inv3', contact_id: 'c-job2', title: 'Final', amount: 17690, status: 'sent', sequence_number: 3, issued_at: iso(now - 1 * day), due_at: iso(now + 13 * day), created_at: iso(now - 1 * day) }
]

const PAYLOADS = {
  'qa-proposal': {
    ok: true, kind: 'proposal', change_order_id: null,
    contact, company, items, payments: [], changeOrders: [], insurance: null, invoices: [], photos: []
  },
  'qa-invoice': {
    ok: true, kind: 'invoice', change_order_id: null,
    contact: invoiceContact, company, items, payments, changeOrders, insurance: null, invoices: invoicesRows, photos: []
  },
  'qa-co': {
    ok: true, kind: 'change_order', change_order_id: 'co1',
    contact: invoiceContact, company, items, payments, changeOrders: [{ ...changeOrders[0], status: 'pending', approved_at: null, approved_by_name: null }], insurance: null, invoices: invoicesRows, photos: []
  },
  'qa-statement': {
    ok: true, kind: 'statement',
    client: { id: 'cl-9', name: 'Margaret Whitfield', company_name: null, email: 'mwhitfield@gmail.com', address: '1214 Copperstone Dr, Brentwood, TN 37027' },
    company,
    jobs: [
      { id: 'c-job2', name: 'Margaret & Tom Whitfield', job_title: 'Backyard patio + retaining wall', job_type: 'Concrete', stage: 'invoice', amount: 48750, address: '1214 Copperstone Dr', created_at: iso(now - 30 * day) },
      { id: 'c-job3', name: 'Margaret & Tom Whitfield', job_title: 'Driveway apron repair', job_type: 'Concrete', stage: 'job', amount: 3900, address: '1214 Copperstone Dr', created_at: iso(now - 6 * day) }
    ],
    payments, changeOrders: [changeOrders[0]]
  }
}

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function leg(viewport, tag) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' })
  await installMock(ctx)
  // Re-route the public-link API AFTER installMock so this handler wins
  // (Playwright matches the most recently registered route first).
  await ctx.route('**/api/public-link*', (route) => {
    const token = new URL(route.request().url()).searchParams.get('token')
    const body = PAYLOADS[token]
    if (!body) return route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'not_found', message: 'This link is no longer available.' }) })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await ctx.addInitScript((s) => {
    try { localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(s)); localStorage.setItem('fh-onboarding-seen', '1') } catch {}
  }, session)
  const page = await ctx.newPage()

  for (const token of Object.keys(PAYLOADS)) {
    await page.goto(`http://localhost:5199/p/${token}`)
    await page.waitForFunction(() => document.body.innerText.trim().length > 80, { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(1200)
    await page.screenshot({ path: `${scratch}/doc-${tag}-${token}.png`, fullPage: true })
    console.log(`captured doc-${tag}-${token}`)
  }
  await ctx.close()
}

for (const [tag, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1280, height: 900 }]]) {
  await leg(viewport, tag)
}
await browser.close()
console.log('doc qa complete')
