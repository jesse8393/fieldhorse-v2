import { describe, expect, it } from 'vitest'
import { activeCompanyFrom, inActiveCompany, onlyActiveCompany, type ActiveCompany } from './activeCompany.ts'
import { JOB_LIST_COLUMNS } from './queries.ts'

// Phase 8, Task 7: the jobs list carries every company the person belongs
// to plus jobs a partner shared, so screens that act on a job check it
// belongs to the active company first.

const ORG: ActiveCompany = { orgId: 'org-1', userId: 'qa-user-1' }
const NO_ORG: ActiveCompany = { orgId: null, userId: 'qa-user-1' }

const own = { id: 'own', org_id: 'org-1', user_id: 'qa-user-1' }
const teammate = { id: 'teammate', org_id: 'org-1', user_id: 'crew-1' }
const otherWorkspace = { id: 'other', org_id: 'org-3', user_id: 'qa-user-1' }
const partner = { id: 'partner', org_id: 'org-2', user_id: 'partner-user-1' }
const legacy = { id: 'legacy', org_id: null, user_id: 'qa-user-1' }

describe('inActiveCompany', () => {
  it('matches a job whose org_id is the active org, whoever made it', () => {
    expect(inActiveCompany(own, ORG)).toBe(true)
    expect(inActiveCompany(teammate, ORG)).toBe(true)
  })

  it('refuses a partner job from another company', () => {
    expect(inActiveCompany(partner, ORG)).toBe(false)
  })

  it('refuses a job from another workspace the person also belongs to, even one they made', () => {
    expect(inActiveCompany(otherWorkspace, ORG)).toBe(false)
  })

  it('refuses a job with no org_id while a company is active, as every org scoped query does', () => {
    expect(inActiveCompany(legacy, ORG)).toBe(false)
  })

  it('matches by user_id when the person has no company', () => {
    expect(inActiveCompany(legacy, NO_ORG)).toBe(true)
    expect(inActiveCompany(own, NO_ORG)).toBe(true)
    expect(inActiveCompany(partner, NO_ORG)).toBe(false)
    expect(inActiveCompany(teammate, NO_ORG)).toBe(false)
  })

  it('refuses every job while the company is not known yet', () => {
    expect(inActiveCompany(own, null)).toBe(false)
    expect(inActiveCompany(own, undefined)).toBe(false)
  })

  it('never matches a job with no owner when there is no company', () => {
    expect(inActiveCompany({ org_id: null, user_id: null }, NO_ORG)).toBe(false)
    expect(inActiveCompany({}, NO_ORG)).toBe(false)
  })
})

describe('activeCompanyFrom', () => {
  it('builds the company from the signed in person and the resolved org scope', () => {
    expect(activeCompanyFrom('qa-user-1', 'org-1')).toEqual(ORG)
    expect(activeCompanyFrom('qa-user-1', null)).toEqual(NO_ORG)
  })

  it('is null while the person or the org scope is not known', () => {
    expect(activeCompanyFrom(undefined, 'org-1')).toBeNull()
    expect(activeCompanyFrom(null, null)).toBeNull()
    expect(activeCompanyFrom('qa-user-1', undefined)).toBeNull()
  })
})

describe('onlyActiveCompany', () => {
  it('keeps the active company rows in order and drops the rest', () => {
    const rows = [partner, own, otherWorkspace, teammate, legacy]
    expect(onlyActiveCompany(rows, ORG).map((r) => r.id)).toEqual(['own', 'teammate'])
    expect(onlyActiveCompany(rows, NO_ORG).map((r) => r.id)).toEqual(['own', 'other', 'legacy'])
  })

  it('keeps nothing while the company is not known', () => {
    expect(onlyActiveCompany([own, teammate], null)).toEqual([])
  })
})

describe('the jobs list', () => {
  it('reads org_id, so a screen can tell the active company from a partner', () => {
    expect(JOB_LIST_COLUMNS.split(',').map((c) => c.trim())).toContain('org_id')
  })
})
