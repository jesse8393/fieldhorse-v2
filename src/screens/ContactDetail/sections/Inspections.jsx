import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { ClipboardCheck, CheckCircle2, XCircle, MinusCircle } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { Switch } from '@/components/ui/switch'
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription
} from '@/components/ui/drawer'
import { notifySelf } from '../../../lib/notifications.js'
import { hapticTap } from '../../../lib/haptics.js'

const TRADES = [
  'Concrete', 'Framing', 'Roofing', 'Electrical', 'Plumbing',
  'HVAC', 'Insulation', 'Drywall', 'Paint'
]

const RESULT_META = {
  pass: { label: 'Pass',   color: '#4ADE80', soft: 'rgba(46, 204, 113, 0.14)', icon: CheckCircle2 },
  fail: { label: 'Fail',   color: '#F47366', soft: 'rgba(192, 57, 43, 0.14)',  icon: XCircle },
  na:   { label: 'N/A',    color: 'var(--v3-text-muted)', soft: 'rgba(255, 255, 255, 0.05)', icon: MinusCircle }
}

/**
 * Inspections section — fh_inspections grouped by trade. Includes the
 * has_inspections toggle (gates the rest of the UI). Logging an inspection
 * fires a self-notification so the bell stays meaningful pre-server-trigger.
 */
export default function InspectionsSection({ contact, inspections = [], userId, fetchAll, patch }) {
  const enabled = !!contact?.has_inspections

  const byTrade = useMemo(() => {
    const map = {}
    for (const i of inspections) {
      if (!map[i.trade]) map[i.trade] = []
      map[i.trade].push(i)
    }
    return map
  }, [inspections])

  const [activeTrade, setActiveTrade] = useState(null)

  async function logResult(trade, result, notes) {
    await supabase.from('fh_inspections').insert({
      user_id: userId,
      contact_id: contact.id,
      trade,
      result,
      data: { notes: notes || '' }
    })
    notifySelf(userId, {
      kind: 'inspection_logged',
      title: `${trade} · ${String(result).toUpperCase()}`,
      body: contact?.name ? `Inspection logged on ${contact.name}` : 'Inspection logged',
      link: `/jobs/${contact.id}`
    }).catch(() => {})
    setActiveTrade(null)
    fetchAll?.()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 20px 24px' }}>

      {/* Toggle row — controls whether this section is "live" for the job */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '14px 16px',
        borderRadius: 14,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)'
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
            color: 'var(--v3-text)'
          }}>
            Track inspections
          </div>
          <div style={{
            marginTop: 2, fontFamily: 'var(--font-body)', fontSize: 11,
            color: 'var(--v3-text-muted)', lineHeight: 1.45
          }}>
            Enable for permit-tracked trades. Logs persist pass / fail / N/A per inspector visit.
          </div>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => patch?.({ has_inspections: v })}
          aria-label="Toggle inspections tracking"
        />
      </div>

      {/* Trade grid — only shown when enabled */}
      {enabled ? (
        <>
          <div style={{
            fontFamily: 'var(--font-body)',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
            textTransform: 'uppercase', color: 'var(--v3-text-muted)'
          }}>
            Trades
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: 8
          }}>
            {TRADES.map((t) => {
              const list = byTrade[t] || []
              const last = list[0]
              const meta = last ? (RESULT_META[last.result] || RESULT_META.na) : null
              const Icon = meta?.icon || ClipboardCheck
              return (
                <motion.button
                  key={t}
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={() => { hapticTap(); setActiveTrade(t) }}
                  style={{
                    display: 'flex', flexDirection: 'column', gap: 6,
                    padding: '12px 14px', borderRadius: 12,
                    background: meta ? meta.soft : 'var(--v3-surface)',
                    border: meta
                      ? `1px solid color-mix(in srgb, ${meta.color} 35%, transparent)`
                      : '1px solid var(--v3-border)',
                    textAlign: 'left',
                    color: 'var(--v3-text)',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent'
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Icon size={14} aria-hidden="true" color={meta?.color || 'var(--v3-text-muted)'} />
                    <span style={{
                      fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                      letterSpacing: '-0.005em'
                    }}>
                      {t}
                    </span>
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-body)', fontSize: 11,
                    color: 'var(--v3-text-muted)',
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    {last
                      ? `${meta.label} · ${list.length} log${list.length === 1 ? '' : 's'}`
                      : 'Not yet'}
                  </div>
                </motion.button>
              )
            })}
          </div>

          <InspectionLog
            open={!!activeTrade}
            trade={activeTrade}
            onOpenChange={(v) => { if (!v) setActiveTrade(null) }}
            onSave={logResult}
          />
        </>
      ) : (
        <div style={{
          padding: '20px 18px', borderRadius: 14,
          background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
          color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
          fontSize: 13, textAlign: 'center', lineHeight: 1.5
        }}>
          Inspection tracking is off for this job. Toggle on above when permits land.
        </div>
      )}
    </div>
  )
}

/**
 * InspectionLog drawer — pass / fail / N/A + notes. Wraps shadcn Vaul Drawer.
 */
function InspectionLog({ open, trade, onOpenChange, onSave }) {
  const [result, setResult] = useState('pass')
  const [notes, setNotes] = useState('')
  useEffect(() => {
    if (!open) { setResult('pass'); setNotes('') }
  }, [open])

  function commit() {
    onSave(trade, result, notes)
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            fontFamily: 'var(--font-body)',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.18em',
            textTransform: 'uppercase', color: 'var(--v3-primary)'
          }}>
            <ClipboardCheck size={12} />
            Inspection
          </div>
          <DrawerTitle asChild>
            <h2 style={{
              margin: '6px 0 0', fontFamily: 'var(--font-serif)',
              fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1,
              letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--v3-text)'
            }}>
              Log <em style={{ fontStyle: 'italic', color: 'var(--v3-primary)' }}>{trade || 'inspection'}.</em>
            </h2>
          </DrawerTitle>
          <DrawerDescription style={{
            margin: '8px 0 0', fontFamily: 'var(--font-body)',
            fontSize: 13, color: 'var(--v3-text-muted)', lineHeight: 1.45
          }}>
            Record the result and any notes from the inspector.
          </DrawerDescription>
        </DrawerHeader>

        <div style={{ padding: '6px 20px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{
              fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.14em', textTransform: 'uppercase',
              color: 'var(--v3-text-muted)'
            }}>
              Result
            </span>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
              {['pass', 'fail', 'na'].map((r) => {
                const on = result === r
                const meta = RESULT_META[r]
                return (
                  <button
                    key={r}
                    type="button"
                    onClick={() => { hapticTap(); setResult(r) }}
                    style={{
                      padding: '12px 8px', borderRadius: 12,
                      border: on
                        ? `1px solid color-mix(in srgb, ${meta.color} 50%, transparent)`
                        : '1px solid var(--v3-border)',
                      background: on ? meta.soft : 'var(--v3-surface)',
                      color: on ? meta.color : 'var(--v3-text)',
                      fontFamily: 'var(--font-body)',
                      fontSize: 12, fontWeight: 700, letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      cursor: 'pointer'
                    }}
                  >
                    {meta.label}
                  </button>
                )
              })}
            </div>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{
              fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.14em', textTransform: 'uppercase',
              color: 'var(--v3-text-muted)'
            }}>
              Notes
            </span>
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Corrections needed, re-inspection date, inspector name…"
              style={{
                width: '100%', padding: '12px 14px', borderRadius: 12,
                background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
                color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
                fontSize: 14, outline: 'none', resize: 'vertical'
              }}
            />
          </label>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 4 }}>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              style={{
                padding: '12px 14px', borderRadius: 12,
                background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
                color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
                fontSize: 13, fontWeight: 700, cursor: 'pointer'
              }}
            >
              Cancel
            </button>
            <motion.button
              type="button"
              whileTap={{ scale: 0.97 }}
              onClick={commit}
              style={{
                padding: '12px 14px', borderRadius: 12, border: 'none',
                background: 'var(--v3-primary)', color: '#0B0B0D',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                letterSpacing: '0.04em', cursor: 'pointer',
                boxShadow: '0 6px 18px rgba(212, 175, 55, 0.3)'
              }}
            >
              Save
            </motion.button>
          </div>
        </div>
      </DrawerContent>
    </Drawer>
  )
}
