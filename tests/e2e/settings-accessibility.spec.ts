import { expect, test, type BrowserContext, type Locator } from '@playwright/test'
import { signIn } from './helpers/signIn'

const trades = ['Concrete', 'Framing', 'Drywall', 'Demo', 'Roofing', 'Electrical', 'Plumbing rough', 'Insulation', 'LVP flooring', 'Paint', 'Permits', 'Outdoor living']

async function readableAction(button: Locator) {
  const measured = await button.evaluate(element => {
    const style = getComputedStyle(element)
    const rgb = (value: string) => (value.match(/[\d.]+/g) || []).map(Number)
    const luminance = (channels: number[]) => channels.slice(0, 3).map(value => {
      const s = value / 255
      return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
    }).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0)
    const foreground = rgb(style.color), background = rgb(style.backgroundColor)
    const a = luminance(foreground), b = luminance(background)
    return { ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05), alpha: background[3] ?? 1, opacity: style.opacity }
  })
  expect(measured.alpha).toBe(1)
  expect(measured.opacity).toBe('1')
  expect(measured.ratio).toBeGreaterThanOrEqual(4.5)
}

for (const mode of ['day', 'night'] as const) {
  test(`settings actions remain readable before and after editing in ${mode} mode`, async ({ page, context, isMobile }) => {
    await signIn(context, { mode })
    await page.goto('/settings')
    const upload = page.getByRole('button', { name: 'Upload logo', exact: true })
    await expect(upload).toBeVisible()
    await readableAction(upload)
    const save = page.getByRole('button', { name: 'Save changes', exact: true })
    if (!isMobile) {
      await expect(save).toBeDisabled()
      await readableAction(save)
    }
    await page.getByRole('textbox', { name: 'Company name', exact: true }).fill('Readable actions fixture')
    await expect(save).toBeEnabled()
    await readableAction(save)
  })
}

// The shared QA mock deliberately acknowledges REST writes without storing them.
// These two round-trip tests need an isolated, stateful response for only the
// settings tables. Persist the submitted payload itself and record it for checks.
async function signInWithPersistedSettings(context: BrowserContext) {
  type Row = Record<string, unknown>
  let profile: Row = {
    user_id: 'qa-user-1', full_name: 'Jesse Parker', company_name: 'Parker Construction Company',
    onboarded_at: '2026-01-01T00:00:00Z', logo_url: null, services: ['Concrete'],
    company_email: 'office@parker.co', location_lat: 35.84, location_lon: -86.36,
    preferences: { quote_follow_up: { enabled: true, days: 3 } },
  }
  const rates = new Map<string, Row>()
  const profileWrites: Row[] = []
  const rateWrites: Row[] = []
  await signIn(context, { tables: { profiles: [profile] } })
  await context.route('**/rest/v1/profiles?*', async (route) => {
    const request = route.request()
    if (request.method() === 'POST' || request.method() === 'PATCH') {
      const payload = request.postDataJSON() as Row
      profileWrites.push(payload)
      profile = { ...profile, ...payload }
    } else if (request.method() !== 'GET') {
      return route.fallback()
    }
    const singleton = request.headers().accept?.includes('vnd.pgrst.object')
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(singleton ? profile : [profile]) })
  })
  await context.route('**/rest/v1/fh_rate_cards?*', async (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      const payload = request.postDataJSON() as Row
      rateWrites.push(payload)
      rates.set(`${payload.user_id}:${payload.trade_key}`, payload)
    } else if (request.method() !== 'GET') {
      return route.fallback()
    }
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([...rates.values()]) })
  })
  return { profileWrites, rateWrites, changeStoredPreferences: (preferences: Row) => { profile = { ...profile, preferences } } }
}

test('each trade has a named group, persistent field labels and its own save action', async ({ page, context }) => {
  const { rateWrites } = await signInWithPersistedSettings(context)
  await page.goto('/settings#rates')
  const rates = page.getByRole('region', { name: 'Your rates.' })
  await expect(rates.getByRole('group')).toHaveCount(12)
  await expect(rates.getByRole('combobox')).toHaveCount(12)
  await expect(rates.getByRole('spinbutton')).toHaveCount(24)
  for (const trade of trades) {
    const group = rates.getByRole('group', { name: `${trade} rates`, exact: true })
    await expect(group.getByRole('combobox', { name: `${trade} unit`, exact: true })).toBeVisible()
    await expect(group.getByRole('spinbutton', { name: `${trade} low price ($)`, exact: true })).toBeVisible()
    await expect(group.getByRole('spinbutton', { name: `${trade} high price ($)`, exact: true })).toBeVisible()
  }
  const concrete = rates.getByRole('group', { name: 'Concrete rates', exact: true })
  await concrete.getByRole('spinbutton', { name: 'Concrete low price ($)', exact: true }).fill('9')
  const save = concrete.getByRole('button', { name: 'Save Concrete rate', exact: true })
  await expect(save).toBeEnabled()
  const bounds = await save.boundingBox()
  expect(bounds?.width).toBeGreaterThanOrEqual(44)
  expect(bounds?.height).toBeGreaterThanOrEqual(44)
  await save.click()
  await expect.poll(() => rateWrites).toEqual([expect.objectContaining({ user_id: 'qa-user-1', trade_key: 'concrete', unit: 'sqft', rate_low: 9, rate_high: 12 })])
  await expect(concrete.getByRole('spinbutton', { name: 'Concrete low price ($)', exact: true })).toHaveValue('9')
  await expect(concrete.getByRole('button', { name: 'Save Concrete rate', exact: true })).toHaveCount(0)
  await expect(concrete.getByRole('button', { name: 'Reset Concrete to default', exact: true })).toBeVisible()
})

test('settings sections retain drafts and save only their own fields', async ({ page, context }) => {
  const { profileWrites } = await signInWithPersistedSettings(context)
  await page.goto('/settings')
  await expect(page.getByRole('main')).toHaveCount(1)
  const nav = page.getByRole('navigation', { name: 'Settings sections' })
  const company = page.getByRole('textbox', { name: 'Company name', exact: true })
  await expect(company).toHaveValue('Parker Construction Company')
  await company.fill('Updated company')
  await nav.getByRole('link', { name: 'Documents', exact: true }).click()
  await expect(page).toHaveURL(/section=documents/)
  await expect(page.locator('#documents')).toBeFocused()
  await expect(company).toBeHidden()
  const phone = page.getByRole('textbox', { name: 'Company phone', exact: false })
  await phone.fill('6155550100')
  await nav.getByRole('link', { name: 'Rates', exact: true }).click()
  await expect(page.locator('#rates')).toBeFocused()
  await expect(page.getByText('Drafts kept in Business, Documents.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toHaveCount(0)
  await nav.getByRole('link', { name: /^Business/ }).click()
  await expect(company).toHaveValue('Updated company')
  const save = page.getByRole('button', { name: 'Save changes', exact: true })
  await expect(save).toBeInViewport()
  await expect(save).toBeEnabled()
  await save.click()
  await expect.poll(() => profileWrites).toEqual([{ user_id: 'qa-user-1', full_name: 'Jesse Parker', company_name: 'Updated company', services: ['Concrete'] }])
  await expect(page.getByRole('status').filter({ hasText: 'Your changes are saved' })).toBeVisible()
  await nav.getByRole('link', { name: /^Documents/ }).click()
  await expect(phone).toHaveValue('6155550100')
  await expect(save).toBeEnabled()
  await save.click()
  await expect.poll(() => profileWrites.length).toBe(2)
  expect(profileWrites[1]).toMatchObject({ company_phone: '6155550100', estimate_template: 'classic' })
  expect(profileWrites[1]).not.toHaveProperty('company_name')
  expect(profileWrites[1]).not.toHaveProperty('payment_link')
  await page.reload()
  await expect(phone).toHaveValue('6155550100')
  await nav.getByRole('link', { name: 'Business', exact: true }).click()
  await expect(company).toHaveValue('Updated company')
})

test('a completed save preserves newer typing in the same section', async ({ page, context }) => {
  const { profileWrites } = await signInWithPersistedSettings(context)
  let release = () => {}
  let saving = false
  const gate = new Promise<void>((resolve) => { release = resolve })
  await context.route('**/rest/v1/profiles?*', async (route) => {
    if (route.request().method() === 'POST' && !saving) { saving = true; await gate }
    return route.fallback()
  })
  await page.goto('/settings')
  const company = page.getByRole('textbox', { name: 'Company name', exact: true })
  await company.fill('First saved name')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => saving).toBe(true)
  await company.fill('Newer unsaved name')
  release()
  await expect.poll(() => profileWrites.length).toBe(1)
  await expect(company).toHaveValue('Newer unsaved name')
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved business changes' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeEnabled()
  expect(profileWrites[0].company_name).toBe('First saved name')
})

test('invalid document drafts do not block payment saves or disappear on section changes', async ({ page, context }) => {
  const { profileWrites } = await signInWithPersistedSettings(context)
  await page.goto('/settings?section=documents')
  const color = page.getByRole('textbox', { name: /hex/i })
  await color.fill('unfinished')
  const nav = page.getByRole('navigation', { name: 'Settings sections' })
  await nav.getByRole('link', { name: 'Payments', exact: true }).click()
  await page.getByRole('textbox', { name: /^Payment instructions/ }).fill('Checks payable to Parker')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => profileWrites).toEqual([{ user_id: 'qa-user-1', payment_link: null, payment_instructions: 'Checks payable to Parker' }])
  await nav.getByRole('link', { name: /^Documents/ }).click()
  await expect(color).toHaveValue('unfinished')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(page.getByText('Enter a six digit brand color, such as #C9963A.')).toBeVisible()
  expect(profileWrites).toHaveLength(1)
})

test('saving reminders preserves preferences changed in another workspace', async ({ page, context }) => {
  const { profileWrites, changeStoredPreferences } = await signInWithPersistedSettings(context)
  await page.goto('/settings?section=preferences')
  await page.getByRole('combobox', { name: 'Quote reminder delay', exact: true }).selectOption('7')
  changeStoredPreferences({ quote_follow_up: { enabled: true, days: 3 }, favorite_template_ids: ['template-new'], theme: 'dark' })
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect.poll(() => profileWrites).toEqual([{ preferences: { quote_follow_up: { enabled: true, days: 7 }, favorite_template_ids: ['template-new'], theme: 'dark' } }])
  await expect(page.getByRole('status').filter({ hasText: 'Your changes are saved' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Quote reminder delay', exact: true })).toHaveValue('7')
})

test('optional profile details are suggestions and the rate card reflows at 320px', async ({ page, context, isMobile }) => {
  await signIn(context)
  await page.goto('/settings')
  if (!isMobile) {
    await expect(page.getByText('Company profile ready', { exact: true })).toBeVisible()
    await expect(page.getByText('Optional additions', { exact: true })).toBeVisible()
    await expect(page.getByText('Needs setup', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Incomplete', { exact: true })).toHaveCount(0)
  }
  await page.setViewportSize({ width: 320, height: 800 })
  await page.goto('/settings#rates')
  const concrete = page.getByRole('group', { name: 'Concrete rates', exact: true })
  await expect(concrete).toBeVisible()
  for (const control of [concrete.getByRole('combobox'), ...await concrete.getByRole('spinbutton').all()]) {
    const bounds = await control.boundingBox()
    expect(bounds).not.toBeNull()
    expect(bounds!.x).toBeGreaterThanOrEqual(0)
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320)
    expect(bounds!.height).toBeGreaterThanOrEqual(44)
  }
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)
  expect(overflow).toBe(false)
})

test('authenticated workspaces retain only the shell main landmark', async ({ page, context }) => {
  await signIn(context)
  for (const route of ['/activity', '/subs', '/partners', '/tasks', '/timesheets', '/crew', '/import', '/team']) {
    await page.goto(route)
    await expect(page.locator('#fh-main')).toBeVisible()
    await expect(page.locator('#fh-main h1').first()).toBeVisible()
    await expect(page.getByRole('main')).toHaveCount(1)
  }
})
