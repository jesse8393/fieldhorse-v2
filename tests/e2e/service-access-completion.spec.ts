import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const owner = { id: 'm1', org_id: 'org-1', user_id: 'qa-user-1', role: 'owner', revoked_at: null, joined_at: '2026-01-01T00:00:00Z' }

test('verified limited roster stays read only and does not invent names or pay rates', async ({ context, page }) => {
  await signIn(context, { tables: { org_members: [owner, { ...owner, id: 'm2', user_id: 'crew-person-2', role: 'crew' }], org_invites: [] } })
  await page.route('**/api/org-members-list', route => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'server_misconfigured' }) }))
  await page.route('**/rest/v1/rpc/fh_can_read_org_members', route => route.fulfill({ status: 200, contentType: 'application/json', body: 'true' }))
  await page.goto('/team')
  await expect(page.getByRole('status').filter({ hasText: 'Limited roster.' })).toBeVisible()
  await expect(page.getByText('Active members · 2', { exact: true })).toBeVisible()
  await expect(page.getByText('Team member crew-per', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Invite teammate' })).toHaveCount(0)
  await expect(page.getByRole('spinbutton')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Remove member' })).toHaveCount(0)
})

test('a failed invitation lookup keeps the healthy roster and shows unavailable invitations', async ({ context, page }) => {
  await signIn(context)
  await page.route('**/api/org-members-list', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, org_id: 'org-1', caller_role: 'owner', members: [{ ...owner, name: 'Workspace owner', is_self: true }], invites: [], invites_available: false }) }))
  await page.goto('/team')
  await expect(page.getByText('Workspace owner', { exact: false })).toBeVisible()
  await expect(page.getByText('Invitation status could not be checked', { exact: true })).toBeVisible()
  await expect(page.getByText('No outstanding invitations', { exact: true })).toHaveCount(0)
})

test('partner permission details match actual customer and pricing access', async ({ context, page }) => {
  await signIn(context, { tables: { fh_job_partners: [{
    id: 'share-1', job_id: 'c-job1', invited_by_user_id: 'qa-user-1', partner_user_id: 'partner-1',
    partner_name: 'Trusted partner', partner_email: 'partner@example.com', partner_role: 'Foreman',
    status: 'accepted', invited_at: '2026-10-01T00:00:00Z', deleted_by_partner_at: null,
    fh_contacts: { id: 'c-job1', name: 'Shared project', job_title: 'Scope', stage: 'job' }
  }] } })
  await page.goto('/partners')
  await page.getByText('View shared permissions', { exact: true }).click()
  await expect(page.getByText(/linked customer details, schedule/)).toBeVisible()
  await expect(page.getByText(/pricing, invoices, payments/)).toBeVisible()
  await expect(page.getByText(/use the same sharing permissions/)).toBeVisible()
  await expect(page.getByText(/A job invitation does not grant access to those quotes/)).toBeVisible()
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2)
  expect(overflow).toBe(false)
})

test('inviting a partner explains financial access before the send action', async ({ context, page }) => {
  await signIn(context)
  await page.goto('/jobs/c-job1/partner')
  await expect(page.getByText(/Sharing includes this job, its linked customer details and job pricing/)).toBeVisible()
  await expect(page.getByText(/use the same sharing permissions/)).toBeVisible()
  await expect(page.getByText(/not your client info or pricing/)).toHaveCount(0)
})
