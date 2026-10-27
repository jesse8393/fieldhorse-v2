// The lead list and the lead screen (PHASE9_PLAN Task 9, SPEC D53, D55,
// D57, D60, D65). A lead lives on fh_leads and points at a client. Its
// screen shows who and what, Call, Message and Navigate, notes saved in
// place, the two buttons Schedule estimate and Quote this, the next
// estimate visit, Mark lost with a second tap and the notes left on the
// old contact row under Earlier notes. The mock (scripts/qa-mock.mjs) has
// two open leads, l-lead1 and l-lead2, on the one client cl-1.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const NOW = '2026-10-08T15:00:00.000Z'
const USER = 'qa-user-1'
const CLIENT = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com', address: '412 Burkitt Station Rd' }

function lead(partial: Record<string, unknown>) {
  return {
    user_id: USER, client_id: 'cl-1', status: 'open', notes: null, last_contact: null, quote_id: null,
    follow_up_on: null, origin_contact_id: null, job_type: null, referred_by: null, source: null,
    created_at: NOW, updated_at: NOW, fh_clients: CLIENT, ...partial
  }
}

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
}

/** Records every PATCH the page sends to fh_leads, as "<id>=<json body>". */
async function recordLeadPatches(page: Page): Promise<string[]> {
  const seen: string[] = []
  await page.route(/\/rest\/v1\/fh_leads\?/, async (route) => {
    const req = route.request()
    if (req.method() === 'PATCH') {
      const id = new URL(req.url()).searchParams.get('id') ?? ''
      seen.push(`${id}=${req.postData() ?? ''}`)
    }
    await route.fallback()
  })
  return seen
}

test.describe('the lead screen', () => {
  test('a lead shows Schedule estimate and Quote this', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/leads/l-lead1')

    await expect(page.getByRole('heading', { level: 1, name: 'Jeff Roy' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Vintage Burkitt Station Drainage')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Call' })).toHaveAttribute('href', 'tel:555-0101')
    await expect(page.getByRole('link', { name: 'Message' })).toHaveAttribute('href', 'sms:555-0101')
    await expect(page.getByRole('link', { name: 'Navigate' })).toHaveAttribute('href', /412%20Burkitt%20Station%20Rd/)
    await expect(page.getByRole('link', { name: 'Schedule estimate' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Quote this' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark lost' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
    // No sheet, drawer or dialog anywhere (D57).
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Schedule estimate opens the new event screen with the lead filled', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/leads/l-lead1')
    await page.getByRole('link', { name: 'Schedule estimate' }).click()
    await expect(page).toHaveURL(/\/schedule\/new\?lead=l-lead1$/, { timeout: 30_000 })
    // The screen is prefilled from the lead (D60): the title reads Estimate,
    // the lead is the linked record and the client's name and address are
    // the where line. No sheet anywhere.
    await expect(page.getByRole('heading', { name: 'Add event' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByLabel('Title')).toHaveValue('Estimate')
    const linkedRecord = page.getByRole('combobox', { name: 'Link to', exact: true })
    await expect(linkedRecord).toHaveValue('Jeff Roy')
    await linkedRecord.click()
    await expect(page.getByRole('option').filter({ hasText: 'Vintage Burkitt Station Drainage' }).filter({ hasText: 'l-lead1' })).toHaveAttribute('aria-selected', 'true')
    await linkedRecord.press('Escape')
    await expect(page.getByLabel('Where')).toHaveValue('Jeff Roy, 412 Burkitt Station Rd')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Quote this links the lead it came from', async ({ context, page }) => {
    // One client with two open leads (the mock's cl-1 has l-lead1 and
    // l-lead2). Quote this on the second must never touch the first.
    await signIn(context)
    const patches = await recordLeadPatches(page)
    await open(page, '/leads/l-lead2')
    await expect(page.getByText('Retaining wall + pad')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('link', { name: 'Quote this' }).click()
    await expect(page).toHaveURL(/\/quotes\/new\?lead=l-lead2$/, { timeout: 30_000 })
    // Task 8 builds /quotes/new; its save marks l-lead2 quoted (D60). Every
    // fh_leads write this flow sends names l-lead2 and never l-lead1.
    await page.waitForTimeout(500)
    expect(patches.filter((p) => p.startsWith('eq.l-lead1'))).toEqual([])
    for (const p of patches) expect(p.startsWith('eq.l-lead2=')).toBe(true)
  })

  test('a lost lead shows no buttons', async ({ context, page }) => {
    await signIn(context, {
      tables: { fh_leads: [lead({ id: 'l-lost', title: 'Fence footing', status: 'lost' })] }
    })
    await open(page, '/leads/l-lost')
    await expect(page.getByRole('heading', { level: 1, name: 'Jeff Roy' })).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Lost', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Schedule estimate' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Quote this' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: /mark lost/i })).toHaveCount(0)
  })

  test('Mark lost takes a second tap and then writes the lead lost', async ({ context, page }) => {
    await signIn(context)
    const patches = await recordLeadPatches(page)
    await open(page, '/leads/l-lead1')
    const markLost = page.getByRole('button', { name: 'Mark lost' })
    await markLost.click()
    // No dialog: the same button asks again (D57).
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const again = page.getByRole('button', { name: 'Tap again to mark lost' })
    await expect(again).toBeVisible()
    expect(patches).toEqual([])
    await again.click()
    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0].startsWith('eq.l-lead1=')).toBe(true)
    expect(JSON.parse(patches[0].slice('eq.l-lead1='.length))).toMatchObject({ status: 'lost' })
    await expect(page.getByText('Lost', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Quote this' })).toHaveCount(0)
  })

  test('notes save in place on blur', async ({ context, page }) => {
    await signIn(context)
    const patches = await recordLeadPatches(page)
    await open(page, '/leads/l-lead1')
    const notes = page.getByLabel('Notes')
    await expect(notes).toBeVisible({ timeout: 30_000 })
    await notes.fill('Wants the trench before the rain.')
    await notes.blur()
    await expect.poll(() => patches.length).toBe(1)
    expect(JSON.parse(patches[0].slice('eq.l-lead1='.length))).toMatchObject({ notes: 'Wants the trench before the rain.' })
    await expect(page.getByRole('status').filter({ hasText: /Synced|Syncing|Offline/ })).toBeVisible()
    // Leaving the field unchanged writes nothing more.
    await notes.focus()
    await notes.blur()
    await page.waitForTimeout(300)
    expect(patches.length).toBe(1)
  })

  test('the next estimate visit and the earlier notes show', async ({ context, page }) => {
    await signIn(context, {
      tables: {
        fh_schedule: [
          { id: 's-est', user_id: USER, lead_id: 'l-lead1', contact_id: null, title: 'Estimate', description: null, start_at: '2026-10-10T14:00:00.000Z', end_at: '2026-10-10T15:00:00.000Z', created_at: NOW },
          { id: 's-old', user_id: USER, lead_id: 'l-lead1', contact_id: null, title: 'Estimate', description: null, start_at: '2026-10-01T14:00:00.000Z', end_at: '2026-10-01T15:00:00.000Z', created_at: NOW }
        ],
        fh_notes: [
          { id: 'n-old', user_id: USER, contact_id: 'c-lead1', lead_id: null, text: 'Called twice, left a message.', category: 'note', created_at: '2026-09-20T12:00:00.000Z' },
          { id: 'n-new', user_id: USER, contact_id: null, lead_id: 'l-lead1', text: 'Gate code is 4412.', category: 'note', created_at: '2026-10-05T12:00:00.000Z' },
          { id: 'n-other', user_id: USER, contact_id: 'c-job1', lead_id: null, text: 'Inspector confirmed Friday.', category: 'note', created_at: NOW }
        ]
      }
    })
    await page.clock.setFixedTime(new Date(NOW))
    await open(page, '/leads/l-lead1')
    const visit = page.getByRole('region', { name: 'Next estimate visit' })
    await expect(visit).toBeVisible({ timeout: 30_000 })
    await expect(visit).toContainText('Sat, Oct 10')
    const earlier = page.getByRole('region', { name: 'Earlier notes' })
    await expect(earlier).toContainText('Gate code is 4412.')
    await expect(earlier).toContainText('Called twice, left a message.')
    await expect(earlier).not.toContainText('Inspector confirmed Friday.')
  })

  test('an old lead link still lands on the new lead', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/leads/c-lead1')
    await expect(page).toHaveURL(/\/leads\/l-lead1$/, { timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Jeff Roy' })).toBeVisible()
  })
})

test.describe('the leads list', () => {
  test('lists every open lead, soonest follow up first, with an estimate chip', async ({ context, page }) => {
    await signIn(context, {
      tables: {
        fh_leads: [
          lead({ id: 'l-a', title: 'Patio tear out', follow_up_on: null, created_at: '2026-10-01T12:00:00.000Z' }),
          lead({ id: 'l-b', title: 'Garage slab', follow_up_on: '2026-10-12', created_at: '2026-09-01T12:00:00.000Z' }),
          lead({ id: 'l-c', title: 'Sidewalk repair', follow_up_on: '2026-10-09', created_at: '2026-09-15T12:00:00.000Z' }),
          lead({ id: 'l-gone', title: 'Lost footing', status: 'lost' })
        ],
        fh_schedule: [
          { id: 's-est', user_id: USER, lead_id: 'l-b', contact_id: null, title: 'Estimate', description: null, start_at: '2026-10-10T14:00:00.000Z', end_at: '2026-10-10T15:00:00.000Z', created_at: NOW }
        ]
      }
    })
    await page.clock.setFixedTime(new Date(NOW))
    await open(page, '/leads')
    await expect(page.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible({ timeout: 30_000 })
    const rows = page.getByRole('list', { name: 'Leads' }).getByRole('listitem')
    await expect(rows).toHaveCount(3)
    await expect(rows.nth(0)).toContainText('Sidewalk repair')
    await expect(rows.nth(1)).toContainText('Garage slab')
    await expect(rows.nth(1)).toContainText('Estimate booked')
    await expect(rows.nth(2)).toContainText('Patio tear out')
    await expect(page.getByText('Lost footing')).toHaveCount(0)
    await rows.nth(0).getByRole('link').click()
    await expect(page).toHaveURL(/\/leads\/l-c$/)
  })

  test('the Jobs screen tabs read the new tables', async ({ context, page, isMobile }) => {
    test.skip(!isMobile, 'The tabs are the phone Jobs list')
    await signIn(context)
    await open(page, '/work?stage=leads')
    await expect(page.getByRole('tab', { name: /^Leads\b/ })).toHaveAttribute('aria-selected', 'true', { timeout: 30_000 })
    await expect(page.getByRole('link', { name: /Vintage Burkitt Station Drainage/ })).toHaveAttribute('href', '/leads/l-lead1')
    await expect(page.getByRole('link', { name: /Retaining wall \+ pad/ })).toHaveAttribute('href', '/leads/l-lead2')
    await page.getByRole('tab', { name: /^Quotes\b/ }).click()
    await expect(page.getByRole('link', { name: /Parking lot repour/ })).toHaveAttribute('href', '/quotes/q-quote')
    await expect(page.getByRole('link', { name: /Kitchen renovation/ })).toHaveAttribute('href', '/quotes/q-change')
  })
})
