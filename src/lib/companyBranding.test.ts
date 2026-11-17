import { beforeEach, describe, expect, it, vi } from 'vitest'

// Audit finding DATA-06: a teammate's documents printed "My Company"
// because the company block was built from their own profile.
const rpc = vi.fn()
vi.mock('./supabase.ts', () => ({ supabase: { rpc: (...args: unknown[]) => rpc(...args) } }))
vi.mock('../contexts/ProfileContext.tsx', () => ({ useProfile: () => ({ profile: null }) }))

const { documentProfile, fetchCompanyBranding } = await import('./companyBranding.ts')
const { companyFromProfile } = await import('./invoices.ts')
const quoteDocument = await import('../screens/quotes/quoteDocument.ts')

const OWNER_BRANDING = {
  org_id: 'org-1',
  company_name: 'Parker Construction Company',
  full_name: 'Jesse Parker',
  company_address: '100 Main St',
  company_phone: '615-555-0100',
  company_email: 'office@parker.co',
  logo_url: 'https://cdn.example/parker.png',
  license_number: 'TN-12345',
  payment_link: 'https://pay.example/parker'
}
// An invited admin's profile holds only the onboarding stamp.
const INVITED = { user_id: 'admin-1', onboarded_at: '2026-03-01' }

beforeEach(() => rpc.mockReset())

describe('fetchCompanyBranding', () => {
  it("asks for the record's company", async () => {
    rpc.mockResolvedValue({ data: OWNER_BRANDING, error: null })
    expect(await fetchCompanyBranding('org-1')).toEqual(OWNER_BRANDING)
    expect(rpc).toHaveBeenCalledWith('fh_company_branding', { p_org_id: 'org-1' })
  })

  it('reads nothing while the function is not deployed, so documents keep the own profile', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202', message: 'Could not find the function public.fh_company_branding(p_org_id) in the schema cache' } })
    expect(await fetchCompanyBranding('org-1')).toBeNull()
  })

  it('reads nothing for a company the person is not in', async () => {
    rpc.mockResolvedValue({ data: null, error: null })
    expect(await fetchCompanyBranding('org-2')).toBeNull()
  })

  it('throws when the read fails', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '08006', message: 'connection failure' } })
    await expect(fetchCompanyBranding('org-1')).rejects.toThrow('connection failure')
  })
})

describe("a teammate's documents", () => {
  it("print the company's name, address, licence, logo and payment link on an invoice", () => {
    expect(companyFromProfile(INVITED).name).toBe('My Company')
    const company = companyFromProfile(documentProfile(OWNER_BRANDING, INVITED))
    expect(company).toMatchObject({
      name: 'Parker Construction Company',
      address: '100 Main St',
      phone: '615-555-0100',
      email: 'office@parker.co',
      logo_url: 'https://cdn.example/parker.png',
      license_number: 'TN-12345',
      payment_link: 'https://pay.example/parker'
    })
  })

  it("print the company's name on a quote", () => {
    expect(quoteDocument.companyFromProfile(documentProfile(OWNER_BRANDING, INVITED)).name).toBe('Parker Construction Company')
  })

  it("keep the person's own profile when there is no company to read", () => {
    expect(documentProfile(null, INVITED)).toBe(INVITED)
    expect(documentProfile(undefined, INVITED)).toBe(INVITED)
  })
})
