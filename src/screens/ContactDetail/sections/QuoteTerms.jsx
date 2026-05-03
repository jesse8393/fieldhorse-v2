import { useEffect, useState } from 'react'
import { FileText } from 'lucide-react'
import { dateInputToTimestamp, timestampToDateInput } from '../../../lib/dueDate.js'

/**
 * Quote terms section — customer-facing prose blocks + expiration.
 *
 * Phase 4B-2: live working-draft fields backing migration 012's
 * scope_text / terms_text / exclusions_text / quote_expires_at on
 * fh_contacts. Autosave on blur via the parent's `patch` helper
 * (optimistic + user_id-guarded). No Send / Preview / Download
 * actions yet — those land in 4B-3 and 4B-4.
 *
 * Hydrates from `contact.*` and re-syncs whenever the underlying
 * row changes (id flip on navigation, server-side updated_at bump
 * from background refetch). Local edits are not clobbered between
 * the operator typing and blurring because the effect keys on
 * `id` + `updated_at`, not on every render.
 */
export default function QuoteTermsSection({ contact, patch, valuesRef }) {
  const [scope, setScope] = useState(contact?.scope_text || '')
  const [exclusions, setExclusions] = useState(contact?.exclusions_text || '')
  const [terms, setTerms] = useState(contact?.terms_text || '')
  const [expires, setExpires] = useState(timestampToDateInput(contact?.quote_expires_at))

  useEffect(() => {
    setScope(contact?.scope_text || '')
    setExclusions(contact?.exclusions_text || '')
    setTerms(contact?.terms_text || '')
    setExpires(timestampToDateInput(contact?.quote_expires_at))
  }, [contact?.id, contact?.updated_at])

  // Publish the latest local state into a parent-owned ref on every
  // change. Quote.jsx's buildPdf reads from this ref so unblurred
  // textarea content reaches the PDF reliably — independent of any
  // blur-timing race. No re-render side effect (refs don't subscribe).
  useEffect(() => {
    if (!valuesRef) return
    valuesRef.current = { scope, exclusions, terms, expires }
  }, [scope, exclusions, terms, expires, valuesRef])

  // Normalize blank → null so the column stores absence consistently
  // (downstream PDF + status-pill logic checks `is null` not `=== ''`).
  function normText(s) {
    const t = String(s || '').trim()
    return t.length === 0 ? null : t
  }

  async function saveText(field, current, prior) {
    const next = normText(current)
    const before = normText(prior)
    if (next === before) return
    await patch?.({ [field]: next })
  }

  async function saveExpires(current, priorIso) {
    const nextIso = dateInputToTimestamp(current) // null on empty
    if (nextIso === priorIso) return
    if (!nextIso && !priorIso) return
    await patch?.({ quote_expires_at: nextIso })
  }

  return (
    <section
      className="v3-section v3-section--primary-quiet"
      style={{ margin: 0, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <div>
        <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)' }}>
          <FileText size={11} aria-hidden="true" style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Quote terms
        </span>
        <h2 style={{
          margin: '6px 0 0',
          fontSize: 'clamp(20px, 5vw, 26px)',
          lineHeight: 1.1,
          letterSpacing: '-0.015em',
          fontWeight: 600,
          color: 'var(--v3-text)'
        }}>
          What the customer sees
        </h2>
        <p style={{
          margin: '8px 0 0',
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          lineHeight: 1.5,
          color: 'var(--v3-text-muted)'
        }}>
          These three blocks plus the line items become the sendable quote. Saved automatically when you tap out of a field.
        </p>
      </div>

      <FieldLabel label="Scope of work" hint="What you'll do, in plain English. Two or three sentences is fine.">
        <textarea
          value={scope}
          onChange={(e) => setScope(e.target.value)}
          onBlur={() => saveText('scope_text', scope, contact?.scope_text)}
          placeholder="Demo and replace the existing 480 sf composite deck. Re-frame as needed, install code-compliant flashing, finish with the customer-selected Trex Transcend boards."
          rows={6}
          style={textareaStyle}
        />
      </FieldLabel>

      <FieldLabel label="Exclusions" hint="What's NOT included. Spelling these out prevents change-order surprises.">
        <textarea
          value={exclusions}
          onChange={(e) => setExclusions(e.target.value)}
          onBlur={() => saveText('exclusions_text', exclusions, contact?.exclusions_text)}
          placeholder="Permit fees, electrical work, painting / staining of trim, structural repairs uncovered during demo."
          rows={5}
          style={textareaStyle}
        />
      </FieldLabel>

      <FieldLabel label="Payment terms" hint="Deposit, progress payments, warranty, change-order policy.">
        <textarea
          value={terms}
          onChange={(e) => setTerms(e.target.value)}
          onBlur={() => saveText('terms_text', terms, contact?.terms_text)}
          placeholder="50% deposit on signing, 40% at substantial completion, 10% on final walkthrough. 1-year workmanship warranty. Change orders priced and signed before work proceeds."
          rows={5}
          style={textareaStyle}
        />
      </FieldLabel>

      <FieldLabel label="Quote expires" hint="Optional. Helps customers act before pricing changes.">
        <input
          type="date"
          value={expires}
          onChange={(e) => setExpires(e.target.value)}
          onBlur={() => saveExpires(expires, contact?.quote_expires_at)}
          style={{ ...textareaStyle, minHeight: 44, fontFamily: 'var(--font-body)' }}
        />
      </FieldLabel>
    </section>
  )
}

function FieldLabel({ label, hint, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.10em',
        textTransform: 'uppercase', color: 'var(--v3-text-muted)'
      }}>
        {label}
      </span>
      {children}
      {hint && (
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 11, lineHeight: 1.45,
          color: 'var(--v3-text-faint, var(--v3-text-muted))'
        }}>
          {hint}
        </span>
      )}
    </label>
  )
}

const textareaStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '11px 13px',
  borderRadius: 10,
  background: 'var(--v3-surface-2)',
  border: '1px solid var(--v3-border)',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)',
  fontSize: 14, lineHeight: 1.45,
  outline: 'none',
  resize: 'vertical'
}
