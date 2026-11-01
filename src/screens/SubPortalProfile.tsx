// A sub's own profile, /sub-portal/profile (Phase 9, Task 14, D57). It
// took the place of the edit dialog on the sub portal: phone, address,
// EIN, license, insurance and how to get paid, saved with one gold
// button. Only what changed is sent: the form starts from a profile
// merged across every contractor, so sending the whole form would copy
// one contractor's values onto all the others.

import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Field, SkeletonRows } from '../components/fh'
import CreateShell from './new/CreateShell.tsx'
import DataErrorState from '../components/DataErrorState.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { mergedProfile, subPortalContext, subProfileUpdate, type SubProfile, type SubProfileUpdate } from '../lib/subApi.ts'
import { toastSuccess } from '../lib/toast.ts'
import { hapticMedium } from '../lib/haptics.ts'
import { keepFocusOnRetry } from '../lib/retryFocus.ts'

const FIELDS: Array<keyof SubProfileUpdate> = [
  'phone', 'address', 'ein', 'insurance_carrier', 'insurance_policy', 'insurance_expires_on', 'license_number', 'payment_handle', 'payment_method'
]

function formFrom(profile: SubProfile): SubProfileUpdate {
  const out: Record<string, unknown> = {}
  for (const key of FIELDS) out[key] = (profile as Record<string, unknown>)[key] ?? null
  return out as SubProfileUpdate
}

export default function SubPortalProfile() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { loading: memLoading } = useMembership()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [initial, setInitial] = useState<SubProfile | null>(null)
  const [form, setForm] = useState<SubProfileUpdate>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (memLoading || !user) return
    let alive = true
    setLoading(true)
    setLoadError(null)
    subPortalContext()
      .then((res) => {
        if (!alive) return
        const profile = mergedProfile(res.matched_profiles || [])
        setInitial(profile)
        if (profile) setForm(formFrom(profile))
      })
      .catch((e: any) => {
        if (!alive) return
        setLoadError(e?.detail || e?.message || 'Could not load your profile.')
      })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [memLoading, user, tick])

  function set<K extends keyof SubProfileUpdate>(key: K, value: SubProfileUpdate[K]) {
    setForm((f) => ({ ...f, [key]: value }))
    setError(undefined)
  }

  function goBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/sub-portal', { replace: true })
  }

  async function save() {
    if (saving || loading || loadError || !initial) return
    const norm = (v: unknown) => (v == null ? '' : String(v).trim())
    const changed: SubProfileUpdate = {}
    for (const key of FIELDS) {
      if (norm((initial as Record<string, unknown>)[key]) !== norm(form[key])) {
        (changed as Record<string, unknown>)[key] = form[key]
      }
    }
    if (Object.keys(changed).length === 0) {
      goBack()
      return
    }
    setSaving(true)
    setError(undefined)
    try {
      await subProfileUpdate(changed)
      hapticMedium()
      toastSuccess('Profile updated')
      goBack()
    } catch (e: any) {
      setError(e?.detail || e?.message || 'Update failed.')
      setSaving(false)
    }
  }

  const text = (key: keyof SubProfileUpdate) => (form[key] == null ? '' : String(form[key]))

  return (
    <CreateShell title="Edit profile" saveLabel="Save changes" saving={saving} saveDisabled={loading || !!loadError || !initial} error={error} backTo="/sub-portal" onSave={save}>
      <p className="fhnew-lede">
        Updates apply to every contractor that has you on file. They can't change your name, company or email; those stay under each GC's control.
      </p>
      {loading && <SkeletonRows rows={4} label="Loading your profile" />}
      {!loading && (loadError || !initial) && (
        <DataErrorState
          title={loadError ? "Couldn't load your profile" : 'No profile yet'}
          message={loadError || 'When a contractor adds you to a job, your profile shows up here.'}
          actionLabel="Try again"
          onRetry={loadError ? () => { keepFocusOnRetry(); setTick((n) => n + 1) } : undefined}
        />
      )}
      {!loading && !loadError && initial && (
        <>
          <Field label="Phone" type="tel" inputMode="tel" value={text('phone')} onChange={(e) => set('phone', e.target.value)} />
          <Field label="Address" value={text('address')} onChange={(e) => set('address', e.target.value)} />
          <Field label="EIN" value={text('ein')} onChange={(e) => set('ein', e.target.value)} />
          <Field label="License number" value={text('license_number')} onChange={(e) => set('license_number', e.target.value)} />
          <Field label="Insurance carrier" value={text('insurance_carrier')} onChange={(e) => set('insurance_carrier', e.target.value)} />
          <Field label="Policy number" value={text('insurance_policy')} onChange={(e) => set('insurance_policy', e.target.value)} />
          <Field label="Insurance expires" type="date" value={text('insurance_expires_on')} onChange={(e) => set('insurance_expires_on', e.target.value || null)} />
          <Field label="Payment method" value={text('payment_method')} placeholder="ACH, check, Zelle or Venmo" onChange={(e) => set('payment_method', e.target.value)} />
          <Field label="Payment handle or account" value={text('payment_handle')} placeholder="@you or the last four" onChange={(e) => set('payment_handle', e.target.value)} />
        </>
      )}
    </CreateShell>
  )
}
