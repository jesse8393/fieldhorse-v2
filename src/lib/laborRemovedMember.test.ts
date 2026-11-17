import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeClient, newState, type FakeState } from './teamAccountFakeSupabase'

let state: FakeState
vi.mock('./supabase.ts', () => ({ supabase: { from: (table: string) => fakeClient(state).from(table) } }))

import { crewLaborForContact } from './labor.ts'

const ORG = 'org-1'

beforeEach(() => {
  state = newState({
    org_members: [
      { id: 'm-crew', org_id: ORG, user_id: 'crew-1', role: 'crew', default_hourly_rate: 28, revoked_at: null },
    ],
    // One 8 hour shift clocked from Crew Home: no rate on the row.
    fh_time_punches: [{
      id: 'p1', org_id: ORG, user_id: 'crew-1', contact_id: 'job-1', flagged: false, hourly_rate: null,
      punch_in_at: '2026-11-02T13:00:00Z', punch_out_at: '2026-11-02T21:00:00Z', break_minutes: 0,
    }],
  })
})

describe('crew labor on a job', () => {
  it('prices unstamped time at the member rate', async () => {
    expect(await crewLaborForContact('job-1', 'owner-1')).toMatchObject({ hours: 8, cost: 224, unratedHours: 0 })
  })

  it('still prices it after the worker is removed from the team', async () => {
    state.tables.org_members[0].revoked_at = '2026-11-07T00:00:00Z'
    expect(await crewLaborForContact('job-1', 'owner-1')).toMatchObject({ hours: 8, cost: 224, unratedHours: 0 })
  })
})
