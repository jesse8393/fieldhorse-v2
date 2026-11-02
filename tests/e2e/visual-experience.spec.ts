import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const titles = ['Give every job a home.', 'Build a day that works.', 'Keep everyone in context.']

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
  for (const [index, id] of ['job', 'day', 'update'].entries()) {
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
  await expect(page.getByText('$33,100', { exact: true })).toHaveCount(0)
})
