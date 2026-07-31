// src/components/documents/ProposalTemplate.tsx
//
// Customer facing HTML preview of a contractor proposal. The bar is a
// $500M company's estimate: the project total and expiry are visible
// without scrolling, every line item is priced in the open (qty ·
// rate · amount, grouped by trade with subtotals), options read as
// additions that are explicitly NOT in the total, and the signature
// block is honest, blank until someone actually signs.
//
// Composes:
//   1. DocumentShell      (letterhead + number + meta dates + hero band)
//   2. Hero band          (project total · line item count · valid-until)
//   3. LineItemsTable     (grouped itemized rows w/ section subtotals)
//   4. Totals block       (subtotal → change orders → total)
//   5. Optional additions   (is_optional items, "+$" amounts, not in total)
//   6. Change orders      (when present)
//   7. Photos             (tagged strips, when present)
//   8. Insurance          (when present)
//   9. Terms grid         (payment terms · warranty · exclusions)
//  10. Approval           (blank sig lines, or the recorded approval)

import DocumentShell, { StatusChip } from './DocumentShell.tsx'
import LineItemsTable from './LineItemsTable.tsx'
import InsuranceModeBlock from './InsuranceModeBlock.tsx'
import ChangeOrdersBlock from './ChangeOrdersBlock.tsx'
import { DOC_COLORS, DOC_FONTS, resolveBrandGold } from './tokens.ts'
import { money, longDate } from './format.ts'
import { proposalNumber } from './numbers.ts'
import { SlateProposal, MintProposal, EditorialProposal } from './proposalThemes.tsx'

const TEMPLATE_COMPONENTS: Record<string, (props: { view: any }) => any> = {
  slate: SlateProposal,
  mint: MintProposal,
  editorial: EditorialProposal
}

const DEFAULT_PAYMENT_COPY = '50% deposit due upon approval · 40% due at material delivery or midpoint · 10% due upon substantial completion.'
const DEFAULT_DISCLAIMER = 'Pricing includes labor, material, standard equipment, placement, finishing, and cleanup for the listed scope only. Pricing is based on visible site conditions at time of estimating. Any hidden conditions, field changes, requested by owner additions, or scope deviations may require additional pricing through written change order approval. Estimate valid for 30 days.'

export default function ProposalTemplate({
  company = {},
  contact = {},
  project,
  scopeSections = [],
  upgrades = [],          // is_optional items, rendered as additions
  pricing = { baseTotal: 0, upgradeTotal: 0, discount: 0, taxRate: 0 },
  paymentSchedule = null, // optional [{ label, note }] override of the default terms copy
  paymentTermsText = null, // contractor's own terms copy (contact.terms_text), beats the 50/40/10 default
  warrantyText,
  exclusions = [],
  insurance = null,
  changeOrders = [],
  approval = null,
  meta = {},
  status = 'draft',
  showInternalNotes = false,
  photos = []
}: any) {
  const issuedAt = meta.issuedAt || new Date()
  const number = meta.number || proposalNumber(company?.name, contact?.id, issuedAt)
  const expiresAt = meta.expiresAt || null
  const brand = resolveBrandGold(company)

  // Itemized groups, one table section per trade, every row priced.
  const groups = scopeSections.map((sec: any) => ({
    title: sec.title,
    items: (sec.items || []).map(normalizeItem)
  })).filter((g: any) => g.items.length > 0)

  const upgradeGroupsFlat = upgrades.flatMap((sec: any) => (sec.items || []).map((it: any) => ({
    ...normalizeItem(it),
    section: sec.title
  })))

  const projectTitle = (project?.title || project?.name || contact?.job_title || '').trim()

  const coAdjustment = (changeOrders || [])
    .filter((co: any) => co?.status === 'approved')
    .reduce((s: any, co: any) => s + Number(co.amount || 0), 0)

  const subtotal = Math.max(0, Number(pricing.baseTotal || 0))
  const discount = Math.max(0, Number(pricing.discount || 0))
  const tax = (subtotal - discount) * Number(pricing.taxRate || 0)
  const grandTotal = Math.max(0, subtotal - discount + tax + coAdjustment)
  const itemCount = groups.reduce((s: number, g: any) => s + g.items.length, 0)

  const statusChip = statusToChip(status)

  // Theme dispatch, named alternates render their own full design.
  const template = String(company?.estimate_template || 'classic').toLowerCase()
  const ThemeComponent = TEMPLATE_COMPONENTS[template]
  if (ThemeComponent) {
    const lineItems = groups.flatMap((g: any) => g.items)
    const view = {
      company,
      recipient: contact,
      number,
      issuedAt,
      expiresAt,
      projectTitle,
      scopeText: project?.scope || contact?.scope_text || '',
      lineItems,
      upgrades: upgrades.map((sec: any) => ({
        title: sec.title,
        items: (sec.items || []).map(normalizeItem),
        amount: (sec.items || []).reduce((s: any, it: any) => s + itemAmount(it), 0)
      })),
      subtotal,
      discount,
      tax,
      taxRate: Number(pricing.taxRate || 0),
      total: grandTotal,
      // The contractor's own terms when set, hardcoding the 50/40/10
      // default here told customers a deposit schedule the contractor
      // never agreed to.
      paymentTerms: (paymentTermsText || '').trim() || DEFAULT_PAYMENT_COPY,
      warrantyText,
      exclusions,
      status,
      approval,
      photos,
      insurance,
      changeOrders
    }
    return <ThemeComponent view={view} />
  }

  // Precedence: contractor's written terms > structured schedule >
  // the generic 50/40/10 default (last resort only).
  const paymentTermsCopy = (paymentTermsText || '').trim()
    || (Array.isArray(paymentSchedule) && paymentSchedule.length > 0
      ? paymentSchedule.map((m: any) => [m.label, m.note].filter(Boolean).join(', ')).join(' · ')
      : DEFAULT_PAYMENT_COPY)

  return (
    <DocumentShell
      company={company}
      docType="Estimate"
      number={number}
      metaRows={[
        { label: 'Issued', value: longDate(issuedAt) || '\u2003' },
        expiresAt && { label: 'Valid until', value: longDate(expiresAt), strong: true }
      ].filter(Boolean)}
      status={statusChip}
      recipient={contact}
      recipientLabel="Prepared for"
      project={projectTitle ? { title: projectTitle, address: project?.address || '' } : null}
      hero={
        <HeroBand
          brand={brand}
          total={grandTotal}
          itemCount={itemCount}
          expiresAt={expiresAt}
          approved={String(status).toLowerCase() === 'approved'}
        />
      }
      footer={DEFAULT_DISCLAIMER}
    >
      {/* Scope narrative, the contractor's own words, when present. */}
      {(contact?.scope_text || project?.scope) && (
        <section>
          <SectionLabel>Scope of work</SectionLabel>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: DOC_COLORS.inkMid, whiteSpace: 'pre-wrap', maxWidth: '70ch' }}>
            {contact?.scope_text || project?.scope}
          </p>
        </section>
      )}

      {/* Itemized pricing, the trust engine. Every line in the open. */}
      {groups.length > 0 && (
        <section>
          <LineItemsTable groups={groups} company={company} layout="grouped" />
          <TotalsBlock
            subtotal={subtotal}
            discount={discount}
            tax={tax}
            taxRate={pricing.taxRate || 0}
            coAdjustment={coAdjustment}
            grandTotal={grandTotal}
            brand={brand}
          />
        </section>
      )}

      {/* Optional additions, explicitly outside the total. */}
      {upgradeGroupsFlat.length > 0 && (
        <section>
          <SectionLabel>Optional additions</SectionLabel>
          <p style={{ margin: '-4px 0 10px', fontSize: 12, color: DOC_COLORS.inkMuted, lineHeight: 1.5 }}>
            Priced separately and not included in the estimate total. Approve any option to add it to the contract.
          </p>
          <AddOnsTable items={upgradeGroupsFlat} />
        </section>
      )}

      {/* Contract amendments */}
      {(changeOrders || []).filter((co: any) => co?.status !== 'void').length > 0 && (
        <section>
          <SectionLabel>Contract amendments</SectionLabel>
          <ChangeOrdersBlock changeOrders={changeOrders} company={company} />
        </section>
      )}

      {/* Project photos */}
      {photos.length > 0 && <ProjectPhotosBlock photos={photos} />}

      {/* Insurance */}
      <InsuranceModeBlock insurance={insurance} company={company} />

      {/* Terms grid, payment · warranty · exclusions */}
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 24,
          borderTop: `1px solid ${DOC_COLORS.rule}`,
          paddingTop: 24
        }}
      >
        <Detail label="Payment terms">{paymentTermsCopy}</Detail>
        {warrantyText && <Detail label="Warranty">{warrantyText}</Detail>}
        {exclusions.length > 0 && (
          <Detail label="Not included">
            <ul style={{ margin: 0, paddingLeft: 16 }}>
              {exclusions.map((x: any, i: number) => (
                <li key={i} style={{ marginTop: i === 0 ? 0 : 3 }}>{x}</li>
              ))}
            </ul>
          </Detail>
        )}
      </section>

      {/* Approval, honest signatures */}
      <ApprovalLines company={company} contact={contact} approval={approval} status={status} />
    </DocumentShell>
  )
}

/* ─── Helpers ─── */

function itemAmount(it: any) {
  return Number(it.amount != null ? it.amount : (Number(it.qty || 1) * Number(it.rate || 0)))
}

function normalizeItem(it: any) {
  return {
    description: (it.description || '\u2003').trim().replace(/^OPTION\s*[:–-]\s*/i, ''),
    qty: Number(it.qty || 1),
    unit: (it.unit || '').trim(),
    rate: Number(it.rate || 0),
    amount: itemAmount(it)
  }
}

/* ─── Internal blocks ─── */

function HeroBand({ brand, total, itemCount, expiresAt, approved }: any) {
  return (
    <section
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-end',
        gap: 24,
        flexWrap: 'wrap',
        padding: '16px 24px',
        background: DOC_COLORS.paperSoft,
        border: `1px solid ${DOC_COLORS.rule}`,
        borderRadius: 10
      }}
    >
      <div>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: DOC_COLORS.inkMuted, marginBottom: 4 }}>
          {approved ? 'Approved contract total' : 'Estimate total'}
        </div>
        <div
          style={{
            fontFamily: DOC_FONTS.serif,
            fontSize: 24,
            fontWeight: 500,
            letterSpacing: 0,
            lineHeight: 1,
            color: approved ? DOC_COLORS.signalGreen : DOC_COLORS.ink,
            fontVariantNumeric: 'tabular-nums'
          }}
        >
          {money(total)}
        </div>
      </div>
      <div style={{ textAlign: 'right', fontSize: 12, color: DOC_COLORS.inkMuted, lineHeight: 1.6 }}>
        {itemCount > 0 && <div>{itemCount} priced line item{itemCount === 1 ? '' : 's'}, itemized below</div>}
        {expiresAt && !approved && (
          <div>
            Pricing honored through <span style={{ color: DOC_COLORS.ink, fontWeight: 600 }}>{longDate(expiresAt)}</span>
          </div>
        )}
        {approved && <div style={{ color: DOC_COLORS.signalGreen, fontWeight: 600 }}>Approved, thank you</div>}
      </div>
    </section>
  )
}

function AddOnsTable({ items }: any) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: DOC_FONTS.body, fontSize: 14 }}>
      <tbody>
        {items.map((it: any, i: number) => (
          <tr key={i}>
            <td style={{ padding: '12px 12px 12px 0', borderBottom: `1px solid ${DOC_COLORS.rule}`, verticalAlign: 'top' }}>
              <span style={{ color: DOC_COLORS.ink }}>{it.description}</span>
              {it.section && (
                <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: DOC_COLORS.inkFaint }}>
                  {it.section}
                </span>
              )}
            </td>
            <td
              style={{
                padding: '12px 0',
                borderBottom: `1px solid ${DOC_COLORS.rule}`,
                textAlign: 'right',
                whiteSpace: 'nowrap',
                fontWeight: 700,
                color: DOC_COLORS.inkMid,
                fontVariantNumeric: 'tabular-nums',
                verticalAlign: 'top'
              }}
            >
              +{money(it.amount, { cents: true })}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ProjectPhotosBlock({ photos }: any) {
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
              <div style={{ fontFamily: DOC_FONTS.body, fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: DOC_COLORS.inkMuted, marginBottom: 8 }}>
                {tag}
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
              {arr.slice(0, 6).map((p: any, i: any) => (
                <figure key={`${tag}-${i}`} style={{ margin: 0 }}>
                  <div style={{ width: '100%', aspectRatio: '4 / 3', background: '#F2EDE4', borderRadius: 10, overflow: 'hidden' }}>
                    <img
                      src={p.url}
                      alt={p.caption || tag}
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                    />
                  </div>
                  {p.caption && (
                    <figcaption style={{ marginTop: 4, fontFamily: DOC_FONTS.body, fontSize: 12, color: DOC_COLORS.inkMuted, lineHeight: 1.35, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
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

function SectionLabel({ children }: any) {
  return (
    <div
      style={{
        fontFamily: DOC_FONTS.body,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0,
        textTransform: 'uppercase',
        color: DOC_COLORS.ink,
        marginBottom: 10
      }}
    >
      {children}
    </div>
  )
}

function Detail({ label, children }: any) {
  return (
    <div>
      <div style={{ fontFamily: DOC_FONTS.body, fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: DOC_COLORS.inkFaint, marginBottom: 5 }}>
        {label}
      </div>
      <div style={{ fontFamily: DOC_FONTS.body, fontSize: 12, color: DOC_COLORS.inkMid, lineHeight: 1.55 }}>
        {children}
      </div>
    </div>
  )
}

function TotalsBlock({ subtotal, discount, tax, taxRate, coAdjustment, grandTotal, brand }: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
      <div style={{ minWidth: 300 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            <Row label="Subtotal" value={money(subtotal, { cents: true })} />
            {discount > 0 && <Row label="Discount" value={`−${money(discount, { cents: true })}`} muted />}
            {taxRate > 0 && <Row label={`Tax · ${(taxRate * 100).toFixed(2)}%`} value={money(tax, { cents: true })} />}
            {coAdjustment !== 0 && (
              <Row
                label="Approved change orders"
                value={`${coAdjustment >= 0 ? '+' : '−'}${money(Math.abs(coAdjustment), { cents: true })}`}
              />
            )}
          </tbody>
        </table>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'baseline',
            gap: 16,
            marginTop: 6,
            paddingTop: 12,
            borderTop: `2px solid ${DOC_COLORS.ink}`
          }}
        >
          <span style={{ fontFamily: DOC_FONTS.body, fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: DOC_COLORS.ink }}>
            Total
          </span>
          <span
            style={{
              fontFamily: DOC_FONTS.body,
              fontSize: 20,
              fontWeight: 700,
              color: DOC_COLORS.ink,
              fontVariantNumeric: 'tabular-nums'
            }}
          >
            {money(grandTotal, { cents: true })}
          </span>
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, muted }: any) {
  return (
    <tr>
      <td style={{ padding: '4px 0', fontFamily: DOC_FONTS.body, fontSize: 12, color: DOC_COLORS.inkMuted, textAlign: 'left' }}>
        {label}
      </td>
      <td style={{ padding: '4px 0', fontFamily: DOC_FONTS.body, fontSize: 12, color: muted ? DOC_COLORS.inkMuted : DOC_COLORS.ink, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </td>
    </tr>
  )
}

/*
 * Signature block. The old version filled the customer's name in a
 * cursive font on UNSIGNED documents, which reads as a forged
 * signature and is exactly the kind of thing that kills trust at
 * contract time. Rules now:
 *
 *   - unsigned  → a true blank line (the customer signs on paper, or
 *                 approves via the secure-link bar below the document)
 *   - approved  → the recorded typed signature in serif italic, with
 *                 the date and an "approved electronically" record line
 */
function ApprovalLines({ company, contact, approval, status }: any) {
  // Stamp a signature ONLY when we have a real approval record, a typed
  // name, a signature image, or a recorded approval timestamp. Status
  // alone must never fabricate a signature: the public link marks a
  // proposal 'approved' without returning the approval payload, and
  // rendering the customer's name in cursive off status alone reads as
  // a forged signature. When approved-but-unstamped, we show an honest
  // "approved electronically on <date>" line and leave the sig blank.
  const approvedAt = approval?.clientApprovedAt || approval?.approvedAt || null
  const stamped = !!(approval?.mode === 'approved'
    && (approval?.clientName || approval?.clientSignatureDataUrl || approvedAt))
  const isApproved = stamped || String(status).toLowerCase() === 'approved'
  return (
    <section style={{ marginTop: 4 }}>
      <SectionLabel>Acceptance</SectionLabel>
      <p style={{ margin: '0 0 20px', fontFamily: DOC_FONTS.body, fontSize: 12, lineHeight: 1.55, color: DOC_COLORS.inkMid, maxWidth: '64ch' }}>
        Signing below (or approving through the secure link this estimate was delivered with) authorizes {company?.name || 'the contractor'} to perform the work described above and forms a binding agreement under the stated terms.
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
        <SigLine
          label="Customer"
          name={stamped ? (approval?.clientName || contact?.name) : null}
          nameUnder={contact?.name}
          dataUrl={stamped ? approval?.clientSignatureDataUrl : null}
          date={stamped ? approvedAt : ''}
          stamped={stamped}
        />
        <SigLine
          label="Contractor"
          name={stamped ? company?.name : null}
          nameUnder={company?.name}
          dataUrl={stamped ? approval?.contractorSignatureDataUrl : null}
          date={stamped ? approval?.contractorApprovedAt : ''}
          stamped={stamped}
        />
      </div>
      {stamped ? (
        <p style={{ margin: '14px 0 0', fontSize: 12, color: DOC_COLORS.inkFaint, lineHeight: 1.5 }}>
          Approved electronically via secure link. Name, date, and network address are recorded with this approval.
        </p>
      ) : isApproved ? (
        <p style={{ margin: '14px 0 0', fontSize: 12, color: DOC_COLORS.signalGreen, fontWeight: 600, lineHeight: 1.5 }}>
          {approvedAt ? `Approved electronically on ${shortDateOnly(approvedAt)}.` : 'Approved electronically.'} A signed record is on file with the contractor.
        </p>
      ) : null}
    </section>
  )
}

function SigLine({ label, name, nameUnder, dataUrl, date, stamped }: any) {
  return (
    <div>
      <div
        style={{
          height: 52,
          display: 'flex',
          alignItems: 'flex-end',
          borderBottom: `1px solid ${DOC_COLORS.ink}`,
          paddingBottom: 4
        }}
      >
        {dataUrl ? (
          <img loading="lazy" src={dataUrl} alt="Signature" style={{ maxHeight: 44, maxWidth: '100%' }} />
        ) : name ? (
          <span style={{ fontFamily: DOC_FONTS.serif, fontStyle: 'italic', fontSize: 20, color: DOC_COLORS.ink, letterSpacing: 0 }}>
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
          fontSize: 12,
          color: DOC_COLORS.inkMuted
        }}
      >
        <span style={{ fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase' }}>
          {label}{!stamped && nameUnder ? `, ${nameUnder}` : ''}
        </span>
        <span style={{ fontSize: 12 }}>
          Date{date ? `: ${shortDateOnly(date)}` : ''}
        </span>
      </div>
    </div>
  )
}

function shortDateOnly(d: any) {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function statusToChip(status: any) {
  switch (String(status || 'draft').toLowerCase()) {
    case 'approved': return { label: 'Approved', tone: 'green' }
    case 'sent':     return { label: 'Sent',     tone: 'gold' }
    case 'viewed':   return { label: 'Viewed',   tone: 'gold' }
    case 'changes_requested': return { label: 'Changes requested', tone: 'red' }
    case 'expired':  return { label: 'Expired',  tone: 'red' }
    case 'rejected': return { label: 'Declined', tone: 'red' }
    default:         return { label: 'Draft',    tone: 'slate' }
  }
}
