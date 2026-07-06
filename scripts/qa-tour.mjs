// scripts/qa-tour.mjs — hermetic visual QA tour.
//
// Drives the REAL app in headless Chromium with the entire Supabase API
// mocked at the network layer: a fake session is seeded into
// localStorage and every request to the mock host is intercepted with
// demo-shaped rows. Zero real network, zero backend writes — safe to
// run anywhere, no credentials needed.
//
// Usage:
//   1. .env.local:  VITE_SUPABASE_URL=https://qa-mock.supabase.co
//                   VITE_SUPABASE_ANON_KEY=<any JWT-shaped string>
//   2. npm run dev -- --port 5199
//   3. node scripts/qa-tour.mjs          # full tour: phone+desktop x dark+light
//      QA_LEG=one node scripts/qa-tour.mjs   # quick single leg (phone/dark)
//
// Screenshots land in QA_OUT (default ./qa-shots). Notes:
//   - serviceWorkers: 'block' is load-bearing — the dev PWA service
//     worker otherwise swallows fetches BEFORE Playwright routing.
//   - org_members rows need revoked_at: null or membership filters
//     them out.
import { chromium } from 'playwright-core'
import { installMock, session } from './qa-mock.mjs'
const scratch = process.env.QA_OUT || './qa-shots'
import { mkdirSync } from 'node:fs'
mkdirSync(scratch, { recursive: true })

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--no-sandbox'] })


async function tour(viewport, themeName, tag) {
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
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))

  const routes = [
    ['home', '/'], ['work', '/work'], ['work-leads', '/work?stage=leads'],
    ['lead-detail', '/leads/c-lead1'], ['work-active', '/work?stage=active'],
    ['job-detail', '/jobs/c-job1'], ['invoices', '/invoices'],
    ['schedule', '/schedule'], ['settings', '/settings']
  ]
  for (const [name, path] of routes) {
    await page.goto(`http://localhost:5199${path}`)
    await page.waitForFunction(() => document.body.innerText.trim().length > 40, { timeout: 20000 }).catch(() => {})
    await page.waitForTimeout(900)
    await page.screenshot({ path: `${scratch}/qa-${tag}-${themeName}-${name}.png`, fullPage: false })
  }
  if (errors.length) console.log(`[${tag}/${themeName}] pageerrors:`, errors.slice(0, 4))
  await ctx.close()
}

const LEGS = process.env.QA_LEG === 'one'
  ? [['phone', { width: 390, height: 844 }, ['dark']]]
  : process.env.QA_LEG === 'desktop'
  ? [['desktop', { width: 1440, height: 900 }, ['dark', 'light']]]
  : [['phone', { width: 390, height: 844 }, ['dark', 'light']], ['desktop', { width: 1440, height: 900 }, ['dark', 'light']]]
for (const [tag, viewport, themes] of LEGS) {
  for (const theme of themes) {
    await tour(viewport, theme, tag)
    console.log(`${tag}/${theme} done`)
  }
}
await browser.close()
console.log('tour complete')
