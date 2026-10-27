// The quote screen, /quotes/:id (Phase 9, Task 10, decisions D53 to D61).
//
// A quote is a record of its own on fh_quotes, pointing at a client. The
// screen shows the client, the title, the lines (tap one to edit it where it
// stands, a plus row adds one), the total and the deposit sentence from
// lib/quoteMoney.ts (D31), Scope and terms as a row that opens
// /quotes/:id/terms, the status, Preview (/quotes/:id/preview), Send, the
// share and download rows, Approve quote (/quotes/:id/approve) and Make this
// a job (D61), which reads "Open the job" once job_id is set. Nothing opens
// in a sheet (D57). The one gold button is Send.
//
// The id may also be an old fh_contacts id (D56): when no quote has it, the
// `fallback` renders, and the old detail screen sends a moved row on to its
// new record.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { Button, Chip, Icon, Row, SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { supabase } from '../../lib/supabase.ts'
import { useLinkedClientEmail } from '../../lib/queries.ts'
import { customerEmail } from '../../lib/customerEmail.ts'
import { makeJobFromQuote, quoteNumber } from '../../lib/quotes.ts'
import { recordRoute } from '../../lib/records.ts'
import { buildQuoteView, previewAsLabel, previewAsName, quoteCapsule } from '../../lib/quoteView.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { toastError, toastSuccess } from '../../lib/toast.ts'
import { useQuoteItems } from '../ContactDetail/sections/QuoteItems.tsx'
import { shortDate, statusChip } from '../ContactDetail/lib/quoteStatus.ts'
import QuoteHeader from './QuoteHeader.tsx'
import QuoteLines, { type QuoteLinesChange } from './QuoteLines.tsx'
import { useQuote } from './useQuote.ts'
import { quoteStatusView, quoteTitle, type QuoteWithClient } from './quoteShape.ts'
import {
  buildQuotePdf, canMarkSent, companyFromProfile, downloadQuotePdf, isIosStandalone, markQuoteSent, mintQuoteLink,
  NoLinesError, sendQuoteByEmail, sendQuoteForSignature
} from './quoteDocument.ts'
import './quotes.css'

// What Approve, Send and the share rows say when the lines could not be
// read: never that there are none.
const LINES_FAILED = "We couldn't load the lines."
const NEEDS_A_LINE = 'Add at least one line.'

type Busy = 'send' | 'mark' | 'share' | 'pdf' | 'download' | 'esign' | 'job' | 'delete' | null

export default function QuoteDetail({ fallback }: { fallback?: ReactNode }) {
  const { id = '' } = useParams()
  const state = useQuote(id)

  if (state.status === 'missing') return <>{fallback ?? <QuoteGone />}</>
  if (state.status === 'loading' || (state.status === 'failed' && !state.quote)) {
    return (
      <div className="fhqt-page">
        <QuoteHeader kicker="Quote" home="/quotes" />
        {state.status === 'failed' ? (
          <DataErrorState
            title="Couldn't load the quote"
            message="Check your connection and try again."
            actionLabel="Try again"
            onRetry={() => { void state.refresh() }}
          />
        ) : (
          <div className="fhqt-loading"><SkeletonRows rows={5} label="Loading the quote" /></div>
        )}
      </div>
    )
  }
  return <QuoteScreen quote={state.quote as QuoteWithClient} refresh={state.refresh} />
}

function QuoteGone() {
  return (
    <div className="fhqt-page">
      <QuoteHeader kicker="Quote" home="/quotes" />
      <DataErrorState title="This quote is gone" message="It may have been deleted. The Quotes list has the rest." actionLabel="" />
    </div>
  )
}

type ScreenProps = {
  quote: QuoteWithClient
  refresh: () => Promise<void>
}

function QuoteScreen({ quote, refresh }: ScreenProps) {
  const { user } = useAuth()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const userId = user?.id
  const titleRef = useRef<HTMLHeadingElement>(null)
  // The create screen lands here with ?lines=new (Task 8): the first line's
  // editor is open already, and the flag leaves the address at once.
  const [searchParams, setSearchParams] = useSearchParams()
  const [startAdding] = useState(() => searchParams.get('lines') === 'new')
  useEffect(() => {
    if (!searchParams.has('lines')) return
    const next = new URLSearchParams(searchParams)
    next.delete('lines')
    setSearchParams(next, { replace: true })
  }, [searchParams, setSearchParams])

  const items = useQuoteItems({ quoteId: quote.id, userId })
  const [lines, setLines] = useState<QuoteLinesChange>({ effective: [], switchSaving: false })
  const linesFailed = !items.loading && items.failed && !items.loaded

  const status = useMemo(() => quoteStatusView(quote), [quote])
  const chip = statusChip(status)
  const approved = status.label === 'Approved'
  const changesRequested = status.label === 'Changes requested'
  const client = quote.fh_clients ?? null
  const who = previewAsName(client?.name)
  const company = useMemo(() => companyFromProfile(profile), [profile])

  // The money: the base lines plus, until a line is priced, the quote's own
  // amount, and the deposit the payment terms name (D31).
  const terms = useMemo(() => ({ contactAmount: quote.amount, termsText: quote.terms_text }), [quote.amount, quote.terms_text])
  const live = useMemo(() => buildQuoteView(lines.effective, terms), [lines.effective, terms])
  const loadingMoney = useMemo(() => buildQuoteView([], terms).money, [terms])
  const capsule = quoteCapsule(items.loading ? loadingMoney : live.money)

  // The customer's email, read fresh from the client each time the screen
  // opens (lib/customerEmail.ts), never a copy from before: the address may
  // have changed on the client page since. While it is being read, or when
  // the read failed, Send waits and says why instead of copying a link.
  const linked = useLinkedClientEmail(quote.client_id)
  const recipientEmail = customerEmail({ email: '', fh_clients: { email: linked.data ?? null } })
  const emailPending = linked.isPending || (linked.isFetching && (!linked.isFetchedAfterMount || linked.isError))
  const emailFailed = !emailPending && linked.isError
  const emailRetrying = linked.isError && linked.isFetching
  const emailKnown = !emailPending && !emailFailed
  const hasEmail = emailKnown && recipientEmail !== ''
  const sendLabel = emailKnown && !hasEmail ? 'Copy approval link' : approved ? 'Send again' : 'Send for approval'

  const [busy, setBusy] = useState<Busy>(null)
  const waiting = items.loading || busy !== null || lines.switchSaving
  const needsLines = !items.loading && !live.canSend
  const linesLine = linesFailed ? LINES_FAILED : NEEDS_A_LINE
  const sendHint = needsLines
    ? (linesFailed ? LINES_FAILED : 'Add at least one line')
    : emailFailed
      ? "Couldn't check the email"
      : emailKnown && !hasEmail ? 'Copies a link' : undefined

  const build = () => buildQuotePdf({ quote, company, userId: userId as string, recipientEmail: hasEmail ? recipientEmail : null })

  function failed(title: string, e: unknown) {
    const message = e instanceof NoLinesError ? e.message : (e as Error)?.message || 'Try again.'
    toastError(title, message)
  }

  async function run(kind: Exclude<Busy, null>, work: () => Promise<void>, title: string) {
    if (!userId || busy) return
    hapticTap()
    setBusy(kind)
    try { await work() } catch (e) { failed(title, e) } finally { setBusy(null) }
  }

  const onSend = () => run('send', async () => {
    const outcome = await sendQuoteByEmail({ quote, company, userId: userId as string, recipientEmail, preferences: profile?.preferences })
    if (outcome.kind === 'sender_not_configured') {
      toastError('Email sender is not configured yet', 'The PDF is saved. Ask whoever set up the deploy to add the Resend keys.')
      await downloadQuotePdf(outcome.result)
      return
    }
    await refresh()
    toastSuccess(`Proposal sent to ${recipientEmail}`)
  }, "Couldn't send proposal")

  const onShare = () => run('share', async () => {
    const url = await mintQuoteLink(quote, userId as string)
    // On an iPhone added to the home screen the share sheet is how a link
    // goes out, so offer it while the tap is still fresh. Cancellation
    // leaves the clipboard and lifecycle alone; refusal permits copying.
    let shared = false
    if (isIosStandalone() && typeof navigator.share === 'function') {
      try {
        await navigator.share({ title: `Proposal for ${client?.name || 'your project'}`, url })
        shared = true
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') return
        // An unavailable share sheet still permits copying.
      }
    }
    if (!shared) {
      try {
        await navigator.clipboard.writeText(url)
        toastSuccess('Share link copied', 'Send via text, email, however you like.')
      } catch {
        toastSuccess('Share link ready', url)
      }
    }
  }, "Couldn't mint share link")

  const onMarkSent = () => run('mark', async () => {
    if (!canMarkSent(quote.status) || quote.job_id) return
    try {
      await markQuoteSent(quote.id, quote.status)
    } catch (error) {
      await refresh()
      throw error
    }
    await refresh()
    toastSuccess('Quote marked as sent', 'Recorded that you shared the proposal with the customer.')
  }, "Couldn't update the quote")

  const onOpenPdf = () => {
    // Open the tab now, inside the tap: building the PDF takes seconds, and
    // Safari drops a window.open that runs after that much async work.
    const win = window.open('', '_blank')
    if (!win) {
      toastError("Couldn't open the preview", 'Allow popups for this site, or use Download.')
      return
    }
    try { win.document.title = 'Preparing preview'; win.document.body.textContent = 'Preparing your preview' } catch { /* cross origin */ }
    void run('pdf', async () => {
      try {
        const result = await build()
        const url = result.doc.output('bloburl')
        try { win.opener = null } catch { /* fine */ }
        win.location.href = url
        setTimeout(() => URL.revokeObjectURL(url), 60_000)
      } catch (e) {
        try { win.close() } catch { /* fine */ }
        throw e
      }
    }, "Couldn't preview")
  }

  const onDownload = () => run('download', async () => {
    const result = await build()
    await downloadQuotePdf(result)
    toastSuccess('Quote downloaded', result.filename)
  }, "Couldn't download")

  const onEsign = () => run('esign', async () => {
    const outcome = await sendQuoteForSignature({ quote, company, userId: userId as string, recipientEmail })
    if (outcome === 'esign_not_configured') {
      toastError('DocuSign not connected yet', 'Add the DocuSign keys in Netlify, then try again.')
      return
    }
    await refresh()
    toastSuccess(`Sent to ${recipientEmail} for signature`, 'DocuSign will email the signing request.')
  }, "Couldn't send for electronic signature")

  // Make this a job (D61): a new job with the quote's client, title, scope,
  // price and terms; the quote keeps its status and points at the job.
  const onMakeJob = () => run('job', async () => {
    const { jobId } = await makeJobFromQuote(quote.id)
    toastSuccess('Job created', 'The quote now points at it.')
    navigate(recordRoute('job', jobId))
  }, "Couldn't make the job")

  // Delete asks with a second tap on the same button (D57), for four seconds.
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), 4000)
    return () => window.clearTimeout(t)
  }, [armed])
  // Approved quotes are the record of what the customer agreed to, so they stay.
  const deletable = !approved
  const onDelete = () => {
    if (!armed) { hapticTap(); setArmed(true); return }
    void run('delete', async () => {
      const lines = await supabase.from('fh_quote_items').delete().eq('quote_id', quote.id)
      if (lines.error) throw new Error(lines.error.message)
      const row = await supabase.from('fh_quotes').delete().eq('id', quote.id)
      if (row.error) throw new Error(row.error.message)
      toastSuccess(quote.status === 'draft' ? 'Draft quote deleted' : 'Quote deleted')
      navigate('/quotes', { replace: true })
    }, "Couldn't delete the quote")
  }

  const termsSummary = [
    quote.scope_text && 'Scope',
    quote.exclusions_text && 'Exclusions',
    quote.terms_text && 'Payment terms',
    quote.expires_at && `Expires ${shortDate(quote.expires_at)}`
  ].filter(Boolean) as string[]
  const chevron = <Icon icon={ChevronRight} size={18} className="fhqt-chevron" />
  const number = quoteNumber(company.name, quote.id, quote.sent_at || quote.created_at)
  const esignLine = needsLines
    ? linesLine
    : hasEmail
      ? `DocuSign emails a signing request to ${recipientEmail}.`
      : emailFailed
        ? "Couldn't check the customer email."
        : emailKnown
          ? 'Add a customer email first.'
          : 'DocuSign emails the customer a signing request.'

  return (
    <div className="fhqt-page">
      <QuoteHeader kicker="Quote" home="/quotes" end={<Chip tone={chip.tone} label={chip.label} />} />

      <h1 className="fhqt-title" ref={titleRef} tabIndex={-1}>{quoteTitle(quote)}</h1>
      <p className="fhqt-client">
        {client ? <Link to={recordRoute('client', client.id)} className="fhqt-client__link">{client.name || 'Client'}</Link> : <span>No client</span>}
        <span className="fhqt-client__number">{number}</span>
      </p>
      {status.sub && <p className="fhqt-sub">{status.sub}</p>}
      {emailKnown && !hasEmail && !approved && (
        <p className="fhqt-sub">
          No email on file for {who}. Copy an approval link to text or paste. Copying keeps the current quote status.
        </p>
      )}
      {emailFailed && (
        <div className="fhqt-retry">
          <p className="fhqt-sub">Couldn't check the email for {who}. {sendLabel} waits until it can.</p>
          <Button variant="quiet" size="mini" loading={emailRetrying} onClick={() => { void linked.refetch() }}>Try again</Button>
        </div>
      )}

      {changesRequested && (
        <section className="fhqt-panel" aria-labelledby="fhqt-changes-title">
          <h2 className="fhqt-panel__title" id="fhqt-changes-title">Customer requested changes</h2>
          <p className="fhqt-panel__body">
            {quote.change_request_note || 'No written feedback came with this request. Contact the customer to confirm the changes before revising.'}
          </p>
          <p className="fhqt-panel__note">
            Update the quote, then send it again. Approval stays paused until the revision is sent.
          </p>
        </section>
      )}

      <QuoteLines items={items} userId={userId} who={who} money={terms} focusRef={titleRef} startAdding={startAdding} onChange={setLines} />

      {approved && (
        <section className="fhqt-panel" aria-labelledby="fhqt-approved-title">
          <h2 className="fhqt-panel__title" id="fhqt-approved-title">Quote approved</h2>
          <p className="fhqt-panel__body">
            Approval saved{quote.updated_at ? `, ${shortDate(quote.updated_at)}` : ''}. Later edits to lines, scope or terms do not change what the customer agreed to.
          </p>
        </section>
      )}

      <section className="fhqt-total" aria-label="Total">
        <div className="fhqt-total__row">
          <span className="fhqt-total__label">Total</span>
          <span className="fhqt-total__amount">{capsule.amount}</span>
        </div>
        <p className="fhqt-total__note">{capsule.note}</p>
        <Button
          variant="primary"
          size="lg"
          block
          disabled={waiting || !live.canSend || !emailKnown}
          loading={busy === 'send' || busy === 'share'}
          onClick={hasEmail ? onSend : onShare}
        >
          {sendLabel}
        </Button>
        {sendHint && <p className="fhqt-total__hint">{sendHint}</p>}
      </section>

      <ul className="fhqt-rows" aria-label="More about this quote">
        <Row
          as="li"
          title="Scope and terms"
          subline={termsSummary.length > 0 ? termsSummary.join(', ') : 'Not added yet'}
          next={chevron}
          to={`${recordRoute('quote', quote.id)}/terms`}
        />
        <Row
          as="li"
          title={previewAsLabel(client?.name)}
          subline="What the customer sees. Nothing is sent."
          next={chevron}
          to={`${recordRoute('quote', quote.id)}/preview`}
        />
        {approved ? (
          <Row
            as="li"
            title="Approve a new version"
            subline="Saves the current quote as the approved version."
            next={chevron}
            {...approveTarget(quote.id, waiting)}
          />
        ) : !changesRequested && (
          <Row
            as="li"
            title="Approve quote"
            subline={items.loading || live.canSend ? 'Record that the customer said yes.' : linesFailed ? LINES_FAILED : 'Add at least one line first.'}
            next={chevron}
            {...approveTarget(quote.id, waiting || !live.canSend)}
          />
        )}
      </ul>

      <section className="fhqt-share" aria-labelledby="fhqt-share-title">
        <h2 className="fhqt-share__title" id="fhqt-share-title">Share or download</h2>
        <ul className="fhqt-rows" aria-label="Share or download">
          <Row as="li" title="Copy a share link" subline={needsLines ? linesLine : 'Makes a customer link. Copying does not change the quote status.'} next={chevron} disabled={waiting || needsLines} onClick={onShare} />
          {canMarkSent(quote.status) && !quote.job_id && <Row as="li" title="Mark as sent" subline="Use after you have shared the proposal with the customer." next={chevron} disabled={waiting || needsLines} onClick={onMarkSent} />}
          <Row as="li" title="Open the PDF" subline={needsLines ? linesLine : 'Builds the proposal and opens it in a new tab.'} next={chevron} disabled={waiting || needsLines} onClick={onOpenPdf} />
          <Row as="li" title="Download the PDF" subline={needsLines ? linesLine : 'Saves a copy to this device.'} next={chevron} disabled={waiting || needsLines} onClick={onDownload} />
          <Row as="li" title="Send for electronic signature" subline={esignLine} next={chevron} disabled={waiting || needsLines || !hasEmail} onClick={onEsign} />
        </ul>
      </section>

      <div className="fhqt-job">
        {quote.job_id ? (
          <Button variant="secondary" size="lg" block to={recordRoute('job', quote.job_id)}>Open the job</Button>
        ) : (
          <Button variant="secondary" size="lg" block loading={busy === 'job'} disabled={busy !== null && busy !== 'job'} onClick={onMakeJob}>
            Make this a job
          </Button>
        )}
        <p className="fhqt-job__note">
          {quote.job_id
            ? 'This quote became a job. The job carries the schedule, the crew and the money.'
            : 'Makes a job with this client, title, scope, price and terms. The quote stays as it is.'}
        </p>
      </div>

      {deletable ? (
        <div className="fhqt-danger">
          <Button variant="destructive" disabled={busy !== null} loading={busy === 'delete'} onClick={onDelete}>
            {armed ? 'Tap again to delete' : quote.status === 'draft' ? 'Delete draft quote' : 'Delete quote'}
          </Button>
        </div>
      ) : approved ? (
        <p className="fhqt-danger-note">Approved quotes cannot be deleted. Create a revision instead.</p>
      ) : null}
    </div>
  )
}

// A Row that leads to the approval screen, or waits with the reason in its
// subline while the lines are loading, missing or still saving.
function approveTarget(id: string, disabled: boolean) {
  return disabled
    ? { onClick: () => {}, disabled: true }
    : { to: `${recordRoute('quote', id)}/approve` }
}
