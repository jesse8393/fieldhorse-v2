import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { FileText, ArrowRight, X } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { supabase } from '../lib/supabase.ts'
import { toastError } from '../lib/toast.ts'
import { hapticMedium } from '../lib/haptics.ts'
import { useDrawerKeyboard } from '../lib/useDrawerKeyboard.ts'
import ClientPicker from './ClientPicker.tsx'
import { Eyebrow } from './v3'

/**
 * NewQuoteSheet, the ONE way to start a quote.
 *
 * A quote is work you're pricing for a client, so this asks exactly two
 * things: who it's for, and (optionally) what it's for. Everything else :
 * the price, the scope, the terms, is the line item builder's job, so on
 * "Start quote" we create the quote and drop the operator straight into
 * that builder (onStarted). No re-typed client form, no amount field that
 * the line items would just overwrite.
 */
export default function NewQuoteSheet({ open, userId, onClose, onStarted }: any) {
  const [client, setClient] = useState<any>(null)
  const [title, setTitle] = useState('')
  const [starting, setStarting] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)
  const { formRef, drawerStyle, formStyle } = useDrawerKeyboard(open)

  useEffect(() => {
    if (!open) { setClient(null); setTitle(''); setStarting(false) }
  }, [open])

  async function start() {
    if (!client?.id || !userId || starting) return
    setStarting(true)
    hapticMedium()
    try {
      const { data, error } = await supabase
        .from('fh_contacts')
        .insert({
          user_id: userId,
          stage: 'quote',
          client_id: client.id,
          name: client.name || 'New quote',
          phone: client.phone || null,
          email: client.email || null,
          address: client.address || null,
          job_title: title.trim() || null
        })
        .select('*')
        .single()
      if (error) throw error
      onStarted?.(data)
    } catch (ex: any) {
      toastError("Couldn't start quote", ex?.message || 'Try again in a moment.')
      setStarting(false)
    }
  }

  const canStart = !!client?.id && !starting
  const labelStyle: import('react').CSSProperties = { fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: 'var(--ink-muted)' }

  return (
    <Drawer open={open} onOpenChange={(v: any) => { if (!v && !starting) onClose?.() }}>
      <DrawerContent className="ui:max-w-full ui:overflow-x-hidden" style={drawerStyle}>
        <DrawerHeader className="ui:text-left" style={{ maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <Eyebrow as="div">
            <FileText size={12} />
            New quote
          </Eyebrow>
          <DrawerTitle asChild>
            <h2 className="fh-font-serif" style={{ margin: '6px 0 0', fontSize: 24, lineHeight: 1.1, letterSpacing: 0, fontWeight: 400, color: 'var(--ink-strong)' }}>
              Who's it for?
            </h2>
          </DrawerTitle>
          <DrawerDescription style={{ margin: '8px 0 0', fontSize: 14, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}>
            Pick the client and go, you'll build the line items next.
          </DrawerDescription>
        </DrawerHeader>

        <div ref={formRef as any} style={formStyle()}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={labelStyle}>Client</span>
            <ClientPicker userId={userId} value={client} onChange={setClient} />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <span style={labelStyle}>What's it for? <span style={{ textTransform: 'none', letterSpacing: 0, fontWeight: 400 }}>(optional)</span></span>
            <input
              ref={titleRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && canStart) { e.preventDefault(); start() } }}
              placeholder="Kitchen remodel, driveway, roof…"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '12px 12px', borderRadius: 10,
                background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)',
                fontFamily: 'var(--font-body)', fontSize: 14, outline: 'none', scrollMarginBottom: 120
              }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.6fr', gap: 12, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => onClose?.()}
              disabled={starting}
              style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, cursor: 'pointer', minWidth: 0, boxSizing: 'border-box' }}
            >
              <X size={14} />
              Cancel
            </button>
            <motion.button
              type="button"
              onClick={start}
              whileTap={canStart ? { scale: 0.97 } : undefined}
              disabled={!canStart}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                padding: '12px 12px', borderRadius: 10,
                border: canStart ? 'none' : '1px solid var(--rule)',
                background: canStart ? 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))' : 'var(--surface-2)',
                color: canStart ? 'var(--onyx)' : 'var(--ink-muted)',
                fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: 0,
                cursor: canStart ? 'pointer' : 'not-allowed',
                boxShadow: canStart ? '0 6px 16px rgba(201,150,58,0.3)' : 'none',
                minWidth: 0, boxSizing: 'border-box', touchAction: 'manipulation'
              }}
            >
              {starting ? 'STARTING…' : 'START QUOTE'}
              {!starting && <ArrowRight size={15} />}
            </motion.button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
