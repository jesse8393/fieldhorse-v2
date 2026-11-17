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
  await expect(page).toHaveURL(/\/schedule\/new\?date=2026-10-25&job=c-job1&title=/)
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

const seriesVisit = (id: string, start: string) => ({
  id, user_id: USER.id, org_id: 'org-1', contact_id: null, title: 'Weekly cure check', recurring: 'series-1',
  start_at: start, end_at: new Date(Date.parse(start) + 3600e3).toISOString(), status: 'scheduled', assigned_to: null, assigned_user_ids: []
})

// OPS-03: Delete on one visit of a series used to delete the whole series.
test('deleting one visit of a recurring series deletes only that visit, and the series has its own labelled control', async ({ context, page }) => {
  await signIn(context, { tables: { fh_schedule: [
    seriesVisit('series-a', '2026-10-31T14:00:00Z'), seriesVisit('series-b', '2026-11-07T14:00:00Z'), seriesVisit('series-c', '2026-11-14T15:00:00Z')
  ] } })
  const deletes: string[] = []
  await context.route('**/rest/v1/fh_schedule*', (route) => {
    if (route.request().method() !== 'DELETE') return route.fallback()
    deletes.push(decodeURIComponent(route.request().url()))
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'series-a' }]) })
  })
  await page.clock.setFixedTime(new Date('2026-10-31T13:00:00Z'))
  await page.goto('/schedule?d=2026-10-31')
  await page.getByRole('tab', { name: 'Day', exact: true }).click()
  const agenda = page.getByRole('list', { name: 'Daily agenda' })
  await expect(agenda.getByRole('button', { name: 'Delete all 3 visits', exact: true })).toBeVisible()
  await agenda.getByRole('button', { name: 'Delete event', exact: true }).click()
  await page.waitForTimeout(600)
  await agenda.getByRole('button', { name: 'Tap again to delete', exact: true }).click()
  await expect.poll(() => deletes.length).toBe(1)
  expect(deletes[0]).toContain('id=eq.series-a')
  expect(deletes[0]).not.toContain('recurring')
})

// OPS-04: crew and foreman saw New event, Edit event and Delete on every visit.
for (const role of ['crew', 'foreman']) {
  test(`a ${role} sees the day's visits without New event, Edit or Delete`, async ({ context, page }) => {
    await signIn(context, { role, tables: { fh_schedule: [seriesVisit('series-a', '2026-10-31T14:00:00Z')] } })
    await page.clock.setFixedTime(new Date('2026-10-31T13:00:00Z'))
    await page.goto('/schedule?d=2026-10-31')
    await page.getByRole('tab', { name: 'Day', exact: true }).click()
    const agenda = page.getByRole('list', { name: 'Daily agenda' })
    await expect(agenda.getByText('Weekly cure check')).toBeVisible()
    await expect(page.getByRole('button', { name: 'New event' })).toHaveCount(0)
    await expect(agenda.getByRole('button', { name: 'Edit event' })).toHaveCount(0)
    await expect(agenda.getByRole('button', { name: /Delete/ })).toHaveCount(0)
  })
}

// OPS-10: New event takes the day picked on the Schedule, a time that has
// not passed, and the linked job's name as its title.
test('New event starts on the day picked, at a time still ahead, titled after the job', async ({ context, page }) => {
  await signIn(context, { tables: { fh_schedule: [] } })
  await page.clock.setFixedTime(new Date('2026-10-28T14:10:00Z'))
  await page.goto('/schedule?d=2026-10-28')
  await page.getByRole('button', { name: 'Thursday, October 29' }).click()
  await page.getByRole('button', { name: 'New event' }).first().click()
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-10-29')
  await expect(page.getByLabel('Time', { exact: true })).toHaveValue('08:00')

  await page.goto('/schedule/new')
  await expect(page.getByLabel('Date', { exact: true })).toHaveValue('2026-10-28')
  // 9:10 am in Chicago: the next whole hour.
  await expect(page.getByLabel('Time', { exact: true })).toHaveValue('10:00')

  await page.goto('/schedule/new?job=c-job1')
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Plumbing Bellevue')
})

// OPS-17: a lead's estimate opens the lead, not Edit event.
test("tapping a lead's estimate on the Schedule opens the lead", async ({ context, page }) => {
  await signIn(context, { tables: { fh_schedule: [{
    id: 'le-visit', user_id: USER.id, org_id: 'org-1', contact_id: null, lead_id: 'l-lead1', quote_id: null,
    title: 'Estimate', description: 'Jeff Roy, 412 Burkitt Station Rd',
    start_at: '2026-10-31T14:00:00Z', end_at: '2026-10-31T15:00:00Z', status: 'scheduled', assigned_to: null, assigned_user_ids: []
  }] } })
  await page.clock.setFixedTime(new Date('2026-10-31T13:00:00Z'))
  await page.goto('/schedule?d=2026-10-31')
  await page.getByRole('tab', { name: 'Day', exact: true }).click()
  await page.getByRole('list', { name: 'Daily agenda' }).getByRole('button', { name: /Estimate/ }).first().click()
  await expect(page).toHaveURL(/\/leads\/l-lead1$/)
})

// DATA-13: after an estimate visit is saved, the lead shows it on return.
test("saving a lead's estimate refreshes the lead's next visit", async ({ context, page }) => {
  await signIn(context, { tables: { fh_schedule: [] } })
  let saved: any = null
  await context.route('**/rest/v1/fh_schedule*', (route) => {
    const request = route.request()
    if (request.method() === 'POST') {
      saved = request.postDataJSON()[0]
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify([{ id: saved.id || 'visit-1' }]) })
    }
    const url = new URL(request.url())
    if (saved && url.searchParams.get('lead_id') === 'eq.l-lead1') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'visit-1', title: 'Estimate', start_at: saved.start_at, end_at: saved.end_at }]) })
    }
    return route.fallback()
  })
  await page.goto('/leads/l-lead1')
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Next estimate visit' })).toHaveCount(0)
  await page.getByRole('link', { name: 'Schedule estimate' }).click()
  await expect(page).toHaveURL(/\/schedule\/new\?lead=l-lead1/)
  const tomorrow = new Date(Date.now() + 86400e3)
  const ymd = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`
  await page.getByLabel('Date', { exact: true }).fill(ymd)
  await page.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect(page).toHaveURL(/\/leads\/l-lead1$/)
  await expect(page.getByRole('region', { name: 'Next estimate visit' })).toBeVisible()
})

// DATA-12: a save whose answer is lost is retried on the same ids.
test('retrying a visit save after a lost answer sends the same visit ids as an upsert', async ({ context, page }) => {
  await signIn(context, { tables: { fh_schedule: [] } })
  const attempts: { ids: string[]; prefer: string }[] = []
  await context.route('**/rest/v1/fh_schedule*', (route) => {
    const request = route.request()
    if (request.method() !== 'POST') return route.fallback()
    const rows = request.postDataJSON() as { id?: string }[]
    attempts.push({ ids: rows.map((r) => r.id || ''), prefer: request.headers()['prefer'] || '' })
    if (attempts.length === 1) return route.abort('connectionreset')
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(rows.map((r) => ({ id: r.id }))) })
  })
  await page.goto('/schedule/new')
  await page.getByLabel('Title', { exact: true }).fill('Site work')
  await page.getByLabel('Date', { exact: true }).fill('2026-12-28')
  await page.getByRole('button', { name: 'Recurring series' }).click()
  await page.getByLabel('Total visits').fill('3')
  await page.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect.poll(() => attempts.length).toBe(1)
  await expect(page).toHaveURL(/\/schedule\/new$/)
  await page.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect.poll(() => attempts.length).toBe(2)
  expect(attempts[0].ids.every(Boolean)).toBe(true)
  expect(attempts[1].ids).toEqual(attempts[0].ids)
  expect(attempts[1].prefer).toContain('merge-duplicates')
})
