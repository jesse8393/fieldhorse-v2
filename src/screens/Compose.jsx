import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/icons/Icon.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { claudeMessage } from '../lib/anthropic.js'

const CHANNELS = [
  { id: 'sms', label: 'SMS', tone: 'Keep it under 160 chars. Tight. No emoji. Punctuation minimal.' },
  { id: 'email', label: 'Email', tone: 'Short subject line + 3-paragraph body. Professional. Signed off with the contractor name.' },
  { id: 'voice', label: 'Voicemail', tone: 'Under 25 seconds spoken. Natural phrasing. Call-to-action clear.' }
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

  return (
    <section className="fh-page">
      <header className="fh-page__head">
        <div>
          <span className="fh-sec-tag">
            <span className="fh-sec-tag__label">AI compose</span>
          </span>
          <h1 className="fh-page__title">Draft in a tap.</h1>
        </div>
      </header>

      <div className="fh-compose">
        <div className="fh-seg">
          {CHANNELS.map((c) => (
            <button key={c.id} type="button" className={c.id === channel ? 'is-on' : ''} onClick={() => setChannel(c.id)}>
              {c.label}
            </button>
          ))}
        </div>

        <label className="fh-field">
          <span className="fh-field__k">Intent</span>
          <select value={intent} onChange={(e) => setIntent(e.target.value)}>
            {INTENTS.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </label>

        <label className="fh-field">
          <span className="fh-field__k">Contact{contacts.length > 0 ? ` · ${contacts.length}` : ''}</span>
          <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
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

        <label className="fh-field">
          <span className="fh-field__k">Extra context</span>
          <textarea rows={3} value={context} onChange={(e) => setContext(e.target.value)} placeholder="Anything to highlight — price change, delay reason, specific material…" />
        </label>

        <button type="button" className="fh-btn fh-btn--gold" onClick={generate} disabled={loading}>
          <Icon name="compose" size={18} />
          {loading ? 'Writing…' : 'Generate draft'}
        </button>

        <AnimatePresence>
          {draft && (
            <motion.div
              className="fh-compose__out"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
            >
              <header className="fh-compose__head">
                <span className="fh-eye">Draft</span>
                <span className="fh-compose__meta">{draft.length} chars</span>
              </header>
              <pre className="fh-compose__body">{draft}</pre>
              <div className="fh-compose__actions">
                <button type="button" className="fh-btn fh-btn--ghost" onClick={copy}>
                  <Icon name="check" size={16} />
                  {copied ? 'Copied' : 'Copy'}
                </button>
                {contact && (
                  <button type="button" className="fh-btn fh-btn--ink" onClick={sendAction}>
                    <Icon name={channel === 'email' ? 'mail' : 'phone'} size={16} />
                    Open {channel === 'email' ? 'email' : 'SMS'}
                  </button>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}
