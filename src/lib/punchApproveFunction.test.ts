import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, newState, type FakeState } from './teamAccountFakeSupabase'

let state: FakeState
vi.mock('@supabase/supabase-js', () => ({ createClient: () => fakeClient(state) }))

import { netPunchMinutes, partitionApprovablePunches } from '../../netlify/functions/lib/punches.js'
import approve from '../../netlify/functions/org-punch-approve.js'
import list from '../../netlify/functions/org-timesheets-list.js'

const punch = (id: string, userId: string, inAt: string, outAt: string | null, breakMinutes = 0) => ({
  id,
  user_id: userId,
  punch_in_at: inAt,
  punch_out_at: outAt,
  break_minutes: breakMinutes,
})

describe('net punch minutes', () => {
  it('subtracts the break from wall clock time', () => {
    expect(netPunchMinutes(punch('p', 'u', '2026-10-01T08:00:00Z', '2026-10-01T16:30:00Z', 30))).toBe(480)
  })

  it('is zero for a reversed, empty, or open shift, or a break as long as the shift', () => {
    expect(netPunchMinutes(punch('p', 'u', '2026-10-01T16:00:00Z', '2026-10-01T08:00:00Z'))).toBe(0)
    expect(netPunchMinutes(punch('p', 'u', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'))).toBe(0)
    expect(netPunchMinutes(punch('p', 'u', '2026-10-01T08:00:00Z', null))).toBe(0)
    expect(netPunchMinutes(punch('p', 'u', '2026-10-01T08:00:00Z', '2026-10-01T08:30:00Z', 30))).toBe(0)
    expect(netPunchMinutes(null)).toBe(0)
  })
})

describe('which punches an approval may stamp', () => {
  const rows = [
    punch('good', 'crew-1', '2026-10-01T08:00:00Z', '2026-10-01T16:00:00Z'),
    punch('zero', 'crew-1', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
    punch('backwards', 'crew-2', '2026-10-01T17:00:00Z', '2026-10-01T09:00:00Z'),
    punch('mine', 'manager-1', '2026-10-01T07:00:00Z', '2026-10-01T21:00:00Z'),
  ]

  it('skips zero length shifts and a manager or admin approving their own hours', () => {
    for (const callerRole of ['manager', 'admin']) {
      const res = partitionApprovablePunches(rows, { callerId: 'manager-1', callerRole })
      expect(res.approvable.map((p: any) => p.id)).toEqual(['good'])
      expect(res.invalidIds).toEqual(['zero', 'backwards'])
      expect(res.selfIds).toEqual(['mine'])
    }
  })

  it('lets an owner approve their own hours but never an invalid shift', () => {
    const res = partitionApprovablePunches(rows, { callerId: 'manager-1', callerRole: 'owner' })
    expect(res.approvable.map((p: any) => p.id)).toEqual(['good', 'mine'])
    expect(res.invalidIds).toEqual(['zero', 'backwards'])
    expect(res.selfIds).toEqual([])
  })

  it('tolerates an empty lookup', () => {
    expect(partitionApprovablePunches(null, { callerId: 'x', callerRole: 'owner' })).toEqual({
      approvable: [],
      invalidIds: [],
      selfIds: [],
    })
  })
})

// The handlers themselves, against an in memory database.
const ORG = '0b0b0b0b-0000-4000-8000-000000000001'
const OWNER = 'user-owner'
const MANAGER = 'user-manager'
const CREW = 'user-crew'
const NORATE = 'user-no-rate'

const post = (path: string, token: string, body: unknown) => new Request(`https://app.example.test${path}`, {
  method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body),
})
const shift = (id: string, userId: string, day: number, extra: Record<string, unknown> = {}) => ({
  id, org_id: ORG, user_id: userId, contact_id: 'job-1',
  punch_in_at: `2026-11-0${day}T13:00:00Z`, punch_out_at: `2026-11-0${day}T21:00:00Z`,
  break_minutes: 0, hourly_rate: null, approved_at: null, approved_by: null, flagged: false, flag_reason: null, ...extra,
})

function seedTeam() {
  state = newState({
    org_members: [
      { id: 'm-owner', org_id: ORG, user_id: OWNER, role: 'owner', joined_at: '2026-01-01T00:00:00Z', revoked_at: null, default_hourly_rate: null },
      { id: 'm-manager', org_id: ORG, user_id: MANAGER, role: 'manager', joined_at: '2026-02-01T00:00:00Z', revoked_at: null, default_hourly_rate: 40 },
      { id: 'm-crew', org_id: ORG, user_id: CREW, role: 'crew', joined_at: '2026-03-01T00:00:00Z', revoked_at: null, default_hourly_rate: 28 },
      { id: 'm-norate', org_id: ORG, user_id: NORATE, role: 'crew', joined_at: '2026-04-01T00:00:00Z', revoked_at: null, default_hourly_rate: null },
    ],
    profiles: [],
    fh_contacts: [{ id: 'job-1', org_id: ORG, name: 'Dana Smith' }],
    // A 40 hour week clocked from Crew Home: no rate stamped on the rows.
    fh_time_punches: [2, 3, 4, 5, 6].map((d) => shift(`p-${d}`, CREW, d)),
  })
  state.users = {
    'tok-owner': { id: OWNER, email: 'jesse@example.test' },
    'tok-manager': { id: MANAGER, email: 'office@example.test' },
  }
}

describe('time handlers', () => {
  beforeEach(() => {
    seedTeam()
    vi.stubEnv('SUPABASE_URL', 'https://db.example.test')
    vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', 'test-service')
    vi.stubEnv('SUPABASE_ANON_KEY', 'test-anon')
  })
  afterEach(() => { vi.unstubAllEnvs() })

  const punchRows = () => state.tables.fh_time_punches
  const removeCrew = () => { state.tables.org_members.find((m) => m.user_id === CREW)!.revoked_at = '2026-11-07T00:00:00Z' }
  const approveIds = async (token: string, ids: string[]) => {
    const res = await approve(post('/api/org-punch-approve', token, { punch_ids: ids, org_id: ORG }))
    return { status: res.status, body: await res.json() }
  }
  const listed = async (token: string, body: Record<string, unknown> = {}) => {
    const res = await list(post('/api/org-timesheets-list', token, { org_id: ORG, ...body }))
    return { status: res.status, body: await res.json() }
  }

  describe('time approved after the worker was removed', () => {
    it('is still listed at the rate the worker had', async () => {
      removeCrew()
      const { body } = await listed('tok-owner')
      expect(body.punches).toHaveLength(5)
      expect(body.punches.every((p: any) => p.hourly_rate === 28 && p.cost === 224)).toBe(true)
    })

    it('is approved at the rate the worker had, not frozen with none', async () => {
      removeCrew()
      const { status, body } = await approveIds('tok-owner', punchRows().map((p) => p.id))
      expect(status).toBe(200)
      expect(body.approved_count).toBe(5)
      expect(body.unrated_skipped).toEqual([])
      // 40 hours at 28 dollars: 1,120 dollars of labor stays on the job.
      expect(punchRows().every((p) => p.approved_at && p.hourly_rate === 28)).toBe(true)
    })
  })

  describe('a punch that still has no rate', () => {
    it('is left pending and reported, while the rated ones are approved', async () => {
      punchRows().push(shift('p-norate', NORATE, 3))
      const { status, body } = await approveIds('tok-owner', ['p-2', 'p-norate'])
      expect(status).toBe(200)
      expect(body.approved_ids).toEqual(['p-2'])
      expect(body.unrated_skipped).toEqual(['p-norate'])
      expect(punchRows().find((p) => p.id === 'p-norate')).toMatchObject({ approved_at: null, hourly_rate: null })
    })

    it('answers with a plain message when nothing could be approved for that reason', async () => {
      punchRows().push(shift('p-norate', NORATE, 3))
      const { status, body } = await approveIds('tok-owner', ['p-norate'])
      expect(status).toBe(409)
      expect(body.error).toBe('rate_required')
      expect(body.message).toMatch(/hourly rate/i)
      expect(body.unrated_skipped).toEqual(['p-norate'])
      expect(punchRows().find((p) => p.id === 'p-norate')!.approved_at).toBeNull()
    })

    it('a rate stamped at clock out is enough, whatever the member row says', async () => {
      punchRows().push(shift('p-stamped', NORATE, 3, { hourly_rate: 31 }))
      const { body } = await approveIds('tok-owner', ['p-stamped'])
      expect(body.approved_ids).toEqual(['p-stamped'])
      expect(punchRows().find((p) => p.id === 'p-stamped')!.hourly_rate).toBe(31)
    })
  })
})
