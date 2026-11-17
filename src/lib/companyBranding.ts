// The company a customer document is printed for (audit DATA-06).
//
// Quote, invoice, draw, statement and certificate PDFs are built in the
// browser, and their company block (name, address, logo, licence, payment
// details) used to come from the profile of whoever tapped the button. A
// teammate's profile holds no company details, so their documents printed
// "My Company". The block now comes from the company the record belongs
// to: fh_company_branding (migration 20261117161700) returns, for an
// active member, the document fields of that company's owner, the profile
// the email and the customer link are branded from on the server, with the
// company's own name when the owner's profile has none.
//
// Until the migration is applied the function is missing, and documents
// are built from the person's own profile as before.

import { useCallback } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase.ts'
import { useProfile } from '../contexts/ProfileContext.tsx'

/** The fields of a profile a document's company block is built from. */
export type CompanyBranding = {
  org_id?: string | null
  company_name?: string | null
  full_name?: string | null
  company_address?: string | null
  company_phone?: string | null
  company_email?: string | null
  company_website?: string | null
  logo_url?: string | null
  brand_accent_hex?: string | null
  license_number?: string | null
  insured_text?: string | null
  payment_link?: string | null
  payment_instructions?: string | null
  estimate_template?: string | null
  warranty_default?: string | null
}

const FUNCTION = 'fh_company_branding'

export const companyBrandingKey = (orgId: string | null | undefined) => ['companyBranding', orgId ?? null] as const

function functionMissing(error: { code?: string; message?: string }) {
  return error.code === 'PGRST202' || error.code === '42883' || /could not find the function/i.test(error.message || '')
}

/**
 * The branding of company `orgId`, or null when there is none to read: the
 * function is not deployed yet, or the person is not a member. Throws when
 * the read fails.
 */
export async function fetchCompanyBranding(orgId: string): Promise<CompanyBranding | null> {
  // The generated types do not list the function until its migration is applied.
  const rpc = supabase.rpc.bind(supabase) as unknown as (name: string, args: Record<string, unknown>) => PromiseLike<{ data: unknown; error: { code?: string; message?: string } | null }>
  const { data, error } = await rpc(FUNCTION, { p_org_id: orgId })
  if (error) {
    if (functionMissing(error)) return null
    throw Object.assign(new Error(error.message || "Couldn't read the company details."), { code: error.code })
  }
  return data && typeof data === 'object' && !Array.isArray(data) ? (data as CompanyBranding) : null
}

/** The company's branding when there is one, else the person's own profile. */
export function documentProfile<P>(branding: CompanyBranding | null | undefined, own: P): CompanyBranding | P {
  return branding ?? own
}

/**
 * The profile to build a document's company block from (companyFromProfile)
 * for a record of company `orgId`. `profile` is what is known now, for a
 * screen to show; `load` reads the company's details again for a document
 * about to be built, so a change made in Settings a moment ago is in it.
 * When that read fails (no signal on a job site), the copy read when the
 * screen opened is used.
 */
export function useDocumentProfile(orgId: string | null | undefined) {
  const { profile: own } = useProfile()
  const queryClient = useQueryClient()
  const key = companyBrandingKey(orgId)
  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchCompanyBranding(orgId as string),
    enabled: !!orgId
  })
  const profile = documentProfile(orgId ? query.data : null, own)
  const load = useCallback(async () => {
    if (!orgId) return own
    const branding = await queryClient
      .fetchQuery({ queryKey: companyBrandingKey(orgId), queryFn: () => fetchCompanyBranding(orgId), staleTime: 0 })
      .catch(() => queryClient.getQueryData<CompanyBranding | null>(companyBrandingKey(orgId)) ?? null)
    return documentProfile(branding, own)
  }, [orgId, own, queryClient])
  return { profile, load }
}
