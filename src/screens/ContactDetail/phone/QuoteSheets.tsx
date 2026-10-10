import { useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { ChevronRight } from 'lucide-react'
import { Button, Field, Icon, Row, Sheet } from '../../../components/fh'
import { cx } from '../../../components/fh/cx.ts'
import { formatMoney } from '../../../components/fh/money.ts'
import { dateInputToTimestamp, timestampToDateInput } from '../../../lib/dueDate.ts'
import {
  applySuggestion,
  draftFromRow,
  emptyDraft,
  matchSuggestions,
  normalizeForDB,
  patchDraft,
  SECTION_SUGGESTIONS
} from '../sections/QuoteItems.tsx'
import type { ItemSuggestion } from '../sections/QuoteItems.tsx'
import './quote-phone.css'

// The sheets behind the phone Quote tab: one line (add or edit), the scope
// and terms, and the share and download choices. Each one starts from its
// props when it mounts, so QuotePhone mounts a fresh one (a new key) every
// time it opens, and a cancelled edit never leaks into the next opening.

/* ================================================================
   One line
   ================================================================ */

type LineDraft = ReturnType<typeof emptyDraft>
type LineValues = ReturnType<typeof normalizeForDB>
type LineErrors = Partial<Record<'description' | 'qty' | 'rate' | 'amount', string>>

// An edit keeps an amount that was set by hand (it is not quantity times
// rate), and otherwise lets the amount follow quantity and rate.
function seedFromRow(row: any): LineDraft {
  const draft = draftFromRow(row)
  const product = Number(row.qty) * Number(row.rate)
  return { ...draft, amountOverridden: !(Math.abs(Number(row.amount) - product) < 0.005) }
}

const KINDS = [
  { id: 'base', label: 'In the total' },
  { id: 'optional', label: 'Optional' },
  { id: 'excluded', label: 'Not included' }
] as const

export type QuoteLineSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** null adds a line; a row edits it. */
  row: any | null
  /** The section the last added line used, carried to the next one. */
  defaultSection: string
  suggestions: ItemSuggestion[]
  /** Saves the line. Resolves true when it went through. */
  onSave: (values: LineValues) => Promise<boolean> | boolean
  onDelete?: () => void
  onMove?: (direction: -1 | 1) => void
  canMoveUp?: boolean
  canMoveDown?: boolean
}

export function QuoteLineSheet({
  open,
  onOpenChange,
  row,
  defaultSection,
  suggestions,
  onSave,
  onDelete,
  onMove,
  canMoveUp = false,
  canMoveDown = false
}: QuoteLineSheetProps) {
  const adding = !row
  const [draft, setDraft] = useState<LineDraft>(() => (row ? seedFromRow(row) : { ...emptyDraft(), section: defaultSection }))
  const [errors, setErrors] = useState<LineErrors>({})
  const [saving, setSaving] = useState(false)
  const [descFocused, setDescFocused] = useState(false)
  const initial = useRef(JSON.stringify(draft))
  const descRef = useRef<HTMLInputElement | null>(null)

  const dirty = JSON.stringify(draft) !== initial.current
  const matches = descFocused ? matchSuggestions(suggestions, draft.description) : []
  const kind = draft.is_excluded ? 'excluded' : draft.is_optional ? 'optional' : 'base'

  function change(key: string, value: unknown) {
    patchDraft(setDraft, key, value)
    if (key in errors) setErrors((e) => ({ ...e, [key]: undefined }))
  }

  async function submit(again: boolean) {
    const next: LineErrors = {}
    if (!draft.description.trim()) next.description = 'Add a description, such as Excavate and grade.'
    for (const key of ['qty', 'rate', 'amount'] as const) {
      const n = Number(draft[key])
      if (String(draft[key]).trim() === '' || !Number.isFinite(n) || n < 0) next[key] = 'Enter a number, 0 or more.'
    }
    setErrors(next)
    if (Object.keys(next).length > 0 || saving) return
    setSaving(true)
    const ok = await onSave(normalizeForDB(draft))
    setSaving(false)
    if (!ok) return
    if (again) {
      // Quotes are usually entered a section at a time, so the section stays.
      const fresh = { ...emptyDraft(), section: draft.section }
      setDraft(fresh)
      initial.current = JSON.stringify(fresh)
      requestAnimationFrame(() => descRef.current?.focus())
    } else {
      onOpenChange(false)
    }
  }

  // Enter in a single line field saves, like the desktop card.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== 'Enter' || e.defaultPrevented) return
    if ((e.target as HTMLElement).tagName !== 'INPUT') return
    if (matches.length > 0) return
    e.preventDefault()
    void submit(false)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title={adding ? 'Add a line' : 'Edit line'}
      dirty={dirty}
      className="fhq-line-sheet"
      footer={(
        <Button variant="primary" size="lg" block loading={saving} onClick={() => void submit(false)}>
          {adding ? 'Add line' : 'Save changes'}
        </Button>
      )}
    >
      <div className="fhq-form" onKeyDown={onKeyDown}>
        <div className="fhq-form__suggest">
          <Field
            ref={descRef}
            label="Description"
            value={draft.description}
            error={errors.description}
            placeholder="What is this line for?"
            autoComplete="off"
            onChange={(e) => change('description', e.target.value)}
            onFocus={() => setDescFocused(true)}
            onBlur={() => window.setTimeout(() => setDescFocused(false), 180)}
          />
          {matches.length > 0 && (
            <ul className="fhq-suggest" aria-label="Suggestions from your rate card and past quotes">
              {matches.map((s) => (
                <li key={`${s.source}-${s.description}`}>
                  <button
                    type="button"
                    className="fhq-suggest__item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { applySuggestion(setDraft, s); setDescFocused(false) }}
                  >
                    <span className="fhq-suggest__name">{s.description}</span>
                    <span className="fhq-suggest__rate">
                      {formatMoney(s.rate)}{s.unit ? ` per ${s.unit}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="fhq-form__pair">
          <Field
            label="Quantity"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={draft.qty}
            error={errors.qty}
            onChange={(e) => change('qty', e.target.value)}
          />
          <Field
            label="Unit"
            value={draft.unit}
            placeholder="sq ft, hr, ea"
            autoComplete="off"
            onChange={(e) => change('unit', e.target.value)}
          />
        </div>

        <div className="fhq-form__pair">
          <Field
            label="Rate"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={draft.rate}
            error={errors.rate}
            onChange={(e) => change('rate', e.target.value)}
          />
          <Field
            label="Amount"
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={draft.amount}
            error={errors.amount}
            onChange={(e) => change('amount', e.target.value)}
          />
        </div>

        <div className="fhq-kind">
          <span className="fhq-kind__label" id="fhq-kind-label">Where it counts</span>
          <div className="fhq-seg" role="radiogroup" aria-labelledby="fhq-kind-label">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={kind === k.id}
                className={cx('fhq-seg__option', kind === k.id && 'is-on')}
                onClick={() => change('kind', k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="fhq-kind__help">
            Lines in the total make up the price. Optional and not included lines show on the proposal and never add up.
          </p>
        </div>

        <Field
          label="Section"
          value={draft.section}
          placeholder="Labor, Materials, Subs"
          autoComplete="off"
          list="fhq-section-suggestions"
          onChange={(e) => change('section', e.target.value)}
        />
        <datalist id="fhq-section-suggestions">
          {SECTION_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
        </datalist>

        <Field
          label="Notes"
          value={draft.notes}
          placeholder="Such as broom finish"
          autoComplete="off"
          onChange={(e) => change('notes', e.target.value)}
        />

        {adding ? (
          <Button variant="secondary" block disabled={saving} onClick={() => void submit(true)}>
            Add and start another
          </Button>
        ) : (
          <div className="fhq-form__extras">
            {onMove && (
              <div className="fhq-form__pair">
                <Button variant="secondary" block disabled={!canMoveUp} onClick={() => onMove(-1)}>Move up</Button>
                <Button variant="secondary" block disabled={!canMoveDown} onClick={() => onMove(1)}>Move down</Button>
              </div>
            )}
            {onDelete && (
              <Button variant="destructive" block onClick={onDelete}>Delete line</Button>
            )}
          </div>
        )}
      </div>
    </Sheet>
  )
}

/* ================================================================
   Scope and terms
   ================================================================ */

function normText(value: string | null | undefined) {
  const t = String(value || '').trim()
  return t.length === 0 ? null : t
}

export type QuoteTermsSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  contact: any
  patch: (updates: Record<string, any>) => Promise<{ error?: unknown } | undefined> | undefined
}

/* The three customer facing blocks and the expiry date. They save on
   "Save terms" through the same patch the desktop terms section uses, with
   blank text stored as null. The quote's PDF and send read what is saved. */
export function QuoteTermsSheet({ open, onOpenChange, contact, patch }: QuoteTermsSheetProps) {
  const [scope, setScope] = useState<string>(contact?.scope_text || '')
  const [exclusions, setExclusions] = useState<string>(contact?.exclusions_text || '')
  const [terms, setTerms] = useState<string>(contact?.terms_text || '')
  const [expires, setExpires] = useState<string>(timestampToDateInput(contact?.quote_expires_at))
  const [saving, setSaving] = useState(false)
  const initial = useRef(JSON.stringify([scope, exclusions, terms, expires]))
  const dirty = JSON.stringify([scope, exclusions, terms, expires]) !== initial.current

  async function save() {
    if (saving) return
    const updates: Record<string, any> = {}
    if (normText(scope) !== normText(contact?.scope_text)) updates.scope_text = normText(scope)
    if (normText(exclusions) !== normText(contact?.exclusions_text)) updates.exclusions_text = normText(exclusions)
    if (normText(terms) !== normText(contact?.terms_text)) updates.terms_text = normText(terms)
    if (expires !== timestampToDateInput(contact?.quote_expires_at)) updates.quote_expires_at = dateInputToTimestamp(expires)
    if (Object.keys(updates).length === 0) {
      onOpenChange(false)
      return
    }
    setSaving(true)
    const res = await patch(updates)
    setSaving(false)
    // patch already told the person why it failed; keep the text for a retry.
    if (res?.error) return
    onOpenChange(false)
  }

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Scope and terms"
      description="These blocks and the lines become the quote the customer sees."
      dirty={dirty}
      className="fhq-terms-sheet"
      footer={(
        <Button variant="primary" size="lg" block loading={saving} onClick={() => void save()}>
          Save terms
        </Button>
      )}
    >
      <div className="fhq-form">
        <Field
          label="Scope of work"
          multiline
          rows={5}
          value={scope}
          helper="What you will do, in plain English. Two or three sentences is fine."
          onChange={(e) => setScope(e.target.value)}
        />
        <Field
          label="Exclusions"
          multiline
          rows={4}
          value={exclusions}
          helper="What is not included. Spelling it out prevents change order surprises."
          onChange={(e) => setExclusions(e.target.value)}
        />
        <Field
          label="Payment terms"
          multiline
          rows={4}
          value={terms}
          helper="Deposit, progress payments, warranty. Write the deposit as a percent, such as 30% deposit on signing, and the deposit on this screen follows it."
          onChange={(e) => setTerms(e.target.value)}
        />
        <Field
          label="Quote expires"
          type="date"
          value={expires}
          helper="Optional. Helps customers act before pricing changes."
          onChange={(e) => setExpires(e.target.value)}
        />
      </div>
    </Sheet>
  )
}

/* ================================================================
   Share or download
   ================================================================ */

export type QuoteMoreSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** The customer's email, when the contact has one. */
  email: string
  busy: boolean
  onOpenPdf: () => void
  onDownload: () => void
  onShare: () => void
  onEsign: () => void
}

/* The other ways out the door, which the desktop action bar offers: the
   PDF in a new tab, a download, a share link, and DocuSign. Each closes
   the sheet first, then runs the same handler the desktop uses. */
export function QuoteMoreSheet({ open, onOpenChange, email, busy, onOpenPdf, onDownload, onShare, onEsign }: QuoteMoreSheetProps) {
  function run(fn: () => void) {
    onOpenChange(false)
    fn()
  }
  const chevron = <Icon icon={ChevronRight} size={18} className="fhq-chevron" />
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title="Share or download" className="fhq-more-sheet">
      <ul className="fhq-more-list">
        <Row as="li" title="Open the PDF" subline="Builds the proposal and opens it in a new tab." next={chevron} disabled={busy} onClick={() => run(onOpenPdf)} />
        <Row as="li" title="Download the PDF" subline="Saves a copy to this phone." next={chevron} disabled={busy} onClick={() => run(onDownload)} />
        <Row as="li" title="Copy a share link" subline="Makes a link the customer can open, and marks the quote as sent." next={chevron} disabled={busy} onClick={() => run(onShare)} />
        <Row
          as="li"
          title="Send for electronic signature"
          subline={email ? `DocuSign emails a signing request to ${email}.` : 'Add a customer email first.'}
          next={chevron}
          disabled={busy || !email}
          onClick={() => run(onEsign)}
        />
      </ul>
    </Sheet>
  )
}
