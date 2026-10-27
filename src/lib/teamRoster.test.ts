import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase.ts', () => ({ supabase: {} }))
const { loadLimitedTeamRoster } = await import('./teamRoster.ts')

function fakeClient(role: string, opts: { revoked?: boolean; canRead?: boolean; inviteError?: boolean; memberError?: boolean; count?: number } = {}) {
  const columns: string[] = []
  const own = { id: 'm-self', user_id: 'self', org_id: 'org-a', role, revoked_at: opts.revoked ? '2026-01-01' : null, joined_at: '2026-01-01', invited_by: null }
  const members = [own, ...Array.from({ length: opts.count ?? 1 }, (_, n) => ({ ...own, id: `m-${n}`, user_id: `other-${n}`, role: 'crew', revoked_at: null })), { ...own, id: 'm-foreign', org_id: 'org-b', user_id: 'outsider' }]
  const rpc = vi.fn(async () => ({ data: opts.canRead ?? true, error: null }))
  const from = vi.fn((table: string) => {
    const filters: Array<(row: any) => boolean> = []
    let range = [0, 9999]
    const response = () => ({
      data: (table === 'org_members' ? members : []).filter(row => filters.every(filter => filter(row))).slice(range[0], range[1] + 1),
      error: (table === 'org_invites' && opts.inviteError) || (table === 'org_members' && opts.memberError) ? { message: 'unavailable' } : null,
    })
    const q: any = {
      select: (selection: string) => { columns.push(selection); return q },
      eq: (key: string, value: unknown) => { filters.push(row => row[key] === value); return q },
      is: (key: string, value: unknown) => { filters.push(row => (row[key] ?? null) === value); return q },
      gt: () => q, order: () => q,
      range: (from: number, to: number) => { range = [from, to]; return q },
      maybeSingle: async () => ({ ...response(), data: response().data[0] ?? null }),
      then: (resolve: any, reject: any) => Promise.resolve(response()).then(resolve, reject),
    }
    return q
  })
  return { client: { auth: { getSession: async () => ({ data: { session: { user: { id: 'self' } } } }) }, rpc, from } as any, columns, rpc, from }
}

describe('limited roster recovery', () => {
  it('verifies active membership and complete roster permission before returning scoped records', async () => {
    const f = fakeClient('owner')
    const result = await loadLimitedTeamRoster('org-a', f.client)
    expect(f.rpc).toHaveBeenCalledWith('fh_can_read_org_members', { p_org_id: 'org-a' })
    expect(result.members.map(row => row.user_id)).toEqual(['self', 'other-0'])
    expect(result).toMatchObject({ read_only: true, invites_available: true, org_id: 'org-a' })
    expect(f.columns.join(',')).not.toContain('default_hourly_rate')
    expect(result.members.every(row => row.email === null && row.default_hourly_rate === null)).toBe(true)
  })
  it.each(['crew', 'foreman'])('never calls a partial %s roster a full team', async role => {
    const f = fakeClient(role)
    await expect(loadLimitedTeamRoster('org-a', f.client)).rejects.toThrow('roster_fallback_forbidden')
    expect(f.rpc).not.toHaveBeenCalled()
  })
  it('refuses revoked membership and a database permission denial', async () => {
    await expect(loadLimitedTeamRoster('org-a', fakeClient('owner', { revoked: true }).client)).rejects.toThrow()
    await expect(loadLimitedTeamRoster('org-a', fakeClient('owner', { canRead: false }).client)).rejects.toThrow()
  })
  it('keeps manager invitations unknown rather than claiming zero', async () => {
    const f = fakeClient('manager')
    const result = await loadLimitedTeamRoster('org-a', f.client)
    expect(result.invites_available).toBe(false)
    expect(f.from).not.toHaveBeenCalledWith('org_invites')
  })
  it('retains verified members when invitation lookup fails', async () => {
    const result = await loadLimitedTeamRoster('org-a', fakeClient('admin', { inviteError: true }).client)
    expect(result.members).toHaveLength(2)
    expect(result.invites_available).toBe(false)
  })
  it('loads the complete roster beyond the API page limit', async () => {
    const result = await loadLimitedTeamRoster('org-a', fakeClient('owner', { count: 1003 }).client)
    expect(result.members).toHaveLength(1004)
  })
})
