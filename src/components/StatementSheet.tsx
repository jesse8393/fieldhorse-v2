// src/components/StatementSheet.tsx
//
// Shared client-statement sheet. Gathers every open invoice across a
// client's properties, previews the per-property breakdown, and
// downloads or emails the rolled-up statement PDF. Used from both
// ClientDetail and the Invoices A/R-by-client rollup.

import { useMemo, useState } from 'react'
import { Download, Mail, Link2 } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { companyFromProfile } from '../lib/invoices.ts'
import { gatherStatement, downloadStatement, sendStatementEmail, type StatementJob, type StatementPayment, type StatementChangeOrder } from '../lib/statement.ts'
import { mintPublicLink, listClientStatementLinks, buildPublicUrl } from '../lib/publicLink.ts'
import { toast, toastSuccess, toastInfo } from '../lib/toast.ts'

function money(n: any) {
  const v = Number(n || 0)
  if (!v) return '$0'
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

export type StatementSheetClient = {
  id: string
  name?: string | null
  company_name?: string | null
  email?: string | null
  address?: string | null
}

export default function StatementSheet({ open, onClose, client, jobs, payments, changeOrders = [], userId }: {
  open: boolean
  onClose: () => void
  client: StatementSheetClient | null
  jobs: StatementJob[]
  payments: StatementPayment[]
  changeOrders?: StatementChangeOrder[]
  userId: string | undefined
}) {
  const { profile } = useProfile()
  const [busy, setBusy] = useState<null | 'download' | 'email' | 'link'>(null)

  // Pure rollup of (contract + approved COs) − paid per property.
  const data = useMemo(() => gatherStatement(jobs || [], payments || [], changeOrders || []), [jobs, payments, changeOrders])

  const company = useMemo(() => companyFromProfile(profile), [profile])
  const recipientEmail = (client?.email || '').trim()

  async function handleDownload() {
    if (!data || busy || !client) return
    setBusy('download')
    try {
      await downloadStatement({ company, client, data })
      toastSuccess('Statement downloaded', `${money(data.totalDue)} across ${data.lines.length} invoice${data.lines.length === 1 ? '' : 's'}`)
    } catch (e: any) {
      toast('Could not generate the statement', { description: e?.message || 'Try again' })
    } finally {
      setBusy(null)
    }
  }

  async function handleEmail() {
    if (!data || busy || !client || !userId) return
    setBusy('email')
    try {
      const res = await sendStatementEmail({ company, client, data, userId, recipientEmail })
      if (res.ok) {
        toastSuccess(`Statement sent to ${res.recipient}`, `${money(data.totalDue)} due`)
        onClose?.()
      } else if (res.reason === 'no_email') {
        toast('No email on file', { description: 'Add an email to this client first, or download and send manually.' })
      } else if (res.reason === 'sender_not_configured') {
        toastInfo('Email not set up, downloaded instead', 'The statement PDF was saved to your device.')
        onClose?.()
      } else {
        toast("Couldn't send the statement", { description: res.message || 'Try again' })
      }
    } finally {
      setBusy(null)
    }
  }

  // Mint (or reuse) a client-scoped public statement link and copy it.
  // The customer opens /p/{token} → the same rollup renders as a live
  // web page with the contractor's branding, no login.
  async function handleShareLink() {
    if (busy || !client?.id || !userId) return
    setBusy('link')
    try {
      const existing = await listClientStatementLinks(client.id)
      const url = existing.length > 0
        ? buildPublicUrl(existing[0].token)
        : (await mintPublicLink({ clientId: client.id, userId, kind: 'statement' })).url
      try {
        await navigator.clipboard.writeText(url)
        toastSuccess('Statement link copied', 'Send via text, email, however you like.')
      } catch {
        toastSuccess('Statement link ready', url)
      }
    } catch (e: any) {
      toast("Couldn't create the link", { description: e?.message || 'Try again' })
    } finally {
      setBusy(null)
    }
  }

  const title = client?.company_name || client?.name || 'client'

  return (
    <Drawer open={open} onOpenChange={(o: any) => { if (!o && !busy) onClose?.() }}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Statement for {title}</DrawerTitle>
          <DrawerDescription>Every open invoice across all properties, rolled into one document.</DrawerDescription>
        </DrawerHeader>
        <div style={{ padding: '4px 16px max(16px, env(safe-area-inset-bottom))', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {data.lines.length === 0 && (
            <div style={{ color: 'var(--v3-text-muted)', fontSize: 14, padding: '16px 0', textAlign: 'center', lineHeight: 1.5 }}>
              Nothing outstanding for this client right now. Statements roll up the balance across every property they owe on.
            </div>
          )}

          {data.lines.length > 0 && (
            <>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 240, overflowY: 'auto' }}>
                {data.lines.map((l, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, padding: '8px 12px', borderRadius: 10, background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)' }}>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--v3-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.property}</div>
                      <div style={{ fontSize: 12, color: 'var(--v3-text-muted)', marginTop: 1 }}>{money(l.paid)} paid of {money(l.contract)}</div>
                    </div>
                    <span style={{ flexShrink: 0, fontSize: 14, fontWeight: 700, color: 'var(--v3-text)', fontVariantNumeric: 'tabular-nums' }}>{money(l.balance)}</span>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '12px 12px', borderRadius: 10, background: 'var(--v3-primary-soft)', border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)' }}>
                <span style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: 'var(--v3-primary)' }}>Total due</span>
                <span style={{ fontSize: 20, fontWeight: 800, color: 'var(--v3-primary)', fontVariantNumeric: 'tabular-nums' }}>{money(data.totalDue)}</span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 2 }}>
                <button
                  type="button"
                  onClick={handleDownload}
                  disabled={!!busy}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border-strong)', color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1, WebkitTapHighlightColor: 'transparent' }}
                >
                  <Download size={15} /> {busy === 'download' ? 'Building…' : 'Download'}
                </button>
                <button
                  type="button"
                  onClick={handleEmail}
                  disabled={!!busy}
                  title={recipientEmail ? `Email to ${recipientEmail}` : 'No client email on file'}
                  style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, background: 'var(--v3-primary)', border: 'none', color: 'var(--v3-on-primary)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1, WebkitTapHighlightColor: 'transparent' }}
                >
                  <Mail size={15} /> {busy === 'email' ? 'Sending…' : 'Email'}
                </button>
              </div>

              <button
                type="button"
                onClick={handleShareLink}
                disabled={!!busy || !client?.id}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px', borderRadius: 10, background: 'transparent', border: '1px solid var(--v3-border-strong)', color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: busy ? 0.6 : 1, WebkitTapHighlightColor: 'transparent' }}
              >
                <Link2 size={15} /> {busy === 'link' ? 'Preparing…' : 'Copy share link'}
              </button>
            </>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  )
}
