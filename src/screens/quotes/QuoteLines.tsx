// The quote's lines, edited in place (Phase 9, Task 10, decision D57).
//
// The base lines are hairline rows with their money. Tapping one opens it
// into the editor where it stands; a plus row at the bottom adds one. The
// optional lines sit in a paper panel with a switch each, the excluded ones
// under "Not included". Nothing opens in a sheet. The writes go through
// useQuoteItems, the same addItem, updateItem, removeItem and reorderItem
// the desktop builder uses, scoped to the quote (quote_id) or, on the old
// job page, to the job (contact_id).
//
// The money comes from lib/quoteView.ts, the one rule the preview and the
// customer page use too (D31). The parent hears the lines as they stand on
// screen, an optional switch just flipped included, through onChange, and
// prints the total from them.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { Plus, Receipt } from 'lucide-react'
import { Button, EmptyState, Field, Row, SkeletonRows } from '../../components/fh'
import { cx } from '../../components/fh/cx.ts'
import { formatMoney } from '../../components/fh/money.ts'
import DataErrorState from '../../components/DataErrorState.tsx'
import { Switch } from '@/components/ui/switch'
import { keepFocusOnRetry } from '../../lib/retryFocus.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { buildQuoteView, type QuoteTerms } from '../../lib/quoteView.ts'
import {
  applySuggestion,
  draftFromRow,
  emptyDraft,
  matchSuggestions,
  normalizeForDB,
  patchDraft,
  SECTION_SUGGESTIONS,
  useItemSuggestions,
  useQuoteItems
} from '../ContactDetail/sections/QuoteItems.tsx'
import type { ItemSuggestion } from '../ContactDetail/sections/QuoteItems.tsx'
import './quotes.css'

export type QuoteItemsApi = ReturnType<typeof useQuoteItems>

/** What the parent hears about the lines as they stand on screen. */
export type QuoteLinesChange = {
  /** The rows with any optional switch flip applied at once. */
  effective: any[]
  /** A switch save is out: Send, Approve and the share rows wait for it. */
  switchSaving: boolean
}

export type QuoteLinesProps = {
  items: QuoteItemsApi
  userId: string | undefined
  /** What the customer is called ("Optional for Taylor"). */
  who: string
  /** The terms the money reads besides the lines (the quote's amount, its payment terms). */
  money: QuoteTerms
  /** The heading focus returns to when Try again reads the lines again. */
  focusRef?: React.RefObject<HTMLElement | null>
  /** Start with the add editor open (the create screen lands here with ?lines=new). */
  startAdding?: boolean
  onChange?: (change: QuoteLinesChange) => void
}

type Editing = { key: number; id: string | null }

export default function QuoteLines({ items, userId, who, money, focusRef, startAdding = false, onChange }: QuoteLinesProps) {
  const { rows, loading, loaded, failed, fetchRows, addItem, updateItem, removeItem, reorderItem } = items
  // No read of the lines has worked yet and the last one failed: the lines
  // are unknown, so nothing may say there are none.
  const linesFailed = !loading && failed && !loaded
  const suggestions = useItemSuggestions(userId)

  // Optional switches flip here at once (is_optional by line id), then save
  // through updateItem. An entry leaves when the saved row catches up, or
  // when the save fails. `toggled` remembers the lines a switch moved, so
  // they stay in the optional panel (and can flip back) for this visit.
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({})
  const [toggled, setToggled] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setOptimistic((prev) => {
      let next = prev
      for (const id of Object.keys(prev)) {
        const saved = rows.find((r) => r.id === id)
        if (!saved || Boolean(saved.is_optional) === prev[id]) {
          if (next === prev) next = { ...prev }
          delete next[id]
        }
      }
      return next
    })
  }, [rows])

  const effective = useMemo(
    () => rows.map((r) => (r.id in optimistic ? { ...r, is_optional: optimistic[r.id] } : r)),
    [rows, optimistic]
  )
  const live = useMemo(() => buildQuoteView(effective, money), [effective, money])
  const byId = useMemo(
    () => new Map([...live.lines, ...live.optional, ...live.excluded].map((l) => [l.id, l])),
    [live]
  )
  const pending = (id: string) => Boolean(rows.find((r) => r.id === id)?._pending)
  const lines = live.lines.filter((l) => !toggled.has(l.id))
  const optionalRows = effective.filter((r) => !r.is_excluded && (r.is_optional || toggled.has(r.id)))

  // Switch saves in flight, by line id. While one is out, its switch waits
  // with aria-disabled, not disabled: a disabled control that has focus
  // drops it to the page, so a keyboard or switch access user would lose
  // their place on every toggle. The ref turns away the taps meanwhile.
  const switchSavesRef = useRef<Set<string>>(new Set())
  const [switchSaves, setSwitchSaves] = useState<ReadonlySet<string>>(() => new Set())
  const switchSaving = switchSaves.size > 0

  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  useEffect(() => { onChangeRef.current?.({ effective, switchSaving }) }, [effective, switchSaving])

  function toggleOptional(id: string, include: boolean) {
    if (switchSavesRef.current.has(id)) return
    switchSavesRef.current.add(id)
    setSwitchSaves(new Set(switchSavesRef.current))
    hapticTap()
    setToggled((s) => new Set(s).add(id))
    setOptimistic((o) => ({ ...o, [id]: !include }))
    void updateItem(id, { is_optional: !include })
      .then((ok) => {
        if (ok) return
        setOptimistic((o) => {
          const { [id]: _gone, ...rest } = o
          return rest
        })
      })
      .finally(() => {
        switchSavesRef.current.delete(id)
        setSwitchSaves(new Set(switchSavesRef.current))
      })
  }

  // One editor at a time. It remounts on every opening (a new key), so each
  // starts from what is saved and a cancelled edit never leaks into the next.
  const [editing, setEditing] = useState<Editing | null>(startAdding ? { key: 0, id: null } : null)
  const editKey = useRef(0)
  const root = useRef<HTMLDivElement>(null)
  const lastSection = useRef('')

  // Whatever opened the editor gets focus back when it closes, so a
  // keyboard user lands where they were and not at the top of the page.
  const opener = useRef<HTMLElement | null>(null)
  function open(id: string | null) {
    hapticTap()
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    editKey.current += 1
    setEditing({ key: editKey.current, id })
  }
  const close = () => {
    setEditing(null)
    const back = opener.current
    opener.current = null
    // The plus row leaves while the add editor is open, so when it comes
    // back the new one takes the focus instead.
    requestAnimationFrame(() => {
      const target = back && back.isConnected ? back : root.current?.querySelector<HTMLElement>('.fhqt-add')
      target?.focus({ preventScroll: true })
    })
  }
  const editRow = editing?.id ? effective.find((r) => r.id === editing.id) ?? null : null
  const editIndex = editRow ? rows.findIndex((r) => r.id === editRow.id) : -1
  const editPending = editRow ? pending(editRow.id) : false

  async function save(values: ReturnType<typeof normalizeForDB>) {
    if (!editing) return false
    if (!editing.id) {
      lastSection.current = values.section || ''
      void addItem(values)
      return true
    }
    const id = editing.id
    const ok = await updateItem(id, values)
    if (ok) {
      // The editor's kind picker decides now; drop any switch memory.
      setToggled((s) => { const next = new Set(s); next.delete(id); return next })
      setOptimistic((o) => { const { [id]: _gone, ...rest } = o; return rest })
    }
    return ok
  }

  const editor = editing ? (
    <LineEditor
      key={editing.key}
      row={editRow}
      defaultSection={lastSection.current}
      suggestions={suggestions}
      onSave={save}
      onClose={close}
      onDelete={editRow ? () => { close(); void removeItem(editRow.id) } : undefined}
      onMove={editRow ? (direction) => { void reorderItem(editRow.id, direction) } : undefined}
      canMoveUp={editIndex > 0 && !editPending}
      canMoveDown={editIndex >= 0 && editIndex < rows.length - 1 && !editPending}
    />
  ) : null
  const adding = !!editing && !editing.id
  const editorFor = (id: string) => (editing?.id === id ? editor : null)

  return (
    <div className="fhqt-lines" ref={root}>
      {loading ? (
        <div className="fhqt-loading"><SkeletonRows rows={4} label="Loading the quote lines" /></div>
      ) : linesFailed ? (
        <div className="fhqt-loading">
          <DataErrorState
            title="Couldn't load the lines"
            message="Check your connection and try again."
            actionLabel="Try again"
            onRetry={() => {
              keepFocusOnRetry(focusRef?.current ?? null)
              void fetchRows()
            }}
          />
        </div>
      ) : lines.length === 0 && !adding ? (
        <EmptyState
          icon={Receipt}
          title="No lines yet."
          action={<Button variant="secondary" icon={Plus} onClick={() => open(null)}>Add a line</Button>}
        />
      ) : (
        <>
          <ul className="fhqt-list" aria-label="Line items">
            {lines.map((line) => (
              editorFor(line.id) ?? (
                <Row
                  key={line.id}
                  as="li"
                  title={line.title}
                  subline={line.detail || undefined}
                  money={line.amount}
                  next={pending(line.id) ? 'Saving' : undefined}
                  disabled={pending(line.id)}
                  onClick={() => open(line.id)}
                />
              )
            ))}
            {adding && editor}
          </ul>
          {!adding && (
            <Button variant="quiet" icon={Plus} className="fhqt-add" onClick={() => open(null)}>Add a line</Button>
          )}
        </>
      )}

      {optionalRows.length > 0 && (
        <section className="fhqt-optional" aria-labelledby="fhqt-optional-title">
          <h2 className="fhqt-optional__title" id="fhqt-optional-title">Optional for {who}</h2>
          <ul className="fhqt-optional__list">
            {optionalRows.map((r) => {
              const line = byId.get(r.id)
              if (!line) return null
              const inline = editorFor(r.id)
              if (inline) return inline
              const included = !r.is_optional
              const showDetail = line.detail && line.detail !== formatMoney(line.amount)
              return (
                <li className="fhqt-opt" key={r.id}>
                  <button type="button" className="fhqt-opt__main" onClick={() => open(r.id)} disabled={pending(r.id)}>
                    <span className="fhqt-opt__title">{line.title}</span>
                    {showDetail && <span className="fhqt-opt__sub">{line.detail}</span>}
                    <span className="fhqt-opt__sub">Adds {formatMoney(line.amount)}</span>
                  </button>
                  <Switch
                    className="fhqt-switch"
                    checked={included}
                    disabled={pending(r.id)}
                    aria-disabled={switchSaves.has(r.id) || undefined}
                    aria-label={`Include ${line.title} in the total`}
                    onCheckedChange={(on: boolean) => toggleOptional(r.id, on)}
                  />
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {live.excluded.length > 0 && (
        <section className="fhqt-excluded" aria-labelledby="fhqt-excluded-title">
          <h2 className="fhqt-excluded__title" id="fhqt-excluded-title">Not included</h2>
          <ul className="fhqt-list" aria-label="Lines that are not included">
            {live.excluded.map((line) => (
              editorFor(line.id) ?? (
                <Row
                  key={line.id}
                  as="li"
                  title={line.title}
                  subline={line.detail || undefined}
                  money={line.amount}
                  onClick={() => open(line.id)}
                />
              )
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

/* ================================================================
   One line, edited where it stands
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

type LineEditorProps = {
  /** null adds a line; a row edits it. */
  row: any | null
  /** The section the last added line used, carried to the next one. */
  defaultSection: string
  suggestions: ItemSuggestion[]
  /** Saves the line. Resolves true when it went through. */
  onSave: (values: LineValues) => Promise<boolean> | boolean
  onClose: () => void
  onDelete?: () => void
  onMove?: (direction: -1 | 1) => void
  canMoveUp?: boolean
  canMoveDown?: boolean
}

function LineEditor({ row, defaultSection, suggestions, onSave, onClose, onDelete, onMove, canMoveUp = false, canMoveDown = false }: LineEditorProps) {
  const adding = !row
  const [draft, setDraft] = useState<LineDraft>(() => (row ? seedFromRow(row) : { ...emptyDraft(), section: defaultSection }))
  const [errors, setErrors] = useState<LineErrors>({})
  const [saving, setSaving] = useState(false)
  const [descFocused, setDescFocused] = useState(false)
  const descRef = useRef<HTMLInputElement | null>(null)
  useEffect(() => { descRef.current?.focus({ preventScroll: true }) }, [])

  const matches = descFocused ? matchSuggestions(suggestions, draft.description) : []
  const kind = draft.is_excluded ? 'excluded' : draft.is_optional ? 'optional' : 'base'
  const title = adding ? 'Add a line' : 'Edit line'

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
      setDraft({ ...emptyDraft(), section: draft.section })
      requestAnimationFrame(() => descRef.current?.focus())
    } else {
      onClose()
    }
  }

  // Enter in a single line field saves, like the desktop card.
  function onKeyDown(e: KeyboardEvent<HTMLFormElement>) {
    if (e.key === 'Escape') { e.preventDefault(); onClose(); return }
    if (e.key !== 'Enter' || e.defaultPrevented) return
    if ((e.target as HTMLElement).tagName !== 'INPUT') return
    if (matches.length > 0) return
    e.preventDefault()
    void submit(false)
  }

  return (
    <li className="fhqt-edit">
      <form aria-label={title} className="fhqt-form" onKeyDown={onKeyDown} onSubmit={(e) => { e.preventDefault(); void submit(false) }}>
        <h3 className="fhqt-form__title">{title}</h3>
        <div className="fhqt-form__suggest">
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
            <ul className="fhqt-suggest" aria-label="Suggestions from your rate card and past quotes">
              {matches.map((s) => (
                <li key={`${s.source}-${s.description}`}>
                  <button
                    type="button"
                    className="fhqt-suggest__item"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => { applySuggestion(setDraft, s); setDescFocused(false) }}
                  >
                    <span className="fhqt-suggest__name">{s.description}</span>
                    <span className="fhqt-suggest__rate">
                      {formatMoney(s.rate)}{s.unit ? ` per ${s.unit}` : ''}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="fhqt-form__pair">
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

        <div className="fhqt-form__pair">
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

        <div className="fhqt-kind">
          <span className="fhqt-kind__label" id="fhqt-kind-label">Where it counts</span>
          <div className="fhqt-seg" role="radiogroup" aria-labelledby="fhqt-kind-label">
            {KINDS.map((k) => (
              <button
                key={k.id}
                type="button"
                role="radio"
                aria-checked={kind === k.id}
                className={cx('fhqt-seg__option', kind === k.id && 'is-on')}
                onClick={() => change('kind', k.id)}
              >
                {k.label}
              </button>
            ))}
          </div>
          <p className="fhqt-kind__help">
            Lines in the total make up the price. Optional and not included lines show on the proposal and never add up.
          </p>
        </div>

        <Field
          label="Section"
          value={draft.section}
          placeholder="Labor, Materials, Subs"
          autoComplete="off"
          list="fhqt-section-suggestions"
          onChange={(e) => change('section', e.target.value)}
        />
        <datalist id="fhqt-section-suggestions">
          {SECTION_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
        </datalist>

        <Field
          label="Notes"
          value={draft.notes}
          placeholder="Such as broom finish"
          autoComplete="off"
          onChange={(e) => change('notes', e.target.value)}
        />

        <div className="fhqt-form__actions">
          <Button type="submit" variant="secondary" block loading={saving}>
            {adding ? 'Add line' : 'Save changes'}
          </Button>
          {adding ? (
            <Button variant="quiet" block disabled={saving} onClick={() => void submit(true)}>
              Add and start another
            </Button>
          ) : (
            <>
              {onMove && (
                <div className="fhqt-form__pair">
                  <Button variant="quiet" block disabled={!canMoveUp} onClick={() => onMove(-1)}>Move up</Button>
                  <Button variant="quiet" block disabled={!canMoveDown} onClick={() => onMove(1)}>Move down</Button>
                </div>
              )}
              {onDelete && (
                <Button variant="destructive" block onClick={onDelete}>Delete line</Button>
              )}
            </>
          )}
          <Button variant="quiet" block onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </li>
  )
}
