import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase.ts'
import { orgMembersList } from '../../../lib/orgApi.ts'
import type { OrgRole } from '../../../lib/permissions.ts'
import type { DocumentFile, DocumentInvoice } from '../lib/jobDesktop.ts'

// What the desktop facts panel (spec 9.11) reads beyond the job's own
// record: who the job is shared with, its invoices and uploaded files,
// and the names of the teammates assigned to it. Each read is best
// effort, because the panel is a summary: a failed read leaves its
// section on its empty line and never blocks the page.
//
// The panel mounts on desktop only, so a phone never runs these.

export type JobPartner = {
  id: string
  partner_name: string | null
  partner_email: string
  partner_role: string | null
  status: string
}

/** Partners the job is shared with, pending and accepted, newest first. */
export function useJobPartners(jobId: string | null | undefined) {
  return useQuery({
    queryKey: ['jobFacts', 'partners', jobId],
    enabled: !!jobId,
    queryFn: async (): Promise<JobPartner[]> => {
      const { data, error } = await supabase
        .from('fh_job_partners')
        .select('id, partner_name, partner_email, partner_role, status, invited_at')
        .eq('job_id', jobId as string)
        .is('deleted_by_invited_at', null)
        .order('invited_at', { ascending: false })
      if (error) throw error
      return ((data || []) as (JobPartner & { invited_at?: string | null })[])
        .filter((p) => p.status === 'pending' || p.status === 'accepted')
        .map(({ id, partner_name, partner_email, partner_role, status }) => ({ id, partner_name, partner_email, partner_role, status }))
    }
  })
}

/** Invoices (money roles only) and uploaded files, for the Documents section. */
export function useJobDocumentSources(jobId: string | null | undefined, canSeeMoney: boolean) {
  const invoices = useQuery({
    queryKey: ['jobFacts', 'invoices', jobId],
    enabled: !!jobId && canSeeMoney,
    queryFn: async (): Promise<DocumentInvoice[]> => {
      const { data, error } = await supabase
        .from('fh_invoices')
        .select('id, sequence_number, title, status, issued_at, due_at')
        .eq('contact_id', jobId as string)
        .order('sequence_number', { ascending: true })
      if (error) throw error
      return (data || []) as DocumentInvoice[]
    }
  })

  const files = useQuery({
    queryKey: ['jobFacts', 'files', jobId],
    enabled: !!jobId,
    queryFn: async (): Promise<DocumentFile[]> => {
      const { data, error } = await supabase
        .from('fh_job_files')
        .select('id, kind, filename, uploaded_at')
        .eq('job_id', jobId as string)
        .neq('kind', 'photo')
        .order('uploaded_at', { ascending: false })
        .limit(10)
      if (error) throw error
      // Photos belong to the Spine and the Files tab, whatever the filter says.
      return ((data || []) as (DocumentFile & { kind?: string | null })[]).filter((f) => f.kind !== 'photo')
    }
  })

  return { invoices: invoices.data ?? [], files: files.data ?? [] }
}

export type JobCrewMember = { id: string; name: string; role: OrgRole | null }

/**
 * The teammates assigned to this job, by id: whoever an open task or a
 * scheduled visit names. Names come from the company's member list, which
 * is only asked for when someone is assigned. A name that does not
 * resolve reads "Teammate".
 */
export function useJobCrew(assignedIds: string[]) {
  const key = [...new Set(assignedIds)].sort()
  const { data } = useQuery({
    queryKey: ['jobFacts', 'members'],
    enabled: key.length > 0,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await orgMembersList()
      return res.members || []
    }
  })
  const byId = new Map((data || []).map((m) => [m.user_id, m]))
  return key.map((id): JobCrewMember => {
    const m = byId.get(id)
    return { id, name: m?.is_self ? 'You' : (m?.name || m?.email || 'Teammate'), role: m?.role ?? null }
  })
}
