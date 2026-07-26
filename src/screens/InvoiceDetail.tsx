import { lazy, Suspense, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  ChevronLeft,
  Receipt,
  FileDown,
  DollarSign,
  ExternalLink,
  Clock,
  CheckCircle2,
  Send,
  Link as LinkIcon
} from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase, authHeaders } from '../lib/supabase.ts'
import { useInvoiceDetail, useInvalidateInvoiceDetail } from '../lib/queries.ts'
import { fetchInvoicesForContact } from '../lib/invoices.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'
// Lazy — pdf.js + transitive jspdf + autoTable deps are ~430KB. Only
// loads on the first PDF action (Generate, Share, Email Invoice).
async function loadPdf(): Promise<any> {
  return import('../lib/pdf.js')
}
import { toastSuccess, toastError } from '../lib/toast.ts'
import { mintPublicLink } from '../lib/publicLink.ts'
import { hapticTap } from '../lib/haptics.ts'
import { useFhMotion } from '../lib/motion.ts'
import { Eyebrow, StampNumber } from '../components/v3'
// Lazy — only loads when an operator taps "Mark Paid" (avoids ~440KB
// in the InvoiceDetail route chunk).
const V3PaymentSheet = lazy(() => import('../components/V3PaymentSheet.tsx'))
import { InvoiceTemplate } from '../components/documents'

/**
 * InvoiceDetail — read-only mobile invoice surface at /invoices/:id.
 *
 * No new schema. Reads fh_contacts + fh_payments and surfaces:
 *   - status (Outstanding / Overdue / Paid / Closed) computed from
 *     balance + age, not from a stored column
 *   - client + total + balance + service title
 *   - payment history (reverse chronological)
 *   - primary actions: Collect Payment / Generate PDF / Open Job
 *
 * Line-item CRUD is intentionally out of scope (would need
 * fh_invoice_items). When the operator wants to edit the scope, they
 * use the Quote tab on Job Detail where line items already live.
 */

const AGING_BUCKETS = [
  { id: '0-30',  label: 'Current',  max: 30,        color: 'var(--v3-text-muted)',     accent: 'var(--v3-border-strong)' },
  { id: '31-60', label: 'Late',     max: 60,        color: 'var(--v3-primary)',        accent: 'color-mix(in srgb, var(--v3-primary) 40%, transparent)' },
  { id: '60+',   label: 'Overdue',  max: Infinity,  color: 'var(--v3-danger-bright)',  accent: 'color-mix(in srgb, var(--v3-danger) 50%, transparent)' }
]

function bucketFor(days: any) {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  return '60+'
}

function fmtMoney(n: any) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

function fmtDate(iso: any) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function methodLabel(m: any) {
  if (!m) return 'Payment'
  const lower = String(m).toLowerCase()
  if (lower === 'cash') return 'Cash'
  if (lower === 'check') return 'Check'
  if (lower === 'card') return 'Card'
  if (lower === 'ach') return 'ACH'
  return lower.charAt(0).toUpperCase() + lower.slice(1)
}

export default function InvoiceDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const { profile } = useProfile()

  // Insurance claim payload (migration 018) is one-to-one with the
  // contact (owner-only RLS, null for partner viewers); change orders
  // (migration 019) bump the contract total when approved. Both come
  // back in the bundle below.
  const { data: bundle, isPending: loading, isError, error: queryError } = useInvoiceDetail(id, user?.id)
  const invalidateInvoiceDetail = useInvalidateInvoiceDetail()
  const queryClient = useQueryClient()
  // Refresh BOTH caches — a payment can settle the current draw
  // (stages.ts flips it to 'paid'), and refreshing only the contact
  // left the document view billing an already-paid draw until remount.
  const refresh = () => {
    invalidateInvoiceDetail(id)
    queryClient.invalidateQueries({ queryKey: ['invoiceDraws', id] })
  }
  const contact = bundle?.contact ?? null
  const payments = bundle?.payments ?? []
  const insurance = bundle?.insurance ?? null
  const changeOrders = bundle?.changeOrders ?? []
  const error = isError ? (queryError?.message || 'Could not load invoice') : ''

  // First-class invoice draws (fh_invoices) for this job. fh_contacts has
  // no due_at column — the real issue/due dates, invoice number, and the
  // billing schedule all live on these rows, so the on-screen document
  // and the emailed PDF stay in sync with the public link.
  const { data: invoiceRows = [] } = useQuery({
    queryKey: ['invoiceDraws', id],
    queryFn: async () => {
      const { data, error: fetchErr } = await fetchInvoicesForContact(id as string)
      if (fetchErr) throw fetchErr
      return data
    },
    enabled: !!id
  })

  // The draw this screen bills: first still-open row (not void/paid/draft),
  // falling back to the latest non-void row so we always have a real
  // invoice number + due date when any draw exists.
  const currentDraw = useMemo(() => {
    const rows = invoiceRows || []
    const open = rows.find((r: any) => {
      const s = String(r?.status || '').toLowerCase()
      return s !== 'void' && s !== 'paid' && s !== 'draft'
    })
    if (open) return open
    const nonVoid = rows.filter((r: any) => String(r?.status || '').toLowerCase() !== 'void')
    if (nonVoid.length) return nonVoid[nonVoid.length - 1]
    return rows.length ? rows[rows.length - 1] : null
  }, [invoiceRows])
  const [paying, setPaying] = useState(false)
  const [generating, setGenerating] = useState(false)
  // 'detail' = existing list-style breakdown (default — original UX).
  // 'document' = new InvoiceTemplate preview (Phase 2 — opt-in so the
  // toggle is reversible and the existing flow stays untouched until
  // the operator chooses to switch).
  const [viewMode, setViewMode] = useState('detail')
  // Send Invoice state — mirrors Send Proposal flow on the Quote tab.
  // Builds the PDF locally, uploads to job-files, posts the storage_path
  // to /api/send-invoice for server-side Resend send + activity log.
  const [sending, setSending] = useState(false)
  // Sent flag flips back to false after 2.4s so the Send button
  // briefly morphs to green ✓ "Sent" on success — mirrors the Compose
  // pattern. Gives the operator visual confirmation that's hard to
  // miss vs relying on the toast alone.
  const [sent, setSent] = useState(false)
  const [sharing, setSharing] = useState(false)

  // Resolved client info — prefer the denormalized job-row fields, fall
  // back to fh_clients (the source of truth when edits happen on the
  // client card and the job row stayed empty).
  const resolved = useMemo(() => {
    const cli: any = contact?.fh_clients || {}
    return {
      name:    contact?.name    || cli.name    || '',
      email:   contact?.email   || cli.email   || '',
      phone:   contact?.phone   || cli.phone   || '',
      address: contact?.address || cli.address || ''
    }
  }, [contact])

  const totals = useMemo(() => {
    // True contract = job amount + approved change orders (matches the
    // PDF/InvoiceTemplate); without the COs the on-screen balance,
    // status pill and % paid disagreed with the document the customer got.
    const approvedCo = (changeOrders || [])
      .filter((co: any) => co?.status === 'approved')
      .reduce((s: number, co: any) => s + Number(co.amount || 0), 0)
    const amount = Number(contact?.amount || 0) + approvedCo
    const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
    const balance = Math.max(0, amount - paid)
    // Age from when the receivable went out (open draw's due/issue
    // date), NOT the job's creation date — the same anchor the Invoices
    // list uses. Anchoring on created_at made a job quoted in April and
    // first billed yesterday open with a red "Overdue · 91d" pill while
    // the A/R list said "Current · 1d".
    const drawAnchor = (() => {
      const s = String(currentDraw?.status || '').toLowerCase()
      if (!currentDraw || s === 'paid' || s === 'void' || s === 'draft') return null
      const raw = currentDraw.due_at || currentDraw.issued_at || currentDraw.created_at
      const t = raw ? new Date(raw).getTime() : NaN
      return Number.isFinite(t) ? t : null
    })()
    const anchorMs = drawAnchor ?? (contact?.created_at ? new Date(contact.created_at).getTime() : NaN)
    const ageDays = Number.isFinite(anchorMs) ? Math.floor((Date.now() - anchorMs) / 86400000) : 0
    const bucket = bucketFor(ageDays)
    const isPaid = balance < 0.5 && amount > 0
    const isClosed = (contact?.stage || '').toLowerCase() === 'closed'
    const pctPaid = amount > 0 ? Math.min(100, Math.max(0, (paid / amount) * 100)) : 0
    return { amount, paid, balance, ageDays, bucket, isPaid, isClosed, pctPaid }
  }, [contact, payments, changeOrders, currentDraw])

  const status = useMemo(() => {
    // Computed status — no stored invoice_status column today. The four
    // visible buckets cover the common cases without inventing schema.
    if (totals.isClosed) return { label: 'Closed', tone: 'muted' }
    if (totals.isPaid) return { label: 'Paid', tone: 'good' }
    if (totals.bucket === '60+') return { label: 'Overdue', tone: 'danger' }
    return { label: 'Outstanding', tone: 'gold' }
  }, [totals])

  const company = useMemo(() => ({
    name: profile?.company_name || profile?.full_name || 'My Company',
    address: profile?.company_address || '',
    phone: profile?.company_phone || '',
    email: profile?.company_email || (profile as any)?.email || '',
    website: profile?.company_website || '',
    logo_url: profile?.logo_url || null,
    brand_accent_hex: profile?.brand_accent_hex || null,
    license_number: profile?.license_number || '',
    insured_text: profile?.insured_text || '',
    payment_link: (profile as any)?.payment_link || '',
    payment_instructions: (profile as any)?.payment_instructions || ''
  }), [profile])

  // What this screen is billing right now. When an open draw exists,
  // the PDF/email bill THAT draw (same as the Draws tab and the public
  // link) — this path used to bill the whole contract, so the same
  // customer could receive a $20,000 "invoice" from here and a $5,000
  // draw from the Draws tab for the same job. Jobs without draw rows
  // keep the whole-balance presentation.
  const billingDraw = useMemo(() => {
    const s = String(currentDraw?.status || '').toLowerCase()
    return currentDraw && s !== 'paid' && s !== 'void' && s !== 'draft' ? currentDraw : null
  }, [currentDraw])
  const pdfLineItems = useMemo(() => (
    billingDraw
      ? [{
          description: billingDraw.title?.trim() || `Invoice #${billingDraw.sequence_number}`,
          notes: contact?.job_title || 'Construction services',
          qty: 1,
          rate: Number(billingDraw.amount || 0),
          amount: Number(billingDraw.amount || 0)
        }]
      : [{
          description: contact?.job_title || 'Construction services per agreement',
          qty: 1,
          rate: totals.amount,
          amount: totals.amount
        }]
  ), [billingDraw, contact?.job_title, totals.amount])
  const amountDueNow = billingDraw
    ? Math.min(totals.balance, Number(billingDraw.amount || 0))
    : totals.balance

  async function handleGeneratePDF() {
    if (!contact || generating) return
    setGenerating(true)
    try {
      const { generateInvoice, downloadPdf } = await loadPdf()
      const result = await generateInvoice({
        company,
        contact: {
          id: contact.id,
          name: resolved.name || 'Client',
          address: resolved.address,
          phone: resolved.phone,
          email: resolved.email,
          job_title: contact.job_title
        },
        // Single canonical line — the new template renders a full
        // Balance Summary section underneath, so we no longer need
        // to inject a synthetic "Less: payments received" row.
        lineItems: pdfLineItems,
        taxRate: 0,
        notes: '',
        dueDate: '',
        dueDateIso: currentDraw?.due_at || null,
        invoiceId: contact.id,
        payments,
        contractTotal: Number(contact?.amount || 0),
        previouslyPaid: totals.paid,
        insurance,
        changeOrders,
        invoices: invoiceRows,
        currentInvoice: currentDraw
      })
      if (!result?.doc) throw new Error('PDF generator returned no document')
      downloadPdf(result)
      toastSuccess('Invoice PDF downloaded', result.filename)
    } catch (e: any) {
      toastError("Couldn't generate PDF", e?.message || 'Try again')
    } finally {
      setGenerating(false)
    }
  }

  // Build the same invoice PDF that handleGeneratePDF builds, but
  // instead of downloading it locally, upload to job-files and POST
  // to /api/send-invoice. Server downloads via service role, attaches
  // to a Resend send with the contractor's company name as the
  // display-name + Reply-To. Mirrors the Send Proposal flow on the
  // Quote tab.
  // Mint a public share link for this invoice and copy it to the
  // clipboard. The customer opens the link → /p/{token} → sees the
  // branded InvoiceTemplate (no auth required, no app branding).
  // Resolution happens server-side via service role; the table
  // itself stays opaque to anonymous PostgREST traffic.
  async function handleShare() {
    if (!contact?.id || !user?.id || sharing) return
    setSharing(true)
    try {
      const link = await mintPublicLink({
        contactId: contact.id,
        userId: user!.id,
        kind: 'invoice'
      })
      try {
        await navigator.clipboard.writeText(link.url)
        toastSuccess('Share link copied', 'Send it however you want — text, email, anything.')
      } catch {
        // Clipboard write blocked (Safari permission) — still show
        // the link so the operator can long-press to copy.
        toastSuccess('Share link ready', link.url)
      }
    } catch (e: any) {
      toastError("Couldn't mint share link", e?.message || 'Try again.')
    } finally {
      setSharing(false)
    }
  }

  async function handleSendInvoice() {
    if (!contact || sending) return
    if (!resolved.email) {
      toastError('Add a client email first', 'Open the linked client or job to add an email.')
      return
    }
    setSending(true)
    try {
      const { generateInvoice, downloadPdf } = await loadPdf()
      const result = await generateInvoice({
        company,
        contact: {
          id: contact.id,
          name: resolved.name || 'Client',
          address: resolved.address,
          phone: resolved.phone,
          email: resolved.email,
          job_title: contact.job_title
        },
        lineItems: pdfLineItems,
        taxRate: 0,
        notes: '',
        dueDate: '',
        dueDateIso: currentDraw?.due_at || null,
        invoiceId: contact.id,
        payments,
        contractTotal: Number(contact?.amount || 0),
        previouslyPaid: totals.paid,
        insurance,
        changeOrders,
        invoices: invoiceRows,
        currentInvoice: currentDraw
      })
      if (!result?.doc) throw new Error('PDF generator returned no document')

      // Upload to job-files so the server can pull it with service role.
      const blob = result.doc.output('blob')
      const rowId = crypto.randomUUID()
      const path = `${user!.id}/${contact.id}/${rowId}.pdf`
      const { error: upErr } = await supabase.storage
        .from('job-files')
        .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
      if (upErr) throw new Error(`Couldn't save the invoice PDF: ${upErr.message}`)
      // Audit row (best-effort).
      try {
        await supabase.from('fh_job_files').insert({
          id: rowId,
          user_id: user!.id,
          job_id: contact.id,
          filename: result.filename,
          storage_path: path,
          mime_type: 'application/pdf',
          size_bytes: blob.size || 0,
          kind: 'file'
        })
      } catch (e: any) {
        console.warn('[invoice] fh_job_files row insert failed', e)
      }

      const sendRes = await fetch('/api/send-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          contact_id: contact.id,
          sender_user_id: user!.id,
          recipient_email: resolved.email,
          recipient_name: resolved.name || null,
          storage_path: path,
          filename: result.filename,
          amount_due: amountDueNow
        })
      })
      const sendBody = await sendRes.json().catch(() => ({}))

      if (sendRes.status === 503 && sendBody?.error === 'sender_not_configured') {
        toastError(
          "Email NOT sent — sender isn't configured",
          'Downloaded the PDF so you can email it manually. To send direct, add Resend keys in Netlify env.'
        )
        downloadPdf(result)
        return
      }
      if (!sendRes.ok || !sendBody?.ok) {
        // Surface the actual provider error (Resend message + HTTP status)
        // so the operator sees exactly why the send failed instead of
        // hunting through Netlify function logs. Was previously hidden
        // behind a generic "Email send failed." string.
        const detail = sendBody?.detail || sendBody?.error || 'Unknown provider error'
        const status = sendBody?.provider_status ? ` (HTTP ${sendBody.provider_status})` : ''
        throw new Error(`Resend rejected${status}: ${detail}`)
      }

      toastSuccess(`Invoice sent to ${resolved.email}`, result.filename)
      setSent(true)
      setTimeout(() => setSent(false), 2400)
      refresh()
    } catch (e: any) {
      toastError("Couldn't send invoice", e?.message || 'Try again')
    } finally {
      setSending(false)
    }
  }

  const { stagger, item } = useFhMotion()

  if (loading) {
    return (
      <div style={{ padding: '24px 20px' }}>
        <div className="v3-skeleton" style={{ height: 28, width: 200, borderRadius: 6, marginBottom: 12 }} />
        <div className="v3-skeleton" style={{ height: 120, width: '100%', borderRadius: 14, marginBottom: 12 }} />
        <div className="v3-skeleton" style={{ height: 80, width: '100%', borderRadius: 14 }} />
      </div>
    )
  }

  if (error) {
    return (
      <div style={{ padding: '24px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <button
          type="button"
          onClick={() => { hapticTap(); navigate('/invoices') }}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 12px 8px 8px', borderRadius: 10,
            background: 'transparent', border: '1px solid var(--v3-border)',
            color: 'var(--v3-text)', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600
          }}
        >
          <ChevronLeft size={16} aria-hidden="true" />
          Money Owed
        </button>
        <div className="v3-empty">
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
            {error}
          </div>
          <div style={{ fontSize: 12 }}>The invoice may have been removed.</div>
        </div>
      </div>
    )
  }

  if (!contact) return null

  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      // The bottom action bar is sticky+safe-area; pad screen bottom so
      // the last section can scroll above it.
      style={{ paddingBottom: 132, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {/* HEADER STRIP — Back chevron + title eyebrow.
          Premium black-glass; no fog backdrop on the strip itself so
          the screen feels solid, not overlaid. */}
      <motion.div variants={item} style={{ padding: '8px 16px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <button
          type="button"
          onClick={() => { hapticTap(); navigate('/invoices') }}
          aria-label="Back to Money Owed"
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            minHeight: 40, padding: '0 12px 0 6px',
            borderRadius: 10,
            background: 'transparent', border: '1px solid transparent',
            color: 'var(--v3-text)',
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
            cursor: 'pointer', WebkitTapHighlightColor: 'transparent'
          }}
        >
          <ChevronLeft size={18} aria-hidden="true" />
          Back
        </button>
        <span style={{ flex: 1, textAlign: 'center', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <Eyebrow tone="gold">
            <Receipt size={11} aria-hidden="true" />
            Invoice
          </Eyebrow>
        </span>
        {/* View toggle — Detail (default, original UX) vs Document
            (new InvoiceTemplate preview). Reversible; lives in the
            header so the operator can flip without scrolling. Sized
            to match the back-chevron button so the eyebrow stays
            visually centered. */}
        <ViewModeToggle value={viewMode} onChange={setViewMode} />
      </motion.div>

      {viewMode === 'document' ? (
        <DocumentPreviewPane
          company={company}
          contact={contact}
          resolved={resolved}
          payments={payments}
          totals={totals}
          status={status}
          item={item}
          insurance={insurance}
          changeOrders={changeOrders}
          invoices={invoiceRows}
          currentInvoice={currentDraw}
        />
      ) : null}
      {viewMode === 'document' ? null : (
      <>
      {/* ─── Existing list-style detail surface (preserved verbatim) ─── */}

      {/* HERO CARD — status pill + total + balance + paid progress */}
      <motion.div variants={item} style={{ padding: '4px 16px 12px' }}>
        <div style={{
          padding: '16px 18px',
          borderRadius: 16,
          background: 'var(--v3-surface-glass)',
          backdropFilter: 'blur(14px) saturate(1.1)',
          WebkitBackdropFilter: 'blur(14px) saturate(1.1)',
          border: status.tone === 'danger'
            ? '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)'
            : '1px solid var(--v3-border)',
          boxShadow: '0 1px 0 var(--v3-glass-tint) inset, 0 8px 22px rgba(0, 0, 0, 0.40)',
          display: 'flex', flexDirection: 'column', gap: 12
        }}>
          {/* Status pill + age */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <StatusPill status={status} />
            {!totals.isClosed && !totals.isPaid && (
              <span style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
                color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums'
              }}>
                <Clock size={11} aria-hidden="true" />
                {totals.ageDays}d
              </span>
            )}
          </div>

          {/* Client */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span style={{
              fontFamily: 'var(--font-body)', fontSize: 18, fontWeight: 700,
              color: 'var(--v3-text)', letterSpacing: '-0.01em',
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>
              {resolved.name || 'Unnamed client'}
            </span>
            {contact.job_title && (
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 12,
                color: 'var(--v3-text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {contact.job_title}
              </span>
            )}
          </div>

          {/* Balance / Total */}
          <div>
            <StampNumber size="2xl" tone={totals.isPaid ? 'success' : 'default'} style={{ display: 'block', lineHeight: 0.95 }}>
              {totals.isPaid ? 'PAID' : fmtMoney(totals.balance)}
            </StampNumber>
            <Eyebrow as="div" style={{ marginTop: 6 }}>
              {totals.isPaid ? `${fmtMoney(totals.amount)} fully paid` : `Balance · ${fmtMoney(totals.amount)} contract`}
            </Eyebrow>
          </div>

          {/* Paid progress */}
          <div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: 11, color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)', marginBottom: 5,
              fontVariantNumeric: 'tabular-nums'
            }}>
              <span>{fmtMoney(totals.paid)} paid of {fmtMoney(totals.amount)}</span>
              <span style={{ color: 'var(--v3-text)' }}>
                {Math.round(totals.pctPaid)}%
              </span>
            </div>
            <div style={{
              height: 6, borderRadius: 999,
              background: 'var(--v3-track)', overflow: 'hidden'
            }}>
              <div style={{
                width: `${totals.pctPaid}%`,
                height: '100%',
                background: totals.pctPaid >= 100
                  ? 'var(--v3-success-bright)'
                  : 'linear-gradient(90deg, var(--v3-primary-deep), var(--v3-primary))',
                borderRadius: 999,
                transition: 'width 220ms ease',
                boxShadow: totals.pctPaid >= 100
                  ? '0 0 8px rgba(74, 222, 128, 0.40)'
                  : 'none'
              }} />
            </div>
          </div>
        </div>
      </motion.div>

      {/* SERVICE SUMMARY — derived single line, mirrors what the PDF
          synthesizes today. Real line-item CRUD lives on the Quote tab
          (Job Detail) since that's where the data model is. */}
      <motion.div variants={item} style={{ padding: '0 16px 12px' }}>
        <SectionTitle>Service</SectionTitle>
        <div style={{
          marginTop: 8,
          padding: '12px 14px',
          borderRadius: 12,
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border)',
          display: 'flex', alignItems: 'center', gap: 12
        }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
              color: 'var(--v3-text)', lineHeight: 1.35,
              overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
            }}>
              {contact.job_title || 'Construction services per agreement'}
            </div>
            {resolved.address && (
              <div style={{
                marginTop: 3,
                fontFamily: 'var(--font-body)', fontSize: 11,
                color: 'var(--v3-text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {resolved.address}
              </div>
            )}
          </div>
          <div style={{
            flexShrink: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 22,
            color: 'var(--v3-text)',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1
          }}>
            {fmtMoney(totals.amount)}
          </div>
        </div>
        <div style={{
          marginTop: 6,
          fontFamily: 'var(--font-body)', fontSize: 11,
          color: 'var(--v3-text-muted)', lineHeight: 1.4
        }}>
          Edit line items on the Quote tab of the linked job.
        </div>
      </motion.div>

      {/* PAYMENT HISTORY */}
      <motion.div variants={item} style={{ padding: '0 16px 12px' }}>
        <SectionTitle>Payments</SectionTitle>
        <div style={{ marginTop: 8 }}>
          {payments.length === 0 ? (
            <div className="v3-empty">
              <DollarSign size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
                No payments recorded yet.
              </div>
              <div style={{ fontSize: 12 }}>Tap Collect Payment to log cash, check, or other.</div>
            </div>
          ) : (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {payments.map((p) => (
                <li
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '11px 14px', borderRadius: 12,
                    background: 'var(--v3-surface)', border: '1px solid var(--v3-border)'
                  }}
                >
                  <span aria-hidden="true" style={{
                    width: 30, height: 30, borderRadius: 8,
                    background: 'var(--v3-surface-2)',
                    border: '1px solid var(--v3-border-strong)',
                    display: 'grid', placeItems: 'center',
                    color: 'var(--v3-success-bright)',
                    flexShrink: 0
                  }}>
                    <CheckCircle2 size={14} />
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{
                      fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                      color: 'var(--v3-text)', lineHeight: 1.3
                    }}>
                      {methodLabel(p.method)}
                      {p.reference ? <span style={{ color: 'var(--v3-text-muted)', fontWeight: 500 }}> · {p.reference}</span> : null}
                    </div>
                    <div style={{
                      marginTop: 2,
                      fontFamily: 'var(--font-body)', fontSize: 11,
                      color: 'var(--v3-text-muted)',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      {fmtDate(p.paid_on || p.created_at)}
                    </div>
                  </div>
                  <div style={{
                    flexShrink: 0,
                    fontFamily: 'var(--font-display)', fontSize: 18,
                    color: 'var(--v3-text)',
                    fontVariantNumeric: 'tabular-nums', lineHeight: 1
                  }}>
                    {fmtMoney(p.amount)}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </motion.div>

      {/* JOB LINK */}
      <motion.div variants={item} style={{ padding: '0 16px 24px' }}>
        <button
          type="button"
          onClick={() => { hapticTap(); navigate(`/jobs/${contact.id}`) }}
          style={{
            width: '100%',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, padding: '12px 14px',
            borderRadius: 12,
            background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
            color: 'var(--v3-text)', cursor: 'pointer',
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          <span>Open job — notes, schedule, files, line items</span>
          <ExternalLink size={14} aria-hidden="true" color="var(--v3-text-muted)" />
        </button>
      </motion.div>
      </>
      )}

      {/* STICKY ACTION BAR — Send + Generate PDF + Collect Payment.
          Three-button row: Send (email the invoice), PDF (local download),
          Collect (log a payment). Send is new (5/17 invoice-send port);
          Generate PDF + Collect Payment behavior unchanged. Sits above
          the BottomNav (position: fixed; bottom: 0 with safe-area).
          Padding-bottom raises us above the dock; gradient softens the
          transition into the page. */}
      <div
        className="fh-invoice-actionbar"
        style={{
          position: 'fixed',
          left: 0, right: 0,
          bottom: 'calc(56px + env(safe-area-inset-bottom))',
          padding: '10px 16px 10px',
          background: 'linear-gradient(180deg, transparent, color-mix(in srgb, var(--v3-bg) 92%, transparent) 32%, var(--v3-bg) 64%)',
          zIndex: 30,
          display: 'flex', gap: 8,
          pointerEvents: 'none'
        }}
      >
        <button
          type="button"
          onClick={() => {
            hapticTap()
            // No client email on file — explain to the user instead of
            // silently no-op'ing (was the audit's #1 critical failure).
            if (!resolved.email) {
              toastError(
                'Add a client email first',
                `${resolved.name || 'This client'} has no email on file. Open the linked client → edit details → add an email, then try again.`
              )
              return
            }
            handleSendInvoice()
          }}
          disabled={sending}
          style={{
            flex: 1,
            minHeight: 48,
            padding: '12px 14px',
            borderRadius: 12,
            background: sent
              ? 'linear-gradient(180deg, var(--v3-success-bright) 0%, var(--v3-success) 100%)'
              : 'var(--v3-surface-2)',
            border: sent
              ? '1px solid color-mix(in srgb, var(--v3-success) 55%, transparent)'
              : '1px solid var(--v3-border-strong)',
            color: sent
              ? '#0a0a0a'
              : sending ? 'var(--v3-text-muted)' : 'var(--v3-text)',
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
            cursor: sending ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            WebkitTapHighlightColor: 'transparent',
            pointerEvents: 'auto',
            touchAction: 'manipulation',
            opacity: 1,
            transition: 'background 200ms ease, border-color 200ms ease, color 200ms ease'
          }}
        >
          {sent ? <CheckCircle2 size={14} aria-hidden="true" /> : <Send size={14} aria-hidden="true" />}
          {sent ? 'Sent' : sending ? 'Sending…' : 'Email'}
        </button>
        <button
          type="button"
          onClick={() => { hapticTap(); handleShare() }}
          disabled={sharing}
          title="Mint a public share link the customer can open in any browser"
          style={{
            flex: 1,
            minHeight: 48,
            padding: '12px 14px',
            borderRadius: 12,
            background: 'var(--v3-surface-2)',
            border: '1px solid var(--v3-border-strong)',
            color: sharing ? 'var(--v3-text-muted)' : 'var(--v3-text)',
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
            cursor: sharing ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            WebkitTapHighlightColor: 'transparent',
            pointerEvents: 'auto',
            touchAction: 'manipulation'
          }}
        >
          <LinkIcon size={14} aria-hidden="true" />
          {sharing ? 'Minting…' : 'Share link'}
        </button>
        <button
          type="button"
          onClick={() => { hapticTap(); handleGeneratePDF() }}
          disabled={generating}
          style={{
            flex: 1,
            minHeight: 48,
            padding: '12px 14px',
            borderRadius: 12,
            background: 'var(--v3-surface-2)',
            border: '1px solid var(--v3-border-strong)',
            color: generating ? 'var(--v3-text-muted)' : 'var(--v3-text)',
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
            cursor: generating ? 'wait' : 'pointer',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            WebkitTapHighlightColor: 'transparent',
            pointerEvents: 'auto',
            touchAction: 'manipulation'
          }}
        >
          <FileDown size={14} aria-hidden="true" />
          {generating ? 'Generating…' : 'Download'}
        </button>
        <button
          type="button"
          onClick={() => { hapticTap(); setPaying(true) }}
          disabled={totals.isPaid && totals.balance < 0.5}
          style={{
            flex: 2,
            minHeight: 48,
            padding: '12px 14px',
            borderRadius: 12,
            border: 'none',
            background: (totals.isPaid && totals.balance < 0.5)
              ? 'var(--v3-surface-2)'
              : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
            color: (totals.isPaid && totals.balance < 0.5) ? 'var(--v3-text-muted)' : 'var(--v3-on-primary)',
            fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
            letterSpacing: '0.04em',
            cursor: (totals.isPaid && totals.balance < 0.5) ? 'not-allowed' : 'pointer',
            boxShadow: (totals.isPaid && totals.balance < 0.5)
              ? 'none'
              : '0 0 0 3px rgba(229, 193, 88, 0.10), 0 4px 12px rgba(229, 193, 88, 0.18), 0 1px 0 var(--v3-border-strong) inset',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
            WebkitTapHighlightColor: 'transparent',
            pointerEvents: 'auto',
            touchAction: 'manipulation'
          }}
        >
          <DollarSign size={15} aria-hidden="true" />
          {totals.isPaid && totals.balance < 0.5 ? 'Paid in full' : 'Collect Payment'}
        </button>
      </div>

      <AnimatePresence>
        {paying && (
          <Suspense fallback={null}>
            <V3PaymentSheet
              contact={contact}
              balance={totals.balance}
              onClose={() => setPaying(false)}
              onLogged={() => { setPaying(false); refresh() }}
            />
          </Suspense>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ─────────────────────────────────────────────────────────
   Phase 2 — Document preview pane.
   Mounts the new InvoiceTemplate from src/components/documents
   inside the same screen, behind an opt-in ViewModeToggle. Mapping
   is read-only: pulls already-loaded contact + payments + totals
   out of state and shapes them into the template's prop contract.
   No new queries; no schema changes.
   ───────────────────────────────────────────────────────── */
function DocumentPreviewPane({ company, contact, resolved, payments, totals, status, item, insurance, changeOrders, invoices = [], currentInvoice = null }: any) {
  const docStatus = (() => {
    const tone = status?.tone
    if (tone === 'good')   return 'paid'
    if (tone === 'danger') return 'overdue'
    if (tone === 'muted')  return 'closed'
    return 'outstanding'
  })()
  // "This invoice" = the current open draw's amount (capped at the
  // balance), exactly like the public link — billing totals.balance
  // here made this preview demand the whole remaining contract while
  // the Draws tab sent the same customer a $5K draw.
  const drawIsOpen = currentInvoice
    && !['paid', 'void', 'draft'].includes(String(currentInvoice.status || '').toLowerCase())
  const thisInvoiceAmount = drawIsOpen
    ? Math.min(totals.balance, Number(currentInvoice.amount || 0))
    : totals.balance

  return (
    <motion.div
      variants={item}
      style={{
        // Cream backdrop so the white letter-paper reads as a real
        // document on the otherwise-dark v3 surface.
        padding: '8px 12px calc(132px + env(safe-area-inset-bottom, 0px))',
        background: '#2a2520'
      }}
    >
      <InvoiceTemplate
        company={company}
        contact={{
          id: contact.id,
          name: resolved.name,
          address: resolved.address,
          phone: resolved.phone,
          email: resolved.email,
          job_title: contact.job_title
        }}
        project={{
          title: contact.job_title || 'Construction services',
          address: resolved.address
        }}
        contractTotal={Number(contact?.amount || 0)}
        payments={payments}
        previouslyPaid={totals.paid}
        thisInvoice={thisInvoiceAmount}
        balanceRemaining={totals.balance}
        invoices={invoices}
        currentInvoice={currentInvoice}
        meta={{
          // fh_contacts has no due_at column — issue/due dates come off
          // the current fh_invoices draw, falling back to job created_at
          // for the issue date and no due date when there is no draw.
          issuedAt: currentInvoice?.issued_at || contact.created_at,
          dueDate: currentInvoice?.due_at || null
        }}
        status={docStatus}
        insurance={insurance}
        changeOrders={changeOrders}
      />
    </motion.div>
  )
}

function ViewModeToggle({ value, onChange }: any) {
  const opts = [
    { v: 'detail',   label: 'Detail' },
    { v: 'document', label: 'Document' }
  ]
  return (
    <div
      role="tablist"
      aria-label="View mode"
      style={{
        display: 'inline-flex',
        padding: 2,
        borderRadius: 999,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        flexShrink: 0
      }}
    >
      {opts.map((o) => {
        const on = value === o.v
        return (
          <button
            key={o.v}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => { if (!on) { hapticTap(); onChange(o.v) } }}
            style={{
              padding: '6px 10px',
              minHeight: 32,
              borderRadius: 999,
              border: 0,
              background: on ? 'var(--v3-primary-soft)' : 'transparent',
              color: on ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.08em',
              textTransform: 'uppercase',
              cursor: on ? 'default' : 'pointer',
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            {o.label}
          </button>
        )
      })}
    </div>
  )
}

function SectionTitle({ children }: any) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 8, padding: '8px 2px 0'
    }}>
      <Eyebrow>
        {children}
      </Eyebrow>
    </div>
  )
}

function StatusPill({ status }: any) {
  const palette = (() => {
    switch (status.tone) {
      case 'gold':
        return {
          bg: 'var(--v3-primary-soft)',
          border: 'color-mix(in srgb, var(--v3-primary) 35%, transparent)',
          color: 'var(--v3-primary)'
        }
      case 'good':
        return {
          bg: 'rgba(72, 130, 95, 0.14)',
          border: 'rgba(72, 130, 95, 0.45)',
          color: 'var(--v3-success-bright)'
        }
      case 'danger':
        return {
          bg: 'rgba(179, 58, 58, 0.14)',
          border: 'rgba(179, 58, 58, 0.45)',
          color: 'var(--v3-danger-bright)'
        }
      default:
        return {
          bg: 'var(--v3-surface-2)',
          border: 'var(--v3-border)',
          color: 'var(--v3-text-muted)'
        }
    }
  })()
  return (
    <Eyebrow style={{ padding: '5px 12px', borderRadius: 999, background: palette.bg, border: `1px solid ${palette.border}`, color: palette.color }}>
      Invoice · {status.label}
    </Eyebrow>
  )
}
