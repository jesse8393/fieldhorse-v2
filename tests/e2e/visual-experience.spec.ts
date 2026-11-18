import { expect, test, type Locator } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const titles = ['Give every job a home.', 'Build a day that works.', 'Keep everyone in context.', 'Put clear scope in writing.', 'Make every payment clear.']

for (const mode of ['day', 'night']) {
  test(`public pages fit a narrow phone in ${mode}`, async ({ context, page }) => {
    await context.addInitScript(value => localStorage.setItem('fh:theme-mode', value), mode)
    await page.setViewportSize({ width: 320, height: 740 })
    for (const route of ['/', '/learn?guide=day']) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
      for (const img of await page.locator('img').all()) {
        await img.scrollIntoViewIfNeeded()
        await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
      }
    }
  })
}

test('film waits for deliberate play even with reduced motion and retains keyboard focus', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const requests: string[] = []
  page.on('request', request => { if (request.url().endsWith('.mp4')) requests.push(request.url()) })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Play welcome film 0:08' })).toBeVisible()
  await expect(page.locator('video')).toHaveCount(0)
  expect(requests).toEqual([])
  await page.getByRole('button', { name: 'Play welcome film 0:08' }).focus()
  await page.keyboard.press('Enter')
  const video = page.locator('video')
  await expect(video).toBeFocused()
  await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0)
  expect(requests.length).toBeGreaterThan(0)
})

test('failed film keeps a useful still and retries without trapping the user', async ({ page }) => {
  await page.route('**/fieldhorse-welcome.mp4', route => route.abort())
  await page.goto('/')
  await page.getByRole('button', { name: 'Play welcome film 0:08' }).click()
  const retry = page.getByRole('button', { name: 'Retry welcome film 0:08' })
  await expect(retry).toBeFocused()
  await expect(page.getByRole('status')).toHaveText('Video unavailable. You can keep exploring.')
  await expect(page.getByRole('img', { name: /Two builders/ })).toBeVisible()
  await page.unroute('**/fieldhorse-welcome.mp4')
  await retry.click()
  await expect.poll(() => page.locator('video').evaluate(el => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0)
})

test('guides play captioned recordings and switching stops the previous guide', async ({ page }) => {
  await page.goto('/learn?guide=job')
  await expect(page.locator('video')).toHaveCount(0)
  for (const [index, id] of ['job', 'day', 'update', 'quote', 'billing'].entries()) {
    if (index) await page.getByRole('navigation', { name: 'Quick guides' }).getByRole('button', { name: new RegExp(titles[index]) }).click()
    await expect(page).toHaveURL(new RegExp(`guide=${id}$`))
    await expect(page.locator('video')).toHaveCount(0)
    if (index) await expect(page.getByRole('heading', { level: 2, name: titles[index] })).toBeFocused()
    await page.getByRole('button', { name: `Play ${titles[index]}`, exact: true }).click()
    const video = page.locator('video')
    await expect(video).toHaveCount(1)
    await expect(video).toBeFocused()
    await expect.poll(() => video.evaluate(el => (el as HTMLVideoElement).currentTime)).toBeGreaterThan(0)
    await expect.poll(() => video.locator('track').evaluate(el => (el as HTMLTrackElement).track.cues?.length ?? 0)).toBeGreaterThan(0)
    await expect(page.locator('.fh-guide-steps li')).toHaveCount(3)
  }
})

test('unavailable guide retains written steps and switching clears its failure', async ({ page }) => {
  await page.route('**/guide-job.mp4', route => route.abort())
  await page.goto('/learn?guide=job')
  await page.getByRole('button', { name: `Play ${titles[0]}`, exact: true }).click()
  await expect(page.getByRole('button', { name: `Retry ${titles[0]}`, exact: true })).toBeFocused()
  await expect(page.locator('.fh-guide-steps li')).toHaveCount(3)
  await page.getByRole('navigation', { name: 'Quick guides' }).getByRole('button', { name: /Build a day/ }).click()
  await expect(page.getByRole('status')).toHaveCount(0)
  await expect(page.getByRole('button', { name: `Play ${titles[1]}`, exact: true })).toBeVisible()
})

// Native checkboxes take the brand copper, never the browser's stock blue
// (vibe audit purple-1). The accent must equal --fh-gold as the page
// resolves it, in Day and in Night.
async function expectBrandAccent(box: Locator) {
  const [accent, gold] = await box.evaluate((el) => {
    const probe = document.createElement('span')
    probe.style.color = 'var(--fh-gold)'
    document.body.appendChild(probe)
    const resolved = getComputedStyle(probe).color
    probe.remove()
    return [getComputedStyle(el).accentColor, resolved]
  })
  expect(accent).not.toBe('auto')
  expect(accent).toBe(gold)
}

const CREW = [
  { id: 'm1', user_id: 'crew-alice', name: 'Alice Crew', role: 'crew' },
  { id: 'm2', user_id: 'crew-riley', name: 'Riley Foreman', role: 'foreman' }
]

for (const mode of ['day', 'night'] as const) {
  test(`the crew picker checkbox wears the brand copper in ${mode}`, async ({ context, page }) => {
    await signIn(context, { mode, role: 'manager', tables: { fh_schedule: [] } })
    await context.route('**/api/org-members-list', (route) => route.fulfill({ json: { ok: true, org_id: 'org-1', members: CREW, invites: [], caller_role: 'manager' } }))
    await page.goto('/schedule/new')
    await page.getByLabel('Title', { exact: true }).fill('Foundation pour')
    await page.getByLabel('Date', { exact: true }).fill('2026-10-28')
    await page.getByLabel('Time', { exact: true }).fill('08:00')
    const box = page.getByRole('checkbox', { name: /Alice Crew/ })
    await box.check()
    await expectBrandAccent(box)
  })
}

test('the import "Import them anyway" checkbox wears the brand copper', async ({ context, page }) => {
  await signIn(context)
  await context.route('**/rest/v1/fh_leads*', (route) => {
    if (route.request().method() !== 'GET' || !route.request().url().includes('fh_leads_client_id_fkey')) return route.fallback()
    return route.fulfill({ json: [{ id: 'l-lead1', title: 'Vintage Burkitt Station Drainage', fh_clients: { name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' } }] })
  })
  await page.goto('/import')
  const csv = 'Name,Phone,Email,Job title\nJeff Roy,555-0101,jeff@roy.com,Vintage Burkitt Station Drainage\nNew Person,555-0199,new@example.com,Patio\n'
  await page.locator('input[type="file"]').setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) })
  const box = page.getByRole('checkbox', { name: 'Import them anyway' })
  await expect(box).toBeVisible({ timeout: 15_000 })
  await box.check()
  await expectBrandAccent(box)
})

test('the invoice billing review checkbox wears the brand copper', async ({ context, page }) => {
  const day = 86_400_000
  const now = Date.now()
  const iso = (t: number) => new Date(t).toISOString()
  const client = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com', address: '412 Burkitt Station Rd' }
  const base = { user_id: 'qa-user-1', org_id: 'org-1', client_id: 'cl-1', contact_id: 'c-job2', amount: 6400, status: 'draft', issued_at: null, due_at: iso(now + 6 * day), description: null, notes: null, fh_clients: client }
  await signIn(context, { tables: { fh_invoices: [
    { ...base, id: 'invd1', title: 'Progress draw 2', sequence_number: 3, created_at: iso(now - 2 * day) },
    { ...base, id: 'invd2', title: 'Progress draw 2', sequence_number: 4, created_at: iso(now - day) }
  ] } })
  await page.goto('/invoices/invd2')
  const box = page.getByRole('checkbox', { name: /I reviewed these records/ })
  await expect(box).toBeVisible({ timeout: 15_000 })
  await box.check()
  await expectBrandAccent(box)
})

test('Today shortcuts open existing schedule and capture flows', async ({ context, page }) => {
  await signIn(context)
  await page.goto('/')
  const shortcuts = page.getByRole('region', { name: 'Daily shortcuts' })
  await expect(shortcuts).toBeVisible()
  await shortcuts.getByRole('link', { name: 'Add visit' }).click()
  await expect(page.getByRole('heading', { name: 'Add event', exact: true })).toBeVisible()
  await page.goto('/')
  await shortcuts.getByRole('button', { name: 'Capture update' }).click()
  await expect(page).toHaveURL(/\/capture/)
  await expect(page.getByRole('heading', { name: 'Capture', exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await shortcuts.getByRole('link', { name: 'Quick guides' }).click()
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Small steps.A confident start.')
})

test('phone contact actions stay visible with details closed and financial access stays gated', async ({ context, page }) => {
  await signIn(context, { role: 'crew' })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/jobs/c-job1')
  await expect(page.locator('.fh-job-contact-actions')).toBeVisible()
  await expect(page.locator('.fh-job-contact-disclosure')).not.toHaveAttribute('open', '')
  await expect(page.locator('.fh-job-contact-actions').getByRole('link', { name: 'Call Plumbing Bellevue', exact: true })).toBeVisible()
  await page.locator('.fh-job-contact-actions').getByRole('button', { name: 'Open photos', exact: true }).click()
  await expect(page.getByRole('region', { name: 'Photos workspace', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'Job section' }).getByRole('option', { name: 'Contract balance', exact: true })).toHaveCount(0)
  // Any form of the contract amount, $33,100 or $33,100.00, stays hidden.
  await expect(page.getByText(/\$33,100/)).toHaveCount(0)
})
