// Quote-builder QA — the money-making surface. Drives the quote
// workspace (/quotes/:id?tab=quote) and the lead -> Start quote flow
// on phone + desktop, both themes, via the hermetic mock.
import { chromium } from 'playwright-core'
import { installMock, session } from './qa-mock.mjs'
import { mkdirSync } from 'node:fs'

const scratch = process.env.QA_OUT || './qa-shots'
mkdirSync(scratch, { recursive: true })
const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })

async function leg(viewport, tag, themeName) {
  const ctx = await browser.newContext({ viewport, serviceWorkers: 'block' })
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
  const snap = async (name) => {
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${scratch}/qt-${tag}-${themeName}-${name}.png`, fullPage: false })
    console.log(`captured qt-${tag}-${themeName}-${name}`)
  }

  // 1. Quote workspace on the quote-stage contact
  await page.goto('http://localhost:5199/quotes/c-quote?tab=quote'); await ready()
  await snap('builder')

  // 2. Add-line-item state (open whatever the builder's add control is)
  await page.locator('button:has-text("Add")').first().click().catch(() => {})
  await snap('builder-add')

  // 3. Quotes board
  await page.goto('http://localhost:5199/quotes'); await ready()
  await snap('board')

  await ctx.close()
}

for (const [tag, viewport] of [['phone', { width: 390, height: 844 }], ['desktop', { width: 1440, height: 900 }]]) {
  for (const theme of (process.env.QA_THEMES || 'light,dark').split(',')) {
    await leg(viewport, tag, theme)
  }
}
await browser.close()
console.log('quote qa complete')
