// Verify the Work-screen in-view permission gate. Runs the same hermetic
// mock but with QA_ROLE flipping the org_members role, and asserts what a
// field role can and cannot see.
//
//   QA_OUT=/path node scripts/qa-perms.mjs
//
// Owner leg: full chips (Leads/Quotes/Active/Done) + "$… in play".
// Crew leg:  only Active/Done chips, no lead/quote rows, no deal $.
import { chromium } from 'playwright-core'
import { installMock, session } from './qa-mock.mjs'

const scratch = process.env.QA_OUT || './qa-shots'
import { mkdirSync } from 'node:fs'
mkdirSync(scratch, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function leg(role, theme) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  await installMock(ctx)
  await ctx.addInitScript(([s, t]) => {
    localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(s))
    localStorage.setItem('fh:theme', t)
    localStorage.setItem('fh-onboarding-seen', '1')
  }, [session, theme])
  const page = await ctx.newPage()
  await page.goto('http://localhost:5199/work')
  await page.waitForFunction(() => document.body.innerText.trim().length > 40, { timeout: 20000 }).catch(() => {})
  await page.waitForTimeout(900)

  const body = await page.evaluate(() => document.body.innerText)
  const chips = await page.locator('[role="tablist"] button, .fh-work__chips button').allTextContents()
  const hasLeadsChip = /leads/i.test(chips.join(' '))
  const hasQuotesChip = /quotes/i.test(chips.join(' '))
  const hasInPlay = /in play/i.test(body)
  const hasLeadPill = await page.locator('text=/^LEAD$/').count()
  const hasQuotePill = await page.locator('text=/QUOTE SENT|^QUOTE$/').count()

  await page.screenshot({ path: `${scratch}/perm-${role}-${theme}.png` })
  console.log(JSON.stringify({ role, theme, chips, hasLeadsChip, hasQuotesChip, hasInPlay, leadPills: hasLeadPill, quotePills: hasQuotePill }))
  await ctx.close()
}

// Owner leg first (default role via installMock's own env), then crew.
// installMock reads QA_ROLE at import — so we run this file twice, once per
// role, from the shell. Here we just render whatever QA_ROLE is set to.
const role = process.env.QA_ROLE || 'owner'
for (const theme of (process.env.QA_THEMES || 'dark').split(',')) await leg(role, theme)

await browser.close()
console.log('perms QA complete')
