import { useId, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import './record-picker.css'

export type RecordOption = { value: string; label: string; description?: string; group?: string }
type Props = {
  id?: string; label: string; value: string; onChange: (value: string) => void
  options: RecordOption[]; placeholder?: string; emptyLabel?: string
  disabled?: boolean; loading?: boolean; error?: string
  allowClear?: boolean; clearLabel?: string
}

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase()
export function filterRecordOptions(options: RecordOption[], query: string): RecordOption[] {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean)
  return options.filter((option) => {
    const text = normalize([option.label, option.description, option.group].filter(Boolean).join(' '))
    return words.every((word) => text.includes(word))
  })
}

/** A controlled, searchable record selector. Typing never changes the saved selection. */
export default function RecordPicker({ id, label, value, onChange, options, placeholder = 'Search records', emptyLabel = 'No matching records', disabled = false, loading = false, error, allowClear = true, clearLabel = 'No linked record' }: Props) {
  const generatedId = useId()
  const inputId = id || `record-${generatedId}`
  const listId = `${inputId}-options`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const selected = options.find((option) => option.value === value)
  const filtered = useMemo(() => filterRecordOptions(options, query), [options, query])
  const shown = allowClear && !query.trim() ? [{ value: '', label: clearLabel }, ...filtered] : filtered
  const current = Math.min(active, Math.max(0, shown.length - 1))

  function choose(option: RecordOption) {
    onChange(option.value)
    setOpen(false)
    setQuery('')
    input.current?.focus()
  }
  function move(index: number) {
    const next = Math.max(0, Math.min(index, shown.length - 1))
    setActive(next)
    requestAnimationFrame(() => document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' }))
  }

  return (
    <div className="fh-record-picker" onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) { setOpen(false); setQuery('') } }}>
      <label htmlFor={inputId}>{label}</label>
      <div className="fh-record-picker__field">
        <input ref={input} id={inputId} role="combobox" type="text" autoComplete="off"
          aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
          aria-activedescendant={open && shown[current] ? `${listId}-${current}` : undefined}
          aria-describedby={error ? `${inputId}-error` : undefined} aria-invalid={!!error}
          disabled={disabled} placeholder={placeholder}
          value={open ? query : (selected?.label || (value ? 'Linked record unavailable' : clearLabel))}
          onFocus={() => { setOpen(true); setActive(0) }}
          onClick={() => setOpen(true)}
          onChange={(event) => { setQuery(event.target.value); setOpen(true); setActive(0) }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); move(open ? current + (event.key === 'ArrowDown' ? 1 : -1) : 0) }
            else if (event.key === 'Enter' && open) { event.preventDefault(); if (shown[current]) choose(shown[current]) }
            else if (event.key === 'Escape') { event.preventDefault(); setOpen(false); setQuery('') }
            else if (event.key === 'Tab') { setOpen(false); setQuery('') }
          }}
        />
        <ChevronDown size={16} aria-hidden="true" />
      </div>
      {selected?.description && !open && <p className="fh-record-picker__description">{selected.description}</p>}
      {open && (
        <div className="fh-record-picker__results">
          <div role="status" className="fh-record-picker__status">{loading ? 'Loading records' : `${filtered.length} ${filtered.length === 1 ? 'record' : 'records'} found`}</div>
          <div id={listId} role="listbox" aria-label={label} className="fh-record-picker__list">
            {shown.map((option, index) => (
              <div key={option.value} id={`${listId}-${index}`} role="option" aria-selected={option.value === value}
                className={`fh-record-picker__option${index === current ? ' is-active' : ''}`}
                onPointerDown={(event) => event.preventDefault()} onClick={() => choose(option)} onMouseMove={() => setActive(index)}>
                <div><span className="fh-record-picker__name">{option.label}</span>{(option.group || option.description) && <span className="fh-record-picker__description">{[option.group, option.description].filter(Boolean).join(' · ')}</span>}</div>
                {option.value === value && <Check size={16} aria-hidden="true" />}
              </div>
            ))}
          </div>
          {!loading && shown.length === 0 && <p className="fh-record-picker__status">{emptyLabel}</p>}
        </div>
      )}
      {error && <p role="alert" id={`${inputId}-error`} className="fh-record-picker__error">{error}</p>}
    </div>
  )
}
