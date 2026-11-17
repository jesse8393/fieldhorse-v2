import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { installMock, session } from '../../scripts/qa-mock.mjs'

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

test('a lost job response followed by reload and retry creates only one job', async ({ context, page }) => {
  await signIn(context, { tables: { fh_clients: [customer] } })
  const saved = new Map<string, Record<string, unknown>>()
  const submitted: string[] = []
  await context.route(/\/rest\/v1\/fh_contacts(\?|$)/, async route => {
    const request = route.request()
    if (request.method() === 'POST') {
      const row = request.postDataJSON()
      submitted.push(row.id)
      const id = row.id || `server-job-${submitted.length}`
      if (saved.has(id)) return route.fulfill({ status: 409, json: { code: '23505', message: 'duplicate key' } })
      saved.set(id, { created_at: new Date().toISOString(), ...row, id })
      // The database committed, but the browser never received its reply.
      if (submitted.length === 1) return route.abort('failed')
      return route.fulfill({ json: { id } })
    }
    const id = new URL(request.url()).searchParams.get('id')?.replace(/^eq\./, '')
    if (id && saved.has(id)) return route.fulfill({ json: [saved.get(id)] })
    return route.fallback()
  })
  await page.goto('/jobs/new')
  await page.getByLabel('Client', { exact: true }).fill(customer.name)
  await page.getByLabel('Title', { exact: true }).fill('Retry without duplication')
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  expect(saved.size).toBe(1)
  await page.reload()
  await expect(page.getByLabel('Title', { exact: true })).toHaveValue('Retry without duplication')
  await page.getByRole('button', { name: 'Save job', exact: true }).click()
  await expect(page).toHaveURL(new RegExp(`/jobs/${submitted[0]}$`))
  expect(submitted).toHaveLength(2)
  expect(submitted[0]).toMatch(/^[0-9a-f]{8}-/)
  expect(submitted[1]).toBe(submitted[0])
  expect(saved.size).toBe(1)
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
  await expect.poll(() => page.evaluate(() => ['job', 'lead', 'quote'].map(kind => localStorage.getItem(`fh:draft:${kind}`)))).toEqual([null, null, null])
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
  await expect(complete).toBeVisible()
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

// PERF-01: a repeat open must not wait on the network for who the person
// is. The last profile and workspace read on this device show at once,
// and the server's answer replaces them when it lands.
const WORKSPACE = { id: 'org-1', name: 'Ridgeback Paving', slug: null, created_at: '2026-08-01T12:00:00Z' }

async function holdIdentityReads(context: BrowserContext) {
  const held: Array<() => void> = []
  let holding = true
  await context.route(/\/rest\/v1\/(profiles|org_members|organizations)(\?|$)/, route => {
    if (!holding) return route.fallback()
    return new Promise<void>(resolve => {
      held.push(() => { void route.fallback().then(resolve, resolve) })
    })
  })
  return () => {
    holding = false
    for (const release of held.splice(0)) release()
  }
}

test('a repeat open shows the saved profile and workspace while they reload', async ({ context, page }) => {
  await signIn(context, { tables: { organizations: [WORKSPACE] } })
  await page.goto('/')
  const menu = page.getByRole('button', { name: 'Open workspace menu', exact: true })
  await expect(menu).toHaveAttribute('title', 'Ridgeback Paving')
  // This device keeps the workspace once the first open's reads are in.
  await expect.poll(() => page.evaluate(() => Object.keys(localStorage)
    .some(key => (localStorage.getItem(key) || '').includes('Ridgeback Paving')))).toBe(true)
  const release = await holdIdentityReads(context)
  await page.reload()
  await expect(page.locator('#fh-main')).toBeVisible({ timeout: 5_000 })
  await expect(page.getByText('Loading workspace', { exact: true })).toHaveCount(0)
  await expect(menu).toHaveAttribute('title', 'Ridgeback Paving')
  release()
  await expect(menu).toHaveAttribute('title', 'Ridgeback Paving')
})

test('sign out forgets the saved profile and workspace', async ({ context, page }) => {
  await signIn(context, { tables: { organizations: [WORKSPACE] } })
  await page.goto('/workspace')
  await expect(page.getByRole('button', { name: 'Open workspace menu', exact: true })).toHaveAttribute('title', 'Ridgeback Paving')
  const signOut = page.getByRole('button', { name: 'Sign out', exact: true }).last()
  await signOut.click()
  await expect(page).toHaveURL(/\/login$/)
  const stored = await page.evaluate(() => Object.keys(localStorage).map(key => localStorage.getItem(key) || ''))
  expect(stored.filter(value => value.includes('Ridgeback Paving') || value.includes('Jesse Parker'))).toEqual([])
  // The next open has nothing saved to show, so it waits for the server.
  const release = await holdIdentityReads(context)
  await page.goto('/')
  await expect(page.getByText('Loading workspace', { exact: true })).toBeVisible()
  release()
  await expect(page.locator('#fh-main')).toBeVisible()
})

// DATA-11: a shared device. The first person is still signed in when a
// second person opens their own password reset link on it.
const USER_B = { id: 'qa-user-2', email: 'second@other.test', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-02-01T00:00:00Z' }
const TOKEN_B = 'qa.fake.second-token'

function savedCache(page: Page) {
  return page.evaluate(() => new Promise<string>((resolve) => {
    const open = indexedDB.open('keyval-store')
    open.onupgradeneeded = () => open.transaction?.abort()
    open.onerror = () => resolve('')
    open.onsuccess = () => {
      const db = open.result
      try {
        const read = db.transaction('keyval', 'readonly').objectStore('keyval').get('fh-query-cache')
        read.onsuccess = () => { db.close(); resolve(typeof read.result === 'string' ? read.result : '') }
        read.onerror = () => { db.close(); resolve('') }
      } catch {
        db.close()
        resolve('')
      }
    }
  }))
}

test("a second person's email link never opens on the first person's saved book", async ({ context, page }) => {
  await installMock(context, { supabaseHosts: ['qa-mock.supabase.co', 'pnmhblvslftdzfcdezbw.supabase.co'] })
  // The second person's own company loads; every other read of theirs
  // finds no signal, so a job on screen can only come from what the
  // device saved.
  const ownRows: Record<string, object[]> = {
    org_members: [{ id: 'm2', org_id: 'org-2', user_id: USER_B.id, role: 'owner', revoked_at: null, joined_at: '2026-02-01T00:00:00Z' }],
    organizations: [{ id: 'org-2', name: 'Other Company', slug: null }],
    profiles: [{ user_id: USER_B.id, full_name: 'Bea Other', company_name: 'Other Company', onboarded_at: '2026-02-01T00:00:00Z', preferences: {} }],
  }
  await context.route(/supabase\.co\//, async route => {
    const request = route.request()
    if (!(request.headers().authorization || '').includes(TOKEN_B)) return route.fallback()
    const url = new URL(request.url())
    if (url.pathname.includes('/auth/v1/user')) return route.fulfill({ json: USER_B })
    const rows = ownRows[url.pathname.split('/rest/v1/')[1] ?? '']
    if (!rows) return route.abort('internetdisconnected')
    if (request.method() === 'HEAD') return route.fulfill({ status: 200, headers: { 'content-range': '*/0' }, body: '' })
    if ((request.headers().accept || '').includes('vnd.pgrst.object')) return route.fulfill({ json: rows[0] })
    return route.fulfill({ json: rows })
  })
  // Signed in once, as the first person; later loads keep whoever is stored.
  await context.addInitScript((saved) => {
    if (localStorage.getItem('e2e:seeded')) return
    localStorage.setItem('e2e:seeded', '1')
    localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(saved))
    localStorage.setItem('sb-pnmhblvslftdzfcdezbw-auth-token', JSON.stringify(saved))
    localStorage.setItem('fh:theme-mode', 'day')
    localStorage.setItem('fh-onboarding-seen', '1')
  }, session)

  await page.goto('/jobs/c-job1')
  await expect(page.getByText('Plumbing Bellevue').first()).toBeVisible()
  await expect.poll(() => savedCache(page), { timeout: 15_000 }).toContain('Plumbing Bellevue')

  const expiresAt = Math.floor(Date.now() / 1000) + 86400
  await page.goto(`/reset-password#access_token=${TOKEN_B}&refresh_token=qa-refresh-b&expires_in=86400&expires_at=${expiresAt}&token_type=bearer&type=recovery`)
  await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('sb-qa-mock-auth-token') || 'null')?.user?.id)).toBe('qa-user-2')

  // The second person opens the first person's job from the shared history.
  await page.goto('/jobs/c-job1')
  const seen = await page.evaluate(async () => {
    const end = performance.now() + 4000
    while (performance.now() < end) {
      if (document.body.innerText.includes('Plumbing Bellevue')) return true
      await new Promise(resolve => requestAnimationFrame(resolve))
    }
    return false
  })
  expect(seen).toBe(false)
  expect(await savedCache(page)).not.toContain('Plumbing Bellevue')
})

// PERF-03: the member and partner counts only drive nav flags, so a first
// open settles the workspace once the membership and company rows are in
// and asks for its screen data without waiting on them.
test('a first open asks for its screen data while the member counts are still out', async ({ context, page }) => {
  await signIn(context)
  const held: Array<() => void> = []
  await context.route(/\/rest\/v1\/(org_members|fh_job_partners)(\?|$)/, route => {
    if (route.request().method() !== 'HEAD') return route.fallback()
    return new Promise<void>(resolve => { held.push(() => { void route.fallback().then(resolve, resolve) }) })
  })
  const leadsRead = page.waitForRequest(/\/rest\/v1\/fh_leads(\?|$)/, { timeout: 8_000 })
  await page.goto('/jobs')
  await leadsRead
  expect(held.length).toBeGreaterThan(0)
  for (const release of held.splice(0)) release()
})
