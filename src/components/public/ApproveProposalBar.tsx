// src/components/public/ApproveProposalBar.tsx
//
// Customer facing approval surface for the /p/:token proposal viewer.
// Cream-paper aesthetic to match the document, not the app chrome.
// Render under the proposal template. When the customer submits, POSTs
// to /api/public-link-approve and flips into a thank-you state.
//
// Self-contained: takes only the token + a couple of derived strings
// for messaging. Caller doesn't need to know about the server contract.
//
// `skin="fieldhorse"` draws the same bar as the bottom onyx capsule of the
// Fieldhorse proposal theme (spec 9.9): the name field and the authority
// checkbox are kept, "Approve this quote" is the one brushed gold action,
// and a linen link opens the request changes form. Only the look changes,
// the state, the checks and the three endpoints are the same code. Without
// a skin the bar is exactly the cream paper panel it always was, so a
// quote that has not picked the new theme looks the same to its customer.

import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Button, Chip, Field, formatMoney } from '../fh'
import { DOC_COLORS } from '../documents/tokens.ts'
import { companyShortName } from '../../lib/quoteMoney.ts'
import { personFirstName } from '../../lib/quoteView.ts'
import '../documents/fieldhorse-proposal.css'

/**
 * What the page found when it read the quote again just before posting an
 * approval: ok to post, the total changed, something else the customer
 * agrees to changed (the lines, the terms, the warranty), the page redrawn
 * from that read no longer offers approval (see PublicDoc), the read
 * failed for a moment (no answer, too many requests, a server error), or
 * the server refused the link itself (revoked, expired, removed), with the
 * error and message it answered.
 */
export type ApproveCheck =
  | 'ok' | 'changed' | 'updated' | 'closed' | 'failed'
  | { refused: { error: string | null; message: string | null } }

// What the customer reads for an error the link answers, the same words
// whether the read before an approval or the approval itself got it.
function approveErrorText(error: unknown, message: unknown, docLabel: string, companyName: string, fallback: string): string {
  if (error === 'already_approved') return `This ${docLabel} has already been approved, thank you.`
  if (error === 'expired') return 'This link has expired. Please ask the contractor for a fresh one.'
  if (error === 'revoked') return 'This link has been revoked.'
  if (error === 'quote_expired') return `This quote has expired. Ask ${companyName || 'the contractor'} for an updated one.`
  if (error === 'empty_proposal') return 'This proposal is empty, please contact the sender.'
  if (error === 'gone') return `This ${docLabel} is no longer open for approval.`
  return (typeof message === 'string' && message.trim()) || fallback
}

export default function ApproveProposalBar({
  token,
  companyName,
  contactName,
  contractTotal,
  initialName = '',
  // Reads the quote again before the approval posts; see ApproveCheck.
  onBeforeApprove = null,
  onApproved,
  // Called once a question (a change request) has been sent.
  onRequested = null,
  // The server said the quote is not what the page shows (a 409 or 410 to
  // an approval, a 404, 409 or 410 to a question), so the page should read
  // it again.
  onStale = null,
  // 'proposal' (default) or 'change_order', switches the endpoint and
  // the customer facing copy; the signature mechanics are identical.
  variant = 'proposal',
  // 'fieldhorse' draws the onyx capsule; anything else is the classic panel.
  skin = 'classic',
  // "Ask about this" on an optional item: a new seed opens the request
  // changes form with its text in the box, and its opener (the button
  // tapped) gets focus back on Back. Each tap makes a new object.
  requestSeed = null,
  // False when the request changes endpoint would refuse a question (a
  // declined quote, a job already started, a refused link): the capsule
  // then offers none, and an open question form closes.
  canAsk = true
}: any) {
  const isCO = variant === 'change_order'
  const endpoint = isCO ? '/api/public-co-approve' : '/api/public-link-approve'
  const docLabel = isCO ? 'change order' : 'proposal'
  const [name, setName] = useState(initialName)
  const [authorized, setAuthorized] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<any>(null)
  const [requestMode, setRequestMode] = useState(false)
  const [requestText, setRequestText] = useState('')
  const [requestDone, setRequestDone] = useState<any>(null)

  const capsuleRef = useRef<HTMLElement | null>(null)
  // Where focus goes when the capsule's question form closes: Back returns
  // it to the control that opened the form (the "Ask about this" button
  // tapped, else the question link); a form closed because the server
  // stopped taking questions puts it on the message that says so.
  const openerRef = useRef<HTMLElement | null>(null)
  const questionRef = useRef<HTMLButtonElement | HTMLAnchorElement | null>(null)
  const errorRef = useRef<HTMLDivElement | null>(null)
  const focusOnClose = useRef<'opener' | 'message' | null>(null)
  const askable = canAsk !== false

  const ready = name.trim().length > 1 && authorized && !busy
  // A seeded question that is still only its prefilled lead in has nothing
  // to send yet: sending it would pause approval with an empty request.
  const seedText = String(requestSeed?.text || '').trim()
  const requestReady = name.trim().length > 1
    && requestText.trim().length >= 3
    && !(seedText && requestText.trim() === seedText)
    && !busy

  // A new "Ask about this" opens the request changes form with the item's
  // name in the box, and brings the capsule into view.
  useEffect(() => {
    if (!requestSeed || isCO) return
    openerRef.current = requestSeed.opener ?? null
    setRequestText(String(requestSeed.text || ''))
    setRequestMode(true)
    setError('')
    const reduced = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    capsuleRef.current?.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' })
  }, [requestSeed, isCO])

  // A question the server refused makes the page read the link again. Once
  // that read says no question can be sent any more (declined, a job
  // started, the link refused), the question form closes and its message
  // stays with the approve form, so Send request is never a dead button.
  useEffect(() => {
    if (askable || !requestMode) return
    focusOnClose.current = 'message'
    setRequestMode(false)
  }, [askable, requestMode])

  useEffect(() => {
    const target = focusOnClose.current
    if (requestMode || !target) return
    focusOnClose.current = null
    const opener = openerRef.current
    const el = target === 'message' ? errorRef.current
      : opener?.isConnected ? opener
      : questionRef.current
    el?.focus()
  }, [requestMode])

  async function submit(e: any) {
    e?.preventDefault?.()
    if (!ready) return
    setBusy(true)
    setError('')
    try {
      // Nothing posts until the quote on the page is the quote on the server.
      if (onBeforeApprove) {
        const check: ApproveCheck = await onBeforeApprove()
        if (typeof check === 'object') {
          throw new Error(approveErrorText(check.refused.error, check.refused.message, docLabel, companyName, 'This link is no longer available.'))
        }
        if (check === 'changed') throw new Error('This quote was just updated. Please review the new total.')
        if (check === 'updated') throw new Error('This quote was just updated. Please review it before approving.')
        if (check === 'closed') throw new Error(`This ${docLabel} is no longer open for approval.`)
        if (check === 'failed') throw new Error('We could not check this quote for updates. Please try again.')
      }
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          signature_name: name.trim(),
          note: note.trim() || null
        })
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) {
        const friendly = approveErrorText(body?.error, body?.message, docLabel, companyName, 'We could not record your approval. Please try again.')
        // Already approved, closed, expired or revoked: the page is stale.
        if (res.status === 409 || res.status === 410) onStale?.()
        throw new Error(friendly)
      }
      setDone({
        name: body.signed_by || name.trim(),
        at: body.approved_at || new Date().toISOString()
      })
      onApproved?.()
    } catch (err: any) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  async function submitChangeRequest(e: any) {
    e?.preventDefault?.()
    if (!requestReady || isCO) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/public-link-request-changes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          requester_name: name.trim(),
          request_text: requestText.trim()
        })
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) {
        const friendly =
          body?.error === 'already_approved' ? 'This proposal has already been approved.'
          : body?.error === 'expired' ? 'This link has expired. Please ask the contractor for a fresh one.'
          : body?.error === 'revoked' ? 'This link has been revoked.'
          : body?.error === 'gone' ? 'This proposal is no longer open for changes.'
          : body?.error === 'rate_limited' ? 'Too many requests. Please wait a minute and try again.'
          : body?.message || 'We could not send your request. Please try again.'
        // Revoked or expired (404), already approved (409), declined, a job
        // started or the quote gone (410): the page is stale, as after a
        // refused approval, so it reads the link again.
        if (res.status === 404 || res.status === 409 || res.status === 410) onStale?.()
        throw new Error(friendly)
      }
      setRequestDone({
        name: body.requested_by || name.trim(),
        at: body.requested_at || new Date().toISOString()
      })
      onRequested?.()
    } catch (err: any) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
  }

  if (skin === 'fieldhorse' && !isCO) {
    return (
      <FieldhorseCapsule
        capsuleRef={capsuleRef}
        companyName={companyName}
        contactName={contactName}
        contractTotal={contractTotal}
        name={name}
        setName={setName}
        note={note}
        setNote={setNote}
        authorized={authorized}
        setAuthorized={setAuthorized}
        requestText={requestText}
        setRequestText={setRequestText}
        busy={busy}
        error={error}
        ready={ready}
        requestReady={requestReady}
        done={done}
        requestDone={requestDone}
        requestMode={requestMode}
        canAsk={askable}
        questionRef={questionRef}
        errorRef={errorRef}
        openRequest={() => { setError(''); openerRef.current = null; setRequestMode(true) }}
        closeRequest={() => { setError(''); focusOnClose.current = 'opener'; setRequestMode(false) }}
        onApprove={submit}
        onSendRequest={submitChangeRequest}
      />
    )
  }

  if (requestDone) {
    return (
      <div style={panelStyle} aria-live="polite">
        <div style={eyebrowStyle}>Changes requested</div>
        <h3 style={headlineStyle}>Your feedback is with the contractor.</h3>
        <p style={bodyStyle}>
          {companyName || 'The contractor'} will review your request and send a revised proposal before approval.
        </p>
        <div style={metaRowStyle}>
          <span>Requested by</span>
          <strong style={{ color: '#141414' }}>{requestDone.name}</strong>
          <span style={dotStyle} aria-hidden="true" />
          <span>{formatStamp(requestDone.at)}</span>
        </div>
      </div>
    )
  }

  if (done) {
    return (
      <div style={panelStyle} aria-live="polite">
        <div style={eyebrowStyle}>Approved</div>
        <h3 style={headlineStyle}>
          Thanks, {done.name.split(' ')[0] || done.name}.
        </h3>
        <p style={bodyStyle}>
          {companyName ? `${companyName} has been notified` : 'The contractor has been notified'} of your approval{contactName ? ` for ${contactName}` : ''}.
          You can reopen this link to view the approved {docLabel}.
        </p>
        <div style={metaRowStyle}>
          <span>Signed as</span>
          <strong style={{ color: '#141414' }}>{done.name}</strong>
          <span style={dotStyle} aria-hidden="true" />
          <span>{formatStamp(done.at)}</span>
        </div>
      </div>
    )
  }

  if (requestMode && !isCO) {
    return (
      <form style={panelStyle} onSubmit={submitChangeRequest}>
        <div style={eyebrowStyle}>Request changes</div>
        <h3 style={headlineStyle}>What should be revised?</h3>
        <p style={bodyStyle}>
          Tell {companyName || 'the contractor'} what needs attention. Approval will pause until a revised proposal is sent.
        </p>

        <label style={fieldStackStyle}>
          <span style={labelStyle}>Your full name</span>
          <input
            type="text"
            autoComplete="name"
            required
            disabled={busy}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Jane Homeowner"
            style={inputStyle}
          />
        </label>

        <label style={fieldStackStyle}>
          <span style={labelStyle}>Changes needed</span>
          <textarea
            rows={4}
            required
            minLength={3}
            maxLength={2000}
            disabled={busy}
            value={requestText}
            onChange={(e) => setRequestText(e.target.value)}
            placeholder="Describe the scope, price, timing, or terms you want updated"
            style={{ ...inputStyle, resize: 'vertical', minHeight: 96 }}
          />
        </label>

        {error && <div role="alert" style={errorStyle}>{error}</div>}

        <div style={actionRowStyle}>
          <button
            type="button"
            disabled={busy}
            onClick={() => { setError(''); setRequestMode(false) }}
            style={secondaryButtonStyle}
          >
            Back
          </button>
          <button
            type="submit"
            disabled={!requestReady}
            style={{
              ...buttonStyle,
              flex: 1,
              width: 'auto',
              opacity: requestReady ? 1 : 0.55,
              cursor: requestReady ? 'pointer' : 'not-allowed'
            }}
          >
            {busy ? 'Sending request...' : 'Send request'}
          </button>
        </div>
      </form>
    )
  }

  return (
    <form style={panelStyle} onSubmit={submit}>
      <div style={eyebrowStyle}>Approve this {docLabel}</div>
      <h3 style={headlineStyle}>
        {isCO ? 'Approve this change?' : <>Ready to start{contactName ? ` ${contactName}` : ''}?</>}
      </h3>
      <p style={bodyStyle}>
        {isCO
          ? 'Typing your full name below approves the change in scope and price shown above.'
          : 'Typing your full name below approves the scope, line items, and terms above.'}
        {companyName ? ` ${companyName} will be notified instantly.` : ''}
        {contractTotal != null
          ? <> The {isCO ? 'updated contract total' : 'approved contract total'} is <strong style={{ color: '#141414' }}>{moneyFmt(contractTotal)}</strong>.</>
          : null}
      </p>

      <label style={fieldStackStyle}>
        <span style={labelStyle}>Your full name</span>
        <input
          type="text"
          autoComplete="name"
          required
          disabled={busy}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Jane Homeowner"
          style={inputStyle}
        />
      </label>

      <label style={fieldStackStyle}>
        <span style={labelStyle}>Note for the contractor (optional)</span>
        <textarea
          rows={2}
          disabled={busy}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Anything you want them to know before they start"
          style={{ ...inputStyle, resize: 'vertical', minHeight: 64 }}
        />
      </label>

      <label style={checkboxRowStyle}>
        <input
          type="checkbox"
          checked={authorized}
          disabled={busy}
          onChange={(e) => setAuthorized(e.target.checked)}
          style={{ marginTop: 3, width: 16, height: 16, cursor: 'pointer', accentColor: '#C9963A' }}
        />
        <span>
          I have the authority to approve this {docLabel} on behalf of {contactName || 'the property owner'}, and I agree to the scope and terms shown above. Approving creates a binding record with my name, the date, and my IP address.
        </span>
      </label>

      {error && (
        <div role="alert" style={errorStyle}>
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={!ready}
        style={{
          ...buttonStyle,
          opacity: ready ? 1 : 0.55,
          cursor: ready ? 'pointer' : 'not-allowed'
        }}
      >
        {busy ? 'Recording approval…' : 'Approve & notify contractor'}
      </button>
      {!isCO && (
        <button
          type="button"
          disabled={busy}
          onClick={() => { setError(''); setRequestMode(true) }}
          style={{ ...secondaryButtonStyle, width: '100%', marginTop: 8 }}
        >
          Request changes
        </button>
      )}
    </form>
  )
}

type CapsuleProps = {
  capsuleRef: { current: HTMLElement | null }
  companyName: string
  contactName: string
  contractTotal: number | null
  name: string
  setName: (v: string) => void
  note: string
  setNote: (v: string) => void
  authorized: boolean
  setAuthorized: (v: boolean) => void
  requestText: string
  setRequestText: (v: string) => void
  busy: boolean
  error: string
  ready: boolean
  requestReady: boolean
  done: { name: string; at: string } | null
  requestDone: { name: string; at: string } | null
  requestMode: boolean
  /** The server still takes a question, so the question link may show. */
  canAsk: boolean
  /** The question link, for focus after Back. */
  questionRef: { current: HTMLButtonElement | HTMLAnchorElement | null }
  /** The message under the fields, for focus when the question form closes on it. */
  errorRef: { current: HTMLDivElement | null }
  openRequest: () => void
  closeRequest: () => void
  onApprove: (e: unknown) => void
  onSendRequest: (e: unknown) => void
}

// Only the Approve button (or Send request) submits. Return anywhere else
// in the capsule's form would submit it implicitly, from the name field or
// from the ticked authority box alike, so it is swallowed everywhere but
// in a note (a new line) and on a button or link (which it presses), and
// never while an input method is composing a word.
function swallowReturn(e: KeyboardEvent<HTMLFormElement>) {
  if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
  const tag = (e.target as HTMLElement | null)?.tagName
  if (tag === 'TEXTAREA' || tag === 'BUTTON' || tag === 'A') return
  e.preventDefault()
}

// The capsule: onyx, rounded 28, the one gold button inside it.
function FieldhorseCapsule(p: CapsuleProps) {
  const company = p.companyName?.trim() || ''
  const who = company || 'the contractor'
  // "Ask Harlow a question first", but "Ask The Concrete Guys" in full: the
  // short name the page's steps use (quoteMoney.ts).
  const askName = companyShortName(company, 'the contractor')
  // Each form has its own key, so switching between asking and approving
  // mounts a new form instead of reusing the old one's elements. Reused,
  // the Back button just tapped (type button) became Approve (type submit)
  // in the re-render that runs before the browser finishes the tap, and
  // the tap then submitted the approval. A removed button submits nothing.
  const shell = (children: import('react').ReactNode, onSubmit?: (e: unknown) => void, formKey?: string) => {
    const props = {
      className: 'fhp-dock',
      ref: p.capsuleRef as import('react').Ref<HTMLDivElement>
    }
    return (
      <div {...props}>
        {onSubmit ? (
          <form key={formKey} className="fhp-capsule fh-onyx-scope fh-grain" onSubmit={onSubmit} onKeyDown={swallowReturn}>{children}</form>
        ) : (
          <section className="fhp-capsule fh-onyx-scope fh-grain" aria-live="polite">{children}</section>
        )}
      </div>
    )
  }

  if (p.requestDone) {
    return shell(
      <>
        <Chip label="Changes requested" tone="info" dot />
        <h2 className="fhp-capsule__title">Your feedback is with the contractor.</h2>
        <p className="fhp-capsule__text">
          {company || 'The contractor'} will review your request and send a revised proposal before approval.
        </p>
        <p className="fhp-capsule__meta">
          Requested by {p.requestDone.name}, {formatStamp(p.requestDone.at)}
        </p>
      </>
    )
  }

  if (p.done) {
    return shell(
      <>
        <Chip label="Approved" tone="success" dot />
        <h2 className="fhp-capsule__title">Thanks, {personFirstName(p.done.name) || p.done.name}.</h2>
        <p className="fhp-capsule__text">
          {company ? `${company} has been notified` : 'The contractor has been notified'} of your approval{p.contactName ? ` for ${p.contactName}` : ''}.
          You can reopen this link to view the approved proposal.
        </p>
        <p className="fhp-capsule__meta">
          Signed as {p.done.name}, {formatStamp(p.done.at)}
        </p>
      </>
    )
  }

  if (p.requestMode) {
    return shell(
      <>
        <h2 className="fhp-capsule__title">What would you like to ask or change?</h2>
        <p className="fhp-capsule__text">
          Tell {who} what you need. Approval will pause until a revised proposal is sent.
        </p>
        <div className="fhp-capsule__fields">
          <Field
            label="Your full name"
            autoComplete="name"
            autoCapitalize="words"
            required
            disabled={p.busy}
            value={p.name}
            onChange={(e) => p.setName(e.target.value)}
            placeholder="Jane Homeowner"
          />
          <Field
            multiline
            label="Changes needed"
            rows={4}
            required
            minLength={3}
            maxLength={2000}
            autoFocus
            disabled={p.busy}
            value={p.requestText}
            onChange={(e) => p.setRequestText(e.target.value)}
            placeholder="Describe the scope, price, timing, or terms you want updated"
          />
        </div>
        {p.error && <div role="alert" className="fhp-error" ref={p.errorRef} tabIndex={-1}>{p.error}</div>}
        <div className="fhp-actions fhp-actions--row">
          <Button variant="secondary" size="lg" disabled={p.busy} onClick={p.closeRequest}>Back</Button>
          <Button variant="primary" size="lg" block type="submit" disabled={!p.requestReady && !p.busy} loading={p.busy}>
            Send request
          </Button>
        </div>
      </>,
      p.onSendRequest,
      'ask'
    )
  }

  return shell(
    <>
      <h2 className="fhp-capsule__title">Ready to start?</h2>
      <p className="fhp-capsule__text">
        Typing your full name below approves the scope, line items, and terms above.
        {company ? ` ${company} will be notified instantly.` : ''}
        {p.contractTotal != null
          ? <> The approved contract total is <strong>{formatMoney(p.contractTotal)}</strong>.</>
          : null}
      </p>
      <div className="fhp-capsule__fields">
        <Field
          label="Your full name"
          autoComplete="name"
          autoCapitalize="words"
          required
          disabled={p.busy}
          value={p.name}
          onChange={(e) => p.setName(e.target.value)}
          placeholder="Jane Homeowner"
        />
        <Field
          multiline
          label="Note for the contractor (optional)"
          rows={2}
          disabled={p.busy}
          value={p.note}
          onChange={(e) => p.setNote(e.target.value)}
          placeholder="Anything you want them to know before they start"
        />
        <label className="fhp-check">
          <input
            type="checkbox"
            checked={p.authorized}
            disabled={p.busy}
            onChange={(e) => p.setAuthorized(e.target.checked)}
          />
          <span>
            I have the authority to approve this proposal on behalf of {p.contactName || 'the property owner'}, and I agree to the scope and terms shown above. Approving creates a binding record with my name, the date, and my IP address.
          </span>
        </label>
      </div>
      {p.error && <div role="alert" className="fhp-error" ref={p.errorRef} tabIndex={-1}>{p.error}</div>}
      <div className="fhp-actions">
        <Button variant="primary" size="lg" block type="submit" disabled={!p.ready && !p.busy} loading={p.busy}>
          Approve this quote
        </Button>
        {p.canAsk && (
          <Button ref={p.questionRef} variant="quiet" size="md" block className="fhp-question" disabled={p.busy} onClick={p.openRequest}>
            Ask {askName} a question first
          </Button>
        )}
      </div>
    </>,
    p.onApprove,
    'approve'
  )
}

function moneyFmt(n: any) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

function formatStamp(iso: any) {
  try {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: 'numeric', minute: '2-digit'
    })
  } catch { return '' }
}

const panelStyle: import('react').CSSProperties = {
  maxWidth: 760,
  margin: '24px auto 0',
  padding: '24px 24px 24px',
  borderRadius: 10,
  background: '#F2EDE4',
  border: '1px solid rgba(201, 150, 58, 0.45)',
  boxShadow: '0 24px 64px -32px rgba(20, 20, 20, 0.25)',
  fontFamily: 'var(--font-body)',
  color: '#141414'
}

const eyebrowStyle: import('react').CSSProperties = {
  fontSize: 12, fontWeight: 700, letterSpacing: 0,
  color: 'color-mix(in srgb, var(--v3-primary-text) 54%, #141414 46%)', marginBottom: 8
}

const headlineStyle: import('react').CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-display)',
  fontSize: 24, fontWeight: 400, color: '#141414',
  letterSpacing: 0
}

const bodyStyle: import('react').CSSProperties = {
  margin: '12px 0 16px',
  fontSize: 14, lineHeight: 1.55, color: '#141414'
}

const fieldStackStyle: import('react').CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12
}

const labelStyle: import('react').CSSProperties = {
  fontSize: 12, fontWeight: 700,
  letterSpacing: 0,
  color: '#5C5C5C'
}

const inputStyle: import('react').CSSProperties = {
  padding: '12px 12px',
  borderRadius: 10,
  background: '#F2EDE4',
  border: '1px solid #5C5C5C',
  color: '#141414',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box'
}

const checkboxRowStyle: import('react').CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 12,
  margin: '6px 0 16px',
  fontSize: 12, lineHeight: 1.5, color: '#141414',
  cursor: 'pointer'
}

const buttonStyle: import('react').CSSProperties = {
  display: 'block', width: '100%',
  height: 40,
  padding: '0 16px',
  borderRadius: 10, border: 'none',
  background: 'linear-gradient(135deg, #C9963A 0%, #C9963A 100%)',
  color: '#141414',
  fontFamily: 'var(--font-body)',
  fontSize: 14, fontWeight: 700,
  letterSpacing: 0,
  boxShadow: '0 6px 16px rgba(201, 150, 58, 0.3)'
}

const secondaryButtonStyle: import('react').CSSProperties = {
  height: 40,
  padding: '0 16px',
  borderRadius: 10,
  border: '1px solid #5C5C5C',
  background: '#F2EDE4',
  color: '#141414',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  fontWeight: 700,
  cursor: 'pointer'
}

const actionRowStyle: import('react').CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8
}

const errorStyle: import('react').CSSProperties = {
  padding: '12px 12px',
  borderRadius: 10,
  background: 'rgba(192, 57, 43, 0.10)',
  border: '1px solid rgba(192, 57, 43, 0.4)',
  color: 'color-mix(in srgb, var(--v3-danger-text) 78%, #141414 22%)',
  fontSize: 14, lineHeight: 1.4,
  marginBottom: 12
}

const metaRowStyle: import('react').CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  fontSize: 12, color: '#5C5C5C',
  paddingTop: 12, marginTop: 16,
  // A paper colored divider on the paper colored panel was invisible.
  borderTop: `1px solid ${DOC_COLORS.rule}`
}

const dotStyle: import('react').CSSProperties = {
  display: 'inline-block', width: 3, height: 3, borderRadius: 10,
  background: '#C9963A'
}
