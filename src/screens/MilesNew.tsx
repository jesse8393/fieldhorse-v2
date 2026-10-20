// Log miles, /miles/new (Phase 9, Task 14, D57). It took the place of the
// mileage sheet Reports opened: the date, the miles, what the drive was
// for and the job it belongs to, with the deduction worked out as the
// miles are typed. One gold Save writes the fh_mileage row and goes back
// to Reports, which reads the new total.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Field } from '../components/fh'
import CreateShell from './new/CreateShell.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { MOVED_STAGE_FILTER } from '../lib/stages.ts'
import { useInvalidateAnalytics } from '../lib/queries.ts'
import { todayYmd } from '../lib/dates.ts'
import { toastError, toastSuccess } from '../lib/toast.ts'
import { hapticMedium } from '../lib/haptics.ts'

// The IRS standard mileage rate for 2026, per mile.
const IRS_RATE = 0.67

export default function MilesNew() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const refresh = useInvalidateAnalytics()
  const today = useMemo(() => todayYmd(), [])
  const [droveOn, setDroveOn] = useState(today)
  const [miles, setMiles] = useState('')
  const [purpose, setPurpose] = useState('')
  const [contactId, setContactId] = useState('')
  const [contacts, setContacts] = useState<{ id: string; name: string | null }[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    if (!user?.id) return
    let alive = true
    supabase
      .from('fh_contacts')
      .select('id, name')
      .eq('user_id', user.id)
      .not('stage', 'in', MOVED_STAGE_FILTER)
      .order('name', { ascending: true })
      .then(({ data }) => { if (alive) setContacts((data as { id: string; name: string | null }[]) || []) })
    return () => { alive = false }
  }, [user?.id])

  const milesNum = Number(miles) || 0
  const deduction = milesNum * IRS_RATE

  async function save() {
    if (saving || !user?.id) return
    if (!(milesNum > 0)) {
      setError('Enter the miles driven.')
      return
    }
    setSaving(true)
    setError(undefined)
    const { error: err } = await supabase.from('fh_mileage').insert({
      user_id: user.id,
      contact_id: contactId || null,
      miles: milesNum,
      drove_on: droveOn,
      purpose: purpose.trim() || null
    })
    if (err) {
      setSaving(false)
      setError(err.message || 'The miles were not saved.')
      toastError("Couldn't log miles", err.message || 'Try again in a moment.')
      return
    }
    hapticMedium()
    toastSuccess('Miles logged', 'Deduction updated')
    refresh()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/analytics', { replace: true })
  }

  return (
    <CreateShell
      title="Log miles"
      saveLabel={milesNum > 0 ? `Save ${milesNum} ${milesNum === 1 ? 'mile' : 'miles'}` : 'Save miles'}
      saving={saving}
      error={error}
      backTo="/analytics"
      onSave={save}
    >
      <p className="fhnew-lede">Every mile is ${IRS_RATE.toFixed(2)} deducted at tax time (IRS 2026 rate).</p>
      <Field label="Date" type="date" value={droveOn} onChange={(e) => setDroveOn(e.target.value)} />
      <Field
        label="Miles"
        type="number"
        inputMode="decimal"
        step="0.1"
        min="0"
        placeholder="0"
        value={miles}
        helper={milesNum > 0 ? `Deduction $${deduction.toFixed(2)}` : undefined}
        onChange={(e) => { setMiles(e.target.value); setError(undefined) }}
      />
      <Field
        label="Purpose"
        value={purpose}
        placeholder="Drive to the job site, supplier run, inspection"
        onChange={(e) => setPurpose(e.target.value)}
      />
      <div className="fhc-field">
        <label className="fhc-field__label" htmlFor="fh-miles-job">Job</label>
        <select
          id="fh-miles-job"
          className="fhc-field__control"
          value={contactId}
          onChange={(e) => setContactId(e.target.value)}
        >
          <option value="">No job</option>
          {contacts.map((c) => (
            <option key={c.id} value={c.id}>{c.name || 'Unnamed contact'}</option>
          ))}
        </select>
      </div>
    </CreateShell>
  )
}
