import { expect, test } from '@playwright/test'

test.describe('public app shell', () => {
  test('loads the public login screen with usable controls', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('heading', { name: /welcome back|built for builders/i })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeEnabled()
    await expect(page.getByLabel('Password')).toBeEnabled()
    await expect(page.getByRole('button', { name: /sign in|add supabase env/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /create an account/i })).toBeEnabled()
  })

  test('keeps the auth form responsive on mobile', async ({ page }) => {
    await page.goto('/login')

    const formBox = await page.locator('form').boundingBox()
    expect(formBox).not.toBeNull()
    expect(formBox!.width).toBeLessThanOrEqual(430)
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
  })

  test('redirects protected root traffic to auth without crashing', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('heading', { name: /welcome back|built for builders/i })).toBeVisible()
  })
})
