// Screenshot guard for the dead CSS cleanup (redesign Phase 7, Task 7.2).
//
// It runs only with FH_VISUAL=1, so `npm run test:all` and CI never run it.
// The mock and the page clock must read the same morning, so set QA_NOW too:
//
//   QA_NOW=2026-10-08T14:00:00.000Z FH_VISUAL=1 npx playwright test cleanup-guard --update-snapshots
//   QA_NOW=2026-10-08T14:00:00.000Z FH_VISUAL=1 npx playwright test cleanup-guard
//
// The first line writes the baselines to tests/e2e/cleanup-guard.spec.ts-snapshots.
// The second compares against them, and any changed pixel fails the test.
// Phone screens are shot in Day and Night, desktop screens in Day. The page
// clock, the weather and animations are fixed, and the schedule's now line is
// masked.
import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn'

const VISUAL = process.env.FH_VISUAL === '1'
const QA_NOW = process.env.QA_NOW || ''

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

const slug = (route: string) => (route === '/' ? 'today' : route.slice(1).replaceAll('/', '-'))

test.describe('cleanup guard', () => {
  test.skip(!VISUAL, 'Visual guard, run with FH_VISUAL=1 and QA_NOW')

  for (const mode of ['day', 'night'] as const) {
    for (const route of ROUTES) {
      test(`${route} in ${mode}`, async ({ context, page }, testInfo) => {
        test.skip(mode === 'night' && !testInfo.project.name.startsWith('mobile'), 'Night is shot on the phone only')
        expect(QA_NOW, 'Set QA_NOW to the same instant as the baselines, for example 2026-10-08T14:00:00.000Z').toBeTruthy()
        const now = new Date(QA_NOW)

        await signIn(context, { mode })
        await context.route('https://api.open-meteo.com/**', (r) =>
          r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecast(now)) }))
        await page.clock.setFixedTime(now)
        await page.emulateMedia({ reducedMotion: 'reduce' })
        await page.goto(route, { waitUntil: 'domcontentloaded', timeout: 60_000 })
        await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
        await page.waitForLoadState('load')
        await page.evaluate(() => document.fonts.ready)
        await page.waitForTimeout(1500)

        await expect(page).toHaveScreenshot(`${slug(route)}-${mode}.png`, {
          animations: 'disabled',
          fullPage: true,
          maxDiffPixels: 0,
          mask: [page.locator('.fhsch-now')]
        })
      })
    }
  }
})
