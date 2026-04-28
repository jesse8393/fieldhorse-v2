import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Copy, Check, MessageSquare, Mail, Mic, Send, PenLine } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { claudeMessage } from '../lib/anthropic.js'
import { toastSuccess } from '../lib/toast.js'
import { hapticMedium, hapticSuccess } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'
import SectionHeader from '../components/v3/SectionHeader.jsx'

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

  const { stagger, item } = useFhMotion()

  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {/* HEADER */}
      <motion.div
        variants={item}
        style={{
          padding: '12px var(--v3-gutter) 18px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <PenLine size={11} />
            Compose
          </span>
          <h1 className="v3-h1" style={{ marginTop: 6 }}>
            Draft client <em>communication.</em>
          </h1>
          <p className="v3-caption" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Clear, professional messages for leads, clients, and subs — drafted in seconds.
          </p>
        </div>
      </motion.div>

      {/* INPUT WORKSPACE */}
      <motion.div
        variants={item}
        className="v3-section"
        style={{ margin: '0 var(--v3-gutter) 14px' }}
      >
        <SectionHeader label="Draft a Message" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 }}>
          {/* Channel selector — matches Jobs filter pill style */}
          <div>
            <span className="v3-eyebrow" style={{ display: 'block', marginBottom: 8 }}>Channel</span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {CHANNELS.map((ch) => {
                const I = ch.Icon
                const isOn = channel === ch.id
                return (
                  <button
                    key={ch.id}
                    type="button"
                    onClick={() => setChannel(ch.id)}
                    aria-pressed={isOn}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 6,
                      padding: '10px 12px',
                      borderRadius: 12,
                      border: isOn
                        ? '1px solid color-mix(in srgb, var(--v3-primary) 70%, transparent)'
                        : '1px solid var(--v3-border-strong)',
                      background: isOn
                        ? 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)'
                        : 'var(--v3-surface-2)',
                      color: isOn ? 'var(--v3-on-primary)' : 'var(--v3-text)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 12,
                      fontWeight: 700,
                      letterSpacing: '0.04em',
                      cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                      boxShadow: isOn
                        ? '0 0 0 2px rgba(229, 193, 88, 0.14), 0 4px 10px rgba(229, 193, 88, 0.28), 0 1px 0 rgba(255, 255, 255, 0.30) inset'
                        : 'none',
                      transition: 'background 160ms ease, border-color 160ms ease, color 160ms ease'
                    }}
                  >
                    <I size={14} />
                    {ch.label}
                  </button>
                )
              })}
            </div>
          </div>

          {/* Intent + Contact row (responsive) */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 14 }}>
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
                style={{ ...selectStyle, resize: 'vertical', minHeight: 80, fontFamily: 'var(--font-body)' }}
              />
            </Field>
          </div>

          {/* Primary CTA */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => { hapticMedium(); generate() }}
            disabled={loading}
            style={{
              marginTop: 4,
              padding: '13px 18px',
              borderRadius: 12,
              border: '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)',
              background: loading
                ? 'var(--v3-surface-2)'
                : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
              color: loading ? 'var(--v3-text-muted)' : 'var(--v3-on-primary)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: loading ? 'default' : 'pointer',
              boxShadow: loading
                ? 'none'
                : '0 0 0 3px rgba(229, 193, 88, 0.16), 0 6px 18px rgba(229, 193, 88, 0.32), 0 1px 0 rgba(255, 255, 255, 0.30) inset',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              minHeight: 48,
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            {loading ? (
              <span aria-label="Loading" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(0,0,0,0.25)', borderTopColor: 'var(--v3-on-primary)', animation: 'fh-spin 700ms linear infinite' }} />
            ) : (
              <Sparkles size={16} />
            )}
            {loading ? 'Drafting…' : 'Generate Draft'}
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
      </motion.div>

      {/* OUTPUT CARD — empty state OR generated draft */}
      <AnimatePresence mode="wait">
        {draft ? (
          <motion.div
            key="draft"
            variants={item}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            className="v3-section v3-section--primary"
            style={{ margin: '0 var(--v3-gutter) 28px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
              <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={11} />
                Draft · {CHANNELS.find((c) => c.id === channel)?.label}
              </span>
              <span style={{
                fontSize: 10,
                fontWeight: 600,
                color: 'var(--v3-text-muted)',
                fontFamily: 'var(--font-body)',
                fontVariantNumeric: 'tabular-nums'
              }}>
                {draft.length} chars
              </span>
            </div>

            <pre
              style={{
                margin: 0,
                padding: '14px 16px',
                borderRadius: 12,
                background: 'var(--v3-surface-2)',
                border: '1px solid var(--v3-border)',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
                lineHeight: 1.55,
                color: 'var(--v3-text)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {draft}
            </pre>

            {/* Action row */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <button
                type="button"
                onClick={copy}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '9px 14px',
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
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '9px 14px',
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
                  Voicemail script
                </button>
              ) : contact && (
                <button
                  type="button"
                  onClick={sendAction}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '9px 14px',
                    borderRadius: 10,
                    border: '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)',
                    background: 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                    color: 'var(--v3-on-primary)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    boxShadow: '0 0 0 3px rgba(229, 193, 88, 0.16), 0 4px 12px rgba(229, 193, 88, 0.30), 0 1px 0 rgba(255, 255, 255, 0.30) inset'
                  }}
                >
                  <Send size={13} />
                  Open {channel === 'email' ? 'email' : 'SMS'}
                </button>
              )}
            </div>
          </motion.div>
        ) : (
          /* Empty state */
          <motion.div
            key="empty"
            variants={item}
            className="v3-section"
            style={{ margin: '0 var(--v3-gutter) 28px' }}
          >
            <div style={{
              padding: '32px 20px',
              textAlign: 'center',
              color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)'
            }}>
              <div style={{
                margin: '0 auto 14px',
                width: 48,
                height: 48,
                borderRadius: 14,
                background: 'var(--v3-primary-soft)',
                border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--v3-primary)'
              }}>
                <PenLine size={20} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
                Your draft will appear here.
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                Pick a channel + intent above, then tap <strong style={{ color: 'var(--v3-primary)' }}>Generate Draft</strong>.
              </div>
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
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="v3-eyebrow">{label}</span>
      {children}
    </label>
  )
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
