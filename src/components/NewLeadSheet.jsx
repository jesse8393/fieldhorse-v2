import { useEffect, useMemo, useRef, useState } from 'react'
import ActionSheet, { SheetField, SheetChipRow, SheetMoneyField, haptic } from './ActionSheet.jsx'
import { supabase } from '../lib/supabase.js'
import { claudeMessage } from '../lib/anthropic.js'

const STAGE_OPTIONS = [
  { value: 'lead', label: 'Lead' },
  { value: 'quote', label: 'Quote' },
  { value: 'job', label: 'Job' }
]

const JOB_TYPES = [
  { value: 'Kitchen remodel', label: 'Kitchen' },
  { value: 'Bath remodel', label: 'Bath' },
  { value: 'Addition', label: 'Addition' },
  { value: 'New build', label: 'New build' },
  { value: 'Deck', label: 'Deck' },
  { value: 'Roof', label: 'Roof' },
  { value: 'Concrete', label: 'Concrete' },
  { value: 'Fence', label: 'Fence' },
  { value: 'Paint', label: 'Paint' },
  { value: 'Other', label: 'Other' }
]

const EMPTY = {
  name: '', phone: '', email: '', address: '',
  job_title: '', job_type: '', amount: '', notes: '', referred_by: '',
  stage: 'lead'
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
  const [form, setForm] = useState(EMPTY)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState('')

  const [voiceState, setVoiceState] = useState('idle') // idle | listening | parsing | error
  const [transcript, setTranscript] = useState('')
  const recognitionRef = useRef(null)
  const heldRef = useRef(false)

  useEffect(() => {
    if (!open) {
      setForm(EMPTY)
      setErr('')
      setTranscript('')
      setVoiceState('idle')
    }
  }, [open])

  const currentStep = useMemo(() => {
    if (form.amount || form.stage !== 'lead' || form.notes) return 3
    if (form.job_type || form.job_title) return 2
    if (form.name) return 2
    return 1
  }, [form])

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  function startVoice() {
    const SR = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition)
    if (!SR) { setVoiceState('error'); return }
    heldRef.current = true
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    let full = ''
    rec.onresult = (e) => {
      let chunk = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        chunk += e.results[i][0].transcript
      }
      full = chunk
      setTranscript(chunk)
    }
    rec.onerror = () => setVoiceState('error')
    rec.onend = () => {
      if (!heldRef.current) return
      heldRef.current = false
      if (full.trim().length > 2) parseTranscript(full.trim())
      else setVoiceState('idle')
    }
    rec.start()
    recognitionRef.current = rec
    setVoiceState('listening')
    haptic(20)
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
    if (!form.name.trim()) { setErr('Name is required'); return }
    setSaving(true)
    setErr('')
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
      stage: form.stage || 'lead'
    }
    const { data, error } = await supabase
      .from('fh_contacts')
      .insert(payload)
      .select()
      .single()
    setSaving(false)
    if (error) { setErr(error.message); return }
    onCreated?.(data)
  }

  const voiceLabel = {
    idle: 'HOLD TO SPEAK',
    listening: 'LISTENING…',
    parsing: 'PARSING…',
    error: 'VOICE UNAVAILABLE'
  }[voiceState]

  return (
    <ActionSheet
      open={open}
      title="New lead, captured."
      accentWord="lead"
      sectionLabel="New lead"
      stepCount={3}
      currentStep={currentStep}
      commitLabel={saving ? 'Committing…' : 'Commit lead'}
      commitBusy={saving}
      commitDisabled={!form.name.trim()}
      onClose={onClose}
      onCommit={commit}
    >
      {/* Voice capture hero */}
      <div className="fh-voice-hero">
        <div className="fh-voice-hero__head">
          <span className="fh-voice-hero__label">Fast capture</span>
          <span className="fh-voice-hero__chip">AI · SONNET 4</span>
        </div>
        <p className="fh-voice-hero__desc">One sentence. AI fills every field.</p>
        <button
          type="button"
          className={`fh-voice-hero__btn${voiceState === 'listening' ? ' is-recording' : ''}`}
          aria-label="Hold to speak"
          disabled={voiceState === 'error' || voiceState === 'parsing' || saving}
          onPointerDown={(e) => { e.preventDefault(); startVoice() }}
          onPointerUp={(e) => { e.preventDefault(); stopVoice() }}
          onPointerLeave={() => { if (voiceState === 'listening') stopVoice() }}
          onPointerCancel={() => { if (voiceState === 'listening') stopVoice() }}
        >
          <svg className="fh-voice-hero__mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="9" y="3" width="6" height="12" rx="3" />
            <path d="M5 11 V12 A7 7 0 0 0 19 12 V11" />
            <line x1="12" y1="19" x2="12" y2="22" />
            <line x1="8" y1="22" x2="16" y2="22" />
          </svg>
          <span className="fh-voice-hero__btnLabel">{voiceLabel}</span>
        </button>
        {transcript && (
          <p className="fh-voice-hero__transcript">"{transcript}"</p>
        )}
      </div>

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

      {err && (
        <p style={{ color: 'var(--alert-red)', fontSize: '0.85rem', margin: 0 }} role="alert">
          {err}
        </p>
      )}
    </ActionSheet>
  )
}
