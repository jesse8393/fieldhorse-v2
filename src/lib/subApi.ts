// subApi — typed client wrappers for the /api/sub-* Netlify functions.
//
// All endpoints require an authenticated session.

import { supabase } from './supabase.ts'

export type DocKind = 'coi' | 'w9' | 'license'

export type SubProfile = {
  id: string
  org_id: string | null
  name: string | null
  company: string | null
  email: string | null
  phone: string | null
  address: string | null
  ein: string | null
  trades: string[] | null
  insurance_carrier: string | null
  insurance_policy: string | null
  insurance_expires_on: string | null
  coi_path: string | null
  w9_path: string | null
  license_path: string | null
  license_number: string | null
  payment_handle: string | null
  payment_method: string | null
  notes: string | null
  created_at: string | null
  updated_at: string | null
}

export type AcceptedPartner = {
  id: string
  job_id: string
  partner_role: string | null
  accepted_at: string | null
  invited_at: string | null
  status: string
  org_id: string | null
  invited_by_user_id: string
}

export type SubJob = {
  id: string
  name: string | null
  address: string | null
  stage: string | null
  amount: number | null
  updated_at: string | null
  job_title: string | null
}

export type SubPayment = {
  id: string
  contact_id: string | null
  amount: number
  kind: string | null
  method: string | null
  reference: string | null
  paid_on: string | null
  created_at: string | null
}

export type SubPortalContext = {
  auth: { email: string; user_id: string }
  matched_profiles: SubProfile[]
  accepted_partners: AcceptedPartner[]
  linked_jobs: Record<string, SubJob>
  payments: SubPayment[]
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function callJson<T>(path: string, body: any): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeader()) },
    body: JSON.stringify(body || {}),
  })
  const text = await res.text()
  let parsed: any
  try { parsed = text ? JSON.parse(text) : {} } catch { parsed = {} }
  if (!res.ok) {
    const err = new Error(parsed?.error || `http_${res.status}`)
    ;(err as any).status = res.status
    ;(err as any).detail = parsed?.detail || parsed?.message || null
    throw err
  }
  return parsed as T
}

// Profile-editable fields the sub controls. Matches the server-side
// allowlist in /api/sub-profile-update.
export type SubProfileUpdate = Partial<{
  phone: string | null
  address: string | null
  ein: string | null
  trades: string[] | null
  insurance_carrier: string | null
  insurance_policy: string | null
  insurance_expires_on: string | null   // YYYY-MM-DD
  license_number: string | null
  payment_handle: string | null
  payment_method: string | null
  notes: string | null
}>

export function subPortalContext(): Promise<{ ok: true } & SubPortalContext> {
  return callJson('/api/sub-portal-context', {})
}

export function subProfileUpdate(
  fields: SubProfileUpdate,
): Promise<{ ok: true; updated_count: number; updated_ids: string[] }> {
  return callJson('/api/sub-profile-update', { fields })
}

// One-shot doc upload: ask for a signed URL, PUT the file, then
// confirm. Returns the storage path written into the profile.
export async function subUploadDoc(file: File, kind: DocKind): Promise<{ storage_path: string }> {
  // 1) Sign.
  const sign = await callJson<{
    ok: true
    bucket: string
    storage_path: string
    signed_url: string
    token: string
    content_type: string
  }>('/api/sub-doc-upload-url', {
    kind,
    filename: file.name,
    content_type: file.type || 'application/octet-stream',
  })

  // 2) PUT into Supabase Storage via the signed URL. The signed-upload
  //    URL pattern uses an `upload` PUT — supabase-js abstracts that.
  const { error: upErr } = await supabase.storage
    .from(sign.bucket)
    .uploadToSignedUrl(sign.storage_path, sign.token, file, {
      contentType: file.type || sign.content_type,
      upsert: true,
    })
  if (upErr) throw upErr

  // 3) Confirm — writes the storage_path onto every matching sub_profile.
  await callJson('/api/sub-doc-confirm', { kind, storage_path: sign.storage_path })

  return { storage_path: sign.storage_path }
}

// Get a signed READ URL so we can render thumbnails / Open buttons
// after upload. Storage stays private; URLs are short-lived.
export async function subDocSignedUrl(storagePath: string, ttlSec = 600): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('sub-docs')
    .createSignedUrl(storagePath, ttlSec)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}
