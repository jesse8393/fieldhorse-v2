import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, newState, type FakeState } from './teamAccountFakeSupabase'

// FN-30. About twenty Netlify functions read only SUPABASE_SERVICE_ROLE_KEY
// (and the anon key names) from the environment, while the team functions go
// through lib/serviceConfig.js, which also accepts SUPABASE_SECRET_KEY and
// SUPABASE_PUBLISHABLE_KEY. A site set up with the newer names answered 500
// from every function outside the team ones.

const clients = vi.hoisted(() => ({ calls: [] as Array<{ url: string; key: string }> }))
let state: FakeState
vi.mock('@supabase/supabase-js', () => ({
  createClient: (url: string, key: string) => { clients.calls.push({ url, key }); return fakeClient(state) },
}))

import linkHandler from '../../netlify/functions/public-link.js'
import acceptPartner from '../../netlify/functions/partner-invite-accept.js'
import invitePartner from '../../netlify/functions/partner-invite.js'
import { hashIdentifier } from '../../netlify/functions/lib/rateLimit.js'

const FUNCTIONS = fileURLToPath(new URL('../../netlify/functions/', import.meta.url))
const NAMES = ['SUPABASE_URL', 'VITE_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY', 'VITE_SUPABASE_PUBLISHABLE_KEY']

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name === 'node_modules' ? [] : sources(full)
    return /\.(m?js|ts)$/.test(entry.name) ? [full] : []
  })
}

describe('Supabase names in the Netlify functions', () => {
  it('are read only through lib/serviceConfig.js', () => {
    const direct = /process\.env(?:\?\.|\.|\[\s*['"`])(?:VITE_)?SUPABASE_(?:URL|SERVICE_ROLE_KEY|SECRET_KEY|ANON_KEY|PUBLISHABLE_KEY)\b/
    const destructured = /\{[^}]*\b(?:VITE_)?SUPABASE_[A-Z_]+[^}]*\}\s*=\s*process\.env\b/
    const offenders: string[] = []
    for (const file of sources(FUNCTIONS)) {
      const rel = relative(FUNCTIONS, file)
      if (rel === join('lib', 'serviceConfig.js')) continue
      readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (direct.test(line) || destructured.test(line)) offenders.push(`${rel}:${i + 1}`)
      })
    }
    expect(offenders).toEqual([])
  })
})

describe('a site set up with only the newer key names', () => {
  beforeEach(() => {
    clients.calls.length = 0
    state = newState({ fh_public_links: [] })
    for (const name of NAMES) vi.stubEnv(name, '')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  const newNames = () => {
    vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'test-secret-key')
    vi.stubEnv('SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key')
  }

  it('answers a customer link instead of a server error', async () => {
    newNames()
    const res = await linkHandler(new Request('https://app.example.test/api/public-link?token=no-such-token'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toBe('not_found')
    expect(clients.calls.map((c) => c.key)).toEqual(['test-secret-key'])
  })

  it('lets a partner accept an invite, signing in with the publishable key', async () => {
    newNames()
    state.users = { 'tok-partner': { id: 'user-partner', email: 'sub@example.test', email_confirmed_at: '2026-01-01T00:00:00Z' } }
    state.tables.fh_job_partners = [{ id: 'jp-1', job_id: 'job-1', org_id: 'org-1', partner_email: 'sub@example.test', status: 'pending', invited_by_user_id: 'user-owner', invite_token: 'inv-1' }]
    const res = await acceptPartner(new Request('https://app.example.test/api/partner-invite-accept', {
      method: 'POST', headers: { authorization: 'Bearer tok-partner', 'content-type': 'application/json' }, body: JSON.stringify({ token: 'inv-1' }),
    }))
    expect(res.status).toBe(200)
    expect(clients.calls.map((c) => c.key)).toEqual(['test-publishable-key', 'test-secret-key'])
  })

  it('salts rate limit identifiers with the server key, whichever name holds it', () => {
    vi.stubEnv('SUPABASE_SECRET_KEY', 'first-secret')
    const first = hashIdentifier('203.0.113.7')
    vi.stubEnv('SUPABASE_SECRET_KEY', 'second-secret')
    expect(hashIdentifier('203.0.113.7')).not.toBe(first)
  })

  it('keeps the same answer as before when the server key is missing', async () => {
    vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
    const link = await linkHandler(new Request('https://app.example.test/api/public-link?token=no-such-token'))
    expect(link.status).toBe(500)
    expect(await link.json()).toEqual({ error: 'server_misconfigured' })
    const invite = await invitePartner(new Request('https://app.example.test/api/partner-invite', { method: 'POST', body: '{}' }))
    expect(invite.status).toBe(500)
    expect(await invite.json()).toEqual({ error: 'server_misconfigured', detail: 'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in Netlify env.' })
    expect(clients.calls).toEqual([])
  })
})
