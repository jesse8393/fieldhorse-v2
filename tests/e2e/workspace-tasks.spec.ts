import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'

test('job tasks can be completed, undone, and created on a narrow phone', async ({ context, page }) => {
  await signIn(context)
  await page.setViewportSize({ width: 320, height: 844 })
  let rows: Record<string, unknown>[] = [{
    id: 'todo-review', job_id: 'c-job1', user_id: 'qa-user-1', assigned_to: 'qa-user-1',
    text: 'Confirm arrival time with the homeowner', done: false,
    created_at: new Date().toISOString(), due_at: null,
  }]
  await context.route(/\/rest\/v1\/fh_job_todos(\?|$)/, async route => {
    const request = route.request()
    const id = new URL(request.url()).searchParams.get('id')?.replace(/^eq\./, '')
    if (request.method() === 'PATCH') rows = rows.map(row => row.id === id ? { ...row, ...request.postDataJSON() } : row)
    if (request.method() === 'POST') rows.push({ id: 'todo-created', done: false, created_at: new Date().toISOString(), ...request.postDataJSON() })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(id ? rows.filter(row => row.id === id) : rows) })
  })

  await page.goto('/jobs/c-job1')
  const complete = page.getByRole('checkbox', { name: 'Complete Confirm arrival time with the homeowner', exact: true })
  await expect(complete).toBeVisible()
  const target = (await complete.boundingBox())!
  expect(target.width).toBeGreaterThanOrEqual(44)
  expect(target.height).toBeGreaterThanOrEqual(44)
  await complete.click()
  await expect(page.getByText('All current tasks complete.', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Open tasks 0' })).toBeFocused()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(complete).toBeVisible()
  expect(rows[0].done).toBe(false)

  await page.getByRole('button', { name: 'Add task', exact: true }).click()
  await page.getByRole('textbox', { name: 'Task description' }).fill('Review field measurements')
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
  await expect(page.getByText('Review field measurements', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Review field measurements', { exact: true })).toBeVisible()
  await nothingRunsOffTheSide(page, 'Task editing at 320 pixels')
})

test('a failed task read offers retry without claiming the job has no tasks', async ({ context, page }) => {
  await signIn(context)
  await context.route(/\/rest\/v1\/fh_job_todos(\?|$)/, route => route.fulfill({
    status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary test failure' }),
  }))
  await page.goto('/jobs/c-job1')
  const tasks = page.getByRole('region', { name: 'Open tasks', exact: true })
  await expect(tasks).toContainText('Tasks could not load.')
  await expect(tasks.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(tasks.getByText('No tasks added yet.')).toHaveCount(0)
})

test('the material composer and existing materials fit a narrow phone', async ({ context, page }) => {
  await signIn(context, { tables: { fh_materials: [{
    id: 'material-review', job_id: 'c-job1', user_id: 'qa-user-1', name: 'Pressure treated timber',
    qty_needed: 12, unit: 'EA', unit_cost: 16, supplier: 'Local building supplier', created_at: new Date().toISOString(),
  }] } })
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/jobs/c-job1?tab=materials')
  await expect(page.getByRole('textbox', { name: 'Material name', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add material', exact: true })).toBeVisible()
  await expect(page.getByText('Pressure treated timber', { exact: true })).toBeVisible()
  await nothingRunsOffTheSide(page, 'Material composer and rows at 320 pixels')
})
