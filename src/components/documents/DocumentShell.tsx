// src/components/documents/DocumentShell.tsx
//
// Letter-paper wrapper — restrained editorial layout matching the
// "Estimate #62" reference the contractor approved. Premium feel via
// confident whitespace + a single dark logo block + minimal hairlines.
//
// Layout (top → bottom):
//
//   ┌────────────────────────────────────────────────────────────┐
//   │  [LOGO]                              {DOC_TYPE} #{NUMBER}  │
//   │                                      ─────────────────     │
//   │                                      SENT ON:              │
//   │                                      {issued date}         │
//   │                                                             │
//   │  ──────────────────         ──────────────────────         │
//   │  RECIPIENT:                  SENDER:                       │
//   │  {client name + address}     {company name + address}      │
//   │                              {phone / email / website}     │
//   │                                                             │
//   │  {children — body sections}                                 │
//   └────────────────────────────────────────────────────────────┘
//
// Replaces the prior gold-accent letterhead. Type stays sans-serif
// (DM Sans) throughout — the reference is calm-and-confident, not
// editorial-display. brand_accent_hex still drives the table header
// bar on the items table inside children + the logo monogram fallback
// frame, so each contractor's brand color still surfaces without
// overwhelming the doc.

import { DOC_COLORS, DOC_FONTS, DOC_SPACE, resolveBrandGold } from './tokens.ts'

/**
 * @param {object}    props
 * @param {object}    props.company
 * @param {string}    props.docType       — 'ESTIMATE' | 'PROPOSAL' | 'INVOICE'
 * @param {string}    props.number        — full doc number
 * @param {Date|string} [props.issuedAt]  — sent / issued date
 * @param {object}    props.recipient     — { name, address, phone, email }
 * @param {object}    [props.status]      — { label, tone } small chip top-right
 * @param {ReactNode} props.children      — body (items table, totals, etc.)
 * @param {ReactNode} [props.footer]      — fine-print paragraph at bottom
 */
export default function DocumentShell({
  company = {},
  docType,
  number,
  issuedAt,
  recipient = {},
  status = null,
  children,
  footer
}: any) {
  const brand = resolveBrandGold(company)

  return (
    <article
      className="fh-doc-shell"
      style={{
        width: '100%',
        maxWidth: `${DOC_SPACE.pageWidthPx}px`,
        minHeight: `${DOC_SPACE.pageMinHeightPx}px`,
        margin: '0 auto',
        background: DOC_COLORS.paper,
        color: DOC_COLORS.ink,
        fontFamily: DOC_FONTS.body,
        position: 'relative',
        boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 24px 48px -24px rgba(0,0,0,0.25)',
        borderRadius: 4,
        overflow: 'hidden'
      }}
    >
      <div
        style={{
          padding: `${DOC_SPACE.marginPx}px ${DOC_SPACE.marginPx}px ${DOC_SPACE.marginPx + 20}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: 28
        }}
      >
        {/* ─── Header row ─────────────────────────────────── */}
        <header
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 24,
            alignItems: 'flex-start'
          }}
        >
          <LogoBlock company={company} brand={brand} />
          <DocMetaBlock
            docType={docType}
            number={number}
            issuedAt={issuedAt}
            status={status}
          />
        </header>

        {/* ─── Recipient / Sender ─────────────────────────── */}
        <PartiesBlock recipient={recipient} company={company} />

        {/* ─── Body — items table, totals, supporting sections ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          {children}
        </div>

        {/* ─── Footer fine print ──────────────────────────── */}
        {footer && (
          <footer
            style={{
              marginTop: 4,
              fontSize: 11,
              lineHeight: 1.5,
              color: DOC_COLORS.inkMuted
            }}
          >
            {footer}
          </footer>
        )}
      </div>
    </article>
  )
}

/* ─────────────────────────────────────────────────────────
   Internal blocks
   ───────────────────────────────────────────────────────── */

function LogoBlock({ company, brand }: any) {
  const hasLogo = !!company?.logo_url
  const monogram = (company?.name || 'MC')
    .split(/\s+/)
    .filter(Boolean)
    .map((w: any) => w[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2) || 'MC'

  const size = 96

  if (hasLogo) {
    return (
      <div
        style={{
          width: size,
          height: size,
          background: brand,
          borderRadius: 4,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden'
        }}
      >
        <img
          src={company.logo_url}
          alt={`${company?.name || 'Company'} logo`}
          style={{
            maxWidth: size - 10,
            maxHeight: size - 10,
            objectFit: 'contain',
            display: 'block'
          }}
          onError={(e) => {
            const parent = e.currentTarget.parentNode as HTMLElement | null
            if (parent && parent.dataset.monogramFallback !== 'on') {
              parent.dataset.monogramFallback = 'on'
              e.currentTarget.style.display = 'none'
              const span = document.createElement('span')
              span.textContent = monogram
              span.style.cssText = `font-family:${DOC_FONTS.display};font-size:28px;letter-spacing:0.08em;color:white;font-weight:600;`
              parent.appendChild(span)
            }
          }}
        />
      </div>
    )
  }

  // Monogram fallback — dark brand-accent square with white initials.
  return (
    <div
      style={{
        width: size,
        height: size,
        background: brand,
        borderRadius: 4,
        display: 'grid',
        placeItems: 'center',
        color: '#ffffff',
        fontFamily: DOC_FONTS.display,
        fontSize: 32,
        fontWeight: 600,
        letterSpacing: '0.06em'
      }}
    >
      {monogram}
    </div>
  )
}

function DocMetaBlock({ docType, number, issuedAt, status }: any) {
  return (
    <div style={{ textAlign: 'right' }}>
      <div
        style={{
          fontFamily: DOC_FONTS.body,
          fontSize: 26,
          fontWeight: 700,
          letterSpacing: '0.01em',
          color: DOC_COLORS.ink,
          marginBottom: 12
        }}
      >
        {docType?.toUpperCase()} #{number}
      </div>
      <div style={{ height: 1, background: DOC_COLORS.ink, opacity: 0.85, marginBottom: 14 }} />
      <div
        style={{
          fontFamily: DOC_FONTS.body,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: DOC_COLORS.ink,
          marginBottom: 6
        }}
      >
        Sent on:
      </div>
      <div
        style={{
          fontFamily: DOC_FONTS.body,
          fontSize: 13,
          color: DOC_COLORS.ink
        }}
      >
        {formatLongDate(issuedAt) || '—'}
      </div>
      {status && (
        <div style={{ marginTop: 12 }}>
          <StatusChip {...status} />
        </div>
      )}
    </div>
  )
}

function PartiesBlock({ recipient, company }: any) {
  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 24
      }}
    >
      <Party label="RECIPIENT" name={recipient?.name} lines={[
        recipient?.address,
        [recipient?.phone, recipient?.email].filter(Boolean).join(' · ')
      ].filter(Boolean)} />
      <Party label="SENDER" name={company?.name} lines={[
        company?.address,
        company?.phone ? `Phone: ${company.phone}` : '',
        company?.email ? `Email: ${company.email}` : '',
        company?.website ? `Website: ${company.website}` : ''
      ].filter(Boolean)} />
    </section>
  )
}

function Party({ label, name, lines }: any) {
  return (
    <div>
      <div style={{ height: 1, background: DOC_COLORS.ink, opacity: 0.85, marginBottom: 14 }} />
      <div
        style={{
          fontFamily: DOC_FONTS.body,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: DOC_COLORS.ink,
          marginBottom: 8
        }}
      >
        {label}:
      </div>
      <div
        style={{
          fontFamily: DOC_FONTS.body,
          fontSize: 15,
          fontWeight: 700,
          color: DOC_COLORS.ink,
          marginBottom: 4,
          wordBreak: 'break-word'
        }}
      >
        {name || '—'}
      </div>
      {lines.map((line: any, i: any) => (
        <div
          key={i}
          style={{
            fontFamily: DOC_FONTS.body,
            fontSize: 13,
            color: DOC_COLORS.inkMid,
            lineHeight: 1.5,
            marginTop: i === 0 ? 0 : 2
          }}
        >
          {line}
        </div>
      ))}
    </div>
  )
}

function StatusChip({ label, tone = 'neutral' }: any) {
  const palette = ({
    neutral: { bg: '#F0EFEC', fg: '#5C6168', br: '#C8C5BD' },
    gold:    { bg: '#F4ECD8', fg: '#8A6F2A', br: '#C8A154' },
    green:   { bg: '#E8F2EC', fg: '#2E6346', br: '#48825F' },
    red:     { bg: '#F4E0DE', fg: '#8A2A2A', br: '#B33A3A' },
    slate:   { bg: '#F0EFEC', fg: '#5C6168', br: '#C8C5BD' }
  } as Record<string, { bg: string; fg: string; br: string }>)[tone] || { bg: '#F0EFEC', fg: '#5C6168', br: '#C8C5BD' }
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '4px 10px',
        borderRadius: 4,
        background: palette.bg,
        border: `1px solid ${palette.br}`,
        color: palette.fg,
        fontFamily: DOC_FONTS.body,
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.16em',
        textTransform: 'uppercase'
      }}
    >
      {label}
    </span>
  )
}

function formatLongDate(iso: any) {
  if (!iso) return ''
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'long', day: '2-digit', year: 'numeric' })
}
