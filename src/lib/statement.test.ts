import { describe, it, expect } from 'vitest'
import { gatherStatement } from './statement.ts'

const jobs = [
  { id: 'a', job_title: 'Sidewalk', stage: 'job', amount: 1880 },
  { id: 'b', job_title: 'Driveway', stage: 'invoice', amount: 2500 },
  { id: 'c', job_title: 'Curb', stage: 'closed', amount: 1400 },
  { id: 'd', job_title: 'Paid off', stage: 'job', amount: 1000 },
  { id: 'e', job_title: 'Just a lead', stage: 'lead', amount: 5000 },
  { id: 'f', job_title: 'Lost bid', stage: 'lost', amount: 9000 }
]
const payments = [
  { contact_id: 'a', amount: 500 },
  { contact_id: 'c', amount: 500 },
  { contact_id: 'd', amount: 1000 } // fully paid → drops out
]

describe('gatherStatement', () => {
  it('rolls billing-stage jobs into per-property balances', () => {
    const { lines, totalDue } = gatherStatement(jobs, payments)
    // a: 1380, b: 2500, c: 900. d paid off, e/f wrong stage.
    expect(lines.map((l) => l.contactId)).toEqual(['b', 'a', 'c']) // sorted by balance desc
    expect(totalDue).toBe(4780)
  })

  it('carries contract + paid onto each line', () => {
    const { lines } = gatherStatement(jobs, payments)
    const a = lines.find((l) => l.contactId === 'a')!
    expect(a.contract).toBe(1880)
    expect(a.paid).toBe(500)
    expect(a.balance).toBe(1380)
  })

  it('excludes non-billing stages and fully-paid jobs', () => {
    const ids = gatherStatement(jobs, payments).lines.map((l) => l.contactId)
    expect(ids).not.toContain('d') // fully paid
    expect(ids).not.toContain('e') // lead
    expect(ids).not.toContain('f') // lost
  })

  it('handles empty inputs', () => {
    expect(gatherStatement([], [])).toEqual({ lines: [], totalDue: 0 })
    expect(gatherStatement(undefined, undefined)).toEqual({ lines: [], totalDue: 0 })
  })

  it('folds APPROVED change orders into the contract (raises what is owed)', () => {
    const cos = [
      { contact_id: 'a', amount: 500, status: 'approved' },   // +500 to a
      { contact_id: 'a', amount: 200, status: 'draft' },      // ignored (not approved)
      { contact_id: 'c', amount: -100, status: 'approved' }   // credit on c
    ]
    const { lines, totalDue } = gatherStatement(jobs, payments, cos)
    const a = lines.find((l) => l.contactId === 'a')!
    expect(a.contract).toBe(2380)  // 1880 + 500
    expect(a.balance).toBe(1880)   // 2380 - 500 paid
    const c = lines.find((l) => l.contactId === 'c')!
    expect(c.contract).toBe(1300)  // 1400 - 100 credit
    expect(c.balance).toBe(800)    // 1300 - 500 paid
    // b unchanged (no CO): 2500. total = 1880 + 2500 + 800
    expect(totalDue).toBe(5180)
  })

  it('falls back through job_title → name → address for the property label', () => {
    const { lines } = gatherStatement(
      [{ id: 'x', name: 'Acme', address: '1 Main', stage: 'job', amount: 100 }],
      []
    )
    expect(lines[0].property).toBe('Acme')
  })
})
