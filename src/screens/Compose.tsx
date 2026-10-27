import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import RecordPicker from '../components/RecordPicker.tsx'
import CommunicationHistory from '../components/CommunicationHistory.tsx'
import { emailDraft, plainDraft as stripMarkdown } from '../lib/composeDraft.ts'
import { motion } from 'framer-motion'
import { Sparkles, Copy, Check, MessageSquare, Mail, Mic, Send, PenLine, RotateCw } from 'lucide-react'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import BuildTopbar from '../components/desktop/BuildTopbar.tsx'
import { supabase, authHeaders } from '../lib/supabase.ts'
import { MOVED_STAGE_FILTER } from '../lib/stages.ts'
import { useOrgScope } from '../lib/orgScope.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { claudeMessage, getAiReadiness } from '../lib/anthropic.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { hapticMedium, hapticSuccess } from '../lib/haptics.ts'
import { useFhMotion } from '../lib/motion.ts'
import { FilterPill, Eyebrow } from '../components/v3'
import { countNoun } from '../lib/format.ts'
import { aiDraftError } from '../lib/serviceErrors.ts'

const CHANNELS = [
  { id: 'sms', label: 'SMS', tone: 'Keep it under 160 chars. Tight. No emoji. Punctuation minimal.', Icon: MessageSquare },
  { id: 'email', label: 'Email', tone: 'Short subject line + 3-paragraph body. Professional. Signed off with the contractor name.', Icon: Mail },
  { id: 'voice', label: 'Voicemail', tone: 'Under 25 seconds spoken. Natural phrasing. Clear next step.', Icon: Mic }
]

const INTENTS = [
  'First outreach to new lead',
  'Follow up after quote sent',
  'Reminder for scheduled job',
  'Change order explanation',
  'Invoice overdue nudge',
  'Thank you after job close',
  'Weather delay notice'
]

export default function Compose() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const [params, setParams] = useSearchParams()
  const [channel, setChannel] = useState(() => params.get('channel') === 'email' ? 'email' : 'sms')
  const [intent, setIntent] = useState(INTENTS[0])
  const [contactId, setContactId] = useState(() => params.get('contact') || '')
  const [contact, setContact] = useState<any>(null)
  const [contacts, setContacts] = useState<any[]>([])
  const [contactsLoading, setContactsLoading] = useState(true)
  const [contactsError, setContactsError] = useState('')
  const [reloadContacts, setReloadContacts] = useState(0)
  const [historyVersion, setHistoryVersion] = useState(0)
  const [emailUnavailable, setEmailUnavailable] = useState(false)
  const [handoff, setHandoff] = useState<{ contactId: string; channel: string; body: string; subject?: string; to: string } | null>(null)
  const [loggingHandoff, setLoggingHandoff] = useState(false)
  const sendLock = useRef(false)
  const [context, setContext] = useState('')
  const [draft, setDraft] = useState('')
  // Writing is always available, whether or not AI is configured.
  const [manual, setManual] = useState(false)
  const [loading, setLoading] = useState(false)
  const [aiReadiness, setAiReadiness] = useState<'configured' | 'unavailable' | 'unknown'>('unknown')
  const [readinessAttempt, setReadinessAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void getAiReadiness().then((status) => {
      if (!active) return
      setAiReadiness(status)
      if (status === 'unavailable') setManual(true)
    })
    return () => { active = false }
  }, [readinessAttempt])
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  // Real-send state (email channel only). Sent flag flips back to false
  // after 2.4s so the operator can send again if needed.
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)

  // The company's jobs, not only the ones this user created.
  const orgScope = useOrgScope(user?.id)
  useEffect(() => {
    let active = true
    if (!user || orgScope === undefined) return
    setContactsLoading(true)
    setContacts([])
    setContactsError('')
    const base = supabase
      .from('fh_contacts')
      .select('id, client_id, name, phone, email, job_title, job_type, address, stage, amount, fh_clients(name,phone,email,address)')
    ;(orgScope ? base.eq('org_id', orgScope) : base.eq('user_id', user.id))
      .not('stage', 'in', MOVED_STAGE_FILTER)
      .order('updated_at', { ascending: false })
      .then(({ data, error }: any) => {
        if (!active) return
        setContactsLoading(false)
        setContacts((data || []).map((row: any) => ({ ...row, name: row.fh_clients?.name || row.name, phone: row.fh_clients?.phone || row.phone, email: row.fh_clients?.email || row.email, address: row.address || row.fh_clients?.address })))
        if (error) setContactsError('Contacts could not load. Try again.')
      })
    return () => { active = false }
  }, [user, orgScope, reloadContacts])

  useEffect(() => {
    setContact(contacts.find((c) => c.id === contactId) || null)
  }, [contactId, contacts])

  useEffect(() => {
    const selected = params.get('contact') || ''
    setContactId(selected)
    setHandoff(null)
    setSent(false)
  }, [params])

  function chooseContact(value: string) {
    setContactId(value)
    setHandoff(null)
    setSent(false)
    setParams((current) => {
      const next = new URLSearchParams(current)
      if (value) next.set('contact', value)
      else next.delete('contact')
      return next
    }, { replace: true })
  }

  async function generate() {
    const ch = CHANNELS.find((c) => c.id === channel)
    // Keep the current message visible until a replacement succeeds.
    setLoading(true)
    setError('')
    setCopied(false)
    try {
      const contactLine = contact
        ? `Recipient: ${contact.name}. Job: ${contact.job_title || contact.job_type || 'unknown'}. Stage: ${contact.stage}. Amount: $${contact.amount || 0}.`
        : 'Recipient: generic contact (not yet linked to a job).'
      const res = await claudeMessage({
        // White-label: the AI is the contractor's own messaging
        // assistant from the customer's perspective. No app-attributable
        // phrasing in the system prompt, the recipient never knows a
        // platform exists. Sender identity comes from the contractor's
        // profile.company_name with a neutral fallback.
        system: `You are a messaging assistant for a contractor's business. Write a ${ch?.label} message on behalf of ${profile?.company_name || 'the contractor'}. ${ch?.tone} Brand voice: jobsite-direct, no buzzwords, no "captain" or naval metaphors ever, no "circle back". Sign off as ${profile?.company_name || 'the contractor'}; never mention any platform, app, or tool by name.`,
        messages: [{ role: 'user', content: `Intent: ${intent}\n${contactLine}\nExtra context: ${context || 'none'}\n\nReturn only the message text, no preamble.` }],
        maxTokens: 500
      })
      const text = res?.content?.[0]?.text || ''
      if (!text) throw new Error('Empty response from AI')
      hapticSuccess(); setDraft(text); setManual(false)
      toastSuccess('Draft ready', 'Copy, send, or edit')
    } catch (e: any) {
      console.error('[compose] generate failed:', e)
      setError(aiDraftError(e))
      setManual(true)
    } finally {
      setLoading(false)
    }
  }

  async function copy() {
    if (!draft.trim()) return
    try {
      await navigator.clipboard.writeText(draft)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      toastError("Couldn't copy", 'Select the message text and copy it manually.')
    }
  }

  function sendAction() {
    if (!contact || !draft.trim()) return
    const to = channel === 'email' ? contact.email : contact.phone
    if (!to || !['sms', 'email'].includes(channel)) return
    const email = emailDraft(draft, contact.job_title || intent || `Message from ${profile?.company_name || 'your contractor'}`)
    setHandoff({ contactId: contact.id, channel, body: channel === 'email' ? email.body : draft.trim(), subject: channel === 'email' ? email.subject : undefined, to })
    window.location.href = channel === 'email'
      ? `mailto:${to}?subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(email.body)}`
      : `sms:${to}?body=${encodeURIComponent(draft)}`
  }

  async function logHandoff() {
    if (!handoff || !user || loggingHandoff) return
    setLoggingHandoff(true)
    try {
      const { error } = await supabase.from('fh_notes').insert({
        user_id: user.id,
        org_id: orgScope || null,
        contact_id: handoff.contactId,
        category: handoff.channel === 'sms' ? 'text' : 'email',
        text: `${handoff.channel === 'sms' ? 'SMS' : 'Email'} reported sent to ${handoff.to}`,
        parsed: { communication: { version: 1, channel: handoff.channel, status: 'reported_sent', to: handoff.to, body: handoff.body, subject: handoff.subject || '' } },
      })
      if (error) throw error
      setHandoff(null)
      setHistoryVersion((value) => value + 1)
      toastSuccess('Communication recorded', 'Delivery and replies stay in your messaging app.')
    } catch {
      toastError("Couldn't save the communication", 'The message remains available. Try recording it again.')
    } finally {
      setLoggingHandoff(false)
    }
  }

  // Real on the server email send via Resend (POST /api/send-message).
  // Mirrors the multi-tenant sender pattern used by send-quote +
  // send-invoice: From = "<Your Company> via FieldHorse", Reply-To =
  // company_email. Server logs activity to fh_notes on success so the
  // sent message shows up in the job's activity feed.
  //
  // Falls back to the mailto: handoff (sendAction) when the server
  // returns 503 sender_not_configured, operators on a non-Resend
  // deploy can still ship the draft through their mail client.
  async function handleSendEmail() {
    if (!contact?.email || !draft.trim() || sendLock.current) return
    sendLock.current = true
    setSending(true)
    setError('')
    try {
      // Subject derived from intent + contact context, short and honest.
      const email = emailDraft(draft, contact.job_title || intent || `Message from ${profile?.company_name || 'your contractor'}`)
      if (!email.body.trim()) throw new Error('Write a message below the subject before sending.')
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({
          contact_id: contact.id,
          sender_user_id: user!.id,
          recipient_email: contact.email,
          recipient_name: contact.name || null,
          subject: email.subject,
          body: email.body
        })
      })
      const data = await res.json().catch(() => ({}))

      if (res.status === 503 && data?.error === 'sender_not_configured') {
        // Friendly fallback, open the mail client with the draft prefilled.
        setEmailUnavailable(true)
        toastError('Direct email unavailable', 'Your draft is safe. Use Open email app to send it.')
        return
      }
      if (!res.ok || !data?.ok) {
        throw new Error(data?.detail || data?.error || 'Email send failed.')
      }

      hapticSuccess()
      setSent(true)
      setHistoryVersion((value) => value + 1)
      if (data.history_saved === false) toastError('Email sent, history unavailable', 'Do not send again. The email provider accepted this message, but its history could not be saved.')
      toastSuccess(
        `Email sent to ${contact.email}`,
        `${draft.length} ${countNoun(draft.length, 'char')} · ${countWords(draft)} ${countNoun(countWords(draft), 'word')}`
      )
      setTimeout(() => setSent(false), 2400)
    } catch (e: any) {
      // Sending is a separate action from drafting; report its failure
      // without replacing the message or the drafting status.
      toastError("Couldn't send the email", e?.message || 'Try again in a moment.')
    } finally {
      sendLock.current = false
      setSending(false)
    }
  }

  // Re-run the generator with the same channel/intent/contact/context.
  // Audit complaint: "Only post-generation action is Copy." Regenerate
  // closes that gap, the operator can spin a fresh take without
  // walking back through the form.
  function regenerate() {
    hapticMedium()
    setSent(false)
    generate()
  }

  const { stagger, item } = useFhMotion()
  const isDesktop = useIsDesktop()
  // Copy and Send need real text; a blank or whitespace draft can't go out.
  const hasText = !!draft.trim()
  const canEmail = !!contact?.email && !!emailDraft(draft, '').body.trim()
  const canSms = !!contact?.phone && hasText

  return (
    <motion.div
      className={`v3-screen v3-screen--compose${isDesktop ? ' fh-build-utility' : ''}`}
      data-build-screen={isDesktop ? 'Compose' : undefined}
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 48, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {isDesktop && (
        // gridColumn:1/-1, .v3-screen--compose is a 2-col grid
        // (360px + 350px) for the cockpit + draft-preview layout.
        // Without the span, the topbar landed in col 1 (squeezing the
        // search to 360px so the placeholder wrapped to two lines) and
        // the title fell into col 2 beside it. Wrapping both in a
        // full-width spanner pins them above the columned content.
        <div style={{ gridColumn: '1 / -1' }}>
          <BuildTopbar />
          <div style={{ padding: '12px var(--v3-gutter) 12px' }}>
            <div className="fh-build-good">Dispatch</div>
            <h1 className="fh-build-title">Message composer</h1>
            <Link to="/inbox?view=history" className="fh-build-outline-btn">Communication history</Link>
          </div>
        </div>
      )}
      {!isDesktop && <h1 style={{ padding: '16px 24px 4px', fontSize: 'var(--fh-type-page)', margin: 0 }}>Message composer</h1>}
      {/* INPUT COCKPIT, black-glass panel: header eyebrow + channel pills
          + intent + contact + context chips + CTA */}
      <motion.div className="fh-compose-workspace__input" variants={item} style={{ padding: '8px 24px 12px' }}>
        <div style={{
          padding: '12px 16px',
          borderRadius: 10,
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border)',
          boxShadow: '0 1px 0 rgba(242, 237, 228, 0.04) inset, 0 8px 22px rgba(20, 20, 20, 0.40)'
        }}>
          {/* Header, title eyebrow on its own row, recipient pill on the
              row below. The old layout placed both on one flex row with
              flexWrap:wrap, but two uppercase eyebrows with letter-
              spacing:0.16em collided on iPhone, the "TO · GENERIC"
              clipped against the cockpit edge. Splitting into two rows
              gives each label room to breathe and keeps the recipient
              cue visible regardless of contact-name length. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
            <Eyebrow tone="gold">
              <PenLine size={11} aria-hidden="true" />
              AI compose
            </Eyebrow>
            <Eyebrow as="div" style={{ alignSelf: 'flex-start', maxWidth: '100%', padding: '4px 8px', borderRadius: 10, background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)', opacity: contact ? 1 : 0.75 }}>
              <span style={{ color: 'var(--v3-text-muted)' }}>To</span>
              <span aria-hidden="true" style={{ color: 'var(--v3-text-faint, var(--v3-text-muted))' }}>·</span>
              <span
                style={{
                  color: 'var(--v3-text)',
                  letterSpacing: 0,
                  textTransform: 'none',
                  fontWeight: 600,
                  fontSize: 14,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  maxWidth: '60vw'
                }}
              >
                {contact?.name || 'Generic'}
              </span>
            </Eyebrow>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {/* Channel selector, canonical FilterPill */}
            <div>
              <Eyebrow as="div" style={{ marginBottom: 6 }}>Channel</Eyebrow>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {CHANNELS.map((ch) => {
                  const I = ch.Icon
                  const isOn = channel === ch.id
                  return (
                    <FilterPill
                      key={ch.id}
                      size="sm"
                      active={isOn}
                      onClick={() => setChannel(ch.id)}
                      ariaLabel={`${ch?.label} channel`}
                      style={{ justifyContent: 'center' }}
                    >
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
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

              <RecordPicker
                label="Contact"
                value={contactId}
                onChange={chooseContact}
                options={contacts.map((row) => ({ value: row.id, label: row.name || 'Unnamed customer', description: [row.job_title || row.job_type, row.address, row.stage].filter(Boolean).join(' · ') }))}
                clearLabel="No contact (generic message)"
                loading={contactsLoading}
                error={contactsError}
              />
              {contactsError && <button type="button" className="fh-build-outline-btn" onClick={() => setReloadContacts((value) => value + 1)}>Retry contacts</button>}
              {contact && ((channel === 'email' && !contact.email) || (channel === 'sms' && !contact.phone)) && <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                <p>This customer has no {channel === 'email' ? 'email address' : 'phone number'} saved. You can still draft and copy a message.</p>
                <Link className="fh-build-outline-btn" to={contact.client_id ? `/clients/${contact.client_id}?edit=contact` : `/jobs/${contact.id}`} style={{ minHeight: 44 }}>Add contact details</Link>
              </div>}

              <Field label="Extra context">
                <textarea
                  rows={3}
                  value={context}
                  onChange={(e) => setContext(e.target.value)}
                  placeholder="Anything to highlight, price change, delay reason, specific material…"
                  style={{ ...selectStyle, resize: 'vertical', minHeight: 72, fontFamily: 'var(--font-body)' }}
                />
              </Field>
            </div>

            {/* Real AI-context transparency chips, show what facts the model
                will actually see. Only renders when a contact is selected. */}
            {contact && (
              <div>
                <Eyebrow as="div" style={{ marginBottom: 6 }}>
                  AI will use
                </Eyebrow>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
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
              disabled={loading || aiReadiness === 'unavailable'}
              style={{
                padding: '12px 16px',
                borderRadius: 10,
                border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
                background: loading
                  ? 'var(--v3-surface-2)'
                  : 'var(--v3-primary)',
                color: loading ? 'var(--v3-text-muted)' : 'var(--v3-on-primary)',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
                fontWeight: 700,
                letterSpacing: 0,
                cursor: loading ? 'default' : 'pointer',
                boxShadow: loading
                  ? 'none'
                  : '0 0 0 2px rgba(201, 150, 58, 0.14), 0 6px 18px rgba(201, 150, 58, 0.30)',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                minHeight: 46,
                WebkitTapHighlightColor: 'transparent'
              }}
            >
              {loading ? (
                <span aria-label="Loading" style={{ width: 14, height: 14, borderRadius: 10, border: '2px solid rgba(20, 20, 20,0.25)', borderTopColor: 'var(--v3-on-primary)', animation: 'fh-spin 700ms linear infinite' }} />
              ) : (
                <Sparkles size={15} />
              )}
              {loading ? 'Drafting…' : aiReadiness === 'unavailable' ? 'AI drafting unavailable' : 'Generate draft'}
            </motion.button>

            <button
              type="button"
              className="fh-build-outline-btn"
              disabled={loading}
              onClick={() => { setManual(true); setError('') }}
              style={{ minHeight: 44 }}
            >
              <PenLine size={15} aria-hidden="true" />
              {draft ? 'Edit message' : 'Write manually'}
            </button>

            {aiReadiness === 'unavailable' && <div role="status" style={{ fontSize: 14, lineHeight: 1.5 }}>
              <p>AI drafting needs workspace setup. You can write and send your message below.</p>
              <button type="button" className="fh-build-outline-btn" onClick={() => setReadinessAttempt((value) => value + 1)} style={{ minHeight: 44 }}>Check AI availability</button>
            </div>}

            {/* Error block */}
            {error && (
              <div role="alert" style={{
                padding: '12px 12px',
                borderRadius: 10,
                background: 'var(--v3-danger-soft)',
                border: '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)',
                color: 'var(--v3-text)',
                fontFamily: 'var(--font-body)',
                fontSize: 14,
                lineHeight: 1.5
              }}>
                <div style={{ fontWeight: 700, color: 'var(--v3-danger-text)', marginBottom: 4 }}>AI unavailable</div>
                <div style={{ color: 'var(--v3-text-muted)' }}>{error}</div>
              </div>
            )}
          </div>
        </div>
      </motion.div>

      {/* OUTPUT COCKPIT, black-glass panel, draft-as-hero.
          AnimatePresence mode="wait" was preventing the draft panel from
          ever mounting after generate succeeded, the empty-state's
          missing exit animation caused the wait to never resolve. Switched
          to plain conditional render so the draft hero always appears the
          instant `draft` state flips truthy. */}
      {draft || manual ? (
          <motion.div
            key="draft"
            className="fh-compose-workspace__output"
            variants={item}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            style={{ padding: '0 24px 24px' }}
          >
            <div style={{
              padding: '12px 16px',
              borderRadius: 10,
              background: 'var(--v3-surface)',
              border: '1px solid var(--v3-border)',
              boxShadow: '0 1px 0 rgba(242, 237, 228, 0.04) inset, 0 8px 22px rgba(20, 20, 20, 0.40)'
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 10 }}>
                <Eyebrow tone="gold">
                  <Sparkles size={11} aria-hidden="true" />
                  Draft · {CHANNELS.find((c) => c.id === channel)?.label}
                </Eyebrow>
                <Eyebrow style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {countWords(draft)} {countNoun(countWords(draft), 'word')} · {draft.length} {countNoun(draft.length, 'char')}
                </Eyebrow>
              </div>

              {/* Draft hero, channel-appropriate rendering. Ported from the
                  v3 design (screens-compose-nav.jsx cmp2-hero variants):
                    sms   → iPhone-style chat bubble with phone bar + recipient
                    email → envelope-style card with FROM / TO / SUBJECT rows
                    voice → script panel labelled "your voice cloned" */}
              {manual ? (
                // AI is down: write the message by hand. The preview heroes
                // are read only, so without this there was nothing to type in.
                <textarea
                  rows={6}
                  value={draft}
                  readOnly={loading}
                  onChange={(e) => setDraft(e.target.value)}
                  aria-label="Message"
                  placeholder="Write your message here."
                  style={{ ...selectStyle, resize: 'vertical', minHeight: 140, fontFamily: 'var(--font-body)', lineHeight: 1.55 }}
                />
              ) : (
                <DraftHero
                  channel={channel}
                  draft={draft}
                  contact={contact}
                  profile={profile}
                  intent={intent}
                />
              )}

              <p style={{ color: 'var(--v3-text-muted)', fontSize: 14, lineHeight: 1.5, margin: '12px 0 0' }}>
                {channel === 'sms'
                  ? 'Open SMS hands this message to your messaging app. Finish sending there, then confirm here to record it. Replies stay in your SMS app.'
                  : channel === 'email'
                    ? 'Send email sends through Fieldhorse and records the message below. Open email app uses your own mail app instead. Replies to these emails stay in your company mailbox.'
                    : 'Copy this script and read it when you call. No call or voicemail is sent by Fieldhorse.'}
              </p>

              {/* Action row, 5/17 Compose-end-to-end port.
                  Per the design's CTA bar (screens-compose-nav.jsx)
                  and the 5/13 audit complaint that "Compose dead-ends
                  at Copy", three actions on the row:

                    Regenerate   , spin a fresh take, same prompt
                    Copy         , secondary, always available
                    Send (PRIMARY), channel-aware:
                      email + contact email → POST /api/send-message
                          (real Resend send; falls back to mailto: on
                          503 sender_not_configured)
                      sms + contact phone   → native sms: handoff
                          (no SMS provider wired yet; Twilio is a
                          future branch)
                      voice                 → disabled "Voicemail
                          script" pill, operator reads the script
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
                  disabled={loading || aiReadiness === 'unavailable'}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 12px',
                    minHeight: 40,
                    borderRadius: 10,
                    background: 'var(--v3-surface-2)',
                    border: '1px solid var(--v3-border-strong)',
                    color: loading ? 'var(--v3-text-muted)' : 'var(--v3-text)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 14,
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
                  disabled={!hasText}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 8,
                    padding: '12px 12px',
                    minHeight: 40,
                    borderRadius: 10,
                    background: 'var(--v3-surface-2)',
                    border: '1px solid var(--v3-border-strong)',
                    color: hasText ? 'var(--v3-text)' : 'var(--v3-text-muted)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 14,
                    fontWeight: 600,
                    cursor: hasText ? 'pointer' : 'default',
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
                      gap: 8,
                      padding: '12px 12px',
                      minHeight: 40,
                      borderRadius: 10,
                      background: 'var(--v3-surface-2)',
                      border: '1px solid var(--v3-border)',
                      color: 'var(--v3-text-muted)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 14,
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
                    disabled={sending || !canEmail}
                    title={!contact?.email ? 'Add a client email first' : !hasText ? 'Write a message first' : undefined}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '12px 12px',
                      minHeight: 40,
                      borderRadius: 10,
                      border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
                      background: sent
                        ? 'var(--v3-success)'
                        : (sending || !canEmail)
                          ? 'var(--v3-surface-2)'
                          : 'var(--v3-primary)',
                      color: (sending || !canEmail)
                        ? 'var(--v3-text-muted)'
                        : 'var(--v3-on-primary)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 14,
                      fontWeight: 700,
                      letterSpacing: 0,
                      cursor: (sending || !canEmail) ? 'not-allowed' : 'pointer',
                      WebkitTapHighlightColor: 'transparent',
                      boxShadow: (sending || !canEmail)
                        ? 'none'
                        : '0 0 0 2px rgba(201, 150, 58, 0.14), 0 4px 12px rgba(201, 150, 58, 0.28)',
                      opacity: !canEmail ? 0.6 : 1
                    }}
                  >
                    {sent ? <Check size={13} /> : <Send size={13} />}
                    {sent ? 'Sent' : sending ? 'Sending…' : 'Send email'}
                  </button>
                ) : (
                  /* SMS channel, keep the native handoff. No in-app SMS
                     provider yet (Twilio integration is a future branch). */
                  <button
                    type="button"
                    onClick={sendAction}
                    disabled={!canSms}
                    title={!contact?.phone ? 'Add a client phone first' : !hasText ? 'Write a message first' : undefined}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                      padding: '12px 12px',
                      minHeight: 40,
                      borderRadius: 10,
                      border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
                      background: canSms
                        ? 'var(--v3-primary)'
                        : 'var(--v3-surface-2)',
                      color: canSms ? 'var(--v3-on-primary)' : 'var(--v3-text-muted)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 14,
                      fontWeight: 700,
                      letterSpacing: 0,
                      cursor: canSms ? 'pointer' : 'not-allowed',
                      WebkitTapHighlightColor: 'transparent',
                      boxShadow: canSms
                        ? '0 0 0 2px rgba(201, 150, 58, 0.14), 0 4px 12px rgba(201, 150, 58, 0.28)'
                        : 'none',
                      opacity: !canSms ? 0.6 : 1
                    }}
                  >
                    <Send size={13} />
                    Open SMS
                  </button>
                )}
              </div>
              {channel === 'email' && emailUnavailable && <button type="button" className="fh-build-outline-btn" onClick={sendAction} disabled={!canEmail} style={{ minHeight: 44, marginTop: 12 }}>Open email app</button>}
              {handoff && <div role="status" style={{ paddingTop: 16, fontSize: 14, lineHeight: 1.5 }}>
                <p>Finish sending in your {handoff.channel === 'sms' ? 'SMS' : 'email'} app. Nothing has been marked sent here.</p>
                <button type="button" className="fh-build-outline-btn" onClick={logHandoff} disabled={loggingHandoff} style={{ minHeight: 44 }}>{loggingHandoff ? 'Saving…' : 'I sent it, record communication'}</button>
                <button type="button" className="fh-build-outline-btn" onClick={() => setHandoff(null)} disabled={loggingHandoff} style={{ minHeight: 44, marginTop: 8 }}>Not sent, dismiss</button>
              </div>}
            </div>
          </motion.div>
        ) : (
          /* Empty state, quiet hint, not a chrome panel */
          <motion.div
            key="empty"
            className="fh-compose-workspace__output"
            variants={item}
            style={{ padding: '4px 24px 24px' }}
          >
            <div style={{
              padding: '24px 16px',
              textAlign: 'center',
              borderRadius: 10,
              background: 'transparent',
              border: '1px dashed var(--v3-border-strong)',
              color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              lineHeight: 1.5
            }}>
              Write your message now, or choose a channel and intent to generate a draft.
            </div>
          </motion.div>
        )}
      {contact && <div style={{ gridColumn: '1 / -1', padding: '0 24px 24px' }}><CommunicationHistory contactId={contact.id} clientId={contact.client_id} refreshKey={historyVersion} /></div>}
      {!isDesktop && <Link to="/inbox?view=history" className="fh-build-outline-btn" style={{ margin: '0 24px', minHeight: 44 }}>Communication history</Link>}
    </motion.div>
  )
}

/* ============================================================
   Field, labelled input wrapper. Uses v3-eyebrow label style
   for consistency with the rest of the app's form fields.
   ============================================================ */
function Field({ label, children }: any) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <span className="v3-eyebrow">{label}</span>
      {children}
    </label>
  )
}

/* ============================================================
   ContextChip, small pill displaying ONE real fact the AI
   prompt will actually include. Improvement beyond the prototype:
   prototype's "USED 4 FACTS" chips were hand-typed mocks; ours
   reflect the actual contact fields fed into claudeMessage.
   ============================================================ */
function ContextChip({ children, tone = 'default' }: any) {
  const isGold = tone === 'gold'
  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '4px 8px',
      borderRadius: 10,
      background: isGold ? 'var(--v3-primary-soft)' : 'var(--v3-surface-2)',
      border: `1px solid ${isGold
        ? 'color-mix(in srgb, var(--v3-primary) 32%, transparent)'
        : 'var(--v3-border)'}`,
      color: isGold ? 'var(--v3-primary-text)' : 'var(--v3-text)',
      fontFamily: 'var(--font-body)',
      fontSize: 14,
      fontWeight: 600,
      letterSpacing: 0,
      lineHeight: 1.3
    }}>
      {children}
    </span>
  )
}

function countWords(s: any) {
  if (!s) return 0
  return s.trim().split(/\s+/).filter(Boolean).length
}

/* ============================================================
   DraftHero, channel-appropriate visualization of the draft.
   Mirrors the v3 design's cmp2-hero pattern (screens-compose-
   nav.jsx) so the operator sees what the client will receive,
   not just plain text on a panel.
   ============================================================ */
function DraftHero({ channel, draft, contact, profile, intent }: any) {
  if (channel === 'sms') {
    return <SmsHero draft={draft} contact={contact} />
  }
  if (channel === 'email') {
    return <EmailHero draft={draft} contact={contact} profile={profile} intent={intent} />
  }
  return <VoiceHero draft={draft} />
}

function SmsHero({ draft, contact }: any) {
  const initials = (contact?.name || '·').trim().split(/\s+/).slice(0, 2).map((s: any) => s.charAt(0).toUpperCase()).join('') || '·'
  const now = new Date()
  const timeStr = now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  const dayStr = now.toLocaleDateString([], { weekday: 'short' })
  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, var(--v3-border-strong))',
      background: 'var(--v3-surface-2)',
      overflow: 'hidden'
    }}>
      {/* Phone status bar */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '8px 12px',
        borderBottom: '1px solid var(--v3-border)',
        fontFamily: 'var(--font-display)',
        fontSize: 12,
        letterSpacing: 0,
        color: 'var(--v3-text-muted)'
      }}>
        <span>{timeStr}</span>
        <span style={{ display: 'inline-flex', gap: 4, opacity: 0.7 }}>
          <span style={{ width: 16, height: 8, borderRadius: 10, border: '1px solid currentColor', display: 'inline-block', position: 'relative' }}>
            <span style={{ position: 'absolute', inset: 1, width: '70%', background: 'currentColor', borderRadius: 10 }} />
          </span>
        </span>
      </div>
      {/* Recipient header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '12px 12px',
        borderBottom: '1px solid var(--v3-border)'
      }}>
        <div aria-hidden="true" style={{
          width: 32, height: 32, borderRadius: 10,
          background: 'linear-gradient(135deg, #141414, #141414)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
          // The tile stays onyx in both themes, so its ink stays pure gold.
          color: 'var(--gold)',
          fontFamily: 'var(--font-display)', fontSize: 12,
          display: 'grid', placeItems: 'center',
          flexShrink: 0
        }}>{initials}</div>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--v3-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {contact?.name || 'New recipient'}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
            {contact?.phone || 'No phone on file'}
          </div>
        </div>
      </div>
      {/* Bubble */}
      <div style={{ padding: '16px 12px 16px' }}>
        <div style={{
          fontFamily: 'var(--font-display)', fontSize: 12,
          letterSpacing: 0, color: 'var(--v3-text-muted)',
          textAlign: 'center', marginBottom: 10
        }}>
          {dayStr} · {timeStr}
        </div>
        <div style={{
          maxWidth: '85%',
          marginLeft: 'auto',
          padding: '12px 12px',
          borderRadius: '18px 18px 6px 18px',
          background: 'linear-gradient(180deg, var(--v3-primary-hot), var(--v3-primary))',
          color: 'var(--v3-on-primary)',
          fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.45,
          whiteSpace: 'pre-wrap', wordBreak: 'break-word',
          boxShadow: '0 4px 14px rgba(201, 150, 58, 0.22)'
        }}>
          {stripMarkdown(draft)}
        </div>
      </div>
    </div>
  )
}

// Strip the markdown wrappers (** and __ for bold, * and _ for italic,
// fenced code blocks, headings) that Claude sometimes emits so the
// recipient doesn't see literal asterisks in the email body. Audit flagged
// "**Subject: ...**" rendering with raw asterisks visible.

function EmailHero({ draft, contact, profile, intent }: any) {
  const fromName = profile?.company_name || profile?.full_name || 'Sender'
  const fromAddr = profile?.company_email || profile?.email || ''
  const { subject: subjectGuess, body } = emailDraft(draft, contact?.job_title || intent || `Message from ${fromName}`)
  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid var(--v3-border-strong)',
      background: 'var(--v3-surface-2)',
      overflow: 'hidden'
    }}>
      <div style={{
        padding: '12px 12px',
        borderBottom: '1px solid var(--v3-border)',
        display: 'flex', flexDirection: 'column', gap: 4,
        fontFamily: 'var(--font-body)', fontSize: 14,
        color: 'var(--v3-text-muted)'
      }}>
        <div style={{ display: 'flex', gap: 12 }}>
          <Eyebrow style={{ width: 44 }}>From</Eyebrow>
          <span style={{ color: 'var(--v3-text)', fontWeight: 600 }}>{fromName}{fromAddr ? ` <${fromAddr}>` : ''}</span>
        </div>
        <div style={{ display: 'flex', gap: 12 }}>
          <Eyebrow style={{ width: 44 }}>To</Eyebrow>
          <span style={{ color: 'var(--v3-text)', fontWeight: 600 }}>
            {contact?.name || 'Recipient'}{contact?.email ? ` <${contact.email}>` : ''}
          </span>
        </div>
        <div style={{
          marginTop: 4, fontFamily: 'var(--font-display)', fontSize: 16,
          color: 'var(--v3-text)', letterSpacing: 0
        }}>
          {subjectGuess}
        </div>
      </div>
      <pre style={{
        margin: 0, padding: '12px 16px',
        fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.55,
        color: 'var(--v3-text)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        background: 'var(--v3-surface)'
      }}>
        {body}
      </pre>
    </div>
  )
}

function VoiceHero({ draft }: any) {
  return (
    <div style={{
      borderRadius: 10,
      border: '1px solid var(--v3-border-strong)',
      background: 'var(--v3-surface-2)',
      padding: '12px 16px',
      display: 'flex', flexDirection: 'column', gap: 12
    }}>
      <Eyebrow as="div" tone="gold">
        Script · read this aloud
      </Eyebrow>
      <pre style={{
        margin: 0,
        fontFamily: 'var(--font-body)', fontSize: 14, lineHeight: 1.6,
        color: 'var(--v3-text)',
        whiteSpace: 'pre-wrap', wordBreak: 'break-word'
      }}>
        {stripMarkdown(draft)}
      </pre>
    </div>
  )
}

const selectStyle: import('react').CSSProperties = {
  padding: '12px 12px',
  borderRadius: 10,
  background: 'var(--v3-surface-2)',
  border: '1px solid var(--v3-border-strong)',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)',
  fontSize: 16,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box'
}
