// src/screens/LegalLayout.tsx, shared shell for the public legal pages.
// Self-contained inline styles so it renders correctly logged-out and
// independent of the app's CSS design system.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const BG = '#141414'
const INK = 'var(--v3-text)'
const MUTED = 'var(--v3-text-muted)'
const GOLD = '#C9963A'

export default function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: BG, color: INK, padding: '32px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <Link to="/" style={{ color: GOLD, textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>← FieldHorse</Link>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0, marginTop: 18, marginBottom: 4 }}>{title}</h1>
        <p style={{ color: MUTED, fontSize: 14, marginTop: 0, marginBottom: 28 }}>Last updated: {updated}</p>
        <div style={{ fontSize: 14, lineHeight: 1.7 }}>{children}</div>
        <p style={{ color: MUTED, fontSize: 12, marginTop: 40, borderTop: '1px solid rgba(242, 237, 228,0.1)', paddingTop: 16 }}>
          © {new Date().getFullYear()} FieldHorse. All rights reserved.
        </p>
      </div>
    </div>
  )
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 style={{ fontSize: 20, fontWeight: 800, color: '#C9963A', marginTop: 28, marginBottom: 8 }}>{children}</h2>
}

export function P({ children }: { children: ReactNode }) {
  return <p style={{ color: 'var(--v3-text)', marginTop: 0, marginBottom: 12 }}>{children}</p>
}

export function UL({ items }: { items: string[] }) {
  return (
    <ul style={{ color: 'var(--v3-text)', marginTop: 0, marginBottom: 12, paddingLeft: 24 }}>
      {items.map((it, i) => <li key={i} style={{ marginBottom: 6 }}>{it}</li>)}
    </ul>
  )
}
