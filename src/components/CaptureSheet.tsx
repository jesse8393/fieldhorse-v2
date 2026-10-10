// src/components/CaptureSheet.tsx
//
// Universal Capture, the one gesture that replaces navigating the app
// to do data entry. Opened from anywhere (the dock coin, the desktop
// button, Cmd or Ctrl+J, the command palette) via the `fh:open-capture`
// window event; openCapture({ jobId }) in lib/captureAttach.ts opens it
// attached to the job on screen. The contractor says it, types it, or
// snaps a receipt; Claude routes it into the right action (note, task,
// payment, expense, schedule, lead) matched to the right job; the
// operator confirms one editable card; one tap writes it through the
// same helpers the rest of the app uses.
//
// Trust rules (docs/NORTH_STAR.md): the model proposes and the person
// confirms, so nothing writes before Save. normalizeIntent() checks the
// model's reply against the roster, and an attached job only joins that
// roster and fills job_id when the model left it empty.
//
// Failure philosophy: capture must never lose words. AI down, offer
// "save as note". No signal, queue in the offline outbox and sync as a
// note when the connection returns.
//
// Layout (SPEC.md 9.5, base/capture.jpg): the fh Sheet titled Capture
// with Done; a voice panel on the tray (microphone, text, File it, then
// Heard, Filed as chips, the job line with Change, Save and Edit); and
// the "Or start with" rows into flows that already exist.

import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Camera, ChevronRight, Clock, FileText, HandCoins, Keyboard, Mic,
  NotepadText, ReceiptText, Square, Users
} from 'lucide-react'
import Button from './fh/Button.tsx'
import Chip from './fh/Chip.tsx'
import Field from './fh/Field.tsx'
import Icon from './fh/Icon.tsx'
import Row from './fh/Row.tsx'
import Sheet, { useSheet } from './fh/Sheet.tsx'
import { formatMoney } from './fh/money.ts'
import { supabase } from '../lib/supabase.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { hapticTap, hapticSuccess, hapticError } from '../lib/haptics.ts'
import { toastSuccess, toastError, toastInfo } from '../lib/toast.ts'
import { ACTIVE_STAGES } from '../lib/stages.ts'
import { useNavAccess } from '../lib/useNavAccess.ts'
import {
  routeCapture, normalizeIntent, CAPTURE_KIND_META,
  EXPENSE_CATEGORIES, PAYMENT_KINDS,
  type CaptureIntent
} from '../lib/captureIntelligence.ts'
import { seedJob, withAttachedJob, type OpenCaptureDetail } from '../lib/captureAttach.ts'
import { commitCapture, type CaptureContact } from '../lib/captureActions.ts'
import { pushOutbox, flushOutbox, outboxCount } from '../lib/captureOutbox.ts'
import { compressImageToDataUrl, parseExpenseFromImage } from '../lib/docIntelligence.ts'
import { speechErrorFeedback } from '../lib/speech.ts'
import './capture-sheet.css'

type Phase = 'input' | 'parsing' | 'confirm' | 'saving'
// Where the words came from, for the "Heard" line.
type Source = 'voice' | 'text' | 'receipt'

const ROSTER_COLUMNS = 'id,user_id,name,job_title,stage,amount'

export default function CaptureSheet() {
  const { user } = useAuth()
  const { canSee } = useNavAccess()
  const [open, setOpen] = useState(false)
  const [phase, setPhase] = useState<Phase>('input')
  const [text, setText] = useState('')
  const [intent, setIntent] = useState<CaptureIntent | null>(null)
  const [contacts, setContacts] = useState<CaptureContact[]>([])
  // The job the sheet was opened on (openCapture({ jobId })), and its row
  // once loaded. Work past the roster's 100 most recent rows, and closed
  // or lost work, is not in `contacts`, so the row is fetched by id.
  const [attachedJobId, setAttachedJobId] = useState<string | null>(null)
  const [attachedJob, setAttachedJob] = useState<CaptureContact | null>(null)
  const [listening, setListening] = useState(false)
  const [source, setSource] = useState<Source>('text')
  const [elapsedMs, setElapsedMs] = useState(0)
  const [heardMs, setHeardMs] = useState<number | null>(null)
  const [editing, setEditing] = useState(false)
  const [choosingJob, setChoosingJob] = useState(false)
  // The amount as typed, so "25." keeps its point while editing.
  const [amountDraft, setAmountDraft] = useState<string | null>(null)
  const recRef = useRef<any>(null)
  const voiceStartRef = useRef(0)
  const fileRef = useRef<HTMLInputElement>(null)
  // Bumped on every reset, so a parse that returns after the sheet was
  // closed or started over does not bring its card back.
  const runRef = useRef(0)
  const ids = useId()

  /* ── open via global event + Cmd/Ctrl+J ─────────────────── */
  useEffect(() => {
    function onOpen(e: Event) {
      const jobId = (e as CustomEvent<OpenCaptureDetail | null | undefined>).detail?.jobId
      setAttachedJobId(typeof jobId === 'string' && jobId ? jobId : null)
      setOpen(true)
    }
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault()
        setOpen(true)
      }
    }
    window.addEventListener('fh:open-capture', onOpen)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('fh:open-capture', onOpen)
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  /* ── offline outbox: sync queued captures when we can ──────── */
  const flush = useCallback(async () => {
    if (!user?.id || !navigator.onLine || outboxCount() === 0) return
    const n = await flushOutbox(user.id)
    if (n > 0) toastSuccess(`Synced ${n} offline capture${n === 1 ? '' : 's'}`, 'Saved to Notes')
  }, [user?.id])

  useEffect(() => {
    flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [flush])

  /* ── roster: active leads + jobs for matching, plus the attached job ── */
  useEffect(() => {
    if (!open || !user) return
    let alive = true
    ;(async () => {
      const { data } = await supabase
        .from('fh_contacts')
        .select(ROSTER_COLUMNS)
        .in('stage', ACTIVE_STAGES)
        .order('updated_at', { ascending: false })
        .limit(100)
      const list = (data ?? []) as CaptureContact[]
      let job: CaptureContact | null = null
      if (attachedJobId) {
        job = list.find((c) => c.id === attachedJobId) ?? null
        if (!job) {
          const res = await supabase
            .from('fh_contacts')
            .select(ROSTER_COLUMNS)
            .eq('id', attachedJobId)
            .maybeSingle()
          job = (res.data as CaptureContact | null) ?? null
        }
      }
      if (!alive) return
      if (data) setContacts(list)
      setAttachedJob(job)
    })()
    return () => { alive = false }
  }, [open, user, attachedJobId])

  // Elapsed time while the microphone is open.
  useEffect(() => {
    if (!listening) return
    const timer = window.setInterval(() => setElapsedMs(Date.now() - voiceStartRef.current), 500)
    return () => window.clearInterval(timer)
  }, [listening])

  // Everything the model sees and normalizeIntent checks against, with
  // the attached job first.
  const roster = withAttachedJob(contacts, attachedJob)
  const attachedId = attachedJob?.id ?? null
  const meta = intent ? CAPTURE_KIND_META[intent.kind] : null
  const busy = phase === 'parsing' || phase === 'saving'
  const saving = phase === 'saving'
  // The confirm card stays mounted while the save is in flight.
  const inConfirm = phase === 'confirm' || phase === 'saving'

  function reset() {
    runRef.current += 1
    stopVoice()
    setPhase('input')
    setText('')
    setIntent(null)
    setSource('text')
    setHeardMs(null)
    setEditing(false)
    setChoosingJob(false)
    setAmountDraft(null)
  }

  function finish() {
    setOpen(false)
    reset()
    setAttachedJobId(null)
    setAttachedJob(null)
  }

  // Done, the grabber, Escape, or a start row leaving for its own flow.
  function close() {
    if (phase === 'saving') return
    finish()
  }

  // The card opens on what still needs the person: a missing amount opens
  // the fields, a payment with no job opens the job select.
  function enterConfirm(next: CaptureIntent) {
    setIntent(next)
    setAmountDraft(null)
    setEditing((next.kind === 'payment' || next.kind === 'expense') && !next.amount)
    setChoosingJob(next.kind === 'payment' && !next.job_id)
    setPhase('confirm')
  }

  /* ── voice ─────────────────────────────────────────────────── */
  function startVoice() {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    if (!SR) {
      toastInfo('Voice not supported here', 'Type it instead, same magic.')
      return
    }
    hapticTap()
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = 'en-US'
    let final = ''
    rec.onresult = (e: any) => {
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const t = e.results[i][0].transcript
        if (e.results[i].isFinal) final += t
        else interim += t
      }
      setText((final + interim).trim())
    }
    rec.onend = () => {
      setListening(false)
      recRef.current = null
      // Voice flows straight into the parse, say it, see the card.
      const spoken = (final || '').trim()
      if (spoken) {
        setHeardMs(Date.now() - voiceStartRef.current)
        submitRef.current(spoken, 'voice')
      }
    }
    rec.onerror = (e: any) => {
      setListening(false)
      recRef.current = null
      // Say why the mic stopped (blocked, no speech, no mic, offline)
      // instead of silently snapping back to "Tap to talk".
      const fb = speechErrorFeedback(e?.error)
      if (fb) (fb.tone === 'info' ? toastInfo : toastError)(fb.title, fb.description)
    }
    recRef.current = rec
    voiceStartRef.current = Date.now()
    setElapsedMs(0)
    setText('')
    setListening(true)
    rec.start()
  }

  function stopVoice() {
    try { recRef.current?.stop() } catch {}
    recRef.current = null
    setListening(false)
  }

  /* ── receipt snap → expense intent ─────────────────────────── */
  async function onReceiptPicked(file: File | null) {
    if (!file || !user) return
    hapticTap()
    setSource('receipt')
    setHeardMs(null)
    setPhase('parsing')
    const run = runRef.current
    try {
      const dataUrl = await compressImageToDataUrl(file)
      const parsed = await parseExpenseFromImage(dataUrl)
      if (run !== runRef.current) return
      const next = normalizeIntent({ kind: 'expense', confidence: 0.8, ...parsed }, roster)
      if (!next) throw new Error('Could not read that receipt')
      enterConfirm(seedJob(next, attachedId))
    } catch (e: any) {
      if (run !== runRef.current) return
      hapticError()
      toastError("Couldn't read the receipt", e?.message || 'Add it by voice or text instead.')
      setSource('text')
      setPhase('input')
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  /* ── parse ─────────────────────────────────────────────────── */
  async function submit(raw?: string, from: Source = 'text') {
    const input = (raw ?? text).trim()
    if (!input || phase === 'parsing' || phase === 'saving' || !user) return
    stopVoice()

    if (!navigator.onLine) {
      // The queue refuses new captures when full; keep the words in the
      // sheet rather than claiming they were saved.
      if (!pushOutbox(input, user.id)) {
        setText(input)
        hapticError()
        toastError("Couldn't save offline", 'Offline storage is full. Reconnect to sync, then try again.')
        return
      }
      hapticSuccess()
      toastSuccess('Captured offline', "It'll sync as a note when you're back in signal.")
      close()
      return
    }

    setText(input)
    setSource(from)
    if (from !== 'voice') setHeardMs(null)
    setPhase('parsing')
    const run = runRef.current
    try {
      const next = await routeCapture({ text: input, roster })
      if (run !== runRef.current) return
      enterConfirm(seedJob(next, attachedId))
      hapticTap()
    } catch {
      if (run !== runRef.current) return
      // AI unavailable, words still must not be lost.
      enterConfirm(seedJob({ kind: 'note', summary: 'Save a note', job_id: null, confidence: 0, text: input }, attachedId))
    }
  }
  // The recognizer's end handler outlives the render that started it;
  // it calls the latest submit so it sees the loaded roster.
  const submitRef = useRef(submit)
  submitRef.current = submit

  /* ── commit ────────────────────────────────────────────────── */
  async function save(forced?: CaptureIntent) {
    const it = forced ?? intent
    if (!it || !user || phase === 'saving') return
    setPhase('saving')
    try {
      const result = await commitCapture({ intent: it, userId: user.id, contacts: roster })
      hapticSuccess()
      toastSuccess(result.toast, it.summary)
      finish()
      // Deliberately no auto-navigation, capture is fire-and-forget;
      // the operator stays on whatever screen they were working in.
      void result.link
    } catch (e: any) {
      hapticError()
      toastError("Couldn't save that", e?.message || 'Try again.')
      setPhase('confirm')
    }
  }

  function saveAsNote() {
    const body = intent?.text || intent?.description || text
    if (!body) return
    save({ kind: 'note', summary: 'Save a note', job_id: intent?.job_id ?? null, confidence: 1, text: body })
  }

  function patch(p: Partial<CaptureIntent>) {
    setIntent((cur) => (cur ? { ...cur, ...p } : cur))
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (inConfirm) save()
    else submit()
  }

  // Words that are not saved yet: closing asks first.
  const dirty = !saving && (inConfirm || text.trim() !== '')

  const intentJob = intent?.job_id ? roster.find((c) => c.id === intent.job_id) ?? null : null
  const chips = intent ? filedAs(intent, intentJob) : []
  const detail = intent ? detailLine(intent, text) : null

  const starts = startRows({
    job: attachedJob,
    canSee,
    onExpense: () => fileRef.current?.click()
  })

  const voiceStatus = phase === 'parsing'
    ? (source === 'receipt' ? 'Reading the receipt' : 'Filing it')
    : listening ? 'Listening' : 'Tap to talk'
  const voiceHint = listening
    ? 'Tap the square to finish.'
    : 'A payment, task, lead or note.'

  const heardLabel = source === 'voice' ? 'Heard' : source === 'receipt' ? 'Read from the receipt' : 'You typed'
  const heardIcon: LucideIcon = source === 'voice' ? Mic : source === 'receipt' ? ReceiptText : Keyboard
  const heardText = source === 'receipt' ? null : text.trim()

  return (
    <Sheet
      open={open}
      onOpenChange={(next) => { if (next) setOpen(true); else close() }}
      title="Capture"
      headerAction={<DoneButton />}
      dirty={dirty}
      discard={{
        title: 'Discard this capture?',
        body: 'What you said or typed is not saved yet.',
        confirmLabel: 'Discard',
        cancelLabel: 'Keep it'
      }}
      className="fh-capture"
    >
      <form className="fh-capture__form" onSubmit={onSubmit}>
        {!inConfirm && (
          <div className="fh-capture__panel">
            <div className="fh-capture__voice">
              <button
                type="button"
                className={`fh-capture__mic${listening ? ' is-listening' : ''}`}
                onClick={() => (listening ? stopVoice() : startVoice())}
                disabled={phase === 'parsing'}
                aria-label={listening ? 'Stop listening' : 'Start talking'}
              >
                <Icon icon={listening ? Square : Mic} size={24} />
              </button>
              <div className="fh-capture__voice-text" aria-live="polite">
                <span className="fh-capture__voice-label">{voiceStatus}</span>
                <span className="fh-capture__voice-hint">{voiceHint}</span>
              </div>
              {listening && <span className="fh-capture__time">{clock(elapsedMs)}</span>}
            </div>

            <Field
              multiline
              label="Or type it"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Got a $2,500.00 deposit check from Henderson."
              rows={3}
              disabled={busy || listening}
            />

            {attachedJob && (
              <p className="fh-capture__attach">Attached to {jobLabel(attachedJob)}.</p>
            )}

            <Button
              type="submit"
              variant="primary"
              size="lg"
              block
              loading={phase === 'parsing'}
              disabled={listening || !text.trim()}
            >
              File it
            </Button>
          </div>
        )}

        {inConfirm && intent && meta && (
          <div className="fh-capture__panel">
            <div className="fh-capture__heard">
              <div className="fh-capture__heard-head">
                <Icon icon={heardIcon} size={22} />
                <span className="fh-capture__heard-label">{heardLabel}</span>
                {source === 'voice' && heardMs != null && (
                  <span className="fh-capture__time">{clock(heardMs)}</span>
                )}
              </div>
              {heardText && <p className="fh-capture__quote">“{heardText}”</p>}
            </div>

            <hr className="fh-capture__rule" />

            <div className="fh-capture__filed">
              <p className="fh-capture__caption" id={`${ids}-filed`}>Filed as</p>
              <ul className="fh-capture__chips" aria-labelledby={`${ids}-filed`}>
                {chips.map((label, i) => (
                  <li key={`${i}-${label}`}><Chip label={label} /></li>
                ))}
              </ul>
              {detail && <p className="fh-capture__detail">{detail}</p>}
            </div>

            {intent.kind !== 'lead' && (
              <p className="fh-capture__attach">
                {attachLine(intent, intentJob, attachedId)}{' '}
                <button
                  type="button"
                  className="fh-capture__change"
                  aria-label="Change job"
                  aria-expanded={choosingJob}
                  aria-controls={choosingJob ? `${ids}-job` : undefined}
                  onClick={() => setChoosingJob((v) => !v)}
                  disabled={saving}
                >
                  Change
                </button>
              </p>
            )}

            {choosingJob && intent.kind !== 'lead' && (
              <SelectField
                id={`${ids}-job`}
                label="Job"
                value={intent.job_id || ''}
                onChange={(v) => patch({ job_id: v || null })}
                options={[
                  { value: '', label: 'No job' },
                  ...roster.map((c) => ({
                    value: c.id,
                    label: `${c.name || 'Unnamed'}${c.job_title ? `, ${c.job_title}` : ''}`
                  }))
                ]}
              />
            )}

            {editing && (
              <div className="fh-capture__fields" id={`${ids}-fields`}>
                {(intent.kind === 'note' || intent.kind === 'todo') && (
                  <Field
                    multiline
                    label={intent.kind === 'todo' ? 'Task' : 'Note'}
                    value={intent.text || ''}
                    onChange={(e) => patch({ text: e.target.value })}
                    rows={3}
                  />
                )}

                {intent.kind === 'todo' && (
                  <Field
                    type="date"
                    label="Due"
                    value={intent.due_at || ''}
                    onChange={(e) => patch({ due_at: e.target.value || null })}
                  />
                )}

                {(intent.kind === 'payment' || intent.kind === 'expense') && (
                  <div className="fh-capture__pair">
                    <Field
                      label="Amount"
                      inputMode="decimal"
                      placeholder="0.00"
                      value={amountDraft ?? (intent.amount != null ? String(intent.amount) : '')}
                      onChange={(e) => {
                        const typed = e.target.value.replace(/[^0-9.]/g, '')
                        setAmountDraft(typed)
                        const n = Number(typed)
                        patch({ amount: Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null })
                      }}
                    />
                    {intent.kind === 'payment' ? (
                      <SelectField
                        id={`${ids}-paykind`}
                        label="For"
                        value={intent.payment_kind || 'other'}
                        onChange={(v) => patch({ payment_kind: v })}
                        options={PAYMENT_KINDS.map((k) => ({ value: k, label: capitalize(k) }))}
                      />
                    ) : (
                      <SelectField
                        id={`${ids}-category`}
                        label="Category"
                        value={intent.category || 'Other'}
                        onChange={(v) => patch({ category: v })}
                        options={EXPENSE_CATEGORIES.map((c) => ({ value: c, label: c }))}
                      />
                    )}
                  </div>
                )}

                {intent.kind === 'expense' && (
                  <Field
                    label="What for"
                    value={intent.description || ''}
                    onChange={(e) => patch({ description: e.target.value })}
                  />
                )}

                {intent.kind === 'schedule' && (
                  <>
                    <Field
                      label="Title"
                      value={intent.title || ''}
                      onChange={(e) => patch({ title: e.target.value })}
                    />
                    <Field
                      type="datetime-local"
                      label="When"
                      value={isoToLocalInput(intent.start_at)}
                      onChange={(e) => {
                        const start = e.target.value ? new Date(e.target.value).toISOString() : null
                        patch({
                          start_at: start,
                          end_at: start ? new Date(Date.parse(start) + 60 * 60 * 1000).toISOString() : null
                        })
                      }}
                    />
                  </>
                )}

                {intent.kind === 'lead' && (
                  <>
                    <div className="fh-capture__pair">
                      <Field
                        label="Name"
                        value={intent.name || ''}
                        onChange={(e) => patch({ name: e.target.value })}
                      />
                      <Field
                        type="tel"
                        label="Phone"
                        value={intent.phone || ''}
                        onChange={(e) => patch({ phone: e.target.value })}
                      />
                    </div>
                    <Field
                      label="Job"
                      value={intent.title || ''}
                      onChange={(e) => patch({ title: e.target.value })}
                      placeholder="Deck rebuild"
                    />
                  </>
                )}
              </div>
            )}

            <div className="fh-capture__actions">
              <Button type="submit" variant="primary" size="lg" block loading={saving}>
                Save
              </Button>
              <Button
                variant="secondary"
                size="lg"
                block
                aria-expanded={editing}
                aria-controls={editing ? `${ids}-fields` : undefined}
                onClick={() => setEditing((v) => !v)}
                disabled={saving}
              >
                Edit
              </Button>
            </div>

            <div className="fh-capture__quiet">
              {intent.kind !== 'note' && (
                <Button variant="quiet" onClick={saveAsNote} disabled={saving}>
                  Just save it as a note
                </Button>
              )}
              <Button variant="quiet" onClick={reset} disabled={saving}>
                Start over
              </Button>
            </div>
          </div>
        )}
      </form>

      {starts.length > 0 && (
        <section className="fh-capture__start" aria-labelledby={`${ids}-start`}>
          <h3 className="fh-capture__start-title" id={`${ids}-start`}>Or start with</h3>
          <ul className="fh-capture__starts" aria-labelledby={`${ids}-start`}>
            {starts.map((s) => {
              const title = (
                <span className="fh-capture__start-label">
                  <span className="fh-capture__tile"><Icon icon={s.icon} size={22} /></span>
                  <span>{s.title}</span>
                </span>
              )
              const next = (
                <span className="fh-capture__hint">
                  <span>{s.hint}</span>
                  <Icon icon={ChevronRight} size={18} className="fh-capture__chev" />
                </span>
              )
              return s.to
                ? <Row key={s.key} as="li" to={s.to} onClick={close} title={title} next={next} />
                : <Row key={s.key} as="li" onClick={() => s.onClick?.()} disabled={busy} title={title} next={next} />
            })}
          </ul>
        </section>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(e) => onReceiptPicked(e.target.files?.[0] || null)}
        hidden
        tabIndex={-1}
        aria-hidden="true"
      />
    </Sheet>
  )
}

// "Done" closes the sheet the way the grabber would, asking first when
// there are words that are not saved yet.
function DoneButton() {
  const { requestClose } = useSheet()
  return (
    <Button variant="quiet" className="fh-capture__done" onClick={requestClose}>
      Done
    </Button>
  )
}

function SelectField({ id, label, value, onChange, options }: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
}) {
  return (
    <div className="fhc-field">
      <label className="fhc-field__label" htmlFor={id}>{label}</label>
      <select
        id={id}
        className="fhc-field__control fh-capture__select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </div>
  )
}

/* ── "Or start with": only flows that already exist ─────────── */

type StartRow = {
  key: string
  icon: LucideIcon
  title: string
  hint: string
  to?: string
  onClick?: () => void
}

function startRows({ job, canSee, onExpense }: {
  job: CaptureContact | null
  canSee: (to: string) => boolean
  onExpense: () => void
}): StartRow[] {
  const rows: (StartRow | false)[] = [
    // Photos live on a job (its Files tab, Photos first), so the row
    // needs one.
    job ? { key: 'photo', icon: Camera, title: 'Photo', hint: 'Opens this job’s photos.', to: `/jobs/${job.id}?tab=files` } : false,
    { key: 'note', icon: NotepadText, title: 'Note', hint: 'Type or talk.', to: '/notes' },
    canSee('/leads') && { key: 'lead', icon: Users, title: 'Lead', hint: 'New customer or request.', to: '/work?new=1' },
    canSee('/quotes') && { key: 'quote', icon: FileText, title: 'Quote', hint: 'From your rate card.', to: '/work?new=1&asStage=quote' },
    // Invoices are sent from a job in progress (SendInvoiceSheet).
    job && isWorkStage(job.stage) && canSee('/invoices')
      ? { key: 'invoice', icon: HandCoins, title: 'Invoice', hint: 'Bill this job.', to: `/jobs/${job.id}?action=send_invoice` }
      : false,
    // The receipt snap lands on this card as an expense to confirm.
    { key: 'expense', icon: ReceiptText, title: 'Expense', hint: 'Snap the receipt.', onClick: onExpense },
    canSee('/crew') && { key: 'time', icon: Clock, title: 'Time', hint: 'Clock in to a job.', to: '/crew' }
  ]
  return rows.filter((r): r is StartRow => !!r)
}

function isWorkStage(stage: string | null | undefined) {
  return stage === 'job' || stage === 'invoice'
}

/* ── the confirm card's words ──────────────────────────────── */

function jobLabel(job: Pick<CaptureContact, 'name' | 'job_title'>) {
  return job.job_title?.trim() || job.name?.trim() || 'Unnamed job'
}

// Kind, the action's facts, its time, and the job.
function filedAs(intent: CaptureIntent, job: CaptureContact | null): string[] {
  const out: string[] = [CAPTURE_KIND_META[intent.kind].label]
  const now = new Date()
  switch (intent.kind) {
    case 'todo':
      if (intent.due_at) out.push(`Due ${dayLabel(ymdToDate(intent.due_at), now).toLowerCase()}`)
      break
    case 'payment': {
      out.push(intent.amount ? formatMoney(intent.amount) : 'No amount yet')
      const kind = intent.payment_kind && intent.payment_kind !== 'other' ? capitalize(intent.payment_kind) : 'Paid'
      const method = intent.method && intent.method !== 'other' ? intent.method : null
      out.push(method ? `${kind} by ${method}` : kind)
      break
    }
    case 'expense':
      out.push(intent.amount ? formatMoney(intent.amount) : 'No amount yet')
      if (intent.category) out.push(intent.category)
      if (intent.expense_date) {
        const d = ymdToDate(intent.expense_date)
        if (!sameDay(d, now)) out.push(dayLabel(d, now))
      }
      break
    case 'schedule':
      if (intent.start_at) {
        const d = new Date(intent.start_at)
        out.push(`${dayLabel(d, now)} ${timeLabel(d)}`)
      }
      break
    case 'lead':
      if (intent.name) out.push(intent.name)
      if (intent.phone) out.push(intent.phone)
      if (intent.follow_up_on) out.push(`Follow up ${dayLabel(ymdToDate(intent.follow_up_on), now).toLowerCase()}`)
      break
  }
  if (job && intent.kind !== 'lead') out.push(jobLabel(job))
  return out
}

// The words that get saved, when the chips do not already carry them.
function detailLine(intent: CaptureIntent, heard: string): string | null {
  switch (intent.kind) {
    case 'note':
    case 'todo': {
      const body = intent.text?.trim()
      if (!body || simplify(body) === simplify(heard)) return null
      return body
    }
    case 'expense':
      return intent.description && intent.description !== 'Expense' ? intent.description : null
    case 'schedule':
    case 'lead':
      return intent.title?.trim() || null
    default:
      return null
  }
}

function attachLine(intent: CaptureIntent, job: CaptureContact | null, attachedId: string | null) {
  if (job) {
    return job.id === attachedId
      ? `Opened from ${jobLabel(job)}, so it files there.`
      : `Files on ${jobLabel(job)}.`
  }
  if (intent.kind === 'payment') return 'Choose the job this payment is for.'
  if (intent.kind === 'todo') return 'Not on a job, so it saves as a note.'
  return 'Not on a job.'
}

function simplify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
}

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

// 0:06
function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function ymdToDate(ymd: string) {
  const [y, m, d] = ymd.split('-').map(Number)
  return new Date(y, (m || 1) - 1, d || 1)
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// Today, Tomorrow, Yesterday, a weekday inside the coming week, else "Oct 16".
function dayLabel(d: Date, now: Date) {
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(d) - start(now)) / 86400000)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days > 1 && days < 7) return d.toLocaleDateString('en-US', { weekday: 'short' })
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// 8:00 am
function timeLabel(d: Date) {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toLowerCase()
}

// ISO (UTC) → value for <input type="datetime-local"> in local time.
function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
