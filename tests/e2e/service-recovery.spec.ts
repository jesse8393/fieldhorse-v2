import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

test('manual writing works before AI and a failed replacement keeps the whole draft', async ({ context, page }) => {
  await signIn(context)
  let aiCalls = 0
  await page.route('**/api/claude', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) })
      return
    }
    aiCalls += 1
    await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'missing_api_key', message: 'ANTHROPIC_API_KEY is missing' }) })
  })
  await page.goto('/compose')
  await page.getByRole('button', { name: 'Write manually', exact: true }).click()
  expect(aiCalls).toBe(0)
  const message = page.getByRole('textbox', { name: 'Message', exact: true })
  await message.fill('Please leave the west gate unlocked.\nWe arrive at 8:30.')
  await page.getByRole('button', { name: 'Generate draft', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('AI drafting is not ready for this workspace')
  await expect(message).toHaveValue('Please leave the west gate unlocked.\nWe arrive at 8:30.')
  await expect(message).toBeEditable()
  await expect(page.getByText(/ANTHROPIC_API_KEY|Netlify/)).toHaveCount(0)
  await expect(page.getByText('Open SMS hands this message to your messaging app.', { exact: false })).toBeVisible()
  expect(aiCalls).toBe(1)
})

test('failed team setup stays distinct from an empty roster and retry recovers', async ({ context, page }) => {
  await signIn(context)
  let ready = false
  await page.route('**/api/org-members-list', async (route) => {
    await route.fulfill({
      status: ready ? 200 : 500,
      contentType: 'application/json',
      body: JSON.stringify(ready ? {
        ok: true, org_id: 'org-1', caller_role: 'owner', invites: [],
        members: [{ id: 'm-1', user_id: 'qa-user-1', role: 'owner', joined_at: '2026-10-01T15:00:00Z', name: 'Workspace owner', email: 'owner@example.com', is_self: true }]
      } : { error: 'server_misconfigured' })
    })
  })
  await page.goto('/team')
  await expect(page.getByRole('alert')).toContainText('Team access needs workspace setup')
  await expect(page.getByText('No active members yet.', { exact: true })).toHaveCount(0)
  await expect(page.getByText('No outstanding invitations', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Active members · 0', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('main')).toHaveCount(1)
  ready = true
  await page.getByRole('button', { name: /Retry/ }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByText('Workspace owner', { exact: false })).toBeVisible()
  await expect(page.getByText('Active members · 1', { exact: true })).toBeVisible()
})

test('empty inbox gives a useful next step and does not ask for an absent conversation', async ({ context, page }) => {
  await signIn(context, { tables: { fh_org_settings: [{ engine_enabled: true }] } })
  await page.goto('/inbox')
  await expect(page.getByText('No conversations yet.', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'Write a message', exact: true })).toHaveAttribute('href', '/compose')
  await expect(page.getByText('Choose a conversation to read it.', { exact: true })).toHaveCount(0)
  await expect(page.getByText(/Messages sent from your phone or email app stay in those apps/)).toBeVisible()
})

test('a lead without a phone opens the existing customer editor to repair it', async ({ context, page }) => {
  await signIn(context, { tables: {
    fh_leads: [{
      id: 'l-no-phone', user_id: 'qa-user-1', client_id: 'cl-1', status: 'open', title: 'Gate repair',
      created_at: '2026-10-01T15:00:00Z', updated_at: '2026-10-01T15:00:00Z',
      fh_clients: { id: 'cl-1', name: 'Jeff Roy', phone: null, email: null, address: null }
    }]
  } })
  await page.goto('/leads/l-no-phone')
  await expect(page.getByRole('link', { name: 'Call', exact: true })).toHaveCount(0)
  await page.getByRole('link', { name: 'Add phone', exact: true }).click()
  await expect(page).toHaveURL(/\/clients\/cl-1\?edit=contact$/)
  await expect(page.getByLabel('Phone', { exact: true })).toBeEditable()
})

test('historical activity keeps the identity of a migrated quote', async ({ context, page }) => {
  await signIn(context, { tables: {
    fh_stage_transitions: [{ id: 'st-moved', user_id: 'qa-user-1', contact_id: 'c-moved', from_stage: null, to_stage: 'quote', transitioned_at: '2026-10-06T15:00:00Z' }],
    fh_payments: [], fh_change_orders: [], fh_invoices: [],
    fh_contacts: [{ id: 'c-moved', user_id: 'qa-user-1', org_id: 'org-1', name: 'Project customer', job_title: 'Building repaint', stage: 'moved_quote', updated_at: '2025-01-01T00:00:00Z' }]
  } })
  const contactLookups: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/rest/v1/fh_contacts?')) contactLookups.push(request.url())
  })
  await page.goto('/activity')
  const event = page.getByRole('link').filter({ hasText: 'New Quote' })
  await expect(event).toContainText('Project customer')
  await expect(event).toContainText('Building repaint')
  await expect(event).toHaveAttribute('href', '/jobs/c-moved')
  expect(contactLookups.some((url) => {
    const params = new URL(url).searchParams
    return params.get('id') === 'in.(c-moved)' && params.get('org_id') === 'eq.org-1' && !params.has('stage')
  })).toBe(true)
})
