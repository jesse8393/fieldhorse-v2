import { HardHat } from 'lucide-react'
import { Button, EmptyState, Row, Sheet } from '../../components/fh'
import { hapticTap } from '../../lib/haptics.ts'
import type { MoneyJob } from './types.ts'

// "Create an invoice" from Money. An invoice is always billed against a
// job, and the existing flow for that is the Send invoice sheet the job
// page opens (components/SendInvoiceSheet.tsx: deposit, progress draw or
// final balance, amount, due window, send or save as a draft). So this
// sheet only asks which job, then hands that job to the same sheet.
// Leads, quotes and finished jobs are not offered.

export type InvoiceJobPickerProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  jobs: MoneyJob[]
  onPick: (job: MoneyJob) => void
}

export default function InvoiceJobPicker({ open, onOpenChange, jobs, onPick }: InvoiceJobPickerProps) {
  const active = jobs
    .filter((j) => j.stage === 'job' || j.stage === 'invoice')
    .sort((a, b) => String(b.updated_at || '').localeCompare(String(a.updated_at || '')))

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Which job is it for?">
      {active.length === 0 ? (
        <EmptyState
          icon={HardHat}
          title="No jobs to invoice yet."
          action={<Button variant="secondary" size="md" to="/work">Open jobs</Button>}
        />
      ) : (
        <ul className="fhm-rows">
          {active.map((job) => (
            <Row
              key={job.id}
              as="li"
              onClick={() => { hapticTap(); onPick(job) }}
              title={job.name || job.fh_clients?.name || 'Unnamed job'}
              subline={job.job_title || undefined}
              money={Number(job.amount || 0)}
            />
          ))}
        </ul>
      )}
    </Sheet>
  )
}
