import { useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { Sparkles, Check, X } from 'lucide-react'
import { haptic } from './ActionSheet.tsx'
import { useDrawerKeyboard } from '../lib/useDrawerKeyboard.ts'
import ClientPicker from './ClientPicker.tsx'
import DocIntakeButton from './DocIntakeButton.tsx'
import { supabase } from '../lib/supabase.ts'
import { findOrCreateClient } from '../lib/clients.ts'
import { claudeMessage } from '../lib/anthropic.ts'
import { parseLeadFromImage } from '../lib/docIntelligence.ts'
import { toastSuccess } from '../lib/toast.ts'
import { JOB_TYPES } from '../lib/jobTypes.ts'
import { getTemplatesForJobType, getTemplate, applyTemplate } from '../lib/jobTemplates.ts'

const STAGE_OPTIONS = [
  { value: 'lead', label: 'Lead intake' },
  { value: 'quote', label: 'Quote draft' },
  { value: 'job', label: 'Active job' }
]

const LAST_JOB_TYPE_KEY = 'fh:lastJobType'

function readLastJobType() {
  if (typeof window === 'undefined') return ''
  try { return window.localStorage.getItem(LAST_JOB_TYPE_KEY) || '' } catch { return '' }
}

function writeLastJobType(value: any) {
  if (typeof window === 'undefined' || !value) return
  try { window.localStorage.setItem(LAST_JOB_TYPE_KEY, value) } catch {}
}

function dateInputValueFromNow(days: number) {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

function buildEmptyForm(initialStage = 'lead'): Record<string, any> {
  // initialStage seeds the Stage chip when the sheet is opened. Defaults
  // to 'lead' (the original behavior); flips to 'job' when the entry
  // point was the Home "New Job" tile so the operator isn't dropped into
  // a Lead-shaped form they then have to re-tag.
  const seedStage = (initialStage === 'job' || initialStage === 'quote' || initialStage === 'lead')
    ? initialStage
    : 'lead'
  return {
    name: '', phone: '', email: '', address: '', company: '',
    job_title: '', job_type: readLastJobType(), amount: '', notes: '', referred_by: '',
    scope_text: '',
    follow_up_on: seedStage === 'lead' ? dateInputValueFromNow(1) : '',
    stage: seedStage
  }
}

// Per-field character limits — added 5/17 to address the audit's
// concern about runaway / pasted nonsense ending up in production
// (e.g. "CXVCXVXV"-style strings appearing on customer-facing
// surfaces). HTML maxLength on the input element AND a programmatic
// clamp in the set() helper so paste flows are also covered.
// Values picked to fit real human entries with comfortable room:
//   name        — full name + suffix
//   phone       — international format with formatting glyphs
//   email       — RFC max
//   address     — long urban address with apt + city + state
//   company     — long LLC names
//   job_title   — descriptive job names
//   notes       — paragraph of context
//   referred_by — full name + qualifier
//   amount      — millions with decimal
const FIELD_LIMITS: Record<string, number> = {
  name: 120,
  phone: 40,
  email: 254,
  address: 240,
  company: 160,
  job_title: 140,
  scope_text: 1200,
  notes: 4000,
  referred_by: 160,
  amount: 14
}

const VOICE_SYSTEM = `You are parsing a voice memo from a contractor logging a new lead. Extract structured data from what they said. Return ONLY a single JSON object with these keys — use null for anything not clearly mentioned:
{
  "name": string or null,
  "phone": string or null,
  "email": string or null,
  "address": string or null,
  "job_title": string or null,
  "scope_text": string or null,
  "job_type": one of [${JOB_TYPES.map(t => `"${t.value}"`).join(', ')}] or null,
  "amount": number or null (dollars, no formatting),
  "stage": one of ["lead", "quote", "job"] or null,
  "follow_up_on": string or null (YYYY-MM-DD only if a specific date was mentioned),
  "notes": string or null (anything else worth capturing),
  "referred_by": string or null
}
Return ONLY the JSON. No prose, no fences.`

export default function NewLeadSheet({ open, userId, initialStage = 'lead', lockStage = false, onClose, onCreated }: any) {
  const [form, setForm] = useState(() => buildEmptyForm(initialStage))
  const [client, setClient] = useState<any>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // Picked job-template slug. Reset whenever job_type changes since
  // templates are filtered by trade.
  const [templateSlug, setTemplateSlug] = useState('')

  const [voiceState, setVoiceState] = useState('idle') // idle | listening | parsing | error | denied
  const [transcript, setTranscript] = useState('')
  const [committed, setCommitted] = useState(false)
  const { formRef, drawerStyle, formStyle } = useDrawerKeyboard(open)
  // Live elapsed-seconds counter for the listening state. Mirrors the
  // RECORDING · 0:42 chip in the v3 design (screens-workflows.jsx
  // lead-pro-mic__lbl) — tells the operator the mic is alive and how
  // long they've been talking.
  const [voiceElapsed, setVoiceElapsed] = useState(0)
  const recognitionRef = useRef<any>(null)
  const heldRef = useRef(false)

  useEffect(() => {
    if (voiceState !== 'listening') {
      setVoiceElapsed(0)
      return
    }
    const t0 = Date.now()
    setVoiceElapsed(0)
    const id = setInterval(() => {
      setVoiceElapsed(Math.floor((Date.now() - t0) / 1000))
    }, 1000)
    return () => clearInterval(id)
  }, [voiceState])

  useEffect(() => {
    if (!open) {
      setForm(buildEmptyForm(initialStage))
      setClient(null)
      setErr('')
      setTranscript('')
      setVoiceState('idle')
      setSaving(false)
      setCommitted(false)
      setTemplateSlug('')
    }
  }, [open, initialStage])

  // When the sheet re-opens with a different initialStage (e.g. Home
  // "New Job" tile after a prior "Add Lead"), bump the Stage chip to
  // match so the operator doesn't have to retag. Only fires on open —
  // user edits to the chip mid-flow are preserved.
  useEffect(() => {
    if (open) {
      setForm((f) => ({
        ...f,
        stage: initialStage,
        follow_up_on: initialStage === 'job' ? '' : (f.follow_up_on || dateInputValueFromNow(1))
      }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialStage])

  // When the trade changes, drop any template that no longer applies.
  // Avoids the user picking "Roof tear-off" then switching to Kitchen
  // and silently shipping the wrong checklist.
  const availableTemplates = useMemo(() => getTemplatesForJobType(form.job_type), [form.job_type])
  useEffect(() => {
    if (!templateSlug) return
    if (!availableTemplates.some((t) => t.slug === templateSlug)) {
      setTemplateSlug('')
    }
  }, [availableTemplates, templateSlug])

  // Fill progress is shown as a muted hint; the sheet counter doesn't advance
  // until the insert actually succeeds. Prevents the "03/03 even on error" bug.
  const currentStep = committed ? 3 : 1

  function set(k: any, v: any) {
    // Clamp at per-field length cap (see FIELD_LIMITS above). The
    // maxLength HTML attribute handles typing, but paste flows can
    // still drop a long string in — clamp programmatically so the
    // form state never holds more than FIELD_LIMITS[k] characters.
    const limit = FIELD_LIMITS[k]
    const safe = (typeof v === 'string' && limit) ? v.slice(0, limit) : v
    setForm((f) => ({ ...f, [k]: safe }))
  }

  function setStage(v: string) {
    setForm((f) => ({
      ...f,
      stage: v,
      follow_up_on: v === 'job' ? '' : (f.follow_up_on || dateInputValueFromNow(1))
    }))
  }

  // Document intelligence — Phase 19/#1. Hands the captured/pasted image
  // to Claude Vision, applies the parsed fields on top of whatever the
  // user already typed (parsed values only fill EMPTY fields so a
  // half-typed form isn't clobbered). Toast tells the user how many
  // fields landed so they know to scan the form before submitting.
  async function parseDoc(dataUrl: any) {
    const parsed = await parseLeadFromImage(dataUrl)
    let landed = 0
    setForm((prev) => {
      const next = { ...prev }
      for (const [k, v] of Object.entries(parsed)) {
        if (v == null) continue
        const current = next[k]
        const isEmpty = current == null || current === '' || (k === 'amount' && Number(current) === 0)
        if (isEmpty) {
          next[k] = k === 'amount' ? String(v) : v
          landed++
        }
      }
      return next
    })
    toastSuccess(
      landed > 0 ? `Filled ${landed} field${landed === 1 ? '' : 's'}` : 'Nothing new to fill',
      landed > 0 ? 'Review + edit anything before saving.' : 'Form already had what AI extracted.'
    )
  }

  function startVoice() {
    const SR = typeof window !== 'undefined' && ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition)
    if (!SR) { setVoiceState('error'); return }
    heldRef.current = true
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    let full = ''
    setTranscript('')
    rec.onresult = (e: any) => {
      let chunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        chunk += e.results[i][0].transcript
      }
      full = chunk
      setTranscript(chunk)
    }
    rec.onerror = (e: any) => {
      heldRef.current = false
      if (e && (e.error === 'not-allowed' || e.error === 'service-not-allowed')) {
        setVoiceState('denied')
      } else {
        setVoiceState('error')
      }
    }
    rec.onend = () => {
      if (!heldRef.current) return
      heldRef.current = false
      if (full.trim().length > 2) {
        // Keep transcript visible while parse runs
        setTimeout(() => parseTranscript(full.trim()), 200)
      } else {
        setVoiceState('idle')
      }
    }
    try {
      rec.start()
      recognitionRef.current = rec
      setVoiceState('listening')
      haptic(20)
    } catch {
      setVoiceState('error')
    }
  }

  function stopVoice() {
    heldRef.current = false
    try { recognitionRef.current?.stop() } catch {}
    haptic(10)
  }

  async function parseTranscript(text: any) {
    setVoiceState('parsing')
    try {
      const res = await claudeMessage({
        system: VOICE_SYSTEM,
        messages: [{ role: 'user', content: text }],
        maxTokens: 500
      })
      const content = res?.content?.[0]?.text || ''
      const match = content.match(/\{[\s\S]*\}/)
      if (match) {
        const parsed = JSON.parse(match[0])
        setForm((f) => ({
          ...f,
          name: parsed.name || f.name,
          phone: parsed.phone || f.phone,
          email: parsed.email || f.email,
          address: parsed.address || f.address,
          job_title: parsed.job_title || f.job_title,
          scope_text: parsed.scope_text || f.scope_text,
          job_type: parsed.job_type || f.job_type,
          amount: parsed.amount != null ? String(parsed.amount) : f.amount,
          stage: parsed.stage || f.stage,
          follow_up_on: parsed.follow_up_on || f.follow_up_on,
          notes: parsed.notes || f.notes,
          referred_by: parsed.referred_by || f.referred_by
        }))
      }
    } catch (e: any) {
      setErr('Voice parse failed — fill the fields manually.')
    } finally {
      setVoiceState('idle')
    }
  }

  async function commit() {
    if (!form.name.trim()) { setErr('Name is required.'); return }
    setSaving(true)
    setErr('')

    // If the user didn't pick an existing client via the picker, find or
    // create one from the lead's name/phone/email so the new job shows
    // up on /clients (audit: "lead created but not visible on Clients").
    // Match strategy: phone first (most reliable identifier), email
    // second, normalized-name third. Without the name fallback, every
    // lead created without phone/email seeded a brand-new fh_clients
    // row — that's how the audit found duplicate "MMC Properties" /
    // "Jeff Roy" client entries.
    // Reuse (or create) a client so the job links one — shared with
    // Universal Capture via findOrCreateClient. Passing `company` means
    // a typed company name is preserved on the client (fh_contacts has
    // no company column, so it was previously dropped).
    const resolvedClientId = client?.id || await findOrCreateClient(userId, {
      name: form.name,
      phone: form.phone,
      email: form.email,
      address: form.address,
      company: form.company
    })

    const payload = {
      user_id: userId,
      name: form.name.trim(),
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      job_title: form.job_title || null,
      job_type: form.job_type || null,
      amount: Number(form.amount) || 0,
      scope_text: form.scope_text || null,
      follow_up_on: form.stage === 'job' ? null : (form.follow_up_on || null),
      last_contact: new Date().toISOString(),
      notes: form.notes || null,
      referred_by: form.referred_by || null,
      stage: form.stage || 'lead',
      client_id: resolvedClientId
    }
    try {
      const { data, error } = await supabase
        .from('fh_contacts')
        .insert(payload)
        .select()
        .single()
      if (error) throw error
      // Remember the job type choice for next lead
      if (form.job_type) writeLastJobType(form.job_type)
      // Apply template milestones (if picked) BEFORE we close, so the
      // checklist is already populated when the user lands on the job.
      // Failure is non-fatal — the lead is already saved.
      if (templateSlug) {
        const tmpl = getTemplate(templateSlug)
        if (tmpl) {
          const { inserted } = await applyTemplate(supabase, { template: tmpl, jobId: data.id, userId })
          if (inserted > 0) {
            toastSuccess(`Loaded ${inserted} milestones`, tmpl.label)
          }
        }
      }
      // Success: flash "Captured." + step 03/03 briefly, then close.
      setCommitted(true)
      setSaving(false)
      setTimeout(() => onCreated?.(data), 600)
    } catch (err: any) {
      console.error('Lead commit failed:', err)
      setSaving(false)
      setErr("Couldn't save this lead. Check your connection and try again.")
    }
  }

  const voiceLabel = {
    idle: 'TAP TO SPEAK',
    listening: 'TAP TO STOP',
    parsing: 'PARSING…',
    error: 'VOICE NOT AVAILABLE',
    denied: 'MIC BLOCKED'
  }[voiceState]

  function onVoiceTap(e: any) {
    e.preventDefault()
    // Error/denied states let the user try once more (e.g. grant permission).
    if (voiceState === 'error' || voiceState === 'denied') {
      setVoiceState('idle')
      // Next tick: try again immediately so they don't have to tap twice.
      setTimeout(() => startVoice(), 0)
      return
    }
    if (voiceState === 'listening') stopVoice()
    else if (voiceState === 'idle') startVoice()
    // parsing state: no-op
  }

  // When the user picks an existing client, hydrate every empty form
  // field from the client's record so the lead matches the chosen
  // identity. Fields the user has already typed are preserved (spec:
  // "If the user edits a hydrated field, preserve the edited value
  // for the new lead, but keep the existing client link"). Clearing
  // the picker (next == null) leaves form values in place — the user
  // can keep typing in manual mode without losing what they had.
  // Defensive aliases (client_name, job_address) cover schemas that
  // surface different column names downstream.
  function handleClientChange(next: any) {
    setClient(next)
    if (!next) return
    setForm((prev) => ({
      ...prev,
      name:    prev.name?.trim()    ? prev.name    : next.name    || next.client_name || '',
      phone:   prev.phone?.trim()   ? prev.phone   : next.phone   || '',
      email:   prev.email?.trim()   ? prev.email   : next.email   || '',
      address: prev.address?.trim() ? prev.address : next.address || next.job_address || '',
      company: prev.company?.trim() ? prev.company : next.company || next.company_name || ''
    }))
  }

  // Title noun follows the Stage chip so the surface is always honest:
  // open via "New Job" → title is "New job."; user retags to Lead → flips
  // to "New lead." On success it flips to "{Noun} captured." so the same
  // language carries through. Quote uses its own noun for the same reason.
  const stageNoun = form.stage === 'job' ? 'job' : form.stage === 'quote' ? 'quote' : 'lead'
  const NounCap = stageNoun.charAt(0).toUpperCase() + stageNoun.slice(1)
  const commitVerb = form.stage === 'lead' ? 'CAPTURE' : form.stage === 'quote' ? 'START' : 'CREATE'
  const drawerDescription = form.stage === 'lead'
    ? 'Capture the customer, scope, value, and next follow-up once. This record becomes the quote and job later.'
    : form.stage === 'quote'
      ? 'Start from customer and scope so the proposal is ready for line items.'
      : 'Create active work with enough detail to schedule, cost, and invoice.'

  return (
    <Drawer
      open={open}
      onOpenChange={(v: any) => { if (!v && !saving) onClose?.() }}
      // repositionInputs={false}: this sheet is tall (mic + scan + 6
      // fields) and its first field is an autocomplete that opens on
      // focus. Vaul's default input-repositioning shrank the drawer
      // toward the focused field on iOS, collapsing the whole sheet to a
      // sliver (reported bug). With it off, the drawer keeps the stable
      // height below and the form scrolls internally; our own
      // onFocusIn handler (useDrawerKeyboard) scrolls focused fields
      // into the visible band above the keyboard.
      repositionInputs={false}
    >
      <DrawerContent
        className="ui:max-w-full ui:overflow-x-hidden"
        // Stable height (safe now that Vaul isn't writing height itself):
        // a definite height is what lets the inner form's overflow:auto
        // actually scroll instead of the sheet growing/collapsing.
        style={{ ...drawerStyle, height: '88dvh', maxHeight: '88dvh' }}
      >
        <DrawerHeader className="ui:text-left" style={{ maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--v3-text-muted)' }}>
            <Sparkles size={12} />
            New {stageNoun}
          </div>
          <DrawerTitle asChild>
            <h2
              className="fh-font-serif"
              style={{ margin: '6px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
            >
              {committed ? `${NounCap} captured.` : `New ${stageNoun}.`}
            </h2>
          </DrawerTitle>
          <DrawerDescription
            style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}
          >
            {drawerDescription}
          </DrawerDescription>
        </DrawerHeader>

        <form
          ref={formRef}
          onSubmit={(e) => { e.preventDefault(); commit() }}
          // flex:1 + minHeight:0 so the form fills the floored sheet
          // height and scrolls INTERNALLY (overflowY:auto) instead of
          // growing the sheet — that's what lets the keyboard push
          // without collapsing the drawer.
          style={formStyle({ flex: 1, minHeight: 0 })}
        >
          {/* Commit error banner */}
          {err && (
            <div className="fh-sheet-error" role="alert">
              <span className="fh-sheet-error__dot" aria-hidden="true" />
              <span className="fh-sheet-error__text">{err}</span>
              <button
                type="button"
                className="fh-sheet-error__dismiss"
                aria-label="Dismiss error"
                onClick={() => setErr('')}
              >
                ×
              </button>
            </div>
          )}

      {/* v3 mic block — horizontal layout: circular gold mic on the left,
          label / title / hint stacked on the right. Replaces the older
          full-width tap-to-speak hero. Title + hint adapt to voice state
          so the operator always knows what's happening without needing
          to read a separate chip. Ports lead-pro-mic from the design
          handoff (screens-workflows.jsx + styles-refine.css). */}
      <div className="fh-vmic">
        <button
          type="button"
          className={[
            'fh-vmic__btn',
            voiceState === 'listening' ? 'is-on' : '',
            voiceState === 'denied' ? 'is-denied' : ''
          ].filter(Boolean).join(' ')}
          aria-label={voiceState === 'listening' ? 'Stop voice capture' : 'Start voice capture'}
          disabled={voiceState === 'parsing' || saving}
          onClick={onVoiceTap}
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M19 10a7 7 0 0 1-14 0M12 19v3" />
          </svg>
        </button>
        <div className="fh-vmic__main">
          <div className="fh-vmic__lbl">
            {voiceState === 'listening' && <span className="fh-vmic__pulse" aria-hidden="true" />}
            {voiceState === 'listening' ? 'Recording' :
             voiceState === 'parsing'   ? 'Parsing'   :
             voiceState === 'denied'    ? 'Mic blocked' :
             voiceState === 'error'     ? 'Unavailable' :
             'Fast capture'}
            {voiceState === 'listening' && (
              <b className="fh-vmic__elapsed">
                {Math.floor(voiceElapsed / 60)}:{String(voiceElapsed % 60).padStart(2, '0')}
              </b>
            )}
          </div>
          <div className="fh-vmic__title">
            {voiceState === 'listening' ? 'Capturing your lead…' :
             voiceState === 'parsing'   ? 'Filling the fields' :
             voiceState === 'denied'    ? 'Enable mic to use voice' :
             voiceState === 'error'     ? 'Voice not available here' :
             'One sentence. AI fills every field.'}
          </div>
          <div className={`fh-vmic__hint${voiceState === 'denied' || voiceState === 'error' ? ' is-error' : ''}`}>
            {voiceState === 'listening' ? 'Tap mic to stop · transcript appears below' :
             voiceState === 'parsing'   ? 'Hang tight — applying values to the form…' :
             voiceState === 'denied'    ? 'Enable mic in browser settings, then tap again.' :
             voiceState === 'error'     ? 'Fill the fields manually below.' :
             'Tap the mic, talk like you would to a coworker.'}
          </div>
        </div>
      </div>

      {/* Compact transcript rail — only renders when something has been
          said (or is mid-parse). Mirrors the v3 transcript-rail:
          play glyph + transcript preview + WORDS stamp. */}
      {(transcript || voiceState === 'parsing') && (
        <div className="fh-vtrail" aria-live="polite">
          <div className="fh-vtrail__icn" aria-hidden="true">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><path d="m6 4 14 8L6 20z"/></svg>
          </div>
          <div className="fh-vtrail__main">
            <div className="fh-vtrail__txt">
              {transcript ? `"${transcript}"` : 'Parsing transcript…'}
            </div>
            <div className="fh-vtrail__meta">
              {transcript
                ? `${transcript.trim().split(/\s+/).filter(Boolean).length} words${voiceState === 'listening' ? ' · live' : voiceState === 'parsing' ? ' · parsing' : ''}`
                : 'Working'}
            </div>
          </div>
        </div>
      )}

      {/* Section divider — flips the surface from "voice capture" mode
          to "edit fields" mode. Mirrors section-lbl from styles-refine. */}
      <div className="fh-vsection">
        <span>{NounCap} details</span>
        <span className="fh-vsection__hint">tap any field to edit</span>
      </div>

      {/* Document intelligence — Phase 19/#1. Photo of a paper bid /
          handwritten estimate / inbound email screenshot → Claude Vision
          extracts name/phone/email/address/job_title/job_type/amount/
          notes and fills the empty fields below. */}
      <div style={{ padding: '0 0 6px' }}>
        <DocIntakeButton
          label="Scan a doc"
          description="Photo of a bid, handwritten estimate, business card, or paste an email screenshot. AI fills the form."
          onParse={parseDoc}
        />
      </div>

          {/* Client link — optional, picks an existing fh_clients row or
              inline-creates one so this new job inherits client_id. */}
          <V3Field label="Client">
            <ClientPicker
              userId={userId}
              value={client}
              onChange={handleClientChange}
            />
          </V3Field>

          {/* Contact — maxLength on each input matches FIELD_LIMITS so the
              browser blocks typing past the cap. set() also clamps in JS
              so paste flows can't bypass. */}
          <V3Field label={form.stage === 'lead' ? 'Customer' : 'Name'}>
            <input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              maxLength={FIELD_LIMITS.name}
              placeholder="Homeowner or company"
              autoComplete="name"
              style={V3_INPUT}
            />
          </V3Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <V3Field label="Phone">
              <input
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                value={form.phone}
                onChange={(e) => set('phone', e.target.value)}
                maxLength={FIELD_LIMITS.phone}
                placeholder="(555) 555-0100"
                style={V3_INPUT}
              />
            </V3Field>
            <V3Field label="Email">
              <input
                type="email"
                inputMode="email"
                autoComplete="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                maxLength={FIELD_LIMITS.email}
                placeholder="name@domain.com"
                style={V3_INPUT}
              />
            </V3Field>
          </div>

          <V3Field label="Address">
            <input
              value={form.address}
              onChange={(e) => set('address', e.target.value)}
              maxLength={FIELD_LIMITS.address}
              placeholder="1234 Main St · Murfreesboro, TN"
              autoComplete="street-address"
              style={V3_INPUT}
            />
          </V3Field>

          <V3Field label="Company">
            <input
              value={form.company}
              onChange={(e) => set('company', e.target.value)}
              maxLength={FIELD_LIMITS.company}
              placeholder="(optional) Acme Construction LLC"
              style={V3_INPUT}
            />
          </V3Field>

          {!lockStage && (
            <V3ChipRow
              label="Pipeline step"
              value={form.stage}
              options={STAGE_OPTIONS}
              onChange={(v: any) => setStage(v)}
            />
          )}

          {/* Stage-aware capture (audit §C2): a lead is a CRM record,
              not a job. Lead stage shows Source + estimated value;
              job-execution fields (job type / template / title) only
              appear once the deal reaches Quote or Job stage. */}
          {form.stage === 'lead' && (
            <V3Field label="Source">
              <input
                value={form.referred_by}
                onChange={(e) => set('referred_by', e.target.value)}
                maxLength={FIELD_LIMITS.referred_by}
                placeholder="Referral, web, repeat client, yard sign…"
                style={V3_INPUT}
              />
            </V3Field>
          )}

          <V3ChipRow
            label={form.stage === 'lead' ? 'Project type' : 'Job type'}
            value={form.job_type}
            options={JOB_TYPES}
            onChange={(v: any) => set('job_type', v)}
          />

          {form.stage !== 'lead' && availableTemplates.length > 0 && (
            <TemplatePickerInline
              templates={availableTemplates}
              value={templateSlug}
              onChange={setTemplateSlug}
            />
          )}

          <V3Field label={form.stage === 'lead' ? 'What do they need?' : 'Job title'}>
            <input
              value={form.job_title}
              onChange={(e) => set('job_title', e.target.value)}
              maxLength={FIELD_LIMITS.job_title}
              placeholder={form.stage === 'lead' ? 'Kitchen remodel, roof repair, driveway quote' : 'Kitchen remodel + island'}
              style={V3_INPUT}
            />
          </V3Field>

          {/* A lead is a simple capture — who they are + what they need.
              Scope detail and pricing belong on the quote, so those fields
              only appear from the quote stage onward. Keeps the lead form
              short (the "a lead should be its own thing" ask). */}
          {form.stage !== 'lead' && (
            <V3Field label="Quote scope">
              <textarea
                rows={3}
                value={form.scope_text}
                onChange={(e) => set('scope_text', e.target.value)}
                maxLength={FIELD_LIMITS.scope_text}
                placeholder="What they want, timing, constraints, measurements, must-haves..."
                style={{ ...V3_INPUT, resize: 'vertical', minHeight: 84 }}
              />
            </V3Field>
          )}

          {/* Amount is only entered directly on a quick JOB. A quote's total
              is driven by the line items you build (the recalc trigger sets
              fh_contacts.amount), so typing an amount here would just get
              overwritten — we omit it and send you to the line-item builder. */}
          {form.stage === 'job' && (
            <V3Field label="Amount">
              <div style={{ position: 'relative' }}>
                <span aria-hidden="true" style={{
                  position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)',
                  color: 'var(--ink-strong)', fontFamily: 'var(--font-display)', fontSize: 16,
                  pointerEvents: 'none'
                }}>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form.amount}
                  onChange={(e) => set('amount', e.target.value.replace(/[^\d.]/g, ''))}
                  maxLength={FIELD_LIMITS.amount}
                  placeholder="0"
                  style={{ ...V3_INPUT, paddingLeft: 30, fontVariantNumeric: 'tabular-nums' }}
                />
              </div>
            </V3Field>
          )}

          {form.stage !== 'job' && (
            <FollowUpPicker
              value={form.follow_up_on}
              onChange={(next: string) => set('follow_up_on', next)}
            />
          )}

          <V3Field label="Notes">
            <textarea
              rows={3}
              value={form.notes}
              onChange={(e) => set('notes', e.target.value)}
              maxLength={FIELD_LIMITS.notes}
              placeholder="Context, timing, referral source…"
              style={{ ...V3_INPUT, resize: 'vertical', minHeight: 84 }}
            />
          </V3Field>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10, marginTop: 6 }}>
            <button
              type="button"
              onClick={() => onClose?.()}
              disabled={saving}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                padding: '12px 14px', borderRadius: 12,
                background: 'var(--surface-2)', border: '1px solid var(--rule)',
                color: 'var(--ink-strong)',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                cursor: saving ? 'wait' : 'pointer'
              }}
            >
              <X size={14} />
              Cancel
            </button>
            <motion.button
              type="submit"
              whileTap={{ scale: (!form.name.trim() || committed || saving) ? 1 : 0.98 }}
              disabled={!form.name.trim() || committed || saving}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '12px 14px', borderRadius: 12, border: 'none',
                background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                color: 'var(--onyx)',
                fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.14em',
                cursor: (!form.name.trim() || committed || saving) ? 'not-allowed' : 'pointer',
                boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                opacity: (!form.name.trim() || committed || saving) ? 0.55 : 1
              }}
            >
              <Check size={14} />
              {saving ? 'COMMITTING…' : committed ? 'CAPTURED' : `${commitVerb} ${stageNoun.toUpperCase()}`}
            </motion.button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  )
}

// Inline template chip row — renders a "Skip" pseudo-chip + one chip per
// matching template, then if a template is picked shows a small footer
// with the milestone count + description. Visual matches SheetChipRow
// so it feels like a 7th field, not an add-on.
function FollowUpPicker({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const presets = [
    { label: 'Tomorrow', value: dateInputValueFromNow(1) },
    { label: '3 days', value: dateInputValueFromNow(3) },
    { label: '1 week', value: dateInputValueFromNow(7) },
  ]

  return (
    <V3Field label="Next follow-up">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {presets.map((preset) => (
          <TemplateChip
            key={preset.label}
            active={value === preset.value}
            onClick={() => onChange(preset.value)}
            label={preset.label}
          />
        ))}
        <TemplateChip
          active={!value}
          onClick={() => onChange('')}
          label="No date"
        />
      </div>
      <input
        type="date"
        value={value || ''}
        onChange={(e) => onChange(e.target.value)}
        style={{ ...V3_INPUT, marginTop: 8 }}
      />
    </V3Field>
  )
}

function TemplatePickerInline({ templates, value, onChange }: any) {
  const picked = templates.find((t: any) => t.slug === value) || null
  return (
    <V3Field label="Template">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        <TemplateChip
          active={!value}
          onClick={() => onChange('')}
          label="Skip"
        />
        {templates.map((t: any) => (
          <TemplateChip
            key={t.slug}
            active={value === t.slug}
            onClick={() => onChange(t.slug)}
            label={t.label}
          />
        ))}
      </div>
      {picked && (
        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'var(--v3-glass-tint-2)', border: '1px solid var(--v3-border-strong)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flexShrink: 0, fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.14em', color: 'var(--ink-strong)' }}>
            +{picked.todos.length}
          </span>
          <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'var(--ink-muted)', lineHeight: 1.35 }}>
            {picked.description}
          </span>
        </div>
      )}
    </V3Field>
  )
}

/* ─── v3 field primitives — match the inline pattern in NewClientSheet
       so this sheet stops looking foggy/sepia compared to its siblings.
       Inputs are boxed (not underlined), chips use the gold-tinted
       pill rather than the dark+gold gradient from the legacy
       fh-asheet-chip CSS. ─── */

const V3_LABEL = {
  fontSize: 10, fontWeight: 700, letterSpacing: '0.14em',
  textTransform: 'uppercase', color: 'var(--ink-muted)'
}

const V3_INPUT: import('react').CSSProperties = {
  padding: '11px 14px',
  borderRadius: 12,
  background: 'var(--surface-2)',
  border: '1px solid var(--rule)',
  color: 'var(--ink-strong)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  scrollMarginTop: 96,
  scrollMarginBottom: 120
}

function V3Field({ label, children }: any) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={V3_LABEL}>{label}</span>
      {children}
    </label>
  )
}

function V3ChipRow({ label, value, options, onChange }: any) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={V3_LABEL}>{label}</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {options.map((opt: any) => {
          const active = value === opt.value
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => onChange(opt.value)}
              style={{
                padding: '7px 12px',
                borderRadius: 999,
                border: active
                  ? '1px solid var(--v3-border-strong)'
                  : '1px solid var(--rule)',
                background: active
                  ? 'var(--v3-glass-tint-2)'
                  : 'var(--surface-2)',
                color: active
                  ? 'var(--ink-strong)'
                  : 'var(--ink-muted)',
                fontFamily: 'var(--font-body)',
                fontSize: 12, fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 160ms ease'
              }}
            >
              {opt.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function TemplateChip({ active, onClick, label }: any) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 12px',
        borderRadius: 999,
        border: active ? '1px solid var(--v3-border-strong)' : '1px solid var(--rule)',
        background: active ? 'var(--v3-glass-tint-2)' : 'var(--surface-2)',
        color: active ? 'var(--ink-strong)' : 'var(--ink-strong)',
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        fontWeight: active ? 700 : 500,
        cursor: 'pointer',
        whiteSpace: 'nowrap'
      }}
    >
      {label}
    </button>
  )
}
