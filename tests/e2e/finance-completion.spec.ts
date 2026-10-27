import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'
const client = { id: 'client-finance', user_id: 'qa-user-1', org_id: 'org-1', name: 'Rosa Ledger', email: 'rosa@example.test', phone: '6155550101' }
const job = { id: 'job-finance', client_id: client.id, user_id: 'qa-user-1', org_id: 'org-1', name: client.name, email: client.email, job_title: 'Foundation repair', stage: 'job', amount: 10000, created_at: '2026-08-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', fh_clients: client }
const invoice = (id: string, amount: number, status = 'sent') => ({ id, user_id: 'qa-user-1', org_id: 'org-1', client_id: client.id, contact_id: job.id, title: 'Progress draw', description: 'Foundation installment', amount, status, sequence_number: 1, due_at: '2026-10-20', created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-01T12:00:00Z', fh_clients: client })
const tables = { fh_clients: [client], fh_contacts: [job], fh_invoices: [invoice('issued-finance', 3000), invoice('draft-finance', 2000, 'draft')], fh_payments: [], fh_change_orders: [], fh_quotes: [], fh_leads: [], fh_schedule: [{ id: 'visit-finance', org_id: 'org-1', user_id: 'qa-user-1', contact_id: job.id, start_at: '2026-10-26T15:00:00Z', end_at: '2026-10-26T17:00:00Z', title: 'Foundation visit' }] }
test.beforeEach(async ({ context, page }) => { await signIn(context, { tables }); await page.clock.setFixedTime(new Date('2026-10-27T17:00:00Z')) })

test('billing categories open exact contributing records', async ({ page }, testInfo) => {
  await page.goto('/invoices')
  const summary = page.getByRole('region', { name: 'Billing reconciliation', exact: true })
  await expect(summary.getByRole('link', { name: 'Issued invoice balance $3,000.00' })).toBeVisible()
  await summary.getByRole('link', { name: 'Issued invoice balance $3,000.00' }).click()
  const ledger = page.getByRole('region', { name: 'Contributing billing records' })
  await expect(ledger.getByText('$3,000.00', { exact: true }).first()).toBeVisible()
  await expect(ledger.locator('a[href="/invoices/issued-finance"]')).toBeVisible()
  await expect(ledger.locator('a[href="/invoices/draft-finance"]')).toHaveCount(0)
  await ledger.getByRole('link', { name: 'Draft invoice value', exact: true }).click()
  await expect(ledger.locator('a[href="/invoices/draft-finance"]')).toBeVisible()
  await expect(ledger.getByText('$2,000.00', { exact: true }).first()).toBeVisible()
  await nothingRunsOffTheSide(page, 'billing reconciliation')
  await page.screenshot({ path: testInfo.outputPath('reconciliation.png'), fullPage: true })
  await page.getByRole('button', { name: 'Back to Money', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Money', exact: true, level: 1 })).toBeVisible()
})

test('new job invoice prefills unreserved scope instead of unpaid contract', async ({ page }) => {
  await page.goto(`/invoices/new?job=${job.id}`)
  await expect(page.getByRole('textbox', { name: 'Amount', exact: true })).toHaveValue('5000')
})

test('customer overview reconciles schedule and invoice blockers', async ({ page }) => {
  await page.goto(`/clients/${client.id}`)
  const review = page.getByRole('region', { name: 'Delivery and billing review' })
  await expect(review.getByText('Schedule needs review', { exact: true })).toBeVisible()
  await expect(review.getByText('Overdue invoice', { exact: true })).toBeVisible()
  await expect(review.locator('a[href="/invoices/issued-finance"]')).toContainText('$3,000.00')
  await nothingRunsOffTheSide(page, 'customer blocker review')
})

test('similar drafts require review before a send begins', async ({ context, page }) => {
  await signIn(context, { tables: { ...tables, fh_invoices: [invoice('draft-finance', 2000, 'draft'), invoice('similar-finance', 2000, 'draft')] } })
  let sends = 0
  await page.route('**/api/send-invoice', async route => { sends++; await route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' }) })
  await page.goto('/invoices/draft-finance')
  const review = page.getByRole('region', { name: 'Billing review' })
  await expect(review.locator('a[href="/invoices/similar-finance"]')).toBeVisible()
  await page.getByRole('button', { name: 'Send', exact: true }).click()
  await expect(page.getByText('Review similar invoices', { exact: true })).toBeVisible()
  expect(sends).toBe(0)
  await expect(review.getByRole('checkbox')).not.toBeChecked()
})
