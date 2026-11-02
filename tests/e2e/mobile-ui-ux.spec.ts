import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'

const selectionFixture = {
  id: 'selection-ui', user_id: 'qa-user-1', contact_id: 'c-job1', title: 'Bathroom floor',
  room: 'Master bath', category: 'Tile', status: 'draft', created_at: '2026-10-31T12:00:00Z',
  options: [{ id: 'option-ui', label: 'Porcelain tile', brand: 'Sample', sku: 'PT-100', price: 7.25 }]
}

test('missing subcontractor profile has no endless saving state or unnamed retry button', async ({ context, page }) => {
  await signIn(context)
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/sub-portal/profile')
  await expect(page.getByText('No profile yet', { exact: true })).toBeVisible()
  const save = page.getByRole('button', { name: 'Save changes', exact: true })
  await expect(save).toBeDisabled()
  await expect(save).not.toHaveAttribute('aria-busy', 'true')
  await expect(page.getByRole('button', { name: '', exact: true })).toHaveCount(0)
  await nothingRunsOffTheSide(page)
})

test('failed subcontractor profile loading recovers through a named keyboard retry', async ({ context, page }) => {
  await signIn(context)
  let refuse = true
  await context.route('**/api/sub-portal-context', route => refuse
    ? route.fulfill({ status: 503, json: { error: 'Profile unavailable' } })
    : route.fulfill({ json: { matched_profiles: [{ id: 'sub-profile', name: 'Test subcontractor', phone: '6155550182' }] } }))
  await page.goto('/sub-portal/profile')
  await expect(page.getByText("Couldn't load your profile", { exact: true })).toBeVisible()
  const save = page.getByRole('button', { name: 'Save changes', exact: true })
  await expect(save).toBeDisabled()
  await expect(save).not.toHaveAttribute('aria-busy', 'true')
  refuse = false
  await page.getByRole('button', { name: 'Try again', exact: true }).press('Enter')
  await expect(page.getByLabel('Phone', { exact: true })).toHaveValue('6155550182')
  await expect(save).toBeEnabled()
  await expect(page.getByRole('main')).toBeFocused()
})

test('missing records have no unnamed retry controls or endless saving indicators', async ({ context, page }) => {
  await signIn(context)
  await page.setViewportSize({ width: 320, height: 844 })
  for (const [path, message] of [
    ['/jobs/missing-job/payment', 'This job is gone'],
    ['/jobs/missing-job/more', 'This job is gone'],
    ['/schedule/missing-event/edit', 'This event is gone.'],
    ['/clients/missing-client/statement', 'This customer is gone'],
    ['/quotes/missing-quote/terms', 'This quote is gone.'],
  ]) {
    await page.goto(path)
    await expect(page.getByText(message, { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: '', exact: true })).toHaveCount(0)
    await expect(page.locator('button[aria-busy="true"]')).toHaveCount(0)
    if (path.endsWith('/payment')) await expect(page.getByRole('button', { name: 'Record payment', exact: true })).toBeDisabled()
    if (path.endsWith('/edit')) await expect(page.getByRole('button', { name: 'Save changes', exact: true })).toBeDisabled()
    await nothingRunsOffTheSide(page)
  }
})

for (const surface of ['phone', 'desktop'] as const) {
  test(`${surface} search removes restricted results after a role change and rejects late financial responses`, async ({ context, page }) => {
    await signIn(context)
    await page.setViewportSize({ width: surface === 'phone' ? 320 : 1440, height: 844 })
    let currentRole = 'owner'
    await context.route(/\/rest\/v1\/org_members(?:\?|$)/, route => route.fulfill({
      status: 200, contentType: 'application/json', body: JSON.stringify([
        { id: 'm1', org_id: 'org-1', user_id: 'qa-user-1', role: currentRole, revoked_at: null, joined_at: '2026-01-01T00:00:00Z' },
      ]),
    }))
    const fieldReads: URL[] = []
    let refuseSearchOnce = true
    let holdFinancial = false
    let heldFinancial = 0
    let finishedFinancial = 0
    let releaseFinancial = () => {}
    const financialGate = new Promise<void>(resolve => { releaseFinancial = resolve })
    await context.route(/\/rest\/v1\/(?:fh_contacts|fh_clients|fh_leads|fh_quotes|fh_invoices)(?:\?|$)/, async route => {
      const url = new URL(route.request().url())
      const searching = [...url.searchParams.values()].some(value => value.includes('ilike'))
      if (searching && refuseSearchOnce && url.pathname.endsWith('/fh_contacts')) {
        refuseSearchOnce = false
        return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ message: 'Search refused' }) })
      }
      if (searching && currentRole !== 'owner') fieldReads.push(url)
      if (searching && holdFinancial && url.pathname.endsWith('/fh_quotes')) {
        heldFinancial += 1
        await financialGate
        await route.fallback()
        finishedFinancial += 1
      } else await route.fallback()
    })
    await page.goto(surface === 'phone' ? '/search' : '/schedule')
    if (surface === 'desktop') await page.getByRole('button', { name: 'Search everything', exact: true }).click()
    const search = surface === 'phone' ? page.locator('.fhsr') : page.getByRole('dialog', { name: 'Command palette' })
    const input = surface === 'phone' ? search.getByLabel('Search', { exact: true }) : search.getByRole('combobox')
    await input.fill('Slab')
    await search.getByRole('button', { name: 'Retry', exact: true }).press('Enter')
    await expect(input).toBeFocused()
    await expect(input).toHaveValue('Slab')
    const invoices = surface === 'phone' ? search.getByRole('heading', { name: 'Invoices', exact: true }) : search.getByRole('group', { name: 'Invoices', exact: true })
    await expect(invoices).toBeVisible()
    holdFinancial = true
    await input.fill('Slab revised')
    await expect.poll(() => heldFinancial).toBe(2)
    currentRole = 'crew'
    await page.evaluate(() => window.dispatchEvent(new Event('online')))
    const job = surface === 'phone' ? search.getByRole('button', { name: /Plumbing Bellevue/ }).first() : search.getByRole('option', { name: /Slab \+ trench.*Plumbing Bellevue/ })
    await expect(job).toBeVisible()
    await expect(invoices).toHaveCount(0)
    await expect(search).not.toContainText('$')
    expect(fieldReads.length).toBeGreaterThan(0)
    for (const url of fieldReads) {
      expect(url.pathname).toMatch(/\/fh_contacts$/)
      expect(url.searchParams.get('select')).not.toContain('amount')
      expect(url.searchParams.get('org_id')).toBe('eq.org-1')
    }
    releaseFinancial()
    await expect.poll(() => finishedFinancial).toBe(2)
    await expect(invoices).toHaveCount(0)
    await expect(search).not.toContainText('$')
    await expect(input).toHaveValue('Slab revised')
    await nothingRunsOffTheSide(page)
  })
}

test('estimate choices and communication filters stay accessible on narrow phones', async ({ context, page }) => {
  await signIn(context)
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/bid')
  const jobType = page.getByRole('combobox', { name: 'Job type Optional' })
  await jobType.selectOption('Concrete')
  await expect(jobType).toHaveValue('Concrete')
  await jobType.selectOption('')
  await expect(jobType).toHaveValue('')
  const margin = page.getByRole('slider', { name: 'Target margin' })
  await margin.press('ArrowRight')
  await expect(margin).toHaveAttribute('aria-valuetext', '26%')
  const trade = page.getByRole('button', { name: 'Concrete', exact: true })
  await trade.click()
  await expect(trade).toHaveAttribute('aria-pressed', 'true')
  for (const control of [trade, margin]) {
    expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  }
  await nothingRunsOffTheSide(page)
  await page.goto('/compose')
  for (const name of ['SMS channel', 'Email channel', 'Voicemail channel']) {
    const channel = page.getByRole('button', { name, exact: true })
    // Animated ancestors can report 43.99998 for a 44 CSS pixel target.
    expect((await channel.boundingBox())!.height).toBeGreaterThanOrEqual(43.99)
  }
  await nothingRunsOffTheSide(page)
  await page.goto('/partners')
  await page.getByRole('button', { name: /^Pending/ }).click()
  await expect(page.getByRole('button', { name: /^Pending/ })).toHaveAttribute('aria-pressed', 'true')
  await nothingRunsOffTheSide(page)
})

test('expanded job forms keep labels, controls and cancellation within phone reach', async ({ context, page }) => {
  await signIn(context, { tables: { fh_selections: [selectionFixture] } })
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/jobs/c-job1?tab=selections')
  await page.getByRole('button', { name: '+ New selection', exact: true }).click()
  await page.getByLabel('Selection title', { exact: true }).fill('Kitchen finish')
  await page.getByRole('button', { name: 'Add option', exact: true }).click()
  const option = page.getByRole('group', { name: 'Option 2', exact: true })
  await option.getByLabel('Option label', { exact: true }).fill('Slate finish')
  await option.getByLabel('Price ($)', { exact: true }).fill('12.75')
  await expect(option.getByLabel('Option label', { exact: true })).toHaveValue('Slate finish')
  await nothingRunsOffTheSide(page)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: '+ New selection', exact: true })).toBeFocused()
  await expect(page.getByText('$7.25', { exact: true })).toBeVisible()

  await page.goto('/jobs/c-job1?tab=logs')
  await page.getByRole('button', { name: '+ New log', exact: true }).click()
  await page.getByLabel('Site summary', { exact: true }).fill('Site access prepared for tomorrow.')
  await page.getByLabel('Hours worked (optional)', { exact: true }).fill('7.5')
  await expect(page.getByLabel('Site summary', { exact: true })).toHaveValue('Site access prepared for tomorrow.')
  await nothingRunsOffTheSide(page)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: '+ New log', exact: true })).toBeFocused()

  await page.goto('/jobs/c-job1?tab=materials')
  await page.getByRole('button', { name: 'Bulk add', exact: true }).click()
  await page.getByLabel('Materials to add, one per line').fill('4 of 2x4 studs')
  expect((await page.getByRole('button', { name: 'Close', exact: true }).boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await nothingRunsOffTheSide(page)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Bulk add', exact: true })).toBeFocused()

  await page.goto('/jobs/c-job1?tab=change_orders')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByRole('button', { name: 'Approved', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Approved', exact: true })).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByLabel('Approved by', { exact: true })).toBeVisible()
  await nothingRunsOffTheSide(page)
})

test('selection edits preserve entered work on refusal and report success only after one confirmed save', async ({ context, page }) => {
  await signIn(context, { tables: { fh_selections: [selectionFixture] } })
  let refuse = true
  const changes: Record<string, unknown>[] = []
  await context.route(/\/rest\/v1\/fh_selections(?:\?|$)/, async route => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    changes.push(route.request().postDataJSON())
    await route.fulfill({ status: refuse ? 403 : 200, contentType: 'application/json', body: JSON.stringify(refuse ? { message: 'Selection update refused' } : { id: selectionFixture.id }) })
  })
  await page.goto('/jobs/c-job1?tab=selections')
  await page.getByRole('button', { name: 'Edit selection', exact: true }).click()
  await page.getByLabel('Selection title', { exact: true }).fill('Updated bathroom finish')
  await page.getByRole('group', { name: 'Option 1', exact: true }).getByLabel('Price ($)', { exact: true }).fill('9.50')
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText("Couldn't update", { exact: true })).toBeVisible()
  await expect(page.getByRole('alert').filter({ hasText: 'Changes could not be saved.' })).toBeFocused()
  await expect(page.getByLabel('Selection title', { exact: true })).toHaveValue('Updated bathroom finish')
  await expect(page.getByText('Selection updated', { exact: true })).toHaveCount(0)
  expect(changes).toHaveLength(1)
  expect(changes[0]).toMatchObject({ title: 'Updated bathroom finish', options: [{ id: 'option-ui', price: 9.5 }] })
  refuse = false
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await expect(page.getByText('Selection updated', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Selection title', { exact: true })).toHaveCount(0)
  expect(changes).toHaveLength(2)
})

// These are UI checks against controlled records, not real account validation.
test('Today keeps its date and sync status below the sticky header', async ({ context, page }) => {
  // Keep this layout fixture clear of the five-calendar-day billing cutoff.
  // The shared mock subtracts 24-hour days, which crosses that cutoff when
  // Chicago leaves daylight saving time and a calendar day lasts 25 hours.
  await page.clock.setFixedTime(new Date('2026-11-01T18:00:00Z'))
  await signIn(context, { tables: { fh_contacts: [{
    id: 'job-ready-to-bill', user_id: 'qa-user-1', org_id: 'org-1', client_id: 'cl-1',
    name: 'Ready customer', stage: 'invoice', amount: 1500,
    created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z',
  }] } })
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
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeFocused()
  await expect(page.getByRole('button', { name: 'New task', exact: true })).toBeInViewport()
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

test('task completion and deletion keep focus and Undo restores the same task', async ({ context, page }) => {
  await signIn(context)
  let task = { id: 'task-undo', text: 'Confirm site access', job_id: 'c-job1', assigned_to: null, user_id: 'qa-user-1', due_at: null, done: false, completed_at: null as string | null, created_at: new Date().toISOString() }
  const changes: Record<string, unknown>[] = []
  let deleted = false
  let deletedTask: typeof task | null = null
  await context.route(/\/rest\/v1\/fh_job_todos(?:\?|$)/, async route => {
    if (route.request().method() === 'PATCH') {
      const values = route.request().postDataJSON()
      changes.push(values)
      task = { ...task, ...values }
      await route.fulfill({ json: [{ id: task.id }] })
    } else if (route.request().method() === 'DELETE') {
      deleted = true
      expect(route.request().headers().prefer).toContain('return=representation')
      // PostgREST returns the deleted row. Use a server value that differs
      // from the displayed row to prove Undo restores the confirmed snapshot.
      deletedTask = { ...task, created_at: '2026-10-01T12:00:00Z' }
      await route.fulfill({ json: [deletedTask] })
    } else if (route.request().method() === 'POST') {
      task = route.request().postDataJSON()
      deleted = false
      await route.fulfill({ json: [task] })
    } else await route.fulfill({ json: task.done || deleted ? [] : [task] })
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
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeFocused()
  await page.getByRole('button', { name: 'Delete Confirm site access', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeFocused()
  await expect(page.getByText('Task deleted', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Complete Confirm site access' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
  await expect(page.getByRole('heading', { name: 'Tasks', exact: true })).toBeFocused()
  expect(task).toMatchObject({ id: 'task-undo', text: 'Confirm site access', done: false })
  expect(task).toEqual(deletedTask)
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
