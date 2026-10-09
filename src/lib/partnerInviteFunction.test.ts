import { describe, expect, it } from 'vitest'
import { buildResendPatch } from '../../netlify/functions/partner-invite.js'

const base = { nowIso: '2026-10-09T12:00:00.000Z', newToken: 'f'.repeat(48) }

describe('re-inviting a partner who is already on the job', () => {
  it('reissues a revoked invite as a fresh pending invite with a new token', () => {
    const { patch, reissue } = buildResendPatch({ ...base, status: 'revoked', partnerName: 'Dana', partnerRole: 'Foreman' })
    expect(reissue).toBe(true)
    expect(patch).toEqual({
      partner_name: 'Dana',
      partner_role: 'Foreman',
      status: 'pending',
      invite_token: base.newToken,
      partner_user_id: null,
      accepted_at: null,
      invited_at: base.nowIso,
      deleted_by_partner_at: null,
      deleted_by_invited_at: null,
    })
  })

  it('reissues a declined invite too', () => {
    expect(buildResendPatch({ ...base, status: 'declined', partnerName: null, partnerRole: null }).reissue).toBe(true)
  })

  it('keeps the live token for a pending or accepted invite and only backfills identity', () => {
    for (const status of ['pending', 'accepted']) {
      const { patch, reissue } = buildResendPatch({ ...base, status, partnerName: 'Dana', partnerRole: null })
      expect(reissue).toBe(false)
      expect(patch).toEqual({ partner_name: 'Dana' })
    }
    expect(buildResendPatch({ ...base, status: 'pending', partnerName: null, partnerRole: null }).patch).toEqual({})
  })
})
