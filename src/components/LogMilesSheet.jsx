import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Car, Save as SaveIcon, X } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { supabase } from '../lib/supabase.js'
import { toastError } from '../lib/toast.ts'

const IRS_RATE = 0.67

export default function LogMilesSheet({ open, userId, onOpenChange, onSaved }) {
  const today = useMemo(() => new Date().toISOString().slice(0, 10), [])
  const [droveOn, setDroveOn] = useState(today)
  const [miles, setMiles] = useState('')
  const [purpose, setPurpose] = useState('')
  const [contactId, setContactId] = useState('')
  const [contacts, setContacts] = useState([])
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!userId || !open) return
    supabase
      .from('fh_contacts')
      .select('id, name')
      .eq('user_id', userId)
      .order('name', { ascending: true })
      .then(({ data }) => setContacts(data || []))
  }, [userId, open])

  useEffect(() => {
    if (!open) {
      setDroveOn(today)
      setMiles('')
      setPurpose('')
      setContactId('')
      setSaving(false)
    }
  }, [open, today])

  const milesNum = Number(miles) || 0
  const deduction = milesNum * IRS_RATE
  const canSave = milesNum > 0 && !saving

  async function submit(e) {
    e?.preventDefault?.()
    if (!canSave || !userId) return
    setSaving(true)
    const { error } = await supabase.from('fh_mileage').insert({
      user_id: userId,
      contact_id: contactId || null,
      miles: milesNum,
      drove_on: droveOn,
      purpose: purpose.trim() || null
    })
    setSaving(false)
    if (error) {
      toastError("Couldn't log miles", error.message || 'Try again in a moment.')
      return
    }
    onSaved?.()
  }

  const fieldStyle = {
    width: '100%',
    padding: '12px 14px',
    borderRadius: 12,
    background: 'var(--surface-2)',
    border: '1px solid var(--rule)',
    color: 'var(--ink-strong)',
    fontFamily: 'var(--font-body)',
    fontSize: 14,
    outline: 'none'
  }
  const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            <Car size={12} />
            Mileage
          </div>
          <DrawerTitle asChild>
            <h2
              className="fh-font-serif"
              style={{ margin: '6px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
            >
              Log{' '}
              miles.
            </h2>
          </DrawerTitle>
          <DrawerDescription
            style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}
          >
            Every mile is ${IRS_RATE}/mi deducted at tax time (IRS 2026 rate).
          </DrawerDescription>
        </DrawerHeader>

        <form
          onSubmit={submit}
          className="fh-vaul-form"
          style={{
            padding: '6px 20px 20px',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            // Body scrolls naturally when the soft keyboard rises so the
            // active input + Save/Cancel buttons stay reachable. The
            // .fh-vaul-form class adds safe-area-inset-bottom padding via
            // mobile-keyboard-fix.css so the buttons aren't pinned right
            // against the iOS keyboard accessory bar.
            maxHeight: 'calc(92dvh - 96px)',
            overflowY: 'auto',
            overscrollBehavior: 'contain'
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>Date</span>
              <input
                type="date"
                value={droveOn}
                onChange={(e) => setDroveOn(e.target.value)}
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>Miles</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.1"
                min="0"
                autoFocus
                value={miles}
                onChange={(e) => setMiles(e.target.value)}
                placeholder="0"
                style={fieldStyle}
              />
            </label>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Purpose</span>
            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="Drive to jobsite, supplier run, inspection…"
              style={fieldStyle}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Link to job (optional)</span>
            <select
              value={contactId}
              onChange={(e) => setContactId(e.target.value)}
              style={fieldStyle}
            >
              <option value="">None</option>
              {contacts.map((c) => (
                <option key={c.id} value={c.id}>{c.name || 'Unnamed contact'}</option>
              ))}
            </select>
          </label>

          {milesNum > 0 && (
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '10px 14px', borderRadius: 12, background: 'rgba(201,150,58,0.08)', border: '1px solid rgba(201,150,58,0.25)' }}>
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Deduction</span>
              <span className="fh-text-gradient-gold" style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '0.01em' }}>
                ${deduction.toFixed(2)}
              </span>
            </div>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              disabled={saving}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
            >
              <X size={14} />
              Cancel
            </button>
            <motion.button
              type="submit"
              whileTap={{ scale: 0.97 }}
              disabled={!canSave}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '12px 14px',
                borderRadius: 12,
                border: 'none',
                background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                color: 'var(--onyx)',
                fontFamily: 'var(--font-display)',
                fontSize: 14,
                letterSpacing: '0.14em',
                cursor: canSave ? 'pointer' : 'default',
                boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                opacity: canSave ? 1 : 0.6
              }}
            >
              <SaveIcon size={14} />
              {saving ? 'SAVING…' : 'SAVE'}
            </motion.button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
