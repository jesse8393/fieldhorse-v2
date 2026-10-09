import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, UserPlus, Check, X } from 'lucide-react'
import { supabase } from '../lib/supabase.ts'
import { canHover } from '../lib/hover.ts'
import { useOrgScope } from '../lib/orgScope.ts'
import { useInvalidateClients } from '../lib/queries.ts'
import { escapeLikeText, ilikeAnyOf } from '../lib/searchFilter.ts'
import { toastError } from '../lib/toast.ts'

const CLIENT_COLUMNS = 'id, name, company_name, phone, email, address, active_jobs_count'
const SEARCH_COLUMNS = ['name', 'company_name', 'email', 'phone']
const RECENT_LIMIT = 60
const SEARCH_LIMIT = 25
const SEARCH_DEBOUNCE_MS = 250

// fh_clients in the same scope as the Clients list: the active company's
// book, or the user's own rows when they have no company.
function clientRows(userId: string, orgScope: string | null) {
  const query = supabase.from('fh_clients').select(CLIENT_COLUMNS)
  return orgScope ? query.eq('org_id', orgScope) : query.eq('user_id', userId)
}

function sameName(name: string | null | undefined, typed: string) {
  return (name || '').trim().toLowerCase() === typed.toLowerCase()
}

type ServerSearch = { term: string; rows: any[]; failed: boolean }

/**
 * ClientPicker, inline autocomplete + inline-create, built on the
 * existing Supabase fh_clients table. Designed to drop into any sheet
 * next to a contact form (NewLeadSheet, ContactDetail edit mode, etc).
 *
 * Controlled API:
 *   value:        { id, name } | null   , currently selected client
 *   onChange:     (nextValue) => void   , fires on pick / clear / inline-create
 *   userId:       auth.uid, required; the lookup covers the active
 *                 company's clients (the user's own with no company)
 */
export default function ClientPicker({ userId, value, onChange }: any) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const [search, setSearch] = useState<ServerSearch | null>(null)
  const ref = useRef<any>(null)
  // undefined until the membership resolves; the lookups wait for it.
  const orgScope = useOrgScope(userId)
  const invalidateClients = useInvalidateClients()
  const trimmed = q.trim()

  useEffect(() => {
    if (!open || !userId || orgScope === undefined) return
    let cancelled = false
    setLoading(true)
    clientRows(userId, orgScope)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .limit(RECENT_LIMIT)
      .then(({ data }: any) => { if (!cancelled) { setRows(data || []); setLoading(false) } })
    return () => { cancelled = true }
  }, [open, userId, orgScope])

  // The list above is only the 60 most recently active clients, so a
  // returning customer outside it never matched and "Create" made a
  // duplicate of them. Search the whole book on the server as the
  // operator types, plus an exact name lookup, before offering Create.
  useEffect(() => {
    if (!open || !trimmed || !userId || orgScope === undefined) return
    let cancelled = false
    const timer = setTimeout(async () => {
      let next: ServerSearch
      try {
        const [matches, exact] = await Promise.all([
          clientRows(userId, orgScope)
            .or(ilikeAnyOf(SEARCH_COLUMNS, trimmed))
            .order('last_activity_at', { ascending: false, nullsFirst: false })
            .limit(SEARCH_LIMIT),
          clientRows(userId, orgScope)
            .ilike('name', escapeLikeText(trimmed))
            .limit(1)
        ])
        next = {
          term: trimmed,
          rows: [...(exact.data ?? []), ...(matches.data ?? [])],
          failed: !!(matches.error || exact.error)
        }
      } catch {
        next = { term: trimmed, rows: [], failed: true }
      }
      if (!cancelled) setSearch(next)
    }, SEARCH_DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [open, trimmed, userId, orgScope])

  useEffect(() => {
    function onDocPointer(e: any) {
      if (!ref.current) return
      if (!ref.current.contains(e.target)) setOpen(false)
    }
    // pointerdown handles touch + mouse uniformly. mousedown alone misses
    // some iOS Safari touch sequences inside portaled drawers.
    if (open) document.addEventListener('pointerdown', onDocPointer)
    return () => document.removeEventListener('pointerdown', onDocPointer)
  }, [open])

  // Server results for the current text, once they are in.
  const searched = trimmed && search?.term === trimmed ? search : null

  const filtered = useMemo(() => {
    const needle = trimmed.toLowerCase()
    if (!needle) return rows
    const local = rows.filter((r) =>
      (r.name || '').toLowerCase().includes(needle)
      || (r.company_name || '').toLowerCase().includes(needle)
      || (r.email || '').toLowerCase().includes(needle)
      || (r.phone || '').toLowerCase().includes(needle)
    )
    if (!searched) return local
    // Recent matches first (they show instantly), then the rest of the book.
    const seen = new Set(local.map((r) => r.id))
    const merged = [...local]
    for (const r of searched.rows) {
      if (seen.has(r.id)) continue
      seen.add(r.id)
      merged.push(r)
    }
    return merged
  }, [rows, trimmed, searched])

  const exactMatch = filtered.find((r) => sameName(r.name, trimmed))
  // Create waits for the server lookup so it is only offered when no
  // client in the whole book already has this name.
  const lookupPending = !!trimmed && !searched
  const listLoading = loading || orgScope === undefined

  async function createInline() {
    if (!trimmed || !userId || creating) return
    setCreating(true)
    try {
      const { data, error } = await supabase
        .from('fh_clients')
        .insert({ user_id: userId, ...(orgScope ? { org_id: orgScope } : {}), name: trimmed })
        .select(CLIENT_COLUMNS)
        .single()
      if (error) throw error
      // Pass the full row so the lead form can hydrate from it. A bare
      // {id, name} payload, what we used to send, meant the parent
      // had no phone/email/address to fill, so picking an existing
      // client never auto-completed the rest of the form.
      onChange?.(data)
      setOpen(false)
      setQ('')
      setRows((r) => [data, ...r])
      // The Clients list is cached; make the new client show up there.
      void invalidateClients()
    } catch (err: any) {
      toastError("Couldn't add client", err?.message || 'Try again in a moment.')
    } finally {
      setCreating(false)
    }
  }

  if (value?.id) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '12px 8px 12px 12px', borderRadius: 10, background: 'rgba(201,150,58,0.14)', border: '1px solid rgba(201,150,58,0.35)', color: 'var(--field-gold-bright)', maxWidth: '100%', minWidth: 0 }}>
        <Check size={14} />
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value.name || 'Client'}</span>
        <button
          type="button"
          onPointerDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); onChange?.(null) }}
          onClick={(ev) => { ev.preventDefault(); ev.stopPropagation() }}
          aria-label="Unlink client"
          style={{ width: 28, height: 28, padding: 0, borderRadius: 10, background: 'transparent', border: 'none', color: 'var(--field-gold-bright)', cursor: 'pointer', display: 'grid', placeItems: 'center', touchAction: 'manipulation', flexShrink: 0 }}
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative', zIndex: open ? 60 : 'auto' }}>
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)', pointerEvents: 'none' }} />
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search clients or type a new name…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '12px 12px 12px 32px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none' }}
        />
      </div>
      {open && (
        <div
          role="listbox"
          style={{
            // Absolute overlay anchored to THIS field's own wrapper
            // (the parent div is position:relative). Critical inside a
            // Vaul drawer: an INLINE dropdown changes the form's height
            // the instant it opens, which collides with Vaul's
            // soft-keyboard repositioning and collapses the whole sheet
            // to a sliver (the reported "tap the client field and the
            // form vanishes" bug). Overlaying keeps the form height
            // constant so the keyboard handling stays stable. Anchored
            // to the immediate wrapper (not a far ancestor), so it
            // tracks the input when iOS scrolls it, no desync.
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 60,
            // Keyboard-safe height: small enough to sit in the visible
            // area above the soft keyboard, scroll for the rest.
            maxHeight: 'min(46vh, 280px)',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: 4,
            borderRadius: 10,
            background: 'var(--v3-surface-2)',
            border: '1px solid var(--rule)',
            backdropFilter: 'blur(14px)',
            boxShadow: '0 8px 24px rgba(20, 20, 20,0.5)'
          }}
        >
          {listLoading && <div style={{ padding: '12px 12px', fontSize: 12, color: 'var(--ink-muted)' }}>Loading…</div>}
          {!listLoading && filtered.length === 0 && !trimmed && (
            <div style={{ padding: '12px 12px', fontSize: 12, color: 'var(--ink-muted)' }}>No clients yet. Type a name to add one.</div>
          )}
          {!listLoading && filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              role="option"
              aria-selected={value?.id === r.id}
              // pointerdown fires before the document outside-click handler
              // re-evaluates and before a wrapping label can hijack the tap
              // on iOS Safari. preventDefault stops the synthesized click
              // that would re-focus the search input.
              onPointerDown={(ev) => {
                ev.preventDefault()
                ev.stopPropagation()
                // Pass the full row so the parent (lead/job sheet) can
                // hydrate phone/email/address/company on selection.
                onChange?.(r)
                setOpen(false)
                setQ('')
              }}
              onClick={(ev) => { ev.preventDefault(); ev.stopPropagation() }}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px', background: 'transparent', border: 'none', borderRadius: 10, color: 'var(--ink-strong)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-body)', touchAction: 'manipulation' }}
              onMouseEnter={(ev) => { if (canHover) ev.currentTarget.style.background = 'rgba(201,150,58,0.1)' }}
              onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                {(r.company_name || r.email || r.phone) && (
                  <div style={{ marginTop: 1, fontSize: 12, color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.company_name || r.email || r.phone}
                  </div>
                )}
              </div>
              <span style={{ flexShrink: 0, fontSize: 12, color: 'var(--field-gold-bright)', fontWeight: 700, letterSpacing: 0 }}>
                {r.active_jobs_count || 0}
              </span>
            </button>
          ))}
          {!listLoading && lookupPending && (
            <div style={{ padding: '12px 12px', fontSize: 12, color: 'var(--ink-muted)' }}>Searching all clients…</div>
          )}
          {!listLoading && searched?.failed && (
            <div style={{ padding: '12px 12px', fontSize: 12, color: 'var(--ink-muted)' }}>Couldn't search all your clients. Check your connection.</div>
          )}
          {!listLoading && trimmed && !lookupPending && !exactMatch && (
            <button
              type="button"
              onPointerDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); createInline() }}
              onClick={(ev) => { ev.preventDefault(); ev.stopPropagation() }}
              disabled={creating}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 12px', marginTop: filtered.length ? 4 : 0, background: 'linear-gradient(135deg, rgba(201,150,58,0.18), rgba(92, 92, 92,0.12))', border: '1px solid rgba(201,150,58,0.4)', borderRadius: 10, color: 'var(--field-gold-bright)', cursor: creating ? 'default' : 'pointer', textAlign: 'left', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, touchAction: 'manipulation' }}
            >
              <UserPlus size={14} />
              {creating ? 'Creating…' : <>Create "<span style={{ color: 'var(--ink-strong)' }}>{trimmed}</span>"</>}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
