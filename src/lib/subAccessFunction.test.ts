import { describe, expect, it } from 'vitest'
import {
  boundSubOrgIds,
  normalizeEmail,
  sanitizeSubProfilePatch,
  SUB_EDITABLE_FIELDS,
  SUB_DOC_TYPES,
} from '../../netlify/functions/lib/subAccess.js'

// Minimal awaitable stand in for the supabase-js query builder.
function fakeClient(tables: Record<string, any[]>) {
  return {
    from(table: string) {
      const filters: Array<(r: any) => boolean> = []
      const api: any = {
        select: () => api,
        eq: (col: string, v: any) => { filters.push((r) => r[col] === v); return api },
        in: (col: string, vs: any[]) => { filters.push((r) => vs.includes(r[col])); return api },
        limit: () => api,
        then: (resolve: any) => resolve({ data: (tables[table] || []).filter((r) => filters.every((f) => f(r))), error: null }),
      }
      return api
    },
  } as any
}

describe('sub portal binding', () => {
  const tables = {
    fh_job_partners: [
      { job_id: 'job-a', partner_user_id: 'sub-1', status: 'accepted' },
      { job_id: 'job-b', partner_user_id: 'sub-1', status: 'pending' },
      { job_id: 'job-c', partner_user_id: 'sub-1', status: 'revoked' },
      { job_id: 'job-d', partner_user_id: 'someone-else', status: 'accepted' },
    ],
    fh_contacts: [
      { id: 'job-a', org_id: 'org-a' },
      { id: 'job-b', org_id: 'org-b' },
      { id: 'job-c', org_id: 'org-c' },
      { id: 'job-d', org_id: 'org-d' },
    ],
  }

  it('only binds orgs where the sub accepted a job invite', async () => {
    const { orgIds } = await boundSubOrgIds(fakeClient(tables), 'sub-1')
    expect(orgIds).toEqual(['org-a'])
  })

  it('binds nothing for a stranger who only shares an email', async () => {
    const { orgIds } = await boundSubOrgIds(fakeClient(tables), 'stranger')
    expect(orgIds).toEqual([])
  })
})

describe('sub profile patch', () => {
  it('never lets a sub write the contractor notes, name, email or document paths', () => {
    const { patch } = sanitizeSubProfilePatch({
      phone: ' 615 555 0100 ',
      notes: 'copied from another contractor',
      name: 'New name',
      email: 'x@y.com',
      coi_path: 'someone/else.pdf',
    })
    expect(patch).toEqual({ phone: '615 555 0100' })
    expect(SUB_EDITABLE_FIELDS).not.toContain('notes')
  })

  it('turns blank strings into null and keeps calendar dates as typed', () => {
    const { patch } = sanitizeSubProfilePatch({ address: '   ', insurance_expires_on: '2026-12-31' })
    expect(patch).toEqual({ address: null, insurance_expires_on: '2026-12-31' })
  })

  it('rejects impossible dates, non text values and oversized text', () => {
    expect(sanitizeSubProfilePatch({ insurance_expires_on: '2026-02-30' }).error).toBe('invalid_expires')
    expect(sanitizeSubProfilePatch({ phone: 12345 }).error).toBe('invalid_field')
    expect(sanitizeSubProfilePatch({ phone: { $gt: '' } }).error).toBe('invalid_field')
    expect(sanitizeSubProfilePatch({ address: 'x'.repeat(301) }).error).toBe('invalid_field')
  })

  it('cleans trades and refuses a non list', () => {
    expect(sanitizeSubProfilePatch({ trades: [' Framing ', '', 7, 'Drywall'] }).patch).toEqual({ trades: ['Framing', 'Drywall'] })
    expect(sanitizeSubProfilePatch({ trades: 'Framing' }).error).toBe('invalid_trades')
  })

  it('requires an object with at least one editable field', () => {
    expect(sanitizeSubProfilePatch(null).error).toBe('missing_fields')
    expect(sanitizeSubProfilePatch(['phone']).error).toBe('missing_fields')
    expect(sanitizeSubProfilePatch({ notes: 'only notes' }).error).toBe('no_writable_fields')
  })
})

describe('sub portal helpers', () => {
  it('normalizes emails the same way the database trigger does', () => {
    expect(normalizeEmail('  Mike.Diaz@Gmail.com ')).toBe('mike.diaz@gmail.com')
    expect(normalizeEmail(null)).toBe('')
  })

  it('accepts only the document types the bucket allows', () => {
    expect(Object.keys(SUB_DOC_TYPES).sort()).toEqual(['application/pdf', 'image/jpeg', 'image/png'])
  })
})
