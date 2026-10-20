// Screenshot guard for dead CSS cleanups (redesign Phase 7, Task 7.2,
// widened in Phase 8, Task 17).
//
// It runs only with FH_VISUAL=1, so `npm run test:all` and CI never run it.
// The mock and the page clock must read the same morning, so set QA_NOW too:
//
//   QA_NOW=2026-10-08T14:00:00.000Z FH_VISUAL=1 npx playwright test cleanup-guard --update-snapshots
//   QA_NOW=2026-10-08T14:00:00.000Z FH_VISUAL=1 npx playwright test cleanup-guard
//
// The first line writes the baselines to tests/e2e/cleanup-guard.spec.ts-snapshots.
// The second compares against them, and any changed pixel fails the test.
//
// What it shoots, each a full page:
//   * the signed in screens in ROUTES, the invoice page, the Inbox with the
//     messaging engine on, the forecast, the sign in page and the customer
//     page (its /api/public-link answered here, as tests/e2e/portal.spec.ts
//     does);
//   * on the phone in Day and Night, on the desktop (1280 by 720) in Day and
//     Night, and on a 1440 by 900 desktop in Day.
// And two open states, each the window only, in Day and Night on both: the
// search palette with "Plumb" typed (the phone's search sheet, the desktop
// command palette) and the Capture sheet.
//
// Nothing that changes between runs reaches a screenshot: the page clock is
// fixed at QA_NOW, the forecast and the place name for the company's spot
// are answered here instead of by the network, motion is reduced (so count
// ups show their number at once) and animations are off, and the schedule's
// now line is masked.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { installMock } from '../../scripts/qa-mock.mjs'
import { signIn, type SignInOptions } from './helpers/signIn'

const VISUAL = process.env.FH_VISUAL === '1'
const QA_NOW = process.env.QA_NOW || ''

type Mode = 'day' | 'night'

// The screens the guard first shot (Phase 7). Their baseline names are
// unchanged.
const ROUTES = ['/', '/work', '/jobs/c-job1', '/invoices', '/schedule', '/clients', '/settings', '/analytics', '/notes', '/crew']

// A calm October forecast, so the weather chip never depends on the network.
function forecast(start: Date) {
  const hours = Array.from({ length: 7 * 24 }, (_, i) => new Date(start.getTime() + i * 3600e3).toISOString().slice(0, 13) + ':00')
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86400e3).toISOString().slice(0, 10))
  return {
    latitude: 35.84,
    longitude: -86.36,
    current: { time: hours[0], temperature_2m: 71, relative_humidity_2m: 52, precipitation: 0, wind_speed_10m: 6, weather_code: 2, is_day: 1 },
    hourly: {
      time: hours,
      temperature_2m: hours.map(() => 71),
      precipitation_probability: hours.map(() => 5),
      precipitation: hours.map(() => 0),
      wind_speed_10m: hours.map(() => 6),
      relative_humidity_2m: hours.map(() => 52),
      weather_code: hours.map(() => 2)
    },
    daily: {
      time: days,
      temperature_2m_max: days.map(() => 74),
      temperature_2m_min: days.map(() => 52),
      precipitation_probability_max: days.map(() => 5),
      precipitation_sum: days.map(() => 0),
      wind_speed_10m_max: days.map(() => 9)
    }
  }
}

// What api.bigdatacloud.net says for the mock company's spot (35.84,
// -86.36). Settings and the forecast print it as "Murfreesboro, TN".
const PLACE = { city: 'Murfreesboro', locality: 'Murfreesboro', principalSubdivision: 'Tennessee', principalSubdivisionCode: 'US-TN' }

// The Inbox with four conversations, timed from QA_NOW: one with a draft
// waiting, one by email, one with a held reply and an old one.
function inboxRows(now: Date) {
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const row = (partial: Record<string, unknown>) => ({
    org_id: 'org-1', company_name: null, last_channel: 'sms', unread_count: 0, pending_drafts: 0, held_messages: 0,
    starred: false, status: 'open', snoozed_until: null, email: null, phone: '555-0142', ...partial
  })
  return [
    row({
      conversation_id: 'conv-priya', client_id: 'cl-priya', client_name: 'Priya Rangarajan',
      last_preview: 'Can we push to 11:30? Daycare pickup ran long.', last_message_at: ago(46 * 60e3),
      unread_count: 1, pending_drafts: 1, latest_stage: 'quote'
    }),
    row({
      conversation_id: 'conv-marcus', client_id: 'cl-marcus', client_name: 'Marcus Bell',
      last_preview: 'Thanks, the crew did great work.', last_message_at: ago(17 * 3600e3),
      latest_stage: 'job', last_channel: 'email', email: 'marcus@example.com'
    }),
    row({
      conversation_id: 'conv-tessa', client_id: 'cl-tessa', client_name: 'Tessa Holloway',
      last_preview: 'We can start Monday if the weather holds.', last_message_at: ago(3 * 86400e3),
      held_messages: 1, latest_stage: 'lead'
    }),
    row({
      conversation_id: 'conv-gus', client_id: 'cl-gus', client_name: 'Gus Okafor',
      last_preview: 'Still thinking about the retaining wall.', last_message_at: ago(18 * 86400e3),
      latest_stage: 'closed'
    })
  ]
}

// The customer page's quote, the one tests/e2e/portal.spec.ts opens: the
// Fieldhorse theme, no photos, four priced lines, an optional line and an
// excluded one.
const PROPOSAL = {
  ok: true,
  kind: 'proposal',
  contact: {
    id: 'c-portal', name: 'Marco Castellanos', address: '1150 Cherry Blossom Ln, La Vergne', phone: '615 555 0101',
    email: 'marco@example.com', job_title: 'Pool deck pour', stage: 'quote', proposal_status: 'sent', amount: 18458,
    created_at: '2026-10-01T12:00:00.000Z', quote_sent_at: '2026-10-02T12:00:00.000Z', terms_text: ''
  },
  company: {
    name: 'Parker Construction', phone: '615 555 0100', email: 'office@parker.co', insured_text: 'Licensed and insured',
    license_number: '', logo_url: null, estimate_template: 'fieldhorse', payment_link: ''
  },
  items: [
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
  photos: []
}

type Shot = {
  route: string
  /** The baseline name before the mode, the project and the platform. */
  name: string
  /** Signed in (the default), signed out on the sign in page, or the customer page. */
  as?: 'user' | 'signed-out' | 'customer'
  tables?: (now: Date) => SignInOptions['tables']
  ready: (page: Page) => Promise<void>
}

async function appReady(page: Page) {
  await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
}

const SHOTS: Shot[] = [
  ...ROUTES.map((route) => ({ route, name: route === '/' ? 'today' : route.slice(1).replaceAll('/', '-'), ready: appReady })),
  {
    route: '/invoices/inv1',
    name: 'invoice-inv1',
    ready: async (page) => {
      await appReady(page)
      await expect(page.locator('.fhinv-hero')).toBeVisible({ timeout: 30_000 })
    }
  },
  {
    route: '/inbox',
    name: 'inbox',
    tables: (now) => ({ fh_org_settings: [{ engine_enabled: true }], fh_v_inbox: inboxRows(now) }),
    ready: async (page) => {
      await appReady(page)
      await expect(page.locator('.fhi-rows > li')).toHaveCount(4, { timeout: 30_000 })
    }
  },
  {
    route: '/pour-window',
    name: 'pour-window',
    ready: async (page) => {
      await appReady(page)
      await expect(page.getByText('Murfreesboro, TN').first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByText('Loading forecast')).toHaveCount(0)
    }
  },
  {
    route: '/login',
    name: 'login',
    as: 'signed-out',
    ready: async (page) => {
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible({ timeout: 30_000 })
      // The wordmark waits, clear, for Bebas Neue (decision D42).
      await expect(page.locator('.fha-wordmark')).toBeVisible()
      await expect(page.locator('.fha-wordmark--waiting')).toHaveCount(0)
    }
  },
  {
    route: '/p/t1',
    name: 'customer-page',
    as: 'customer',
    ready: async (page) => {
      await expect(page.getByRole('heading', { level: 1, name: 'Hi Marco, your quote is ready.' })).toBeVisible({ timeout: 30_000 })
    }
  }
]

// Phone (Pixel 7) and desktop (1280 by 720) in Day and Night, and a 1440 by
// 900 desktop in Day.
const VARIANTS: Array<{ mode: Mode; width?: number }> = [{ mode: 'day' }, { mode: 'night' }, { mode: 'day', width: 1440 }]

const isPhone = (projectName: string) => projectName.startsWith('mobile')

function theNow() {
  expect(QA_NOW, 'Set QA_NOW to the same instant as the baselines, for example 2026-10-08T14:00:00.000Z').toBeTruthy()
  return new Date(QA_NOW)
}

// Answers everything a screen asks the outside world for: the forecast and
// the place name.
async function fixTheWorld(context: BrowserContext, now: Date) {
  await context.route('https://api.open-meteo.com/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecast(now)) }))
  await context.route('https://api.bigdatacloud.net/**', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PLACE) }))
}

async function setUp(context: BrowserContext, page: Page, shot: Pick<Shot, 'as' | 'tables'>, mode: Mode, now: Date) {
  const as = shot.as ?? 'user'
  if (as === 'user') {
    await signIn(context, { mode, tables: shot.tables?.(now) })
  } else {
    if (as === 'signed-out') {
      // The mock answers any Supabase call; no session is saved, so the
      // app is signed out. No photo, so the stage is onyx with grain.
      await installMock(context, { supabaseHosts: ['qa-mock.supabase.co', 'pnmhblvslftdzfcdezbw.supabase.co'] })
      await context.route('**/welcome.jpg', (r) => r.fulfill({ status: 404, contentType: 'text/plain', body: 'Not found' }))
    } else {
      await context.route(/supabase\.co/, (r) => r.abort())
      await context.route(
        (url) => url.pathname === '/api/public-link' && url.searchParams.get('token') === 't1',
        (r) => r.fulfill({ status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(PROPOSAL) })
      )
    }
    await context.addInitScript((themeMode) => {
      localStorage.setItem('fh:theme-mode', themeMode)
      localStorage.setItem('fh-onboarding-seen', '1')
    }, mode)
  }
  await fixTheWorld(context, now)
  await page.clock.setFixedTime(now)
  await page.emulateMedia({ reducedMotion: 'reduce' })
}

async function settle(page: Page) {
  await page.waitForLoadState('load')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1500)
}

test.describe('cleanup guard', () => {
  test.skip(!VISUAL, 'Visual guard, run with FH_VISUAL=1 and QA_NOW')

  for (const shot of SHOTS) {
    for (const { mode, width } of VARIANTS) {
      const title = width ? `${shot.route} in ${mode} at ${width} px` : `${shot.route} in ${mode}`
      test(title, async ({ context, page }, testInfo) => {
        test.skip(Boolean(width) && isPhone(testInfo.project.name), 'The 1440 px desktop is shot on the desktop only')
        const now = theNow()
        if (width) await page.setViewportSize({ width, height: 900 })
        await setUp(context, page, shot, mode, now)
        await page.goto(shot.route, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await shot.ready(page)
        await settle(page)

        await expect(page).toHaveScreenshot(`${shot.name}-${mode}${width ? `-${width}` : ''}.png`, {
          animations: 'disabled',
          fullPage: true,
          maxDiffPixels: 0,
          mask: [page.locator('.fhsch-now')]
        })
      })
    }
  }

  for (const mode of ['day', 'night'] as const) {
    test(`the search palette open over Today in ${mode}`, async ({ context, page }, testInfo) => {
      const now = theNow()
      await setUp(context, page, {}, mode, now)
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await appReady(page)
      await settle(page)

      if (isPhone(testInfo.project.name)) {
        await page.getByRole('button', { name: 'Search everything' }).click()
        // Search is a screen below 900 px (D57).
        await expect(page).toHaveURL(/\/search$/)
        await page.getByRole('searchbox').fill('Plumb')
        await expect(page.getByText('Plumbing Bellevue').first()).toBeVisible()
      } else {
        await page.keyboard.press('Control+k')
        const palette = page.getByRole('dialog', { name: 'Command palette' })
        await expect(palette).toBeVisible()
        await palette.getByRole('combobox').fill('Plumb')
        await expect(palette.getByRole('group', { name: 'Jobs' })).toBeVisible()
        await expect(palette.getByRole('group', { name: 'Actions' })).toBeVisible()
      }
      await page.waitForTimeout(800)

      await expect(page).toHaveScreenshot(`palette-${mode}.png`, { animations: 'disabled', maxDiffPixels: 0 })
    })

    test(`the Capture sheet open over Today in ${mode}`, async ({ context, page }, testInfo) => {
      const now = theNow()
      await setUp(context, page, {}, mode, now)
      await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await appReady(page)
      await settle(page)

      if (isPhone(testInfo.project.name)) {
        await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: /Capture/ }).click()
      } else {
        // The sidebar's Capture row (decision D33).
        await page.getByRole('button', { name: /^Capture \(/ }).click()
      }
      // Capture is a screen (D57).
      await expect(page).toHaveURL(/\/capture$/)
      await expect(page.getByRole('heading', { level: 1, name: 'Capture' })).toBeVisible()
      await expect(page.getByRole('list', { name: 'Or start with' })).toBeVisible()
      await page.waitForTimeout(800)

      await expect(page).toHaveScreenshot(`capture-sheet-${mode}.png`, { animations: 'disabled', maxDiffPixels: 0 })
    })
  }
})
