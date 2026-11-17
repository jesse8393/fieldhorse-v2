import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'
import { bigReady, ink, openBig, openBigPortal, textSize } from './helpers/bigText.ts'

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

// Large text and zoom (sign "the app falls apart at a bigger text size"):
// long names and six or seven figure amounts on a Pixel 7 and a 360 px
// phone, at the usual text size, with the phone's text at 150 percent, and
// zoomed to 200 percent where a screen is used that way.
test.describe('large text and zoom', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone sizes')

  // big-text-1: the Fieldhorse customer quote drew $184,580.00 as
  // "$184,580.0" over a lone "0" on an ordinary phone.
  for (const percent of [100, 150]) {
    test(`the customer quote total stays whole on one line inside its card, text at ${percent} percent`, async ({ context, page }) => {
      await textSize(context, percent)
      for (const token of ['six', 'fh'] as const) {
        await openBigPortal(context, page, token)
        const total = page.locator('.fhp-total__amount')
        await expect(total).toBeVisible({ timeout: 20_000 })
        for (const width of [412, 390, 360, 320]) {
          await page.setViewportSize({ width, height: 800 })
          await page.waitForTimeout(150)
          const drawn = await ink(total)
          const card = await page.locator('.fhp-total').evaluate((el) => {
            const r = el.getBoundingClientRect()
            const s = getComputedStyle(el)
            return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight) }
          })
          const at = `${await total.textContent()} at ${width} px: ${JSON.stringify({ drawn, card })}`
          expect(drawn.lines, at).toBe(1)
          expect(drawn.left, at).toBeGreaterThanOrEqual(card.left - 0.5)
          expect(drawn.right, at).toBeLessThanOrEqual(card.right + 0.5)
        }
      }
    })
  }

  // big-text-2: the classic customer quote kept its totals box 300 px wide
  // even on a narrower page, so Subtotal and Total lost their first letters
  // off the left edge.
  for (const percent of [100, 150]) {
    test(`the classic customer quote keeps Subtotal and Total on the page, text at ${percent} percent`, async ({ context, page }) => {
      await textSize(context, percent)
      await openBigPortal(context, page, 'classic')
      const subtotal = page.locator('td', { hasText: /^Subtotal$/ })
      await expect(subtotal).toBeAttached({ timeout: 20_000 })
      const total = page.locator('span', { hasText: /^Total$/ }).last()
      const figures = [subtotal.locator('xpath=following-sibling::td[1]'), total.locator('xpath=following-sibling::span[1]')]
      for (const width of [412, 360, 340, 320, 206, 180]) {
        await page.setViewportSize({ width, height: 800 })
        await page.waitForTimeout(150)
        const sheet = await subtotal.evaluate((el) => {
          const r = (el.closest('article') as HTMLElement).getBoundingClientRect()
          return { left: r.left, right: r.right }
        })
        for (const label of [subtotal, total, ...figures]) {
          const drawn = await ink(label)
          const at = `${await label.textContent()} at ${width} px: ${JSON.stringify({ drawn, sheet })}`
          expect(drawn.left, at).toBeGreaterThanOrEqual(sheet.left - 0.5)
          expect(drawn.right, at).toBeLessThanOrEqual(sheet.right + 0.5)
        }
      }
    })
  }

  // big-text-3: a 44 px tap target made with negative margins let a client
  // name or a job title on two lines spill over the line next to it.
  for (const percent of [100, 150]) {
    test(`a two line client name or job title keeps clear of the line next to it, text at ${percent} percent`, async ({ context, page }) => {
      await textSize(context, percent)
      await openBig(context, page, '/quotes/q-big')
      for (const width of [412, 390, 360, 320]) {
        await page.setViewportSize({ width, height: 800 })
        await page.waitForTimeout(150)
        const name = await ink(page.locator('a.fhqt-client__link'))
        const number = await ink(page.locator('.fhqt-client__number'))
        const title = await ink(page.locator('h1.fhqt-title'))
        const at = `quote at ${width} px: ${JSON.stringify({ title, name, number })}`
        expect(name.top, at).toBeGreaterThanOrEqual(title.bottom - 1)
        if (number.top > name.top + 1) expect(number.top, at).toBeGreaterThanOrEqual(name.bottom - 1)
        expect(await page.locator('a.fhqt-client__link').evaluate((el) => el.getBoundingClientRect().height), at).toBeGreaterThanOrEqual(44)
      }
      await page.goto('/invoices/i-big')
      await bigReady(page)
      for (const width of [412, 390, 360, 320]) {
        await page.setViewportSize({ width, height: 800 })
        await page.waitForTimeout(150)
        const who = await ink(page.locator('.fhinv-hero__who'))
        const job = await ink(page.locator('a.fhinv-hero__job'))
        const amount = await ink(page.locator('.fhinv-hero__amount'))
        const at = `invoice at ${width} px: ${JSON.stringify({ who, job, amount })}`
        expect(job.top, at).toBeGreaterThanOrEqual(who.bottom - 1)
        expect(amount.top, at).toBeGreaterThanOrEqual(job.bottom - 1)
        expect(await page.locator('a.fhinv-hero__job').evaluate((el) => el.getBoundingClientRect().height), at).toBeGreaterThanOrEqual(44)
      }
    })
  }

  // big-text-4: zoom or a bigger text size pushed Schedule, Money and the
  // account button off the screen, and ran the dock labels together.
  for (const percent of [100, 150, 200]) {
    test(`every dock tab and header button stays on screen, text at ${percent} percent`, async ({ context, page }) => {
      await textSize(context, percent)
      await openBig(context, page, '/jobs')
      const widths = percent === 100 ? [412, 360, 320, 280, 240, 206, 180] : [412, 390, 360]
      for (const width of widths) {
        await page.setViewportSize({ width, height: 700 })
        await page.waitForTimeout(250)
        const shell = await page.evaluate(() => {
          const vw = document.documentElement.clientWidth
          const box = (el: Element) => { const r = el.getBoundingClientRect(); return { left: Math.round(r.left), right: Math.round(r.right), width: Math.round(r.width) } }
          const tabs = [...document.querySelectorAll('.fhs-dock__item')].map((el) => ({ name: el.textContent?.trim(), ...box(el) }))
          const header = [...document.querySelectorAll('.fhs-header__menu, .fhs-header .fhs-icon-btn, .fh-glass-wordmark')]
            .filter((el) => getComputedStyle(el).display !== 'none')
            .map((el) => ({ name: el.getAttribute('aria-label') || el.className, ...box(el) }))
          const labels = [...document.querySelectorAll('.fhs-dock__label')]
            .map((el) => ({ name: el.textContent, ...box(el) }))
            .filter((l) => l.width > 1)
          // Closer than 6 px, two labels read as one ("MoneySchedule").
          const touching = labels.flatMap((a, i) => labels.slice(i + 1).filter((b) => Math.min(a.right, b.right) - Math.max(a.left, b.left) > -6).map((b) => `${a.name} meets ${b.name}`))
          return { vw, tabs, header, coin: box(document.querySelector('.fhs-dock__coin')!), touching }
        })
        const at = `${width} px: ${JSON.stringify(shell)}`
        for (const control of [...shell.tabs, ...shell.header, shell.coin]) {
          expect(control.left, at).toBeGreaterThanOrEqual(0)
          expect(control.right, at).toBeLessThanOrEqual(shell.vw)
        }
        for (const tab of shell.tabs) expect(tab.width, at).toBeGreaterThanOrEqual(24)
        expect(shell.touching, at).toEqual([])
        for (const name of ['Today', 'Jobs', 'Money', 'Schedule']) {
          await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link', { name, exact: true }), at).toBeVisible()
        }
      }
    })
  }

  // big-text-5: the main action on a screen was cut to a few letters
  // ("Mark comp…", "Send for appro…", "M") once zoom or bigger text left it
  // less room than its label.
  for (const percent of [100, 150, 200]) {
    test(`main action buttons keep every word of their label, text at ${percent} percent`, async ({ context, page }) => {
      await textSize(context, percent)
      const widths = percent === 100 ? [412, 360, 280, 240, 206, 180] : [412, 360]
      const screens = [
        { path: '/jobs/c-big', label: 'Mark complete' },
        { path: '/quotes/q-big', label: 'Send for approval' },
        { path: '/invoices/i-big', label: 'Collect payment' },
        { path: '/', label: 'Open job' }
      ]
      await openBig(context, page, '/jobs/c-big')
      for (const screen of screens) {
        if (screen.path !== '/jobs/c-big') {
          await page.goto(screen.path)
          await bigReady(page)
        }
        const button = page.locator('.fhc-btn', { hasText: screen.label }).first()
        for (const width of widths) {
          await page.setViewportSize({ width, height: 700 })
          await page.waitForTimeout(200)
          const shown = await button.evaluate((el) => {
            const text = el.querySelector('.fhc-btn__text') as HTMLElement
            const node = [...text.childNodes].find((n) => n.nodeType === 3)!
            const split: string[] = []
            for (const m of (node.textContent || '').matchAll(/\S+/g)) {
              const range = document.createRange()
              range.setStart(node, m.index!)
              range.setEnd(node, m.index! + m[0].length)
              if (new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size > 1) split.push(m[0])
            }
            const r = el.getBoundingClientRect()
            const t = text.getBoundingClientRect()
            const cut = text.scrollWidth > text.clientWidth + 1 || t.top < r.top - 0.5 || t.bottom > r.bottom + 0.5
            return { cut, split, left: r.left, right: r.right, window: document.documentElement.clientWidth }
          })
          const at = `${screen.label} at ${width} px: ${JSON.stringify(shown)}`
          expect(shown.cut, at).toBe(false)
          expect(shown.split, at).toEqual([])
          expect(shown.left, at).toBeGreaterThanOrEqual(0)
          expect(shown.right, at).toBeLessThanOrEqual(shown.window)
        }
      }
    })
  }

  // big-text-7: the quote total sat beside "Total" at a fixed 30 px and ran
  // off the right edge (the cents gone) with larger text or zoom.
  for (const percent of [100, 130, 150]) {
    test(`the quote total stays whole inside its tray, text at ${percent} percent`, async ({ context, page }) => {
      await textSize(context, percent)
      await openBig(context, page, '/quotes/q-big')
      const amount = page.locator('.fhqt-total__amount')
      const widths = percent === 100 ? [412, 360, 280, 206, 180] : [412, 360]
      for (const width of widths) {
        await page.setViewportSize({ width, height: 800 })
        await page.waitForTimeout(200)
        const drawn = await ink(amount)
        const label = await ink(page.locator('.fhqt-total__label'))
        const tray = await page.locator('.fhqt-total').evaluate((el) => {
          const r = el.getBoundingClientRect()
          const s = getComputedStyle(el)
          return { left: r.left + parseFloat(s.paddingLeft), right: r.right - parseFloat(s.paddingRight) }
        })
        const at = `${await amount.textContent()} at ${width} px: ${JSON.stringify({ drawn, label, tray })}`
        expect(drawn.lines, at).toBe(1)
        expect(drawn.left, at).toBeGreaterThanOrEqual(tray.left - 0.5)
        expect(drawn.right, at).toBeLessThanOrEqual(tray.right + 0.5)
        expect(label.left, at).toBeGreaterThanOrEqual(tray.left - 0.5)
      }
    })
  }
})

// big-text-3 on a desktop window at 200 percent zoom (640 px wide).
test('a two line job title keeps clear of the client name on a zoomed desktop invoice', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name.startsWith('mobile'), 'Desktop window')
  await page.setViewportSize({ width: 640, height: 450 })
  await openBig(context, page, '/invoices/i-big')
  const who = await ink(page.locator('.fhinv-hero__who'))
  const job = await ink(page.locator('a.fhinv-hero__job'))
  expect(job.top, JSON.stringify({ who, job })).toBeGreaterThanOrEqual(who.bottom - 1)
})
