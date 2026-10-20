// The frame every create screen shares (PHASE9_PLAN Task 8, SPEC D57 to
// D59): Back and the title in a header, the fields, one gold Save button
// at the end, and an error line that says what is wrong. The screen is
// phone first; the desktop shell shows the same column at 640 px.
//
// The draft hook keeps a half typed form in localStorage under
// fh:draft:<kind> for 24 hours, as the old lead sheet did, so a pocket tap
// or a dead battery loses nothing. It is cleared the moment a save lands.

import { useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Button, IconButton } from '../../components/fh'
import { hapticTap } from '../../lib/haptics.ts'
import './new.css'

const DRAFT_TTL_MS = 24 * 60 * 60 * 1000

export function draftKey(kind: string) {
  return `fh:draft:${kind}`
}

export function readDraft<T extends Record<string, unknown>>(kind: string): T | null {
  if (typeof window === 'undefined') return null
  try {
    const raw = window.localStorage.getItem(draftKey(kind))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { form?: T; savedAt?: number }
    if (!parsed?.form || Date.now() - (parsed.savedAt || 0) > DRAFT_TTL_MS) return null
    return parsed.form
  } catch { return null }
}

function hasContent(form: Record<string, unknown>) {
  return Object.values(form).some((v) => typeof v === 'string' ? v.trim() !== '' : v != null && v !== false)
}

export function writeDraft(kind: string, form: Record<string, unknown>) {
  if (typeof window === 'undefined') return
  try {
    if (hasContent(form)) window.localStorage.setItem(draftKey(kind), JSON.stringify({ form, savedAt: Date.now() }))
    else window.localStorage.removeItem(draftKey(kind))
  } catch { /* quota or private mode: drafts are best effort */ }
}

export function clearDraft(kind: string) {
  if (typeof window === 'undefined') return
  try { window.localStorage.removeItem(draftKey(kind)) } catch { /* ignore */ }
}

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
  useEffect(() => {
    if (saved.current) return
    const t = setTimeout(() => writeDraft(kind, form), 400)
    return () => clearTimeout(t)
  }, [kind, form])
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
  error?: string
  /** Where Back goes when there is no history, such as the New screen. */
  backTo?: string
  onSave: () => void | Promise<void>
  children: ReactNode
}

export default function CreateShell({ title, saveLabel, saving = false, error, backTo = '/new', onSave, children }: Props) {
  const navigate = useNavigate()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  function goBack() {
    hapticTap()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate(backTo)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    if (!saving) void onSave()
  }

  return (
    <form className="fhnew" onSubmit={submit} noValidate>
      <header className="fhnew-head">
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
        <h1 className="fhnew-title" ref={titleRef} tabIndex={-1}>{title}</h1>
      </header>
      <div className="fhnew-body">
        {children}
      </div>
      {error && <p className="fhnew-error" role="alert">{error}</p>}
      <div className="fhnew-save">
        <Button type="submit" variant="primary" size="lg" loading={saving}>{saveLabel}</Button>
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
