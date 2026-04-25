import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, Phone, Calendar, Mail, MessageSquare, Package, ClipboardCheck, Mic, MicOff, Sparkles, Trash2, AlertTriangle, Briefcase } from 'lucide-react'
import { SkeletonList } from '../components/Skeleton.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { claudeMessage } from '../lib/anthropic.js'
import { toastSuccess, toastUndo, toastError } from '../lib/toast.js'
import { hapticTap, hapticMedium, hapticSuccess } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'
import SwipeableRow from '../components/SwipeableRow.jsx'
import { Archive as ArchiveIcon, Trash2 as TrashIcon } from 'lucide-react'

const SYSTEM = `You are Fieldhorse, a construction operations AI. You receive rough field notes dictated or typed by a contractor from a jobsite. Parse them into structured JSON with fields: summary (one sentence), action_items (array of strings with owners if mentioned), risks (array), materials_needed (array), follow_up_date (ISO date if mentioned or null). Return ONLY JSON, no prose.`

// Pick the primary Lucide glyph for a note based on its text + parsed signals.
// Schema stores the note body in `text` (not `body`); `parsed` is session-only
// unless migration 003_add_notes_parsed.sql has been applied.
function iconForNote(note) {
  const p = note?.parsed
  const body = (note?.text || note?.body || '').toLowerCase()
  if (p?.follow_up_date) return Calendar
  if (p?.materials_needed?.length) return Package
  if (p?.action_items?.length) return ClipboardCheck
  if (p?.risks?.length) return AlertTriangle
  if (/\b(call|phone|dialed)\b/.test(body)) return Phone
  if (/\b(email|mailed)\b/.test(body)) return Mail
  if (/\b(text|sms|msg'd|texted)\b/.test(body)) return MessageSquare
  return FileText
}

function iconTone(note) {
  const p = note?.parsed
  if (p?.risks?.length) return { fg: 'var(--alert-red)', bg: 'rgba(192,57,43,0.15)', border: 'rgba(192,57,43,0.35)' }
  if (p?.follow_up_date) return { fg: 'var(--field-gold-bright)', bg: 'rgba(201,150,58,0.14)', border: 'rgba(201,150,58,0.35)' }
  if (p?.action_items?.length) return { fg: 'var(--signal-green)', bg: 'rgba(45,122,79,0.14)', border: 'rgba(45,122,79,0.35)' }
  return { fg: 'var(--ink-muted)', bg: 'rgba(255,255,255,0.05)', border: 'var(--rule)' }
}

export default function Notes() {
  const { user } = useAuth()
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [contactId, setContactId] = useState('')
  const [contacts, setContacts] = useState([])
  const [saving, setSaving] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState(null)
  const [voiceState, setVoiceState] = useState('idle') // idle | listening | error
  const recognitionRef = useRef(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [{ data: n }, { data: c }] = await Promise.all([
      supabase.from('fh_notes').select('*').eq('user_id', user.id).order('created_at', { ascending: false }).limit(80),
      supabase.from('fh_contacts').select('id, name').eq('user_id', user.id).order('updated_at', { ascending: false })
    ])
    setNotes(n || [])
    setContacts(c || [])
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (searchParams.get('voice') === '1') {
      startVoice()
      searchParams.delete('voice')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function startVoice() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      setVoiceState('error')
      return
    }
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    rec.onresult = (e) => {
      let chunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        chunk += e.results[i][0].transcript
      }
      setDraft((d) => (d ? d + ' ' : '') + chunk)
    }
    rec.onend = () => setVoiceState('idle')
    rec.onerror = () => setVoiceState('error')
    rec.start()
    recognitionRef.current = rec
    setVoiceState('listening')
  }

  function stopVoice() {
    recognitionRef.current?.stop()
    setVoiceState('idle')
  }

  async function parseWithAI() {
    if (!draft.trim()) return
    setParsing(true)
    try {
      const res = await claudeMessage({
        system: SYSTEM,
        messages: [{ role: 'user', content: draft.trim() }],
        maxTokens: 700
      })
      const text = res?.content?.[0]?.text || ''
      const match = text.match(/\{[\s\S]*\}/)
      if (match) setParsed(JSON.parse(match[0]))
    } catch {
      setParsed({ summary: draft.trim().slice(0, 120), action_items: [], risks: [], materials_needed: [], follow_up_date: null })
    } finally {
      setParsing(false)
    }
  }

  async function save() {
    if (!draft.trim()) return
    if (!user) return
    setSaving(true)
    // Schema (migrations/002_full_schema.sql) has `text` column; no `parsed`
    // column exists. AI-parsed data is kept in component state until migration
    // 003_add_notes_parsed.sql is applied (optional).
    const payload = {
      user_id: user.id,
      contact_id: contactId || null,
      text: draft.trim(),
      category: 'note'
    }
    const { data, error } = await supabase.from('fh_notes').insert(payload).select().single()
    setSaving(false)
    if (!error && data) {
      setDraft('')
      setParsed(null)
      setContactId('')
      setNotes((n) => [data, ...n])
      toastSuccess('Note saved', 'Synced across devices')
    }
  }

  async function markDone(id) {
    await supabase.from('fh_notes').update({ done: true }).eq('id', id)
    setNotes((n) => n.filter((x) => x.id !== id))
  }

  async function remove(id) {
    const snapshot = notes.find((n) => n.id === id)
    const { error } = await supabase.from('fh_notes').delete().eq('id', id)
    if (error) { toastError("Couldn't delete", error.message); return }
    setNotes((n) => n.filter((x) => x.id !== id))
    toastUndo('Note deleted', {
      description: snapshot?.parsed?.summary || (snapshot?.text || '').slice(0, 60) || 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_notes').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        setNotes((n) => [snapshot, ...n])
        toastSuccess('Restored', '')
      }
    })
  }

  const listening = voiceState === 'listening'

  const { stagger, item } = useFhMotion()

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '10px 20px 10px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            Capture
          </span>
          <h1 className="fh-font-serif" style={{ margin: '4px 0 0', fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
            Notes,{' '}
            fast.
          </h1>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={listening ? stopVoice : startVoice}
          aria-label={listening ? 'Stop voice capture' : 'Start voice capture'}
          style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '10px 14px',
            borderRadius: 12,
            border: listening ? '1px solid rgba(192,57,43,0.4)' : '1px solid var(--rule)',
            background: listening ? 'rgba(192,57,43,0.14)' : 'rgba(255,255,255,0.04)',
            color: listening ? 'var(--alert-red)' : 'var(--ink-strong)',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            fontWeight: 700,
            cursor: 'pointer'
          }}
        >
          {listening ? <MicOff size={16} /> : <Mic size={16} />}
          {listening ? 'Stop' : 'Voice'}
        </motion.button>
      </motion.div>

      {/* CAPTURE */}
      <motion.div variants={item} style={{ padding: '0 20px 14px' }}>
        <div
          style={{
            position: 'relative',
            padding: 14,
            borderRadius: 18,
            background: 'rgba(255,255,255,0.03)',
            border: listening ? '1px solid rgba(192,57,43,0.35)' : '1px solid var(--rule)',
            backdropFilter: 'blur(20px)'
          }}
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={listening ? 'Listening — speak freely…' : 'Drop the field log. AI parses it for action items, risks, materials.'}
            rows={6}
            style={{ width: '100%', resize: 'vertical', minHeight: 120, background: 'transparent', border: 'none', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none' }}
          />
          {listening && (
            <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 14, marginTop: 4 }}>
              {[0, 1, 2, 3, 4].map((i) => (
                <span
                  key={i}
                  style={{
                    width: 3,
                    height: 10,
                    borderRadius: 2,
                    background: 'var(--alert-red)',
                    animation: `fh-pulse-dot 900ms ${i * 110}ms infinite ease-in-out`
                  }}
                />
              ))}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              style={{ flex: '1 1 160px', minWidth: 140, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none' }}
            >
              <option value="">No job link</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <button
              type="button"
              onClick={parseWithAI}
              disabled={!draft.trim() || parsing}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '10px 12px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: parsing || !draft.trim() ? 'var(--ink-faint)' : 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: !draft.trim() || parsing ? 'default' : 'pointer', opacity: !draft.trim() || parsing ? 0.55 : 1 }}
            >
              <Sparkles size={14} />
              {parsing ? 'Parsing…' : 'AI parse'}
            </button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={() => { hapticSuccess(); save() }}
              disabled={!draft.trim() || saving}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '10px 16px',
                borderRadius: 10,
                background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                color: 'var(--onyx)',
                fontFamily: 'var(--font-display)',
                fontSize: 14,
                letterSpacing: '0.12em',
                border: 'none',
                cursor: !draft.trim() || saving ? 'default' : 'pointer',
                boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                opacity: !draft.trim() || saving ? 0.55 : 1
              }}
            >
              {saving ? 'SAVING…' : 'SAVE NOTE'}
            </motion.button>
          </div>

          <AnimatePresence>
            {parsed && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.2 }}
                style={{ marginTop: 14, padding: 14, borderRadius: 14, background: 'linear-gradient(135deg, rgba(201,150,58,0.08), rgba(201,150,58,0.02))', border: '1px solid rgba(201,150,58,0.25)' }}
              >
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)', marginBottom: 8 }}>
                  <Sparkles size={12} />
                  AI summary
                </div>
                <p style={{ margin: 0, fontSize: 14, fontFamily: 'var(--font-body)', color: 'var(--ink-strong)' }}>{parsed.summary}</p>
                <ParsedList title="Action items" items={parsed.action_items} Icon={ClipboardCheck} tone="good" />
                <ParsedList title="Risks" items={parsed.risks} Icon={AlertTriangle} tone="warn" />
                <ParsedList title="Materials" items={parsed.materials_needed} Icon={Package} />
                {parsed.follow_up_date && (
                  <p style={{ margin: '8px 0 0', fontSize: 12, fontFamily: 'var(--font-body)', color: 'var(--ink-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <Calendar size={12} />
                    Follow up: <strong style={{ color: 'var(--field-gold-bright)' }}>{parsed.follow_up_date}</strong>
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.div>

      {/* NOTE LIST */}
      <motion.div variants={item} style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 20px 20px' }}>
        {loading && <SkeletonList rows={3} card={false} />}
        {!loading && notes.length === 0 && (
          <div style={{ padding: '32px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)', marginBottom: 4 }}>Nothing logged yet.</div>
            <div style={{ fontSize: 12 }}>Speak it. Type it. Drop it mid-drive. AI turns it into action.</div>
          </div>
        )}
        <AnimatePresence>
          {notes.map((n, i) => {
            const body = n.text || n.body || ''
            const title = n.parsed?.summary || (body.split('\n').find((l) => l.trim()) || '').slice(0, 80) || 'Untitled'
            const contact = contacts.find((c) => c.id === n.contact_id)
            const hasParsed = !!(n.parsed && (n.parsed.summary || n.parsed.action_items?.length || n.parsed.risks?.length || n.parsed.follow_up_date || n.parsed.materials_needed?.length))
            const whenShort = new Date(n.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
            const swipeActions = [
              {
                icon: <ArchiveIcon size={18} />,
                label: 'Archive note',
                color: 'rgba(45, 122, 79, 0.22)',
                fg: 'var(--signal-green)',
                onClick: () => { hapticSuccess(); markDone(n.id) }
              },
              {
                icon: <TrashIcon size={18} />,
                label: 'Delete note',
                color: 'rgba(192, 57, 43, 0.18)',
                fg: 'var(--alert-red)',
                onClick: () => { hapticTap(); remove(n.id) }
              }
            ]
            return (
              <SwipeableRow key={n.id} actions={swipeActions} openOffset={-100}>
              <motion.article
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, delay: Math.min(i * 0.04, 0.25), ease: [0.2, 0.8, 0.2, 1] }}
                whileHover={{ boxShadow: '0 0 24px rgba(201,150,58,0.18), 0 0 0 1px rgba(201,150,58,0.25)' }}
                className="fh-note-card fh-card-raised"
                style={{
                  position: 'relative',
                  overflow: 'hidden',
                  padding: '14px 16px 14px 20px',
                  borderRadius: 14,
                  background: 'linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.02) 100%)',
                  border: '1px solid var(--rule)'
                }}
              >
                {/* gold accent bar on the left edge */}
                <span
                  aria-hidden="true"
                  style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: '0 3px 3px 0', background: 'linear-gradient(180deg, var(--field-gold-bright), var(--field-gold-deep))', boxShadow: '0 0 10px rgba(201,150,58,0.35)' }}
                />

                {/* top-right: timestamp + delete */}
                <span style={{ position: 'absolute', top: 12, right: 12, display: 'inline-flex', alignItems: 'center', gap: 4, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--steel, #5C5C5C)' }}>
                  {whenShort}
                </span>
                <button
                  type="button"
                  onClick={() => remove(n.id)}
                  aria-label="Delete note"
                  className="fh-note-card__del"
                  style={{
                    position: 'absolute',
                    top: 10,
                    right: 50,
                    width: 24,
                    height: 24,
                    borderRadius: 6,
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--ink-faint)',
                    cursor: 'pointer',
                    display: 'grid',
                    placeItems: 'center',
                    opacity: 0.4,
                    transition: 'opacity 160ms ease, color 160ms ease'
                  }}
                  onMouseEnter={(ev) => { ev.currentTarget.style.opacity = '1'; ev.currentTarget.style.color = 'var(--alert-red)' }}
                  onMouseLeave={(ev) => { ev.currentTarget.style.opacity = '0.4'; ev.currentTarget.style.color = 'var(--ink-faint)' }}
                >
                  <Trash2 size={13} />
                </button>

                {/* title row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 88, marginBottom: body && body !== title ? 6 : 0 }}>
                  <h3 style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 15, fontWeight: 600, color: 'var(--ink-strong)', lineHeight: 1.35, overflowWrap: 'anywhere' }}>
                    {title}
                  </h3>
                  {hasParsed && (
                    <span style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, background: 'rgba(201,150,58,0.14)', border: '1px solid rgba(201,150,58,0.35)', color: 'var(--field-gold-bright)', fontFamily: 'var(--font-display)', fontSize: 9, letterSpacing: '0.14em' }}>
                      <Sparkles size={10} />
                      AI
                    </span>
                  )}
                </div>

                {/* body preview (hidden if title IS the whole body) */}
                {body && body !== title && (
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{body}</p>
                )}

                {/* linked-job chip */}
                {contact?.name && (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 10, padding: '3px 9px', borderRadius: 999, background: 'rgba(201,150,58,0.1)', border: '1px solid rgba(201,150,58,0.28)', color: 'var(--field-gold-bright)', fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    <Briefcase size={10} />
                    {contact.name}
                  </span>
                )}

                {n.parsed?.action_items?.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 12, color: 'var(--ink-strong)', fontFamily: 'var(--font-body)' }}>
                    {n.parsed.action_items.map((it, j) => <li key={j} style={{ marginBottom: 2 }}>{it}</li>)}
                  </ul>
                )}
              </motion.article>
              </SwipeableRow>
            )
          })}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  )
}

function ParsedList({ title, items, Icon, tone }) {
  if (!items || items.length === 0) return null
  const color = tone === 'warn' ? 'var(--alert-red)' : tone === 'good' ? 'var(--signal-green)' : 'var(--ink-muted)'
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color, marginBottom: 4 }}>
        {Icon && <Icon size={11} />}
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: 'var(--ink-strong)', fontFamily: 'var(--font-body)' }}>
        {items.map((it, i) => <li key={i} style={{ marginBottom: 2 }}>{it}</li>)}
      </ul>
    </div>
  )
}
