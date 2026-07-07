// Hermetic QA for the shadcn power wave: TanStack tables on desktop
// Invoices + Clients (sortable heads, filter box, live CSV button)
// and the Work follow-up calendar popover on phone.
//
//   QA_OUT=/path node scripts/qa-shadcn.mjs
//
// Same rules as the tour: app on :5199 pointed at qa-mock.supabase.co;
// everything intercepted; zero real network.
import { chromium } from 'playwright-core'
import { installMock, session } from './qa-mock.mjs'

const scratch = process.env.QA_OUT || './qa-shots'
import { mkdirSync } from 'node:fs'
mkdirSync(scratch, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function snap(page, name) {
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${scratch}/${name}.png`, fullPage: false })
  console.log(`captured ${name}`)
}

async function makeCtx(theme, viewport) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' })
  await installMock(ctx)
  await ctx.addInitScript(([s, t]) => {
    try {
      localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(s))
      localStorage.setItem('fh:theme', t)
      localStorage.setItem('fh-onboarding-seen', '1')
    } catch {}
  }, [session, theme])
  return ctx
}

const ready = (page) => page.waitForFunction(() => document.body.innerText.trim().length > 40, { timeout: 20000 }).catch(() => {})

for (const theme of (process.env.QA_THEMES || 'dark,light').split(',')) {
  // ── Desktop: invoices table — sorted default, then filter typed ──
  {
    const ctx = await makeCtx(theme, { width: 1440, height: 900 })
    const page = await ctx.newPage()
    await page.goto('http://localhost:5199/invoices'); await ready(page)
    await snap(page, `tbl-${theme}-invoices`)
    // click Age header → re-sort ascending
    await page.click('button.fh-build-sort:has-text("Age")').catch(() => {})
    await page.fill('input[aria-label="Filter invoices"]', 'har').catch(() => {})
    await snap(page, `tbl-${theme}-invoices-filtered`)
    await ctx.close()
  }
  // ── Desktop: clients table sorted by open value ──
  {
    const ctx = await makeCtx(theme, { width: 1440, height: 900 })
    const page = await ctx.newPage()
    await page.goto('http://localhost:5199/clients'); await ready(page)
    await page.click('button.fh-build-sort:has-text("Open value")').catch(() => {})
    await snap(page, `tbl-${theme}-clients`)
    await ctx.close()
  }
  // ── Phone: Work ⋯ menu → Pick a date… → calendar popover ──
  {
    const ctx = await makeCtx(theme, { width: 390, height: 844 })
    const page = await ctx.newPage()
    await page.goto('http://localhost:5199/work'); await ready(page)
    // Wait for the deal list itself — body-text readiness fires before
    // the cards mount, and a click on nothing "succeeds" silently.
    await page.waitForSelector('[aria-label="Deal actions"]', { timeout: 15000 }).catch(() => {})
    await page.locator('[aria-label="Deal actions"]').first().click().catch(() => {})
    await snap(page, `cal-${theme}-menu`)
    await page.click('[role="menuitem"]:has-text("Pick a date")').catch(() => {})
    await page.waitForSelector('[data-slot="popover-content"]', { timeout: 5000 }).catch(() => {})
    await snap(page, `cal-${theme}-picker`)
    await ctx.close()
  }
}

await browser.close()
console.log('shadcn QA complete')
