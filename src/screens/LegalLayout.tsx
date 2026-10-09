// src/screens/LegalLayout.tsx, shared shell for the public legal pages.
// Self-contained inline styles so it renders correctly logged-out. The
// colors come from the theme tokens so the page flips with the daylight
// theme like every other screen: a hardcoded dark background here once
// left the light theme's dark ink invisible on it.
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

const BG = 'var(--v3-bg)'
const INK = 'var(--v3-text)'
const MUTED = 'var(--v3-text-muted)'
const GOLD = 'var(--v3-primary-text)'
const RULE = 'color-mix(in srgb, var(--v3-text) 10%, transparent)'

export default function LegalLayout({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    // .fh-legal lets global.css retint the inline gold mailto links in
    // Privacy and Terms for the light theme.
    <div className="fh-legal" style={{ minHeight: '100vh', background: BG, color: INK, padding: '32px 24px' }}>
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <Link to="/" style={{ color: GOLD, textDecoration: 'none', fontWeight: 700, fontSize: 14 }}>← FieldHorse</Link>
        <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: 0, marginTop: 18, marginBottom: 4 }}>{title}</h1>
        <p style={{ color: MUTED, fontSize: 14, marginTop: 0, marginBottom: 28 }}>Last updated: {updated}</p>
        <div style={{ fontSize: 14, lineHeight: 1.7 }}>{children}</div>
        <p style={{ color: MUTED, fontSize: 12, marginTop: 40, borderTop: `1px solid ${RULE}`, paddingTop: 16 }}>
          © {new Date().getFullYear()} FieldHorse. All rights reserved.
        </p>
      </div>
    </div>
  )
}

export function H2({ children }: { children: ReactNode }) {
  return <h2 style={{ fontSize: 20, fontWeight: 800, color: GOLD, marginTop: 28, marginBottom: 8 }}>{children}</h2>
}

export function P({ children }: { children: ReactNode }) {
  return <p style={{ color: INK, marginTop: 0, marginBottom: 12 }}>{children}</p>
}

export function UL({ items }: { items: string[] }) {
  return (
    <ul style={{ color: INK, marginTop: 0, marginBottom: 12, paddingLeft: 24 }}>
      {items.map((it, i) => <li key={i} style={{ marginBottom: 6 }}>{it}</li>)}
    </ul>
  )
}
