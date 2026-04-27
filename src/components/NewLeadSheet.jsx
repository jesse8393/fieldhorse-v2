import { useEffect, useMemo, useRef, useState } from 'react'
import ActionSheet, { SheetField, SheetChipRow, SheetMoneyField, haptic } from './ActionSheet.jsx'
import ClientPicker from './ClientPicker.jsx'
import DocIntakeButton from './DocIntakeButton.jsx'
import { supabase } from '../lib/supabase.js'
import { claudeMessage } from '../lib/anthropic.js'
import { parseLeadFromImage } from '../lib/docIntelligence.js'
import { toastSuccess } from '../lib/toast.js'
import { JOB_TYPES } from '../lib/jobTypes.js'
import { getTemplatesForJobType, getTemplate, applyTemplate } from '../lib/jobTemplates.js'

const STAGE_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'quote', label: 'Quote' },
  { value: 'job', label: 'Job' }
]

const LAST_JOB_TYPE_KEY = 'fh:lastJobType'

function readLastJobType() {
  if (typeof window === 'undefined') return ''
  try { return window.localStorage.getItem(LAST_JOB_TYPE_KEY) || '' } catch { return '' }
}

function writeLastJobType(value) {
  if (typeof window === 'undefined' || !value) return
  try { window.localStorage.setItem(LAST_JOB_TYPE_KEY, value) } catch {}
}

function buildEmptyForm() {
  return {
    name: '', phone: '', email: '', address: '',
    job_title: '', job_type: readLastJobType(), amount: '', notes: '', referred_by: '',
    stage: 'lead'
  }
}

const VOICE_SYSTEM = `You are parsing a voice memo from a contractor logging a new lead. Extract structured data from what they said. Return ONLY a single JSON object with these keys — use null for anything not clearly mentioned:
{
  "name": string or null,
  "phone": string or null,
  "email": string or null,
  "address": string or null,
  "job_title": string or null,
  "job_type": one of [${JOB_TYPES.map(t => `"${t.value}"`).join(', ')}] or null,
  "amount": number or null (dollars, no formatting),
  "stage": one of ["lead", "quote", "job"] or null,
  "notes": string or null (anything else worth capturing),
  "referred_by": string or null
}
Return ONLY the JSON. No prose, no fences.`

export default function NewLeadSheet({ open, userId, onClose, onCreated }) {
  const [form, setForm] = useState(buildEmptyForm)
  const [client, setClient] = useState(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')
  // Picked job-template slug. Reset whenever job_type changes since
  // templates are filtered by trade.
  const [templateSlug, setTemplateSlug] = useState('')

  const [voiceState, setVoiceState] = useState('idle') // idle | listening | parsing | error | denied
  const [transcript, setTranscript] = useState('')
  const [committed, setCommitted] = useState(false)
  const recognitionRef = useRef(null)
  const heldRef = useRef(false)

  useEffect(() => {
    if (!open) {
      setForm(buildEmptyForm())
      setClient(null)
      setErr('')
      setTranscript('')
      setVoiceState('idle')
      setSaving(false)
      setCommitted(false)
      setTemplateSlug('')
    }
  }, [open])

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

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  // Document intelligence — Phase 19/#1. Hands the captured/pasted image
  // to Claude Vision, applies the parsed fields on top of whatever the
  // user already typed (parsed values only fill EMPTY fields so a
  // half-typed form isn't clobbered). Toast tells the user how many
  // fields landed so they know to scan the form before submitting.
  async function parseDoc(dataUrl) {
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
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
    if (!SR) { setVoiceState('error'); return }
    heldRef.current = true
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    let full = ''
    setTranscript('')
    rec.onresult = (e) => {
      let chunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        chunk += e.results[i][0].transcript
      }
      full = chunk
      setTranscript(chunk)
    }
    rec.onerror = (e) => {
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

  async function parseTranscript(text) {
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
          job_type: parsed.job_type || f.job_type,
          amount: parsed.amount != null ? String(parsed.amount) : f.amount,
          stage: parsed.stage || f.stage,
          notes: parsed.notes || f.notes,
          referred_by: parsed.referred_by || f.referred_by
        }))
      }
    } catch (e) {
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
    // Match-then-create strategy: phone first (most reliable), email
    // second, name+empty-phone third.
    let resolvedClientId = client?.id || null
    if (!resolvedClientId) {
      try {
        const phone = (form.phone || '').trim()
        const email = (form.email || '').trim().toLowerCase()
        const nm = form.name.trim()
        let existing = null
        if (phone) {
          const { data } = await supabase
            .from('fh_clients').select('id').eq('user_id', userId).eq('phone', phone).maybeSingle()
          existing = data
        }
        if (!existing && email) {
          const { data } = await supabase
            .from('fh_clients').select('id').eq('user_id', userId).ilike('email', email).maybeSingle()
          existing = data
        }
        if (existing) {
          resolvedClientId = existing.id
        } else {
          const { data: created } = await supabase
            .from('fh_clients').insert({
              user_id: userId,
              name: nm,
              phone: phone || null,
              email: email || null,
              address: form.address || null
            }).select('id').single()
          resolvedClientId = created?.id || null
        }
      } catch (e) {
        // Non-fatal — log and proceed with null client_id. The job still
        // saves; the user can link a client later from the job detail.
        console.warn('[lead] auto-client upsert failed', e)
      }
    }

    const payload = {
      user_id: userId,
      name: form.name.trim(),
      phone: form.phone || null,
      email: form.email || null,
      address: form.address || null,
      job_title: form.job_title || null,
      job_type: form.job_type || null,
      amount: Number(form.amount) || 0,
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
    } catch (err) {
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

  function onVoiceTap(e) {
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

  return (
    <ActionSheet
      open={open}
      title={committed ? 'Lead captured.' : 'New lead.'}
      accentWord={committed ? 'captured' : 'lead'}
      sectionLabel="New lead"
      stepCount={3}
      currentStep={currentStep}
      commitLabel={saving ? 'Committing…' : committed ? 'Captured' : 'Commit lead'}
      commitBusy={saving}
      commitDisabled={!form.name.trim() || committed}
      onClose={onClose}
      onCommit={commit}
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

      {/* Voice capture hero */}
      <div className="fh-voice-hero">
        <div className="fh-voice-hero__head">
          <span className="fh-voice-hero__label">Fast capture</span>
          {/* Removed the "AI · SONNET 4" version chip — it implies a
              specific live model that may not be reachable, and the
              version detail isn't useful to the user. The voice +
              parse flow surfaces real errors when AI is down. */}
        </div>
        <p className="fh-voice-hero__desc">One sentence. AI fills every field.</p>
        <button
          type="button"
          className={`fh-voice-hero__btn${voiceState === 'listening' ? ' is-recording' : ''}${voiceState === 'denied' ? ' is-denied' : ''}`}
          aria-label={voiceState === 'listening' ? 'Stop voice capture' : 'Start voice capture'}
          disabled={voiceState === 'parsing' || saving}
          onClick={onVoiceTap}
        >
          <svg className="fh-voice-hero__mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11 V12 A7 7 0 0 0 19 12 V11" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="8" y1="22" x2="16" y2="22" />
          </svg>
          <span className="fh-voice-hero__btnLabel">{voiceLabel}</span>
        </button>
        <div
          className={[
            'fh-voice-hero__transcript',
            voiceState === 'listening' ? 'is-listening' : '',
            voiceState === 'parsing' ? 'is-parsing' : '',
            transcript ? 'is-result' : '',
            !transcript && voiceState === 'idle' ? 'is-idle' : ''
          ].filter(Boolean).join(' ')}
          aria-live="polite"
        >
          {voiceState === 'listening' && !transcript && 'Listening…'}
          {voiceState === 'parsing' && !transcript && 'Parsing…'}
          {transcript && `"${transcript}"`}
          {voiceState === 'idle' && !transcript && (
            <span className="fh-voice-hero__transcript-placeholder">
              Transcribed text will appear here
            </span>
          )}
        </div>
        {voiceState === 'denied' && (
          <p className="fh-voice-hero__note">
            Mic access needed for voice capture. Enable it in browser settings and try again.
          </p>
        )}
        {voiceState === 'error' && (
          <p className="fh-voice-hero__note">
            Voice capture isn't available on this browser. Fill the fields manually.
          </p>
        )}
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
      <SheetField label="Client">
        <ClientPicker
          userId={userId}
          value={client}
          onChange={setClient}
        />
      </SheetField>

      {/* Contact */}
      <SheetField label="Name" code="01·NAME">
        <input
          autoFocus
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
          placeholder="Homeowner or company"
        />
      </SheetField>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <SheetField label="Phone" code="02·PHN">
          <input
            type="tel"
            inputMode="tel"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            placeholder="(555) 555-0100"
          />
        </SheetField>
        <SheetField label="Email" code="03·EML">
          <input
            type="email"
            inputMode="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="name@domain.com"
          />
        </SheetField>
      </div>

      <SheetField label="Address" code="04·ADR">
        <input
          value={form.address}
          onChange={(e) => set('address', e.target.value)}
          placeholder="1234 Main St · Murfreesboro, TN"
        />
      </SheetField>

      {/* Stage */}
      <SheetChipRow
        label="Stage"
        code="05·STG"
        value={form.stage}
        options={STAGE_OPTIONS}
        onChange={(v) => set('stage', v)}
      />

      {/* Job type */}
      <SheetChipRow
        label="Job type"
        code="06·TYP"
        value={form.job_type}
        options={JOB_TYPES}
        onChange={(v) => set('job_type', v)}
      />

      {/* Templates — auto-create milestones on commit. Only renders if
          the chosen job_type has matching templates. Picking a template
          shows a count + label so the user knows what they're getting. */}
      {availableTemplates.length > 0 && (
        <TemplatePickerInline
          templates={availableTemplates}
          value={templateSlug}
          onChange={setTemplateSlug}
        />
      )}

      <SheetField label="Job title" code="07·TTL">
        <input
          value={form.job_title}
          onChange={(e) => set('job_title', e.target.value)}
          placeholder="Kitchen remodel + island"
        />
      </SheetField>

      {/* Amount */}
      <SheetMoneyField
        label="Amount"
        code="08·AMT"
        value={form.amount}
        onChange={(v) => set('amount', v)}
      />

      <SheetField label="Notes" code="09·NTS">
        <textarea
          rows={3}
          value={form.notes}
          onChange={(e) => set('notes', e.target.value)}
          placeholder="Context, timing, referral source…"
        />
      </SheetField>

    </ActionSheet>
  )
}

// Inline template chip row — renders a "Skip" pseudo-chip + one chip per
// matching template, then if a template is picked shows a small footer
// with the milestone count + description. Visual matches SheetChipRow
// so it feels like a 7th field, not an add-on.
function TemplatePickerInline({ templates, value, onChange }) {
  const picked = templates.find((t) => t.slug === value) || null
  return (
    <SheetField label="Template">
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, paddingTop: 4 }}>
        <TemplateChip
          active={!value}
          onClick={() => onChange('')}
          label="Skip"
        />
        {templates.map((t) => (
          <TemplateChip
            key={t.slug}
            active={value === t.slug}
            onClick={() => onChange(t.slug)}
            label={t.label}
          />
        ))}
      </div>
      {picked && (
        <div style={{ marginTop: 8, padding: '8px 10px', borderRadius: 8, background: 'rgba(201,150,58,0.07)', border: '1px solid rgba(201,150,58,0.22)', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ flexShrink: 0, fontFamily: 'var(--font-display)', fontSize: 10, letterSpacing: '0.14em', color: 'var(--field-gold-bright)' }}>
            +{picked.todos.length}
          </span>
          <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 11.5, color: 'var(--ink-muted)', lineHeight: 1.35 }}>
            {picked.description}
          </span>
        </div>
      )}
    </SheetField>
  )
}

function TemplateChip({ active, onClick, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: '7px 12px',
        borderRadius: 999,
        border: active ? '1px solid var(--field-gold-bright)' : '1px solid var(--rule)',
        background: active ? 'rgba(201,150,58,0.15)' : 'var(--surface-2)',
        color: active ? 'var(--field-gold-bright)' : 'var(--ink-strong)',
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
