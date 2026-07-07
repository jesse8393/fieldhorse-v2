// src/components/documents/DocumentShell.tsx
//
// Letter-paper wrapper for every customer-facing document. The design
// bar is "what a $500M company sends": the number that matters is in
// the first viewport, the letterhead reads as an established business,
// and everything else is hairlines, small-caps labels, and whitespace.
//
// Layout (top → bottom):
//
//   ┌────────────────────────────────────────────────────────────┐
//   │  [logo] Company Name                    ESTIMATE            │
//   │  license · insured line                 Nº PCC-2026-4F2A    │
//   │  phone · email · website                Issued  July 5      │
//   │                                         Valid   Aug 4       │
//   │  ────────────────────────────────────────────────────────   │
//   │  {hero — template-owned summary band (amount due, total)}   │
//   │                                                              │
//   │  PREPARED FOR             PROJECT                            │
//   │  {client + address}       {project title + site address}     │
//   │                                                              │
//   │  {children — body sections}                                  │
//   │  ────────────────────────────────────────────────────────   │
//   │  fine print · license · questions? phone · email             │
//   └────────────────────────────────────────────────────────────┘
//
// No colored header bars, no monogram billboard: the brand accent
// surfaces only in the hero figure and small marks, which is how
// premium invoices (Stripe, Ramp, high-end architecture firms) carry
// identity without shouting.

import { DOC_COLORS, DOC_FONTS, DOC_SPACE, resolveBrandGold } from './tokens.ts'

/**
 * @param {object}    props
 * @param {object}    props.company
 * @param {string}    props.docType       — 'ESTIMATE' | 'PROPOSAL' | 'INVOICE' | 'CHANGE ORDER' | 'STATEMENT'
 * @param {string}    props.number        — full document number (never truncated)
 * @param {Array}     [props.metaRows]    — [{ label, value, strong? }] date/term rows under the number
 * @param {object}    [props.status]      — { label, tone } chip next to the doc type
 * @param {ReactNode} [props.hero]        — full-width summary band under the letterhead
 * @param {object}    props.recipient     — { name, address, phone, email }
 * @param {string}    [props.recipientLabel] — 'PREPARED FOR' | 'BILLED TO'
 * @param {object}    [props.project]     — { title, address } second column of the parties row
 * @param {ReactNode} props.children      — body (items table, totals, etc.)
 * @param {ReactNode} [props.footer]      — fine-print paragraph at bottom
 */
export default function DocumentShell({
  company = {},
  docType,
  number,
  metaRows = [],
  status = null,
  hero = null,
  recipient = {},
  recipientLabel = 'Prepared for',
  project = null,
  children,
  footer
}: any) {
  const brand = resolveBrandGold(company)
  const contactLine = [company?.phone, company?.email, company?.website].filter(Boolean).join('  ·  ')

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
      {/* Hairline brand keyline across the very top — the one place the
          accent color frames the page. */}
      <div style={{ height: 3, background: brand }} aria-hidden="true" />

      <div
        style={{
          padding: `${DOC_SPACE.marginPx - 8}px ${DOC_SPACE.marginPx}px ${DOC_SPACE.marginPx - 12}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: 30
        }}
      >
        {/* ─── Letterhead ─────────────────────────────────── */}
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 24,
            flexWrap: 'wrap'
          }}
        >
          <div style={{ flex: '1 1 300px', minWidth: 0, maxWidth: 460 }}>
            <CompanyIdentity company={company} contactLine={contactLine} />
          </div>
          <div style={{ flexShrink: 0, marginLeft: 'auto' }}>
            <DocMeta docType={docType} number={number} metaRows={metaRows} status={status} />
          </div>
        </header>

        {/* ─── Hero summary band (template-owned) ─────────── */}
        {hero}

        {/* ─── Parties ─────────────────────────────────────── */}
        <PartiesRow recipient={recipient} recipientLabel={recipientLabel} project={project} />

        {/* ─── Body ────────────────────────────────────────── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 28 }}>
          {children}
        </div>

        {/* ─── Footer fine print ───────────────────────────── */}
        <footer style={{ marginTop: 8, borderTop: `1px solid ${DOC_COLORS.rule}`, paddingTop: 16 }}>
          {footer && (
            <p style={{ margin: 0, fontSize: 10.5, lineHeight: 1.55, color: DOC_COLORS.inkFaint }}>
              {footer}
            </p>
          )}
          <p style={{ margin: footer ? '10px 0 0' : 0, fontSize: 10.5, lineHeight: 1.55, color: DOC_COLORS.inkMuted }}>
            {company?.name || ''}
            {contactLine ? `${company?.name ? ' — ' : ''}Questions? ${contactLine}` : ''}
          </p>
        </footer>
      </div>
    </article>
  )
}

/* ─────────────────────────────────────────────────────────
   Internal blocks
   ───────────────────────────────────────────────────────── */

function CompanyIdentity({ company, contactLine }: any) {
  return (
    <div style={{ minWidth: 0, display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      {company?.logo_url && (
        <img
          loading="lazy"
          src={company.logo_url}
          alt=""
          style={{ height: 44, maxWidth: 120, objectFit: 'contain', display: 'block', flexShrink: 0 }}
          onError={(e) => { e.currentTarget.style.display = 'none' }}
        />
      )}
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            fontFamily: DOC_FONTS.body,
            fontSize: 18,
            fontWeight: 700,
            letterSpacing: '-0.015em',
            color: DOC_COLORS.ink,
            lineHeight: 1.2
          }}
        >
          {company?.name || 'Contractor'}
        </div>
        {company?.address && (
          <div style={{ marginTop: 2, fontSize: 11, color: DOC_COLORS.inkMuted, lineHeight: 1.45 }}>
            {company.address}
          </div>
        )}
        {contactLine && (
          <div style={{ marginTop: 2, fontSize: 11, color: DOC_COLORS.inkMuted, lineHeight: 1.45 }}>
            {contactLine}
          </div>
        )}
      </div>
    </div>
  )
}

function DocMeta({ docType, number, metaRows, status }: any) {
  return (
    <div style={{ textAlign: 'right', flexShrink: 0 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          gap: 10
        }}
      >
        <span
          style={{
            fontFamily: DOC_FONTS.body,
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.24em',
            textTransform: 'uppercase',
            color: DOC_COLORS.ink
          }}
        >
          {docType}
        </span>
        {status && <StatusChip {...status} />}
      </div>
      {number && (
        <div
          style={{
            marginTop: 4,
            fontFamily: DOC_FONTS.body,
            fontSize: 13,
            fontWeight: 600,
            color: DOC_COLORS.inkMid,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {number}
        </div>
      )}
      {metaRows.length > 0 && (
        <table style={{ marginTop: 10, marginLeft: 'auto', borderCollapse: 'collapse' }}>
          <tbody>
            {metaRows.map((r: any) => (
              <tr key={r.label}>
                <td
                  style={{
                    padding: '2px 12px 2px 0',
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.14em',
                    textTransform: 'uppercase',
                    color: DOC_COLORS.inkFaint,
                    textAlign: 'right',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {r.label}
                </td>
                <td
                  style={{
                    padding: '2px 0',
                    fontSize: 12,
                    fontWeight: r.strong ? 700 : 500,
                    color: r.strong ? DOC_COLORS.ink : DOC_COLORS.inkMid,
                    textAlign: 'right',
                    whiteSpace: 'nowrap',
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  {r.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function PartiesRow({ recipient, recipientLabel, project }: any) {
  return (
    <section
      style={{
        display: 'grid',
        gridTemplateColumns: project ? '1fr 1fr' : '1fr',
        gap: 24,
        borderTop: `1px solid ${DOC_COLORS.rule}`,
        paddingTop: 18
      }}
    >
      <Party
        label={recipientLabel}
        name={recipient?.name}
        lines={[
          recipient?.address,
          [recipient?.phone, recipient?.email].filter(Boolean).join(' · ')
        ].filter(Boolean)}
      />
      {project && (
        <Party
          label="Project"
          name={project?.title}
          lines={[project?.address].filter(Boolean)}
        />
      )}
    </section>
  )
}

function Party({ label, name, lines }: any) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        style={{
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          textTransform: 'uppercase',
          color: DOC_COLORS.inkFaint,
          marginBottom: 6
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14.5,
          fontWeight: 700,
          color: DOC_COLORS.ink,
          wordBreak: 'break-word',
          lineHeight: 1.3
        }}
      >
        {name || '—'}
      </div>
      {lines.map((line: any, i: any) => (
        <div key={i} style={{ fontSize: 12, color: DOC_COLORS.inkMuted, lineHeight: 1.5, marginTop: i === 0 ? 3 : 1 }}>
          {line}
        </div>
      ))}
    </div>
  )
}

export function StatusChip({ label, tone = 'neutral' }: any) {
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
        padding: '3px 8px',
        borderRadius: 999,
        background: palette.bg,
        border: `1px solid ${palette.br}`,
        color: palette.fg,
        fontFamily: DOC_FONTS.body,
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        verticalAlign: 'middle'
      }}
    >
      {label}
    </span>
  )
}
