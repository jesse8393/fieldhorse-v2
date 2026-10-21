import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button, Chip, Icon, Row } from '../../../components/fh'
import { hapticTap } from '../../../lib/haptics.ts'
import { buildQuoteView, previewAsLabel, previewAsName, quoteCapsule } from '../../../lib/quoteView.ts'
import { useQuoteItems, type QuoteLinesState } from '../sections/QuoteItems.tsx'
import QuoteTermsSection from '../sections/QuoteTerms.tsx'
import { DocumentPreviewPane, loadPreviewPhotos } from '../sections/DocumentPreviewPane.tsx'
import { shortDate, statusChip } from '../lib/quoteStatus.ts'
import QuoteLines, { type QuoteLinesChange } from '../../quotes/QuoteLines.tsx'
import JobActionCapsule from './JobActionCapsule.tsx'
import './quote-phone.css'

// The Quote tab on a phone (spec 9.6, decision D8), for a contact row that
// still carries its quote. Since Phase 9 a quote is a record of its own
// (src/screens/quotes, decision D53), so this tab only shows for a row the
// migration never moved; Task 13 takes it off the job page.
//
// Nothing here opens a sheet (D57). The lines are edited in place through
// the quote screen's QuoteLines; Scope and terms opens the terms section
// in place; Preview as draws the proposal in place; the share and download
// rows sit on the page. The onyx capsule at the bottom carries the total,
// the deposit and the one gold "Send for approval".
//
// The money comes from lib/quoteView.ts, which reads lib/quoteMoney.ts, the
// one rule the preview and the customer page use too (D31).

export type QuotePhoneProps = {
  contact: any
  userId: string | undefined
  company: any
  insurance?: any
  changeOrders?: any[]
  /** deriveStatus(contact, pastQuote): label, tone and the short line. */
  status: { label: string; tone: string; sub: string | null }
  pastQuote: boolean
  /** The Quote tab's busy flag: preview, download, send, share, esign or null. */
  busy: string | null
  /**
   * The customer's email, found the way Money finds it (the job's own,
   * then its linked client's, lib/customerEmail.ts): empty when there is
   * none, null while the linked client is still being read or when that
   * read failed.
   */
  customerEmail: string | null
  /** The linked client's email could not be read: unknown, not missing. */
  emailFailed?: boolean
  /** That read is being tried again. */
  emailRetrying?: boolean
  /** Reads the linked client's email again. */
  onRetryEmail?: () => void
  clearing: boolean
  /** Delete draft was tapped once; the next tap deletes (D57). */
  clearArmed?: boolean
  patch: (updates: Record<string, any>) => Promise<{ error?: unknown } | undefined> | undefined
  onContactRefresh: () => void
  /** With an email: builds the PDF, uploads it and emails the customer. */
  onSend: () => void
  /** Without one: mints a share link and copies it. */
  onShare: () => void
  onOpenPdf: () => void
  onDownload: () => void
  onEsign: () => void
  onOpenApprove: () => void
  onClearDraft: () => void
  /** Runs after each read of the lines that works. */
  onLinesLoaded?: () => void
  /** Hears what the editor knows about the lines, and null when it goes. */
  onLinesState?: (state: QuoteLinesState | null) => void
}

// What Approve, Send and the share rows say when the lines could not be
// read: never that there are none.
const LINES_FAILED = "We couldn't load the lines."
const NEEDS_A_LINE = 'Add at least one line.'

export default function QuotePhone({
  contact,
  userId,
  company,
  insurance = null,
  changeOrders = [],
  status,
  pastQuote: _pastQuote,
  busy,
  customerEmail,
  emailFailed = false,
  emailRetrying = false,
  onRetryEmail,
  clearing,
  clearArmed = false,
  patch,
  onContactRefresh,
  onSend,
  onShare,
  onOpenPdf,
  onDownload,
  onEsign,
  onOpenApprove,
  onClearDraft,
  onLinesLoaded,
  onLinesState
}: QuotePhoneProps) {
  const items = useQuoteItems({
    jobId: contact?.id,
    userId,
    onContactRefresh,
    onLoaded: onLinesLoaded,
    onState: onLinesState
  })
  const { rows, loading, loaded, failed, fetchRows } = items
  // No read of the lines has worked yet and the last one failed: the lines
  // are unknown, so nothing may say there are none.
  const linesFailed = !loading && failed && !loaded
  // The page's heading, where focus waits while Try again reads the lines again.
  const titleRef = useRef<HTMLHeadingElement>(null)

  const [lines, setLines] = useState<QuoteLinesChange>({ effective: [], switchSaving: false })
  const switchSaving = lines.switchSaving
  const contactAmount = contact?.amount
  const termsText = contact?.terms_text
  const moneyTerms = useMemo(() => ({ changeOrders, contactAmount, termsText }), [changeOrders, contactAmount, termsText])
  const live = useMemo(() => buildQuoteView(lines.effective, moneyTerms), [lines.effective, moneyTerms])
  // While the lines load no line is priced, so the contact's own amount
  // stands in and the capsule does not flash $0.00.
  const loadingMoney = useMemo(() => buildQuoteView([], moneyTerms).money, [moneyTerms])
  const capsule = quoteCapsule(loading ? loadingMoney : live.money)

  const who = previewAsName(contact?.name)
  const approved = status.label === 'Approved'
  const changesRequested = status.label === 'Changes requested'
  const deletable = !approved && !(status.label === 'Draft' && rows.length === 0)

  // Scope and terms and the preview open in place, under their rows.
  const [termsOpen, setTermsOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [photos, setPhotos] = useState<any[]>([])
  const [photosLoading, setPhotosLoading] = useState(false)
  const jobId = contact?.id
  useEffect(() => {
    if (!previewOpen || !jobId || !userId) return
    let alive = true
    setPhotosLoading(true)
    loadPreviewPhotos(jobId, userId)
      .catch(() => [])
      .then((list) => {
        if (!alive) return
        setPhotos(list || [])
        setPhotosLoading(false)
      })
    return () => { alive = false }
  }, [previewOpen, jobId, userId])

  // The send button: the email path with an address, the link path
  // without. While the linked client's email is still being read, the
  // button waits and nothing is said about the email. When that read
  // failed, the button waits too and says why: there may well be an
  // address, so it never falls back to the link path.
  const emailKnown = customerEmail !== null
  const hasClientEmail = !!customerEmail
  const sendLabel = approved ? 'Send again' : 'Send for approval'
  const needsLines = !loading && !live.canSend
  const sendHint = needsLines
    ? (linesFailed ? LINES_FAILED : 'Add at least one line')
    : emailFailed
      ? "Couldn't check the email"
      : emailKnown && !hasClientEmail ? 'Copies a link' : undefined
  const chip = statusChip(status)
  const terms = [
    contact?.scope_text && 'Scope',
    contact?.exclusions_text && 'Exclusions',
    contact?.terms_text && 'Payment terms',
    contact?.quote_expires_at && `Expires ${shortDate(contact.quote_expires_at)}`
  ].filter(Boolean) as string[]
  const chevron = <Icon icon={ChevronRight} size={18} className="fhq-chevron" />
  const waiting = loading || busy !== null || switchSaving
  const linesLine = linesFailed ? LINES_FAILED : NEEDS_A_LINE
  const esignLine = needsLines
    ? linesLine
    : customerEmail
      ? `DocuSign emails a signing request to ${customerEmail}.`
      : emailFailed
        ? "Couldn't check the customer email."
        : customerEmail === ''
          ? 'Add a customer email first.'
          : 'DocuSign emails the customer a signing request.'

  return (
    <div className="fhq-page">
      <header className="fhq-head">
        <div className="fhq-head__row">
          <h2 className="fhq-head__title" ref={titleRef} tabIndex={-1}>Quote</h2>
          <Chip tone={chip.tone} label={chip.label} />
          <Button
            variant="quiet"
            size="mini"
            className="fhq-head__preview"
            aria-expanded={previewOpen}
            onClick={() => { hapticTap(); setPreviewOpen((v) => !v) }}
          >
            {previewAsLabel(contact?.name)}
          </Button>
        </div>
        {status.sub && <p className="fhq-head__sub">{status.sub}</p>}
        {emailKnown && !hasClientEmail && !approved && (
          <p className="fhq-head__sub">
            No email on file for {who}. Send for approval copies a link you can text or paste.
          </p>
        )}
        {emailFailed && (
          <div className="fhq-head__retry">
            <p className="fhq-head__sub">
              Couldn't check the email for {who}. {sendLabel} waits until it can.
            </p>
            <Button
              variant="quiet"
              size="mini"
              className="fhq-head__retry-btn"
              loading={emailRetrying}
              onClick={onRetryEmail}
            >
              Try again
            </Button>
          </div>
        )}
      </header>

      {previewOpen && (
        <section className="fhq-preview" aria-label="Proposal preview, in place">
          <p className="fhq-head__sub">This is what {who} sees. Nothing is sent.</p>
          <DocumentPreviewPane
            bare
            company={company}
            contact={contact}
            items={lines.effective}
            photos={photos}
            loading={photosLoading || loading}
            failed={linesFailed}
            onRetry={() => { void fetchRows() }}
            insurance={insurance}
            changeOrders={changeOrders}
          />
        </section>
      )}

      {changesRequested && (
        <section className="fhq-panel" aria-labelledby="fhq-changes-title">
          <h3 className="fhq-panel__title" id="fhq-changes-title">Customer requested changes</h3>
          <p className="fhq-panel__body">
            {contact?.quote_change_request_note || 'Review the customer feedback before sending a revised quote.'}
          </p>
          <p className="fhq-panel__note">
            Update the quote, then send it again. Approval stays paused until the revision is sent.
          </p>
        </section>
      )}

      <QuoteLines items={items} userId={userId} who={who} money={moneyTerms} focusRef={titleRef} onChange={setLines} />

      {approved && (
        <section className="fhq-panel" aria-labelledby="fhq-approved-title">
          <h3 className="fhq-panel__title" id="fhq-approved-title">Quote approved</h3>
          <p className="fhq-panel__body">
            {contact?.proposal_status === 'approved'
              ? `Approval saved${contact?.updated_at ? `, ${shortDate(contact.updated_at)}` : ''}. Later edits to lines, scope or terms do not change what the customer agreed to.`
              : 'This job has already moved past the quote phase, so the proposal counts as approved. Lock the snapshot to freeze the current lines, scope and terms as the official approved version.'}
          </p>
        </section>
      )}

      <ul className="fhq-rows" aria-label="More about this quote">
        <Row
          as="li"
          title="Scope and terms"
          subline={terms.length > 0 ? terms.join(', ') : 'Not added yet'}
          next={chevron}
          onClick={() => { hapticTap(); setTermsOpen((v) => !v) }}
        />
        {approved ? (
          <Row
            as="li"
            title={contact?.proposal_status === 'approved' ? 'Approve a new version' : 'Lock the snapshot'}
            subline="Saves the current quote as the approved version."
            next={chevron}
            // A snapshot of the lines, so it waits for a switch that is
            // still saving, the same as Approve quote and Send.
            disabled={waiting}
            onClick={() => { hapticTap(); onOpenApprove() }}
          />
        ) : !changesRequested && (
          <Row
            as="li"
            title="Approve quote"
            subline={loading || live.canSend ? 'Record that the customer said yes.' : linesFailed ? LINES_FAILED : 'Add at least one line first.'}
            next={chevron}
            disabled={waiting || !live.canSend}
            onClick={() => { hapticTap(); onOpenApprove() }}
          />
        )}
      </ul>

      {termsOpen && (
        <div className="fhq-terms">
          <QuoteTermsSection contact={contact} patch={patch} />
        </div>
      )}

      <section className="fhq-share" aria-labelledby="fhq-share-title">
        <h3 className="fhq-share__title" id="fhq-share-title">Share or download</h3>
        <ul className="fhq-rows fhq-more-list" aria-label="Share or download">
          <Row
            as="li"
            title="Open the PDF"
            subline={needsLines ? linesLine : 'Builds the proposal and opens it in a new tab.'}
            next={chevron}
            disabled={waiting || needsLines}
            onClick={onOpenPdf}
          />
          <Row
            as="li"
            title="Download the PDF"
            subline={needsLines ? linesLine : 'Saves a copy to this phone.'}
            next={chevron}
            disabled={waiting || needsLines}
            onClick={onDownload}
          />
          <Row
            as="li"
            title="Copy a share link"
            subline={needsLines ? linesLine : 'Makes a link the customer can open, and marks the quote as sent.'}
            next={chevron}
            disabled={waiting || needsLines}
            onClick={onShare}
          />
          <Row
            as="li"
            title="Send for electronic signature"
            subline={esignLine}
            next={chevron}
            disabled={waiting || needsLines || !customerEmail}
            onClick={onEsign}
          />
        </ul>
      </section>

      {deletable ? (
        <div className="fhq-danger">
          <Button variant="destructive" disabled={clearing} onClick={onClearDraft}>{clearArmed ? 'Tap again to delete' : 'Delete draft quote'}</Button>
        </div>
      ) : approved ? (
        <p className="fhq-danger-note">Approved quotes cannot be deleted. Create a revision instead.</p>
      ) : null}

      <JobActionCapsule
        variant="total"
        total={capsule}
        action={{
          label: sendLabel,
          onClick: hasClientEmail ? onSend : onShare,
          disabled: loading || !live.canSend || busy !== null || !emailKnown || switchSaving,
          loading: busy === 'send' || busy === 'share',
          hint: sendHint
        }}
      />
    </div>
  )
}
