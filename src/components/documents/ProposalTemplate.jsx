// src/components/documents/ProposalTemplate.jsx
//
// Customer-facing HTML preview of a contractor proposal — restrained
// editorial layout matching the reference estimate. Composes:
//
//   1. DocumentShell           (logo + ESTIMATE/PROPOSAL # + recipient / sender)
//   2. LineItemsTable          (dark header bar + multi-line desc rows)
//   3. Totals block            (right-aligned, bordered TOTAL box)
//   4. Optional upgrades       (when items.is_optional present)
//   5. Optional change orders  (when changeOrders has entries)
//   6. Optional insurance      (when insurance payload present)
//   7. Payment terms paragraph (configurable, defaults to 50/40/10)
//   8. Approval section        (signature lines)
//   9. Disclaimer paragraph    (DocumentShell footer)
//
// The reference layout is calm-and-confident. Where the prior version
// stacked many bordered cards, this one leans on whitespace + a single
// dark items table as the visual anchor. The brand_accent_hex drives
// the table header bar so each contractor's identity still shows.

import DocumentShell from './DocumentShell.jsx'
import LineItemsTable from './LineItemsTable.tsx'
import InsuranceModeBlock from './InsuranceModeBlock.tsx'
import ChangeOrdersBlock from './ChangeOrdersBlock.tsx'
import { DOC_COLORS, DOC_FONTS } from './tokens.ts'
import { money } from './format.ts'
import { proposalNumber } from './numbers.ts'

const DEFAULT_PAYMENT_COPY = '50% deposit due upon approval · 40% due at material delivery or midpoint · 10% due upon substantial completion.'
const DEFAULT_DISCLAIMER = 'Pricing includes labor, material, standard equipment, placement, finishing, and cleanup for the listed scope only. Pricing is based on visible site conditions at time of estimating. Any hidden conditions, field changes, owner-requested additions, or scope deviations may require additional pricing through written change order approval. Estimate valid for 30 days.'

export default function ProposalTemplate({
  company = {},
  contact = {},
  project,
  scopeSections = [],     // legacy — flattened into rows
  upgrades = [],          // is_optional items, rendered as a second table
  pricing = { baseTotal: 0, upgradeTotal: 0, discount: 0, taxRate: 0 },
  paymentSchedule = null, // unused in v2 — payment terms are a paragraph now
  warrantyText,
  exclusions = [],
  insurance = null,
  changeOrders = [],
  approval = null,
  meta = {},
  status = 'draft',
  showInternalNotes = false,
  photos = []             // [{ url, section_tag, caption }] — tagged
                          // photos surface grouped under Project photos.
}) {
  const number = meta.number || proposalNumber(company?.name, contact?.id)
  const issuedAt = meta.issuedAt || new Date()
  const expiresAt = meta.expiresAt || null

  // Flatten scope sections + their items into a single list of table
  // rows. Section title becomes the row's title; items collapse into
  // descriptionLines so the customer sees one clean "Concrete add on /
  // 12x14.5 concrete / 5x4 concrete" row per trade.
  const baseRows = scopeSections.map((sec) => ({
    id: sec.id,
    title: sec.title,
    descriptionLines: (sec.items || []).map((it) => {
      const qty = Number(it.qty || 1)
      const unit = it.unit ? ` ${it.unit}` : ''
      return qty !== 1
        ? `${qty}${unit} · ${it.description || '—'}`
        : (it.description || '—')
    }),
    qty: 1,
    rate: (sec.items || []).reduce((s, it) => s + Number(it.amount != null ? it.amount : (Number(it.qty || 1) * Number(it.rate || 0))), 0),
    amount: (sec.items || []).reduce((s, it) => s + Number(it.amount != null ? it.amount : (Number(it.qty || 1) * Number(it.rate || 0))), 0)
  }))

  const upgradeRows = upgrades.map((sec) => ({
    id: sec.id,
    title: sec.title,
    descriptionLines: (sec.items || []).map((it) => it.description || '—'),
    qty: 1,
    rate: (sec.items || []).reduce((s, it) => s + Number(it.amount != null ? it.amount : (Number(it.qty || 1) * Number(it.rate || 0))), 0),
    amount: (sec.items || []).reduce((s, it) => s + Number(it.amount != null ? it.amount : (Number(it.qty || 1) * Number(it.rate || 0))), 0)
  }))

  // Approved change orders bump the contract total in the on-screen
  // grand total. They render as their own table row too so the
  // customer sees what got added.
  const coAdjustment = (changeOrders || [])
    .filter((co) => co?.status === 'approved')
    .reduce((s, co) => s + Number(co.amount || 0), 0)

  const subtotal = Math.max(0, Number(pricing.baseTotal || 0))
  const upgradeSubtotal = Math.max(0, Number(pricing.upgradeTotal || 0))
  const discount = Math.max(0, Number(pricing.discount || 0))
  const tax = (subtotal - discount) * Number(pricing.taxRate || 0)
  const grandTotal = Math.max(0, subtotal - discount + tax + coAdjustment)

  const statusChip = statusToChip(status)

  return (
    <DocumentShell
      company={company}
      docType="ESTIMATE"
      number={shortNumber(number)}
      issuedAt={issuedAt}
      recipient={contact}
      status={statusChip}
      footer={DEFAULT_DISCLAIMER}
    >
      {/* Items table */}
      {baseRows.length > 0 && (
        <LineItemsTable rows={baseRows} company={company} />
      )}

      {/* Totals — right-aligned with the boxed TOTAL */}
      <TotalsBlock
        subtotal={subtotal}
        discount={discount}
        tax={tax}
        taxRate={pricing.taxRate || 0}
        coAdjustment={coAdjustment}
        grandTotal={grandTotal}
      />

      {/* Optional upgrades — separate table to keep base/upgrade
          arithmetic obvious. */}
      {upgradeRows.length > 0 && (
        <section>
          <SectionLabel>Optional upgrades</SectionLabel>
          <LineItemsTable rows={upgradeRows} company={company} />
        </section>
      )}

      {/* Change orders */}
      {(changeOrders || []).filter((co) => co?.status !== 'void').length > 0 && (
        <section>
          <SectionLabel>Contract amendments</SectionLabel>
          <ChangeOrdersBlock changeOrders={changeOrders} company={company} />
        </section>
      )}

      {/* Project photos — grouped by section_tag with an untagged
          remainder at the end. Quiet treatment, magazine-style, sits
          between Insurance and Payment Terms so the reader has visual
          proof before the legal text. Renders nothing when there are
          no photos in scope. */}
      {photos.length > 0 && (
        <ProjectPhotosBlock photos={photos} company={company} />
      )}

      {/* Insurance */}
      <InsuranceModeBlock insurance={insurance} company={company} />

      {/* Payment terms + warranty + exclusions as a single editorial
          block instead of three card sections — matches the reference
          calm. */}
      <section style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        <Detail label="PAYMENT TERMS">
          {DEFAULT_PAYMENT_COPY}
        </Detail>
        {warrantyText && (
          <Detail label="WARRANTY">{warrantyText}</Detail>
        )}
        {exclusions.length > 0 && (
          <Detail label="EXCLUSIONS">
            {exclusions.join(' · ')}
          </Detail>
        )}
      </section>

      {/* Signature lines */}
      <ApprovalLines
        company={company}
        contact={contact}
        approval={approval}
      />
    </DocumentShell>
  )
}

/* ─── Internal blocks ─── */

function ProjectPhotosBlock({ photos, company }) {
  // Group by section_tag. Untagged photos collect into a single
  // 'Other' bucket so they still render but stay visually separate.
  const groups = new Map()
  for (const p of photos) {
    if (!p?.url) continue
    const tag = (p.section_tag || '').trim() || 'Project photos'
    if (!groups.has(tag)) groups.set(tag, [])
    groups.get(tag).push(p)
  }
  const entries = Array.from(groups.entries())
  if (entries.length === 0) return null

  return (
    <section>
      <SectionLabel>Project photos</SectionLabel>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {entries.map(([tag, arr]) => (
          <div key={tag}>
            {entries.length > 1 && (
              <div style={{
                fontFamily: DOC_FONTS.body,
                fontSize: 10,
                fontWeight: 700,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                color: DOC_COLORS.inkMuted,
                marginBottom: 8
              }}>
                {tag}
              </div>
            )}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 8
            }}>
              {arr.slice(0, 6).map((p, i) => (
                <figure key={`${tag}-${i}`} style={{ margin: 0 }}>
                  <div style={{
                    width: '100%',
                    aspectRatio: '4 / 3',
                    background: '#e8e2d4',
                    borderRadius: 4,
                    overflow: 'hidden'
                  }}>
                    <img
                      src={p.url}
                      alt={p.caption || tag}
                      loading="lazy"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                        display: 'block'
                      }}
                    />
                  </div>
                  {p.caption && (
                    <figcaption style={{
                      marginTop: 4,
                      fontFamily: DOC_FONTS.body,
                      fontSize: 10,
                      color: DOC_COLORS.inkMuted,
                      lineHeight: 1.35,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical'
                    }}>
                      {p.caption}
                    </figcaption>
                  )}
                </figure>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}

function SectionLabel({ children }) {
  return (
    <div
      style={{
        fontFamily: DOC_FONTS.body,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: DOC_COLORS.ink,
        marginBottom: 10
      }}
    >
      {children}
    </div>
  )
}

function Detail({ label, children }) {
  return (
    <div>
      <div
        style={{
          fontFamily: DOC_FONTS.body,
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.18em',
          color: DOC_COLORS.ink,
          marginBottom: 4
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: DOC_FONTS.body,
          fontSize: 13,
          color: DOC_COLORS.inkMid,
          lineHeight: 1.5
        }}
      >
        {children}
      </div>
    </div>
  )
}

function TotalsBlock({ subtotal, discount, tax, taxRate, coAdjustment, grandTotal }) {
  return (
    <section
      style={{
        display: 'flex',
        justifyContent: 'flex-end',
        marginTop: -8
      }}
    >
      <div style={{ minWidth: 320 }}>
        {(discount > 0 || taxRate > 0 || coAdjustment !== 0) && (
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 10 }}>
            <tbody>
              <Row label="Subtotal" value={money(subtotal, { cents: true })} />
              {discount > 0 && <Row label="Discount" value={`−${money(discount, { cents: true })}`} muted />}
              {taxRate > 0 && <Row label={`Tax · ${(taxRate * 100).toFixed(2)}%`} value={money(tax, { cents: true })} />}
              {coAdjustment !== 0 && <Row label="Approved change orders" value={`${coAdjustment >= 0 ? '+' : ''}${money(coAdjustment, { cents: true })}`} />}
            </tbody>
          </table>
        )}
        <div
          style={{
            display: 'flex',
            justifyContent: 'flex-end',
            alignItems: 'center',
            gap: 18,
            paddingTop: 6
          }}
        >
          <span
            style={{
              fontFamily: DOC_FONTS.body,
              fontSize: 14,
              fontWeight: 600,
              color: DOC_COLORS.ink
            }}
          >
            Total
          </span>
          <span
            style={{
              fontFamily: DOC_FONTS.body,
              fontSize: 16,
              fontWeight: 700,
              color: DOC_COLORS.ink,
              border: `1px solid ${DOC_COLORS.ink}`,
              padding: '8px 18px',
              borderRadius: 2,
              minWidth: 130,
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {money(grandTotal, { cents: true })}
          </span>
        </div>
      </div>
    </section>
  )
}

function Row({ label, value, muted }) {
  return (
    <tr>
      <td
        style={{
          padding: '6px 0',
          fontFamily: DOC_FONTS.body,
          fontSize: 13,
          color: DOC_COLORS.inkMuted,
          textAlign: 'left'
        }}
      >
        {label}
      </td>
      <td
        style={{
          padding: '6px 0',
          fontFamily: DOC_FONTS.body,
          fontSize: 13,
          color: muted ? DOC_COLORS.inkMuted : DOC_COLORS.ink,
          fontWeight: 600,
          textAlign: 'right',
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {value}
      </td>
    </tr>
  )
}

function ApprovalLines({ company, contact, approval }) {
  const stamped = approval?.mode === 'approved'
  return (
    <section style={{ marginTop: 12 }}>
      <SectionLabel>Approval</SectionLabel>
      <p style={{
        margin: '0 0 18px',
        fontFamily: DOC_FONTS.body,
        fontSize: 12,
        lineHeight: 1.5,
        color: DOC_COLORS.inkMid,
        maxWidth: '60ch'
      }}>
        By signing below, the customer authorizes the company to perform the work outlined in this estimate and agrees to the terms and conditions contained herein.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
        <SigLine
          label="Client signature"
          name={approval?.clientName || contact?.name}
          dataUrl={stamped ? approval?.clientSignatureDataUrl : null}
          date={stamped ? approval?.clientApprovedAt : ''}
        />
        <SigLine
          label="Contractor signature"
          name={company?.name}
          dataUrl={stamped ? approval?.contractorSignatureDataUrl : null}
          date={stamped ? approval?.contractorApprovedAt : ''}
        />
      </div>
    </section>
  )
}

function SigLine({ label, name, dataUrl, date }) {
  return (
    <div>
      <div
        style={{
          height: 56,
          display: 'flex',
          alignItems: 'flex-end',
          borderBottom: `1px solid ${DOC_COLORS.ink}`,
          paddingBottom: 4
        }}
      >
        {dataUrl ? (
          <img src={dataUrl} alt="Signature" style={{ maxHeight: 48, maxWidth: '100%' }} />
        ) : name ? (
          <span
            style={{
              fontFamily: "'Caveat', 'Snell Roundhand', cursive",
              fontSize: 24,
              color: DOC_COLORS.inkMid
            }}
          >
            {name}
          </span>
        ) : null}
      </div>
      <div
        style={{
          marginTop: 6,
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'baseline',
          fontFamily: DOC_FONTS.body,
          fontSize: 10,
          color: DOC_COLORS.inkMuted
        }}
      >
        <span style={{ fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
          {label}
        </span>
        <span style={{ fontSize: 11 }}>
          Date{date ? `: ${shortDateOnly(date)}` : ''}
        </span>
      </div>
      {name && (
        <div style={{ marginTop: 3, fontSize: 11, color: DOC_COLORS.inkMuted }}>
          {name}
        </div>
      )}
    </div>
  )
}

function shortDateOnly(d) {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function shortNumber(num) {
  // Reference layout shows "#62" — drop the prefix + year. Keep only
  // the trailing seed segment so the # reads short on the doc.
  if (!num) return ''
  const parts = String(num).split('-')
  return parts[parts.length - 1] || String(num)
}

function statusToChip(status) {
  switch (String(status || 'draft').toLowerCase()) {
    case 'approved': return { label: 'APPROVED', tone: 'green' }
    case 'sent':     return { label: 'SENT',     tone: 'gold' }
    case 'expired':  return { label: 'EXPIRED',  tone: 'red' }
    case 'rejected': return { label: 'REJECTED', tone: 'red' }
    default:         return { label: 'DRAFT',    tone: 'slate' }
  }
}
