import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/icons/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SkeletonList } from '../components/Skeleton.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { claudeMessage } from '../lib/anthropic.js'

const SYSTEM = `You are Fieldhorse, a construction operations AI. You receive rough field notes dictated or typed by a contractor from a jobsite. Parse them into structured JSON with fields: summary (one sentence), action_items (array of strings with owners if mentioned), risks (array), materials_needed (array), follow_up_date (ISO date if mentioned or null). Return ONLY JSON, no prose.`

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
    setSaving(true)
    const payload = {
      user_id: user.id,
      contact_id: contactId || null,
      body: draft.trim(),
      parsed: parsed || null
    }
    const { data, error } = await supabase.from('fh_notes').insert(payload).select().single()
    setSaving(false)
    if (!error && data) {
      setDraft('')
      setParsed(null)
      setContactId('')
      setNotes((n) => [data, ...n])
    }
  }

  async function remove(id) {
    await supabase.from('fh_notes').delete().eq('id', id)
    setNotes((n) => n.filter((x) => x.id !== id))
  }

  return (
    <section className="fh-page">
      <header className="fh-page__head">
        <div>
          <span className="fh-sec-tag">
            <span className="fh-sec-tag__label">Capture</span>
          </span>
          <h1 className="fh-page__title">Notes</h1>
        </div>
        {voiceState === 'listening' ? (
          <button type="button" className="fh-btn fh-btn--danger" onClick={stopVoice}>
            <Icon name="mic" size={18} />
            Stop
          </button>
        ) : (
          <button type="button" className="fh-btn fh-btn--ghost" onClick={startVoice}>
            <Icon name="mic" size={18} />
            Voice
          </button>
        )}
      </header>

      <div className="fh-capture">
        <textarea
          className="fh-capture__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={voiceState === 'listening' ? 'Listening — speak freely…' : 'Drop the field log. AI parses it for action items, risks, materials.'}
          rows={6}
        />
        {voiceState === 'listening' && (
          <div className="fh-capture__live" aria-hidden="true">
            <span /><span /><span /><span /><span />
          </div>
        )}
        <div className="fh-capture__row">
          <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="fh-capture__select">
            <option value="">No job link</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <button type="button" className="fh-btn fh-btn--ghost" onClick={parseWithAI} disabled={!draft.trim() || parsing}>
            <Icon name="ai" size={16} />
            {parsing ? 'Parsing…' : 'AI parse'}
          </button>
          <button type="button" className="fh-btn fh-btn--gold" onClick={save} disabled={!draft.trim() || saving}>
            {saving ? 'Saving…' : 'Save note'}
          </button>
        </div>

        <AnimatePresence>
          {parsed && (
            <motion.div
              className="fh-parsed"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
            >
              <header className="fh-parsed__head">
                <span className="fh-eye">AI summary</span>
              </header>
              <p className="fh-parsed__sum">{parsed.summary}</p>
              <ParsedList title="Action items" items={parsed.action_items} />
              <ParsedList title="Risks" items={parsed.risks} variant="warn" />
              <ParsedList title="Materials" items={parsed.materials_needed} />
              {parsed.follow_up_date && <p className="fh-parsed__date">Follow up: <strong>{parsed.follow_up_date}</strong></p>}
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <div className="fh-list">
        {loading && <SkeletonList rows={3} card={false} />}
        {!loading && notes.length === 0 && (
          <EmptyState
            icon="note"
            code="LOG · EMPTY"
            title="Nothing logged yet."
            sub="Speak it. Type it. Drop it mid-drive. AI turns it into action."
          />
        )}
        <AnimatePresence>
          {notes.map((n, i) => (
            <motion.article
              key={n.id}
              layout
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.18, delay: Math.min(i * 0.02, 0.2) }}
              className="fh-note"
            >
              <header className="fh-note__head">
                <span className="fh-eye">{new Date(n.created_at).toLocaleString()}</span>
                <button type="button" className="fh-iconbtn" onClick={() => remove(n.id)} aria-label="Delete note">
                  <Icon name="trash" size={14} />
                </button>
              </header>
              {n.parsed?.summary && <p className="fh-note__sum">{n.parsed.summary}</p>}
              <p className="fh-note__body">{n.body}</p>
              {n.parsed?.action_items?.length > 0 && (
                <ul className="fh-note__list">
                  {n.parsed.action_items.map((it, j) => <li key={j}>{it}</li>)}
                </ul>
              )}
            </motion.article>
          ))}
        </AnimatePresence>
      </div>
    </section>
  )
}

function ParsedList({ title, items, variant }) {
  if (!items || items.length === 0) return null
  return (
    <div className={`fh-parsed__block${variant ? ` fh-parsed__block--${variant}` : ''}`}>
      <span className="fh-eye">{title}</span>
      <ul>
        {items.map((it, i) => <li key={i}>{it}</li>)}
      </ul>
    </div>
  )
}
