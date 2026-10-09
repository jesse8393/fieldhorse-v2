import { describe, expect, it } from 'vitest'
import { planAccountDeletion, TEAM_TABLES } from '../../netlify/functions/delete-account.js'

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
    for (const team of ['fh_contacts', 'fh_clients', 'fh_invoices', 'fh_payments', 'fh_job_files']) {
      expect(TEAM_TABLES).toContain(team)
    }
  })
})
