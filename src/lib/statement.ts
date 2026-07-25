// src/lib/statement.ts
//
// Client statement — one rollup of what a client owes across ALL of
// their properties/jobs. Built for repeat clients (e.g. a property
// manager with several buildings) who want a single "here's everything
// I owe you" document instead of one invoice per job.
//
// "Owed" = (contract amount + approved change orders) − payments, per
// property, over billing stages job/invoice/closed. This is the SAME
// definition used on the Invoices screen and in rollups.ts (Clients
// list + ClientDetail "outstanding"), so the statement always agrees
// with what the app shows elsewhere (and never comes back empty for a
// contractor who tracks balances by contract/paid rather than discrete
// invoice rows).
//
// gatherStatement is a PURE function over jobs + payments the caller
// already has — no DB round-trip, trivially unit-testable.

// pdf.js pulls in jspdf (~390KB) — load it lazily so importing this
// module (ClientDetail route graph) doesn't ship the PDF engine on the
// critical path. downloadPdf is fetched alongside generateStatement.
const loadPdf = () => import('./pdf.js')

export type StatementJob = {
  id: string
  name?: string | null
  job_title?: string | null
  address?: string | null
  amount?: number | string | null
  stage?: string | null
}

export type StatementPayment = {
  contact_id?: string | null
  amount?: number | string | null
}

export type StatementLine = {
  contactId: string
  property: string
  contract: number
  paid: number
  balance: number
}

export type StatementChangeOrder = {
  contact_id?: string | null
  amount?: number | string | null
  status?: string | null
}

export type StatementData = {
  lines: StatementLine[]
  totalDue: number
}

// Stages that can carry a billable balance. Leads/quotes aren't owed
// yet; lost is dead. Matches the Invoices screen's job set.
const BILLING_STAGES = new Set(['job', 'invoice', 'closed'])

/** Sum of APPROVED change orders per contact — the amount that adjusts
 *  a job's true contract up (or down, for credits). */
export function approvedCoByContact(
  changeOrders: StatementChangeOrder[] | null | undefined
): Map<string, number> {
  const m = new Map<string, number>()
  for (const co of changeOrders || []) {
    if (co?.status !== 'approved' || !co.contact_id) continue
    m.set(co.contact_id, (m.get(co.contact_id) || 0) + Number(co.amount || 0))
  }
  return m
}

/**
 * Roll the client's jobs into statement lines — one row per property
 * with a positive balance. Contract = job amount + approved change
 * orders (the same "true contract" the Send-invoice sheet and PDF use),
 * so a signed change order actually raises what's owed here. Pure.
 */
export function gatherStatement(
  jobs: StatementJob[] | null | undefined,
  payments: StatementPayment[] | null | undefined,
  changeOrders: StatementChangeOrder[] | null | undefined = []
): StatementData {
  if (!jobs?.length) return { lines: [], totalDue: 0 }

  const paidByJob = new Map<string, number>()
  for (const p of payments || []) {
    if (!p.contact_id) continue
    paidByJob.set(p.contact_id, (paidByJob.get(p.contact_id) || 0) + Number(p.amount || 0))
  }
  const coByJob = approvedCoByContact(changeOrders)

  const lines: StatementLine[] = []
  for (const j of jobs) {
    if (j.stage && !BILLING_STAGES.has(j.stage)) continue
    const contract = Number(j.amount || 0) + (coByJob.get(j.id) || 0)
    const paid = paidByJob.get(j.id) || 0
    const balance = contract - paid
    if (balance <= 0.5) continue
    lines.push({
      contactId: j.id,
      property: j.job_title || j.name || j.address || 'Project',
      contract,
      paid,
      balance
    })
  }
  lines.sort((a, b) => b.balance - a.balance)
  const totalDue = lines.reduce((s, l) => s + l.balance, 0)
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
  const { generateStatement } = await loadPdf()
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
  const { downloadPdf } = await loadPdf()
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

  const { supabase, authHeaders } = await import('./supabase.ts')
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
    const { downloadPdf } = await loadPdf()
    downloadPdf(result)
    return { ok: false, reason: 'sender_not_configured' }
  }
  if (!sendRes.ok || !body?.ok) {
    return { ok: false, reason: 'error', message: body?.message || body?.error || 'Send failed' }
  }
  return { ok: true, recipient }
}
