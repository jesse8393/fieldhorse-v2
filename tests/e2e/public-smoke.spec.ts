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

  // ai-copy-1: the legal pages say what each provider and each kind of
  // data is, instead of a comma splice that reads as a list.
  test('the privacy policy and terms read as sentences', async ({ page }) => {
    await page.goto('/privacy')
    await expect(page.getByRole('heading', { level: 1, name: 'Privacy policy', exact: true })).toBeVisible()
    await expect(page.getByText('Supabase: database, authentication, and file storage hosting.')).toBeVisible()
    expect(await page.locator('body').innerText()).not.toMatch(/Supabase, database|Usage data, basic logs/)

    await page.goto('/terms')
    await expect(page.getByRole('heading', { level: 1, name: 'Terms of service', exact: true })).toBeVisible()
    expect((await page.locator('body').innerText()).replace(/\s+/g, ' ')).toContain('into the Service (your jobs, clients, documents, and photos)')
  })

  // PT-11: a shared link's preview must not point at a dead host.
  test('the share tags name no dead host and no fixed page address', async ({ request }) => {
    const html = await (await request.get('/p/abc')).text()
    expect(html).not.toContain('og:url')
    expect(html).not.toContain('https://fieldhorse.io/')
    expect(html).toMatch(/<meta property="og:image" content="\/icon-512\.png"/)
  })
})

