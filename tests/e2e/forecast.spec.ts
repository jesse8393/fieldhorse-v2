import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { installMock, session } from '../../scripts/qa-mock.mjs'

// A jobsite with no signal must not see "clear to work" when the forecast
// never loaded. The screen says the forecast is unavailable, offers a
// retry, and recovers once the request succeeds.
test('shows an honest forecast failure state and recovers on retry', async ({ context, page }) => {
  await installMock(context)
  await context.addInitScript((savedSession) => {
    localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(savedSession))
    localStorage.setItem('fh:theme-mode', 'night')
    localStorage.setItem('fh-onboarding-seen', '1')
  }, session)

  let failForecast = true
  await context.route('https://api.open-meteo.com/**', (route) => {
    if (failForecast) return route.fulfill({ status: 503, body: 'unavailable' })
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        current: { time: '2026-10-09T12:00', temperature_2m: 61, wind_speed_10m: 4, relative_humidity_2m: 50, precipitation: 0, weather_code: 1 },
        hourly: { time: [], temperature_2m: [], precipitation_probability: [], precipitation: [], wind_speed_10m: [], relative_humidity_2m: [], weather_code: [] },
        daily: { time: ['2026-10-09'], temperature_2m_max: [70], temperature_2m_min: [50], precipitation_probability_max: [5], precipitation_sum: [0], wind_speed_10m_max: [8] }
      })
    })
  })

  await page.goto('/pour-window', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const failure = page.getByText("Couldn't load the forecast", { exact: false })
  await expect(failure).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText('Forecast unavailable', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Within configured weather limits', { exact: true })).toHaveCount(0)

  failForecast = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(failure).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByText('Within configured weather limits', { exact: true }).first()).toBeVisible()
})

// The location lives on each person's own profile. Someone who has not
// pinned one has no spot to forecast. The screen used to fall back to
// Murfreesboro and show that town's weather and work calls as if they
// were theirs. It now asks them to pin their location, right here, and
// asks the weather service nothing until they do.
const NO_LOCATION_PROFILE = { user_id: 'qa-user-1', company_name: 'Fresh Concrete Co', onboarded_at: '2026-11-01T00:00:00Z', location_lat: null, location_lon: null, services: ['Concrete'], preferences: {} }

const CLEAR_DAY = {
  current: { time: '2026-10-09T12:00', temperature_2m: 61, wind_speed_10m: 4, relative_humidity_2m: 50, precipitation: 0, weather_code: 1 },
  hourly: { time: [], temperature_2m: [], precipitation_probability: [], precipitation: [], wind_speed_10m: [], relative_humidity_2m: [], weather_code: [] },
  daily: { time: ['2026-10-09'], temperature_2m_max: [70], temperature_2m_min: [50], precipitation_probability_max: [5], precipitation_sum: [0], wind_speed_10m_max: [8] }
}

async function openWithNoLocation(context: BrowserContext, page: Page, { role, geolocation }: { role?: string; geolocation?: 'allow' | 'deny' } = {}) {
  await installMock(context, {
    supabaseHosts: ['qa-mock.supabase.co', 'pnmhblvslftdzfcdezbw.supabase.co'],
    tables: { profiles: [NO_LOCATION_PROFILE] },
    role
  })
  await context.addInitScript((savedSession) => {
    localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(savedSession))
    localStorage.setItem('fh-onboarding-seen', '1')
  }, session)
  if (geolocation) {
    await context.addInitScript((answer) => {
      const getCurrentPosition = (ok: (p: unknown) => void, fail: (e: unknown) => void) => setTimeout(() => {
        if (answer === 'allow') ok({ coords: { latitude: 35.85, longitude: -86.39 } })
        else fail({ code: 1, message: 'denied' })
      }, 20)
      Object.defineProperty(navigator, 'geolocation', { value: { getCurrentPosition }, configurable: true })
    }, geolocation)
  }
  const asked: string[] = []
  await context.route('https://api.open-meteo.com/**', (route) => {
    asked.push(route.request().url())
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CLEAR_DAY) })
  })
  await context.route('https://api.bigdatacloud.net/**', (route) => {
    asked.push(route.request().url())
    return route.fulfill({ status: 503, body: 'unavailable' })
  })
  await page.goto('/pour-window', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  const main = page.locator('#fh-main')
  const ask = main.locator('.fhc-empty')
  await expect(ask.getByText('Pin your location to see the forecast.', { exact: true })).toBeVisible({ timeout: 15_000 })
  return { main, ask, asked }
}

test('with no location, Forecast asks for one instead of showing another town', async ({ context, page }) => {
  const { main, ask, asked } = await openWithNoLocation(context, page)
  await expect(main).not.toContainText('Murfreesboro')
  await expect(main).not.toContainText('Forecast unavailable')
  await expect(ask.getByRole('button', { name: 'Pin location', exact: true })).toBeVisible()
  expect(asked).toEqual([])
  await ask.getByRole('link', { name: 'Set location', exact: true }).click()
  await expect(page).toHaveURL(/\/settings#location$/)
  await expect(page.locator('#location').getByRole('button', { name: 'Pin location', exact: true })).toBeVisible()
})

test('a crew member with no location of their own can pin one and see the forecast', async ({ context, page }) => {
  const { main, ask } = await openWithNoLocation(context, page, { role: 'crew', geolocation: 'allow' })
  await expect(main).not.toContainText('no location set yet')
  await expect(ask.getByRole('link', { name: 'Set location' })).toHaveCount(0)
  // The mock does not merge an upsert into the stored row, so the pin's
  // write and the reads after it are answered here.
  let pinned: Record<string, unknown> | null = null
  await context.route('**/rest/v1/profiles**', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      pinned = { ...NO_LOCATION_PROFILE, org_id: 'org-1', ...request.postDataJSON() }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pinned) })
    }
    if (request.method() === 'GET' && pinned) {
      const wantsObject = (request.headers().accept || '').includes('vnd.pgrst.object')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(wantsObject ? pinned : [pinned]) })
    }
    return route.fallback()
  })
  await ask.getByRole('button', { name: 'Pin location', exact: true }).click()
  await expect(main.locator('.fhc-empty')).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByText('Within configured weather limits', { exact: true }).first()).toBeVisible({ timeout: 15_000 })
})
