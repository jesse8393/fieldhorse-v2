// SnowHomePrototype — variant switcher.
//
// Renders one of four Home variants based on a localStorage flag,
// with a small picker chip at the top so you can flip between them
// to compare. Pure dispatcher — all four sub-components own their
// own layout. The picker is the only chrome this file adds.

import { useEffect, useState } from 'react'
import SnowHome from './SnowHome.tsx'
import SnowHomeSignature from './SnowHomeSignature.tsx'
import SnowHomeEditorial from './SnowHomeEditorial.tsx'
import SnowHomeConsole from './SnowHomeConsole.tsx'

const STORAGE_KEY = 'fh.home.variant'

type Variant = 'current' | 'signature' | 'editorial' | 'console'

const VARIANTS: { key: Variant; label: string; note: string }[] = [
  { key: 'current',   label: 'Snow',       note: 'Current' },
  { key: 'signature', label: 'Signature',  note: 'Evolved Snow' },
  { key: 'editorial', label: 'Editorial',  note: 'Magazine' },
  { key: 'console',   label: 'Console',    note: 'Operator' },
]

export default function SnowHomePrototype(props: any) {
  const [variant, setVariant] = useState<Variant>(() => {
    try {
      const v = localStorage.getItem(STORAGE_KEY) as Variant | null
      if (v && VARIANTS.some((x) => x.key === v)) return v
    } catch {}
    return 'signature'
  })

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, variant) } catch {}
  }, [variant])

  return (
    <div>
      {/* PICKER CHIP — sits above the variant content */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '12px 16px 0',
        flexWrap: 'wrap',
      }}>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10, fontWeight: 700,
          letterSpacing: '0.18em', textTransform: 'uppercase',
          color: 'var(--v3-text-muted)',
        }}>
          Prototype:
        </span>
        <div style={{
          display: 'inline-flex',
          padding: 3,
          gap: 2,
          background: 'var(--v3-surface, #141110)',
          border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
          borderRadius: 6,
        }}>
          {VARIANTS.map((v) => {
            const active = v.key === variant
            return (
              <button
                key={v.key}
                type="button"
                onClick={() => setVariant(v.key)}
                title={v.note}
                style={{
                  padding: '6px 12px',
                  border: 'none',
                  borderRadius: 4,
                  background: active ? 'var(--v3-primary)' : 'transparent',
                  color: active ? 'var(--v3-on-primary, #141414)' : 'var(--v3-text-muted)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  cursor: 'pointer',
                  transition: 'background 120ms ease, color 120ms ease',
                }}
              >
                {v.label}
              </button>
            )
          })}
        </div>
        <span style={{
          marginLeft: 'auto',
          fontFamily: 'var(--font-body)',
          fontSize: 10, fontWeight: 700,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'var(--v3-text-muted)',
        }}>
          {VARIANTS.find((v) => v.key === variant)?.note}
        </span>
      </div>

      {/* Variant body */}
      {variant === 'current'   && <SnowHome {...props} />}
      {variant === 'signature' && <SnowHomeSignature {...props} />}
      {variant === 'editorial' && <SnowHomeEditorial {...props} />}
      {variant === 'console'   && <SnowHomeConsole {...props} />}
    </div>
  )
}
