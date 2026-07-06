// Hermetic interaction-state QA — extends scripts/qa-tour.mjs's mock
// to drive the app's SHEETS / DRAWERS / OVERLAYS and screenshot each
// open state. These surfaces never appear in route-level screenshots,
// so they were the last visually-unverified corner of daylight mode.
//
//   QA_OUT=/path node scripts/qa-interact.mjs
//
// Same rules as the tour: app must run on :5199 pointed at
// qa-mock.supabase.co; everything is intercepted; zero real network.
import { chromium } from 'playwright-core'
import { installMock, session } from './qa-mock.mjs'

const scratch = process.env.QA_OUT || './qa-shots'
import { mkdirSync } from 'node:fs'
mkdirSync(scratch, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function snap(page, name, theme) {
  await page.waitForTimeout(700)
  await page.screenshot({ path: `${scratch}/ix-${theme}-${name}.png`, fullPage: false })
  console.log(`captured ix-${theme}-${name}`)
}

async function leg(themeName) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  await installMock(ctx)
  await ctx.addInitScript(([s, theme]) => {
    try {
      localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(s))
      localStorage.setItem('fh:theme', theme)
      localStorage.setItem('fh-onboarding-seen', '1')
    } catch {}
  }, [session, themeName])
  const page = await ctx.newPage()
  const ready = () => page.waitForFunction(() => document.body.innerText.trim().length > 40, { timeout: 20000 }).catch(() => {})

  // 1. More drawer (bottom nav)
  await page.goto('http://localhost:5199/'); await ready()
  await page.click('button:has-text("More")').catch(() => {})
  await snap(page, 'more-drawer', themeName)

  // 2. Notifications inbox drawer
  await page.goto('http://localhost:5199/'); await ready()
  await page.click('[aria-label^="Notifications"]').catch(() => {})
  await snap(page, 'notifications', themeName)

  // 3. Mobile search overlay
  await page.goto('http://localhost:5199/'); await ready()
  await page.click('[aria-label="Search everything"]').catch(() => {})
  await snap(page, 'search-overlay', themeName)

  // 4. New Lead sheet (Leads FAB)
  await page.goto('http://localhost:5199/leads'); await ready()
  // Two buttons share this label (hidden desktop header + mobile FAB) —
  // click the visible one or the sheet never opens.
  await page.locator('[aria-label="New lead"]:visible').last().click().catch(() => {})
  await snap(page, 'new-lead-sheet', themeName)

  // 5. Lead card overflow menu (follow-up actions)
  await page.goto('http://localhost:5199/leads'); await ready()
  await page.click('[aria-label="More lead actions"]').catch(() => {})
  await snap(page, 'lead-menu', themeName)

  // 6. Log-payment confirm -> payment sheet (Money)
  await page.goto('http://localhost:5199/invoices'); await ready()
  await page.click('button:has-text("Mark Paid")').catch(() => {})
  await snap(page, 'pay-confirm', themeName)
  await page.click('button:has-text("Open sheet")').catch(() => {})
  await snap(page, 'payment-sheet', themeName)

  // 7. Job detail: schedule-event sheet
  await page.goto('http://localhost:5199/jobs/c-job1'); await ready()
  await page.click('button:has-text("Schedule event")').catch(() => {})
  await snap(page, 'event-sheet', themeName)

  await ctx.close()
}

for (const theme of ['light', 'dark']) await leg(theme)
await browser.close()
console.log('interact complete')
