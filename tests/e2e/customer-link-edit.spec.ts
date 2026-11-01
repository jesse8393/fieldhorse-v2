import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'

const original = { id: 'cl-1', org_id: 'org-1', user_id: 'qa-user-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@example.test', address: '12 Original Lane' }
const replacement = { ...original, id: 'cl-replacement', name: 'Jordan Reed', phone: '555-0182', email: 'jordan@example.test', address: '82 Replacement Lane' }
const job = {
  id: 'c-job1', org_id: 'org-1', user_id: 'qa-user-1', stage: 'job', client_id: original.id,
  name: 'Saved job contact', job_title: 'Customer link audit', amount: 33100,
  phone: '', email: '', address: 'Keep this site address', notes: '', scope_text: '', milestones: [],
  created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-31T12:00:00Z',
}

async function savedJob(context: BrowserContext) {
  let row = { ...job }
  const writes: Record<string, unknown>[] = []
  await context.route(/\/rest\/v1\/fh_contacts(?:\?|$)/, async route => {
    const request = route.request()
    if (request.method() === 'PATCH') {
      const change = request.postDataJSON()
      writes.push(change)
      row = { ...row, ...change }
    }
    return route.fulfill({ json: [row] })
  })
  return { writes }
}

async function edit(page: Page) {
  await page.goto('/jobs/c-job1?edit=1')
  const form = page.getByRole('form', { name: 'Edit job details', exact: true })
  await expect(form).toBeVisible()
  await expect(form.getByRole('heading', { name: 'Edit job details', exact: true })).toBeFocused()
  return form
}

test('customer replacement and unlink persist without overwriting typed job details', async ({ context, page }) => {
  await signIn(context, { tables: { fh_clients: [original, replacement] } })
  const { writes } = await savedJob(context)
  await page.setViewportSize({ width: 320, height: 844 })
  let form = await edit(page)
  for (const width of [320, 844]) {
    await page.setViewportSize({ width, height: 844 })
    expect(await form.getByLabel('Name', { exact: true }).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(16)
    await nothingRunsOffTheSide(page)
  }
  await page.setViewportSize({ width: 320, height: 844 })
  await form.getByLabel('Name', { exact: true }).fill('Keep this typed name')
  const unlink = form.getByRole('button', { name: 'Unlink client', exact: true })
  expect((await unlink.boundingBox())!.width).toBeGreaterThanOrEqual(44)
  expect((await unlink.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await unlink.press('Enter')
  const input = form.getByRole('combobox', { name: 'Linked client', exact: true })
  await expect(input).toBeFocused()
  await input.fill('Jordan')
  await form.getByRole('option', { name: /Jordan Reed 555-0182/ }).click()
  await expect(unlink).toBeFocused()
  await expect(form.getByLabel('Name', { exact: true })).toHaveValue('Keep this typed name')
  await expect(form.getByLabel('Address', { exact: true })).toHaveValue(job.address)
  await expect(form.getByLabel('Phone', { exact: true })).toHaveValue(replacement.phone)
  await form.getByLabel('Amount', { exact: true }).fill('33100.75')
  await nothingRunsOffTheSide(page)
  await form.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(form).toHaveCount(0)
  await expect(page.getByRole('heading', { level: 1, name: job.job_title })).toBeFocused()
  expect(writes).toHaveLength(1)
  expect(writes[0]).toMatchObject({ client_id: replacement.id, name: 'Keep this typed name', phone: replacement.phone, amount: 33100.75 })
  form = await edit(page)
  await expect(form.getByRole('group', { name: 'Linked client', exact: true })).toContainText(replacement.name)
  await expect(form.getByLabel('Amount', { exact: true })).toHaveValue('33100.75')
  await form.getByRole('button', { name: 'Unlink client', exact: true }).click()
  await form.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(form).toHaveCount(0)
  expect(writes[1]).toEqual({ client_id: null })
  form = await edit(page)
  await expect(form.getByRole('combobox', { name: 'Linked client', exact: true })).toBeVisible()
  await form.getByRole('button', { name: 'Cancel edit', exact: true }).click()
  await expect(page.getByRole('heading', { level: 1, name: job.job_title })).toBeFocused()
})

test('failed client reads never masquerade as an empty customer book or offer creation', async ({ context, page }) => {
  await signIn(context, { tables: { fh_clients: [original, replacement] } })
  let refuse = true
  const creates: unknown[] = []
  await context.route(/\/rest\/v1\/fh_clients(?:\?|$)/, async route => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST') creates.push(request.postDataJSON())
    if (refuse && !url.searchParams.has('id')) return route.fulfill({ status: 403, json: { message: 'Read refused' } })
    return route.fallback()
  })
  const form = await edit(page)
  await form.getByRole('button', { name: 'Unlink client', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText("Couldn't load recent clients.")
  await expect(form.getByText('No clients yet. Type a name to add one.')).toHaveCount(0)
  const input = form.getByRole('combobox', { name: 'Linked client', exact: true })
  await input.fill('Jordan')
  await expect(form.getByRole('alert')).toContainText("Couldn't search your clients.")
  await expect(form.getByRole('button', { name: /^Create “/ })).toHaveCount(0)
  await input.press('Enter')
  expect(creates).toHaveLength(0)
  refuse = false
  await form.getByRole('button', { name: 'Retry client search', exact: true }).press('Enter')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('Jordan')
  await expect(form.getByRole('option', { name: /Jordan Reed/ })).toBeVisible()
  await input.press('ArrowDown')
  await input.press('Enter')
  await expect(form.getByRole('group', { name: 'Linked client', exact: true })).toContainText(replacement.name)
})

test('a delayed original client response cannot undo manual replacement', async ({ context, page }) => {
  // Empty contact fields may hydrate; existing job contact details must stay.
  await signIn(context, { tables: { fh_contacts: [job], fh_clients: [original, replacement] } })
  let held = false
  let finished = false
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  await context.route(/\/rest\/v1\/fh_clients(?:\?|$)/, async route => {
    const url = new URL(route.request().url())
    if (url.searchParams.get('id') === `eq.${original.id}` && url.searchParams.get('select')?.includes('address')) {
      held = true
      await gate
      await route.fallback()
      finished = true
    } else await route.fallback()
  })
  const form = await edit(page)
  await expect.poll(() => held).toBe(true)
  await form.getByRole('button', { name: 'Unlink client', exact: true }).click()
  await form.getByRole('combobox', { name: 'Linked client', exact: true }).fill('Jordan')
  await form.getByRole('option', { name: /Jordan Reed/ }).click()
  release()
  await expect.poll(() => finished).toBe(true)
  await expect(form.getByRole('group', { name: 'Linked client', exact: true })).toContainText(replacement.name)
  await expect(form.getByLabel('Phone', { exact: true })).toHaveValue(replacement.phone)
})

test('exact matching searches beyond recent customers before offering a new record', async ({ context, page }) => {
  const oldCustomer = { ...replacement, last_activity_at: '2020-01-01T12:00:00Z' }
  const recent = Array.from({ length: 65 }, (_, i) => ({ ...original, id: `recent-${i}`, name: `Recent customer ${i}`, last_activity_at: '2026-10-30T12:00:00Z' }))
  await signIn(context, { tables: { fh_clients: [original, ...recent, oldCustomer] } })
  // The shared fixture implements order/limit but deliberately ignores LIKE
  // filters. Model their server response here, while retaining the real
  // recent-page limit and asserting a scoped whole-book lookup was issued.
  const searches: URL[] = []
  await context.route(/\/rest\/v1\/fh_clients(?:\?|$)/, route => {
    const url = new URL(route.request().url())
    if (url.searchParams.has('or') || url.searchParams.get('name')?.startsWith('ilike.')) {
      searches.push(url)
      expect(url.searchParams.get('org_id')).toBe('eq.org-1')
      expect(url.searchParams.get('or') || url.searchParams.get('name')).toContain(replacement.name)
      return route.fulfill({ json: [oldCustomer] })
    }
    return route.fallback()
  })
  const form = await edit(page)
  await form.getByRole('button', { name: 'Unlink client', exact: true }).click()
  const input = form.getByRole('combobox', { name: 'Linked client', exact: true })
  await input.fill(replacement.name)
  await expect(form.getByRole('option', { name: /Jordan Reed/ })).toBeVisible()
  await expect(form.getByRole('button', { name: /^Create “/ })).toHaveCount(0)
  await input.press('Enter')
  await expect(form.getByRole('group', { name: 'Linked client', exact: true })).toContainText(replacement.name)
  expect(searches.some(url => url.searchParams.get('name') === `ilike.${replacement.name}`)).toBe(true)
})

test('job save refusal retains edits and focus across retry without premature success', async ({ context, page }) => {
  await signIn(context, { tables: { fh_contacts: [job], fh_clients: [original] } })
  const { writes } = await savedJob(context)
  let attempts = 0
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  await context.route(/\/rest\/v1\/fh_contacts(?:\?|$)/, async route => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    attempts += 1
    if (attempts <= 2) return route.fulfill({ status: 403, json: { message: 'Update refused' } })
    if (attempts === 3) return route.fulfill({ json: [] })
    await gate
    return route.fallback()
  })
  await page.setViewportSize({ width: 320, height: 640 })
  const form = await edit(page)
  await form.getByLabel('Job title', { exact: true }).fill('Keep this work')
  for (let attempt = 0; attempt < 3; attempt++) {
    await form.getByRole('button', { name: 'Save changes', exact: true }).click()
    await expect(form.getByRole('alert')).toContainText('Your edits remain here.')
    await expect(form.getByRole('alert')).toBeFocused()
    await expect(form.getByLabel('Job title', { exact: true })).toHaveValue('Keep this work')
    await expect(page.getByText('Changes synced', { exact: true })).toHaveCount(0)
  }
  await form.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(form.getByRole('button', { name: 'Saving…', exact: true })).toBeDisabled()
  await expect(form.getByLabel('Job title', { exact: true })).toBeDisabled()
  await expect(form.getByRole('button', { name: 'Cancel edit', exact: true })).toBeDisabled()
  await expect.poll(() => attempts).toBe(4)
  release()
  await expect(form).toHaveCount(0)
  expect(writes).toEqual([{ job_title: 'Keep this work' }])
  await page.reload()
  await expect(page.getByRole('heading', { level: 1, name: 'Keep this work' })).toBeVisible()
})

test('native validation blocks malformed email while cents and Enter remain valid', async ({ context, page }) => {
  await signIn(context, { tables: { fh_clients: [original] } })
  const { writes } = await savedJob(context)
  const form = await edit(page)
  const email = form.getByLabel('Email', { exact: true })
  await email.fill('broken-address')
  await form.getByLabel('Amount', { exact: true }).fill('1200.75')
  await form.getByRole('button', { name: 'Save changes', exact: true }).click()
  await expect(email).toBeFocused()
  expect(writes).toHaveLength(0)
  await email.fill('correct@example.test')
  await email.press('Enter')
  await expect(form).toHaveCount(0)
  expect(writes).toEqual([{ email: 'correct@example.test', amount: 1200.75 }])
})

test('inline client creation exposes retryable failure and prevents duplicate activation', async ({ context, page }) => {
  await signIn(context, { tables: { fh_clients: [original] } })
  let attempts = 0
  let release = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  await context.route(/\/rest\/v1\/fh_clients(?:\?|$)/, async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    attempts += 1
    if (attempts === 1) return route.fulfill({ status: 403, json: { message: 'Create refused' } })
    await gate
    return route.fulfill({ json: { ...replacement, name: 'New customer' } })
  })
  const form = await edit(page)
  await form.getByRole('button', { name: 'Unlink client', exact: true }).click()
  const input = form.getByRole('combobox', { name: 'Linked client', exact: true })
  await input.fill('New customer')
  await form.getByRole('button', { name: 'Create “New customer”', exact: true }).click()
  await expect(form.getByRole('alert')).toContainText('Could not add this client.')
  await expect(form.getByRole('alert')).toBeFocused()
  await expect(input).toHaveValue('New customer')
  await input.click()
  await form.getByRole('button', { name: 'Create “New customer”', exact: true }).click()
  await expect(input).toBeDisabled()
  await expect.poll(() => attempts).toBe(2)
  release()
  await expect(form.getByRole('group', { name: 'Linked client', exact: true })).toContainText('New customer')
  await expect(form.getByRole('button', { name: 'Unlink client', exact: true })).toBeFocused()
  expect(attempts).toBe(2)
})

for (const role of ['crew', 'foreman']) {
  test(`${role} edits never offer the customer book or contract amount`, async ({ context, page }) => {
    await signIn(context, { role, tables: { fh_contacts: [job], fh_clients: [original] } })
    const form = await edit(page)
    await expect(form.getByRole('group', { name: 'Linked client', exact: true })).toHaveCount(0)
    await expect(form.getByRole('button', { name: /^Use client info/ })).toHaveCount(0)
    await expect(form.getByLabel('Amount', { exact: true })).toHaveCount(0)
    await expect(form.getByLabel('Job title', { exact: true })).toBeVisible()
  })
}

test('new job client suggestions recover without claiming an unread customer is new', async ({ context, page }) => {
  await signIn(context, { tables: { fh_clients: [replacement] } })
  let refuse = true
  await context.route(/\/rest\/v1\/fh_clients(?:\?|$)/, route => refuse
    ? route.fulfill({ status: 403, json: { message: 'Client suggestions refused' } })
    : route.fallback())
  await page.goto('/jobs/new')
  const input = page.getByRole('combobox', { name: 'Client', exact: true })
  await input.fill('Jordan')
  await expect(page.getByRole('alert').filter({ hasText: 'Client suggestions could not load.' })).toBeVisible()
  await expect(page.getByText('Checks for an existing client when saving. Adds a client only if no match exists.')).toBeVisible()
  refuse = false
  await page.getByRole('button', { name: 'Retry client suggestions', exact: true }).press('Enter')
  await expect(input).toBeFocused()
  await expect(input).toHaveValue('Jordan')
  await page.getByRole('option', { name: /Jordan Reed/ }).click()
  await expect(page.getByText('Saves to Jordan Reed.')).toBeVisible()
})
