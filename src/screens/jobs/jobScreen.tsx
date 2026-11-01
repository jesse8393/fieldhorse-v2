// What the job's action screens share (Phase 9, Task 13, D57): the job
// read through the same hook as the job page, the fallback while it loads
// or when it is gone, and Back that returns to the job when there is no
// history behind the screen.

import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import CreateShell from '../new/CreateShell.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useJobData } from '../ContactDetail/hooks/useJobData.ts'
import { recordRoute } from '../../lib/records.ts'
import { hapticTap } from '../../lib/haptics.ts'
import './job-actions.css'

export type JobData = ReturnType<typeof useJobData>

/** The job behind an action screen, and where its Back goes. */
export function useJobScreen(id: string | undefined) {
  const { user } = useAuth()
  const data = useJobData(id, user?.id)
  const home = recordRoute('job', id || '')
  const navigate = useNavigate()
  function goBack() {
    hapticTap()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate(home, { replace: true })
  }
  return { user, data, home, goBack }
}

/** The screen while the job loads, or when it could not be read. */
export function JobScreenFallback({ title, saveLabel, data, home }: { title: string; saveLabel: string; data: JobData; home: string }) {
  const body: ReactNode = data.loading ? (
    <SkeletonRows rows={4} label="Loading the job" />
  ) : (
    <DataErrorState
      title={data.isError ? "Couldn't load this job" : 'This job is gone'}
      message={data.isError ? 'Check your connection and try again. Nothing was changed.' : 'It may have been deleted.'}
      actionLabel={data.isError ? 'Try again' : ''}
      onRetry={() => { void data.fetchAll() }}
    />
  )
  return (
    <CreateShell title={title} saveLabel={saveLabel} saveDisabled backTo={home} onSave={() => {}}>
      {body}
    </CreateShell>
  )
}

export function money(n: unknown) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
