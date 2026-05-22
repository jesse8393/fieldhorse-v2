// src/components/documents/proposalThemes.tsx
//
// Selectable customer-facing estimate designs. Each theme is a complete
// letter-paper render of the same normalized `view` produced by
// ProposalTemplate, so the contractor can pick the look that fits their
// brand (Settings → Estimate template) and every surface — in-app
// preview and the public /p/:token page — renders it identically.
//
// Themes here all share three principles that distinguish them from the
// legacy 'classic' layout:
//   1. Individual line items (one row per service: Qty · Unit Price · Amount)
//   2. The contractor's own uploaded logo, top of document
//   3. A distinct visual identity (header treatment, table, totals)
//
// The distinctive part of each theme is its header + parties + line-item
// table + totals. Supporting sections (scope prose, payment terms,
// exclusions, photos, insurance, change orders, signature) are rendered
// by the shared <SupportingSections> block so the themes stay focused
// and feature-complete without duplicating that machinery three times.

import { DOC_FONTS } from './tokens.ts'
import { money } from './format.ts'
import InsuranceModeBlock from './InsuranceModeBlock.tsx'
import ChangeOrdersBlock from './ChangeOrdersBlock.tsx'

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
}

const PAGE_W = 816
const PAGE_MIN_H = 1056
const PAD = 56

/* ─── Page wrapper ─── */
function Page({ background = '#FFFFFF', color = '#1A1814', children }: any) {
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
        boxShadow: '0 1px 0 rgba(0,0,0,0.04), 0 24px 48px -24px rgba(0,0,0,0.25)',
        borderRadius: 4,
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
      <img
        src={company.logo_url}
        alt={`${company?.name || 'Company'} logo`}
        style={{ maxHeight, maxWidth: 220, objectFit: 'contain', display: 'block', margin: align === 'right' ? '0 0 0 auto' : 0 }}
      />
    )
  }
  return (
    <div style={{
      width: maxHeight, height: maxHeight, borderRadius: 6,
      background: '#1A1814', color: '#fff', display: 'grid', placeItems: 'center',
      fontFamily: DOC_FONTS.display, fontSize: maxHeight * 0.36, fontWeight: 600,
      letterSpacing: '0.06em', marginLeft: align === 'right' ? 'auto' : 0
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
function SupportingSections({ view, accent, muted = '#6B6A66', mid = '#3A3833' }: any) {
  const { scopeText, paymentTerms, warrantyText, exclusions = [], photos = [], insurance, changeOrders = [], company, recipient, approval, upgrades = [] } = view
  const Label = ({ children }: any) => (
    <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: accent, marginBottom: 6 }}>
      {children}
    </div>
  )
  const showInsurance = insurance && (insurance.mode === 'insurance' || insurance.claimNumber || insurance.carrier)
  const visibleCOs = (changeOrders || []).filter((co: any) => co?.status && co.status !== 'void')
  const stamped = approval?.mode === 'approved'
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 22, marginTop: 30 }}>
      {scopeText && scopeText.trim() && (
        <section>
          <Label>Scope of Work</Label>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.6, color: mid, whiteSpace: 'pre-wrap' }}>{scopeText.trim()}</p>
        </section>
      )}

      {photos.length > 0 && (
        <section>
          <Label>Project photos</Label>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 8 }}>
            {photos.slice(0, 6).map((p: any, i: number) => p?.url && (
              <div key={i} style={{ width: '100%', aspectRatio: '4 / 3', background: '#e8e2d4', borderRadius: 4, overflow: 'hidden' }}>
                <img src={p.url} alt={p.caption || 'Project photo'} loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
              </div>
            ))}
          </div>
        </section>
      )}

      {upgrades.length > 0 && (
        <section>
          <Label>Optional upgrades</Label>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <tbody>
              {upgrades.flatMap((g: any) => g.items).map((it: any, i: number) => (
                <tr key={i} style={{ borderBottom: '1px solid #ECECEC' }}>
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
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: mid }}>
          {paymentTerms || '50% deposit due upon approval · 40% due at material delivery or midpoint · 10% due upon substantial completion.'}
        </p>
      </section>

      {warrantyText && warrantyText.trim() && (
        <section>
          <Label>Warranty</Label>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: mid }}>{warrantyText.trim()}</p>
        </section>
      )}

      {exclusions.length > 0 && (
        <section>
          <Label>Exclusions</Label>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: mid }}>{exclusions.join(' · ')}</p>
        </section>
      )}

      <section style={{ marginTop: 8 }}>
        <Label>Approval</Label>
        <p style={{ margin: '0 0 22px', fontSize: 12, lineHeight: 1.5, color: mid, maxWidth: '62ch' }}>
          By signing below, the customer authorizes the company to perform the work outlined in this estimate and agrees to the terms and conditions contained herein.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 28 }}>
          <SignatureLine label="Client signature" name={approval?.clientName || recipient?.name} dataUrl={stamped ? approval?.clientSignatureDataUrl : null} date={stamped ? approval?.clientApprovedAt : ''} muted={muted} />
          <SignatureLine label="Contractor signature" name={company?.name} dataUrl={null} date="" muted={muted} />
        </div>
      </section>
    </div>
  )
}

function SignatureLine({ label, name, dataUrl, date, muted }: any) {
  return (
    <div>
      <div style={{ height: 52, display: 'flex', alignItems: 'flex-end', borderBottom: '1px solid #1A1814', paddingBottom: 4 }}>
        {dataUrl
          ? <img src={dataUrl} alt="Signature" style={{ maxHeight: 46, maxWidth: '100%' }} />
          : name ? <span style={{ fontFamily: "'Caveat', 'Snell Roundhand', cursive", fontSize: 22, color: muted }}>{name}</span> : null}
      </div>
      <div style={{ marginTop: 6, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: muted, letterSpacing: '0.06em' }}>
        <span style={{ fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase' }}>{label}</span>
        <span>Date{date ? `: ${fmtDate(date)}` : ''}</span>
      </div>
    </div>
  )
}

function TotalsRows({ view, accentText = '#1A1814', boxed }: any) {
  const showTax = Number(view.taxRate || 0) > 0
  const showDiscount = Number(view.discount || 0) > 0
  return (
    <>
      <Totline label="Subtotal" value={money(view.subtotal, { cents: true })} />
      {showDiscount && <Totline label="Discount" value={`−${money(view.discount, { cents: true })}`} />}
      {showTax && <Totline label={`Tax (${(Number(view.taxRate) * 100).toFixed(0)}%)`} value={money(view.tax, { cents: true })} />}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
        marginTop: 8, paddingTop: 10, borderTop: '1px solid rgba(0,0,0,0.12)',
        ...(boxed ? { background: boxed, padding: '10px 12px', borderTop: 'none', borderRadius: 3 } : {})
      }}>
        <span style={{ fontSize: 15, fontWeight: 700, color: accentText }}>Total</span>
        <span style={{ fontSize: 16, fontWeight: 700, color: accentText, fontVariantNumeric: 'tabular-nums' }}>{money(view.total, { cents: true })}</span>
      </div>
    </>
  )
}
function Totline({ label, value }: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0', fontSize: 13 }}>
      <span style={{ color: '#6B6A66' }}>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums', color: '#1A1814' }}>{value}</span>
    </div>
  )
}

/* ============================================================
   SLATE — gray header bar, FROM/FOR, detailed dark line-item table.
   ============================================================ */
export function SlateProposal({ view }: { view: ProposalView }) {
  const { company, recipient } = view
  const bar = '#3F4651'
  return (
    <Page>
      <div style={{ marginBottom: 28 }}>
        <LogoMark company={company} maxHeight={64} />
      </div>

      <div style={{ background: bar, color: '#fff', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '14px 20px', margin: `0 -${PAD - 0}px`, paddingLeft: PAD, paddingRight: PAD }}>
        <MetaCell label="Estimate No." value={view.number} />
        <MetaCell label="Issue Date" value={fmtDate(view.issuedAt) || '—'} />
        <MetaCell label="Valid Until" value={fmtDate(view.expiresAt) || '—'} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, padding: '20px 0 24px', borderBottom: '1px solid #E2E2E2' }}>
        <PartyCol label="From" name={company?.name} lines={addressLines(company)} />
        <PartyCol label="For" name={recipient?.name} lines={addressLines(recipient)} />
      </div>

      {view.projectTitle && <ProjectHeading title={view.projectTitle} color="#1A1814" />}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 18, fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid #1A1814' }}>
            <th style={thL}>Description</th>
            <th style={thR}>Quantity</th>
            <th style={thR}>Unit Price</th>
            <th style={thR}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {view.lineItems.map((it, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #ECECEC' }}>
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

      <SupportingSections view={view} accent={bar} />
    </Page>
  )
}

/* ============================================================
   MINT — large green ESTIMATE wordmark, green table + total row.
   ============================================================ */
export function MintProposal({ view }: { view: ProposalView }) {
  const { company, recipient } = view
  const green = '#4F7A63'
  const greenSoft = '#EAF1ED'
  return (
    <Page>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700, color: '#1A1814' }}>{company?.name || '—'}</div>
          {addressLines(company).map((l, i) => (
            <div key={i} style={{ fontSize: 12, color: '#6B6A66', lineHeight: 1.5 }}>{l}</div>
          ))}
        </div>
        <LogoMark company={company} maxHeight={70} align="right" />
      </div>

      <div style={{ textAlign: 'right', margin: '14px 0 26px' }}>
        <span style={{ fontFamily: DOC_FONTS.display, fontSize: 52, letterSpacing: '0.06em', color: green, fontWeight: 700 }}>ESTIMATE</span>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 26 }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: green, marginBottom: 4 }}>To</div>
          <div style={{ fontSize: 16, color: '#1A1814', marginBottom: 4 }}>{recipient?.name || '—'}</div>
          {addressLines(recipient).map((l, i) => (
            <div key={i} style={{ fontSize: 12, color: '#6B6A66', lineHeight: 1.5 }}>{l}</div>
          ))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <MintMeta label="Estimate #" value={view.number} green={green} />
          <MintMeta label="Estimate date" value={fmtDate(view.issuedAt) || '—'} green={green} />
          <MintMeta label="Valid until" value={fmtDate(view.expiresAt) || '—'} green={green} />
        </div>
      </div>

      {view.projectTitle && <ProjectHeading title={view.projectTitle} color={green} />}

      <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 14, fontSize: 13 }}>
        <thead>
          <tr style={{ background: green, color: '#fff' }}>
            <th style={{ ...thR, color: '#fff', padding: '10px 12px', width: '12%' }}>Qty</th>
            <th style={{ ...thL, color: '#fff', padding: '10px 12px' }}>Description</th>
            <th style={{ ...thR, color: '#fff', padding: '10px 12px', width: '20%' }}>Unit Price</th>
            <th style={{ ...thR, color: '#fff', padding: '10px 12px', width: '20%' }}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {view.lineItems.map((it, i) => (
            <tr key={i} style={{ borderBottom: '1px solid #ECECEC' }}>
              <td style={{ ...tdR, paddingLeft: 12 }}>{qtyLabel(it)}</td>
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

      <SupportingSections view={view} accent={green} />
    </Page>
  )
}

/* ============================================================
   EDITORIAL — sand/serif, Job Title + ESTIMATE wordmark, Cost Breakdown.
   ============================================================ */
export function EditorialProposal({ view }: { view: ProposalView }) {
  const { company, recipient } = view
  const sand = '#EDE6DA'
  const tan = '#9A7B4F'
  const ink = '#2B2620'
  return (
    <Page background={sand} color={ink}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          {view.projectTitle && (
            <div style={{ fontFamily: DOC_FONTS.serif, fontSize: 26, color: ink, marginBottom: 2 }}>{view.projectTitle}</div>
          )}
          <div style={{ fontFamily: DOC_FONTS.serif, fontSize: 64, lineHeight: 1, color: tan, letterSpacing: '0.04em' }}>ESTIMATE</div>
        </div>
        <LogoMark company={company} maxHeight={72} align="right" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 20, margin: '34px 0 28px' }}>
        <EditCol label="" lines={[company?.name, ...addressLines(company)]} tan={tan} />
        <EditCol label="" lines={[recipient?.name, ...addressLines(recipient)]} tan={tan} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <EditMeta label="Date" value={fmtDate(view.issuedAt) || '—'} tan={tan} />
          <EditMeta label="Estimate #" value={view.number} tan={tan} />
          <EditMeta label="Est. Total" value={money(view.total)} tan={tan} />
        </div>
      </div>

      {view.scopeText && view.scopeText.trim() && (
        <section style={{ marginBottom: 26 }}>
          <div style={{ fontFamily: DOC_FONTS.serif, fontSize: 18, color: tan, marginBottom: 8, letterSpacing: '0.04em' }}>SCOPE OF WORK</div>
          <p style={{ margin: 0, fontSize: 12.5, lineHeight: 1.7, color: '#4A443B', whiteSpace: 'pre-wrap' }}>{view.scopeText.trim()}</p>
        </section>
      )}

      <div style={{ fontFamily: DOC_FONTS.serif, fontSize: 18, color: tan, marginBottom: 8, letterSpacing: '0.04em' }}>COST BREAKDOWN</div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
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
            <tr key={i} style={{ borderBottom: '1px solid rgba(154,123,79,0.25)' }}>
              <td style={{ ...tdL, color: ink }}>{it.description}</td>
              <td style={{ ...tdR, color: ink }}>{qtyLabel(it)}</td>
              <td style={{ ...tdR, color: ink }}>{money(it.rate, { cents: true })}</td>
              <td style={{ ...tdR, color: ink, fontWeight: 600 }}>{money(it.amount, { cents: true })}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'baseline', gap: 24, marginTop: 18 }}>
        <span style={{ fontFamily: DOC_FONTS.serif, fontSize: 20, color: tan, letterSpacing: '0.06em' }}>TOTAL</span>
        <span style={{ fontFamily: DOC_FONTS.serif, fontSize: 22, color: ink, fontVariantNumeric: 'tabular-nums' }}>{money(view.total, { cents: true })}</span>
      </div>

      <SupportingSections view={view} accent={tan} mid="#4A443B" muted="#8A7A60" />
    </Page>
  )
}

/* ─── small shared bits ─── */
function MetaCell({ label, value }: any) {
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', opacity: 0.85 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>{value}</div>
    </div>
  )
}
function MintMeta({ label, value, green }: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12, fontWeight: 700, color: green }}>{label}</span>
      <span style={{ fontSize: 12, color: '#1A1814', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}
function EditMeta({ label, value, tan }: any) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
      <span style={{ fontSize: 12, color: tan }}>{label}</span>
      <span style={{ fontSize: 12, color: '#2B2620', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  )
}
function EditCol({ lines, tan }: any) {
  const arr = (lines || []).filter(Boolean)
  return (
    <div>
      {arr.map((l: string, i: number) => (
        <div key={i} style={{ fontSize: 12, lineHeight: 1.6, color: i === 0 ? '#2B2620' : '#6B6258', fontWeight: i === 0 ? 700 : 400 }}>{l}</div>
      ))}
    </div>
  )
}
function PartyCol({ label, name, lines }: any) {
  return (
    <div>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#1A1814', marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 13, color: '#3A3833', lineHeight: 1.55 }}>
        <div style={{ fontWeight: 700, color: '#1A1814' }}>{name || '—'}</div>
        {lines.map((l: string, i: number) => <div key={i}>{l}</div>)}
      </div>
    </div>
  )
}
function ProjectHeading({ title, color }: any) {
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#6B6A66', marginBottom: 4 }}>Project</div>
      <div style={{ fontSize: 22, fontWeight: 600, color }}>{title}</div>
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

const thL: any = { textAlign: 'left', padding: '10px 8px 10px 0', fontSize: 12, fontWeight: 700, letterSpacing: '0.02em' }
const thR: any = { textAlign: 'right', padding: '10px 0 10px 8px', fontSize: 12, fontWeight: 700, letterSpacing: '0.02em' }
const tdL: any = { textAlign: 'left', padding: '12px 8px 12px 0', verticalAlign: 'top', color: '#1A1814', lineHeight: 1.45 }
const tdR: any = { textAlign: 'right', padding: '12px 0 12px 8px', verticalAlign: 'top', color: '#1A1814', fontVariantNumeric: 'tabular-nums' }

export { fmtLongDate }
