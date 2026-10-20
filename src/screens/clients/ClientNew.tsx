// New client (PHASE9_PLAN Task 8, SPEC D53, D59). The client is the root
// record: a name is all it needs, the rest can be filled later. Save lands
// on the client's page.

import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Field } from '../../components/fh'
import CreateShell, { useDraft } from '../new/CreateShell.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useMembership } from '../../contexts/MembershipContext.tsx'
import { supabase } from '../../lib/supabase.ts'
import { queryClient } from '../../lib/queryClient.ts'
import { recordRoute } from '../../lib/records.ts'
import { hapticMedium } from '../../lib/haptics.ts'

type Form = {
  name: string
  company: string
  phone: string
  email: string
  address: string
  notes: string
}

const EMPTY: Form = { name: '', company: '', phone: '', email: '', address: '', notes: '' }

export default function ClientNew() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { orgId } = useMembership()
  const [params] = useSearchParams()
  const text = params.get('text')
  const { form, set, done } = useDraft<Form>('client', EMPTY, text ? { name: text } : null)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ name?: string; save?: string }>({})

  async function save() {
    if (!user) return
    if (!form.name.trim()) { setErrors({ name: 'Enter a name.' }); return }
    setSaving(true)
    setErrors({})
    const row = {
      user_id: user.id,
      ...(orgId ? { org_id: orgId } : {}),
      name: form.name.trim(),
      company_name: form.company.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim().toLowerCase() || null,
      address: form.address.trim() || null,
      notes: form.notes.trim() || null
    }
    const { data, error } = await supabase.from('fh_clients').insert(row).select('id').single()
    if (error || !data) {
      setSaving(false)
      setErrors({ save: error?.message || 'Could not save this client. Check your connection and try again.' })
      return
    }
    void queryClient.invalidateQueries({ queryKey: ['clients'] })
    done()
    hapticMedium()
    navigate(recordRoute('client', (data as { id: string }).id), { replace: true })
  }

  return (
    <CreateShell title="New client" saveLabel="Save client" saving={saving} error={errors.save} onSave={save}>
      <Field label="Name" autoCapitalize="words" autoComplete="off" autoFocus value={form.name} error={errors.name} onChange={(e) => set('name', e.target.value)} />
      <Field label="Company" autoComplete="off" value={form.company} onChange={(e) => set('company', e.target.value)} />
      <Field label="Phone" type="tel" inputMode="tel" autoComplete="off" value={form.phone} onChange={(e) => set('phone', e.target.value)} />
      <Field label="Email" type="email" inputMode="email" autoComplete="off" value={form.email} onChange={(e) => set('email', e.target.value)} />
      <Field label="Address" autoComplete="off" value={form.address} onChange={(e) => set('address', e.target.value)} />
      <Field label="Notes" multiline value={form.notes} onChange={(e) => set('notes', e.target.value)} />
    </CreateShell>
  )
}
