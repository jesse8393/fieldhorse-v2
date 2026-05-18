import { useEffect, useMemo, useState } from 'react'
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
  Send
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { generateInvoice, downloadPdf } from '../lib/pdf.js'
import { toastSuccess, toastError } from '../lib/toast.js'
import { hapticTap } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'
import { Eyebrow, StampNumber } from '../components/v3'
import V3PaymentSheet from '../components/V3PaymentSheet.jsx'

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
  { id: '0-30',  label: 'Current',  max: 30,        color: 'var(--v3-text-muted)',     accent: 'rgba(255, 255, 255, 0.18)' },
  { id: '31-60', label: 'Late',     max: 60,        color: 'var(--v3-primary)',        accent: 'color-mix(in srgb, var(--v3-primary) 40%, transparent)' },
  { id: '60+',   label: 'Overdue',  max: Infinity,  color: 'var(--v3-danger-bright)',  accent: 'color-mix(in srgb, var(--v3-danger) 50%, transparent)' }
]

function bucketFor(days) {
  if (days <= 30) return '0-30'
  if (days <= 60) return '31-60'
  return '60+'
}

function fmtMoney(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function methodLabel(m) {
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

  const [contact, setContact] = useState(null)
  const [payments, setPayments] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState(false)
  const [generating, setGenerating] = useState(false)
  // Send Invoice state — mirrors Send Proposal flow on the Quote tab.
  // Builds the PDF locally, uploads to job-files, posts the storage_path
  // to /api/send-invoice for server-side Resend send + activity log.
  const [sending, setSending] = useState(false)
  // Sent flag flips back to false after 2.4s so the Send button
  // briefly morphs to green ✓ "Sent" on success — mirrors the Compose
  // pattern. Gives the operator visual confirmation that's hard to
  // miss vs relying on the toast alone.
  const [sent, setSent] = useState(false)

  const refresh = async () => {
    if (!user?.id || !id) return
    setLoading(true)
    setError('')
    try {
      const [{ data: c, error: cErr }, { data: ps }] = await Promise.all([
        supabase.from('fh_contacts').select('*').eq('id', id).maybeSingle(),
        supabase.from('fh_payments').select('*').eq('contact_id', id).order('paid_on', { ascending: false })
      ])
      if (cErr) throw cErr
      if (!c) throw new Error('Invoice not found')
      setContact(c)
      setPayments(ps || [])
    } catch (e) {
      setError(e?.message || 'Could not load invoice')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [user?.id, id])

  const totals = useMemo(() => {
    const amount = Number(contact?.amount || 0)
    const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
    const balance = Math.max(0, amount - paid)
    const ageDays = contact?.created_at
      ? Math.floor((Date.now() - new Date(contact.created_at).getTime()) / 86400000)
      : 0
    const bucket = bucketFor(ageDays)
    const isPaid = balance < 0.5 && amount > 0
    const isClosed = (contact?.stage || '').toLowerCase() === 'closed'
    const pctPaid = amount > 0 ? Math.min(100, Math.max(0, (paid / amount) * 100)) : 0
    return { amount, paid, balance, ageDays, bucket, isPaid, isClosed, pctPaid }
  }, [contact, payments])

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
    email: profile?.company_email || profile?.email || '',
    website: profile?.company_website || '',
    logo_url: profile?.logo_url || null,
    brand_accent_hex: profile?.brand_accent_hex || null,
    license_number: profile?.license_number || '',
    insured_text: profile?.insured_text || ''
  }), [profile])

  async function handleGeneratePDF() {
    if (!contact || generating) return
    setGenerating(true)
    try {
      const result = await generateInvoice({
        company,
        contact: {
          name: contact.name || 'Client',
          address: contact.address || '',
          phone: contact.phone || '',
          email: contact.email || ''
        },
        lineItems: [
          {
            description: contact.job_title || 'Construction services per agreement',
            qty: 1,
            rate: totals.amount,
            amount: totals.amount
          },
          ...(totals.paid > 0 ? [{
            description: 'Less: payments received',
            qty: 1,
            rate: -totals.paid,
            amount: -totals.paid
          }] : [])
        ],
        taxRate: 0,
        notes: totals.paid > 0
          ? `Balance due reflects ${fmtMoney(totals.paid)} previously received.`
          : '',
        dueDate: '',
        invoiceId: contact.id
      })
      if (!result?.doc) throw new Error('PDF generator returned no document')
      downloadPdf(result)
      toastSuccess('Invoice PDF downloaded', result.filename)
    } catch (e) {
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
  async function handleSendInvoice() {
    if (!contact || sending) return
    if (!contact.email) {
      toastError('Add a client email first', 'Open the linked job to add an email.')
      return
    }
    setSending(true)
    try {
      const result = await generateInvoice({
        company,
        contact: {
          name: contact.name || 'Client',
          address: contact.address || '',
          phone: contact.phone || '',
          email: contact.email || ''
        },
        lineItems: [
          {
            description: contact.job_title || 'Construction services per agreement',
            qty: 1,
            rate: totals.amount,
            amount: totals.amount
          },
          ...(totals.paid > 0 ? [{
            description: 'Less: payments received',
            qty: 1,
            rate: -totals.paid,
            amount: -totals.paid
          }] : [])
        ],
        taxRate: 0,
        notes: totals.paid > 0
          ? `Balance due reflects ${fmtMoney(totals.paid)} previously received.`
          : '',
        dueDate: '',
        invoiceId: contact.id
      })
      if (!result?.doc) throw new Error('PDF generator returned no document')

      // Upload to job-files so the server can pull it with service role.
      const blob = result.doc.output('blob')
      const rowId = crypto.randomUUID()
      const path = `${user.id}/${contact.id}/${rowId}.pdf`
      const { error: upErr } = await supabase.storage
        .from('job-files')
        .upload(path, blob, { upsert: false, contentType: 'application/pdf' })
      if (upErr) throw new Error(`Couldn't save the invoice PDF: ${upErr.message}`)
      // Audit row (best-effort).
      try {
        await supabase.from('fh_job_files').insert({
          id: rowId,
          user_id: user.id,
          job_id: contact.id,
          filename: result.filename,
          storage_path: path,
          mime_type: 'application/pdf',
          size_bytes: blob.size || 0,
          kind: 'file'
        })
      } catch (e) {
        console.warn('[invoice] fh_job_files row insert failed', e)
      }

      const sendRes = await fetch('/api/send-invoice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          sender_user_id: user.id,
          recipient_email: contact.email,
          recipient_name: contact.name || null,
          storage_path: path,
          filename: result.filename,
          amount_due: totals.balance
        })
      })
      const sendBody = await sendRes.json().catch(() => ({}))

      if (sendRes.status === 503 && sendBody?.error === 'sender_not_configured') {
        // Make the failure mode obvious — the prior "we saved the PDF
        // for you" toast got missed and the operator thought tapping
        // Send had silently downloaded. Now the toast leads with the
        // ACTUAL problem (email not configured) and explicitly names
        // the local download as a fallback.
        toastError(
          "Email NOT sent — sender isn't configured",
          'Downloaded the PDF so you can email it manually. To send direct, add Resend keys in Netlify env.'
        )
        downloadPdf(result)
        return
      }
      if (!sendRes.ok || !sendBody?.ok) {
        throw new Error(sendBody?.detail || sendBody?.error || 'Email send failed.')
      }

      toastSuccess(`Invoice sent to ${contact.email}`, result.filename)
      setSent(true)
      setTimeout(() => setSent(false), 2400)
      refresh()
    } catch (e) {
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
        {/* Right-side spacer so the eyebrow stays visually centered */}
        <span style={{ width: 60 }} aria-hidden="true" />
      </motion.div>

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
          boxShadow: '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 8px 22px rgba(0, 0, 0, 0.40)',
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
              {contact.name || 'Unnamed client'}
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
            {contact.address && (
              <div style={{
                marginTop: 3,
                fontFamily: 'var(--font-body)', fontSize: 11,
                color: 'var(--v3-text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
              }}>
                {contact.address}
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

      {/* STICKY ACTION BAR — Send + Generate PDF + Collect Payment.
          Three-button row: Send (email the invoice), PDF (local download),
          Collect (log a payment). Send is new (5/17 invoice-send port);
          Generate PDF + Collect Payment behavior unchanged. Sits above
          the BottomNav (position: fixed; bottom: 0 with safe-area).
          Padding-bottom raises us above the dock; gradient softens the
          transition into the page. */}
      <div style={{
        position: 'fixed',
        left: 0, right: 0,
        bottom: 'calc(56px + env(safe-area-inset-bottom))',
        padding: '10px 16px 10px',
        background: 'linear-gradient(180deg, transparent, color-mix(in srgb, var(--v3-bg) 92%, transparent) 32%, var(--v3-bg) 64%)',
        zIndex: 30,
        display: 'flex', gap: 8,
        pointerEvents: 'none'
      }}>
        <button
          type="button"
          onClick={() => {
            hapticTap()
            // No client email on file — explain to the user instead of
            // silently no-op'ing (was the audit's #1 critical failure).
            if (!contact.email) {
              toastError(
                'Add a client email first',
                `${contact.name || 'This client'} has no email on file. Open the linked job → edit details → add an email, then try again.`
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
              : '0 0 0 3px rgba(229, 193, 88, 0.10), 0 4px 12px rgba(229, 193, 88, 0.18), 0 1px 0 rgba(255, 255, 255, 0.30) inset',
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
          <V3PaymentSheet
            contact={contact}
            balance={totals.balance}
            onClose={() => setPaying(false)}
            onLogged={() => { setPaying(false); refresh() }}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function SectionTitle({ children }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 8, padding: '8px 2px 0'
    }}>
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.16em', textTransform: 'uppercase',
        color: 'var(--v3-text-muted)'
      }}>
        {children}
      </span>
    </div>
  )
}

function StatusPill({ status }) {
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
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '5px 12px', borderRadius: 999,
      background: palette.bg, border: `1px solid ${palette.border}`,
      color: palette.color,
      fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.14em', textTransform: 'uppercase',
      lineHeight: 1
    }}>
      Invoice · {status.label}
    </span>
  )
}
