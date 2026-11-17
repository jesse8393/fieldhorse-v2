import { describe, expect, it } from 'vitest'
import { canViewRoute, permissionRouteForPath } from './permissions.ts'

describe('canViewRoute', () => {
  it('keeps Lead Desk with revenue operators', () => {
    expect(canViewRoute('owner', '/leads')).toBe(true)
    expect(canViewRoute('admin', '/leads')).toBe(true)
    expect(canViewRoute('manager', '/leads')).toBe(true)
    expect(canViewRoute('foreman', '/leads')).toBe(false)
    expect(canViewRoute('crew', '/leads')).toBe(false)
  })

  it('keeps Quote Desk with the same revenue operators as Lead Desk', () => {
    expect(canViewRoute('owner', '/quotes')).toBe(true)
    expect(canViewRoute('admin', '/quotes')).toBe(true)
    expect(canViewRoute('manager', '/quotes')).toBe(true)
    expect(canViewRoute('foreman', '/quotes')).toBe(false)
    expect(canViewRoute('crew', '/quotes')).toBe(false)
  })

  it('keeps Pipeline with revenue operators', () => {
    expect(canViewRoute('owner', '/pipeline')).toBe(true)
    expect(canViewRoute('admin', '/pipeline')).toBe(true)
    expect(canViewRoute('manager', '/pipeline')).toBe(true)
    expect(canViewRoute('foreman', '/pipeline')).toBe(false)
    expect(canViewRoute('crew', '/pipeline')).toBe(false)
  })

  it('keeps the Inbox with the people who talk to customers, like Compose', () => {
    expect(canViewRoute('owner', '/inbox')).toBe(true)
    expect(canViewRoute('admin', '/inbox')).toBe(true)
    expect(canViewRoute('manager', '/inbox')).toBe(true)
    expect(canViewRoute('foreman', '/inbox')).toBe(false)
    expect(canViewRoute('crew', '/inbox')).toBe(false)
    expect(canViewRoute(null, '/inbox')).toBe(false)
  })

  it('fails closed for a route with no rule', () => {
    expect(canViewRoute('owner', '/some-new-screen')).toBe(true)
    expect(canViewRoute('admin', '/some-new-screen')).toBe(true)
    expect(canViewRoute('crew', '/some-new-screen')).toBe(false)
    expect(canViewRoute('foreman', '/some-new-screen')).toBe(false)
  })

  it('still lets field roles open the job and field screens they need', () => {
    for (const route of ['/', '/crew', '/work', '/jobs', '/notes', '/schedule', '/activity', '/team', '/pour-window']) {
      expect(canViewRoute('crew', route)).toBe(true)
    }
  })

  // OPS-05 and D01: the bell and the header + must open for the roles that see them.
  it('lets every role open Notifications and money roles open New', () => {
    for (const role of ['owner', 'admin', 'manager', 'foreman', 'crew']) expect(canViewRoute(role, '/notifications')).toBe(true)
    for (const role of ['owner', 'admin', 'manager']) expect(canViewRoute(role, '/new')).toBe(true)
    for (const role of ['foreman', 'crew']) expect(canViewRoute(role, '/new')).toBe(false)
  })

  // OPS-06 and D02: the job money screens and the partner invite follow their own gates.
  it('keeps job payment, completion, new job and partner invite away from field roles', () => {
    const gate = (role: string, path: string) => canViewRoute(role, permissionRouteForPath(path))
    for (const path of ['/jobs/c-job1/payment', '/jobs/c-job1/complete', '/jobs/new', '/jobs/c-job1/partner']) {
      for (const role of ['owner', 'admin', 'manager']) expect(gate(role, path)).toBe(true)
      for (const role of ['foreman', 'crew']) expect(gate(role, path)).toBe(false)
    }
    for (const role of ['owner', 'admin', 'manager', 'foreman', 'crew']) {
      expect(gate(role, '/jobs/c-job1')).toBe(true)
      expect(gate(role, '/jobs/c-job1/more')).toBe(true)
    }
  })

  // D03: Money links every customer to the client page and its statement.
  it('lets roles that see money open a client and its statement, but not the client list', () => {
    const gate = (role: string, path: string) => canViewRoute(role, permissionRouteForPath(path))
    expect(gate('manager', '/clients/cl-1')).toBe(true)
    expect(gate('manager', '/clients/cl-1/statement')).toBe(true)
    expect(gate('manager', '/clients')).toBe(false)
    for (const role of ['foreman', 'crew']) {
      expect(gate(role, '/clients/cl-1')).toBe(false)
      expect(gate(role, '/clients/cl-1/statement')).toBe(false)
    }
    expect(gate('owner', '/clients/merge')).toBe(true)
    expect(gate('manager', '/clients/merge')).toBe(false)
  })
})
