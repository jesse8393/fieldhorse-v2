// src/components/documents/DocumentShell.jsx
//
// Letter-paper preview wrapper for proposals + invoices. Renders the
// shared chrome: brand-accent top rule, letterhead row (logo + company
// name + tagline + status pill), title block (eyebrow + project title),
// meta grid (CLIENT / dates / number / project address), body content
// (children), and an editorial footer.
//
// Pure presentation — no data fetching, no Supabase calls. Both
// ProposalTemplate and InvoiceTemplate compose this shell with their
// own meta + body.
//
// Responsive: the letter paper renders at 8.5" wide on desktop and
// scales to fit narrower viewports while preserving its proportions
// (so the customer's mobile preview reads the same as desktop). All
// internal spacing uses the shared DOC_SPACE tokens.

import {
  DOC_COLORS, DOC_FONTS, DOC_SPACE, typeStyle,
  resolveBrandGold, resolveBrandGoldSoft
} from './tokens.js'
import { cityState } from './format.js'

/**
 * @param {object}  props
 * @param {object}  props.company         { name, address, phone, email, website,
 *                                            logo_url, brand_accent_hex,
 *                                            license_number, insured_text }
 * @param {string}  props.docTypeEyebrow  'PROPOSAL' / 'INVOICE'
 * @param {string}  props.title           Project title (e.g. "Roof, deck & chimney")
 * @param {Array}   props.metaCols        [{ label, value, accent?: bool, color?: string }, ...]
 *                                          Each col stamps a label over a value. 2-4 cols renders cleanly.
 * @param {object}  [props.status]        { label, tone: 'gold'|'green'|'red'|'slate' } optional pill
 * @param {object}  [props.project]       { title, address } — surfaced under the title when present
 * @param {ReactNode} props.children      Body sections (scope, totals, terms, etc.)
 */
export default function DocumentShell({
  company = {},
  docTypeEyebrow,
  title,
  metaCols = [],
  status = null,
  project = null,
  children
}) {
  const gold = resolveBrandGold(company)
  const goldSoft = resolveBrandGoldSoft(company)
  const tagline = buildTagline(company)

  return (
    <article
      className="fh-doc-shell"
      data-doc-shell="true"
      style={{
        // Letter paper. Caps at 8.5"; flexes down on narrow viewports.
        width: '100%',
        maxWidth: `${DOC_SPACE.pageWidthPx}px`,
        minHeight: `${DOC_SPACE.pageMinHeightPx}px`,
        margin: '0 auto',
        background: DOC_COLORS.paper,
        color: DOC_COLORS.ink,
        fontFamily: DOC_FONTS.body,
        position: 'relative',
        // Subtle paper shadow + cream rule so the preview reads as a
        // real document rather than a flat web card.
        boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 24px 48px -24px rgba(0,0,0,0.25)',
        borderRadius: 4,
        overflow: 'hidden'
      }}
    >
      {/* Top brand-accent rule */}
      <div style={{ height: 4, background: gold }} aria-hidden="true" />

      {/* Body */}
      <div
        style={{
          padding: `${DOC_SPACE.marginPx}px ${DOC_SPACE.marginPx}px ${DOC_SPACE.marginPx + 24}px`,
          display: 'flex',
          flexDirection: 'column',
          gap: `${DOC_SPACE.blockGap}px`
        }}
      >
        {/* ─── Letterhead row ──────────────────────────── */}
        <header
          style={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            alignItems: 'center',
            gap: 16
          }}
        >
          <LogoBlock company={company} gold={gold} />

          <div style={{ minWidth: 0 }}>
            <div
              style={{
                fontFamily: DOC_FONTS.display,
                fontSize: 24,
                fontWeight: 600,
                letterSpacing: '0.08em',
                color: DOC_COLORS.ink,
                lineHeight: 1.05,
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis'
              }}
            >
              {(company?.name || 'My Company').toUpperCase()}
            </div>
            {tagline && (
              <div
                style={{
                  marginTop: 4,
                  ...typeStyle('sub'),
                  color: DOC_COLORS.inkMuted
                }}
              >
                {tagline}
              </div>
            )}
          </div>

          {status && <StatusPill {...status} brandGold={gold} brandGoldSoft={goldSoft} />}
        </header>

        {/* ─── Title block ─────────────────────────────── */}
        <section>
          <div
            style={{
              ...typeStyle('eyebrow'),
              color: gold
            }}
          >
            {docTypeEyebrow}
          </div>
          <h1
            style={{
              ...typeStyle('h1'),
              color: DOC_COLORS.ink,
              margin: '6px 0 0',
              wordBreak: 'break-word'
            }}
          >
            {title || 'Untitled'}
          </h1>
          {project?.address && (
            <div
              style={{
                marginTop: 6,
                ...typeStyle('sub'),
                color: DOC_COLORS.inkMuted
              }}
            >
              {project.address}
            </div>
          )}
        </section>

        {/* ─── Meta grid ──────────────────────────────── */}
        {metaCols.length > 0 && (
          <section>
            <div style={{ height: 1, background: DOC_COLORS.rule, marginBottom: 14 }} aria-hidden="true" />
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: `repeat(${metaCols.length}, minmax(0, 1fr))`,
                gap: 16
              }}
            >
              {metaCols.map((col, i) => (
                <div key={i} style={{ minWidth: 0 }}>
                  <div
                    style={{
                      ...typeStyle('label'),
                      color: DOC_COLORS.inkMuted,
                      marginBottom: 6
                    }}
                  >
                    {col.label}
                  </div>
                  <div
                    style={{
                      ...typeStyle(col.accent ? 'stamp' : 'bodyBold'),
                      color: col.color || (col.accent ? gold : DOC_COLORS.ink),
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {col.value || '—'}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* ─── Body ──────────────────────────────────── */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: `${DOC_SPACE.blockGap}px`
          }}
        >
          {children}
        </div>

        {/* ─── Footer ────────────────────────────────── */}
        <Footer company={company} gold={gold} />
      </div>
    </article>
  )
}

/* ─────────────────────────────────────────────────────────
   Internal blocks
   ───────────────────────────────────────────────────────── */

function LogoBlock({ company, gold }) {
  const hasLogo = !!company?.logo_url
  const monogram = (company?.name || 'MC')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2) || 'MC'

  const size = 56

  if (hasLogo) {
    return (
      <div
        style={{
          width: size,
          height: size,
          border: `1px solid ${gold}`,
          borderRadius: 4,
          background: DOC_COLORS.paperSoft,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          flexShrink: 0
        }}
      >
        <img
          src={company.logo_url}
          alt={`${company?.name || 'Company'} logo`}
          style={{
            maxWidth: size - 8,
            maxHeight: size - 8,
            objectFit: 'contain',
            display: 'block'
          }}
          onError={(e) => {
            // Fall through to monogram visually by swapping the img
            // for a text node when the URL fails / 403s.
            const parent = e.currentTarget.parentNode
            if (parent && parent.dataset.monogramFallback !== 'on') {
              parent.dataset.monogramFallback = 'on'
              e.currentTarget.style.display = 'none'
              const span = document.createElement('span')
              span.textContent = monogram
              span.style.cssText = `font-family:${DOC_FONTS.display};font-size:18px;letter-spacing:0.06em;color:${gold};font-weight:600;`
              parent.appendChild(span)
            }
          }}
        />
      </div>
    )
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        border: `1px solid ${gold}`,
        borderRadius: 4,
        background: DOC_COLORS.paperSoft,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: gold,
        fontFamily: DOC_FONTS.display,
        fontSize: 18,
        fontWeight: 600,
        letterSpacing: '0.06em',
        flexShrink: 0
      }}
    >
      {monogram}
    </div>
  )
}

function StatusPill({ label, tone = 'gold', brandGold, brandGoldSoft }) {
  const palette = {
    gold:  { bg: brandGoldSoft, color: brandGold, border: brandGold },
    green: { bg: 'color-mix(in srgb, #48825F 12%, white)', color: '#2E6346', border: '#48825F' },
    red:   { bg: 'color-mix(in srgb, #B33A3A 12%, white)', color: '#8A2A2A', border: '#B33A3A' },
    slate: { bg: '#F0EFEC', color: '#5C6168', border: '#C8C5BD' }
  }[tone] || { bg: brandGoldSoft, color: brandGold, border: brandGold }

  return (
    <span
      style={{
        ...typeStyle('label'),
        color: palette.color,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        padding: '6px 10px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
        flexShrink: 0
      }}
    >
      {label}
    </span>
  )
}

function Footer({ company, gold }) {
  const trustParts = [
    company?.license_number ? `LIC #${String(company.license_number).trim()}` : '',
    company?.insured_text ? String(company.insured_text).trim() : ''
  ].filter(Boolean)
  const contactParts = [
    company?.phone,
    company?.email,
    company?.website
  ].map((s) => (s && String(s).trim()) || '').filter(Boolean)

  if (!trustParts.length && !contactParts.length && !company?.name) return null

  return (
    <footer
      style={{
        marginTop: 12,
        paddingTop: 14,
        borderTop: `1px solid ${DOC_COLORS.rule}`,
        display: 'flex',
        flexWrap: 'wrap',
        gap: 14,
        justifyContent: 'space-between',
        alignItems: 'baseline'
      }}
    >
      <div
        style={{
          ...typeStyle('sub'),
          color: DOC_COLORS.inkMuted,
          flex: '1 1 auto',
          minWidth: 0
        }}
      >
        {contactParts.join(' · ')}
      </div>
      {trustParts.length > 0 && (
        <div
          style={{
            ...typeStyle('label'),
            color: DOC_COLORS.inkFaint,
            flexShrink: 0
          }}
        >
          {trustParts.join(' · ').toUpperCase()}
        </div>
      )}
    </footer>
  )
}

function buildTagline(company) {
  // Prefer "City, ST" extracted from company.address. Falls back to
  // the full address when only one comma-separated token is present.
  // Returns '' when no address is on file (the letterhead reads as
  // just the company name in that case).
  return cityState(company?.address || '')
}
