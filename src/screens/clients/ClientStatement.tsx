// A customer's statement, /clients/:id/statement (Phase 9, Task 14, D57).
// It took the place of the statement sheet the customer page and Money's
// Who owes you opened: every open invoice across the customer's
// properties rolled into one document, previewed per property, then
// emailed, downloaded or shared as a link. The figures come from the same
// gatherStatement the PDF and the email use, to the cent.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Button, IconButton, SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { useClientDetail } from '../../lib/queries.ts'
import { companyFromProfile } from '../../lib/invoices.ts'
import { gatherStatement, downloadStatement, sendStatementEmail } from '../../lib/statement.ts'
import { mintPublicLink, listClientStatementLinks, buildPublicUrl } from '../../lib/publicLink.ts'
import { toast, toastSuccess, toastInfo } from '../../lib/toast.ts'
import { moneyExact } from '../../lib/format.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { recordRoute } from '../../lib/records.ts'
import './client-statement.css'

// A statement is a financial document: every figure here must match the
// PDF and the email to the cent, never a "$12K" abbreviation.
const money = moneyExact

export default function ClientStatement() {
  const { id } = useParams()
  const { user } = useAuth()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const { data: bundle, isPending: loading, isError, refetch } = useClientDetail(id, user?.id)
  const client = bundle?.client ?? null
  const [busy, setBusy] = useState<null | 'download' | 'email' | 'link'>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  // Pure rollup of (contract + approved change orders) less paid, per property.
  const data = useMemo(
    () => gatherStatement((bundle?.jobs ?? []) as any, (bundle?.payments ?? []) as any, (bundle?.changeOrders ?? []) as any),
    [bundle]
  )
  const company = useMemo(() => companyFromProfile(profile), [profile])
  const recipientEmail = (client?.email || '').trim()
  const title = client?.company_name || client?.name || 'client'
  const home = recordRoute('client', id || '')

  function goBack() {
    hapticTap()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate(home, { replace: true })
  }

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
    if (!data || busy || !client || !user?.id) return
    setBusy('email')
    try {
      const res = await sendStatementEmail({ company, client, data, userId: user.id, recipientEmail })
      if (res.ok) {
        toastSuccess(`Statement sent to ${res.recipient}`, `${money(data.totalDue)} due`)
        goBack()
      } else if (res.reason === 'no_email') {
        toast('No email on file', { description: 'Add an email to this client first, or download and send manually.' })
      } else if (res.reason === 'sender_not_configured') {
        toastInfo('Email not set up, downloaded instead', 'The statement PDF was saved to your device.')
        goBack()
      } else {
        toast("Couldn't send the statement", { description: res.message || 'Try again' })
      }
    } finally {
      setBusy(null)
    }
  }

  // Mint (or reuse) a client scoped public statement link and copy it. The
  // customer opens /p/{token}: the same rollup as a live web page with the
  // contractor's branding, no login.
  async function handleShareLink() {
    if (busy || !client?.id || !user?.id) return
    setBusy('link')
    try {
      const existing = await listClientStatementLinks(client.id)
      const url = existing.length > 0
        ? buildPublicUrl(existing[0].token)
        : (await mintPublicLink({ clientId: client.id, userId: user.id, kind: 'statement' })).url
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

  return (
    <div className="fhcs">
      <header className="fhcs-head">
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
        <h1 className="fhcs-title" ref={titleRef} tabIndex={-1}>
          {loading && !client ? 'Statement' : `Statement for ${title}`}
        </h1>
      </header>
      <p className="fhcs-lede">Every open invoice across all properties, rolled into one document.</p>

      {loading && !client && <div className="fhcs-body"><SkeletonRows rows={3} label="Loading the statement" /></div>}

      {!loading && (isError || !client) && (
        <div className="fhcs-body">
          <DataErrorState
            title={isError ? "Couldn't load this customer" : 'This customer is gone'}
            message={isError ? 'Check your connection and try again. Nothing was changed.' : 'It may have been deleted.'}
            actionLabel={isError ? 'Try again' : ''}
            onRetry={() => { void refetch() }}
          />
        </div>
      )}

      {client && (
        <div className="fhcs-body">
          {data.lines.length === 0 && (
            <p className="fhcs-empty">
              Nothing outstanding for this client right now. Statements roll up the balance across every property they owe on.
            </p>
          )}

          {data.lines.length > 0 && (
            <>
              <ul className="fhcs-lines" aria-label="Open balances by property">
                {data.lines.map((l, i) => (
                  <li key={i} className="fhcs-line">
                    <div className="fhcs-line__text">
                      <span className="fhcs-line__property">{l.property}</span>
                      <span className="fhcs-line__paid">{money(l.paid)} paid of {money(l.contract)}</span>
                    </div>
                    <span className="fhcs-line__balance">{money(l.balance)}</span>
                  </li>
                ))}
              </ul>
              <div className="fhcs-total">
                <span className="fhcs-total__label">Total due</span>
                <span className="fhcs-total__amount">{money(data.totalDue)}</span>
              </div>

              <div className="fhcs-actions">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleEmail}
                  loading={busy === 'email'}
                  disabled={!!busy && busy !== 'email'}
                  title={recipientEmail ? `Email to ${recipientEmail}` : 'No client email on file'}
                >
                  Email statement
                </Button>
                <Button variant="secondary" size="lg" onClick={handleDownload} loading={busy === 'download'} disabled={!!busy && busy !== 'download'}>
                  Download
                </Button>
                <Button variant="quiet" size="lg" onClick={handleShareLink} loading={busy === 'link'} disabled={!!busy && busy !== 'link'}>
                  Copy share link
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
