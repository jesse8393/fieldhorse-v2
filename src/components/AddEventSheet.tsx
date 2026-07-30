// src/components/AddEventSheet.tsx
//
// Schedule a job event (kickoff, inspection, walkthrough, recurring
// crew day). Was on the legacy ActionSheet chrome, now uses the v3
// Drawer pattern shared with NewClientSheet / MarkCompleteSheet so the
// schedule entry experience matches the rest of the system.
//
// Business logic untouched: same fh_schedule insert, same recurrence
// loop (every N days × 4 follow-ups), same default time, same contact
// pre-selection from defaultContactId.

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { Calendar as CalendarIcon, Check, X } from 'lucide-react'
import { hapticTap } from '../lib/haptics.ts'
import { supabase } from '../lib/supabase.ts'
import { toastError } from '../lib/toast.ts'
import { useDrawerKeyboard } from '../lib/useDrawerKeyboard.ts'
import { todayYmd, toYmd } from '../lib/dates.ts'
import { Eyebrow } from './v3'

export default function AddEventSheet({ open, userId, onClose, onSaved, defaultContactId = '', event = null }: any) {
  const editing = !!event?.id
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => todayYmd())
  const [time, setTime] = useState('08:00')
  const [contactId, setContactId] = useState(defaultContactId)
  const [contacts, setContacts] = useState<any[]>([])
  const [recurs, setRecurs] = useState(false)
  const [recurDays, setRecurDays] = useState(7)
  const [saving, setSaving] = useState(false)
  // Inline validation, submitting without a title used to do nothing
  // at all (no message, no focus), which read as a successful save
  // (UI audit #8).
  const [titleError, setTitleError] = useState(false)
  const titleRef = useRef<HTMLInputElement | null>(null)
  const { formRef, drawerStyle, formStyle } = useDrawerKeyboard(open)

  useEffect(() => {
    if (!userId) return
    // Enough fields to tell two "Justin Bryan" jobs apart in the picker
    // (UI audit #10): project title / address / stage disambiguate.
    supabase
      .from('fh_contacts')
      .select('id, name, job_title, address, stage')
      .eq('user_id', userId)
      .neq('stage', 'lost')
      .order('updated_at', { ascending: false })
      .then(({ data }: any) => setContacts(data || []))
  }, [userId])

  useEffect(() => {
    if (!open) {
      setTitle('')
      setTitleError(false)
      setContactId(defaultContactId)
      setRecurs(false)
      setRecurDays(7)
      setDate(todayYmd())
      setTime('08:00')
    } else if (event?.id) {
      // Edit mode: prefill from the row being edited.
      setTitle(event.title || '')
      setContactId(event.contact_id || '')
      setRecurs(false)
      // Derive BOTH date and time from local parts. Using UTC for the
      // date (toISOString) while the time is local silently bumps an
      // evening event to the next day on save.
      const start = event.start_at ? new Date(event.start_at) : new Date()
      setDate(toYmd(start))
      setTime(start.toTimeString().slice(0, 5))
    } else {
      setContactId(defaultContactId)
    }
  }, [open, defaultContactId, event])

  async function save(e: any) {
    e?.preventDefault?.()
    if (saving) return
    if (!title.trim()) {
      setTitleError(true)
      titleRef.current?.focus()
      return
    }
    setTitleError(false)
    setSaving(true)
    const startMs = new Date(`${date}T${time}:00`).getTime()
    // EDIT: update the single row in place.
    if (editing) {
      const { error } = await supabase.from('fh_schedule').update({
        title: title.trim(),
        contact_id: contactId || null,
        start_at: new Date(startMs).toISOString(),
        end_at: new Date(startMs + 60 * 60 * 1000).toISOString()
      }).eq('id', event.id).eq('user_id', userId)
      setSaving(false)
      if (error) { toastError("Couldn't update the event", error.message || 'Try again.'); return }
      onSaved?.()
      return
    }
    // Default a 1-hour end_at so deriveStatus / Live / Done filters have
    // a window to work with (they broke on events with a null end_at).
    // Shared series id (stored in the `recurring` text column) so every
    // occurrence knows it belongs to one series, the Schedule screen
    // uses it to offer "delete this / delete the whole series" instead
    // of orphaning the other 4 rows.
    const seriesId = recurs ? (crypto.randomUUID?.() || `series-${startMs}`) : null
    const mkRow = (s: number) => ({
      user_id: userId,
      contact_id: contactId || null,
      title: title.trim(),
      start_at: new Date(s).toISOString(),
      end_at: new Date(s + 60 * 60 * 1000).toISOString(),
      recurring: seriesId
    })
    const rows = [mkRow(startMs)]
    if (recurs) {
      for (let i = 1; i <= 4; i++) {
        rows.push(mkRow(startMs + recurDays * i * 86400000))
      }
    }
    // Capture the error, a silent insert failure previously closed the
    // sheet as "saved" and lost the event.
    const { error } = await supabase.from('fh_schedule').insert(rows)
    setSaving(false)
    if (error) {
      toastError("Couldn't save the event", error.message || 'Try again.')
      return
    }
    onSaved?.()
  }

  const labelStyle = { fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: 'var(--ink-muted)' }
  const fieldStyle: import('react').CSSProperties = {
    padding: '12px 12px',
    borderRadius: 10,
    background: 'var(--surface-2)',
    border: '1px solid var(--rule)',
    color: 'var(--ink-strong)',
    fontFamily: 'var(--font-body)',
    fontSize: 14,
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    scrollMarginTop: 96,
    scrollMarginBottom: 120
  }

  return (
    <Drawer open={open} onOpenChange={(v: any) => { if (!v && !saving) onClose?.() }}>
      <DrawerContent
        className="ui:max-w-full ui:overflow-x-hidden"
        style={drawerStyle}
      >
        <DrawerHeader className="ui:text-left" style={{ maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <Eyebrow as="div">
            <CalendarIcon size={12} />
            Schedule
          </Eyebrow>
          <DrawerTitle asChild>
            <h2
              className="fh-font-serif"
              style={{ margin: '6px 0 0', fontSize: 24, lineHeight: 1.1, letterSpacing: 0, fontWeight: 400, color: 'var(--ink-strong)' }}
            >
              {editing ? 'Edit event.' : 'Add an event.'}
            </h2>
          </DrawerTitle>
          <DrawerDescription
            style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}
          >
            Drops a single event on the calendar, flip recurrence on to repeat for the next four cycles.
          </DrawerDescription>
        </DrawerHeader>

        <form
          ref={formRef}
          onSubmit={save}
          style={formStyle()}
        >
          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={labelStyle}>Title *</span>
            <input
              ref={titleRef}
              type="text"
              required
              aria-invalid={titleError || undefined}
              disabled={saving}
              value={title}
              onChange={(e) => { setTitle(e.target.value); if (titleError && e.target.value.trim()) setTitleError(false) }}
              placeholder="Pour foundation, inspection…"
              style={{
                ...fieldStyle,
                ...(titleError ? { borderColor: 'var(--v3-danger-bright)' } : {})
              }}
            />
            {titleError && (
              <span role="alert" style={{ fontSize: 12, color: 'var(--v3-danger-bright)' }}>
                Give the event a title before saving.
              </span>
            )}
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={labelStyle}>Date</span>
              <input
                type="date"
                disabled={saving}
                value={date}
                onChange={(e) => setDate(e.target.value)}
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={labelStyle}>Time</span>
              <input
                type="time"
                disabled={saving}
                value={time}
                onChange={(e) => setTime(e.target.value)}
                style={fieldStyle}
              />
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={labelStyle}>Link to job</span>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              disabled={saving}
              style={{ ...fieldStyle, cursor: 'pointer' }}
            >
              <option value="">None</option>
              {contacts.map((c) => {
                // "Justin Bryan" × 8 with no other context was
                // unpickable, append project / address and the stage
                // so each option is distinguishable (UI audit #10).
                const where = (c.job_title || c.address || '').trim()
                const stage = c.stage ? ` · ${String(c.stage)[0].toUpperCase()}${String(c.stage).slice(1)}` : ''
                return (
                  <option key={c.id} value={c.id}>
                    {c.name || 'Unnamed'}{where ? `, ${where}` : ''}{stage}
                  </option>
                )
              })}
            </select>
          </label>

          {/* Recurrence is create-only, editing changes just this one
              occurrence. */}
          {!editing && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={labelStyle}>Recurrence</span>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { v: false, label: 'One time' },
                { v: true,  label: `Every ${recurDays} days × 4` }
              ].map((opt) => {
                const active = recurs === opt.v
                return (
                  <button
                    key={String(opt.v)}
                    type="button"
                    onClick={() => { hapticTap(); setRecurs(opt.v) }}
                    disabled={saving}
                    style={chipStyle(active, saving)}
                  >
                    {opt.label}
                  </button>
                )
              })}
            </div>
          </div>
          )}

          {!editing && recurs && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={labelStyle}>Repeat every (days)</span>
              <input
                type="number"
                min={1}
                disabled={saving}
                value={recurDays}
                onChange={(e) => setRecurDays(Number(e.target.value) || 7)}
                style={fieldStyle}
              />
            </label>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 12, marginTop: 6 }}>
            <button
              type="button"
              onClick={() => onClose?.()}
              disabled={saving}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '12px 12px', borderRadius: 10,
                background: 'var(--surface-2)', border: '1px solid var(--rule)',
                color: 'var(--ink-strong)',
                fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
                cursor: saving ? 'wait' : 'pointer'
              }}
            >
              <X size={14} />
              Cancel
            </button>
            <motion.button
              type="submit"
              whileTap={{ scale: saving || !title.trim() ? 1 : 0.98 }}
              disabled={saving || !title.trim()}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '12px 12px', borderRadius: 10, border: 'none',
                background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                color: 'var(--onyx)',
                fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: 0,
                cursor: saving || !title.trim() ? 'not-allowed' : 'pointer',
                boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                opacity: saving || !title.trim() ? 0.55 : 1
              }}
            >
              <Check size={14} />
              {saving ? 'SAVING…' : editing ? 'SAVE CHANGES' : 'SAVE EVENT'}
            </motion.button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  )
}

function chipStyle(active: any, disabled: any) {
  return {
    padding: '8px 12px',
    borderRadius: 10,
    border: active
      ? '1px solid var(--v3-border-strong)'
      : '1px solid var(--rule)',
    background: active
      ? 'var(--v3-glass-tint-2)'
      : 'var(--surface-2)',
    color: active
      ? 'var(--ink-strong)'
      : 'var(--ink-muted)',
    fontFamily: 'var(--font-body)',
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? 'wait' : 'pointer',
    transition: 'all 160ms ease'
  }
}
