import { useEffect, useState } from 'react'
import ActionSheet, { SheetField, SheetChipRow } from './ActionSheet.jsx'
import { supabase } from '../lib/supabase.js'

export default function AddEventSheet({ open, userId, onClose, onSaved, defaultContactId = '' }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState('08:00')
  const [contactId, setContactId] = useState(defaultContactId)
  const [contacts, setContacts] = useState([])
  const [recurs, setRecurs] = useState(false)
  const [recurDays, setRecurDays] = useState(7)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!userId) return
    supabase.from('fh_contacts').select('id, name').eq('user_id', userId).then(({ data }) => setContacts(data || []))
  }, [userId])

  useEffect(() => {
    if (!open) {
      setTitle('')
      setContactId(defaultContactId)
      setRecurs(false)
      setRecurDays(7)
      setDate(new Date().toISOString().slice(0, 10))
      setTime('08:00')
    } else {
      setContactId(defaultContactId)
    }
  }, [open, defaultContactId])

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    const starts = new Date(`${date}T${time}:00`).toISOString()
    const rows = [{ user_id: userId, contact_id: contactId || null, title: title.trim(), start_at: starts }]
    if (recurs) {
      for (let i = 1; i <= 4; i++) {
        const next = new Date(starts)
        next.setDate(next.getDate() + recurDays * i)
        rows.push({ user_id: userId, contact_id: contactId || null, title: title.trim(), start_at: next.toISOString() })
      }
    }
    await supabase.from('fh_schedule').insert(rows)
    setSaving(false)
    onSaved?.()
  }

  return (
    <ActionSheet
      open={open}
      title="New event."
      accentWord="event"
      sectionLabel="New event"
      commitLabel={saving ? 'Committing…' : 'Commit event'}
      commitBusy={saving}
      commitDisabled={!title.trim()}
      onClose={onClose}
      onCommit={save}
    >
      <SheetField label="Title">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Pour foundation, inspection…"
        />
      </SheetField>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <SheetField label="Date">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </SheetField>
        <SheetField label="Time">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </SheetField>
      </div>
      <SheetField label="Link to job">
        <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="fh-asheet-select">
          <option value="">None</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </SheetField>
      <SheetChipRow
        label="Recurrence"
        value={recurs ? 'yes' : 'no'}
        options={[{ value: 'no', label: 'One-time' }, { value: 'yes', label: `Every ${recurDays} days × 4` }]}
        onChange={(v) => setRecurs(v === 'yes')}
      />
      {recurs && (
        <SheetField label="Repeat every (days)">
          <input type="number" min={1} value={recurDays} onChange={(e) => setRecurDays(Number(e.target.value) || 7)} />
        </SheetField>
      )}
    </ActionSheet>
  )
}
