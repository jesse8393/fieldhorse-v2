import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { restResponse } from '../../scripts/qa-mock.mjs'

const job = { id: 'message-job', user_id: 'qa-user-1', org_id: 'org-1', client_id: 'message-client', name: 'History Customer', email: 'customer@example.com', phone: '6155550100', job_title: 'West gate', address: '100 Main St', stage: 'job', updated_at: '2026-10-01T10:00:00Z' }
const note = { id: 'history-note', user_id: 'qa-user-1', org_id: 'org-1', contact_id: job.id, category: 'email', created_at: '2026-10-01T12:00:00Z', parsed: { communication: { version: 1, channel: 'email', status: 'sent', subject: 'Gate access', body: 'Please open the west gate.', to: job.email } } }
const reply = { id: 'history-reply', org_id: 'org-1', contact_id: null, client_id: job.client_id, conversation_id: 'customer-thread', direction: 'inbound', channel: 'sms', status: 'received', body: 'Gate will be unlocked.', created_at: '2026-10-02T12:00:00Z' }

test('job message context combines recorded email and connected replies within company scope', async ({ context, page }) => {
  await signIn(context, { tables: { fh_contacts: [job], fh_notes: [note, { ...note, id: 'foreign-note', org_id: 'other-company', parsed: { communication: { ...note.parsed.communication, body: 'Foreign private note' } } }], fh_messages: [reply, { ...reply, id: 'foreign-message', org_id: 'other-company', body: 'Foreign private reply' }] } })
  const queries: URL[] = []
  page.on('request', (request) => { if (/\/rest\/v1\/fh_(notes|messages)\?/.test(request.url())) queries.push(new URL(request.url())) })
  await page.goto(`/compose?contact=${job.id}&channel=email`)
  await expect(page.getByRole('combobox', { name: 'Contact', exact: true })).toHaveValue('History Customer')
  const history = page.getByRole('region', { name: 'Communication history' })
  await expect(history.getByText('Please open the west gate.', { exact: true })).toBeVisible()
  await expect(history.getByText('Gate will be unlocked.', { exact: true })).toBeVisible()
  await expect(page.getByText('Foreign private note', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Foreign private reply', { exact: true })).toHaveCount(0)
  await expect(history.getByRole('link', { name: 'Open conversation' })).toHaveAttribute('href', '/inbox/customer-thread')
  expect(queries.filter((url) => url.pathname.endsWith('/fh_messages')).every((url) => url.searchParams.get('org_id') === 'eq.org-1' && url.searchParams.get('client_id') === `eq.${job.client_id}`)).toBe(true)
  await history.getByLabel('Search history').fill('west gate')
  await expect(history.getByText('Please open the west gate.', { exact: true })).toBeVisible()
  await expect(history.getByText('Gate will be unlocked.', { exact: true })).toHaveCount(0)
})

test('opening SMS does not record delivery and explicit confirmation preserves the handed off text', async ({ context, page }) => {
  await signIn(context, { tables: { fh_contacts: [job], fh_notes: [], fh_messages: [] } })
  const saved: any[] = []
  await page.route('**/rest/v1/fh_notes*', async (route) => {
    if (route.request().method() === 'POST') {
      saved.push({ id: 'confirmed-handoff', created_at: '2026-10-03T12:00:00Z', ...route.request().postDataJSON() })
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(saved.at(-1)) })
    } else await route.fulfill(restResponse(route.request().url(), { headers: route.request().headers(), tables: { fh_notes: saved } }))
  })
  await page.goto(`/compose?contact=${job.id}`)
  await page.getByRole('button', { name: 'Write manually', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'Message', exact: true })
  await draft.fill('We arrive at 8:30.')
  await page.getByRole('button', { name: 'Open SMS', exact: true }).click()
  await expect(page.getByText('Nothing has been marked sent here.', { exact: false })).toBeVisible()
  expect(saved).toHaveLength(0)
  await draft.fill('Edited after handoff')
  await page.getByRole('button', { name: 'I sent it, record communication', exact: true }).click()
  await expect.poll(() => saved.length).toBe(1)
  expect(saved[0]).toMatchObject({ contact_id: job.id, org_id: 'org-1', parsed: { communication: { body: 'We arrive at 8:30.', status: 'reported_sent', channel: 'sms' } } })
  await expect(page.getByRole('region', { name: 'Communication history' }).getByText('sms · Reported sent', { exact: false })).toBeVisible()
  await expect(draft).toHaveValue('Edited after handoff')
})

test('unavailable direct email keeps the draft and offers an explicit mail app handoff', async ({ context, page }) => {
  await signIn(context, { tables: { fh_contacts: [job], fh_notes: [], fh_messages: [] } })
  await page.route('**/api/send-message', (route) => route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'sender_not_configured' }) }))
  await page.goto(`/compose?contact=${job.id}&channel=email`)
  await page.getByRole('button', { name: 'Write manually', exact: true }).click()
  const draft = page.getByRole('textbox', { name: 'Message', exact: true })
  await draft.fill('Keep this whole message.')
  await page.getByRole('button', { name: 'Send email', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Open email app', exact: true })).toBeVisible()
  await expect(draft).toHaveValue('Keep this whole message.')
  await expect(page.getByRole('button', { name: 'I sent it, record communication', exact: true })).toHaveCount(0)
})

test('recorded history remains available with connected messaging off and exposes partial errors', async ({ context, page }) => {
  await signIn(context, { tables: { fh_org_settings: [{ org_id: 'org-1', engine_enabled: false }], fh_notes: [note], fh_messages: [] } })
  await page.route('**/rest/v1/fh_messages*', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Temporary failure' }) }))
  await page.goto('/inbox?view=history')
  await expect(page.getByRole('region', { name: 'Communication history' }).getByText('Please open the west gate.', { exact: true })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Connected messages could not load', { timeout: 20000 })
  await expect(page.getByRole('link', { name: 'New message', exact: true })).toHaveAttribute('href', '/compose')
})

test('unconfigured AI opens manual writing without a generation attempt', async ({ context, page }) => {
  await signIn(context)
  let generated = 0
  let configured = false
  await page.route('**/api/claude', (route) => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured }) })
    generated++
    return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' })
  })
  await page.goto('/compose')
  await expect(page.getByRole('button', { name: 'AI drafting unavailable', exact: true })).toBeDisabled()
  const draft = page.getByRole('textbox', { name: 'Message', exact: true })
  await draft.fill('Manual writing stays available.')
  expect(generated).toBe(0)
  configured = true
  await page.getByRole('button', { name: 'Check AI availability', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Generate draft', exact: true })).toBeEnabled()
  await expect(draft).toHaveValue('Manual writing stays available.')
  expect(generated).toBe(0)
})
