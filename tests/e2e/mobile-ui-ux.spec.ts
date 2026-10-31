import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'

// These are UI checks against controlled records, not real account validation.
test('Today keeps its date and sync status below the sticky header', async ({ context, page }) => {
  await signIn(context)
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    await expect(page.locator('.fht-date')).toBeVisible()
    const header = await page.locator('.fh-app-header').boundingBox()
    const date = await page.locator('.fht-date').boundingBox()
    const sync = await page.locator('.fht-stage__meta .fhc-sync').boundingBox()
    expect(date!.y).toBeGreaterThanOrEqual(header!.y + header!.height)
    expect(sync!.y).toBeGreaterThanOrEqual(header!.y + header!.height)
    await expect(page.getByRole('link', { name: /^Invoice, .*ready to bill/ })).toBeVisible()
    await nothingRunsOffTheSide(page)
  }
})

test('failed job creation returns to the first correction and preserves entered work', async ({ context, page }) => {
  await signIn(context)
  await page.setViewportSize({ width: 320, height: 640 })
  await page.goto('/jobs/new')
  await page.getByLabel('Scope', { exact: true }).fill('Keep access open during concrete delivery.')
  await page.getByRole('button', { name: 'Save job' }).click()
  await expect(page.getByRole('combobox', { name: 'Client', exact: true })).toBeFocused()
  await expect(page.getByText('Enter a client.', { exact: true })).toBeInViewport()
  await expect(page.getByLabel('Scope', { exact: true })).toHaveValue('Keep access open during concrete delivery.')
  const jobType = page.getByRole('combobox', { name: 'Job type Optional' })
  await jobType.selectOption('Concrete')
  await expect(jobType).toHaveValue('Concrete')
  await jobType.selectOption('')
  await expect(jobType).toHaveValue('')
  // A second attempt must restore focus even when validation text is unchanged.
  await page.getByRole('button', { name: 'Save job' }).click()
  await expect(page.getByRole('combobox', { name: 'Client', exact: true })).toBeFocused()
  await nothingRunsOffTheSide(page)
})

test('customer suggestions support arrows, Escape and explicit selection', async ({ context, page }) => {
  await signIn(context, { tables: { fh_clients: [
    { id: 'cl-1', name: 'Jordan Taylor', phone: '555-0101', address: '10 North Street', user_id: 'qa-user-1', org_id: 'org-1' },
    { id: 'cl-2', name: 'Jordan Taylor', phone: '555-0102', address: '20 South Street', user_id: 'qa-user-1', org_id: 'org-1' }
  ] } })
  await page.goto('/jobs/new')
  const field = page.getByRole('combobox', { name: 'Client', exact: true })
  await field.fill('Jordan')
  await expect(page.getByRole('option', { name: /20 South Street/ })).toBeVisible()
  await field.press('ArrowDown')
  await field.press('ArrowDown')
  await expect(page.getByRole('option', { name: /20 South Street/ })).toHaveAttribute('aria-selected', 'true')
  await field.press('Escape')
  await expect(field).toHaveAttribute('aria-expanded', 'false')
  await field.press('ArrowUp')
  await field.press('Enter')
  await expect(page.getByText('Saves to Jordan Taylor.')).toBeVisible()
  await expect(page.getByLabel('Address', { exact: true })).toHaveValue('20 South Street')
  await expect(page).toHaveURL(/\/jobs\/new$/)
})

test('task management stays readable and operable with long records', async ({ context, page }) => {
  const task = 'Confirm every delivery and access detail with the homeowner before the concrete crew arrives'
  await signIn(context, { tables: { fh_job_todos: [{ id: 'task-ui', text: task, job_id: 'c-job1', assigned_to: 'qa-user-1', user_id: 'qa-user-1', due_at: null, done: false, created_at: new Date().toISOString() }] } })
  for (const width of [320, 390, 1024, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/tasks')
    await expect(page.getByText(task, { exact: true })).toBeVisible()
    const clipped = await page.locator('.fh-task-row__title').evaluate(el => el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1)
    expect(clipped).toBe(false)
    for (const control of await page.locator('.fh-task-row button, .fh-task-row select').all()) {
      const box = await control.boundingBox()
      expect(box!.width).toBeGreaterThanOrEqual(44)
      expect(box!.height).toBeGreaterThanOrEqual(44)
    }
    await nothingRunsOffTheSide(page)
  }
  await page.setViewportSize({ width: 320, height: 844 })
  await page.getByRole('button', { name: 'New task', exact: true }).click()
  const form = page.getByRole('form', { name: 'New task' })
  await expect(form.getByLabel('Task', { exact: true })).toBeFocused()
  await form.getByLabel('Task', { exact: true }).fill('Check material delivery')
  await form.getByRole('combobox', { name: 'Job', exact: true }).selectOption('c-job1')
  await expect(form.getByRole('button', { name: 'Add task', exact: true })).toBeEnabled()
  await nothingRunsOffTheSide(page)
  await form.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(form).toHaveCount(0)
})

test('an empty task dashboard retains the wide desktop workspace', async ({ context, page }) => {
  await signIn(context, { tables: { fh_job_todos: [] } })
  await page.setViewportSize({ width: 2048, height: 1192 })
  await page.goto('/tasks')
  await expect(page.getByText('No open tasks.', { exact: true })).toBeVisible()
  const workspace = await page.locator('[data-build-screen="Tasks"]').boundingBox()
  expect(workspace!.width).toBeGreaterThanOrEqual(1200)
  await nothingRunsOffTheSide(page)
})

test('narrow schedule controls retain touch targets and expose the selected day', async ({ context, page }) => {
  await signIn(context)
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/schedule')
  const selected = page.locator('.fhev-week-strip [aria-pressed="true"]')
  await expect(selected).toBeVisible()
  await expect.poll(async () => selected.evaluate(el => {
    const a = el.getBoundingClientRect()
    const b = el.parentElement!.getBoundingClientRect()
    return a.left >= b.left - 1 && a.right <= b.right + 1
  })).toBe(true)
  for (const control of await page.locator('.fhev-week-strip button, .fhev-view-controls [role=tab]').all()) {
    const box = await control.boundingBox()
    expect(box!.width).toBeGreaterThanOrEqual(44)
    expect(box!.height).toBeGreaterThanOrEqual(44)
  }
  await page.getByRole('tab', { name: 'Day', exact: true }).click()
  await expect(page.getByRole('tab', { name: 'Day', exact: true })).toHaveAttribute('aria-selected', 'true')
  await nothingRunsOffTheSide(page)
})

test('public entry has clear hierarchy, reachable actions and no founder story', async ({ page }) => {
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 844 })
    await page.goto('/')
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
    const sizes = await page.locator('.fh-landing').evaluate(el => ({
      title: Number.parseFloat(getComputedStyle(el.querySelector('h1')!).fontSize),
      body: Number.parseFloat(getComputedStyle(el.querySelector('.fh-landing-intro')!).fontSize)
    }))
    expect(sizes.title).toBeGreaterThan(sizes.body * 1.8)
    const signup = page.getByRole('link', { name: 'Create a free account' })
    expect((await signup.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    await expect(signup).toHaveAttribute('href', '/login?mode=signup')
    await expect(page.getByText(/I run Parker Construction|Jesse Parker|Built by a contractor/)).toHaveCount(0)
    await nothingRunsOffTheSide(page)
  }
  await page.getByRole('link', { name: 'Create a free account' }).click()
  await expect(page).toHaveURL(/\/login\?mode=signup$/)
})

test('task completion gives feedback and Undo restores the same task', async ({ context, page }) => {
  await signIn(context)
  let task = { id: 'task-undo', text: 'Confirm site access', job_id: 'c-job1', assigned_to: null, user_id: 'qa-user-1', due_at: null, done: false, completed_at: null as string | null, created_at: new Date().toISOString() }
  const changes: Record<string, unknown>[] = []
  await context.route(/\/rest\/v1\/fh_job_todos(?:\?|$)/, async route => {
    if (route.request().method() === 'PATCH') {
      const values = route.request().postDataJSON()
      changes.push(values)
      task = { ...task, ...values }
      await route.fulfill({ json: [{ id: task.id }] })
    } else await route.fulfill({ json: task.done ? [] : [task] })
  })
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/tasks')
  await page.getByRole('button', { name: 'Complete Confirm site access' }).click()
  await expect(page.getByText('Task completed', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Complete Confirm site access' })).toBeVisible()
  expect(changes).toHaveLength(2)
  expect(changes[0]).toMatchObject({ done: true })
  expect(changes[1]).toEqual({ done: false, completed_at: null })
})

test('refused task completion restores the row without a success message', async ({ context, page }) => {
  const task = { id: 'task-refused', text: 'Check delivery access', job_id: 'c-job1', assigned_to: null, user_id: 'qa-user-1', due_at: null, done: false, completed_at: null, created_at: new Date().toISOString() }
  await signIn(context, { tables: { fh_job_todos: [task] } })
  await context.route(/\/rest\/v1\/fh_job_todos(?:\?|$)/, async route => {
    if (route.request().method() === 'PATCH') await route.fulfill({ json: [] })
    else await route.fallback()
  })
  await page.goto('/tasks')
  await page.getByRole('button', { name: 'Complete Check delivery access' }).click()
  await expect(page.getByText("Couldn't complete", { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Complete Check delivery access' })).toBeVisible()
  await expect(page.getByText('Task completed', { exact: true })).toHaveCount(0)
})
