import { expect, test, type BrowserContext } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const customer = { id: 'customer-selected', org_id: 'org-1', user_id: 'qa-user-1', name: 'Jordan Reed', phone: '6155550102', email: 'jordan@example.test', address: '12 Test Lane', created_at: '2026-10-01T12:00:00Z' }

async function jobWrites(context: BrowserContext) {
  const writes: Record<string, unknown>[] = []
  await context.route(/\/rest\/v1\/fh_contacts(\?|$)/, async route => {
    if (route.request().method() === 'POST') {
      writes.push(route.request().postDataJSON())
      return route.fulfill({ json: { id: 'c-job1' } })
    }
    return route.fallback()
  })
  return writes
}

test('a typed existing customer keeps saved contact details on its new job', async ({ context, page }) => {
  await signIn(context, { tables: { fh_clients: [customer] } })
  const writes = await jobWrites(context)
  await page.goto('/jobs/new')
  await page.getByLabel('Client', { exact: true }).fill(customer.name)
  await page.getByLabel('Title', { exact: true }).fill('Garage repairs')
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ client_id: customer.id, name: customer.name, phone: customer.phone, email: customer.email, address: customer.address })
})

test('a restored draft keeps its chosen customer when two names match', async ({ context, page }) => {
  await signIn(context, { tables: { fh_clients: [
    { ...customer, id: 'customer-other', phone: '6155550199', created_at: '2026-10-31T12:00:00Z' }, customer,
  ] } })
  const writes = await jobWrites(context)
  await page.goto('/jobs/new')
  await page.getByLabel('Client', { exact: true }).fill('Jordan')
  await page.getByRole('option', { name: /Jordan Reed 6155550102/ }).click()
  await page.getByLabel('Title', { exact: true }).fill('Saved customer identity')
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('fh:draft:job') || '{}').form?.title)).toBe('Saved customer identity')
  await page.reload()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Saved customer identity')
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await expect.poll(() => writes.length).toBe(1)
  expect(writes[0]).toMatchObject({ client_id: customer.id, phone: customer.phone, email: customer.email })
})

test('revoked customer access keeps a job draft instead of saving stale identity', async ({ context, page }) => {
  await signIn(context, { tables: { fh_clients: [customer] } })
  const writes = await jobWrites(context)
  await page.goto('/jobs/new')
  await page.getByLabel('Client', { exact: true }).fill('Jordan')
  await page.getByRole('option', { name: /Jordan Reed/ }).click()
  await page.getByLabel('Title', { exact: true }).fill('Retain this draft')
  await context.route(/\/rest\/v1\/fh_clients(\?|$)/, route => route.fulfill({ json: [] }))
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('Choose a client again.')
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Retain this draft')
  expect(writes).toHaveLength(0)
})

const task = { id: 'task-persistence', org_id: 'org-1', user_id: 'qa-user-1', job_id: 'c-job1', text: 'Confirm site access', done: false, completed_at: null, created_at: '2026-10-31T12:00:00Z' }

test('sign out clears customer creation drafts from a shared device', async ({ context, page }) => {
  await signIn(context)
  await page.goto('/workspace')
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true }).last()
  await expect(signOut).toBeVisible()
  await page.evaluate(() => {
    for (const kind of ['job', 'lead', 'quote']) {
      localStorage.setItem(`fh:draft:${kind}`, JSON.stringify({ form: { client: 'Private draft customer' }, savedAt: Date.now() }))
    }
  })
  await signOut.click()
  await expect(page).toHaveURL(/\/login$/)
  expect(await page.evaluate(() => ['job', 'lead', 'quote'].map(kind => localStorage.getItem(`fh:draft:${kind}`)))).toEqual([null, null, null])
})

test('Undo after reconnect survives a delayed completion and reload', async ({ context, page }) => {
  await signIn(context)
  let saved = { ...task }
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  let started = false
  const updates: boolean[] = []
  await context.route(/\/rest\/v1\/fh_job_todos(\?|$)/, async route => {
    if (route.request().method() === 'PATCH') {
      const patch = route.request().postDataJSON()
      if (patch.done) { started = true; await gate }
      saved = { ...saved, ...patch }
      updates.push(saved.done)
    }
    return route.fulfill({ json: [saved] })
  })
  await page.goto('/jobs/c-job1')
  const complete = page.getByRole('checkbox', { name: 'Complete Confirm site access', exact: true })
  await expect(complete).toBeVisible()
  await context.setOffline(true)
  await complete.click()
  await expect(page.getByText('Task saved offline', { exact: true })).toBeVisible()
  await context.setOffline(false)
  await expect.poll(() => started).toBe(true)
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  release()
  await expect.poll(() => updates).toEqual([true, false])
  await page.reload()
  await expect(complete).toBeVisible()
  expect(saved.done).toBe(false)
})

test('a queued completion refused by row permissions restores the open task', async ({ context, page }) => {
  await signIn(context)
  await context.route(/\/rest\/v1\/fh_job_todos(\?|$)/, route => route.fulfill({ json: route.request().method() === 'PATCH' ? [] : [task] }))
  await page.goto('/jobs/c-job1')
  const complete = page.getByRole('checkbox', { name: 'Complete Confirm site access', exact: true })
  await expect(complete).toBeVisible()
  await context.setOffline(true)
  await complete.click()
  await expect(page.getByText('Task saved offline', { exact: true })).toBeVisible()
  await context.setOffline(false)
  await expect(page.getByText("1 offline item didn't sync", { exact: true })).toBeVisible()
  await expect(complete).toBeVisible()
  await expect(page.getByText('1 offline item synced', { exact: true })).toHaveCount(0)
})

test('task creation without native randomUUID submits a valid persistent row', async ({ context, page }) => {
  await signIn(context)
  await context.addInitScript(() => Object.defineProperty(crypto, 'randomUUID', { value: undefined, configurable: true }))
  const rows: Record<string, unknown>[] = []
  await context.route(/\/rest\/v1\/fh_job_todos(\?|$)/, async route => {
    if (route.request().method() === 'POST') {
      const row = route.request().postDataJSON()
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(row.id)) {
        return route.fulfill({ status: 400, json: { code: '22P02', message: 'invalid input syntax for type uuid' } })
      }
      rows.push({ done: false, ...row })
    }
    return route.fulfill({ json: rows })
  })
  await page.goto('/jobs/c-job1?tab=tasks')
  await page.getByRole('textbox', { name: 'Task description', exact: true }).fill('Valid task identity')
  await page.getByRole('button', { name: 'Add task', exact: true }).click()
  await expect(page.getByText('Valid task identity', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByText('Valid task identity', { exact: true })).toBeVisible()
  expect(rows).toHaveLength(1)
})
