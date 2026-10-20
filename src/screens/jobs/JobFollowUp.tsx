// Set a job's follow up, /jobs/:id/follow-up (Phase 9, Task 13, D57). It
// took the place of the follow up view inside the more sheet: tomorrow, in
// 3 days or next week with one tap, a picked date with Set date, and Clear
// follow up when one is set. Every choice saves and goes back to the job.

import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Button, Field } from '../../components/fh'
import CreateShell from '../new/CreateShell.tsx'
import { FOLLOW_UP_PRESETS, followUpMeta, localYmd, saveFollowUp, type FollowUpWhen } from '../../lib/followUp.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { JobScreenFallback, useJobScreen } from './jobScreen.tsx'

export default function JobFollowUp() {
  const { id } = useParams()
  const { user, data, home } = useJobScreen(id)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [picked, setPicked] = useState('')
  const [error, setError] = useState<string | undefined>()
  const [saving, setSaving] = useState(false)

  const contact = data.contact
  if (!contact || data.loading) return <JobScreenFallback title="Set follow up" saveLabel="Set date" data={data} home={home} />

  const current = contact.follow_up_on ?? null
  const currentLabel = followUpMeta(current)?.label

  async function set(when: FollowUpWhen) {
    if (saving || !contact) return
    hapticTap()
    setSaving(true)
    // saveFollowUp toasts and patches the caches itself; a failure keeps
    // the screen so the person can try again.
    const res = await saveFollowUp(queryClient, contact, user?.id, when)
    setSaving(false)
    if (res.error) { setError(res.error.message); return }
    // Saving lands on the job, whichever screen led here.
    navigate(home, { replace: true })
  }

  function setDate() {
    const d = picked ? new Date(`${picked}T00:00:00`) : null
    if (!d || Number.isNaN(d.getTime())) {
      setError('Pick a date, then tap Set date.')
      return
    }
    void set(d)
  }

  return (
    <CreateShell title="Set follow up" saveLabel="Set date" saving={saving} error={error} backTo={home} onSave={setDate}>
      <p className="fhja-lede">
        {currentLabel ? `Follow up ${currentLabel.charAt(0).toLowerCase()}${currentLabel.slice(1)} on ${contact.name || 'this job'}.` : `When to get back to ${contact.name || 'this job'}.`}
      </p>
      <div className="fhja-choices" role="group" aria-label="Follow up">
        {FOLLOW_UP_PRESETS.map((p) => (
          <Button key={p.days} variant="secondary" size="lg" block disabled={saving} onClick={() => { void set(p.days) }}>
            {p.label}
          </Button>
        ))}
      </div>
      <Field
        label="Pick a date"
        type="date"
        min={localYmd(new Date())}
        value={picked}
        onChange={(e) => { setPicked(e.target.value); setError(undefined) }}
      />
      {current && (
        <div className="fhja-danger">
          <Button variant="quiet" block disabled={saving} onClick={() => { void set(null) }}>Clear follow up</Button>
        </div>
      )}
    </CreateShell>
  )
}
