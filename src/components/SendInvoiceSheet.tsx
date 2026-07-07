// src/components/SendInvoiceSheet.tsx
//
// Pipeline v2: fire an invoice straight off the job — the action the
// old flow buried behind the Financials tab + draws editor. One sheet:
// pick what you're billing (deposit / progress / final / custom),
// confirm the amount (prefilled with the unbilled remainder), pick a
// due window, then Send (email PDF via /api/send-invoice), Download,
// or Save draft. Creates a first-class fh_invoices row either way so
// the Invoices screen tracks it.

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Receipt, Send, Download, FileText, X } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { hapticTap, hapticSuccess, hapticError } from '../lib/haptics.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { useDrawerKeyboard } from '../lib/useDrawerKeyboard.ts'
import { supabase } from '../lib/supabase.ts'
import {
  companyFromProfile, contractTotals, suggestNextInvoice,
  fetchInvoicesForContact, createInvoice, sendInvoiceEmail, buildInvoicePdf,
  type InvoiceRow
} from '../lib/invoices.ts'
import { Eyebrow } from './v3'

function moneyFmt(n: any) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

const KIND_CHIPS = [
  { id: 'deposit',  label: 'Deposit' },
  { id: 'progress', label: 'Progress draw' },
  { id: 'final',    label: 'Final balance' },
  { id: 'custom',   label: 'Custom' }
]

const DUE_CHIPS = [
  { id: 0,  label: 'On receipt' },
  { id: 7,  label: '7 days' },
  { id: 14, label: '14 days' },
  { id: 30, label: '30 days' }
]

export default function SendInvoiceSheet({
  open, userId, contact,
  payments = [], changeOrders = [], insurance = null,
  onClose, onDone
}: any) {
  const { profile } = useProfile()
  const [existing, setExisting] = useState<InvoiceRow[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<null | 'send' | 'download' | 'draft'>(null)

  // Email resolved from the linked client record (fh_clients) when the
  // job row itself carries no email — a saved client's email should
  // never need re-entering to invoice them.
  const [clientEmail, setClientEmail] = useState('')
  const [kind, setKind] = useState('progress')
  const [customTitle, setCustomTitle] = useState('')
  const [amount, setAmount] = useState('')
  const [dueDays, setDueDays] = useState(14)
  const [notes, setNotes] = useState('')
  // Customer-facing "what is this bill for". Prefilled from the job's
  // title + property address — repeat clients with several properties
  // need the invoice to say which one this covers. Prints in the line
  // item's Description column on the PDF.
  const [description, setDescription] = useState('')
  const { formRef, drawerStyle, formStyle } = useDrawerKeyboard(open)

  const totals = useMemo(
    () => contractTotals({ contact, payments, changeOrders, invoices: existing }),
    [contact, payments, changeOrders, existing]
  )

  // Hydrate on open: load the job's existing invoices, then seed the
  // form from the suggested next bill (final balance when the work is
  // complete, otherwise the unbilled remainder).
  useEffect(() => {
    if (!open || !contact?.id) return
    let alive = true
    setLoading(true)
    ;(async () => {
      const { data } = await fetchInvoicesForContact(contact.id)
      if (!alive) return
      setExisting(data)
      const suggestion = suggestNextInvoice({ contact, payments, changeOrders, invoices: data })
      const activeCount = data.filter((d) => d.status !== 'void').length
      setKind(contact?.completed_at ? 'final' : activeCount === 0 ? 'deposit' : 'progress')
      setCustomTitle('')
      setAmount(suggestion.amount > 0 ? String(suggestion.amount) : '')
      setDueDays(14)
      setNotes('')
      setDescription(contact?.job_title || '')
      setLoading(false)
      // If the job row has no email but is linked to a client, pull the
      // client's email so we don't ask the operator to "add a client
      // email" for someone already in their book.
      const inlineEmail = (contact?.email || contact?.fh_clients?.email || '').trim()
      if (!inlineEmail && contact?.client_id) {
        const { data: cli } = await supabase
          .from('fh_clients')
          .select('email')
          .eq('id', contact.client_id)
          .maybeSingle()
        if (alive) setClientEmail((cli?.email || '').trim())
      } else {
        setClientEmail('')
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, contact?.id])

  const sequence = existing.filter((d) => d.status !== 'void').length + 1
  const title = kind === 'custom'
    ? (customTitle.trim() || `Invoice #${sequence}`)
    : kind === 'deposit' ? 'Deposit'
    : kind === 'final' ? 'Final balance'
    : `Progress draw ${sequence}`

  const recipientEmail = (contact?.email || contact?.fh_clients?.email || clientEmail || '').trim()
  const amountNum = Number(amount) || 0

  function applyPct(pct: number) {
    const base = totals.unbilled > 0 ? totals.unbilled : totals.balance
    setAmount(String(Math.max(1, Math.round(base * pct))))
  }

  // Always lands as a draft row first; sendInvoiceEmail flips it to
  // 'sent' on a successful send, so a failed send leaves an honest draft.
  async function makeInvoice() {
    const due_at = dueDays > 0
      ? new Date(Date.now() + dueDays * 86400000).toISOString()
      : new Date().toISOString()
    const { data, error } = await createInvoice({
      contact, userId,
      title, amount: amountNum,
      status: 'draft',
      due_at,
      notes,
      description
    })
    if (error || !data) throw new Error(error?.message || "Couldn't create the invoice")
    return data
  }

  function validate() {
    if (amountNum <= 0) {
      hapticError()
      toastError('Amount required', 'Enter what you’re billing for this invoice.')
      return false
    }
    return true
  }

  async function handleSend() {
    if (busy || !validate()) return
    if (!recipientEmail) {
      hapticError()
      toastError('Add a client email first', `Open ${contact?.name || 'this job'} to add an email, then try again.`)
      return
    }
    setBusy('send')
    try {
      const invoice = await makeInvoice()
      const company = companyFromProfile(profile)
      const res = await sendInvoiceEmail({
        invoice, contact, company, userId,
        recipientEmail, payments, changeOrders, insurance
      })
      if (res.ok) {
        hapticSuccess()
        toastSuccess(`Invoice sent to ${res.recipient}`, `${title} · ${moneyFmt(amountNum)}`)
        onDone?.()
        onClose?.()
      } else if (res.reason === 'sender_not_configured') {
        toastError("Email NOT sent — sender isn't configured", 'Downloaded the PDF so you can email it manually. The invoice is saved as a draft.')
        onDone?.()
        onClose?.()
      } else {
        throw new Error(res.message || 'Send failed')
      }
    } catch (e: any) {
      hapticError()
      toastError("Couldn't send invoice", e?.message || 'Try again.')
    } finally {
      setBusy(null)
    }
  }

  async function handleDownload() {
    if (busy || !validate()) return
    setBusy('download')
    try {
      const invoice = await makeInvoice()
      const company = companyFromProfile(profile)
      const result = await buildInvoicePdf({ invoice, contact, company, payments, changeOrders, insurance })
      const { downloadPdf } = await import('../lib/pdf.js')
      downloadPdf(result)
      hapticSuccess()
      toastSuccess('Invoice PDF downloaded', result.filename)
      onDone?.()
      onClose?.()
    } catch (e: any) {
      hapticError()
      toastError("Couldn't build the PDF", e?.message || 'Try again.')
    } finally {
      setBusy(null)
    }
  }

  async function handleDraft() {
    if (busy || !validate()) return
    setBusy('draft')
    try {
      await makeInvoice()
      hapticSuccess()
      toastSuccess('Invoice saved as draft', `${title} · ${moneyFmt(amountNum)}`)
      onDone?.()
      onClose?.()
    } catch (e: any) {
      hapticError()
      toastError("Couldn't save the invoice", e?.message || 'Try again.')
    } finally {
      setBusy(null)
    }
  }

  const labelStyle: import('react').CSSProperties = {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
    textTransform: 'uppercase', color: 'var(--ink-muted)'
  }
  const fieldStyle: import('react').CSSProperties = {
    padding: '11px 14px', borderRadius: 12,
    background: 'var(--surface-2)', border: '1px solid var(--rule)',
    color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14,
    outline: 'none', width: '100%', boxSizing: 'border-box',
    scrollMarginTop: 96, scrollMarginBottom: 120
  }

  return (
    <Drawer open={open} onOpenChange={(v: any) => { if (!v && !busy) onClose?.() }}>
      <DrawerContent className="ui:max-w-full ui:overflow-x-hidden" style={drawerStyle}>
        <DrawerHeader className="ui:text-left" style={{ maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <Eyebrow as="div">
            <Receipt size={12} />
            Invoice
          </Eyebrow>
          <DrawerTitle asChild>
            <h2
              className="fh-font-serif"
              style={{ margin: '6px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
            >
              Bill this job.
            </h2>
          </DrawerTitle>
          <DrawerDescription style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}>
            Invoice <strong style={{ color: 'var(--ink-strong)' }}>{contact?.name || 'this job'}</strong>
            {existing.filter((d) => d.status !== 'void').length > 0 && (
              <> — invoice #{sequence} on this job</>
            )}.
          </DrawerDescription>
        </DrawerHeader>

        <form ref={formRef} onSubmit={(e) => { e.preventDefault(); handleSend() }} style={formStyle({ gap: 14 })}>
          {loading ? (
            <div style={{
              padding: 16, borderRadius: 12,
              background: 'var(--surface-2)', border: '1px solid var(--rule)',
              color: 'var(--ink-muted)', fontSize: 12, fontFamily: 'var(--font-body)',
              textAlign: 'center'
            }}>
              Loading job billing…
            </div>
          ) : (
            <>
              {/* Money snapshot */}
              <div style={{
                display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8,
                padding: '12px 14px', borderRadius: 12,
                background: 'var(--surface-2)', border: '1px solid var(--rule)'
              }}>
                <Stat label="Contract" value={moneyFmt(totals.contractTotal)} />
                <Stat label="Paid" value={moneyFmt(totals.paid)} tone={totals.balance > 0 ? 'muted' : 'good'} />
                <Stat label="Unbilled" value={moneyFmt(totals.unbilled)} tone={totals.unbilled > 0 ? 'gold' : 'muted'} />
              </div>

              {/* What is this invoice for */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={labelStyle}>What for</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {KIND_CHIPS.map((c) => {
                    const active = kind === c.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => {
                          hapticTap()
                          setKind(c.id)
                          if (c.id === 'final') setAmount(String(Math.round(totals.unbilled || totals.balance)))
                        }}
                        disabled={!!busy}
                        style={chipStyle(active, !!busy)}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>
                {kind === 'custom' && (
                  <input
                    type="text"
                    value={customTitle}
                    onChange={(e) => setCustomTitle(e.target.value)}
                    placeholder="e.g. Materials reimbursement"
                    disabled={!!busy}
                    style={fieldStyle}
                  />
                )}
              </div>

              {/* Amount */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={labelStyle}>Amount</span>
                <div style={{ position: 'relative' }}>
                  <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)', fontSize: 14 }}>$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                    placeholder={totals.unbilled > 0 ? String(Math.round(totals.unbilled)) : '0'}
                    disabled={!!busy}
                    style={{ ...fieldStyle, paddingLeft: 28 }}
                  />
                </div>
                {(totals.unbilled > 0 || totals.balance > 0) && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    <button type="button" onClick={() => { hapticTap(); applyPct(1) }} disabled={!!busy} style={chipStyle(false, !!busy)}>
                      Everything unbilled
                    </button>
                    <button type="button" onClick={() => { hapticTap(); applyPct(0.5) }} disabled={!!busy} style={chipStyle(false, !!busy)}>
                      Half
                    </button>
                    <button type="button" onClick={() => { hapticTap(); applyPct(0.25) }} disabled={!!busy} style={chipStyle(false, !!busy)}>
                      Quarter
                    </button>
                  </div>
                )}
              </div>

              {/* Description — what the customer reads on the PDF */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={labelStyle}>Description (shows on the invoice)</span>
                <textarea
                  rows={2}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="e.g. Summit Townhomes sidewalk repair"
                  disabled={!!busy}
                  style={{ ...fieldStyle, resize: 'vertical' }}
                />
              </label>

              {/* Due window */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <span style={labelStyle}>Due</span>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {DUE_CHIPS.map((c) => {
                    const active = dueDays === c.id
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => { hapticTap(); setDueDays(c.id) }}
                        disabled={!!busy}
                        style={chipStyle(active, !!busy)}
                      >
                        {c.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* Notes */}
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={labelStyle}>Payment instructions (optional)</span>
                <textarea
                  rows={2}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Remit-to / check / ACH details"
                  disabled={!!busy}
                  style={{ ...fieldStyle, resize: 'vertical' }}
                />
              </label>

              {/* Actions — Send is primary; Download and Save draft are
                  the fallbacks for no-email clients / not-ready bills. */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={() => { hapticTap(); handleDraft() }}
                  disabled={!!busy}
                  style={ghostBtnStyle(!!busy)}
                >
                  <FileText size={13} />
                  {busy === 'draft' ? 'Saving…' : 'Save draft'}
                </button>
                <button
                  type="button"
                  onClick={() => { hapticTap(); handleDownload() }}
                  disabled={!!busy}
                  style={ghostBtnStyle(!!busy)}
                >
                  <Download size={13} />
                  {busy === 'download' ? 'Building…' : 'Download PDF'}
                </button>
              </div>
              <motion.button
                type="submit"
                whileTap={{ scale: busy ? 1 : 0.98 }}
                disabled={!!busy}
                title={recipientEmail ? `Email to ${recipientEmail}` : 'No client email on file'}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '13px 14px', borderRadius: 12, border: 'none',
                  background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                  color: 'var(--onyx)',
                  fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.14em',
                  cursor: busy ? 'wait' : 'pointer',
                  boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                  opacity: busy ? 0.6 : 1
                }}
              >
                <Send size={14} />
                {busy === 'send'
                  ? 'SENDING…'
                  : recipientEmail
                    ? `SEND TO ${recipientEmail.toUpperCase()}`
                    : 'SEND INVOICE'}
              </motion.button>
              <button
                type="button"
                onClick={() => { if (!busy) onClose?.() }}
                disabled={!!busy}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '10px', borderRadius: 12, marginBottom: 4,
                  background: 'transparent', border: 'none',
                  color: 'var(--ink-muted)',
                  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
                  cursor: busy ? 'wait' : 'pointer'
                }}
              >
                <X size={13} />
                Cancel
              </button>
            </>
          )}
        </form>
      </DrawerContent>
    </Drawer>
  )
}

function chipStyle(active: boolean, disabled: boolean): import('react').CSSProperties {
  return {
    padding: '7px 12px',
    borderRadius: 999,
    border: active ? '1px solid var(--v3-border-strong)' : '1px solid var(--rule)',
    background: active ? 'var(--v3-glass-tint-2)' : 'var(--surface-2)',
    color: active ? 'var(--ink-strong)' : 'var(--ink-muted)',
    fontFamily: 'var(--font-body)',
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? 'wait' : 'pointer',
    transition: 'all 160ms ease'
  }
}

function ghostBtnStyle(busy: boolean): import('react').CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
    padding: '11px 12px', borderRadius: 12,
    background: 'var(--surface-2)', border: '1px solid var(--v3-border-strong)',
    color: 'var(--ink-strong)',
    fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase',
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.7 : 1
  }
}

function Stat({ label, value, tone = 'default' }: any) {
  const color = tone === 'good'
    ? 'var(--signal-green, #4ade80)'
    : tone === 'gold'
      ? 'var(--field-gold-bright, #e4be6f)'
      : tone === 'danger'
        ? 'var(--alert-red, #b3493b)'
        : 'var(--ink-strong)'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <Eyebrow style={{ color: 'var(--ink-muted)' }}>
        {label}
      </Eyebrow>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: 16, lineHeight: 1, color,
        fontVariantNumeric: 'tabular-nums',
        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
      }}>
        {value}
      </span>
    </div>
  )
}
