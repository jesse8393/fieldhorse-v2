import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import {
  FileText, Briefcase, Mic, MicOff, Sparkles, Trash2,
  AlertTriangle, ClipboardCheck, Package, Calendar, Clock,
  ChevronRight, Activity
} from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { claudeMessage } from '../lib/anthropic.js'
import { toastSuccess, toastUndo, toastError } from '../lib/toast.js'
import { hapticTap, hapticSuccess } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'
import SwipeableRow from '../components/SwipeableRow.jsx'
import { Archive as ArchiveIcon } from 'lucide-react'
import SectionHeader from '../components/v3/SectionHeader.jsx'

const SYSTEM = `You are Fieldhorse, a construction operations AI. You receive rough field notes dictated or typed by a contractor from a jobsite. Parse them into structured JSON with fields: summary (one sentence), action_items (array of strings with owners if mentioned), risks (array), materials_needed (array), follow_up_date (ISO date if mentioned or null). Return ONLY JSON, no prose.`

/* ============================================================
   FIELDHORSE NOTES — v3 COMMAND HUB
   Top-down structure:
     1. Header (eyebrow + Notes, fast. + voice toggle)
     2. CAPTURE — premium textarea inside .v3-section, gold-accented.
        Job link select / AI parse / Save in one row. AI summary + error
        states expand inline.
     3. RECENT ACTIVITY — chronological feed of latest notes as cards.
        Title (parsed summary or first line) → preview body → metadata.
     4. LINKED TO JOBS — notes with a contact_id, grouped by job. Each
        group is a sub-zone with the job name as a header.
     5. ACTION ITEMS — aggregated parsed.action_items across all notes.
        Placeholder copy if no parsed data yet.
   All sections use the .v3-section primitive (depth + framing).
   ============================================================ */

export default function Notes() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [notes, setNotes] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [contactId, setContactId] = useState('')
  const [contacts, setContacts] = useState([])
  const [saving, setSaving] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState(null)
  const [parseError, setParseError] = useState('')
  const [voiceState, setVoiceState] = useState('idle') // idle | listening | error
  const [focused, setFocused] = useState(false)
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
    setParseError('')
    try {
      const res = await claudeMessage({
        system: SYSTEM,
        messages: [{ role: 'user', content: draft.trim() }],
        maxTokens: 700
      })
      const text = res?.content?.[0]?.text || ''
      const match = text.match(/\{[\s\S]*\}/)
      if (!match) throw new Error('AI returned no structured response')
      const obj = JSON.parse(match[0])
      setParsed(obj)
    } catch (e) {
      console.error('[notes] parse failed:', e)
      setParsed(null)
      const msg = String(e?.message || '').toLowerCase()
      if (msg.includes('missing_api_key') || msg.includes('500')) {
        setParseError('AI not configured. Set ANTHROPIC_API_KEY in your Netlify env vars to enable parsing.')
      } else if (msg.includes('failed to fetch') || msg.includes('404')) {
        setParseError('AI endpoint unreachable.')
      } else {
        setParseError(e?.message || 'AI parse failed.')
      }
    } finally {
      setParsing(false)
    }
  }

  async function save() {
    if (!draft.trim()) return
    if (!user) return
    setSaving(true)
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

  /* ───────── DATA SHAPING ───────── */

  // Recent Activity = top 6 chronologically, regardless of linkage
  const recent = useMemo(() => notes.slice(0, 6), [notes])

  // Linked to Jobs = notes WITH contact_id, grouped by contact name
  const linkedGroups = useMemo(() => {
    const linked = notes.filter((n) => n.contact_id)
    const map = new Map()
    for (const n of linked) {
      const key = n.contact_id
      if (!map.has(key)) {
        const c = contacts.find((x) => x.id === key)
        map.set(key, { contactId: key, name: c?.name || 'Unknown job', items: [] })
      }
      map.get(key).items.push(n)
    }
    return Array.from(map.values())
  }, [notes, contacts])

  // Action Items = aggregate parsed.action_items across all notes
  const actionItems = useMemo(() => {
    const out = []
    for (const n of notes) {
      const items = n?.parsed?.action_items
      if (Array.isArray(items)) {
        for (const txt of items) {
          out.push({ noteId: n.id, contactId: n.contact_id, text: txt, when: n.created_at })
        }
      }
    }
    return out.slice(0, 10)
  }, [notes])

  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {/* ─────────── HEADER ─────────── */}
      <motion.div
        variants={item}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          padding: '12px 20px 18px'
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)' }}>Capture</span>
          <h1 className="v3-h1" style={{ marginTop: 6 }}>
            Notes, <em>fast.</em>
          </h1>
          <div className="v3-caption" style={{ marginTop: 6 }}>
            Speak it, type it, drop it mid-drive. AI turns it into action.
          </div>
        </div>

        <VoiceButton listening={listening} onStart={startVoice} onStop={stopVoice} />
      </motion.div>

      {/* ─────────── CAPTURE ─────────── */}
      <motion.div
        variants={item}
        className="v3-section"
        style={{
          margin: '0 var(--v3-gutter) var(--v3-rhythm-screen)',
          // gold-tinted border bump on focus or listening — capture is the
          // primary tool, the container reflects that with state.
          borderColor: listening
            ? 'rgba(192, 57, 43, 0.40)'
            : focused
              ? 'rgba(212, 175, 55, 0.32)'
              : 'var(--v3-section-border)',
          transition: 'border-color 200ms ease, box-shadow 200ms ease',
          boxShadow: focused
            ? '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 8px 28px rgba(212, 175, 55, 0.12), 0 1px 2px rgba(0, 0, 0, 0.20)'
            : 'var(--v3-section-shadow)'
        }}
      >
        <textarea
          className="fh-notes-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={listening ? 'Listening — speak freely…' : 'Drop the field log. AI parses it for action items, risks, materials.'}
          rows={5}
          style={{
            width: '100%',
            resize: 'vertical',
            minHeight: 110,
            background: 'transparent',
            border: 'none',
            color: 'var(--v3-text)',
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            lineHeight: 1.55,
            outline: 'none',
            padding: 0
          }}
        />

        {/* Listening pulse */}
        {listening && (
          <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 14, marginTop: 6 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                style={{
                  width: 3,
                  height: 10,
                  borderRadius: 2,
                  background: 'var(--v3-danger)',
                  animation: `fh-pulse-dot 900ms ${i * 110}ms infinite ease-in-out`
                }}
              />
            ))}
          </div>
        )}

        {/* Action row: link select / AI parse / Save */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flexWrap: 'wrap',
          marginTop: 14,
          paddingTop: 14,
          borderTop: '1px solid var(--v3-border)'
        }}>
          <select
            value={contactId}
            onChange={(e) => setContactId(e.target.value)}
            aria-label="Link this note to a job"
            style={{
              flex: '1 1 180px',
              minWidth: 160,
              padding: '10px 12px',
              borderRadius: 10,
              background: 'var(--v3-surface-2)',
              border: '1px solid var(--v3-border-strong)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              outline: 'none',
              cursor: 'pointer'
            }}
          >
            <option value="">No job link</option>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>

          <button
            type="button"
            onClick={parseWithAI}
            disabled={!draft.trim() || parsing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 13px',
              borderRadius: 10,
              background: !draft.trim() || parsing ? 'var(--v3-surface-2)' : 'var(--v3-primary-soft)',
              border: !draft.trim() || parsing ? '1px solid var(--v3-border)' : '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
              color: !draft.trim() || parsing ? 'var(--v3-text-muted)' : 'var(--v3-primary)',
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: 600,
              cursor: !draft.trim() || parsing ? 'default' : 'pointer',
              opacity: !draft.trim() || parsing ? 0.7 : 1,
              transition: 'background 160ms ease, border-color 160ms ease, color 160ms ease'
            }}
          >
            <Sparkles size={14} />
            {parsing ? 'Parsing…' : 'AI parse'}
          </button>

          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => { hapticSuccess(); save() }}
            disabled={!draft.trim() || saving}
            className="v3-btn v3-btn--primary v3-btn--sm"
            style={{
              opacity: !draft.trim() || saving ? 0.55 : 1,
              cursor: !draft.trim() || saving ? 'default' : 'pointer'
            }}
          >
            {saving ? 'Saving…' : 'Save Note'}
          </motion.button>
        </div>

        {/* Parse error */}
        {parseError && !parsed && (
          <div
            role="alert"
            style={{
              marginTop: 12,
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--v3-danger-soft)',
              border: '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 12.5,
              lineHeight: 1.5
            }}
          >
            <span style={{ fontWeight: 700, color: 'var(--v3-danger-bright)' }}>AI parse unavailable. </span>
            <span style={{ color: 'var(--v3-text-muted)' }}>{parseError} You can still save the note as-is.</span>
          </div>
        )}

        {/* AI summary preview (before save) */}
        <AnimatePresence>
          {parsed && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.2 }}
              style={{
                marginTop: 14,
                padding: 14,
                borderRadius: 14,
                background: 'linear-gradient(135deg, rgba(212, 175, 55, 0.10), rgba(212, 175, 55, 0.02))',
                border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)'
              }}
            >
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                <Sparkles size={12} color="var(--v3-primary)" />
                <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)' }}>AI Summary</span>
              </div>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                {parsed.summary}
              </p>
              <ParsedList title="Action items" items={parsed.action_items} Icon={ClipboardCheck} tone="good" />
              <ParsedList title="Risks" items={parsed.risks} Icon={AlertTriangle} tone="warn" />
              <ParsedList title="Materials" items={parsed.materials_needed} Icon={Package} />
              {parsed.follow_up_date && (
                <p style={{ margin: '10px 0 0', fontSize: 12, fontFamily: 'var(--font-body)', color: 'var(--v3-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  <Calendar size={12} />
                  Follow up: <strong style={{ color: 'var(--v3-primary)' }}>{parsed.follow_up_date}</strong>
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ─────────── RECENT ACTIVITY ─────────── */}
      <motion.div
        variants={item}
        className="v3-section"
        style={{ margin: '0 var(--v3-gutter) var(--v3-rhythm-screen)' }}
      >
        <SectionHeader label="Recent Activity" />

        {loading ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            {[0, 1, 2].map((i) => (
              <div key={i} className="v3-skeleton" style={{ height: 76, borderRadius: 14, opacity: 1 - i * 0.2 }} />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="v3-empty" style={{ marginTop: 4 }}>
            <Activity size={22} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
              Nothing logged yet.
            </div>
            <div style={{ fontSize: 12 }}>Use the capture above. Voice or type — both work.</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
            <AnimatePresence>
              {recent.map((n, i) => (
                <NoteCard
                  key={n.id}
                  note={n}
                  contacts={contacts}
                  index={i}
                  onArchive={() => { hapticSuccess(); markDone(n.id) }}
                  onDelete={() => { hapticTap(); remove(n.id) }}
                  onTap={() => {
                    if (n.contact_id) navigate(`/jobs/${n.contact_id}`)
                  }}
                />
              ))}
            </AnimatePresence>
          </div>
        )}
      </motion.div>

      {/* ─────────── LINKED TO JOBS ─────────── */}
      {!loading && linkedGroups.length > 0 && (
        <motion.div
          variants={item}
          className="v3-section"
          style={{ margin: '0 var(--v3-gutter) var(--v3-rhythm-screen)' }}
        >
          <SectionHeader label="Linked to Jobs" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 18, marginTop: 4 }}>
            {linkedGroups.map((g) => (
              <div key={g.contactId}>
                {/* Job group header — tappable, navigates to the job */}
                <button
                  type="button"
                  onClick={() => { hapticTap(); navigate(`/jobs/${g.contactId}`) }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '10px 12px',
                    marginBottom: 8,
                    borderRadius: 12,
                    background: 'var(--v3-surface-2)',
                    border: '1px solid var(--v3-border)',
                    color: 'var(--v3-text)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)'
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: 8,
                      background: 'var(--v3-primary-soft)',
                      border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
                      display: 'grid', placeItems: 'center', flexShrink: 0
                    }}>
                      <Briefcase size={14} color="var(--v3-primary)" />
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.name}
                    </span>
                    <span style={{
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.10em', textTransform: 'uppercase',
                      color: 'var(--v3-text-muted)', flexShrink: 0
                    }}>
                      {g.items.length} {g.items.length === 1 ? 'note' : 'notes'}
                    </span>
                  </span>
                  <ChevronRight size={16} color="var(--v3-text-muted)" />
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {g.items.slice(0, 3).map((n, i) => (
                    <NoteCard
                      key={n.id}
                      note={n}
                      contacts={contacts}
                      index={i}
                      hideJobChip
                      onArchive={() => { hapticSuccess(); markDone(n.id) }}
                      onDelete={() => { hapticTap(); remove(n.id) }}
                      onTap={() => navigate(`/jobs/${g.contactId}`)}
                    />
                  ))}
                  {g.items.length > 3 && (
                    <button
                      type="button"
                      onClick={() => navigate(`/jobs/${g.contactId}`)}
                      className="v3-section-link"
                      style={{ alignSelf: 'flex-start', marginLeft: 4 }}
                    >
                      View all {g.items.length} on job →
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      )}

      {/* ─────────── ACTION ITEMS (AI) ───────────
          Surfaces the parsed action items across all notes as a single
          actionable list. If no notes have been parsed yet, render a
          placeholder so the section's purpose is visible. */}
      <motion.div
        variants={item}
        className="v3-section v3-section--quiet"
        style={{ margin: '0 var(--v3-gutter) 40px' }}
      >
        <div className="v3-section-header">
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Sparkles size={14} color="var(--v3-primary)" />
            <span className="v3-eyebrow">AI Action Items</span>
          </span>
        </div>

        {actionItems.length === 0 ? (
          <div className="v3-empty" style={{ marginTop: 4 }}>
            <ClipboardCheck size={22} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
              No action items yet.
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              Tap <strong style={{ color: 'var(--v3-primary)' }}>AI parse</strong> on a note above to extract action items, risks, and materials.
            </div>
          </div>
        ) : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
            {actionItems.map((a, i) => {
              const c = contacts.find((x) => x.id === a.contactId)
              return (
                <li
                  key={`${a.noteId}-${i}`}
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    gap: 10,
                    padding: '10px 12px',
                    borderRadius: 10,
                    background: 'var(--v3-surface)',
                    border: '1px solid var(--v3-border)'
                  }}
                >
                  <span style={{
                    flexShrink: 0,
                    marginTop: 2,
                    width: 16, height: 16, borderRadius: 4,
                    background: 'var(--v3-primary-soft)',
                    border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
                    display: 'grid', placeItems: 'center'
                  }}>
                    <ClipboardCheck size={10} color="var(--v3-primary)" />
                  </span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{
                      fontSize: 13,
                      color: 'var(--v3-text)',
                      fontFamily: 'var(--font-body)',
                      lineHeight: 1.45,
                      overflowWrap: 'anywhere'
                    }}>
                      {a.text}
                    </div>
                    {c?.name && (
                      <div style={{ marginTop: 4, fontSize: 11, color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)' }}>
                        From {c.name}
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </motion.div>
    </motion.div>
  )
}

/* ============================================================
   VoiceButton — capture-on/off toggle. Listening state turns the
   button danger-red so the operator can spot it from the corner.
   ============================================================ */
function VoiceButton({ listening, onStart, onStop }) {
  return (
    <motion.button
      type="button"
      whileTap={{ scale: 0.96 }}
      onClick={listening ? onStop : onStart}
      aria-label={listening ? 'Stop voice capture' : 'Start voice capture'}
      style={{
        flexShrink: 0,
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        padding: '11px 14px',
        borderRadius: 12,
        border: listening
          ? '1px solid color-mix(in srgb, var(--v3-danger) 50%, transparent)'
          : '1px solid var(--v3-border-strong)',
        background: listening ? 'var(--v3-danger-soft)' : 'var(--v3-surface)',
        color: listening ? 'var(--v3-danger-bright)' : 'var(--v3-text)',
        fontFamily: 'var(--font-body)',
        fontSize: 13,
        fontWeight: 700,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: listening
          ? '0 0 0 4px color-mix(in srgb, var(--v3-danger) 12%, transparent)'
          : '0 1px 0 rgba(255, 255, 255, 0.04) inset, 0 4px 12px rgba(0, 0, 0, 0.20)'
      }}
    >
      {listening ? <MicOff size={16} /> : <Mic size={16} />}
      {listening ? 'Stop' : 'Voice'}
    </motion.button>
  )
}

/* ============================================================
   NoteCard — single note as a card (not a row). Hierarchy:
     1. Title (parsed summary OR first non-empty line, max 80ch)
     2. Body preview (only if distinct from title; 3-line clamp)
     3. Footer metadata: linked job chip / action-item count / time
   Card has gold spine on the left (slightly stronger if AI-parsed),
   subtle hover lift, swipe actions for archive/delete on mobile.
   ============================================================ */
function NoteCard({ note, contacts, index = 0, hideJobChip = false, onTap, onArchive, onDelete }) {
  const body = note.text || note.body || ''
  const firstLine = (body.split('\n').find((l) => l.trim()) || '').trim()
  const title = note.parsed?.summary || firstLine.slice(0, 90) || 'Untitled note'
  const showBodyBelow = body && body.trim() !== title.trim()
  const contact = contacts.find((c) => c.id === note.contact_id)
  const hasParsed = !!(note.parsed && (
    note.parsed.summary ||
    note.parsed.action_items?.length ||
    note.parsed.risks?.length ||
    note.parsed.follow_up_date ||
    note.parsed.materials_needed?.length
  ))
  const hasRisk = !!note.parsed?.risks?.length
  const actionCount = note.parsed?.action_items?.length || 0
  const when = formatRelativeTime(note.created_at)

  // Spine color: red if risks, gold if AI-parsed, neutral otherwise
  const spine = hasRisk
    ? 'linear-gradient(180deg, var(--v3-danger), color-mix(in srgb, var(--v3-danger) 40%, transparent))'
    : hasParsed
      ? 'linear-gradient(180deg, var(--v3-primary), color-mix(in srgb, var(--v3-primary) 35%, transparent))'
      : 'linear-gradient(180deg, rgba(255, 255, 255, 0.18), rgba(255, 255, 255, 0.04))'

  const swipeActions = [
    {
      icon: <ArchiveIcon size={18} />,
      label: 'Archive note',
      color: 'rgba(46, 204, 113, 0.18)',
      fg: 'var(--v3-success-bright)',
      onClick: onArchive
    },
    {
      icon: <Trash2 size={18} />,
      label: 'Delete note',
      color: 'rgba(192, 57, 43, 0.18)',
      fg: 'var(--v3-danger-bright)',
      onClick: onDelete
    }
  ]

  return (
    <SwipeableRow actions={swipeActions} openOffset={-100}>
      <motion.article
        layout
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.22, delay: Math.min(index * 0.04, 0.20), ease: [0.2, 0.8, 0.2, 1] }}
        whileHover={{ y: -2 }}
        onClick={onTap}
        role={onTap ? 'button' : 'article'}
        tabIndex={onTap ? 0 : undefined}
        style={{
          position: 'relative',
          overflow: 'hidden',
          padding: '14px 14px 14px 18px',
          borderRadius: 14,
          background: 'var(--v3-surface)',
          border: '1px solid var(--v3-border-strong)',
          boxShadow: '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 4px 14px rgba(0, 0, 0, 0.30)',
          cursor: onTap ? 'pointer' : 'default',
          WebkitTapHighlightColor: 'transparent',
          transition: 'border-color 200ms ease, box-shadow 200ms ease, background-color 200ms ease'
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.30)'
          e.currentTarget.style.background = 'var(--v3-surface-3)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.borderColor = 'var(--v3-border-strong)'
          e.currentTarget.style.background = 'var(--v3-surface)'
        }}
      >
        {/* Spine — left edge accent */}
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0, top: 10, bottom: 10,
            width: 3,
            borderRadius: '0 3px 3px 0',
            background: spine,
            boxShadow: hasParsed && !hasRisk ? '0 0 8px rgba(212, 175, 55, 0.30)' : 'none'
          }}
        />

        {/* Header row: title + (AI badge) + timestamp */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3
              style={{
                margin: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 15,
                fontWeight: 600,
                color: 'var(--v3-text)',
                lineHeight: 1.35,
                overflowWrap: 'anywhere',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap'
              }}
            >
              {title}
              {hasParsed && (
                <span style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  padding: '2px 7px',
                  borderRadius: 999,
                  background: 'var(--v3-primary-soft)',
                  border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
                  color: 'var(--v3-primary)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 9,
                  letterSpacing: '0.14em'
                }}>
                  <Sparkles size={9} />
                  AI
                </span>
              )}
            </h3>
          </div>
          <span style={{
            flexShrink: 0,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            color: 'var(--v3-text-muted)',
            whiteSpace: 'nowrap'
          }}>
            <Clock size={11} />
            {when}
          </span>
        </div>

        {/* Body preview — clamped to 3 lines */}
        {showBodyBelow && (
          <p style={{
            margin: '6px 0 0',
            fontSize: 13,
            color: 'var(--v3-text-muted)',
            fontFamily: 'var(--font-body)',
            lineHeight: 1.5,
            overflowWrap: 'anywhere',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden'
          }}>
            {body}
          </p>
        )}

        {/* Footer metadata */}
        {(!hideJobChip && contact?.name) || actionCount > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {!hideJobChip && contact?.name && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 9px',
                borderRadius: 999,
                background: 'var(--v3-primary-soft)',
                border: '1px solid color-mix(in srgb, var(--v3-primary) 28%, transparent)',
                color: 'var(--v3-primary)',
                fontFamily: 'var(--font-body)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase'
              }}>
                <Briefcase size={10} />
                {contact.name}
              </span>
            )}
            {actionCount > 0 && (
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '3px 9px',
                borderRadius: 999,
                background: 'var(--v3-success-soft)',
                border: '1px solid color-mix(in srgb, var(--v3-success) 30%, transparent)',
                color: 'var(--v3-success-bright)',
                fontFamily: 'var(--font-body)',
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.06em',
                textTransform: 'uppercase'
              }}>
                <ClipboardCheck size={10} />
                {actionCount} {actionCount === 1 ? 'action' : 'actions'}
              </span>
            )}
          </div>
        ) : null}
      </motion.article>
    </SwipeableRow>
  )
}

/* ============================================================
   ParsedList — used inside the inline AI Summary card. One row
   per item type (action_items, risks, materials).
   ============================================================ */
function ParsedList({ title, items, Icon, tone }) {
  if (!items || items.length === 0) return null
  const color = tone === 'warn'
    ? 'var(--v3-danger-bright)'
    : tone === 'good'
      ? 'var(--v3-success-bright)'
      : 'var(--v3-text-muted)'
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        marginBottom: 6,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color
      }}>
        {Icon ? <Icon size={11} /> : null}
        {title}
      </div>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 13, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
        {items.map((it, i) => <li key={i} style={{ marginBottom: 2 }}>{it}</li>)}
      </ul>
    </div>
  )
}

/* ============================================================
   formatRelativeTime — "Just now", "2h ago", "Yesterday",
   "Apr 24" / "Apr 24, 2025" depending on age. Used in NoteCard.
   ============================================================ */
function formatRelativeTime(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - d.getTime()
  const diffMin = Math.floor(diffMs / 60000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffH = Math.floor(diffMin / 60)
  if (diffH < 24) return `${diffH}h ago`
  const diffD = Math.floor(diffH / 24)
  if (diffD === 1) return 'Yesterday'
  if (diffD < 7) return `${diffD}d ago`
  const sameYear = d.getFullYear() === now.getFullYear()
  return d.toLocaleDateString(undefined, sameYear
    ? { month: 'short', day: 'numeric' }
    : { month: 'short', day: 'numeric', year: 'numeric' })
}
