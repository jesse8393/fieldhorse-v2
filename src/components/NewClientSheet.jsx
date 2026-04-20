import { useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { UserPlus, Save as SaveIcon, X } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { supabase } from '../lib/supabase.js'
import { toastSuccess, toastError } from '../lib/toast.js'

export default function NewClientSheet({ open, userId, onClose, onSaved }) {
  const [name, setName] = useState('')
  const [company, setCompany] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [notes, setNotes] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) {
      setName(''); setCompany(''); setPhone(''); setEmail(''); setAddress(''); setNotes(''); setSaving(false)
    }
  }, [open])

  async function submit(e) {
    e?.preventDefault?.()
    if (!name.trim() || !userId) return
    setSaving(true)
    try {
      const { data, error } = await supabase
        .from('fh_clients')
        .insert({
          user_id: userId,
          name: name.trim(),
          company_name: company.trim() || null,
          phone: phone.trim() || null,
          email: email.trim().toLowerCase() || null,
          address: address.trim() || null,
          notes: notes.trim() || null
        })
        .select('*')
        .single()
      if (error) throw error
      toastSuccess('Client saved', data?.name || '')
      onSaved?.(data)
    } catch (ex) {
      toastError("Couldn't save client", ex?.message || 'Try again in a moment.')
    } finally {
      setSaving(false)
    }
  }

  const fieldStyle = {
    width: '100%',
    boxSizing: 'border-box',
    padding: '11px 14px',
    borderRadius: 12,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid var(--rule)',
    color: 'var(--ink-strong)',
    fontFamily: 'var(--font-body)',
    fontSize: 14,
    outline: 'none'
  }
  const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }

  return (
    <Drawer open={open} onOpenChange={(v) => { if (!v) onClose?.() }}>
      <DrawerContent
        className="ui:max-w-full ui:overflow-x-hidden"
        style={{ maxWidth: '100%', overflowX: 'hidden' }}
      >
        <DrawerHeader className="ui:text-left" style={{ maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            <UserPlus size={12} />
            New client
          </div>
          <DrawerTitle asChild>
            <h2
              className="fh-font-serif"
              style={{ margin: '6px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
            >
              Add a{' '}
              <em className="fh-font-serif-italic fh-text-gradient-gold">client.</em>
            </h2>
          </DrawerTitle>
          <DrawerDescription
            style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}
          >
            A client can hold one or many jobs over time. You'll link jobs to this client as they come in.
          </DrawerDescription>
        </DrawerHeader>

        <form onSubmit={submit} style={{ padding: '6px 20px 20px', display: 'flex', flexDirection: 'column', gap: 12, boxSizing: 'border-box', maxWidth: '100%', minWidth: 0 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Name *</span>
            <input
              type="text"
              required
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Jane Homeowner"
              style={fieldStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Company</span>
            <input
              type="text"
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="Optional"
              style={fieldStyle}
            />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>Phone</span>
              <input
                type="tel"
                inputMode="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="555-1234"
                style={fieldStyle}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>Email</span>
              <input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                style={fieldStyle}
              />
            </label>
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Address</span>
            <textarea
              rows={2}
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Street, city, state"
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={labelStyle}>Notes</span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Anything worth remembering about this client"
              style={{ ...fieldStyle, resize: 'vertical' }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => onClose?.()}
              disabled={saving}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '12px 14px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, cursor: 'pointer', minWidth: 0, boxSizing: 'border-box' }}
            >
              <X size={14} />
              Cancel
            </button>
            <motion.button
              type="submit"
              whileTap={{ scale: 0.97 }}
              disabled={saving || !name.trim()}
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
                cursor: (saving || !name.trim()) ? 'default' : 'pointer',
                boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                opacity: (saving || !name.trim()) ? 0.6 : 1,
                minWidth: 0,
                boxSizing: 'border-box'
              }}
            >
              <SaveIcon size={14} />
              {saving ? 'SAVING…' : 'SAVE CLIENT'}
            </motion.button>
          </div>
        </form>
      </DrawerContent>
    </Drawer>
  )
}
