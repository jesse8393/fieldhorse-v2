import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'

test('task deletion does not report success when the server changed no rows', async ({ context, page }) => {
  await signIn(context)
  const task = { id: 'task-denied-delete', job_id: 'c-job1', user_id: 'qa-user-1', assigned_to: null,
    text: 'Keep this task when deletion is denied', done: false, completed_at: null, due_at: null, created_at: new Date().toISOString() }
  await context.route(/\/rest\/v1\/fh_job_todos(\?|$)/, route => route.fulfill({
    status: 200, contentType: 'application/json', body: JSON.stringify(route.request().method() === 'DELETE' ? [] : [task])
  }))
  await page.goto('/tasks')
  await page.getByRole('button', { name: `Delete ${task.text}`, exact: true }).click()
  await expect(page.getByText("Couldn't delete", { exact: true })).toBeVisible()
  await expect(page.getByText(task.text, { exact: true })).toBeVisible()
  await expect(page.getByText('Task deleted', { exact: true })).toHaveCount(0)
})

test('task dashboard reads every page for the selected company', async ({ context, page }) => {
  await signIn(context)
  const tasks = Array.from({ length: 1001 }, (_, index) => ({ id: `task-page-${index}`, job_id: 'c-job1', user_id: 'qa-user-1',
    org_id: 'org-1', assigned_to: null, text: `Paged task ${index}`, done: false, completed_at: null, due_at: null, created_at: new Date().toISOString() }))
  const pages: number[] = []
  await context.route(/\/rest\/v1\/fh_job_todos(\?|$)/, route => {
    const query = new URL(route.request().url()).searchParams
    expect(query.get('org_id')).toBe('eq.org-1')
    const offset = Number(query.get('offset') || 0)
    pages.push(offset)
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tasks.slice(offset, offset + Number(query.get('limit') || 1000))) })
  })
  await page.goto('/tasks')
  await expect(page.getByRole('status').filter({ hasText: '1001 tasks' })).toBeVisible()
  expect(pages).toContain(1000)
  await expect(page.getByText('Paged task 1000', { exact: true })).toHaveCount(1)
})

test('job tasks can be completed, undone, and created on a narrow phone', async ({ context, page }) => {
  await signIn(context)
  await page.setViewportSize({ width: 320, height: 844 })
  let rows: Record<string, unknown>[] = [{
    id: 'todo-review', job_id: 'c-job1', user_id: 'qa-user-1', assigned_to: 'qa-user-1',
    text: 'Confirm arrival time with the homeowner', done: false,
    created_at: new Date().toISOString(), due_at: null,
  }]
  let undoStarted = false
  let releaseUndo = () => {}
  const undoGate = new Promise<void>(resolve => { releaseUndo = resolve })
  await context.route(/\/rest\/v1\/fh_job_todos(\?|$)/, async route => {
    const request = route.request()
    const id = new URL(request.url()).searchParams.get('id')?.replace(/^eq\./, '')
    if (request.method() === 'PATCH') {
      const patch = request.postDataJSON()
      if (patch.done === false) {
        undoStarted = true
        await undoGate
      }
      rows = rows.map(row => row.id === id ? { ...row, ...patch } : row)
    }
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
  const undoResponse = page.waitForResponse(response =>
    response.url().includes('/rest/v1/fh_job_todos') &&
    response.request().method() === 'PATCH' && response.request().postDataJSON().done === false)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  try {
    // Undo restores the row optimistically. A visible checkbox does not
    // establish persistence while the asynchronous update remains pending.
    await expect(complete).toBeVisible()
    await expect.poll(() => undoStarted).toBe(true)
    expect(rows[0].done).toBe(true)
  } finally { releaseUndo() }
  expect((await undoResponse).status()).toBe(200)
  await expect.poll(() => rows[0].done).toBe(false)
  await page.reload()
  await expect(complete).toBeVisible()

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
  let reads = 0
  await context.route(/\/rest\/v1\/fh_job_todos(\?|$)/, route => {
    // Let the parent job load, then fail the task section's independent read.
    if (++reads === 1) return route.fallback()
    return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary test failure' }) })
  })
  await page.goto('/jobs/c-job1')
  const tasks = page.getByRole('region', { name: 'Open tasks', exact: true })
  await expect(tasks).toContainText('Tasks could not load.')
  await expect(tasks.getByRole('button', { name: 'Try again' })).toBeVisible()
  await expect(tasks.getByText('No tasks added yet.')).toHaveCount(0)
})

test('the material composer and existing materials fit a narrow phone', async ({ context, page }) => {
  await signIn(context, { tables: { fh_materials: [{
    id: 'material-review', contact_id: 'c-job1', user_id: 'qa-user-1', name: 'Pressure treated timber',
    qty_needed: 12, unit: 'EA', unit_cost: 16, supplier: 'Local building supplier', created_at: new Date().toISOString(),
  }] } })
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/jobs/c-job1?tab=materials')
  await expect(page.getByRole('textbox', { name: 'Material name', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Add material', exact: true })).toBeVisible()
  await expect(page.getByText('Pressure treated timber', { exact: true })).toBeVisible()
  await nothingRunsOffTheSide(page, 'Material composer and rows at 320 pixels')
})
