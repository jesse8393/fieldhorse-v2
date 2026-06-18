import { expect, test } from '@playwright/test'

const email = process.env.E2E_USER_EMAIL || ''
const password = process.env.E2E_USER_PASSWORD || ''

test.describe('authenticated CRM workflows', () => {
  test.skip(!email || !password, 'Set E2E_USER_EMAIL and E2E_USER_PASSWORD to run authenticated CRM workflow smoke tests.')

  test('signs in and reaches the CRM workspace', async ({ page }) => {
    await page.goto('/login')

    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    await page.getByRole('button', { name: /sign in/i }).click()

    await expect(page).toHaveURL(/\/(onboarding)?$/)
    await expect(page.locator('body')).toContainText(/Fieldhorse|Jobs|Leads|Dashboard/i)
  })
})
