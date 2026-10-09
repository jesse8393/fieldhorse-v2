import { describe, it, expect } from 'vitest'
import { tabsForRole, pickVisibleTab, canEditJobMoney } from './jobAccess.ts'

const JOB_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'quote', label: 'Quote' },
  { id: 'details', label: 'Details' },
  { id: 'materials', label: 'Materials' },
  { id: 'change_orders', label: 'Change orders' },
  { id: 'financials', label: 'Financials' },
  { id: 'files', label: 'Files' }
]

describe('tabsForRole', () => {
  it('keeps every tab for money roles', () => {
    expect(tabsForRole(JOB_TABS, true)).toEqual(JOB_TABS)
  })

  it('drops quote and change orders for field roles and keeps expenses', () => {
    const tabs = tabsForRole(JOB_TABS, false)
    expect(tabs.map((t) => t.id)).toEqual(['overview', 'details', 'materials', 'financials', 'files'])
    expect(tabs.find((t) => t.id === 'financials')?.label).toBe('Expenses')
  })

  it('does not mutate the input tabs', () => {
    tabsForRole(JOB_TABS, false)
    expect(JOB_TABS.find((t) => t.id === 'financials')?.label).toBe('Financials')
  })
})

describe('pickVisibleTab', () => {
  const crewTabs = tabsForRole(JOB_TABS, false)

  it('honors a requested tab the viewer can open', () => {
    expect(pickVisibleTab('financials', crewTabs)).toBe('financials')
    expect(pickVisibleTab('quote', JOB_TABS)).toBe('quote')
  })

  it('falls back to overview for a hidden or unknown tab', () => {
    expect(pickVisibleTab('quote', crewTabs)).toBe('overview')
    expect(pickVisibleTab('change_orders', crewTabs)).toBe('overview')
    expect(pickVisibleTab('nope', crewTabs)).toBe('overview')
    expect(pickVisibleTab(null, crewTabs)).toBe('overview')
    expect(pickVisibleTab(undefined, JOB_TABS)).toBe('overview')
  })
})

describe('canEditJobMoney', () => {
  const base = { contactUserId: 'owner-1', contactOrgId: 'org-1', canCreateFinancialDocs: true }

  it('lets any money role in the job company edit, not only the creator', () => {
    expect(canEditJobMoney({ ...base, userId: 'admin-2', orgId: 'org-1' })).toBe(true)
    expect(canEditJobMoney({ ...base, userId: 'owner-1', orgId: 'org-1' })).toBe(true)
  })

  it('refuses field roles, even the creator, and other companies', () => {
    expect(canEditJobMoney({ ...base, userId: 'owner-1', orgId: 'org-1', canCreateFinancialDocs: false })).toBe(false)
    expect(canEditJobMoney({ ...base, userId: 'admin-2', orgId: 'org-2' })).toBe(false)
  })

  it('falls back to the creator when there is no company', () => {
    expect(canEditJobMoney({ ...base, contactOrgId: null, userId: 'owner-1', orgId: null })).toBe(true)
    expect(canEditJobMoney({ ...base, contactOrgId: null, userId: 'someone', orgId: null })).toBe(false)
  })
})
