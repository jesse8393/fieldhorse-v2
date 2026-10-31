import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'
import { USER } from '../../scripts/qa-mock.mjs'

test.use({ timezoneId: 'America/Chicago' })

test('a standalone day visit has readable touch actions and opens with a keyboard', async ({ context, page }) => {
  const title = 'Review every site access point with the delivery team before the concrete pour'
  await signIn(context, { tables: { fh_schedule: [{
    id: 'day-manual', user_id: USER.id, org_id: 'org-1', contact_id: null,
    title, start_at: '2026-10-31T14:00:00Z', end_at: '2026-10-31T15:00:00Z',
    status: 'scheduled', assigned_to: null, assigned_user_ids: []
  }] } })
  await page.clock.setFixedTime(new Date('2026-10-31T13:00:00Z'))
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/schedule?d=2026-10-31')
  await page.getByRole('tab', { name: 'Day', exact: true }).click()
  const agenda = page.getByRole('list', { name: 'Daily agenda' })
  for (const name of ['Edit event', 'Delete event']) {
    const action = agenda.getByRole('button', { name, exact: true })
    await expect(action).toBeVisible()
    await expect(action).toHaveCSS('opacity', '1')
    const box = await action.boundingBox()
    expect(box!.height).toBeGreaterThanOrEqual(44)
    expect(box!.width).toBeGreaterThanOrEqual(44)
  }
  await nothingRunsOffTheSide(page, 'daily agenda at 320 px')
  const visit = agenda.getByRole('button', { name: new RegExp(title) })
  await expect(visit).toBeEnabled()
  await visit.press('Enter')
  await expect(page).toHaveURL(/\/schedule\/day-manual\/edit/)
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title)
})

test('a narrow phone week keeps full event titles and standalone events editable', async ({ context, page }) => {
  const title = 'Walk through the entire site with the electrical subcontractor'
  await signIn(context, { tables: { fh_schedule: [{
    id: 'agenda-manual', user_id: USER.id, org_id: 'org-1', contact_id: null,
    title, start_at: '2026-10-31T14:00:00Z', end_at: '2026-10-31T15:00:00Z',
    status: 'scheduled', assigned_to: null, assigned_user_ids: []
  }] } })
  await page.clock.setFixedTime(new Date('2026-10-30T15:00:00Z'))
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/schedule?d=2026-10-30')
  await page.getByRole('tab', { name: 'Week', exact: true }).click()
  const agenda = page.getByLabel('Weekly agenda')
  await expect(agenda.getByText(title, { exact: true })).toBeVisible()
  const row = agenda.getByRole('button', { name: new RegExp(title) })
  expect((await row.boundingBox())!.width).toBeGreaterThan(220)
  await expect(agenda.getByText('No visits', { exact: true })).toHaveCount(0)
  await nothingRunsOffTheSide(page, 'weekly agenda at 320 px')
  await row.click()
  await expect(page).toHaveURL(/\/schedule\/agenda-manual\/edit/)
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue(title)
})

test('Sunday remains visible and mobile can schedule an unscheduled job', async ({ context, page }) => {
  await signIn(context, { tables: { fh_schedule: [] } })
  await page.clock.setFixedTime(new Date('2026-10-25T15:00:00Z'))
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto('/schedule?d=2026-10-25')
  const week = page.getByLabel('Selected calendar week')
  const sunday = week.getByRole('button', { name: 'Sunday, October 25' })
  await expect(sunday).toHaveAttribute('aria-pressed', 'true')
  const box = await sunday.boundingBox()
  expect(box).not.toBeNull()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.x + box!.width).toBeLessThanOrEqual(390)
  await expect(week.getByRole('button').first()).toHaveAccessibleName('Sunday, October 25')
  await page.getByRole('button', { name: 'Next week', exact: true }).click()
  await expect(week.getByRole('button').first()).toHaveAccessibleName('Sunday, November 1')
  await page.getByRole('button', { name: 'Previous week', exact: true }).click()
  await expect(week.getByRole('button').first()).toHaveAccessibleName('Sunday, October 25')
  const tray = page.getByRole('region', { name: 'Unscheduled jobs' })
  await tray.locator('summary').click()
  await tray.getByRole('button', { name: 'Schedule Plumbing Bellevue' }).click()
  await expect(page).toHaveURL(/\/schedule\/new\?job=c-job1&title=/)
  await expect(page.getByLabel('Link to', { exact: true })).toHaveValue('Plumbing Bellevue')
})

test('duration and displayed recurrence match submitted visits', async ({ context, page }) => {
  await signIn(context)
  let submitted: { start_at: string; end_at: string; recurring: string }[] = []
  await context.route('**/rest/v1/fh_schedule*', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    submitted = route.request().postDataJSON()
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(submitted.map((_, i) => ({ id: `audit-${i}` }))) })
  })
  await page.goto('/schedule/new')
  await page.getByLabel('Title', { exact: true }).fill('Site work')
  await page.getByLabel('Date', { exact: true }).fill('2026-10-28')
  await page.getByLabel('Time', { exact: true }).fill('08:00')
  await page.getByLabel('Duration in minutes').fill('90')
  await page.getByRole('button', { name: 'Recurring series' }).click()
  await page.getByLabel('Total visits').fill('3')
  await expect(page.getByRole('region', { name: 'Recurring visit preview' }).getByRole('listitem')).toHaveCount(3)
  await page.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect.poll(() => submitted.length).toBe(3)
  expect(submitted.every((visit) => Date.parse(visit.end_at) - Date.parse(visit.start_at) === 90 * 60_000)).toBe(true)
  expect(new Set(submitted.map((visit) => visit.recurring)).size).toBe(1)
  expect(submitted.map((visit) => visit.start_at)).toEqual(['2026-10-28T13:00:00.000Z', '2026-11-04T14:00:00.000Z', '2026-11-11T14:00:00.000Z'])
})
