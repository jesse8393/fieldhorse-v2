import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { FileText, Phone, Calendar, Mail, MessageSquare, Package, ClipboardCheck, Mic, MicOff, Sparkles, Trash2, AlertTriangle } from 'lucide-react'
import { SkeletonList } from '../components/Skeleton.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { claudeMessage } from '../lib/anthropic.js'
import { toastSuccess } from '../lib/toast.js'

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

  async function remove(id) {
    await supabase.from('fh_notes').delete().eq('id', id)
    setNotes((n) => n.filter((x) => x.id !== id))
  }

  const listening = voiceState === 'listening'

  const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.08 } } }
  const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 220, damping: 26 } } }

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '20px 20px 10px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            Capture
          </span>
          <h1 className="fh-font-serif" style={{ margin: '4px 0 0', fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
            Notes,{' '}
            <em className="fh-font-serif-italic fh-text-gradient-gold">fast.</em>
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
              onClick={save}
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
            const NoteIcon = iconForNote(n)
            const tone = iconTone(n)
            return (
              <motion.article
                key={n.id}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.22, delay: Math.min(i * 0.04, 0.25), ease: [0.2, 0.8, 0.2, 1] }}
                style={{ position: 'relative', padding: '12px 14px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)', backdropFilter: 'blur(20px)' }}
              >
                <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 8 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span
                      aria-hidden="true"
                      style={{ width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: tone.bg, border: `1px solid ${tone.border}`, color: tone.fg, flexShrink: 0 }}
                    >
                      <NoteIcon size={14} />
                    </span>
                    <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {new Date(n.created_at).toLocaleString()}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(n.id)}
                    aria-label="Delete note"
                    style={{ width: 28, height: 28, borderRadius: 8, background: 'transparent', border: 'none', color: 'var(--ink-faint)', cursor: 'pointer', display: 'grid', placeItems: 'center' }}
                  >
                    <Trash2 size={14} />
                  </button>
                </header>
                {n.parsed?.summary && (
                  <p style={{ margin: '0 0 6px', fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)', fontFamily: 'var(--font-body)' }}>{n.parsed.summary}</p>
                )}
                <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', whiteSpace: 'pre-wrap' }}>{n.text || n.body || ''}</p>
                {n.parsed?.action_items?.length > 0 && (
                  <ul style={{ margin: '8px 0 0', paddingLeft: 16, fontSize: 12, color: 'var(--ink-strong)', fontFamily: 'var(--font-body)' }}>
                    {n.parsed.action_items.map((it, j) => <li key={j} style={{ marginBottom: 2 }}>{it}</li>)}
                  </ul>
                )}
              </motion.article>
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
