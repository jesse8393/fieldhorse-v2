// Reports (/analytics) in Phase 9, Task 15: the funnel and the pipeline
// counts read leads from fh_leads and quotes from fh_quotes (D55), and a
// quote counts as won once it has been made into a job (fh_quotes.job_id,
// D54). The money numbers still read the jobs.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { USER } from '../../scripts/qa-mock.mjs'

const NOW = Date.now()
const DAY = 86400000
const iso = (ms: number) => new Date(ms).toISOString()
const CLIENT = { id: 'cl-1', name: 'Jeff Roy' }

function lead(partial: Record<string, unknown>) {
  return {
    user_id: USER.id, client_id: 'cl-1', title: 'Driveway', status: 'open', job_type: null, notes: null,
    follow_up_on: null, last_contact: null, quote_id: null, created_at: iso(NOW - 20 * DAY), updated_at: iso(NOW - 20 * DAY),
    fh_clients: CLIENT, ...partial
  }
}
function quote(partial: Record<string, unknown>) {
  return {
    user_id: USER.id, client_id: 'cl-1', title: 'Patio', status: 'sent', amount: 5000, job_id: null, lead_id: null,
    sent_at: iso(NOW - 15 * DAY), created_at: iso(NOW - 20 * DAY), updated_at: iso(NOW - 15 * DAY),
    scope_text: null, terms_text: null, exclusions_text: null, job_type: null, expires_at: null,
    change_request_note: null, change_requested_at: null, approved_version_id: null, fh_clients: CLIENT, ...partial
  }
}

// Three leads made this quarter, one of them lost; four quotes, one made
// into the job c-job1 ten days ago, one lost, two still out.
const LEADS = [
  lead({ id: 'l-a' }),
  lead({ id: 'l-b', status: 'quoted' }),
  lead({ id: 'l-c', status: 'lost', updated_at: iso(NOW - 5 * DAY) })
]
const QUOTES = [
  quote({ id: 'q-a', status: 'approved', job_id: 'c-job1', updated_at: iso(NOW - 10 * DAY) }),
  quote({ id: 'q-b', status: 'lost', updated_at: iso(NOW - 8 * DAY) }),
  quote({ id: 'q-c', status: 'sent' }),
  quote({ id: 'q-d', status: 'viewed' })
]

async function open(page: Page) {
  await page.goto('/analytics', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
}

test.describe('Reports read the four records', () => {
  test('the funnel counts leads, quotes, a quote that became a job and the lost ones', async ({ context, page }, testInfo) => {
    await signIn(context, { tables: { fh_leads: LEADS, fh_quotes: QUOTES } })
    await open(page)
    const phone = !testInfo.project.name.startsWith('desktop')

    if (phone) {
      await expect(page.getByText('Owner KPIs', { exact: true })).toBeVisible({ timeout: 30_000 })
      // Active leads counts the open ones (the phone has no Quotes out tile).
      await expect(page.getByText('Active leads', { exact: true }).locator('..')).toContainText('1')
      const funnel = page.locator('.v3-section').filter({ hasText: 'Funnel · last 90 days' })
      await expect(funnel).toBeVisible()
      await expect(funnel.getByText('No pipeline movement in the last 90 days yet.')).toHaveCount(0)
      await expect(funnel.locator('[data-funnel="New leads"]')).toContainText('3')
      await expect(funnel.locator('[data-funnel="Quoted"]')).toContainText('4')
      await expect(funnel.locator('[data-funnel="Won"]')).toContainText('1')
      await expect(funnel.locator('[data-funnel="Lost"]')).toContainText('2')
      await expect(funnel.getByText('33% win rate')).toBeVisible()
      return
    }

    const screen = page.locator('[data-build-screen="SnowAnalyticsBuild"]')
    await expect(screen).toBeVisible({ timeout: 30_000 })
    await expect(screen.locator('.fh-build-kpi-strip')).toContainText('Active leads')
    await expect(screen.locator('.fh-build-kpi-cell').filter({ hasText: 'Active leads' })).toContainText('1')
    await expect(screen.locator('.fh-build-kpi-cell').filter({ hasText: 'Quotes out' })).toContainText('2')
    await expect(screen.locator('.fh-build-rail-card').filter({ hasText: 'Active leads' }).locator('strong')).toHaveText('1')
  })
})
