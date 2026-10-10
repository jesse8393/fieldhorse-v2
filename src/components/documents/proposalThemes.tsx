// src/components/documents/proposalThemes.tsx
//
// Selectable customer facing estimate designs. Each theme is a complete
// letter-paper render of the same normalized `view` produced by
// ProposalTemplate, so the contractor can pick the look that fits their
// brand (Settings → Estimate template) and every surface, in-app
// preview and the public /p/:token page, renders it identically. Theme
// colors come from THEME_PALETTES in tokens.ts, which the PDF export
// (src/lib/pdf.js) reads too, so the emailed or signed PDF matches.
//
// Themes here all share three principles that distinguish them from the
// legacy 'classic' layout:
//   1. Individual line items (one row per service: Qty · Unit Price · Amount)
//   2. The contractor's own uploaded logo, top of document
//   3. A distinct visual identity (header treatment, table, totals)
//
// FieldhorseProposal (the last export) is the exception: it is the phone
// first customer portal of the October 2026 redesign (spec 9.9), built from
// the fh components and --fh- tokens so it follows Day and Night, and it
// reads lib/portalView.ts instead of the letter paper helpers below. It
// ships as a choice in Settings and is never the default (decision D13).
//
// The distinctive part of each theme is its header + parties + line item
// table + totals. Supporting sections (scope prose, payment terms,
// exclusions, photos, insurance, change orders, signature) are rendered
// by the shared <SupportingSections> block so the themes stay focused
// and feature-complete without duplicating that machinery three times.

import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { Phone } from 'lucide-react'
import { DOC_COLORS, DOC_FONTS, THEME_PALETTES } from './tokens.ts'
import { money, longDate } from './format.ts'
import InsuranceModeBlock from './InsuranceModeBlock.tsx'
import ChangeOrdersBlock from './ChangeOrdersBlock.tsx'
import { Button, Chip, Icon, OnyxStage, Row, formatMoney } from '../fh'
import Monogram from '../fh/Monogram.tsx'
import { cx } from '../fh/cx.ts'
import { buildPortalView, depositSentence, type PortalView, type PublicDocPayload } from '../../lib/portalView.ts'
import './fieldhorse-proposal.css'

export type ProposalLineItem = {
  description: string
  qty: number
  unit?: string
  rate: number
  amount: number
}

export type ProposalView = {
  company: any
  recipient: any
  number: string
  issuedAt?: Date | string | null
  expiresAt?: Date | string | null
  projectTitle?: string
  scopeText?: string
  lineItems: ProposalLineItem[]
  upgrades?: { title: string; items: ProposalLineItem[]; amount: number }[]
  subtotal: number
  discount?: number
  tax?: number
  taxRate?: number
  total: number
  paymentTerms?: string
  warrantyText?: string
  exclusions?: string[]
  status?: string
  approval?: any
  photos?: any[]
  insurance?: any
  changeOrders?: any[]
  /** Only the live customer link passes this; see FieldhorseProposal. */
  portal?: ProposalPortal
}

/**
 * What the public page hands the Fieldhorse theme besides the shared view:
 * the /api/public-link payload (the portal view model reads it), the
 * approve bar to draw in the bottom capsule while the quote is open, and
 * what "Ask about this" does. The in app preview passes none of it.
 */
export type ProposalPortal = {
  payload: PublicDocPayload
  approveBar?: ReactNode
  onAsk?: (itemTitle: string) => void
}

const PAGE_W = 816
const PAGE_MIN_H = 1056
const PAD = 56

/* ─── Page wrapper ─── */
function Page({ background = '#F2EDE4', color = '#141414', children }: any) {
  return (
    <article
      style={{
        width: '100%',
        maxWidth: `${PAGE_W}px`,
        minHeight: `${PAGE_MIN_H}px`,
        margin: '0 auto',
        background,
        color,
        fontFamily: DOC_FONTS.body,
        boxShadow: '0 1px 0 rgba(20, 20, 20,0.04), 0 24px 48px -24px rgba(20, 20, 20,0.25)',
        borderRadius: 10,
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      <div style={{ padding: `${PAD}px ${PAD}px ${PAD + 20}px` }}>{children}</div>
    </article>
  )
}

/* ─── Logo ─── */
function LogoMark({ company, maxHeight = 64, align = 'left' }: any) {
  const monogram = (company?.name || 'MC')
    .split(/\s+/).filter(Boolean).map((w: any) => w[0]).join('')
    .toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'MC'
  if (company?.logo_url) {
    return (
      <img loading="lazy"src={company.logo_url}
        alt={`${company?.name || 'Company'} logo`}
        style={{ maxHeight, maxWidth: 220, objectFit: 'contain', display: 'block', margin: align === 'right' ? '0 0 0 auto' : 0 }}
      />
    )
  }
  return (
    <div style={{
      width: maxHeight, height: maxHeight, borderRadius: 10,
      background: '#141414', color: '#F2EDE4', display: 'grid', placeItems: 'center',
      fontFamily: DOC_FONTS.display, fontSize: maxHeight * 0.36, fontWeight: 600,
      letterSpacing: 0, marginLeft: align === 'right' ? 'auto' : 0
    }}>
      {monogram}
    </div>
  )
}

function fmtDate(d: any) {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' })
}
function fmtLongDate(d: any) {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { month: 'long', day: '2-digit', year: 'numeric' })
}

/* ─── Shared supporting sections (scope prose, terms, exclusions,
   photos, insurance, change orders, signature). Accent-tinted so it
   reads as part of each theme. ─── */
function SupportingSections({ view, accent, muted = '#5C5C5C', mid = '#141414', rule = DOC_COLORS.rule }: any) {
  const { scopeText, paymentTerms, warrantyText, exclusions = [], photos = [], insurance, changeOrders = [], company, recipient, approval, upgrades = [], status } = view
  const Label = ({ children }: any) => (
    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: accent, marginBottom: 6 }}>
      {children}
    </div>
  )
  const showInsurance = insurance && (insurance.mode === 'insurance' || insurance.claimNumber || insurance.carrier)
  const visibleCOs = (changeOrders || []).filter((co: any) => co?.status && co.status !== 'void')
  // Stamp a signature ONLY when a real approval record exists, a typed
  // name, a signature image, or a recorded approval timestamp. Status
  // alone must never fabricate a cursive "signature" (the public link
  // marks a proposal 'approved' without returning the approval payload).
  // Mirrors ProposalTemplate's ApprovalLines.
  const approvedAt = approval?.clientApprovedAt || approval?.approvedAt || null
  const stamped = !!(approval?.mode === 'approved'
    && (approval?.clientName || approval?.clientSignatureDataUrl || approvedAt))
  const isApproved = stamped || String(status || '').toLowerCase() === 'approved'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 30 }}>
      {scopeText && scopeText.trim() && (
        <section>
          <Label>Scope of Work</Label>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: mid, whiteSpace: 'pre-wrap' }}>{scopeText.trim()}</p>
        </section>
      )}

      {photos.length > 0 && (
        <section>
          <Label>Project photos</Label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
            {photos.slice(0, 6).map((p: any, i: number) => p?.url && (
              <div key={i} style={{ width: '100%', aspectRatio: '4 / 3', background: '#F2EDE4', borderRadius: 10, overflow: 'hidden' }}>
                <img src={p.url} alt={p.caption || 'Project photo'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
            ))}
          </div>
        </section>
      )}

      {upgrades.length > 0 && (
        <section>
          <Label>Optional upgrades</Label>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              {upgrades.flatMap((g: any) => g.items).map((it: any, i: number) => (
                <tr key={i} style={{ borderBottom: `1px solid ${rule}` }}>
                  <td style={{ ...tdL, color: mid }}>{it.description}</td>
                  <td style={{ ...tdR, color: mid }}>{qtyLabel(it)}</td>
                  <td style={{ ...tdR, color: mid }}>{money(it.rate, { cents: true })}</td>
                  <td style={{ ...tdR, color: mid, fontWeight: 600 }}>{money(it.amount, { cents: true })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {showInsurance && <InsuranceModeBlock insurance={insurance} company={company} />}
      {visibleCOs.length > 0 && (
        <section>
          <Label>Contract amendments</Label>
          <ChangeOrdersBlock changeOrders={changeOrders} company={company} />
        </section>
      )}

      <section>
        <Label>Payment terms</Label>
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: mid }}>
          {paymentTerms || '50% deposit due upon approval · 40% due at material delivery or midpoint · 10% due upon substantial completion.'}
        </p>
      </section>

      {warrantyText && warrantyText.trim() && (
        <section>
          <Label>Warranty</Label>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: mid }}>{warrantyText.trim()}</p>
        </section>
      )}

      {exclusions.length > 0 && (
        <section>
          <Label>Exclusions</Label>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: mid }}>{exclusions.join(' · ')}</p>
        </section>
      )}

      <section style={{ marginTop: 8 }}>
        <Label>Approval</Label>
        <p style={{ margin: '0 0 22px', fontSize: 12, lineHeight: 1.5, color: mid, maxWidth: '62ch' }}>
          By signing below, the customer authorizes the company to perform the work outlined in this estimate and agrees to the terms and conditions contained herein.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24 }}>
          <SignatureLine label="Client signature" name={stamped ? (approval?.clientName || recipient?.name) : null} dataUrl={stamped ? approval?.clientSignatureDataUrl : null} date={stamped ? approvedAt : ''} muted={muted} />
          <SignatureLine label="Contractor signature" name={stamped ? company?.name : null} dataUrl={stamped ? approval?.contractorSignatureDataUrl : null} date={stamped ? approval?.contractorApprovedAt : ''} muted={muted} />
        </div>
        {stamped ? (
          <p style={{ margin: '14px 0 0', fontSize: 12, color: muted, lineHeight: 1.5 }}>
            Approved electronically via secure link. Name, date, and network address are recorded with this approval.
          </p>
        ) : isApproved ? (
          <p style={{ margin: '14px 0 0', fontSize: 12, color: accent, fontWeight: 600, lineHeight: 1.5 }}>
            {approvedAt ? `Approved electronically on ${fmtDate(approvedAt)}.` : 'Approved electronically.'} A signed record is on file with the contractor.
          </p>
        ) : null}
      </section>
    </div>
  )
}

function SignatureLine({ label, name, dataUrl, date, muted }: any) {
  return (
    <div>
      <div style={{ height: 52, display: 'flex', alignItems: 'flex-end', borderBottom: '1px solid #141414', paddingBottom: 4 }}>
        {dataUrl
          ? <img loading="lazy"src={dataUrl} alt="Signature" style={{ maxHeight: 46, maxWidth: '100%' }} />
          : name ? <span style={{ fontFamily: "'Caveat', 'Snell Roundhand', cursive", fontSize: 20, color: muted }}>{name}</span> : null}
      </div>
      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 12, color: muted, letterSpacing: 0 }}>
        <span style={{ fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase' }}>{label}</span>
        <span>Date{date ? `: ${fmtDate(date)}` : ''}</span>
      </div>
    </div>
  )
}

function TotalsRows({ view, accentText = '#141414', boxed }: any) {
  const showTax = Number(view.taxRate || 0) > 0
  const showDiscount = Number(view.discount || 0) > 0
  // Approved change orders fold into view.total (subtotal − discount +
  // tax + coAdjustment); without an explicit line the visible arithmetic
  // wouldn't reconcile to the printed Total. Computed the same way
  // ProposalTemplate does.
  const coAdjustment = (view.changeOrders || [])
    .filter((co: any) => co?.status === 'approved')
    .reduce((s: number, co: any) => s + Number(co.amount || 0), 0)
  return (
    <>
      <Totline label="Subtotal" value={money(view.subtotal, { cents: true })} />
      {showDiscount && <Totline label="Discount" value={`−${money(view.discount, { cents: true })}`} />}
      {showTax && <Totline label={`Tax (${(Number(view.taxRate) * 100).toFixed(0)}%)`} value={money(view.tax, { cents: true })} />}
      {coAdjustment !== 0 && (
        <Totline
          label="Approved change orders"
          value={`${coAdjustment >= 0 ? '+' : '−'}${money(Math.abs(coAdjustment), { cents: true })}`}
        />
      )}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 8, paddingTop: 12, borderTop: '1px solid rgba(20, 20, 20,0.12)',
        ...(boxed ? { background: boxed, padding: '12px 12px', borderTop: 'none', borderRadius: 10 } : {})
      }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: accentText }}>Total</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: accentText, fontVariantNumeric: 'tabular-nums' }}>{money(view.total, { cents: true })}</span>
      </div>
    </>
  )
}
function Totline({ label, value }: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 14 }}>
      <span style={{ color: '#5C5C5C' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: '#141414' }}>{value}</span>
    </div>
  )
}

/* ============================================================
   SLATE, gray header bar, FROM/FOR, detailed dark line item table.
   ============================================================ */
export function SlateProposal({ view }: { view: ProposalView }) {
  const { company, recipient } = view
  const pal = THEME_PALETTES.slate
  const bar = pal.accent
  return (
    <Page>
      <div style={{ marginBottom: 28 }}>
        <LogoMark company={company} maxHeight={64} />
      </div>

      <div style={{ background: bar, color: pal.onAccent, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '12px 24px', margin: `0 -${PAD - 0}px`, paddingLeft: PAD, paddingRight: PAD }}>
        <MetaCell label="Estimate No." value={view.number} />
        <MetaCell label="Issue Date" value={fmtDate(view.issuedAt) || '\u2003'} />
        <MetaCell label="Valid Until" value={fmtDate(view.expiresAt) || '\u2003'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, padding: '24px 0 24px', borderBottom: `1px solid ${pal.rule}` }}>
        <PartyCol label="From" name={company?.name} lines={addressLines(company)} />
        <PartyCol label="For" name={recipient?.name} lines={addressLines(recipient)} />
      </div>

      {view.projectTitle && <ProjectHeading title={view.projectTitle} color="#141414" />}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 18, fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #141414' }}>
            <th style={thL}>Description</th>
            <th style={thR}>Quantity</th>
            <th style={thR}>Unit Price</th>
            <th style={thR}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {view.lineItems.map((it, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${pal.rule}` }}>
              <td style={tdL}>{it.description}</td>
              <td style={tdR}>{qtyLabel(it)}</td>
              <td style={tdR}>{money(it.rate, { cents: true })}</td>
              <td style={{ ...tdR, fontWeight: 600 }}>{money(it.amount, { cents: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <div style={{ minWidth: 300 }}><TotalsRows view={view} /></div>
      </div>

      <SupportingSections view={view} accent={bar} mid={pal.mid} muted={pal.muted} rule={pal.rule} />
    </Page>
  )
}

/* ============================================================
   MINT, large green ESTIMATE wordmark, green table + total row.
   ============================================================ */
export function MintProposal({ view }: { view: ProposalView }) {
  const { company, recipient } = view
  const pal = THEME_PALETTES.mint
  const green = pal.accent
  const greenSoft = pal.accentSoft
  return (
    <Page>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10, gap: 16 }}>
        <div style={{ minWidth: 0, maxWidth: '62%' }}>
          <div style={{ fontSize: 20, fontWeight: 700, color: '#141414' }}>{company?.name || '\u2003'}</div>
          {addressLines(company).map((l, i) => (
            <div key={i} style={{ fontSize: 12, color: '#5C5C5C', lineHeight: 1.5, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{l}</div>
          ))}
        </div>
        <LogoMark company={company} maxHeight={70} align="right" />
      </div>

      <div style={{ textAlign: 'right', margin: '14px 0 26px' }}>
        <span style={{ fontFamily: DOC_FONTS.display, fontSize: 24, letterSpacing: 0, color: green, fontWeight: 700 }}>ESTIMATE</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 26 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: green, marginBottom: 4 }}>To</div>
          <div style={{ fontSize: 16, color: '#141414', marginBottom: 4 }}>{recipient?.name || '\u2003'}</div>
          {addressLines(recipient).map((l, i) => (
            <div key={i} style={{ fontSize: 12, color: '#5C5C5C', lineHeight: 1.5, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{l}</div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <MintMeta label="Estimate #" value={view.number} green={green} />
          <MintMeta label="Estimate date" value={fmtDate(view.issuedAt) || '\u2003'} green={green} />
          <MintMeta label="Valid until" value={fmtDate(view.expiresAt) || '\u2003'} green={green} />
        </div>
      </div>

      {view.projectTitle && <ProjectHeading title={view.projectTitle} color={green} />}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14, fontSize: 14 }}>
        <thead>
          <tr style={{ background: green, color: pal.onAccent }}>
            <th style={{ ...thR, color: pal.onAccent, padding: '12px 12px', width: '12%' }}>Qty</th>
            <th style={{ ...thL, color: pal.onAccent, padding: '12px 12px' }}>Description</th>
            <th style={{ ...thR, color: pal.onAccent, padding: '12px 12px', width: '20%' }}>Unit Price</th>
            <th style={{ ...thR, color: pal.onAccent, padding: '12px 12px', width: '20%' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {view.lineItems.map((it, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${pal.rule}` }}>
              <td style={{ ...tdR, paddingLeft: 12, paddingRight: 12 }}>{qtyLabel(it)}</td>
              <td style={tdL}>{it.description}</td>
              <td style={tdR}>{money(it.rate, { cents: true })}</td>
              <td style={{ ...tdR, fontWeight: 600 }}>{money(it.amount, { cents: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <div style={{ minWidth: 300 }}><TotalsRows view={view} accentText={green} boxed={greenSoft} /></div>
      </div>

      <SupportingSections view={view} accent={green} mid={pal.mid} muted={pal.muted} rule={pal.rule} />
    </Page>
  )
}

/* ============================================================
   EDITORIAL, sand/serif, Job Title + ESTIMATE wordmark, Cost Breakdown.
   ============================================================ */
export function EditorialProposal({ view }: { view: ProposalView }) {
  const { company, recipient } = view
  const pal = THEME_PALETTES.editorial
  const sand = pal.paper || DOC_COLORS.paper
  const tan = pal.accent
  const ink = pal.ink
  return (
    <Page background={sand} color={ink}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          {view.projectTitle && (
            <div style={{ fontFamily: DOC_FONTS.serif, fontSize: 24, color: ink, marginBottom: 2 }}>{view.projectTitle}</div>
          )}
          <div style={{ fontFamily: DOC_FONTS.serif, fontSize: 24, lineHeight: 1, color: tan, letterSpacing: 0 }}>ESTIMATE</div>
        </div>
        <LogoMark company={company} maxHeight={72} align="right" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24, margin: '34px 0 28px' }}>
        <EditCol label="" lines={[company?.name, ...addressLines(company)]} tan={tan} />
        <EditCol label="" lines={[recipient?.name, ...addressLines(recipient)]} tan={tan} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <EditMeta label="Date" value={fmtDate(view.issuedAt) || '\u2003'} tan={tan} />
          <EditMeta label="Estimate #" value={view.number} tan={tan} />
          <EditMeta label="Est. Total" value={money(view.total)} tan={tan} />
        </div>
      </div>

      {view.scopeText && view.scopeText.trim() && (
        <section style={{ marginBottom: 26 }}>
          <div style={{ fontFamily: DOC_FONTS.serif, fontSize: 20, color: tan, marginBottom: 8, letterSpacing: 0 }}>SCOPE OF WORK</div>
          <p style={{ margin: 0, fontSize: 12, lineHeight: 1.7, color: pal.mid, whiteSpace: 'pre-wrap' }}>{view.scopeText.trim()}</p>
        </section>
      )}

      <div style={{ fontFamily: DOC_FONTS.serif, fontSize: 20, color: tan, marginBottom: 8, letterSpacing: 0 }}>COST BREAKDOWN</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${tan}` }}>
            <th style={{ ...thL, color: ink }}>Service</th>
            <th style={{ ...thR, color: ink, width: '14%' }}>Qty</th>
            <th style={{ ...thR, color: ink, width: '20%' }}>Price</th>
            <th style={{ ...thR, color: ink, width: '20%' }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {view.lineItems.map((it, i) => (
            <tr key={i} style={{ borderBottom: `1px solid ${pal.rule}` }}>
              <td style={{ ...tdL, color: ink }}>{it.description}</td>
              <td style={{ ...tdR, color: ink }}>{qtyLabel(it)}</td>
              <td style={{ ...tdR, color: ink }}>{money(it.rate, { cents: true })}</td>
              <td style={{ ...tdR, color: ink, fontWeight: 600 }}>{money(it.amount, { cents: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 24, marginTop: 18 }}>
        <span style={{ fontFamily: DOC_FONTS.serif, fontSize: 20, color: tan, letterSpacing: 0 }}>TOTAL</span>
        <span style={{ fontFamily: DOC_FONTS.serif, fontSize: 20, color: ink, fontVariantNumeric: 'tabular-nums' }}>{money(view.total, { cents: true })}</span>
      </div>

      <SupportingSections view={view} accent={tan} mid={pal.mid} muted={pal.muted} rule={pal.rule} />
    </Page>
  )
}

/* ─── small shared bits ─── */
function MetaCell({ label, value }: any) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', opacity: 0.85 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  )
}
function MintMeta({ label, value, green }: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: green }}>{label}</span>
      <span style={{ fontSize: 12, color: '#141414', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}
function EditMeta({ label, value, tan }: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12, color: tan }}>{label}</span>
      <span style={{ fontSize: 12, color: '#141414', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}
function EditCol({ lines, tan }: any) {
  const arr = (lines || []).filter(Boolean)
  return (
    <div style={{ minWidth: 0, paddingRight: 12 }}>
      {arr.map((l: string, i: number) => (
        <div key={i} style={{ fontSize: 12, lineHeight: 1.5, color: i === 0 ? '#141414' : '#5C5C5C', fontWeight: i === 0 ? 700 : 400, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>{l}</div>
      ))}
    </div>
  )
}
function PartyCol({ label, name, lines }: any) {
  return (
    <div>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: '#141414', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, color: '#141414', lineHeight: 1.55, minWidth: 0, overflowWrap: 'anywhere', wordBreak: 'break-word' }}>
        <div style={{ fontWeight: 700, color: '#141414' }}>{name || '\u2003'}</div>
        {lines.map((l: string, i: number) => <div key={i}>{l}</div>)}
      </div>
    </div>
  )
}
function ProjectHeading({ title, color }: any) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: '#5C5C5C', marginBottom: 4 }}>Project</div>
      <div style={{ fontSize: 20, fontWeight: 600, color }}>{title}</div>
    </div>
  )
}
function addressLines(party: any): string[] {
  if (!party) return []
  const out: string[] = []
  if (party.address) out.push(party.address)
  const contact = [party.phone, party.email].filter(Boolean).join(' · ')
  if (contact) out.push(contact)
  if (party.website) out.push(party.website)
  return out
}
function qtyLabel(it: ProposalLineItem) {
  const q = Number(it.qty || 0)
  if (!q) return ''
  return `${q}${it.unit ? ` ${it.unit}` : ''}`
}

const thL: any = { textAlign: 'left', padding: '12px 8px 12px 0', fontSize: 12, fontWeight: 700, letterSpacing: 0 }
const thR: any = { textAlign: 'right', padding: '12px 0 12px 8px', fontSize: 12, fontWeight: 700, letterSpacing: 0 }
const tdL: any = { textAlign: 'left', padding: '12px 8px 12px 0', verticalAlign: 'top', color: '#141414', lineHeight: 1.45 }
const tdR: any = { textAlign: 'right', padding: '12px 0 12px 8px', verticalAlign: 'top', color: '#141414', fontVariantNumeric: 'tabular-nums' }

export { fmtLongDate }


/* ============================================================
   FIELDHORSE, the customer portal (spec 9.9, render g-portal).
   Cover photo fading into onyx, or onyx alone. Monogram, company
   name, trust line and a call button. The headline, a total tray,
   what is included, optional additions as read only rows, three
   numbered steps and a bottom onyx capsule: the approve bar while
   the quote is open, "Approved" and a Pay deposit button after.
   ============================================================ */

// The in app preview (Quote tab) has no payload; rebuild the little the
// view model reads from the shared view, so one code path draws both.
function payloadFromView(view: ProposalView): PublicDocPayload {
  const lines = (view.lineItems || []).map((it, i) => ({ ...it, sort_order: i }))
  const extras = (view.upgrades || []).flatMap((group) =>
    (group.items || []).map((it) => ({ ...it, section: group.title, is_optional: true, sort_order: lines.length }))
  )
  return {
    kind: 'proposal',
    contact: { ...(view.recipient || {}), proposal_status: view.status ?? null },
    company: view.company || {},
    items: [...lines, ...extras],
    photos: view.photos || [],
    changeOrders: view.changeOrders || []
  }
}

const INSURANCE_FIELDS: Array<[string, string, boolean]> = [
  ['claim_number', 'Claim number', false],
  ['carrier', 'Carrier', false],
  ['adjuster', 'Adjuster', false],
  ['deductible', 'Deductible', true],
  ['rcv', 'RCV', true],
  ['acv', 'ACV', true],
  ['depreciation', 'Depreciation', true],
  ['supplement_amount', 'Supplement', true],
  ['mortgage_company', 'Mortgage company', false]
]

function DetailPhoto({ url, caption }: { url: string; caption?: string | null }) {
  const [failed, setFailed] = useState(false)
  if (failed) return null
  return (
    <div className="fhp-photos__item">
      <img src={url} alt={caption || 'Project photo'} loading="lazy" onError={() => setFailed(true)} />
    </div>
  )
}

// Everything the letter paper themes print that the portal's main column
// leaves out, so a customer can still read the terms they are agreeing to.
function FullDetails({ id, view }: { id: string; view: ProposalView }) {
  const scope = (view.scopeText || '').trim()
  const warranty = (view.warrantyText || '').trim()
  const exclusions = view.exclusions || []
  const orders = (view.changeOrders || []).filter((co: any) => co?.status && co.status !== 'void')
  const insurance = view.insurance || null
  const facts = insurance
    ? INSURANCE_FIELDS
        .filter(([key]) => insurance[key] != null && insurance[key] !== '')
        .map(([key, label, isMoney]) => ({ label, value: isMoney ? money(insurance[key], { cents: true }) : String(insurance[key]) }))
    : []
  const morePhotos = (view.photos || []).slice(1, 7).filter((p: any) => p?.url)
  return (
    <div className="fhp-details" id={id}>
      {scope && (
        <section>
          <h3 className="fhp-details__title">Scope of work</h3>
          <p style={{ whiteSpace: 'pre-wrap' }}>{scope}</p>
        </section>
      )}
      <section>
        <h3 className="fhp-details__title">Payment terms</h3>
        <p>{view.paymentTerms}</p>
      </section>
      {warranty && (
        <section>
          <h3 className="fhp-details__title">Warranty</h3>
          <p>{warranty}</p>
        </section>
      )}
      {exclusions.length > 0 && (
        <section>
          <h3 className="fhp-details__title">Not included</h3>
          <ul>
            {exclusions.map((x, i) => <li key={i}>{x}</li>)}
          </ul>
        </section>
      )}
      {orders.length > 0 && (
        <section>
          <h3 className="fhp-details__title">Change orders</h3>
          <ul className="fhp-details__rows">
            {orders.map((co: any, i: number) => (
              <li key={co.id || i}>
                <span>
                  {co.sequence_number != null ? `Change order ${co.sequence_number}` : 'Change order'}{co.title ? `, ${co.title}` : ''}{' '}
                  <Chip label={String(co.status).toLowerCase() === 'approved' ? 'Approved' : 'Waiting on approval'} tone={String(co.status).toLowerCase() === 'approved' ? 'success' : 'neutral'} />
                </span>
                <span>{formatMoney(Number(co.amount) || 0)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {facts.length > 0 && (
        <section>
          <h3 className="fhp-details__title">Insurance claim</h3>
          <dl className="fhp-facts">
            {facts.map((f) => (
              <div key={f.label}><dt>{f.label}</dt><dd>{f.value}</dd></div>
            ))}
          </dl>
        </section>
      )}
      {morePhotos.length > 0 && (
        <section>
          <h3 className="fhp-details__title">Project photos</h3>
          <div className="fhp-photos">
            {morePhotos.map((p: any, i: number) => <DetailPhoto key={`${p.url}-${i}`} url={p.url} caption={p.caption} />)}
          </div>
        </section>
      )}
    </div>
  )
}

// After approval: the word Approved, who and when only if the payload has
// it (D12), and "Pay deposit" when the company set a payment link (D7).
function ApprovedCapsule({ pv }: { pv: PortalView }) {
  const { name, date } = pv.approved || { name: null, date: null }
  const stamp = name && date ? `Approved by ${name} on ${date}.`
    : name ? `Approved by ${name}.`
    : date ? `Approved on ${date}.`
    : 'Thank you.'
  return (
    <div className="fhp-dock">
      <section className="fhp-capsule fh-onyx-scope fh-grain" aria-label="Approval">
        <Chip label="Approved" tone="success" dot />
        <h2 className="fhp-capsule__title">{stamp}</h2>
        <p className="fhp-capsule__text">
          {pv.companyName} has your approval and will be in touch with next steps.
        </p>
        {pv.payUrl && (
          <div className="fhp-actions">
            <Button variant="primary" size="lg" block href={pv.payUrl} target="_blank" rel="noopener noreferrer">
              {pv.deposit.amount > 0 ? `Pay deposit ${formatMoney(pv.deposit.amount)}` : 'Pay deposit'}
            </Button>
          </div>
        )}
      </section>
    </div>
  )
}

function ChangesRequestedCapsule({ pv, note, requestedAt }: { pv: PortalView; note?: string | null; requestedAt?: string | null }) {
  const received = longDate(requestedAt)
  return (
    <div className="fhp-dock">
      <section className="fhp-capsule fh-onyx-scope fh-grain" aria-label="Changes requested">
        <Chip label="Changes requested" tone="info" dot />
        <h2 className="fhp-capsule__title">Waiting on a revised proposal.</h2>
        <p className="fhp-capsule__text">
          {pv.companyName} has your feedback and will send a revised proposal before approval.
          {received ? ` Request received ${received}.` : ''}
        </p>
        {note ? <p className="fhp-capsule__quote">{note}</p> : null}
      </section>
    </div>
  )
}

export function FieldhorseProposal({ view }: { view: ProposalView }) {
  const portal = view.portal
  const payload = portal?.payload ?? payloadFromView(view)
  const pv = buildPortalView(payload, new Date())
  const status = String(payload.contact?.proposal_status || '').toLowerCase()
  const [failedCover, setFailedCover] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const detailsId = useId()
  const includedId = useId()
  const optionalId = useId()
  const stepsId = useId()

  // A cover that fails to load leaves onyx alone, never a broken image.
  const cover = pv.coverUrl && pv.coverUrl !== failedCover ? pv.coverUrl : null
  const callDigits = String(payload.company?.phone || '').replace(/[^\d+]/g, '')
  const sentence = depositSentence(pv.deposit)

  let capsule: ReactNode = null
  if (pv.approved) capsule = <ApprovedCapsule pv={pv} />
  else if (status === 'changes_requested') {
    capsule = (
      <ChangesRequestedCapsule
        pv={pv}
        note={payload.contact?.quote_change_request_note}
        requestedAt={payload.contact?.quote_change_requested_at}
      />
    )
  } else if (portal?.approveBar) capsule = portal.approveBar

  return (
    <article className="fhp" aria-label={`Quote from ${pv.companyName}`}>
      <OnyxStage as="header" glow className={cx('fhp-head', cover && 'fhp-head--photo')}>
        {cover && (
          <div className="fhp-cover">
            <img src={cover} alt="" onError={() => setFailedCover(cover)} />
          </div>
        )}
        <div className="fhp-col fhp-head__inner">
          <div className="fhp-brand">
            <Monogram name={pv.companyName} logoUrl={pv.logoUrl} size={40} />
            <div className="fhp-brand__text">
              <p className="fhp-brand__name">{pv.companyName}</p>
              {pv.trustLine && <p className="fhp-brand__trust">{pv.trustLine}</p>}
            </div>
            {callDigits && (
              <a
                className="fhc-iconbtn fhc-iconbtn--onyx fhc-iconbtn--round fhc-iconbtn--44 fhp-call"
                href={`tel:${callDigits}`}
                aria-label={`Call ${pv.companyName}`}
              >
                <Icon icon={Phone} size={22} />
              </a>
            )}
          </div>
          <h1 className="fhp-headline">{pv.headline}</h1>
          {pv.addressLine && <p className="fhp-address">{pv.addressLine}</p>}
        </div>
      </OnyxStage>

      <div className="fhp-col fhp-body">
        <section className="fhp-total" aria-label="Total">
          <p className="fhp-total__label">Total</p>
          <p className="fhp-total__amount">{formatMoney(pv.total)}</p>
          {sentence && <p className="fhp-total__note">{sentence}</p>}
        </section>

        {pv.included.length > 0 && (
          <section className="fhp-section" aria-labelledby={includedId}>
            <div className="fhp-section__head">
              <h2 className="fhp-section__title" id={includedId}>What's included</h2>
              <Button
                variant="quiet"
                size="mini"
                aria-expanded={detailsOpen}
                aria-controls={detailsId}
                onClick={() => setDetailsOpen((open) => !open)}
              >
                {detailsOpen ? 'Hide details' : 'Full details'}
              </Button>
            </div>
            <ul className="fhp-lines">
              {pv.included.map((line, i) => (
                <Row key={i} as="li" title={line.title} money={line.amount} />
              ))}
            </ul>
            {detailsOpen && <FullDetails id={detailsId} view={view} />}
          </section>
        )}
        {pv.included.length === 0 && (
          <section className="fhp-section">
            <div className="fhp-section__head">
              <h2 className="fhp-section__title">Full details</h2>
              <Button
                variant="quiet"
                size="mini"
                aria-expanded={detailsOpen}
                aria-controls={detailsId}
                onClick={() => setDetailsOpen((open) => !open)}
              >
                {detailsOpen ? 'Hide details' : 'Full details'}
              </Button>
            </div>
            {detailsOpen && <FullDetails id={detailsId} view={view} />}
          </section>
        )}

        {pv.optional.length > 0 && (
          <section className="fhp-section" aria-labelledby={optionalId}>
            <div className="fhp-section__head">
              <h2 className="fhp-section__title" id={optionalId}>Optional additions</h2>
            </div>
            <p className="fhp-note">Priced separately and not in your total.</p>
            <ul className="fhp-lines">
              {pv.optional.map((line, i) => (
                <Row
                  key={i}
                  as="li"
                  title={line.title}
                  money={`+${formatMoney(line.amount)}`}
                  next={portal?.onAsk ? (
                    <Button
                      variant="quiet"
                      size="mini"
                      className="fhp-ask"
                      aria-label={`Ask about this, ${line.title}`}
                      onClick={() => portal.onAsk?.(line.title)}
                    >
                      Ask about this
                    </Button>
                  ) : undefined}
                />
              ))}
            </ul>
          </section>
        )}

        <section className="fhp-section" aria-labelledby={stepsId}>
          <div className="fhp-section__head">
            <h2 className="fhp-section__title" id={stepsId}>What happens next</h2>
          </div>
          <ol className="fhp-steps" role="list" aria-labelledby={stepsId}>
            {pv.steps.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </section>
      </div>

      {capsule}

      <footer className="fhp-foot">
        <p>Powered by Fieldhorse</p>
      </footer>
    </article>
  )
}
