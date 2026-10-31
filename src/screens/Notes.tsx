import RecordPicker from '../components/RecordPicker.tsx'
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion'
import {
  FileText, Briefcase, Mic, MicOff, Sparkles, Trash2,
  AlertTriangle, ClipboardCheck, Package, Calendar, Clock,
  ChevronRight, Activity
} from 'lucide-react'
import { supabase } from '../lib/supabase.ts'
import { useNotesBundle, notesKey } from '../lib/queries.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { claudeMessage } from '../lib/anthropic.ts'
import { toastSuccess, toastUndo, toastError, toastInfo } from '../lib/toast.ts'
import { speechErrorFeedback } from '../lib/speech.ts'
import { hapticTap, hapticSuccess } from '../lib/haptics.ts'
import { canHover } from '../lib/hover.ts'
import { resilientInsert } from '../lib/outbox.ts'
import { useFhMotion } from '../lib/motion.ts'
import SwipeableRow from '../components/SwipeableRow.tsx'
import { Archive as ArchiveIcon } from 'lucide-react'
import SectionHeader from '../components/v3/SectionHeader.tsx'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import { useSecondTap } from '../lib/secondTap.ts'
import { Eyebrow } from '../components/v3'
import DataErrorState from '../components/DataErrorState.tsx'
import { SkeletonRows } from '../components/fh'
import { keepFocusOnRetry } from '../lib/retryFocus.ts'
import { filterReports, reportJobLabel, reportStats } from '../lib/reportHistory.ts'
import ReportDetails from '../components/ReportDetails.tsx'
const SnowNotes = lazy(() => import('../components/desktop/SnowNotesBuild.tsx'))

const SYSTEM = `You are Fieldhorse, a construction operations AI. You receive rough field notes dictated or typed by a contractor from a jobsite. Parse them into structured JSON with fields: summary (one sentence), action_items (array of strings with owners if mentioned), risks (array), materials_needed (array), follow_up_date (ISO date if mentioned or null). Return ONLY JSON, no prose.`

/* ============================================================
   FIELDHORSE NOTES, v3 COMMAND HUB
   Top-down structure:
     1. Header (eyebrow + Notes, fast. + voice toggle)
     2. CAPTURE, premium textarea inside .v3-section, gold-accented.
        Job link select / AI parse / Save in one row. AI summary + error
        states expand inline.
     3. RECENT ACTIVITY, chronological feed of latest notes as cards.
        Title (parsed summary or first line) → preview body → metadata.
     4. LINKED TO JOBS, notes with a contact_id, grouped by job. Each
        group is a sub-zone with the job name as a header.
     5. ACTION ITEMS, aggregated parsed.action_items across all notes.
        Placeholder copy if no parsed data yet.
   All sections use the .v3-section primitive (depth + framing).
   ============================================================ */

export default function Notes() {
  // The listening bars pulse forever; people who ask for reduced motion
  // get still bars (the mic button already shows the listening state).
  const reduceMotion = useReducedMotion()
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  // isPending, not isLoading, so nothing reads as empty before the first
  // read lands; isError, so a failed read is never "All clear".
  const { data: bundle, isPending: loading, isError, refetch, contactsReady, contactsError, retryContacts } = useNotesBundle(user?.id)
  const notes = useMemo(() => bundle?.notes ?? [], [bundle?.notes])
  const contacts = useMemo(() => bundle?.contacts ?? [], [bundle?.contacts])
  const [draft, setDraft] = useState('')
  const [contactId, setContactId] = useState('')
  const [saving, setSaving] = useState(false)
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<any>(null)
  const [parseError, setParseError] = useState('')
  const [voiceState, setVoiceState] = useState('idle') // idle | listening | error
  const [focused, setFocused] = useState(false)
  const recognitionRef = useRef<any>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  // Optimistic local edits write straight to the cached notes array so
  // the feed updates without a refetch; the cache is the source of truth.
  const patchNotes = (fn: any) =>
    queryClient.setQueryData(notesKey(user?.id), (prev: any) =>
      prev ? { ...prev, notes: fn(prev.notes) } : prev)

  useEffect(() => {
    if (searchParams.get('voice') === '1') {
      startVoice()
      searchParams.delete('voice')
      setSearchParams(searchParams, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Stop a recognition session for good: detach its handlers so a late
  // result or end event can't touch state, then abort.
  function abortVoice() {
    const rec = recognitionRef.current
    recognitionRef.current = null
    if (!rec) return
    rec.onresult = null
    rec.onend = null
    rec.onerror = null
    try { rec.abort() } catch {}
  }

  // Release the mic when the screen unmounts; a continuous session
  // otherwise keeps listening after navigating away.
  useEffect(() => abortVoice, [])

  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      setVoiceState('error')
      toastInfo('Voice not supported here', 'Type the note instead.')
      return
    }
    abortVoice()
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    // With interimResults the same phrase arrives many times as it grows,
    // so rebuild the dictated text from the draft as it was when the mic
    // opened instead of appending every partial hypothesis.
    const base = draft.trim() ? draft.trimEnd() + ' ' : ''
    let final = ''
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      setDraft(base + (final + interim).trim())
    }
    rec.onend = () => {
      if (recognitionRef.current === rec) recognitionRef.current = null
      setVoiceState('idle')
    }
    rec.onerror = (e: any) => {
      setVoiceState('error')
      const fb = speechErrorFeedback(e?.error)
      if (fb) (fb.tone === 'info' ? toastInfo : toastError)(fb.title, fb.description)
    }
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
    } catch (e: any) {
      console.error('[notes] parse failed:', e)
      setParsed(null)
      setParseError(navigator.onLine === false
        ? 'Reconnect to use AI parsing. Your report text stays here, ready to save.'
        : 'AI parsing could not finish. Try again, or save your report as written.')
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
    // resilientInsert mints the id client-side, so the optimistic row
    // below is the same row that lands in the DB (online or queued).
    const { queued, error, id } = await resilientInsert('fh_notes', payload)
    if (error) {
      setSaving(false)
      // resilientInsert only surfaces a non-network error here (dead zones
      // queue instead), a real failure the user must see, not a silent
      // no-op that looks like the note was saved.
      toastError("Couldn't save note", error.message || 'Try again')
      return
    }
    // Keep the AI parse with the note so the AI badge, risk spine and
    // action items survive a reload. It is written as a separate update so
    // a failed parse write never costs the note itself (the column was
    // added in production by migration 068). Queued (offline) notes skip it.
    let savedParsed: any = null
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed) && !queued) {
      const { data: stored, error: parsedErr } = await supabase.from('fh_notes')
        .update({ parsed })
        .eq('id', id)
        .select('id')
      if (parsedErr) console.warn('[notes] AI parse not stored with the note', parsedErr)
      else if (stored?.length) savedParsed = parsed
    }
    setSaving(false)
    const localRow = { ...payload, id, created_at: new Date().toISOString(), done: false, ...(savedParsed ? { parsed: savedParsed } : {}) }
    setDraft('')
    setParsed(null)
    setContactId('')
    patchNotes((n: any) => [localRow, ...n])
    // Saved while the reports could not be read: read them again, so the
    // note shows once the connection is back.
    if (!bundle) void refetch()
    toastSuccess('Note saved', queued ? 'Will sync when signal returns' : 'Synced across devices')
  }

  async function markDone(id: any) {
    if (!user) return
    // Optimistically remove, then reconcile: on a failed write, roll the
    // note back into the list (else it vanishes, then reappears on the
    // next refetch) and tell the user.
    const prev = notes
    patchNotes(() => prev.filter((x: any) => x.id !== id))
    const { error } = await supabase.from('fh_notes').update({ done: true }).eq('id', id).eq('user_id', user.id)
    if (error) {
      patchNotes(() => prev)
      toastError("Couldn't archive note", error.message)
    }
  }

  async function remove(id: any) {
    if (!user) return
    const snapshot = notes.find((n) => n.id === id)
    const { error } = await supabase.from('fh_notes').delete().eq('id', id).eq('user_id', user.id)
    if (error) { toastError("Couldn't delete", error.message); return }
    patchNotes((n: any) => n.filter((x: any) => x.id !== id))
    toastUndo('Note deleted', {
      description: (snapshot as any)?.parsed?.summary || (snapshot?.text || '').slice(0, 60) || 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_notes').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        patchNotes((n: any) => [snapshot, ...n])
        toastSuccess('Restored', '')
      }
    })
  }

  const listening = voiceState === 'listening'
  const { stagger, item } = useFhMotion()
  const isDesktop = useIsDesktop()

  /* ───────── DATA SHAPING ───────── */

  const historyQuery = searchParams.get('q') || ''
  const historyJob = searchParams.get('job') || ''
  const historyLinkage = searchParams.get('linkage') || ''
  const historyFrom = searchParams.get('from') || ''
  const historyTo = searchParams.get('to') || ''
  const historyKey = JSON.stringify([historyQuery, historyJob, historyLinkage, historyFrom, historyTo])
  const historyFiltered = Boolean(historyQuery || historyJob || historyLinkage || historyFrom || historyTo)
  const [historyWindow, setHistoryWindow] = useState({ query: '', count: 12 })
  const historyLimit = historyWindow.query === historyKey ? historyWindow.count : 12
  const matchedReports = useMemo(() => filterReports(notes, contacts, historyQuery, {
    jobId: historyJob, linkage: historyLinkage === 'unavailable' && !contactsReady ? '' : historyLinkage, from: historyFrom, to: historyTo,
  }), [notes, contacts, historyQuery, historyJob, historyLinkage, historyFrom, historyTo, contactsReady])
  const recent = matchedReports.slice(0, historyLimit)
  const cockpitStats = useMemo(() => reportStats(notes), [notes])
  const setHistoryFilter = (key: string, value: string) => {
    // Router rendering can lag behind consecutive field events. History is
    // updated synchronously, so keep the preceding filter change intact.
    const next = new URLSearchParams(window.location.search)
    if (value) next.set(key, value)
    else next.delete(key)
    setSearchParams(next, { replace: true })
  }
  const historyControl = { width: '100%', minHeight: 44, padding: 12, fontSize: 16, borderRadius: 10,
    background: 'var(--v3-surface)', color: 'var(--v3-text)', border: '1px solid var(--v3-border-strong)' }
  const historySearch = <div style={{ margin: '12px 0', fontSize: 14 }}>
    <p style={{ color: 'var(--v3-text-muted)', lineHeight: 1.5 }}>Your report history. Includes reports you captured, with dates in your local time.</p>
    <label style={{ display: 'grid', gap: 8 }}>
      Search reports
      <input type="search" value={historyQuery} placeholder="Report text, customer, job or address"
        onChange={event => setHistoryFilter('q', event.target.value)} style={historyControl} />
    </label>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 190px), 1fr))', gap: 12, marginTop: 12 }}>
      <RecordPicker label="History job" loading={!contactsReady && !contactsError} disabled={!contactsReady} value={historyJob} onChange={value => setHistoryFilter('job', value)} clearLabel="All jobs"
        options={contacts.map(job => ({ value: job.id, label: reportJobLabel(job) }))} />
      <label style={{ display: 'grid', gap: 8 }}>Job link
        <select value={historyLinkage} onChange={event => setHistoryFilter('linkage', event.target.value)} style={historyControl}>
          <option value="">Any link status</option><option value="linked">Linked to a job</option>
          <option value="unlinked">No job link</option><option value="unavailable" disabled={!contactsReady}>Linked job unavailable</option>
        </select>
      </label>
      <label style={{ display: 'grid', gap: 8 }}>From date
        <input type="date" value={historyFrom} max={historyTo || undefined} onChange={event => setHistoryFilter('from', event.target.value)} style={historyControl} />
      </label>
      <label style={{ display: 'grid', gap: 8 }}>Through date
        <input type="date" value={historyTo} min={historyFrom || undefined} onChange={event => setHistoryFilter('to', event.target.value)} style={historyControl} />
      </label>
    </div>
    {!contactsReady && <p role={contactsError ? 'alert' : 'status'} style={{ lineHeight: 1.5 }}>
      {contactsError ? 'Job names could not load. Report text and dates remain available.' : 'Loading job names…'}
      {historyLinkage === 'unavailable' && ' Unavailable job filtering is paused. Showing reports matching your other filters.'}
      {contactsError && <button type="button" className="fh-build-inline-link" style={{ minHeight: 44, marginLeft: 8 }} onClick={() => { void retryContacts() }}>Retry job lookup</button>}
    </p>}
    {historyFrom && historyTo && historyFrom > historyTo && <p role="alert">Through date must be on or after From date.</p>}
    {historyFiltered && <button type="button" className="fh-build-secondary-btn" style={{ marginTop: 12, minHeight: 44 }} onClick={() => {
      const next = new URLSearchParams(searchParams)
      for (const key of ['q', 'job', 'linkage', 'from', 'to']) next.delete(key)
      setSearchParams(next, { replace: true })
    }}>Clear history filters</button>}
  </div>
  const historyMore = <div style={{ padding: '12px 0', fontSize: 14 }}>
    <p aria-live="polite">Showing {recent.length} of {matchedReports.length} {historyFiltered ? 'matching ' : ''}reports. Newest first.</p>
    {recent.length < matchedReports.length && <button type="button" className="fh-build-secondary-btn"
      onClick={() => setHistoryWindow({ query: historyKey, count: historyLimit + 12 })}
      style={{ minHeight: 44 }}>Load more reports</button>}
  </div>

  // Linked to Jobs = notes WITH contact_id, grouped by contact name
  const linkedGroups = useMemo(() => {
    const linked = notes.filter((n) => n.contact_id)
    const map = new Map()
    for (const n of linked) {
      const key = n.contact_id
      if (!map.has(key)) {
        const c = contacts.find((x) => x.id === key)
        map.set(key, { contactId: key, name: c ? reportJobLabel(c) : contactsReady ? 'Linked job unavailable' : 'Job details not loaded', items: [] })
      }
      map.get(key).items.push(n)
    }
    return Array.from(map.values())
  }, [notes, contacts, contactsReady])

  // Action Items = aggregate parsed.action_items across all notes
  const actionItems = useMemo(() => {
    const out = []
    for (const n of notes) {
      const items = (n as any)?.parsed?.action_items
      if (Array.isArray(items)) {
        for (const txt of items) {
          out.push({ noteId: n.id, contactId: n.contact_id, text: txt, when: n.created_at })
        }
      }
    }
    return out.slice(0, 10)
  }, [notes])

  // A failed read with nothing to show says so where the reports go, on
  // both layouts, never "0 reports captured", "All clear" or an empty feed:
  // the compact error, inside the reports card. The composer stays, so a
  // report can still be written and saved. A failed refresh keeps the
  // reports already on screen. Try again leaves focus on the reports card,
  // which stays while the error gives way to the skeleton.
  const readFailed = isError && !bundle
  const reportsEl = useRef<HTMLElement | null>(null)
  const setReportsEl = useCallback((el: HTMLElement | null) => { reportsEl.current = el }, [])
  const readError = (
    <DataErrorState
      compact
      title="Couldn't load your field reports"
      message="We couldn't reach your reports. Check your connection and try again."
      actionLabel="Try again"
      onRetry={() => {
        keepFocusOnRetry(reportsEl.current)
        void refetch()
      }}
    />
  )

  if (isDesktop) {
    return (
      <Suspense fallback={null}>
        <SnowNotes
          loading={loading}
          readError={readFailed ? readError : null}
          reportsRef={setReportsEl}
          contacts={contacts}
          contactsReady={contactsReady}
          contactsError={contactsError}
          recent={recent}
          historySearch={historySearch}
          historyMore={historyMore}
          historyQuery={historyFiltered ? 'filtered' : ''}
          onShowUnlinked={() => {
            setSearchParams({ linkage: 'unlinked' }, { replace: true })
            requestAnimationFrame(() => reportsEl.current?.scrollIntoView({ block: 'start' }))
          }}
          linkedGroups={linkedGroups}
          actionItems={actionItems}
          cockpitStats={cockpitStats}
          draft={draft}
          setDraft={setDraft}
          contactId={contactId}
          setContactId={setContactId}
          saving={saving}
          parsing={parsing}
          parsed={parsed}
          parseError={parseError}
          voiceState={voiceState}
          onStartVoice={startVoice}
          onStopVoice={stopVoice}
          onParse={parseWithAI}
          onSave={save}
          onMarkDone={markDone}
          onDelete={remove}
          onOpenJob={(id) => navigate(`/jobs/${id}`)}
        />
      </Suspense>
    )
  }

  return (
    <motion.div
      className="v3-screen fh-notes-phone"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 48, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {/* ─────────── COCKPIT PANEL ───────────
          Black-glass summary card. Surfaces total / 24h / AI-parsed /
          risks above the fold so the operator gets a triage read on
          entry. Risks chip turns red when > 0. */}
      <motion.div
        variants={item}
        className="v3-section v3-section--primary-quiet fh-notes-intro"
        style={{ margin: '12px var(--v3-gutter) 14px', padding: '16px 16px' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <span className="v3-eyebrow" style={{ color: 'var(--v3-primary-text)' }}>Field notes</span>
            <h1 style={{ margin: '6px 0 0', fontSize: 24, lineHeight: 1.1, letterSpacing: 0, fontWeight: 600, color: 'var(--v3-text)' }}>
              Notes
            </h1>
            <div className="v3-caption" style={{ marginTop: 6 }}>
              Capture what happened. Add AI summaries when you need them.
            </div>
          </div>
          <VoiceButton listening={listening} onStart={startVoice} onStop={stopVoice} />
        </div>

        {/* Stat row, only render once we've loaded (notes can be empty
            but loading=true initially, in which case skip the row). */}
        {!loading && (cockpitStats.total > 0 || cockpitStats.recent24 > 0) && (
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, marginTop: 14, flexWrap: 'wrap' }}>
            <CockpitStat label="Total" value={cockpitStats.total} />
            <CockpitDivider />
            <CockpitStat label="24h" value={cockpitStats.recent24} />
            <CockpitDivider />
            <CockpitStat label="AI total" value={cockpitStats.parsedCount} tone="gold" />
            {cockpitStats.riskCount > 0 && (
              <>
                <CockpitDivider />
                <CockpitStat label="Risk reports total" value={cockpitStats.riskCount} tone="alert" />
              </>
            )}
          </div>
        )}
      </motion.div>

      {/* ─────────── CAPTURE ─────────── */}
      <motion.div
        variants={item}
        className="v3-section"
        style={{
          margin: '0 var(--v3-gutter) var(--v3-rhythm-screen)',
          // Gold thin border on focus = "thin line, not wash". Listening
          // border red. Focus shadow is now neutral inner highlight only,
          // no gold halo bleed.
          borderColor: listening
            ? 'rgba(192, 57, 43, 0.40)'
            : focused
              ? 'rgba(201, 150, 58, 0.32)'
              : 'var(--v3-section-border)',
          transition: 'border-color 200ms ease, box-shadow 200ms ease',
          boxShadow: focused
            ? '0 1px 0 var(--v3-glass-tint-2) inset, 0 1px 2px rgba(20, 20, 20, 0.30), 0 6px 20px rgba(20, 20, 20, 0.35)'
            : 'var(--v3-section-shadow)'
        }}
      >
        <textarea
          aria-label="Field report"
          className="fh-notes-textarea"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={listening ? 'Listening, speak freely…' : 'What happened on site?'}
          rows={5}
          style={{
            width: '100%',
            resize: 'vertical',
            minHeight: 110,
            background: 'var(--v3-surface)',
            border: '1px solid var(--v3-border-strong)',
            color: 'var(--v3-text)',
            fontFamily: 'var(--font-body)',
            fontSize: 16,
            lineHeight: 1.55,
            padding: 12,
            borderRadius: 10,
            boxSizing: 'border-box'
          }}
        />

        {/* Listening pulse */}
        {listening && (
          <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 14, marginTop: 6 }}>
            {[0, 1, 2, 3, 4].map((i) => (
              <span
                key={i}
                style={{
                  width: 3,
                  height: 10,
                  borderRadius: 10,
                  background: 'var(--v3-danger)',
                  animation: reduceMotion ? 'none' : `fh-pulse-dot 900ms ${i * 110}ms infinite ease-in-out`
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
          paddingTop: 12,
          borderTop: '1px solid var(--v3-border)'
        }}>
          <RecordPicker label="Link this note to a job" disabled={!contactsReady} loading={!contactsReady && !contactsError} error={contactsError ? 'Job names unavailable. Retry job lookup below.' : undefined} value={contactId} onChange={setContactId}
            options={contacts.map((c) => ({ value: c.id, label: reportJobLabel(c) }))}
            clearLabel="No job link" placeholder="Search customer, job, address or reference" />

          <button
            type="button"
            onClick={parseWithAI}
            disabled={!draft.trim() || parsing}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '12px 12px',
              borderRadius: 10,
              background: !draft.trim() || parsing ? 'var(--v3-surface-2)' : 'var(--v3-primary-soft)',
              border: !draft.trim() || parsing ? '1px solid var(--v3-border)' : '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
              color: !draft.trim() || parsing ? 'var(--v3-text-muted)' : 'var(--v3-primary-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
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
              padding: '12px 12px',
              borderRadius: 10,
              background: 'var(--v3-danger-soft)',
              border: '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              lineHeight: 1.5
            }}
          >
            <span style={{ fontWeight: 700, color: 'var(--v3-danger-text)' }}>AI parse unavailable. </span>
            <span style={{ color: 'var(--v3-text-muted)' }}>{parseError} You can still save the note as entered.</span>
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
                padding: 12,
                borderRadius: 10,
                background: 'var(--v3-surface-2)',
                border: '1px solid color-mix(in srgb, var(--v3-primary) 25%, transparent)'
              }}
            >
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <Sparkles size={12} color="var(--v3-primary)" />
                <span className="v3-eyebrow" style={{ color: 'var(--v3-primary-text)' }}>AI summary</span>
              </div>
              <p style={{ margin: 0, fontSize: 14, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
                {parsed.summary}
              </p>
              <ParsedList title="Action items" items={parsed.action_items} Icon={ClipboardCheck} tone="good" />
              <ParsedList title="Risks" items={parsed.risks} Icon={AlertTriangle} tone="warn" />
              <ParsedList title="Materials" items={parsed.materials_needed} Icon={Package} />
              {parsed.follow_up_date && (
                <p style={{ margin: '10px 0 0', fontSize: 14, fontFamily: 'var(--font-body)', color: 'var(--v3-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                  <Calendar size={12} />
                  Follow up: <strong style={{ color: 'var(--v3-primary-text)' }}>{parsed.follow_up_date}</strong>
                </p>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* ─────────── RECENT ACTIVITY ─────────── */}
      <motion.div
        variants={item}
        ref={setReportsEl}
        className="v3-section"
        style={{ margin: '0 var(--v3-gutter) var(--v3-rhythm-screen)' }}
        role="group"
        aria-label="Recent activity"
        tabIndex={-1}
      >
        <SectionHeader label="Recent activity" />
        {!readFailed && historySearch}

        {readFailed ? (
          <div style={{ marginTop: 4 }}>{readError}</div>
        ) : loading ? (
          // The feed's own skeleton, in a polite busy region with a hidden
          // line, as SkeletonRows does.
          <div role="status" aria-live="polite" aria-busy="true" style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
            <span className="fhc-vh">Loading recent activity</span>
            {[0, 1, 2].map((i) => (
              <div key={i} className="v3-skeleton" aria-hidden="true" style={{ height: 76, borderRadius: 10, opacity: 1 - i * 0.2 }} />
            ))}
          </div>
        ) : recent.length === 0 ? (
          <div className="v3-empty" style={{ marginTop: 4 }}>
            <Activity size={22} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
              {historyFiltered ? 'No reports match your search.' : 'Nothing logged yet.'}
            </div>
            <div style={{ fontSize: 14 }}>{historyFiltered ? 'Try another word or adjust your filters.' : 'Use the capture above. Voice or type, both work.'}</div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 4 }}>
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

      {!loading && !readFailed && <div style={{ margin: '0 var(--v3-gutter)' }}>{historyMore}</div>}

      {/* ─────────── LINKED TO JOBS ─────────── */}
      {!loading && !historyFiltered && linkedGroups.length > 0 && (
        <motion.div
          variants={item}
          className="v3-section"
          style={{ margin: '0 var(--v3-gutter) var(--v3-rhythm-screen)' }}
        >
          <SectionHeader label="Linked to jobs" />

          <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 4 }}>
            {linkedGroups.map((g) => (
              <div key={g.contactId}>
                {/* Job group header, tappable, navigates to the job */}
                <button
                  type="button"
                  onClick={() => { hapticTap(); navigate(`/jobs/${g.contactId}`) }}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    width: '100%',
                    padding: '12px 12px',
                    marginBottom: 8,
                    borderRadius: 10,
                    background: 'var(--v3-surface-2)',
                    border: '1px solid var(--v3-border)',
                    color: 'var(--v3-text)',
                    cursor: 'pointer',
                    fontFamily: 'var(--font-body)'
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                    <span style={{
                      width: 28, height: 28, borderRadius: 10,
                      background: 'var(--v3-surface-2)',
                      border: '1px solid var(--v3-border-strong)',
                      display: 'grid', placeItems: 'center', flexShrink: 0
                    }}>
                      <Briefcase size={14} color="var(--v3-primary)" />
                    </span>
                    <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {g.name}
                    </span>
                    <Eyebrow style={{ flexShrink: 0 }}>
                      {g.items.length} {g.items.length === 1 ? 'note' : 'notes'}
                    </Eyebrow>
                  </span>
                  <ChevronRight size={16} color="var(--v3-text-muted)" />
                </button>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {g.items.slice(0, 3).map((n: any, i: any) => (
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
          placeholder so the section's purpose is visible. After a failed
          read there is nothing to list, so the section waits. */}
      {!readFailed && !historyFiltered && (
        <motion.div
          variants={item}
          className="v3-section v3-section--quiet"
          style={{ margin: '0 var(--v3-gutter) 40px' }}
        >
          <div className="v3-section-header">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={14} color="var(--v3-primary)" />
              <span className="v3-eyebrow">AI action items</span>
            </span>
          </div>

          {loading ? (
            <SkeletonRows rows={2} label="Loading action items" />
          ) : actionItems.length === 0 ? (
            <div className="v3-empty" style={{ marginTop: 4 }}>
              <ClipboardCheck size={22} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
                No action items yet.
              </div>
              <div style={{ fontSize: 14, lineHeight: 1.5 }}>
                Tap <strong style={{ color: 'var(--v3-primary-text)' }}>AI parse</strong> on a note above to extract action items, risks, and materials.
              </div>
            </div>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              {actionItems.map((a, i) => {
                const c = contacts.find((x) => x.id === a.contactId)
                return (
                  <li
                    key={`${a.noteId}-${i}`}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 12,
                      padding: '12px 12px',
                      borderRadius: 10,
                      background: 'var(--v3-surface)',
                      border: '1px solid var(--v3-border)'
                    }}
                  >
                    <span style={{
                      flexShrink: 0,
                      marginTop: 2,
                      width: 16, height: 16, borderRadius: 10,
                      background: 'var(--v3-primary-soft)',
                      border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
                      display: 'grid', placeItems: 'center'
                    }}>
                      <ClipboardCheck size={10} color="var(--v3-primary)" />
                    </span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{
                        fontSize: 14,
                        color: 'var(--v3-text)',
                        fontFamily: 'var(--font-body)',
                        lineHeight: 1.45,
                        overflowWrap: 'anywhere'
                      }}>
                        {a.text}
                      </div>
                      {c?.name && (
                        <div style={{ marginTop: 4, fontSize: 14, color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)' }}>
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
      )}
    </motion.div>
  )
}

/* ============================================================
   VoiceButton, capture-on/off toggle. Listening state turns the
   button danger-red so the operator can spot it from the corner.
   ============================================================ */
function VoiceButton({ listening, onStart, onStop }: any) {
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
        padding: '12px 12px',
        borderRadius: 10,
        border: listening
          ? '1px solid color-mix(in srgb, var(--v3-danger) 50%, transparent)'
          : '1px solid var(--v3-border-strong)',
        background: listening ? 'var(--v3-danger-soft)' : 'var(--v3-surface)',
        color: listening ? 'var(--v3-danger-text)' : 'var(--v3-text)',
        fontFamily: 'var(--font-body)',
        fontSize: 14,
        fontWeight: 700,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: listening
          ? '0 0 0 4px color-mix(in srgb, var(--v3-danger) 12%, transparent)'
          : '0 1px 0 var(--v3-glass-tint) inset, 0 4px 12px rgba(20, 20, 20, 0.20)'
      }}
    >
      {listening ? <MicOff size={16} /> : <Mic size={16} />}
      {listening ? 'Stop' : 'Voice'}
    </motion.button>
  )
}

/* ============================================================
   NoteCard, one report with its record actions. Hierarchy:
     1. Title (parsed summary OR first non-empty line, max 80ch)
     2. Body preview (only if distinct from title; 3-line clamp)
     3. Footer metadata: linked job chip / action-item count / time
   Risk reports retain a solid marker. All actions are available without
   swiping; the optional swipe delete uses the same confirmation.
   ============================================================ */
function NoteCard({ note, contacts, index = 0, hideJobChip = false, onTap, onArchive, onDelete }: any) {
  // Delete takes a second tap on the same button (D57).
  const deleteTap = useSecondTap()
  const body = note.text || note.body || ''
  const firstLine = (body.split('\n').find((l: any) => l.trim()) || '').trim()
  const title = note.parsed?.summary || firstLine.slice(0, 90) || 'Untitled note'
  const showBodyBelow = body && body.trim() !== title.trim()
  const contact = contacts.find((c: any) => c.id === note.contact_id)
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

  const swipeActions = [
    {
      icon: <ArchiveIcon size={18} />,
      label: 'Archive note',
      color: 'var(--v3-surface-2)',
      fg: 'var(--v3-text)',
      onClick: onArchive
    },
    {
      icon: <Trash2 size={18} />,
      label: 'Delete note',
      color: 'rgba(192, 57, 43, 0.18)',
      fg: 'var(--v3-danger-text)',
      onClick: () => deleteTap.tap(onDelete)
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
        style={{
          position: 'relative',
          overflow: 'hidden',
          padding: hasRisk ? '16px 4px 16px 12px' : '16px 4px',
          background: 'var(--v3-bg)',
          borderBottom: '1px solid var(--v3-border-strong)',
          borderLeft: hasRisk ? '2px solid var(--v3-danger)' : undefined,
          WebkitTapHighlightColor: 'transparent'
        }}
      >
        {/* Header row: title + (AI badge) + timestamp */}
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div style={{ minWidth: 0, flex: '1 1 120px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
            <h3
              style={{
                margin: 0,
                fontFamily: 'var(--font-body)',
                fontSize: 16,
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
                  gap: 4,
                  padding: '4px 8px',
                  borderRadius: 10,
                  background: 'var(--v3-primary-soft)',
                  border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
                  color: 'var(--v3-primary-text)',
                  fontFamily: 'var(--font-display)',
                  fontSize: 12,
                  letterSpacing: 0
                }}>
                  <Sparkles size={9} />
                  AI
                </span>
              )}
            </h3>
            <span style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              marginTop: 6,
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              color: 'var(--v3-text-muted)'
            }}>
              <Clock size={11} />
              {when}
            </span>
          </div>
          {/* Visible delete affordance, the SwipeableRow swipe-left
              gesture is preserved as the iOS-native power-user path,
              but a tappable trash icon makes deletion discoverable
              for users who don't think to swipe. Stops propagation so
              the row's onTap doesn't fire underneath. */}
          {onDelete && (
            <button
              type="button"
              onClick={(ev) => {
                ev.stopPropagation()
                deleteTap.tap(onDelete)
              }}
              aria-label={deleteTap.armed ? 'Tap again to delete' : 'Delete note'}
              title={deleteTap.armed ? 'Tap again to delete this note' : 'Delete note'}
              style={{
                width: deleteTap.armed ? 'auto' : 44, minHeight: 44, maxWidth: '100%', padding: deleteTap.armed ? '8px 12px' : 0,
                flexShrink: 0,
                fontSize: 14, fontWeight: 700, fontFamily: 'var(--font-body)',
                display: 'grid', placeItems: 'center',
                borderRadius: 10,
                background: 'transparent',
                border: '1px solid transparent',
                color: 'var(--v3-text-muted)',
                cursor: 'pointer',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
                transition: 'color 160ms ease, background 160ms ease, border-color 160ms ease'
              }}
              onMouseEnter={(ev) => {
                if (!canHover) return
                ev.currentTarget.style.color = 'var(--v3-danger-bright)'
                ev.currentTarget.style.background = 'color-mix(in srgb, var(--v3-danger-bright) 10%, transparent)'
                ev.currentTarget.style.borderColor = 'color-mix(in srgb, var(--v3-danger-bright) 30%, transparent)'
              }}
              onMouseLeave={(ev) => {
                ev.currentTarget.style.color = 'var(--v3-text-muted)'
                ev.currentTarget.style.background = 'transparent'
                ev.currentTarget.style.borderColor = 'transparent'
              }}
            >
              {deleteTap.armed ? 'Tap again to delete' : <Trash2 size={16} aria-hidden="true" />}
            </button>
          )}
        </div>

        {/* Body preview, clamped to 3 lines */}
        {showBodyBelow && (
          <p style={{
            margin: '6px 0 0',
            fontSize: 14,
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

        <ReportDetails report={note} />

        {/* Footer metadata */}
        {(!hideJobChip && contact?.name) || actionCount > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
            {!hideJobChip && contact?.name && (
              <Eyebrow style={{ gap: 4, whiteSpace: 'normal', overflowWrap: 'anywhere' }}>
                <Briefcase size={10} color="var(--v3-primary)" />
                {reportJobLabel(contact)}
              </Eyebrow>
            )}
            {actionCount > 0 && (
              <Eyebrow tone="success" style={{ gap: 4, padding: '4px 8px', borderRadius: 10, background: 'var(--v3-success-soft)', border: '1px solid color-mix(in srgb, var(--v3-success) 30%, transparent)' }}>
                <ClipboardCheck size={10} />
                {actionCount} {actionCount === 1 ? 'action' : 'actions'}
              </Eyebrow>
            )}
          </div>
        ) : null}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 16, marginTop: 8 }}>
          {contact && onTap && <button type="button" onClick={onTap} className="v3-section-link" style={{ minHeight: 44 }}>
            Open linked job <ChevronRight size={14} aria-hidden="true" />
          </button>}
          {onArchive && <button type="button" onClick={onArchive} aria-label="Archive note" className="v3-section-link" style={{ minHeight: 44 }}>
            Archive
          </button>}
        </div>
      </motion.article>
    </SwipeableRow>
  )
}

/* ============================================================
   ParsedList, used inside the inline AI Summary card. One row
   per item type (action_items, risks, materials).
   ============================================================ */
function ParsedList({ title, items, Icon, tone }: any) {
  if (!items || items.length === 0) return null
  const color = tone === 'warn'
    ? 'var(--v3-danger-text)'
    : tone === 'good'
      ? 'var(--v3-success-text)'
      : 'var(--v3-text-muted)'
  return (
    <div style={{ marginTop: 10 }}>
      <Eyebrow as="div" style={{ marginBottom: 6, color }}>
        {Icon ? <Icon size={11} /> : null}
        {title}
      </Eyebrow>
      <ul style={{ margin: 0, paddingLeft: 16, fontSize: 14, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', lineHeight: 1.5 }}>
        {items.map((it: any, i: any) => <li key={i} style={{ marginBottom: 2 }}>{it}</li>)}
      </ul>
    </div>
  )
}

/* ============================================================
   CockpitStat / CockpitDivider, compact triage display for the
   summary panel. Display number over a small uppercase label.
   tone "gold" for AI count, "alert" for non-zero risks.
   ============================================================ */
function CockpitStat({ label, value, tone = 'default' }: any) {
  const color = tone === 'gold'
    ? 'var(--v3-primary-text)'
    : tone === 'alert'
      ? 'var(--v3-danger-text)'
      : 'var(--v3-text)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: 20, lineHeight: 1, letterSpacing: 0,
        color,
        fontVariantNumeric: 'tabular-nums'
      }}>
        {value}
      </span>
      <span className="v3-eyebrow" style={tone === 'alert' ? { color: 'var(--v3-danger-text)' } : undefined}>
        {label}
      </span>
    </span>
  )
}

function CockpitDivider() {
  return <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--v3-border)' }} />
}

/* ============================================================
   formatRelativeTime, "Just now", "2h ago", "Yesterday",
   "Apr 24" / "Apr 24, 2025" depending on age. Used in NoteCard.
   ============================================================ */
function formatRelativeTime(iso: any) {
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
