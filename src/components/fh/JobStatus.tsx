import { railStage, type RailRecord } from '../../lib/stageRail.ts'

/** Uses the same lifecycle rules as the full rail, including completed work
 * that still awaits payment and legacy lead/quote records. */
export default function JobStatus({ record }: { record: RailRecord }) {
  const state = railStage(record)
  const label = state.lost ? 'Lost' : state.current ? {
    lead: 'Lead', quote: 'Quote', job: 'In progress',
    invoice: 'Work complete', closed: 'Closed',
  }[state.current] : null
  if (!label) return null
  return <span className={`fh-job-status${state.current === 'job' ? '' : ' fh-job-status--neutral'}`}>{label}</span>
}
