import { expect, test } from '@playwright/test'
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
  await expect(page.getByText('Clear to work', { exact: true })).toHaveCount(0)

  failForecast = false
  await page.getByRole('button', { name: 'Try again' }).click()
  await expect(failure).toHaveCount(0, { timeout: 15_000 })
  await expect(page.getByText('Clear to work', { exact: true }).first()).toBeVisible()
})
