#!/usr/bin/env node
// node scripts/check-live-site.mjs <site url>
//
// The daily live site check (.github/workflows/live-site-check.yml). Every
// Netlify function on the live site answered 500 for days because the
// Supabase server key was missing from the site settings, and nothing
// noticed. This loads the page and its app script, then asks three functions
// a harmless question whose healthy answer is known: a customer link, a
// partner invite and a team invite with a token that does not exist must
// each answer 404. A function that cannot reach the database answers 500
// instead, and a function missing from the deploy answers with the app page.
//
// It reads nothing private, sends no email, text or push, and needs no
// secrets. The only thing a check writes is the per address rate limit
// counter those functions keep.
//
// Prints one line per check. Exits 1 when any check fails, so the scheduled
// run fails and GitHub tells the repository owner.
import { pathToFileURL } from 'node:url'

// Never a real token: real ones are long random strings.
const PROBE_TOKEN = 'uptime-check-no-such-token'

const FUNCTION_CHECKS = [
  { name: 'Customer link function', method: 'GET', path: `/api/public-link?token=${PROBE_TOKEN}`, status: 404, error: 'not_found' },
  { name: 'Partner invite function', method: 'GET', path: `/api/partner-invite-info?token=${PROBE_TOKEN}`, status: 404, error: 'invite_not_found' },
  { name: 'Team invite function', method: 'POST', path: '/api/org-invite-info', body: { token: PROBE_TOKEN }, status: 404, error: 'invite_not_found' },
]

async function request(base, path, { method = 'GET', body, timeoutMs }) {
  const res = await fetch(new URL(path, base), {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  })
  return { status: res.status, type: res.headers.get('content-type') || '', text: await res.text() }
}

function reason(error) {
  return error?.name === 'TimeoutError' ? 'no answer in time' : `request failed: ${error?.cause?.code || error?.message || error}`
}

/**
 * Run every check against `baseUrl`. Never throws: each result is
 * { name, ok, detail }.
 */
export async function checkSite(baseUrl, { timeoutMs = 20_000 } = {}) {
  const results = []
  const pass = (name, detail) => results.push({ name, ok: true, detail })
  const fail = (name, detail) => results.push({ name, ok: false, detail })

  let script = null
  try {
    const page = await request(baseUrl, '/', { timeoutMs })
    script = page.text.match(/<script\b[^>]*\btype="module"[^>]*\bsrc="([^"]+)"/)?.[1]
      || page.text.match(/<script\b[^>]*\bsrc="([^"]+)"[^>]*\btype="module"/)?.[1]
      || null
    if (page.status !== 200) fail('Home page', `answered ${page.status}, expected 200`)
    else if (!page.type.includes('text/html') || !page.text.includes('id="root"')) fail('Home page', 'answered 200 but not with the app page')
    else pass('Home page', 'answered 200 with the app page')
  } catch (error) {
    fail('Home page', reason(error))
  }

  if (!script) {
    fail('App script', 'the page names no app script')
  } else {
    try {
      const js = await request(baseUrl, script, { timeoutMs })
      if (js.status === 200 && js.type.includes('javascript')) pass('App script', `${script} answered 200`)
      else fail('App script', `${script} answered ${js.status} ${js.type || 'with no content type'}, expected 200 javascript`)
    } catch (error) {
      fail('App script', reason(error))
    }
  }

  for (const check of FUNCTION_CHECKS) {
    try {
      const res = await request(baseUrl, check.path, { method: check.method, body: check.body, timeoutMs })
      let code = ''
      try { code = String(JSON.parse(res.text)?.error ?? '') } catch { code = res.type.includes('html') ? 'the app page' : 'no JSON' }
      if (res.status === check.status && code === check.error) pass(check.name, `answered ${res.status} ${code}`)
      else fail(check.name, `answered ${res.status} ${code}, expected ${check.status} ${check.error}`)
    } catch (error) {
      fail(check.name, reason(error))
    }
  }
  return results
}

async function main() {
  const base = process.argv[2]
  if (!base) {
    console.error('Usage: node scripts/check-live-site.mjs <site url>')
    process.exitCode = 2
    return
  }
  const results = await checkSite(base)
  for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'}  ${r.name}: ${r.detail}`)
  const failures = results.filter((r) => !r.ok)
  if (failures.length) {
    console.error(`\n${failures.length} of ${results.length} live site checks failed for ${base}.`)
    process.exitCode = 1
  } else {
    console.log(`\nAll ${results.length} live site checks passed for ${base}.`)
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
