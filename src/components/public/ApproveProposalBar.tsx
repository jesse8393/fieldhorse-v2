// src/components/public/ApproveProposalBar.tsx
//
// Customer-facing approval surface for the /p/:token proposal viewer.
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
  onApproved
}: any) {
  const [name, setName] = useState(initialName)
  const [authorized, setAuthorized] = useState(false)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [done, setDone] = useState<any>(null)

  const ready = name.trim().length > 1 && authorized && !busy

  async function submit(e: any) {
    e?.preventDefault?.()
    if (!ready) return
    setBusy(true)
    setError('')
    try {
      const res = await fetch('/api/public-link-approve', {
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
          body?.error === 'already_approved' ? 'This proposal has already been approved — thank you.'
          : body?.error === 'expired' ? 'This link has expired. Please ask the contractor for a fresh one.'
          : body?.error === 'revoked' ? 'This link has been revoked.'
          : body?.error === 'empty_proposal' ? 'This proposal is empty — please contact the sender.'
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
          <strong style={{ color: '#1A1814' }}>{done.name}</strong>
          <span style={dotStyle} aria-hidden="true" />
          <span>{formatStamp(done.at)}</span>
        </div>
      </div>
    )
  }

  return (
    <form style={panelStyle} onSubmit={submit}>
      <div style={eyebrowStyle}>Approve this proposal</div>
      <h3 style={headlineStyle}>
        Ready to start{contactName ? ` ${contactName}` : ''}?
      </h3>
      <p style={bodyStyle}>
        Typing your full name below approves the scope, line items, and terms above.
        {companyName ? ` ${companyName} will be notified instantly.` : ''}
        {contractTotal != null
          ? <> The approved contract total is <strong style={{ color: '#1A1814' }}>{moneyFmt(contractTotal)}</strong>.</>
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
          style={{ marginTop: 3, width: 16, height: 16, cursor: 'pointer', accentColor: '#C8A154' }}
        />
        <span>
          I have the authority to approve this proposal on behalf of {contactName || 'the property owner'}, and I agree to the scope and terms shown above. Approving creates a binding record with my name, the date, and my IP address.
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
  padding: '28px 28px 24px',
  borderRadius: 6,
  background: '#fffaf0',
  border: '1px solid rgba(200, 161, 84, 0.45)',
  boxShadow: '0 24px 64px -32px rgba(31, 30, 28, 0.25)',
  fontFamily: "'DM Sans', system-ui, sans-serif",
  color: '#3A3833'
}

const eyebrowStyle: import('react').CSSProperties = {
  fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
  textTransform: 'uppercase', color: '#C8A154', marginBottom: 6
}

const headlineStyle: import('react').CSSProperties = {
  margin: 0,
  fontFamily: "'Cormorant Garamond', Georgia, serif",
  fontSize: 26, fontWeight: 500, color: '#1A1814',
  letterSpacing: '-0.005em'
}

const bodyStyle: import('react').CSSProperties = {
  margin: '10px 0 16px',
  fontSize: 14, lineHeight: 1.55, color: '#3A3833'
}

const fieldStackStyle: import('react').CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12
}

const labelStyle: import('react').CSSProperties = {
  fontSize: 10, fontWeight: 700,
  letterSpacing: '0.14em', textTransform: 'uppercase',
  color: '#6B6A66'
}

const inputStyle: import('react').CSSProperties = {
  padding: '11px 14px',
  borderRadius: 4,
  background: '#fffefb',
  border: '1px solid #d8d2c2',
  color: '#1A1814',
  fontFamily: "'DM Sans', system-ui, sans-serif",
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box'
}

const checkboxRowStyle: import('react').CSSProperties = {
  display: 'flex', alignItems: 'flex-start', gap: 10,
  margin: '6px 0 16px',
  fontSize: 12, lineHeight: 1.5, color: '#3A3833',
  cursor: 'pointer'
}

const buttonStyle: import('react').CSSProperties = {
  display: 'block', width: '100%',
  padding: '14px 16px',
  borderRadius: 4, border: 'none',
  background: 'linear-gradient(135deg, #d4af37 0%, #b7872d 100%)',
  color: '#1A1814',
  fontFamily: "'DM Sans', system-ui, sans-serif",
  fontSize: 14, fontWeight: 700,
  letterSpacing: '0.14em', textTransform: 'uppercase',
  boxShadow: '0 6px 16px rgba(201, 150, 58, 0.3)'
}

const errorStyle: import('react').CSSProperties = {
  padding: '10px 12px',
  borderRadius: 4,
  background: 'rgba(179, 73, 59, 0.10)',
  border: '1px solid rgba(179, 73, 59, 0.4)',
  color: '#7d2a1f',
  fontSize: 13, lineHeight: 1.4,
  marginBottom: 12
}

const metaRowStyle: import('react').CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
  fontSize: 12, color: '#6B6A66',
  paddingTop: 14, marginTop: 14,
  borderTop: '1px solid #e8e2d4'
}

const dotStyle: import('react').CSSProperties = {
  display: 'inline-block', width: 3, height: 3, borderRadius: '50%',
  background: '#C8A154'
}
