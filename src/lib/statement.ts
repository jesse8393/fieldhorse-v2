// src/lib/statement.ts
//
// Client statement — one rollup of every OPEN invoice across all of a
// client's properties/jobs. Built for repeat clients (e.g. a property
// manager with several buildings) who want a single "here's everything
// I owe you" document instead of one invoice per job.
//
// "Open" = invoice status in (sent, overdue). Drafts aren't real bills
// yet; paid/void are settled. That mirrors what the customer expects to
// see — the invoices you've actually issued that aren't yet paid.

import { supabase } from './supabase.ts'
import { generateStatement, downloadPdf } from './pdf.js'

export type StatementLine = {
  contactId: string
  property: string
  invoiceLabel: string
  dateIso: string | null
  dueIso: string | null
  amount: number
}

export type StatementData = {
  lines: StatementLine[]
  totalDue: number
}

const OPEN_STATUSES = ['sent', 'overdue']

/**
 * Gather every open invoice across the client's jobs. `jobs` is the
 * client's contact rows (id + a display name); we look up their
 * invoices in one query and shape them into statement lines.
 */
export async function gatherStatement(
  userId: string | undefined,
  jobs: { id: string; name?: string | null; job_title?: string | null; address?: string | null }[]
): Promise<StatementData> {
  const empty: StatementData = { lines: [], totalDue: 0 }
  if (!userId || !jobs?.length) return empty

  const jobIds = jobs.map((j) => j.id)
  const byId = new Map(jobs.map((j) => [j.id, j]))

  const { data, error } = await supabase
    .from('fh_invoices')
    .select('id, contact_id, sequence_number, title, description, amount, status, due_at, created_at')
    .eq('user_id', userId)
    .in('contact_id', jobIds)
    .in('status', OPEN_STATUSES)
    .order('created_at', { ascending: true })
  if (error || !data) return empty

  const lines: StatementLine[] = (data as any[]).map((inv) => {
    const job = byId.get(inv.contact_id)
    const property = job?.job_title || job?.name || job?.address || 'Project'
    const label = inv.title?.trim() || `Invoice #${inv.sequence_number}`
    return {
      contactId: inv.contact_id,
      property,
      invoiceLabel: label,
      dateIso: inv.created_at || null,
      dueIso: inv.due_at || null,
      amount: Number(inv.amount) || 0
    }
  })

  const totalDue = lines.reduce((s, l) => s + l.amount, 0)
  return { lines, totalDue }
}

/** Build the statement PDF result (doc + filename + totalDue). */
export async function buildStatementPdf({ company, client, data }: {
  company: any
  client: any
  data: StatementData
}) {
  // generateStatement lives in the untyped pdf.js — its array params
  // infer as never[], so the typed payload goes through `as any`.
  return generateStatement({
    company,
    client,
    lines: data.lines,
    statementId: client?.id
  } as any)
}

/** Build + trigger a local download. */
export async function downloadStatement(args: { company: any; client: any; data: StatementData }) {
  const result = await buildStatementPdf(args)
  downloadPdf(result)
  return result
}

export type SendStatementResult =
  | { ok: true; recipient: string }
  | { ok: false; reason: 'no_email' | 'sender_not_configured' | 'error'; message?: string }

/**
 * Email the statement: render → upload to storage → POST send-statement.
 * Falls back to a local download when the email sender isn't configured.
 */
export async function sendStatementEmail({ company, client, data, userId, recipientEmail }: {
  company: any
  client: any
  data: StatementData
  userId: string
  recipientEmail?: string | null
}): Promise<SendStatementResult> {
  const recipient = (recipientEmail || client?.email || '').trim()
  if (!recipient) return { ok: false, reason: 'no_email' }

  const result = await buildStatementPdf({ company, client, data })
  if (!result?.doc) return { ok: false, reason: 'error', message: 'PDF generator returned no document' }

  const { authHeaders } = await import('./supabase.ts')
  const blob = result.doc.output('blob')
  const rowId = crypto.randomUUID()
  const path = `${userId}/statements/${rowId}.pdf`
  const { error: upErr } = await supabase.storage
    .from('job-files')
    .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
  if (upErr) return { ok: false, reason: 'error', message: `Couldn't save the statement PDF: ${upErr.message}` }

  const sendRes = await fetch('/api/send-statement', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({
      client_id: client.id,
      sender_user_id: userId,
      recipient_email: recipient,
      recipient_name: client.company_name || client.name || null,
      storage_path: path,
      filename: result.filename,
      total_due: result.totalDue
    })
  })
  const body = await sendRes.json().catch(() => ({}))

  if (sendRes.status === 503 && body?.error === 'sender_not_configured') {
    downloadPdf(result)
    return { ok: false, reason: 'sender_not_configured' }
  }
  if (!sendRes.ok || !body?.ok) {
    return { ok: false, reason: 'error', message: body?.message || body?.error || 'Send failed' }
  }
  return { ok: true, recipient }
}
