import { describe, expect, it } from 'vitest'
import { linkScope } from '../../netlify/functions/lib/linkScope.js'

describe('customer link scope', () => {
  it('matches rows in the link company, whoever created them', () => {
    expect(linkScope({ org_id: 'org-1', user_id: 'admin-1' })).toEqual({ org_id: 'org-1' })
  })

  it('falls back to the creator for links made before org stamping', () => {
    expect(linkScope({ org_id: null, user_id: 'owner-1' })).toEqual({ user_id: 'owner-1' })
  })
})
