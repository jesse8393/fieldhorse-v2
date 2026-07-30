// src/lib/clientTimeline.ts
//
// Composes a single chronological activity feed for a client across ALL
// their properties, payments collected, jobs started, notes logged,
// files/photos added. Pure over the data ClientDetail already loads, so
// it needs no extra queries and is trivially unit-tested.

export type TimelineEventKind = 'payment' | 'job' | 'note' | 'file'

export type TimelineEvent = {
  id: string
  kind: TimelineEventKind
  at: number            // epoch ms, for sorting
  atIso: string
  title: string         // primary line, e.g. "Payment received"
  detail?: string       // secondary line
  property?: string     // which job/property it happened on
  contactId?: string    // tap-through target
  amount?: number       // for payment events
}

type Job = {
  id: string
  name?: string | null
  job_title?: string | null
  stage?: string | null
  created_at?: string | null
}
type Payment = {
  contact_id?: string | null
  amount?: number | string | null
  paid_on?: string | null
  created_at?: string | null
  method?: string | null
}
type Note = {
  id?: string | null
  contact_id?: string | null
  text?: string | null
  category?: string | null
  created_at?: string | null
  fh_contacts?: { name?: string | null } | null
}
type FileRow = {
  id?: string | null
  job_id?: string | null
  filename?: string | null
  kind?: string | null
  uploaded_at?: string | null
  fh_contacts?: { name?: string | null } | null
}

function ms(iso: any): number {
  const t = new Date(iso || 0).getTime()
  return Number.isNaN(t) ? 0 : t
}

function propertyOf(job: Job | undefined): string {
  return job?.job_title || job?.name || 'Project'
}

export function composeClientTimeline(
  jobs: Job[] | null | undefined,
  payments: Payment[] | null | undefined,
  notes: Note[] | null | undefined,
  files: FileRow[] | null | undefined,
  limit = 60
): TimelineEvent[] {
  const byId = new Map<string, Job>((jobs || []).map((j) => [j.id, j]))
  const events: TimelineEvent[] = []

  // Payments, money in.
  ;(payments || []).forEach((p, i) => {
    const at = ms(p.paid_on || p.created_at)
    if (!at) return
    const job = p.contact_id ? byId.get(p.contact_id) : undefined
    const amt = Number(p.amount || 0)
    events.push({
      id: `pay-${p.contact_id}-${i}-${at}`,
      kind: 'payment',
      at,
      atIso: new Date(at).toISOString(),
      title: 'Payment received',
      detail: p.method ? `via ${p.method}` : undefined,
      property: propertyOf(job),
      contactId: p.contact_id || undefined,
      amount: amt
    })
  })

  // Jobs, one "started" event per property.
  ;(jobs || []).forEach((j) => {
    const at = ms(j.created_at)
    if (!at) return
    events.push({
      id: `job-${j.id}`,
      kind: 'job',
      at,
      atIso: new Date(at).toISOString(),
      title: 'Project added',
      property: propertyOf(j),
      contactId: j.id
    })
  })

  // Notes, skip pure activity-log rows (system breadcrumbs); keep the
  // operator's real notes.
  ;(notes || []).forEach((n) => {
    const at = ms(n.created_at)
    if (!at) return
    if (n.category === 'activity') return
    const text = (n.text || '').trim()
    events.push({
      id: `note-${n.id}`,
      kind: 'note',
      at,
      atIso: new Date(at).toISOString(),
      title: 'Note',
      detail: text.length > 120 ? `${text.slice(0, 117)}…` : text || undefined,
      property: n.fh_contacts?.name || undefined,
      contactId: n.contact_id || undefined
    })
  })

  // Files / photos.
  ;(files || []).forEach((f) => {
    const at = ms(f.uploaded_at)
    if (!at) return
    events.push({
      id: `file-${f.id}`,
      kind: 'file',
      at,
      atIso: new Date(at).toISOString(),
      title: f.kind === 'photo' ? 'Photo added' : 'File added',
      detail: f.filename || undefined,
      property: f.fh_contacts?.name || undefined,
      contactId: f.job_id || undefined
    })
  })

  events.sort((a, b) => b.at - a.at)
  return events.slice(0, limit)
}
