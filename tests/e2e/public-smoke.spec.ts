import { expect, test } from '@playwright/test'

test.describe('public app shell', () => {
  test('loads the public login screen with usable controls', async ({ page }) => {
    await page.goto('/login')

    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('heading', { level: 1, name: 'Sign in' })).toBeVisible()
    await expect(page.getByLabel('Email')).toBeEnabled()
    await expect(page.getByLabel('Password')).toBeEnabled()
    await expect(page.getByRole('button', { name: /sign in|add supabase env/i })).toBeVisible()
    await expect(page.getByRole('button', { name: /create a workspace/i })).toBeEnabled()
  })

  test('keeps the auth form responsive on mobile', async ({ page }) => {
    await page.goto('/login')

    const formBox = await page.locator('form').boundingBox()
    expect(formBox).not.toBeNull()
    expect(formBox!.width).toBeLessThanOrEqual(430)
    await expect(page.getByLabel('Email')).toBeVisible()
    await expect(page.getByLabel('Password')).toBeVisible()
  })

  test('loads the public product page at the root without crashing', async ({ page }) => {
    await page.goto('/')

    await expect(page.getByRole('main')).toBeVisible()
    await expect(page.getByRole('heading', { name: /good work.*less busywork/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /create a free account/i })).toBeVisible()
    await expect(page.getByRole('link', { name: /sign in/i }).first()).toBeVisible()
  })

  // PT-11: a shared link's preview must not point at a dead host.
  test('the share tags name no dead host and no fixed page address', async ({ request }) => {
    const html = await (await request.get('/p/abc')).text()
    expect(html).not.toContain('og:url')
    expect(html).not.toContain('https://fieldhorse.io/')
    expect(html).toMatch(/<meta property="og:image" content="\/icon-512\.png"/)
  })
})

