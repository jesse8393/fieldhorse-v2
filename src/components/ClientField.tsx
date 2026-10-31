// ClientField (PHASE9_PLAN Task 8, SPEC D58, D59): one field on every
// create screen. Type a name, see the clients that match under the field,
// tap one to pick it, or keep typing and the screen saves the typed name
// as a new client when it saves. Nothing opens over the page: the matches
// are a list under the input and go away once a client is picked or the
// field is empty.
//
// The company's clients are read once (the newest active first) and
// matched here, so the list answers every keystroke without a request.

import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Button, Field } from './fh'
import { supabase } from '../lib/supabase.ts'
import { useOrgScope } from '../lib/orgScope.ts'
import { findOrCreateClient } from '../lib/clients.ts'

export type ClientPick = {
  id: string
  name: string
  company_name?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
}

export type ClientFieldValue = {
  /** What is typed. The new client's name when nothing is picked. */
  text: string
  /** The picked client, or null while the name is new or still being typed. */
  picked: ClientPick | null
}

/** Preserve a draft's selected identity even when customers share a name. */
export function restoredClientValue(text: string, id: string): ClientFieldValue {
  return { text, picked: id ? { id, name: text } : null }
}

const COLUMNS = 'id, name, company_name, phone, email, address'
const LIMIT = 200
const SHOWN = 6

function clientRows(userId: string, orgScope: string | null) {
  const q = supabase.from('fh_clients').select(COLUMNS)
  return orgScope ? q.eq('org_id', orgScope) : q.eq('user_id', userId)
}

function norm(s: string | null | undefined) {
  return (s || '').trim().toLowerCase()
}

/** The clients whose name, company, phone or email contain the typed text. */
export function matchClients(rows: ClientPick[], typed: string, limit = SHOWN): ClientPick[] {
  const t = norm(typed)
  if (!t) return []
  const starts: ClientPick[] = []
  const contains: ClientPick[] = []
  for (const r of rows) {
    const name = norm(r.name)
    if (name.startsWith(t)) starts.push(r)
    else if (name.includes(t) || norm(r.company_name).includes(t) || norm(r.email).includes(t) || norm(r.phone).includes(t)) contains.push(r)
  }
  return [...starts, ...contains].slice(0, limit)
}

/** True when the typed text is the exact name of one of the rows. */
export function exactClient(rows: ClientPick[], typed: string): ClientPick | null {
  const t = norm(typed)
  if (!t) return null
  return rows.find((r) => norm(r.name) === t) ?? null
}

/**
 * The client a create screen saves against: the picked client, else the
 * client whose name, phone or email already matches what was typed, else a
 * new fh_clients row from the typed name (D59). Null when there is no name.
 */
export async function resolveClientId(
  value: ClientFieldValue,
  ids: { userId: string; orgId: string | null },
  extra: { phone?: string | null; email?: string | null; address?: string | null; company?: string | null } = {}
): Promise<ClientPick | null> {
  const name = value.text.trim()
  if (!name) return null
  const id = value.picked?.id || await findOrCreateClient(ids.userId, {
    name,
    phone: extra.phone?.trim() || null,
    email: extra.email?.trim() || null,
    address: extra.address?.trim() || null,
    company: extra.company?.trim() || null
  }, ids.orgId)
  if (!id) throw new Error('Could not save the client. Check your connection and try again.')
  // Matching a typed name returns an existing id, not the existing contact
  // details. Read that row before copying it to a job. The same read checks
  // that a restored selection still belongs to this workspace and is visible.
  const { data, error } = await clientRows(ids.userId, ids.orgId).eq('id', id).maybeSingle()
  if (error) throw new Error('Could not load this client. Check your connection and try again.')
  if (!data) throw new Error('This client no longer belongs to this workspace or cannot be accessed. Choose a client again.')
  return data as ClientPick
}

/** Reads one client by id, for a screen opened with ?client=. */
export async function fetchClientPick(id: string): Promise<ClientPick | null> {
  const { data, error } = await supabase.from('fh_clients').select(COLUMNS).eq('id', id).maybeSingle()
  if (error || !data) return null
  return data as ClientPick
}

type Props = {
  userId: string | undefined
  value: ClientFieldValue
  onChange: (next: ClientFieldValue) => void
  /** The label above the field: "Client" on most screens, "Name" on a lead. */
  label?: string
  placeholder?: string
  error?: string
  autoFocus?: boolean
  /** Called with the picked client, so a screen can fill its own fields from it. */
  onPick?: (client: ClientPick) => void
}

export default function ClientField({ userId, value, onChange, label = 'Client', placeholder = 'Type a name', error, autoFocus, onPick }: Props) {
  const orgScope = useOrgScope(userId)
  const scope = JSON.stringify([userId, orgScope])
  const [read, setRead] = useState<{ scope: string; retry: number; rows: ClientPick[]; failed: boolean } | null>(null)
  const [retry, setRetry] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const current = read?.scope === scope && read.retry === retry ? read : null
  const rows = current?.rows
  const [activeIndex, setActiveIndex] = useState(-1)
  const [dismissed, setDismissed] = useState(false)
  const listId = useId()

  useEffect(() => {
    if (!userId || orgScope === undefined) return
    let alive = true
    void (async () => {
      try {
        const { data, error } = await clientRows(userId, orgScope)
          .order('last_activity_at', { ascending: false, nullsFirst: false }).limit(LIMIT)
        if (alive) setRead({ scope, retry, rows: (data || []) as ClientPick[], failed: !!error })
      } catch {
        if (alive) setRead({ scope, retry, rows: [], failed: true })
      }
    })()
    return () => { alive = false }
  }, [userId, orgScope, scope, retry])

  const typed = value.text
  const matches = useMemo(() => (value.picked ? [] : matchClients(rows || [], typed)), [rows, typed, value.picked])
  const exact = useMemo(() => (value.picked ? null : exactClient(rows || [], typed)), [rows, typed, value.picked])
  const isNew = !value.picked && typed.trim() !== '' && !exact
  const showList = matches.length > 0 && !dismissed
  const activeClient = showList ? matches[activeIndex] : undefined

  function pick(c: ClientPick) {
    setActiveIndex(-1)
    onChange({ text: c.name, picked: c })
    onPick?.(c)
  }

  // Typing again after a pick clears it, so "Saves to" is the one sign
  // of a picked client and the field stays one control.
  const helper = value.picked
    ? `Saves to ${value.picked.name}.`
    : isNew && !showList
      ? 'Checks for an existing client when saving. Adds a client only if no match exists.'
      : isNew && showList
        ? 'Pick a matching client below, or keep typing. Existing clients are checked when saving.'
        : undefined

  return (
    <div className="fhnew-client">
      <Field
        ref={inputRef}
        label={label}
        value={typed}
        placeholder={placeholder}
        autoComplete="off"
        autoCapitalize="words"
        autoFocus={autoFocus}
        error={error}
        helper={helper}
        role="combobox"
        aria-expanded={showList}
        aria-controls={showList ? listId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={activeClient ? `${listId}-${activeClient.id}` : undefined}
        onFocus={() => setDismissed(false)}
        onChange={(e) => {
          setDismissed(false)
          setActiveIndex(-1)
          onChange({ text: e.target.value, picked: null })
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!matches.length) return
            e.preventDefault()
            setDismissed(false)
            setActiveIndex(index => e.key === 'ArrowDown'
              ? (index + 1) % matches.length
              : (index <= 0 ? matches.length - 1 : index - 1))
          } else if (e.key === 'Escape' && showList) {
            e.preventDefault()
            setDismissed(true)
            setActiveIndex(-1)
          } else if (e.key === 'Enter' && !e.nativeEvent.isComposing && showList && (activeClient || exact)) {
            e.preventDefault()
            pick(activeClient || exact!)
          }
        }}
      />
      {current?.failed && <div role="alert">
        <p>Client suggestions could not load. Retry, or type a name to check when saving.</p>
        <Button type="button" variant="secondary" onClick={() => {
          inputRef.current?.focus({ preventScroll: true })
          setRetry(attempt => attempt + 1)
        }}>Retry client suggestions</Button>
      </div>}
      {showList && (
        <ul id={listId} className="fhnew-client__list" role="listbox" aria-label="Matching clients">
          {matches.map((c, index) => (
            <li key={c.id} className="fhnew-client__item" role="presentation">
              <button id={`${listId}-${c.id}`} type="button" role="option" tabIndex={-1} aria-selected={activeIndex === index} className="fhnew-client__pick" onClick={() => pick(c)}>
                <span className="fhnew-client__name">{c.name}</span>
                {(c.company_name || c.phone || c.email || c.address) && (
                  <span className="fhnew-client__sub">{[c.company_name, c.phone || c.email, c.address].filter(Boolean).join(' · ')}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
