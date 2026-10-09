import { afterEach, describe, expect, it, vi } from 'vitest'

// orgApi reads the session from the Supabase client; stub it so the test
// needs no env or network.
vi.mock('./supabase.ts', () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'jwt' } } }) } },
}))

const api = await import('./orgApi.ts')

function mockFetch() {
  const fetchMock = vi.fn(async (_url: string, _init: any) => new Response(JSON.stringify({ ok: true }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

const sentBody = (fetchMock: ReturnType<typeof mockFetch>, call = 0) => JSON.parse(fetchMock.mock.calls[call][1].body)

afterEach(() => {
  api.setOrgApiOrgId(null)
  vi.unstubAllGlobals()
})

describe('org api workspace', () => {
  it('sends the selected workspace on every member and timesheet call', async () => {
    const fetchMock = mockFetch()
    api.setOrgApiOrgId('org-a')
    await api.orgMembersList()
    await api.orgInviteCreate('pat@example.com', 'crew')
    await api.orgInviteRevoke('inv-1')
    await api.orgMemberRemove('u2')
    await api.orgMemberRole('u2', 'foreman')
    await api.orgMemberRate('u2', 42)
    await api.orgTimesheetsList({ from: '2026-10-05T00:00:00.000Z' })
    await api.orgPunchApprove(['p1'])
    await api.orgPunchFlag(['p1'], true, 'GPS mismatch')
    expect(fetchMock).toHaveBeenCalledTimes(9)
    for (let i = 0; i < 9; i++) expect(sentBody(fetchMock, i).org_id).toBe('org-a')
    expect(sentBody(fetchMock, 6)).toEqual({ from: '2026-10-05T00:00:00.000Z', org_id: 'org-a' })
  })

  it('sends no org_id before a workspace is set or after it is cleared', async () => {
    const fetchMock = mockFetch()
    await api.orgMembersList()
    api.setOrgApiOrgId('org-a')
    api.setOrgApiOrgId(null)
    await api.orgPunchApprove(['p1'])
    expect(sentBody(fetchMock, 0)).toEqual({})
    expect(sentBody(fetchMock, 1)).toEqual({ punch_ids: ['p1'] })
  })

  it('leaves invite acceptance alone', async () => {
    const fetchMock = mockFetch()
    api.setOrgApiOrgId('org-a')
    await api.orgInviteAccept('tok')
    expect(sentBody(fetchMock)).toEqual({ token: 'tok' })
  })
})
