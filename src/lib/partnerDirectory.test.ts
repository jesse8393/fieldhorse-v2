import { beforeEach, describe, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ rows: [] as any[], fail: false, calls: [] as string[] }))
vi.mock('./supabase.ts', () => ({
  getActiveOrgId: () => 'org-a',
  supabase: {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'self' } } } }) },
    from: () => {
      const filters: Array<(row: any) => boolean> = []
      let range = [0, 9999]
      const q: any = {
        select: () => q,
        or: () => q,
        eq: (col: string, value: string) => { state.calls.push(`${col}=${value}`); filters.push(row => row[col] === value); return q },
        order: () => q,
        range: (from: number, to: number) => { range = [from, to]; return q },
        then: (resolve: any, reject: any) => Promise.resolve({ data: state.rows.filter(row => filters.every(filter => filter(row))).slice(range[0], range[1] + 1), error: state.fail ? { message: 'offline' } : null }).then(resolve, reject),
      }
      return q
    },
  },
}))
import { loadPartnerDirectory } from './partners.ts'
const row = (id: string, org = 'org-a') => ({ id, org_id: org, job_id: `job-${id}`, invited_by_user_id: 'self', partner_email: `${id}@example.com`, partner_role: 'Sub', status: 'accepted', fh_contacts: { name: 'Job' } })
beforeEach(() => { state.rows = []; state.fail = false; state.calls = [] })

describe('partner directory scope and completeness', () => {
  it('filters the active company even when RLS grants access to another company too', async () => {
    state.rows = [row('a'), row('b', 'org-b')]
    expect((await loadPartnerDirectory()).map(partner => partner.email)).toEqual(['a@example.com'])
    expect(state.calls).toContain('org_id=org-a')
  })
  it('does not turn fetch failure into an empty directory', async () => {
    state.fail = true
    await expect(loadPartnerDirectory()).rejects.toMatchObject({ message: 'offline' })
  })
  it('loads every share beyond the old five hundred row cutoff', async () => {
    state.rows = Array.from({ length: 503 }, (_, n) => row(`p${n}`))
    expect(await loadPartnerDirectory()).toHaveLength(503)
  })
  it('does not count a partner who left as holding active access', async () => {
    state.rows = [{ ...row('a'), deleted_by_partner_at: '2026-10-01T00:00:00Z' }]
    const partner = (await loadPartnerDirectory())[0]
    expect(partner.status).toBe('left')
    expect(partner.jobs[0].status).toBe('left')
  })
})
