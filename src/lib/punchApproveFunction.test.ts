import { describe, expect, it } from 'vitest'
import { netPunchMinutes, partitionApprovablePunches } from '../../netlify/functions/lib/punches.js'

const punch = (id: string, userId: string, inAt: string, outAt: string | null, breakMinutes = 0) => ({
  id,
  user_id: userId,
  punch_in_at: inAt,
  punch_out_at: outAt,
  break_minutes: breakMinutes,
})

describe('net punch minutes', () => {
  it('subtracts the break from wall clock time', () => {
    expect(netPunchMinutes(punch('p', 'u', '2026-10-01T08:00:00Z', '2026-10-01T16:30:00Z', 30))).toBe(480)
  })

  it('is zero for a reversed, empty, or open shift, or a break as long as the shift', () => {
    expect(netPunchMinutes(punch('p', 'u', '2026-10-01T16:00:00Z', '2026-10-01T08:00:00Z'))).toBe(0)
    expect(netPunchMinutes(punch('p', 'u', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'))).toBe(0)
    expect(netPunchMinutes(punch('p', 'u', '2026-10-01T08:00:00Z', null))).toBe(0)
    expect(netPunchMinutes(punch('p', 'u', '2026-10-01T08:00:00Z', '2026-10-01T08:30:00Z', 30))).toBe(0)
    expect(netPunchMinutes(null)).toBe(0)
  })
})

describe('which punches an approval may stamp', () => {
  const rows = [
    punch('good', 'crew-1', '2026-10-01T08:00:00Z', '2026-10-01T16:00:00Z'),
    punch('zero', 'crew-1', '2026-10-01T08:00:00Z', '2026-10-01T08:00:00Z'),
    punch('backwards', 'crew-2', '2026-10-01T17:00:00Z', '2026-10-01T09:00:00Z'),
    punch('mine', 'manager-1', '2026-10-01T07:00:00Z', '2026-10-01T21:00:00Z'),
  ]

  it('skips zero length shifts and a manager or admin approving their own hours', () => {
    for (const callerRole of ['manager', 'admin']) {
      const res = partitionApprovablePunches(rows, { callerId: 'manager-1', callerRole })
      expect(res.approvable.map((p: any) => p.id)).toEqual(['good'])
      expect(res.invalidIds).toEqual(['zero', 'backwards'])
      expect(res.selfIds).toEqual(['mine'])
    }
  })

  it('lets an owner approve their own hours but never an invalid shift', () => {
    const res = partitionApprovablePunches(rows, { callerId: 'manager-1', callerRole: 'owner' })
    expect(res.approvable.map((p: any) => p.id)).toEqual(['good', 'mine'])
    expect(res.invalidIds).toEqual(['zero', 'backwards'])
    expect(res.selfIds).toEqual([])
  })

  it('tolerates an empty lookup', () => {
    expect(partitionApprovablePunches(null, { callerId: 'x', callerRole: 'owner' })).toEqual({
      approvable: [],
      invalidIds: [],
      selfIds: [],
    })
  })
})
