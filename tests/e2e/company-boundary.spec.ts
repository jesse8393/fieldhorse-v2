// Jobs and quotes stay inside the active company (Phase 8, Task 7).
//
// The jobs list (useJobs) carries every company the person belongs to plus
// the jobs a partner shared with them, because the Jobs list is meant to
// show those. The screens that act on jobs read only the active company:
// the Unscheduled tray on the desktop Schedule, which writes visits, and
// Money's Waiting on approval group. Here the mock's active company is
// org-1, and a partner's job and quote from org-2 come back in the jobs
// list the way row level security returns a shared job.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

test.use({ timezoneId: 'America/Chicago' })

// Thursday, October 8, 2026 at 9:00 am Central.
const NOW = new Date('2026-10-08T14:00:00Z')

const CLIENT = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }
const PARTNER_CLIENT = { id: 'cl-partner', name: 'Dana Kessler', phone: '555-0199', email: 'dana@kessler.example' }

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
    quote_sent_at: null,
    invoice_no: null,
    cost: null,
    fh_clients: CLIENT,
    ...partial
  }
}

// Another company's rows, shared with this person through a job partnership.
const PARTNER = {
  org_id: 'org-2',
  user_id: 'partner-user-1',
  client_id: PARTNER_CLIENT.id,
  address: '88 Mill Creek Rd',
  fh_clients: PARTNER_CLIENT
}

const CONTACTS = [
  contact({ id: 'c-own-job', stage: 'job', name: 'Plumbing Bellevue', job_title: 'Slab and trench', amount: 33100 }),
  contact({
    id: 'c-own-quote', stage: 'quote', name: 'Marco Castellanos', job_title: 'Pool deck pour', amount: 18458,
    proposal_status: 'sent', quote_sent_at: '2026-10-07T11:00:00Z'
  }),
  contact({ ...PARTNER, id: 'c-partner-job', stage: 'job', name: 'Kessler Build', job_title: 'Barn foundation', amount: 52000, created_at: '2026-10-05T12:00:00Z' }),
  contact({
    ...PARTNER, id: 'c-partner-quote', stage: 'quote', name: 'Whitfield Homes', job_title: 'Basement walls', amount: 27300,
    proposal_status: 'viewed', quote_sent_at: '2026-10-06T15:00:00Z'
  })
]

const TABLES = { fh_contacts: CONTACTS, fh_schedule: [], fh_invoices: [], fh_payments: [] }

async function open(context: BrowserContext, page: Page, path: string) {
  await signIn(context, { tables: TABLES })
  await page.clock.setFixedTime(NOW)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
}

test.describe('the desktop Unscheduled tray', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop Schedule board')
  test.use({ viewport: { width: 1440, height: 900 } })

  test('lists only jobs from the active company, never a partner job from another company', async ({ context, page }) => {
    await open(context, page, '/schedule')
    await expect(page.locator('.fh-build-weekplan')).toBeVisible({ timeout: 30_000 })
    const tray = page.getByRole('region', { name: 'Unscheduled jobs' })
    await expect(tray.getByText('Plumbing Bellevue', { exact: true })).toBeVisible()
    await expect(tray.getByText('Kessler Build', { exact: true })).toHaveCount(0)
    await expect(tray.getByRole('button', { name: /Drag Kessler Build/ })).toHaveCount(0)
    await expect(tray.locator('.fhsch-card')).toHaveCount(1)
  })
})

test.describe('Money, Waiting on approval', () => {
  test('lists only quotes from the active company on a phone', async ({ context, page, isMobile }) => {
    test.skip(!isMobile, 'Phone Money screen')
    await open(context, page, '/invoices')
    await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible({ timeout: 30_000 })
    const waiting = page.getByRole('region', { name: 'Waiting on approval' })
    await expect(waiting.getByText('Marco Castellanos', { exact: true })).toBeVisible()
    await expect(waiting.getByText('Whitfield Homes', { exact: true })).toHaveCount(0)
    await expect(waiting.getByText('$27,300.00', { exact: true })).toHaveCount(0)
  })

  test('lists only quotes from the active company on a desktop', async ({ context, page, isMobile }) => {
    test.skip(isMobile, 'Desktop Money screen')
    await page.setViewportSize({ width: 1440, height: 900 })
    await open(context, page, '/invoices')
    await expect(page.getByRole('heading', { level: 1, name: 'Money' })).toBeVisible({ timeout: 30_000 })
    const waiting = page.getByRole('region', { name: 'Waiting on approval', exact: true })
    await expect(waiting.getByText('Marco Castellanos', { exact: true })).toBeVisible()
    await expect(waiting.getByText('Whitfield Homes', { exact: true })).toHaveCount(0)
    await expect(waiting.getByText('$27,300.00', { exact: true })).toHaveCount(0)
  })
})

// The Jobs list is meant to show a partner's shared jobs, so it keeps them.
test.describe('the Jobs list', () => {
  test('still shows the partner job and quote shared with this person', async ({ context, page }) => {
    await open(context, page, '/work')
    const main = page.locator('#fh-main')
    await expect(main.getByText('Plumbing Bellevue', { exact: true }).first()).toBeVisible({ timeout: 30_000 })
    await expect(main.getByText('Kessler Build', { exact: true }).first()).toBeVisible()
    await expect(main.getByText('Whitfield Homes', { exact: true }).first()).toBeVisible()
  })
})
