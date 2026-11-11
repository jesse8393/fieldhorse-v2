import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'
import { USER } from '../../scripts/qa-mock.mjs'

const client = { id: 'audit-client', name: 'Audit Customer', email: 'audit@example.com', phone: null }
const common = { user_id: USER.id, org_id: 'org-1', client_id: client.id, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-11-01T12:00:00Z', fh_clients: client }
const tables = {
  fh_contacts: [
    { ...common, id: 'audit-job', name: client.name, stage: 'job', amount: 500000, cost: 100000, job_title: 'Exterior entrance painting and sidewalk restoration across multiple buildings' },
    { ...common, id: 'paid-job', name: 'Completed Project', stage: 'closed', amount: 9930019.2, cost: 300000, completed_at: '2026-11-09T15:00:00Z', job_title: 'Workshop addition' }
  ],
  fh_clients: [client],
  fh_quotes: [],
  fh_invoices: [{ ...common, id: 'audit-invoice', contact_id: 'audit-job', title: 'Progress draw', amount: 153535.25, status: 'sent', sequence_number: 1, issued_at: '2026-10-01T12:00:00Z', due_at: '2026-10-14' }],
  fh_payments: [{ ...common, id: 'audit-payment', contact_id: 'paid-job', invoice_id: null, amount: 9930019.2, paid_on: '2026-11-09', method: 'check' }]
}

test('an available app update preserves an unfinished visit', async ({ context, page }) => {
  await signIn(context)
  await context.addInitScript(() => {
    const workers = Object.assign(new EventTarget(), {
      controller: {},
      getRegistration: async () => ({ update: async () => {} })
    })
    Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: workers })
    window.addEventListener('qa:activate-worker', () => {
      workers.controller = {}
      workers.dispatchEvent(new Event('controllerchange'))
    })
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/schedule/new')
  await page.getByLabel('Title', { exact: true }).fill('Unfinished inspection visit')
  await page.evaluate(() => window.dispatchEvent(new Event('qa:activate-worker')))
  await expect(page.getByRole('status').filter({ hasText: 'Update ready' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reload app', exact: true })).toBeVisible()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Unfinished inspection visit')
  await expect(page).toHaveURL(/\/schedule\/new$/)
  await nothingRunsOffTheSide(page, 'update notice over an unfinished form')
})

for (const width of [320, 390, 430]) {
  test(`money facts and long invoice descriptions remain readable at ${width}px`, async ({ context, page }, testInfo) => {
    await signIn(context, { tables })
    await page.clock.setFixedTime(new Date('2026-11-10T18:00:00Z'))
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/invoices')
    const vault = page.locator('.fhc-vault')
    await expect(vault.getByText('$153,535.25', { exact: true })).toBeVisible()
    await expect(vault.getByText('Includes overdue invoices', { exact: true })).toBeVisible()
    const amount = vault.locator('.fhc-vault__amount')
    await expect(amount).toHaveText('$9,930,019.20')
    const amountLayout = await amount.evaluate(el => {
      const range = document.createRange()
      range.selectNodeContents(el)
      const text = range.getBoundingClientRect()
      const box = el.getBoundingClientRect()
      return { lines: range.getClientRects().length, fits: text.left >= box.left - 1 && text.right <= box.right + 1 }
    })
    expect(amountLayout).toEqual({ lines: 1, fits: true })
    const collisions = await vault.locator('.fhc-vault__fact').evaluateAll(facts => facts.filter(fact => {
      const label = fact.querySelector('dt')!.getBoundingClientRect()
      const value = fact.querySelector('dd')!.getBoundingClientRect()
      const range = document.createRange()
      range.selectNodeContents(fact.querySelector('dd')!)
      const text = range.getBoundingClientRect()
      const parent = fact.getBoundingClientRect()
      const overlap = Math.min(label.right, value.right) - Math.max(label.left, value.left) > 1
        && Math.min(label.bottom, value.bottom) - Math.max(label.top, value.top) > 1
      return overlap || text.right > parent.right + 1 || text.left < parent.left - 1
    }).map(fact => fact.textContent))
    expect(collisions).toEqual([])
    const overdue = page.getByRole('region', { name: 'Overdue', exact: true })
    const row = overdue.locator('.fhc-row__main')
    const subline = overdue.locator('.fhc-row__sub')
    const rowBox = (await row.boundingBox())!
    const descriptionBox = (await subline.boundingBox())!
    expect(descriptionBox.width).toBeGreaterThan(rowBox.width * 0.8)
    await nothingRunsOffTheSide(page, `money at ${width}px`)
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('money-phone.png'), fullPage: true })
    await overdue.getByRole('link', { name: 'Remind Audit Customer', exact: true }).click()
    await expect(page).toHaveURL(/\/invoices\/audit-invoice\/remind$/)
  })
}

test('a large job balance fits its desktop side panel', async ({ context, page }) => {
  await signIn(context, { tables: {
    ...tables,
    fh_contacts: tables.fh_contacts.map(job => job.id === 'audit-job' ? { ...job, amount: 99930019.2 } : job)
  } })
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto('/jobs/audit-job')
  const amount = page.getByRole('complementary', { name: 'Job facts' }).locator('.fhc-vault__amount')
  await expect(amount).toHaveText('$99,930,019.20')
  const layout = await amount.evaluate(el => {
    const range = document.createRange()
    range.selectNodeContents(el)
    const text = range.getBoundingClientRect()
    const box = el.getBoundingClientRect()
    return { lines: range.getClientRects().length, fits: text.left >= box.left - 1 && text.right <= box.right + 1 }
  })
  expect(layout).toEqual({ lines: 1, fits: true })
  await nothingRunsOffTheSide(page, 'large job balance')
})

for (const width of [320, 390, 1440]) {
  test(`event fields stay compact and separate at ${width}px`, async ({ context, page }, testInfo) => {
    await signIn(context)
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/schedule/new')
    const picker = page.getByRole('combobox', { name: 'Link to', exact: true })
    await expect(picker).toBeEnabled()
    const pickerHeight = await picker.evaluate(el => el.closest('.fh-record-picker')!.getBoundingClientRect().height)
    expect(pickerHeight).toBeLessThan(110)
    const date = (await page.getByLabel('Date', { exact: true }).boundingBox())!
    const time = (await page.getByLabel('Time', { exact: true }).boundingBox())!
    expect(date.x + date.width + 8 <= time.x || date.y + date.height + 8 <= time.y).toBe(true)
    await nothingRunsOffTheSide(page, `event form at ${width}px`)
    await picker.fill('Slab')
    await picker.press('ArrowDown')
    await picker.press('Enter')
    await expect(picker).toHaveValue('Plumbing Bellevue')
    await page.getByRole('button', { name: 'Save event', exact: true }).click()
    await expect(page.getByLabel('Title', { exact: true })).toBeFocused()
    await expect(page.getByText('Give the event a title.', { exact: true })).toBeVisible()
    if (width === 390) await page.screenshot({ path: testInfo.outputPath('event-phone.png'), fullPage: true })
  })
}
