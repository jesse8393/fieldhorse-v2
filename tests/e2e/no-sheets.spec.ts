// No pop ups anywhere (PHASE9_PLAN Task 14, SPEC D57). As the owner, every
// authenticated route in the app is visited on both the phone and the
// desktop, and every route button is tapped once, each from a fresh load.
// Shared shell buttons get their own case on each project instead of the
// same sidebar/header/dock actions being repeated on every route. Headers
// inside main remain route coverage, including their contextual actions.
// Nothing with role="dialog" or [data-vaul-drawer] may
// ever mount. The desktop command palette is the one exception D57 allows,
// so its trigger (Search everything, Cmd or Ctrl K) is the one button left
// alone, as is Sign out, which would end the session the rest of the
// buttons need.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

// Every route under the app shell, with the mock's ids where a route takes one.
const ROUTES = [
  '/', '/work', '/new', '/leads/new', '/quotes/new', '/jobs/new', '/invoices/new', '/clients/new',
  '/leads', '/leads/l-lead1', '/quotes', '/quotes/q-quote', '/quotes/q-quote/terms', '/quotes/q-quote/preview', '/quotes/q-quote/approve',
  '/jobs/c-job1', '/jobs/c-done', '/jobs/c-lost',
  '/jobs/c-job1/payment', '/jobs/c-job1/partner', '/jobs/c-job1/complete', '/jobs/c-job1/more', '/jobs/c-job1/follow-up',
  '/clients', '/clients/cl-1', '/clients/cl-1/statement', '/clients/merge',
  '/notes', '/schedule', '/schedule/new', '/schedule/s1/edit', '/activity', '/bid', '/compose', '/analytics', '/miles/new',
  '/import', '/settings', '/pour-window', '/subs', '/subs/new', '/partners', '/team', '/team/invite', '/crew', '/timesheets', '/tasks',
  '/sub-portal', '/sub-portal/profile',
  '/invoices', '/invoices?panel=statements', '/invoices?panel=balances', '/invoices/inv1', '/invoices/inv1/payment', '/invoices/inv1/edit', '/invoices/inv1/remind',
  '/inbox', '/notifications',
  '/capture', '/workspace', '/search'
]

const POPUP = '[role="dialog"], [data-vaul-drawer]'

// The buttons left alone: the palette (D57's one exception) and Sign out.
const SKIP = /^(Search everything|Search or jump to|Sign out)/

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
  // Let the route chunk and its first read land before the buttons are counted.
  await page.waitForTimeout(600)
}

type Target = { name: string; nth: number }
type Scope = 'route' | 'shell'

// The partition is exhaustive: every enabled visible button is either
// inside the routed main landmark or outside it in the shared shell.
function candidates(page: Page, scope: Scope) {
  return scope === 'route'
    ? page.locator('#fh-main button:visible:not([disabled])')
    : page.locator('button:visible:not([disabled]):not(#fh-main button)')
}

/** Visible, enabled buttons in one scope, by accessible name and order. */
async function buttonsOn(page: Page, scope: Scope): Promise<Target[]> {
  const names = await candidates(page, scope).evaluateAll((els) => els.map((el) => {
    const b = el as HTMLButtonElement
    const labelled = b.getAttribute('aria-labelledby')
    const byRef = labelled ? labelled.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' ').trim() : ''
    const name = (b.getAttribute('aria-label') || byRef || b.textContent || '').replace(/\s+/g, ' ').trim()
    const keys = b.getAttribute('aria-keyshortcuts') || ''
    return { name, palette: /\+K$/i.test(keys) }
  }))
  const seen = new Map<string, number>()
  const out: Target[] = []
  for (const { name, palette } of names) {
    const nth = seen.get(name) ?? 0
    seen.set(name, nth + 1)
    if (!name || palette || SKIP.test(name)) continue
    out.push({ name, nth })
  }
  return out
}

async function exerciseButtons(page: Page, scope: Scope, route: string, prepare: () => Promise<void>) {
  await prepare()
  await expect(page.locator(POPUP)).toHaveCount(0)
  const targets = await buttonsOn(page, scope)
  for (const target of targets) {
    // A fresh load per button: a previous navigation or mutation has no
    // say over the next. Duplicate names resolve within the same scope
    // and the same visible/enabled set used to discover them.
    await prepare()
    const button = candidates(page, scope)
      .and(page.getByRole('button', { name: target.name, exact: true }))
      .nth(target.nth)
    if (!(await button.isVisible().catch(() => false))) continue
    await button.click({ timeout: 5000 }).catch(() => {})
    await page.waitForTimeout(500)
    await expect(page.locator(POPUP), `${route}: "${target.name}" opened a pop up`).toHaveCount(0)
  }
}

async function openShell(page: Page) {
  await open(page, '/')
  // The sidebar can start collapsed on Today. Include the controls that
  // other routes reveal automatically, and verify that opening the group
  // is itself inline. Fresh loads restore this precondition even after
  // the toggle's own case closes it. The phone has no sidebar group.
  const more = page.getByRole('button', { name: 'Team and office', exact: true })
  if (await more.isVisible().catch(() => false)) {
    if (await more.getAttribute('aria-expanded') === 'false') await more.click()
  }
  await expect(page.locator(POPUP), 'Opening shared navigation mounted a pop up').toHaveCount(0)
}

test.describe('no sheet, drawer or dialog mounts anywhere', () => {
  test.describe.configure({ mode: 'parallel' })

  test('shared sidebar, header and dock controls', async ({ context, page }) => {
    test.setTimeout(420_000)
    await signIn(context)
    await exerciseButtons(page, 'shell', 'Shared shell', () => openShell(page))
  })

  for (const route of ROUTES) {
    test(route, async ({ context, page }) => {
      test.setTimeout(420_000)
      await signIn(context)
      await exerciseButtons(page, 'route', route, () => open(page, route))
    })
  }
})
