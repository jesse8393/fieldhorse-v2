import { Construction } from 'lucide-react'
import { Eyebrow } from '../../../components/v3'

/**
 * Temporary v3 placeholder for tab content scheduled for Drops 3.1–3.3.
 *
 * NOT legacy, this is intentionally inert. The legacy implementations are
 * preserved in src/screens/ContactDetail.jsx (the old monolith file) and
 * remain accessible via the v2 path during the transition. This stub:
 *   - Renders in v3 surface tokens (no fh-* legacy classes)
 *   - Shows the operator what's coming next
 *   - Doesn't pretend to be functional
 *
 * Each call site overrides `name` + `upcoming` so the message is specific.
 */
export default function StubTab({ name, upcoming = [] }: any) {
  return (
    <div style={{
      margin: '24px 20px',
      padding: '32px 24px',
      borderRadius: 10,
      background: 'var(--v3-surface)',
      border: '1px dashed var(--v3-border-strong)',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: 16,
      textAlign: 'center'
    }}>
      <div style={{
        width: 48,
        height: 48,
        borderRadius: 10,
        background: 'var(--v3-primary-soft)',
        border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
        display: 'grid',
        placeItems: 'center',
        color: 'var(--v3-primary)'
      }}>
        <Construction size={22} aria-hidden="true" />
      </div>
      <div>
        <Eyebrow as="div" tone="gold" style={{ marginBottom: 6 }}>
          {name}, v3 in progress
        </Eyebrow>
        <h3 style={{
          margin: 0,
          fontFamily: 'var(--font-serif)',
          fontSize: 20,
          fontWeight: 500,
          letterSpacing: 0,
          color: 'var(--v3-text)'
        }}>
          Coming in the next drop.
        </h3>
        <p style={{
          margin: '8px 0 0',
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          color: 'var(--v3-text-muted)',
          lineHeight: 1.5,
          maxWidth: 360
        }}>
          {upcoming.length > 0
            ? `Building in v3: ${upcoming.join(' · ')}.`
            : 'Coming next.'}
        </p>
      </div>
    </div>
  )
}
