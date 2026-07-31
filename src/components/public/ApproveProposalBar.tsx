// src/components/public/ApproveProposalBar.tsx
//
// Customer facing approval surface for the /p/:token proposal viewer.
// Cream-paper aesthetic to match the document, not the app chrome.
// Render under the proposal template. When the customer submits, POSTs
// to /api/public-link-approve and flips into a thank-you state.
//
// Self-contained: takes only the token + a couple of derived strings
// for messaging. Caller doesn't need to know about the server contract.

import { useState } from 'react'

export default function ApproveProposalBar({
  token,
  companyName,
  contactName,
  contractTotal,
  initialName = '',
  onApproved,
  // 'proposal' (default) or 'change_order', switches the endpoint and
  // the customer facing copy; the signature mechanics are identical.
  variant = 'proposal'
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

  const ready = name.trim().length > 1 && authorized && !busy
  const requestReady = name.trim().length > 1 && requestText.trim().length >= 3 && !busy

  async function submit(e: any) {
    e?.preventDefault?.()
    if (!ready) return
    setBusy(true)
    setError('')
    try {
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
        const friendly =
          body?.error === 'already_approved' ? `This ${docLabel} has already been approved, thank you.`
          : body?.error === 'expired' ? 'This link has expired. Please ask the contractor for a fresh one.'
          : body?.error === 'revoked' ? 'This link has been revoked.'
          : body?.error === 'empty_proposal' ? 'This proposal is empty, please contact the sender.'
          : body?.error === 'gone' ? `This ${docLabel} is no longer open for approval.`
          : body?.message || 'We could not record your approval. Please try again.'
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
        throw new Error(friendly)
      }
      setRequestDone({
        name: body.requested_by || name.trim(),
        at: body.requested_at || new Date().toISOString()
      })
    } catch (err: any) {
      setError(err.message || 'Something went wrong.')
    } finally {
      setBusy(false)
    }
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
          A signed copy stays in your inbox for reference.
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
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#141414'
}

const eyebrowStyle: import('react').CSSProperties = {
  fontSize: 12, fontWeight: 700, letterSpacing: 0,
  textTransform: 'uppercase', color: '#C9963A', marginBottom: 8
}

const headlineStyle: import('react').CSSProperties = {
  margin: 0,
  fontFamily: "'Bebas Neue', Impact, sans-serif",
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
  letterSpacing: 0, textTransform: 'uppercase',
  color: '#5C5C5C'
}

const inputStyle: import('react').CSSProperties = {
  padding: '12px 12px',
  borderRadius: 10,
  background: '#F2EDE4',
  border: '1px solid #5C5C5C',
  color: '#141414',
  fontFamily: "'DM Sans', system-ui, sans-serif",
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
  fontFamily: "'DM Sans', system-ui, sans-serif",
  fontSize: 14, fontWeight: 700,
  letterSpacing: 0, textTransform: 'uppercase',
  boxShadow: '0 6px 16px rgba(201, 150, 58, 0.3)'
}

const secondaryButtonStyle: import('react').CSSProperties = {
  height: 40,
  padding: '0 16px',
  borderRadius: 10,
  border: '1px solid #5C5C5C',
  background: '#F2EDE4',
  color: '#141414',
  fontFamily: "'DM Sans', system-ui, sans-serif",
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
  color: '#C0392B',
  fontSize: 14, lineHeight: 1.4,
  marginBottom: 12
}

const metaRowStyle: import('react').CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  fontSize: 12, color: '#5C5C5C',
  paddingTop: 12, marginTop: 16,
  borderTop: '1px solid #F2EDE4'
}

const dotStyle: import('react').CSSProperties = {
  display: 'inline-block', width: 3, height: 3, borderRadius: 10,
  background: '#C9963A'
}
