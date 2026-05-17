import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Copy, Check, MessageSquare, Mail, Mic, Send, PenLine, RotateCw } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { claudeMessage } from '../lib/anthropic.js'
import { toastSuccess } from '../lib/toast.js'
import { hapticMedium, hapticSuccess } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'
import { FilterPill, Eyebrow } from '../components/v3'

const CHANNELS = [
  { id: 'sms', label: 'SMS', tone: 'Keep it under 160 chars. Tight. No emoji. Punctuation minimal.', Icon: MessageSquare },
  { id: 'email', label: 'Email', tone: 'Short subject line + 3-paragraph body. Professional. Signed off with the contractor name.', Icon: Mail },
  { id: 'voice', label: 'Voicemail', tone: 'Under 25 seconds spoken. Natural phrasing. Call-to-action clear.', Icon: Mic }
]

const INTENTS = [
  'First outreach to new lead',
  'Follow up after quote sent',
  'Reminder for scheduled job',
  'Change-order explanation',
  'Invoice overdue nudge',
  'Thank you after job close',
  'Weather delay notice'
]

export default function Compose() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const [channel, setChannel] = useState('sms')
  const [intent, setIntent] = useState(INTENTS[0])
  const [contactId, setContactId] = useState('')
  const [contact, setContact] = useState(null)
  const [contacts, setContacts] = useState([])
  const [context, setContext] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  // Real-send state (email channel only). Sent flag flips back to false
  // after 2.4s so the operator can send again if needed.
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  useEffect(() => {
    if (!user) return
    supabase
      .from('fh_contacts')
      .select('id, name, phone, email, job_title, job_type, stage, amount')
      .eq('user_id', user.id)
      .order('updated_at', { ascending: false })
      .then(({ data }) => setContacts(data || []))
  }, [user])

  useEffect(() => {
    setContact(contacts.find((c) => c.id === contactId) || null)
  }, [contactId, contacts])

  async function generate() {
    const ch = CHANNELS.find((c) => c.id === channel)
    setLoading(true)
    setDraft('')
    setError('')
    setCopied(false)
    try {
      const contactLine = contact
        ? `Recipient: ${contact.name}. Job: ${contact.job_title || contact.job_type || 'unknown'}. Stage: ${contact.stage}. Amount: $${contact.amount || 0}.`
        : 'Recipient: generic contact (not yet linked to a job).'
      const res = await claudeMessage({
        system: `You are Fieldhorse AI Compose. Write a ${ch.label} message for a contractor. ${ch.tone} Brand voice: jobsite-direct, no buzzwords, no "captain" or naval metaphors ever, no "circle back". Sender is ${profile?.company_name || 'the contractor'}.`,
        messages: [{ role: 'user', content: `Intent: ${intent}\n${contactLine}\nExtra context: ${context || 'none'}\n\nReturn only the message text, no preamble.` }],
        maxTokens: 500
      })
      const text = res?.content?.[0]?.text || ''
      if (!text) throw new Error('Empty response from AI')
      hapticSuccess(); setDraft(text)
      toastSuccess('Draft ready', 'Copy, send, or edit')
    } catch (e) {
      console.error('[compose] generate failed:', e)
      const msg = String(e?.message || '').toLowerCase()
      if (msg.includes('missing_api_key') || msg.includes('500')) {
        setError('AI not configured. Set ANTHROPIC_API_KEY in your Netlify env vars to enable drafting.')
      } else if (msg.includes('404') || msg.includes('failed to fetch')) {
        setError('AI endpoint unreachable. Check your network or try again in a moment.')
      } else {
        setError(e?.message || 'AI generation failed.')
      }
    } finally {
      setLoading(false)
    }
  }

  async function copy() {
    await navigator.clipboard.writeText(draft)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  async function sendAction() {
    if (!contact) return
    if (channel === 'sms' && contact.phone) window.location.href = `sms:${contact.phone}?body=${encodeURIComponent(draft)}`
    if (channel === 'email' && contact.email) window.location.href = `mailto:${contact.email}?body=${encodeURIComponent(draft)}`
  }

  // Real server-side email send via Resend (POST /api/send-message).
  // Mirrors the multi-tenant sender pattern used by send-quote +
  // send-invoice: From = "<Your Company> via FieldHorse", Reply-To =
  // company_email. Server logs activity to fh_notes on success so the
  // sent message shows up in the job's activity feed.
  //
  // Falls back to the mailto: handoff (sendAction) when the server
  // returns 503 sender_not_configured — operators on a non-Resend
  // deploy can still ship the draft through their mail client.
  async function handleSendEmail() {
    if (!contact?.email || !draft || sending) return
    setSending(true)
    setError('')
    try {
      // Subject derived from intent + contact context — short and honest.
      const subjectGuess = contact.job_title
        ? `Re: ${contact.job_title}`
        : intent || `Message from ${profile?.company_name || 'your contractor'}`
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contact_id: contact.id,
          sender_user_id: user.id,
          recipient_email: contact.email,
          recipient_name: contact.name || null,
          subject: subjectGuess,
          body: draft
        })
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 503 && data?.error === 'sender_not_configured') {
        // Friendly fallback — open the mail client with the draft prefilled.
        toastSuccess('Opening email app', 'Direct send not configured — pasting into your mail client.')
        sendAction()
        return
      }
      if (!res.ok || !data?.ok) {
        throw new Error(data?.detail || data?.error || 'Email send failed.')
      }

      hapticSuccess()
      setSent(true)
      toastSuccess(`Email sent to ${contact.email}`, `${draft.length} chars · ${countWords(draft)} words`)
      setTimeout(() => setSent(false), 2400)
    } catch (e) {
      setError(e?.message || 'Could not send the message. Try again.')
    } finally {
      setSending(false)
    }
  }

  // Re-run the generator with the same channel/intent/contact/context.
  // Audit complaint: "Only post-generation action is Copy." Regenerate
  // closes that gap — the operator can spin a fresh take without
  // walking back through the form.
  function regenerate() {
    hapticMedium()
    setSent(false)
    generate()
  }

  const { stagger, item } = useFhMotion()

  return (
    <motion.div
      className="v3-screen v3-screen--compose"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {/* INPUT COCKPIT — black-glass panel: header eyebrow + channel pills
          + intent + contact + context chips + CTA */}
      <motion.div variants={item} style={{ padding: '8px 20px 12px' }}>
        <div style={{
          padding: '14px 16px',
          borderRadius: 16,
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border)',
          boxShadow: '0 1px 0 rgba(255, 240, 210, 0.04) inset, 0 8px 22px rgba(0, 0, 0, 0.40)'
        }}>
          {/* Header — title eyebrow on its own row, recipient pill on the
              row below. The old layout placed both on one flex row with
              flexWrap:wrap, but two uppercase eyebrows with letter-
              spacing:0.16em collided on iPhone — the "TO · GENERIC"
              clipped against the cockpit edge. Splitting into two rows
              gives each label room to breathe and keeps the recipient
              cue visible regardless of contact-name length. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
            <Eyebrow tone="gold">
              <PenLine size={11} aria-hidden="true" />
              AI Compose
            </Eyebrow>
            <div
              style={{
                display: 'inline-flex',
                alignSelf: 'flex-start',
                maxWidth: '100%',
                alignItems: 'center',
                gap: 6,
                padding: '3px 8px',
                borderRadius: 999,
                background: 'var(--v3-surface-2)',
                border: '1px solid var(--v3-border)',
                color: 'var(--v3-text-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                lineHeight: 1.2,
                opacity: contact ? 1 : 0.75
              }}
            >
              <span style={{ color: 'var(--v3-text-muted)' }}>To</span>
              <span aria-hidden="true" style={{ color: 'var(--v3-text-faint, var(--v3-text-muted))' }}>·</span>
              <span
                style={{
                  color: 'var(--v3-text)',
                  letterSpacing: '0.04em',
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: 11,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '60vw'
                }}
              >
                {contact?.name || 'Generic'}
              </span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Channel selector — canonical FilterPill */}
            <div>
              <Eyebrow as="div" style={{ marginBottom: 6 }}>Channel</Eyebrow>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                {CHANNELS.map((ch) => {
                  const I = ch.Icon
                  const isOn = channel === ch.id
                  return (
                    <FilterPill
                      key={ch.id}
                      size="sm"
                      active={isOn}
                      onClick={() => setChannel(ch.id)}
                      ariaLabel={`${ch.label} channel`}
                      style={{ justifyContent: 'center' }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                        <I size={13} aria-hidden="true" />
                        {ch.label}
                      </span>
                    </FilterPill>
                  )
                })}
              </div>
            </div>

            {/* Intent / Contact / Context fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
              <Field label="Intent">
                <select
                  value={intent}
                  onChange={(e) => setIntent(e.target.value)}
                  style={selectStyle}
                >
                  {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
                </select>
              </Field>

              <Field label="Contact">
                <select
                  value={contactId}
                  onChange={(e) => setContactId(e.target.value)}
                  style={selectStyle}
                >
                  <option value="">No contact (generic message)</option>
                  {contacts.map((c) => {
                    const tail = c.job_title || c.job_type || c.stage || ''
                    return (
                      <option key={c.id} value={c.id}>
                        {c.name}{tail ? ` — ${tail}` : ''}
                      </option>
                    )
                  })}
                </select>
              </Field>

              <Field label="Extra context">
                <textarea
                  rows={3}
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="Anything to highlight — price change, delay reason, specific material…"
                  style={{ ...selectStyle, resize: 'vertical', minHeight: 72, fontFamily: 'var(--font-body)' }}
                />
              </Field>
            </div>

            {/* Real AI-context transparency chips — show what facts the model
                will actually see. Only renders when a contact is selected. */}
            {contact && (
              <div>
                <Eyebrow as="div" style={{ marginBottom: 6 }}>
                  AI will use
                </Eyebrow>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  <ContextChip>{contact.name}</ContextChip>
                  {(contact.job_title || contact.job_type) && (
                    <ContextChip>{contact.job_title || contact.job_type}</ContextChip>
                  )}
                  {contact.stage && <ContextChip>Stage · {contact.stage}</ContextChip>}
                  {Number(contact.amount) > 0 && (
                    <ContextChip tone="gold">${Number(contact.amount).toLocaleString()}</ContextChip>
                  )}
                </div>
              </div>
            )}

            {/* Primary CTA */}
            <motion.button
              type="button"
              whileTap={{ scale: 0.98 }}
              onClick={() => { hapticMedium(); generate() }}
              disabled={loading}
              style={{
                padding: '12px 18px',
                borderRadius: 12,
                border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
                background: loading
                  ? 'var(--v3-surface-2)'
                  : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                color: loading ? 'var(--v3-text-muted)' : 'var(--v3-on-primary)',
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                cursor: loading ? 'default' : 'pointer',
                boxShadow: loading
                  ? 'none'
                  : '0 0 0 2px rgba(228, 190, 111, 0.14), 0 6px 18px rgba(201, 150, 58, 0.30)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                minHeight: 46,
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              {loading ? (
                <span aria-label="Loading" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(0,0,0,0.25)', borderTopColor: 'var(--v3-on-primary)', animation: 'fh-spin 700ms linear infinite' }} />
              ) : (
                <Sparkles size={15} />
              )}
              {loading ? 'Drafting…' : 'Generate draft'}
            </motion.button>

            {/* Error block */}
            {error && !draft && (
              <div role="alert" style={{
                padding: '12px 14px',
                borderRadius: 12,
                background: 'var(--v3-danger-soft)',
                border: '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)',
                color: 'var(--v3-text)',
                fontFamily: 'var(--font-body)',
                fontSize: 12.5,
                lineHeight: 1.5
              }}>
                <div style={{ fontWeight: 700, color: 'var(--v3-danger-bright)', marginBottom: 4 }}>AI unavailable</div>
                <div style={{ color: 'var(--v3-text-muted)', marginBottom: 10 }}>{error}</div>
                <button
                  type="button"
                  onClick={() => { setError(''); setDraft(' ') }}
                  style={{
                    padding: '7px 13px',
                    borderRadius: 10,
                    border: '1px solid var(--v3-border-strong)',
                    background: 'var(--v3-surface-2)',
                    color: 'var(--v3-text)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer'
                  }}
                >
                  Write manually →
                </button>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* OUTPUT COCKPIT — black-glass panel, draft-as-hero */}
      <AnimatePresence mode="wait">
        {draft ? (
          <motion.div
            key="draft"
            variants={item}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ padding: '0 20px 28px' }}
          >
            <div style={{
              padding: '14px 16px',
              borderRadius: 16,
              background: 'var(--v3-surface)',
              border: '1px solid var(--v3-border)',
              boxShadow: '0 1px 0 rgba(255, 240, 210, 0.04) inset, 0 8px 22px rgba(0, 0, 0, 0.40)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <Eyebrow tone="gold">
                  <Sparkles size={11} aria-hidden="true" />
                  Draft · {CHANNELS.find((c) => c.id === channel)?.label}
                </Eyebrow>
                <Eyebrow style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {countWords(draft)} words · {draft.length} chars
                </Eyebrow>
              </div>

              {/* Draft hero — lives directly on the panel, not in a nested box */}
              <pre style={{
                margin: 0,
                padding: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 15,
                lineHeight: 1.6,
                color: 'var(--v3-text)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}>
                {draft}
              </pre>

              {/* Action row — 5/17 Compose-end-to-end port.
                  Per the design's CTA bar (screens-compose-nav.jsx)
                  and the 5/13 audit complaint that "Compose dead-ends
                  at Copy", three actions on the row:

                    Regenerate    — spin a fresh take, same prompt
                    Copy          — secondary, always available
                    Send (PRIMARY) — channel-aware:
                      email + contact email → POST /api/send-message
                          (real Resend send; falls back to mailto: on
                          503 sender_not_configured)
                      sms + contact phone   → native sms: handoff
                          (no SMS provider wired yet; Twilio is a
                          future branch)
                      voice                 → disabled "Voicemail
                          script" pill — operator reads the script
                          aloud after copying

                  Send button labels: Send email / Open SMS / Script.
                  Disabled when contact lacks the right contact channel
                  (no email for email channel etc.) with a friendly
                  hint via title. */}
              <div style={{
                display: 'flex',
                gap: 8,
                marginTop: 14,
                paddingTop: 12,
                borderTop: '1px solid var(--v3-border)',
                flexWrap: 'wrap',
                justifyContent: 'flex-end'
              }}>
                <button
                  type="button"
                  onClick={regenerate}
                  disabled={loading}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '10px 14px',
                    minHeight: 40,
                    borderRadius: 10,
                    background: 'var(--v3-surface-2)',
                    border: '1px solid var(--v3-border-strong)',
                    color: loading ? 'var(--v3-text-muted)' : 'var(--v3-text)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: loading ? 'default' : 'pointer',
                    WebkitTapHighlightColor: 'transparent'
                  }}
                >
                  <RotateCw size={13} />
                  Regenerate
                </button>
                <button
                  type="button"
                  onClick={copy}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '10px 14px',
                    minHeight: 40,
                    borderRadius: 10,
                    background: 'var(--v3-surface-2)',
                    border: '1px solid var(--v3-border-strong)',
                    color: 'var(--v3-text)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent'
                  }}
                >
                  {copied ? <Check size={13} /> : <Copy size={13} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
                {channel === 'voice' ? (
                  <button
                    type="button"
                    disabled
                    title="Copy the script and call the client to read it aloud."
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '10px 14px',
                      minHeight: 40,
                      borderRadius: 10,
                      background: 'var(--v3-surface-2)',
                      border: '1px solid var(--v3-border)',
                      color: 'var(--v3-text-muted)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'default'
                    }}
                  >
                    <Mic size={13} />
                    Script
                  </button>
                ) : channel === 'email' ? (
                  <button
                    type="button"
                    onClick={handleSendEmail}
                    disabled={sending || !contact?.email}
                    title={!contact?.email ? 'Add a client email first' : undefined}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '10px 14px',
                      minHeight: 40,
                      borderRadius: 10,
                      border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
                      background: sent
                        ? 'linear-gradient(180deg, var(--v3-success-bright) 0%, var(--v3-success) 100%)'
                        : (sending || !contact?.email)
                          ? 'var(--v3-surface-2)'
                          : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                      color: (sending || !contact?.email)
                        ? 'var(--v3-text-muted)'
                        : 'var(--v3-on-primary)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      cursor: (sending || !contact?.email) ? 'not-allowed' : 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                      boxShadow: (sending || !contact?.email)
                        ? 'none'
                        : '0 0 0 2px rgba(228, 190, 111, 0.14), 0 4px 12px rgba(201, 150, 58, 0.28)',
                      opacity: !contact?.email ? 0.6 : 1
                    }}
                  >
                    {sent ? <Check size={13} /> : <Send size={13} />}
                    {sent ? 'Sent' : sending ? 'Sending…' : 'Send email'}
                  </button>
                ) : (
                  /* SMS channel — keep the native handoff. No in-app SMS
                     provider yet (Twilio integration is a future branch). */
                  <button
                    type="button"
                    onClick={sendAction}
                    disabled={!contact?.phone}
                    title={!contact?.phone ? 'Add a client phone first' : undefined}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '10px 14px',
                      minHeight: 40,
                      borderRadius: 10,
                      border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
                      background: contact?.phone
                        ? 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)'
                        : 'var(--v3-surface-2)',
                      color: contact?.phone ? 'var(--v3-on-primary)' : 'var(--v3-text-muted)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      cursor: contact?.phone ? 'pointer' : 'not-allowed',
                      WebkitTapHighlightColor: 'transparent',
                      boxShadow: contact?.phone
                        ? '0 0 0 2px rgba(228, 190, 111, 0.14), 0 4px 12px rgba(201, 150, 58, 0.28)'
                        : 'none',
                      opacity: !contact?.phone ? 0.6 : 1
                    }}
                  >
                    <Send size={13} />
                    Open SMS
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        ) : (
          /* Empty state — quiet hint, not a chrome panel */
          <motion.div
            key="empty"
            variants={item}
            style={{ padding: '4px 20px 28px' }}
          >
            <div style={{
              padding: '20px 18px',
              textAlign: 'center',
              borderRadius: 14,
              background: 'transparent',
              border: '1px dashed var(--v3-border-strong)',
              color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: 12.5,
              lineHeight: 1.5
            }}>
              The draft will appear here. Pick a channel + intent above, then tap{' '}
              <strong style={{ color: 'var(--v3-primary)' }}>Generate draft</strong>.
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ============================================================
   Field — labelled input wrapper. Uses v3-eyebrow label style
   for consistency with the rest of the app's form fields.
   ============================================================ */
function Field({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span className="v3-eyebrow">{label}</span>
      {children}
    </label>
  )
}

/* ============================================================
   ContextChip — small pill displaying ONE real fact the AI
   prompt will actually include. Improvement beyond the prototype:
   prototype's "USED 4 FACTS" chips were hand-typed mocks; ours
   reflect the actual contact fields fed into claudeMessage.
   ============================================================ */
function ContextChip({ children, tone = 'default' }) {
  const isGold = tone === 'gold'
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '3px 9px',
      borderRadius: 999,
      background: isGold ? 'var(--v3-primary-soft)' : 'var(--v3-surface-2)',
      border: `1px solid ${isGold
        ? 'color-mix(in srgb, var(--v3-primary) 32%, transparent)'
        : 'var(--v3-border)'}`,
      color: isGold ? 'var(--v3-primary)' : 'var(--v3-text)',
      fontFamily: 'var(--font-body)',
      fontSize: 11,
      fontWeight: 600,
      letterSpacing: '-0.005em',
      lineHeight: 1.3
    }}>
      {children}
    </span>
  )
}

function countWords(s) {
  if (!s) return 0
  return s.trim().split(/\s+/).filter(Boolean).length
}

const selectStyle = {
  padding: '11px 14px',
  borderRadius: 12,
  background: 'var(--v3-surface-2)',
  border: '1px solid var(--v3-border-strong)',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box'
}
