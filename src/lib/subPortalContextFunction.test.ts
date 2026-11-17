import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, newState, type FakeState } from './teamAccountFakeSupabase'

let state: FakeState
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient(state) }))

import context from '../../netlify/functions/sub-portal-context.js'
import { boundSubOrgIds } from '../../netlify/functions/lib/subAccess.js'

const ORG = '0b0b0b0b-0000-4000-8000-000000000001'
const OTHER_ORG = '0c0c0c0c-0000-4000-8000-000000000002'
const SUB = 'user-sub'

beforeEach(() => {
  state = newState({
    fh_job_partners: [
      { id: 'jp-left', org_id: ORG, job_id: 'job-1', partner_user_id: SUB, status: 'accepted', accepted_at: '2026-06-01T00:00:00Z', deleted_by_partner_at: '2026-10-01T00:00:00Z' },
    ],
    fh_contacts: [
      { id: 'job-1', org_id: ORG, name: 'Dana Smith', address: '1 Elm St', stage: 'job', job_title: 'Driveway', updated_at: '2026-11-10T00:00:00Z' },
      { id: 'job-2', org_id: OTHER_ORG, name: 'Lee Park', address: '9 Oak Ave', stage: 'job', job_title: 'Patio', updated_at: '2026-11-11T00:00:00Z' },
    ],
    fh_sub_profiles: [
      { id: 'sp1', org_id: ORG, email: 'sub@example.test', name: 'Sam Sub', ein: '12-3456789', updated_at: '2026-01-01' },
      { id: 'sp2', org_id: OTHER_ORG, email: 'sub@example.test', name: 'Sam Sub', ein: '12-3456789', updated_at: '2026-02-01' },
    ],
  })
  state.users = { 'tok-sub': { id: SUB, email: 'sub@example.test' } }
  vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service')
  vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon')
})
afterEach(() => { vi.unstubAllEnvs() })

const load = async () => {
  const res = await context(new Request('https://app.example.test/api/sub-portal-context', {
    method: 'POST', headers: { authorization: 'Bearer tok-sub', 'content-type': 'application/json' }, body: '{}',
  }))
  return { status: res.status, body: await res.json() }
}

describe('sub portal after the sub left a job', () => {
  it('no longer returns the job, its customer, its address or that company\'s vendor profile', async () => {
    const { status, body } = await load()
    expect(status).toBe(200)
    expect(body.linked_jobs).toEqual({})
    expect(body.accepted_partners).toEqual([])
    expect(body.matched_profiles).toEqual([])
    expect(JSON.stringify(body)).not.toContain('Dana Smith')
    expect(JSON.stringify(body)).not.toContain('1 Elm St')
    // The same answer the shared helper gives the other sub endpoints.
    expect(await boundSubOrgIds(fakeClient(state) as any, SUB)).toEqual({ orgIds: [] })
  })

  it('still returns the jobs the sub is on', async () => {
    state.tables.fh_job_partners.push({ id: 'jp-on', org_id: OTHER_ORG, job_id: 'job-2', partner_user_id: SUB, status: 'accepted', accepted_at: '2026-07-01T00:00:00Z', deleted_by_partner_at: null })
    const { body } = await load()
    expect(Object.keys(body.linked_jobs)).toEqual(['job-2'])
    expect(body.accepted_partners.map((p: any) => p.id)).toEqual(['jp-on'])
    expect(body.matched_profiles.map((p: any) => p.id)).toEqual(['sp2'])
  })
})
