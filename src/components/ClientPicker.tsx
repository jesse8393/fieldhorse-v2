import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Search, UserPlus, Check, X } from 'lucide-react'
import { supabase } from '../lib/supabase.ts'
import { useOrgScope } from '../lib/orgScope.ts'
import { useInvalidateClients } from '../lib/queries.ts'
import { escapeLikeText, ilikeAnyOf } from '../lib/searchFilter.ts'
import './ClientPicker.css'

type Client = {
  id: string
  name: string | null
  company_name?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  active_jobs_count?: number | null
}
type Read = { scope: string; retry: number; rows: Client[]; failed: boolean }
type SearchRead = Read & { term: string }
type Props = { userId: string | undefined; value: Client | null; onChange: (value: Client | null) => void }

const CLIENT_COLUMNS = 'id, name, company_name, phone, email, address, active_jobs_count'
const SEARCH_COLUMNS = ['name', 'company_name', 'email', 'phone']
function clientRows(userId: string, orgScope: string | null) {
  const query = supabase.from('fh_clients').select(CLIENT_COLUMNS)
  return orgScope ? query.eq('org_id', orgScope) : query.eq('user_id', userId)
}
function sameName(name: string | null | undefined, typed: string) {
  return (name || '').trim().toLowerCase() === typed.toLowerCase()
}

/** A controlled customer link with an accessible search and confirmed creation. */
export default function ClientPicker({ userId, value, onChange }: Props) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [recent, setRecent] = useState<Read | null>(null)
  const [search, setSearch] = useState<SearchRead | null>(null)
  const [retry, setRetry] = useState(0)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createAttempt, setCreateAttempt] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const unlinkRef = useRef<HTMLButtonElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)
  const previousId = useRef(value?.id)
  const creatingRef = useRef(false)
  const orgScope = useOrgScope(userId)
  const scope = JSON.stringify([userId || '', orgScope === undefined ? 'unresolved' : orgScope])
  const activeScope = useRef<string | null>(scope)
  const invalidateClients = useInvalidateClients()
  const id = useId()
  const trimmed = q.trim()
  const recentRead = recent?.scope === scope && recent.retry === retry ? recent : null
  const searched = trimmed && search?.scope === scope && search.retry === retry && search.term === trimmed ? search : null

  useEffect(() => {
    activeScope.current = scope
    return () => { activeScope.current = null }
  }, [scope])

  useEffect(() => {
    if (previousId.current && !value?.id) inputRef.current?.focus()
    else if (value?.id && value.id !== previousId.current) unlinkRef.current?.focus({ preventScroll: true })
    previousId.current = value?.id
  }, [value?.id])

  useEffect(() => { if (createError) errorRef.current?.focus() }, [createError, createAttempt])

  useEffect(() => {
    if (!open || !userId || orgScope === undefined) return
    let cancelled = false
    void (async () => {
      try {
        const { data, error } = await clientRows(userId, orgScope)
          .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(60)
        if (!cancelled) setRecent({ scope, retry, rows: (data || []) as Client[], failed: !!error })
      } catch {
        if (!cancelled) setRecent({ scope, retry, rows: [], failed: true })
      }
    })()
    return () => { cancelled = true }
  }, [open, userId, orgScope, scope, retry])

  // Recent rows never establish that a name is new. Check the whole book,
  // including an exact lookup, before offering any customer creation.
  useEffect(() => {
    if (!open || !trimmed || !userId || orgScope === undefined) return
    let cancelled = false
    const timer = setTimeout(async () => {
      let next: SearchRead
      try {
        const [matches, exact] = await Promise.all([
          clientRows(userId, orgScope).or(ilikeAnyOf(SEARCH_COLUMNS, trimmed))
            .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(25),
          clientRows(userId, orgScope).ilike('name', escapeLikeText(trimmed)).limit(1)
        ])
        next = { scope, retry, term: trimmed, rows: [...(exact.data || []), ...(matches.data || [])] as Client[], failed: !!(matches.error || exact.error) }
      } catch {
        next = { scope, retry, term: trimmed, rows: [], failed: true }
      }
      if (!cancelled) setSearch(next)
    }, 250)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, trimmed, userId, orgScope, scope, retry])

  useEffect(() => {
    if (!open) return
    function closeOutside(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', closeOutside)
    return () => document.removeEventListener('pointerdown', closeOutside)
  }, [open])

  const filtered = useMemo(() => {
    const needle = trimmed.toLowerCase()
    const rows = (recentRead?.rows || []).filter(row => !needle || [row.name, row.company_name, row.email, row.phone]
      .some(text => text?.toLowerCase().includes(needle)))
    const seen = new Set(rows.map(row => row.id))
    for (const row of searched?.rows || []) {
      if (!seen.has(row.id)) { rows.push(row); seen.add(row.id) }
    }
    return rows
  }, [recentRead, searched, trimmed])
  const exact = trimmed ? filtered.find(row => sameName(row.name, trimmed)) : undefined
  const active = open ? filtered[activeIndex] : undefined
  const pending = orgScope === undefined || (trimmed ? !searched : !recentRead)
  const failed = trimmed ? searched?.failed : recentRead?.failed
  const canCreate = !!userId && orgScope !== undefined && !!trimmed && !!searched && !searched.failed && !exact

  function pick(client: Client) {
    onChange(client)
    setOpen(false)
    setQ('')
    setActiveIndex(-1)
    setCreateError('')
  }

  async function createInline() {
    if (!canCreate || !userId || orgScope === undefined || creatingRef.current) return
    creatingRef.current = true
    setCreating(true)
    setCreateError('')
    try {
      const { data, error } = await supabase.from('fh_clients')
        .insert({ user_id: userId, ...(orgScope ? { org_id: orgScope } : {}), name: trimmed })
        .select(CLIENT_COLUMNS).single()
      if (error || !data) throw error || new Error('Missing saved client')
      if (activeScope.current !== scope) return
      pick(data as Client)
      void invalidateClients()
    } catch {
      if (activeScope.current === scope) setCreateError('Could not add this client. Try again.')
    } finally {
      creatingRef.current = false
      setCreating(false)
      setCreateAttempt(attempt => attempt + 1)
    }
  }

  function retryRead() {
    inputRef.current?.focus({ preventScroll: true })
    setRetry(value => value + 1)
  }

  return (
    <div ref={rootRef} className="fh-client-picker" role="group" aria-labelledby={`${id}-label`}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false) }}>
      <span id={`${id}-label`} className="fh-client-picker__label">Linked client</span>
      {value?.id ? (
        <div className="fh-client-picker__selected">
          <Check size={18} aria-hidden="true" />
          <span>{value.name || 'Linked client'}</span>
          <button ref={unlinkRef} type="button" className="fh-client-picker__unlink" aria-label="Unlink client"
            onClick={() => { onChange(null); setQ(''); setOpen(true); setActiveIndex(-1) }}>
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="fh-client-picker__search">
          <Search size={18} className="fh-client-picker__icon" aria-hidden="true" />
          <input ref={inputRef} id={`${id}-input`} type="text" role="combobox" aria-labelledby={`${id}-label`}
            aria-expanded={open} aria-controls={open ? `${id}-list` : undefined} aria-autocomplete="list"
            aria-activedescendant={active ? `${id}-${active.id}` : undefined}
            autoComplete="off" autoCapitalize="words" value={q} disabled={creating}
            placeholder="Search clients or type a new name"
            onChange={event => { setQ(event.target.value); setOpen(true); setActiveIndex(-1); setCreateError('') }}
            onFocus={() => setOpen(true)}
            onKeyDown={event => {
              if (event.nativeEvent.isComposing) return
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault()
                setOpen(true)
                if (filtered.length) setActiveIndex(index => event.key === 'ArrowDown'
                  ? (index + 1) % filtered.length : (index <= 0 ? filtered.length - 1 : index - 1))
              } else if (event.key === 'Escape' && open) {
                event.preventDefault(); event.stopPropagation(); setOpen(false); setActiveIndex(-1)
              } else if (event.key === 'Enter') {
                event.preventDefault()
                if (!open) setOpen(true)
                else if (active || exact) pick(active || exact!)
                else if (canCreate) void createInline()
              }
            }} />
          {open && (
            <div className="fh-client-picker__popup">
              {pending && <p role="status">{trimmed ? 'Searching all clients…' : 'Loading clients…'}</p>}
              {failed && <div className="fh-client-picker__error" role="alert">
                <p>{trimmed ? "Couldn't search your clients. Retry before creating a client." : "Couldn't load recent clients."}</p>
                <button type="button" onClick={retryRead}>Retry client search</button>
              </div>}
              <ul id={`${id}-list`} role="listbox" aria-label="Matching clients">
                {filtered.map((client, index) => (
                  <li key={client.id} role="presentation">
                    <button id={`${id}-${client.id}`} type="button" role="option" tabIndex={-1}
                      aria-selected={activeIndex === index} className="fh-client-picker__option"
                      onMouseEnter={() => setActiveIndex(index)} onClick={() => pick(client)}>
                      <strong>{client.name || 'Unnamed client'}</strong>
                      {[client.company_name, client.phone || client.email, client.address].filter(Boolean).length > 0 && (
                        <span>{[client.company_name, client.phone || client.email, client.address].filter(Boolean).join(' · ')}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
              {!pending && !failed && filtered.length === 0 && <p>{trimmed ? 'No matching clients.' : 'No clients yet. Type a name to add one.'}</p>}
              {canCreate && <button type="button" className="fh-client-picker__create" disabled={creating} onClick={() => void createInline()}>
                <UserPlus size={18} aria-hidden="true" /><span>{creating ? 'Creating…' : `Create “${trimmed}”`}</span>
              </button>}
            </div>
          )}
        </div>
      )}
      {createError && <div ref={errorRef} tabIndex={-1} className="fh-client-picker__error" role="alert">{createError}</div>}
    </div>
  )
}
