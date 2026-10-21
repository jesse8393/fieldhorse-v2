// Old links keep working (PHASE9_PLAN Task 7). /leads/:id and /quotes/:id
// take three kinds of id: a row of the new table (shown here until Tasks 9
// and 10 build the real screens), an old fh_contacts id the migration moved
// (the old detail screen reads the row, sees the moved stage and renders
// MovedRecordRedirect, which replaces the history entry with the new
// record) and a contact that is still a live row (the old detail screen
// renders it).
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { IconButton } from './fh'
import { findMovedRecord, findRecordTitle, type MovedRecord, type RecordTitle } from '../lib/movedRecord.ts'
import { recordRoute } from '../lib/records.ts'

type State =
  | { status: 'looking' }
  | { status: 'record'; record: RecordTitle }
  | { status: 'elsewhere' }

/**
 * Sends an old contact id on to the lead or quote that replaced it. Renders
 * `fallback` when nothing points back at the id (the row was never moved, or
 * is simply gone).
 */
export function MovedRecordRedirect({ id, fallback }: { id: string; fallback: ReactNode }) {
  const navigate = useNavigate()
  const [moved, setMoved] = useState<MovedRecord | null | undefined>(undefined)
  useEffect(() => {
    let alive = true
    setMoved(undefined)
    void findMovedRecord(id).then((found) => { if (alive) setMoved(found) })
    return () => { alive = false }
  }, [id])
  useEffect(() => {
    if (moved) navigate(recordRoute(moved.kind, moved.id), { replace: true })
  }, [moved, navigate])
  if (moved === undefined || moved) return null
  return <>{fallback}</>
}

/**
 * The /leads/:id and /quotes/:id route until the real screens land: the
 * record's title with Back when the id is a row of the new table, otherwise
 * `fallback` (the old detail screen, which redirects a moved row itself).
 */
export function NewRecordRoute({ kind, id, fallback }: { kind: MovedRecord['kind']; id: string; fallback: ReactNode }) {
  const navigate = useNavigate()
  const [state, setState] = useState<State>({ status: 'looking' })
  useEffect(() => {
    let alive = true
    setState({ status: 'looking' })
    void findRecordTitle(kind, id).then((record) => {
      if (alive) setState(record ? { status: 'record', record } : { status: 'elsewhere' })
    })
    return () => { alive = false }
  }, [kind, id])

  if (state.status === 'looking') return null
  if (state.status === 'elsewhere') return <>{fallback}</>

  const noun = kind === 'lead' ? 'Lead' : 'Quote'
  const goBack = () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/jobs')
  }
  return (
    <div style={{ padding: '12px 16px 24px', minHeight: '100%', background: 'var(--v3-bg)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
        <span style={{ color: 'var(--v3-text-muted)', fontSize: 14 }}>{noun}</span>
      </header>
      <h1 style={{ margin: '16px 0 0', fontSize: 24, lineHeight: 1.2, color: 'var(--v3-text)' }}>
        {state.record.title || `Untitled ${noun.toLowerCase()}`}
      </h1>
    </div>
  )
}
