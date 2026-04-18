import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, Copy, Check, MessageSquare, Mail, Mic, Send, PenLine } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { claudeMessage } from '../lib/anthropic.js'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import ScanLine from '../components/fx/ScanLine.jsx'

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
      setDraft(res?.content?.[0]?.text || '')
    } catch (e) {
      setDraft(`AI unavailable. Hand-draft fallback: Hi ${contact?.name || 'there'}, quick note on ${intent.toLowerCase()}. — ${profile?.company_name || ''}`)
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

  const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.08 } } }
  const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 220, damping: 26 } } }

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '20px 20px 14px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            AI compose
          </span>
          <h1 className="fh-font-serif" style={{ margin: '4px 0 0', fontSize: 30, lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
            Write it,{' '}
            <em className="fh-font-serif-italic fh-text-gradient-gold">perfectly.</em>
          </h1>
        </div>
        <div style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 14, border: '1px solid rgba(201,150,58,0.3)', background: 'rgba(201,150,58,0.1)', display: 'grid', placeItems: 'center', color: 'var(--field-gold-bright)' }} aria-hidden="true">
          <PenLine size={20} />
        </div>
      </motion.div>

      {/* CHANNEL TOGGLE GROUP — inline-styled active state because Tailwind v4
          alpha modifiers don't resolve on our @theme var()-based brand tokens. */}
      <motion.div variants={item} style={{ padding: '0 20px 12px' }}>
        <ToggleGroup
          type="single"
          value={channel}
          onValueChange={(v) => { if (v) setChannel(v) }}
          aria-label="Message channel"
          style={{ display: 'flex', width: '100%', gap: 8 }}
        >
          {CHANNELS.map((ch) => {
            const I = ch.Icon
            const isOn = channel === ch.id
            return (
              <ToggleGroupItem
                key={ch.id}
                value={ch.id}
                aria-label={ch.label}
                style={{
                  flex: 1,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                  padding: '10px 12px',
                  borderRadius: 12,
                  border: isOn ? '1px solid rgba(201,150,58,0.4)' : '1px solid var(--rule)',
                  background: isOn ? 'rgba(201,150,58,0.15)' : 'rgba(255,255,255,0.04)',
                  color: isOn ? 'var(--field-gold-bright)' : 'var(--ink-muted)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: 'pointer',
                  transition: 'all 160ms ease'
                }}
              >
                <I size={14} />
                {ch.label}
              </ToggleGroupItem>
            )
          })}
        </ToggleGroup>
      </motion.div>

      {/* FORM */}
      <motion.div variants={item} style={{ padding: '0 20px 14px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabelStyle}>Intent</span>
          <select
            value={intent}
            onChange={(e) => setIntent(e.target.value)}
            style={selectStyle}
          >
            {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabelStyle}>Contact{contacts.length > 0 ? ` · ${contacts.length}` : ''}</span>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            style={selectStyle}
          >
            <option value="">No contact (generic)</option>
            {contacts.map((c) => {
              const tail = c.job_title || c.job_type || c.stage || ''
              return (
                <option key={c.id} value={c.id}>
                  {c.name}{tail ? ` — ${tail}` : ''}
                </option>
              )
            })}
          </select>
        </label>

        <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <span style={fieldLabelStyle}>Extra context</span>
          <textarea
            rows={3}
            value={context}
            onChange={(e) => setContext(e.target.value)}
            placeholder="Anything to highlight — price change, delay reason, specific material…"
            style={{ ...selectStyle, resize: 'vertical', minHeight: 80 }}
          />
        </label>

        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={generate}
          disabled={loading}
          style={{
            marginTop: 4,
            padding: '12px 16px',
            borderRadius: 12,
            border: 'none',
            background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
            color: 'var(--onyx)',
            fontFamily: 'var(--font-display)',
            fontSize: 15,
            letterSpacing: '0.14em',
            cursor: loading ? 'default' : 'pointer',
            boxShadow: '0 8px 20px rgba(201,150,58,0.35)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            opacity: loading ? 0.65 : 1
          }}
        >
          <Sparkles size={16} />
          {loading ? 'WRITING…' : 'GENERATE DRAFT'}
        </motion.button>
      </motion.div>

      {/* AI RESPONSE CARD */}
      <AnimatePresence>
        {draft && (
          <motion.div
            key="draft"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
            style={{
              position: 'relative',
              margin: '0 20px 20px',
              padding: '14px 16px 12px',
              borderRadius: 16,
              background: 'linear-gradient(135deg, rgba(201,150,58,0.08), rgba(201,150,58,0.02))',
              border: '1px solid rgba(201,150,58,0.3)',
              overflow: 'hidden'
            }}
          >
            <ScanLine />
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
                <Sparkles size={12} />
                Draft
              </span>
              <span style={{ fontSize: 10, fontWeight: 600, color: 'var(--ink-muted)', fontFamily: 'var(--font-mono)' }}>
                {draft.length} chars
              </span>
            </header>
            <pre
              style={{
                margin: 0,
                padding: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 14,
                lineHeight: 1.5,
                color: 'var(--ink-strong)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word'
              }}
            >
              {draft}
            </pre>
            <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={copy}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
              {channel === 'voice' ? (
                <button
                  type="button"
                  disabled
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)', color: 'var(--ink-faint)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, cursor: 'default' }}
                >
                  <Mic size={14} />
                  Voice script
                </button>
              ) : contact && (
                <button
                  type="button"
                  onClick={sendAction}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  <Send size={14} />
                  Open {channel === 'email' ? 'email' : 'SMS'}
                </button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

const fieldLabelStyle = {
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-muted)'
}

const selectStyle = {
  padding: '11px 14px',
  borderRadius: 12,
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid var(--rule)',
  color: 'var(--ink-strong)',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  outline: 'none'
}
