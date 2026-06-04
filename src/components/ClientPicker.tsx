import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, UserPlus, Check, X } from 'lucide-react'
import { supabase } from '../lib/supabase.ts'

/**
 * ClientPicker — inline autocomplete + inline-create, built on the
 * existing Supabase fh_clients table. Designed to drop into any sheet
 * next to a contact form (NewLeadSheet, ContactDetail edit mode, etc).
 *
 * Controlled API:
 *   value:        { id, name } | null    — currently selected client
 *   onChange:     (nextValue) => void    — fires on pick / clear / inline-create
 *   userId:       auth.uid — required; scopes the lookup
 */
export default function ClientPicker({ userId, value, onChange }: any) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [creating, setCreating] = useState(false)
  const ref = useRef<any>(null)

  useEffect(() => {
    if (!open || !userId) return
    let cancelled = false
    setLoading(true)
    supabase
      .from('fh_clients')
      .select('id, name, company_name, phone, email, address, active_jobs_count')
      .eq('user_id', userId)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .limit(60)
      .then(({ data }: any) => { if (!cancelled) { setRows(data || []); setLoading(false) } })
    return () => { cancelled = true }
  }, [open, userId])

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

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return rows
    return rows.filter((r) =>
      (r.name || '').toLowerCase().includes(needle)
      || (r.company_name || '').toLowerCase().includes(needle)
      || (r.email || '').toLowerCase().includes(needle)
      || (r.phone || '').toLowerCase().includes(needle)
    )
  }, [rows, q])

  const trimmed = q.trim()
  const exactMatch = rows.find((r) => (r.name || '').toLowerCase() === trimmed.toLowerCase())

  async function createInline() {
    if (!trimmed || !userId || creating) return
    setCreating(true)
    try {
      const { data, error } = await supabase
        .from('fh_clients')
        .insert({ user_id: userId, name: trimmed })
        .select('id, name, company_name, phone, email, address, active_jobs_count')
        .single()
      if (error) throw error
      // Pass the full row so the lead form can hydrate from it. A bare
      // {id, name} payload — what we used to send — meant the parent
      // had no phone/email/address to fill, so picking an existing
      // client never auto-completed the rest of the form.
      onChange?.(data)
      setOpen(false)
      setQ('')
      setRows((r) => [data, ...r])
    } finally {
      setCreating(false)
    }
  }

  if (value?.id) {
    return (
      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 8px 10px 14px', borderRadius: 12, background: 'rgba(201,150,58,0.14)', border: '1px solid rgba(201,150,58,0.35)', color: 'var(--field-gold-bright)', maxWidth: '100%', minWidth: 0 }}>
        <Check size={14} />
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value.name || 'Client'}</span>
        <button
          type="button"
          onPointerDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); onChange?.(null) }}
          onClick={(ev) => { ev.preventDefault(); ev.stopPropagation() }}
          aria-label="Unlink client"
          style={{ width: 28, height: 28, padding: 0, borderRadius: 8, background: 'transparent', border: 'none', color: 'var(--field-gold-bright)', cursor: 'pointer', display: 'grid', placeItems: 'center', touchAction: 'manipulation', flexShrink: 0 }}
        >
          <X size={14} />
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)', pointerEvents: 'none' }} />
        <input
          type="text"
          value={q}
          onChange={(e) => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search clients or type a new name…"
          style={{ width: '100%', boxSizing: 'border-box', padding: '10px 12px 10px 34px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none' }}
        />
      </div>
      {open && (
        <div
          role="listbox"
          style={{
            // Inline (not absolute) — on mobile inside a Vaul drawer,
            // an absolute dropdown floats over the form siblings and
            // when iOS scrolls the focused input into view the
            // overlay + form behind it desync. Inline pushes the
            // form down and scrolls cleanly as one block.
            //
            // Max-height 55vh: when the user is focused on picking a
            // client, give the picker most of the visible drawer
            // height instead of a short list with a long empty void
            // underneath it. Other form fields remain reachable by
            // scrolling past the dropdown.
            position: 'relative',
            marginTop: 4,
            maxHeight: '55vh',
            overflowY: 'auto',
            WebkitOverflowScrolling: 'touch',
            padding: 4,
            borderRadius: 12,
            background: 'rgba(20,20,20,0.96)',
            border: '1px solid var(--rule)',
            backdropFilter: 'blur(14px)',
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)'
          }}
        >
          {loading && <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-muted)' }}>Loading…</div>}
          {!loading && filtered.length === 0 && !trimmed && (
            <div style={{ padding: '10px 12px', fontSize: 12, color: 'var(--ink-muted)' }}>No clients yet. Type a name to add one.</div>
          )}
          {!loading && filtered.map((r) => (
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
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '11px 10px', background: 'transparent', border: 'none', borderRadius: 8, color: 'var(--ink-strong)', cursor: 'pointer', textAlign: 'left', fontFamily: 'var(--font-body)', touchAction: 'manipulation' }}
              onMouseEnter={(ev) => { ev.currentTarget.style.background = 'rgba(201,150,58,0.1)' }}
              onMouseLeave={(ev) => { ev.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                {(r.company_name || r.email || r.phone) && (
                  <div style={{ marginTop: 1, fontSize: 11, color: 'var(--ink-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {r.company_name || r.email || r.phone}
                  </div>
                )}
              </div>
              <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--field-gold-bright)', fontWeight: 700, letterSpacing: '0.1em' }}>
                {r.active_jobs_count || 0}
              </span>
            </button>
          ))}
          {!loading && trimmed && !exactMatch && (
            <button
              type="button"
              onPointerDown={(ev) => { ev.preventDefault(); ev.stopPropagation(); createInline() }}
              onClick={(ev) => { ev.preventDefault(); ev.stopPropagation() }}
              disabled={creating}
              style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '12px 10px', marginTop: filtered.length ? 4 : 0, background: 'linear-gradient(135deg, rgba(201,150,58,0.18), rgba(140,111,48,0.12))', border: '1px solid rgba(201,150,58,0.4)', borderRadius: 8, color: 'var(--field-gold-bright)', cursor: creating ? 'default' : 'pointer', textAlign: 'left', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, touchAction: 'manipulation' }}
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
