// A customer's statement, /clients/:id/statement (Phase 9, Task 14, D57).
// It took the place of the statement sheet the customer page and Money's
// Who owes you opened: every open invoice across the customer's
// properties rolled into one document, previewed per property, then
// emailed, downloaded or shared as a link. The figures come from the same
// gatherStatement the PDF, the email and the customer link use, to the
// cent: Total due is what is owed on issued invoices (invoices billed to
// the client directly included), and contract money not yet invoiced is
// listed apart, outside Total due.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Button, IconButton, SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useClientDetail } from '../../lib/queries.ts'
import { companyFromProfile } from '../../lib/invoices.ts'
import { useDocumentProfile } from '../../lib/companyBranding.ts'
import { gatherStatement, downloadStatement, sendStatementEmail, fetchStatementMoney } from '../../lib/statement.ts'
import { mintPublicLink, listClientStatementLinks, buildPublicUrl } from '../../lib/publicLink.ts'
import { toast, toastSuccess, toastInfo } from '../../lib/toast.ts'
import { moneyExact } from '../../lib/format.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { sendKey, startSend, useSendInFlight } from '../../lib/invoiceSends.ts'
import { recordRoute } from '../../lib/records.ts'
import './client-statement.css'
import { plainError } from '../../lib/serviceErrors.ts'

// A statement is a financial document: every figure here must match the
// PDF and the email to the cent, never a "$12K" abbreviation.
const money = moneyExact

export default function ClientStatement() {
  const { id } = useParams()
  const { user } = useAuth()
  const navigate = useNavigate()
  const { data: bundle, isPending: loading, isError, refetch } = useClientDetail(id, user?.id)
  const client = bundle?.client ?? null
  const [busy, setBusy] = useState<null | 'download' | 'email' | 'link'>(null)
  // The email is kept app wide (lib/invoiceSends), not in this screen:
  // leave the statement while it is still going out and come back, and it
  // is still busy.
  const emailOut = useSendInFlight(id ? sendKey.statement(id) : null)
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  // The invoices and the payments with the invoice each one paid, which
  // the client bundle does not carry.
  const jobIds = useMemo(() => (bundle?.jobs ?? []).map((j) => j.id), [bundle])
  const moneyQuery = useQuery({
    queryKey: ['clientStatementMoney', id, jobIds],
    queryFn: () => fetchStatementMoney(id as string, jobIds),
    enabled: !!id && !!client
  })
  const data = useMemo(
    () => gatherStatement(
      (bundle?.jobs ?? []) as any,
      moneyQuery.data?.payments ?? [],
      (bundle?.changeOrders ?? []) as any,
      { invoices: moneyQuery.data?.invoices ?? [] }
    ),
    [bundle, moneyQuery.data]
  )
  const moneyReady = !!moneyQuery.data
  // The client's own company, whoever builds the statement (DATA-06).
  const documentProfile = useDocumentProfile(client?.org_id)
  const loadCompany = async () => companyFromProfile(await documentProfile.load())
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
      await downloadStatement({ company: await loadCompany(), client, data })
      toastSuccess('Statement downloaded', `${money(data.totalDue)} across ${data.lines.length} invoice${data.lines.length === 1 ? '' : 's'}`)
    } catch (e: any) {
      toast('Could not generate the statement', { description: plainError(e, 'Try again.') })
    } finally {
      setBusy(null)
    }
  }

  async function handleEmail() {
    if (!data || busy || emailOut || !client || !user?.id) return
    const end = startSend(sendKey.statement(client.id))
    if (!end) return
    let sent = false
    setBusy('email')
    try {
      const res = await sendStatementEmail({ company: await loadCompany(), client, data, userId: user.id, recipientEmail })
      sent = res.ok
      if (res.ok) {
        toastSuccess(`Statement sent to ${res.recipient}`, `${money(data.totalDue)} due`)
        goBack()
      } else if (res.reason === 'no_email') {
        toast('No email on file', { description: 'Add an email to this client first, or download and send manually.' })
      } else if (res.reason === 'sender_not_configured') {
        toastInfo('Email not set up, downloaded instead', 'The statement PDF was saved to your device.')
        goBack()
      } else {
        toast("Couldn't send the statement", { description: res.message || 'The statement was not sent. Try again.' })
      }
    } finally {
      end(sent)
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
      toast("Couldn't create the link", { description: plainError(e, 'Try again.') })
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

      {client && !moneyReady && !moneyQuery.isError && (
        <div className="fhcs-body"><SkeletonRows rows={3} label="Loading the statement" /></div>
      )}

      {client && moneyQuery.isError && (
        <div className="fhcs-body">
          <DataErrorState
            title="Couldn't load the invoices"
            message="Check your connection and try again. Nothing was changed."
            actionLabel="Try again"
            onRetry={() => { void moneyQuery.refetch() }}
          />
        </div>
      )}

      {client && moneyReady && (
        <div className="fhcs-body">
          {data.lines.length === 0 && (
            <p className="fhcs-empty">
              Nothing outstanding for this client right now. Statements roll up what is owed on sent invoices across every property.
            </p>
          )}

          {data.lines.length === 0 && data.notInvoiced.length > 0 && <NotInvoiced data={data} />}

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

              {data.notInvoiced.length > 0 && <NotInvoiced data={data} />}

              <div className="fhcs-actions">
                <Button
                  variant="primary"
                  size="lg"
                  onClick={handleEmail}
                  loading={busy === 'email' || emailOut}
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

// Contract money nobody has invoiced yet: shown so the contractor sees it,
// never part of Total due.
function NotInvoiced({ data }: { data: ReturnType<typeof gatherStatement> }) {
  return (
    <ul className="fhcs-lines" aria-label="Not yet invoiced">
        {data.notInvoiced.map((l, i) => (
          <li key={i} className="fhcs-line">
            <div className="fhcs-line__text">
              <span className="fhcs-line__property">{l.property}</span>
              <span className="fhcs-line__paid">Not invoiced yet, not in the total</span>
            </div>
            <span className="fhcs-line__balance">{money(l.balance)}</span>
          </li>
        ))}
    </ul>
  )
}
