import { describe, expect, it, vi } from 'vitest'
import { planAccountDeletion, retainedPathsForSharedOrgs, listAllObjects, TEAM_TABLES } from '../../netlify/functions/delete-account.js'

const ORG_A = 'org-a'
const ORG_B = 'org-b'

describe('account deletion plan', () => {
  it('erases a solo company', () => {
    const plan = planAccountDeletion({ memberships: [{ org_id: ORG_A, role: 'owner' }], teammates: [] })
    expect(plan.soloOrgIds).toEqual([ORG_A])
    expect(plan.handoffs).toEqual([])
    expect(plan.blocked).toEqual([])
  })

  it('refuses the only owner of a shared company', () => {
    const plan = planAccountDeletion({
      memberships: [{ org_id: ORG_A, role: 'owner' }],
      teammates: [{ org_id: ORG_A, user_id: 'crew-1', role: 'crew', joined_at: '2026-01-01' }],
      orgNames: { [ORG_A]: 'Parker Construction' }
    })
    expect(plan.blocked).toEqual([{ orgId: ORG_A, orgName: 'Parker Construction' }])
    expect(plan.handoffs).toEqual([])
    expect(plan.soloOrgIds).toEqual([])
  })

  it('hands a co owner\'s records to the other owner, never to crew', () => {
    const plan = planAccountDeletion({
      memberships: [{ org_id: ORG_A, role: 'owner' }],
      teammates: [
        { org_id: ORG_A, user_id: 'crew-1', role: 'crew', joined_at: '2025-01-01' },
        { org_id: ORG_A, user_id: 'owner-2', role: 'owner', joined_at: '2026-02-01' }
      ]
    })
    expect(plan.handoffs).toEqual([{ orgId: ORG_A, successorId: 'owner-2' }])
    expect(plan.blocked).toEqual([])
  })

  it('hands a departing crew member\'s records to the earliest owner', () => {
    const plan = planAccountDeletion({
      memberships: [{ org_id: ORG_A, role: 'crew' }],
      teammates: [
        { org_id: ORG_A, user_id: 'admin-1', role: 'admin', joined_at: '2024-01-01' },
        { org_id: ORG_A, user_id: 'owner-late', role: 'owner', joined_at: '2026-01-01' },
        { org_id: ORG_A, user_id: 'owner-early', role: 'owner', joined_at: '2025-01-01' }
      ]
    })
    expect(plan.handoffs).toEqual([{ orgId: ORG_A, successorId: 'owner-early' }])
  })

  it('falls back to an admin when a shared company has no owner left', () => {
    const plan = planAccountDeletion({
      memberships: [{ org_id: ORG_A, role: 'manager' }],
      teammates: [{ org_id: ORG_A, user_id: 'admin-1', role: 'admin', joined_at: '2024-01-01' }]
    })
    expect(plan.handoffs).toEqual([{ orgId: ORG_A, successorId: 'admin-1' }])
  })

  it('blocks when no owner or admin could receive the records', () => {
    const plan = planAccountDeletion({
      memberships: [{ org_id: ORG_A, role: 'manager' }],
      teammates: [{ org_id: ORG_A, user_id: 'crew-1', role: 'crew', joined_at: '2024-01-01' }]
    })
    expect(plan.blocked).toHaveLength(1)
  })

  it('plans each company independently', () => {
    const plan = planAccountDeletion({
      memberships: [{ org_id: ORG_A, role: 'owner' }, { org_id: ORG_B, role: 'crew' }],
      teammates: [{ org_id: ORG_B, user_id: 'owner-b', role: 'owner', joined_at: '2024-01-01' }]
    })
    expect(plan.soloOrgIds).toEqual([ORG_A])
    expect(plan.handoffs).toEqual([{ orgId: ORG_B, successorId: 'owner-b' }])
  })

  it('keeps personal records out of the handoff list', () => {
    for (const personal of ['fh_time_punches', 'fh_push_subscriptions', 'fh_notifications', 'profiles']) {
      expect(TEAM_TABLES).not.toContain(personal)
    }
    for (const team of ['fh_contacts', 'fh_clients', 'fh_leads', 'fh_quotes', 'fh_invoices', 'fh_payments', 'fh_job_files']) {
      expect(TEAM_TABLES).toContain(team)
    }
  })

  it('preserves a revoked member’s records with the current owner and blocks an unowned former company', () => {
    const memberships = [{ org_id: ORG_A, role: 'crew', revoked_at: '2026-11-01' }]
    expect(planAccountDeletion({ memberships, teammates: [{ org_id: ORG_A, user_id: 'owner', role: 'owner' }] }).handoffs).toEqual([{ orgId: ORG_A, successorId: 'owner' }])
    const blocked = planAccountDeletion({ memberships, teammates: [] })
    expect(blocked.soloOrgIds).toEqual([])
    expect(blocked.blocked).toHaveLength(1)
  })
})

describe('shared file preservation during account deletion', () => {
  function db(failTable?: string) {
    const tables: Record<string, any[]> = {
      fh_job_files: Array.from({ length: 501 }, (_, i) => ({ id: String(i), user_id: 'successor', storage_path: `departing/job/file-${i}` })),
      fh_daily_logs: [{ id: 'log', photos: [{ storage_path: 'departing/job/photo' }] }],
      fh_sub_profiles: [{ id: 'sub', coi_path: 'departing/sub/coi', w9_path: 'departing/sub/w9' }],
    }
    return { from(table: string) {
      const query: any = { select: () => query, in: () => query, order: () => query, range: async (from: number, to: number) =>
        ({ data: tables[table].slice(from, to + 1), error: table === failTable ? new Error('lookup failed') : null }) }
      return query
    } }
  }
  it('keeps every page, including files reassigned on a previous attempt and vendor documents', async () => {
    const paths = await retainedPathsForSharedOrgs(db(), 'departing', [ORG_A])
    expect(paths.size).toBe(504)
    expect(paths.has('departing/job/file-500')).toBe(true)
    expect(paths.has('departing/sub/w9')).toBe(true)
  })
  it.each(['fh_job_files', 'fh_daily_logs', 'fh_sub_profiles'])('stops when %s retention cannot be verified', async table => {
    await expect(retainedPathsForSharedOrgs(db(table), 'departing', [ORG_A])).rejects.toThrow('lookup failed')
  })
  it('lists past the storage API page limit', async () => {
    const entries = Array.from({ length: 1001 }, (_, i) => ({ id: String(i), name: `file-${i}` }))
    const list = vi.fn(async (_: string, opts: { offset: number; limit: number }) => ({ data: entries.slice(opts.offset, opts.offset + opts.limit), error: null }))
    const objects = await listAllObjects({ storage: { from: () => ({ list }) } }, 'job-files', 'departing')
    expect(objects).toHaveLength(1001)
    expect(list).toHaveBeenCalledTimes(2)
  })
})
