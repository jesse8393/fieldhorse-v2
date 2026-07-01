// Universal search — Phase 19 / Audit Move #8.
//
// One query → results grouped across the 5 main entities:
//   jobs (fh_contacts), clients (fh_clients), notes (fh_notes),
//   events (fh_schedule), files (fh_job_files).
//
// All queries run in parallel; each is RLS-scoped (the supabase client
// uses the caller's JWT, so user_id filtering happens automatically via
// the policies in migrations 002 / 004 / 006 / 007).
//
// Every result row has a uniform shape so CommandPalette can render
// + navigate without per-type branching:
//   { id, kind, title, sub, to }
//     kind: 'job' | 'client' | 'note' | 'event' | 'file'
//     to:   internal route e.g. '/jobs/<id>'
//
// Pagination: 6 rows per kind. Universal search is for jumping to a
// known item, not for browsing — go to the dedicated screen for that.

import { supabase } from './supabase.ts'

const PER_KIND = 6

export type SearchKind = 'job' | 'client' | 'note' | 'event' | 'file'

export type SearchResult = {
  id: string
  kind: SearchKind
  title: string
  sub: string
  to: string
}

export type SearchResults = {
  jobs: SearchResult[]
  clients: SearchResult[]
  notes: SearchResult[]
  events: SearchResult[]
  files: SearchResult[]
  total: number
}

function pat(q: string) { return `%${q.replace(/[%_]/g, (m) => '\\' + m)}%` }

function fmtDateShort(iso: string | null | undefined) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return ''
  const d = new Date(iso)
  return `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ${d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`
}

function contactRoute(row: any) {
  const stage = String(row?.stage || '').toLowerCase()
  if (stage === 'lead' || stage === 'lost') return `/leads/${row.id}`
  if (stage === 'quote') return `/quotes/${row.id}?tab=quote`
  return `/jobs/${row.id}`
}

export async function universalSearch(query: string | null | undefined, userId: string | undefined): Promise<SearchResults> {
  const q = String(query || '').trim()
  if (!q || !userId) return { jobs: [], clients: [], notes: [], events: [], files: [], total: 0 }

  const like = pat(q)

  // Parallel — independent queries, no transactional concern.
  // Each .or() searches the most useful columns for that table.
  // Every query carries .eq('user_id', userId) for tenant isolation
  // defense-in-depth alongside RLS.
  const [jobsRes, clientsRes, notesRes, eventsRes, filesRes] = await Promise.all([
    supabase
      .from('fh_contacts')
      .select('id, name, job_title, job_type, stage, amount')
      .eq('user_id', userId)
      .or(`name.ilike.${like},job_title.ilike.${like},job_type.ilike.${like},phone.ilike.${like},email.ilike.${like},address.ilike.${like}`)
      .order('updated_at', { ascending: false })
      .limit(PER_KIND),

    supabase
      .from('fh_clients')
      .select('id, name, company_name, phone, email, active_jobs_count')
      .eq('user_id', userId)
      .or(`name.ilike.${like},company_name.ilike.${like},phone.ilike.${like},email.ilike.${like}`)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .limit(PER_KIND),

    supabase
      .from('fh_notes')
      .select('id, text, contact_id, created_at, fh_contacts(name)')
      .eq('user_id', userId)
      .ilike('text', like)
      .order('created_at', { ascending: false })
      .limit(PER_KIND),

    supabase
      .from('fh_schedule')
      .select('id, title, start_at, contact_id, fh_contacts(name)')
      .eq('user_id', userId)
      .ilike('title', like)
      .order('start_at', { ascending: false })
      .limit(PER_KIND),

    supabase
      .from('fh_job_files')
      .select('id, filename, kind, job_id, fh_contacts(name)')
      .eq('user_id', userId)
      .ilike('filename', like)
      .order('uploaded_at', { ascending: false })
      .limit(PER_KIND)
  ])

  // The embedded fh_contacts join makes the row types awkward to infer;
  // these are display mappers, so we read the rows loosely.
  const asRows = (d: unknown): any[] => (Array.isArray(d) ? d : [])

  const jobs: SearchResult[] = asRows(jobsRes.data).map((j) => ({
    id: `job:${j.id}`,
    kind: 'job',
    title: j.name || 'Untitled',
    sub: [j.job_title || j.job_type, j.stage?.toUpperCase(), j.amount ? `$${Math.round(j.amount).toLocaleString()}` : null].filter(Boolean).join(' · '),
    to: contactRoute(j)
  }))
  const clients: SearchResult[] = asRows(clientsRes.data).map((c) => ({
    id: `client:${c.id}`,
    kind: 'client',
    title: c.name || 'Unnamed',
    sub: [c.company_name, c.email || c.phone, c.active_jobs_count ? `${c.active_jobs_count} active` : null].filter(Boolean).join(' · '),
    to: `/clients/${c.id}`
  }))
  const notes: SearchResult[] = asRows(notesRes.data).map((n) => ({
    id: `note:${n.id}`,
    kind: 'note',
    title: (n.text || '').slice(0, 80) || 'Untitled note',
    sub: [n.fh_contacts?.name, fmtDateShort(n.created_at)].filter(Boolean).join(' · '),
    // Deep-link a note to its job (where it actually lives) instead of
    // always dumping the user on the generic /notes list.
    to: n.contact_id ? `/jobs/${n.contact_id}` : '/notes'
  }))
  const events: SearchResult[] = asRows(eventsRes.data).map((e) => ({
    id: `event:${e.id}`,
    kind: 'event',
    title: e.title || 'Untitled event',
    sub: [fmtDateTime(e.start_at), e.fh_contacts?.name].filter(Boolean).join(' · '),
    to: e.contact_id ? `/jobs/${e.contact_id}` : '/schedule'
  }))
  const files: SearchResult[] = asRows(filesRes.data).map((f) => ({
    id: `file:${f.id}`,
    kind: 'file',
    title: f.filename,
    sub: [f.kind === 'photo' ? 'Photo' : 'File', f.fh_contacts?.name].filter(Boolean).join(' · '),
    // A file lives on a job; an orphan (no job_id) shouldn't dump you on
    // Home — send it to the Jobs list instead.
    to: f.job_id ? `/jobs/${f.job_id}` : '/jobs'
  }))

  const total = jobs.length + clients.length + notes.length + events.length + files.length
  return { jobs, clients, notes, events, files, total }
}
