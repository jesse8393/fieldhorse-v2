// The frame every create screen shares (PHASE9_PLAN Task 8, SPEC D57 to
// D59): Back and the title in a header, the fields, one gold Save button
// at the end, and an error line that says what is wrong. The screen is
// phone first; the desktop shell shows the same column at 640 px.
//
// The draft hook keeps a half typed form in localStorage under
// fh:draft:<kind> for 24 hours, as the old lead sheet did, so a pocket tap
// or a dead battery loses nothing. It is cleared the moment a save lands.
// The storage, and who each draft belongs to, is lib/drafts.ts.

import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Button, IconButton } from '../../components/fh'
import { hapticTap } from '../../lib/haptics.ts'
import { clearDraft, readDraft, writeDraft } from '../../lib/drafts.ts'
import './new.css'

export { draftKey, readDraft, writeDraft, clearDraft } from '../../lib/drafts.ts'

/**
 * Form state that survives leaving the screen. `initial` is the empty form;
 * `prefill` (from the query string) wins over a saved draft, which is
 * restored only when the screen opens with nothing to prefill.
 */
export function useDraft<T extends Record<string, unknown>>(kind: string, initial: T, prefill?: Partial<T> | null) {
  const [form, setForm] = useState<T>(() => {
    const prefilled = prefill && Object.keys(prefill).length > 0
    if (prefilled) return { ...initial, ...prefill }
    const draft = readDraft<T>(kind)
    return draft ? { ...initial, ...draft } : initial
  })
  const saved = useRef(false)
  // The change the timer below has not written yet. Leaving the screen, or
  // the page going away, writes it at once, so the last words typed before
  // Back or a reload are kept (D23).
  const pending = useRef<{ kind: string; form: T } | null>(null)
  useEffect(() => {
    if (saved.current) return
    pending.current = { kind, form }
    const t = setTimeout(() => { pending.current = null; writeDraft(kind, form) }, 400)
    return () => clearTimeout(t)
  }, [kind, form])
  useEffect(() => {
    function flush() {
      const last = pending.current
      pending.current = null
      if (last && !saved.current) writeDraft(last.kind, last.form)
    }
    // A reload or a closed tab never unmounts the screen.
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])
  function set<K extends keyof T>(key: K, value: T[K]) {
    setForm((f) => ({ ...f, [key]: value }))
  }
  function patch(values: Partial<T>) {
    setForm((f) => ({ ...f, ...values }))
  }
  function done() {
    saved.current = true
    clearDraft(kind)
  }
  return { form, set, patch, done }
}

type Props = {
  title: string
  /** The gold button's label, such as "Save lead". */
  saveLabel: string
  saving?: boolean
  /** Block submission without presenting a save as already in progress. */
  saveDisabled?: boolean
  error?: string
  /** Where Back goes when there is no history, such as the New screen. */
  backTo?: string
  onSave: () => void | Promise<void>
  children: ReactNode
}

export default function CreateShell({ title, saveLabel, saving = false, saveDisabled = false, error, backTo = '/new', onSave, children }: Props) {
  const navigate = useNavigate()
  const titleRef = useRef<HTMLHeadingElement>(null)
  const formRef = useRef<HTMLFormElement>(null)
  const [submitAttempt, setSubmitAttempt] = useState(0)
  // The heading takes focus only when no field asked for it: a screen's
  // autoFocus field (the name on New lead) keeps it, so typing starts at
  // once (S20).
  useEffect(() => {
    if (formRef.current?.contains(document.activeElement)) return
    titleRef.current?.focus({ preventScroll: true })
  }, [])

  // Validation often happens above a phone's current scroll position. After
  // React renders the result, put the first correction back in view.
  useLayoutEffect(() => {
    if (!submitAttempt) return
    const target = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], .fhnew-error')
    if (!target) return
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'center', behavior: 'instant' })
  }, [submitAttempt])

  function goBack() {
    hapticTap()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate(backTo)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (saving || saveDisabled) return
    await onSave()
    setSubmitAttempt(attempt => attempt + 1)
  }

  return (
    <form ref={formRef} className="fhnew" onSubmit={submit} noValidate>
      <header className="fhnew-head">
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
        <h1 className="fhnew-title" ref={titleRef} tabIndex={-1}>{title}</h1>
      </header>
      <div className="fhnew-body">
        {children}
      </div>
      {error && <p className="fhnew-error" role="alert" tabIndex={-1}>{error}</p>}
      <div className="fhnew-save">
        <Button type="submit" variant="primary" size="lg" loading={saving} disabled={saveDisabled}>{saveLabel}</Button>
      </div>
    </form>
  )
}

/** A row of choices, one of which is picked (source, job type, due). */
export function Choices({ label, options, value, onChange }: {
  label: string
  options: { value: string; label: string }[]
  value: string
  onChange: (next: string) => void
}) {
  const id = useId()
  // Long lists belong in the phone's native picker, keeping the actual work
  // fields close together. The empty option retains the existing clear action.
  if (options.length > 5) return (
    <div className="fhc-field">
      <label className="fhc-field__label" htmlFor={id}>{label} <span className="fhnew-optional">Optional</span></label>
      <select id={id} className="fhc-field__control fhnew-select" value={value} onChange={event => onChange(event.target.value)}>
        <option value="">Not selected</option>
        {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  )
  return (
    <fieldset className="fhnew-choices">
      <legend className="fhnew-choices__label">{label}</legend>
      <div className="fhnew-choices__row">
        {options.map((o) => {
          const on = o.value === value
          return (
            <button
              key={o.value}
              type="button"
              className={`fhnew-choice${on ? ' is-on' : ''}`}
              aria-pressed={on}
              onClick={() => onChange(on ? '' : o.value)}
            >
              {o.label}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}

export const LEAD_SOURCES = [
  { value: 'Referral', label: 'Referral' },
  { value: 'Google', label: 'Google' },
  { value: 'Website', label: 'Website' },
  { value: 'Repeat', label: 'Repeat customer' },
  { value: 'Drive by', label: 'Drive by' },
  { value: 'Other', label: 'Other' }
]

/** A price typed by hand: digits and one point, nothing else. */
export function moneyInput(raw: string): string {
  const cleaned = raw.replace(/[^0-9.]/g, '')
  const [whole, ...rest] = cleaned.split('.')
  return rest.length ? `${whole}.${rest.join('').slice(0, 2)}` : whole
}
