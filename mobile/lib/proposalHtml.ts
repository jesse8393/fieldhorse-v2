// mobile/lib/proposalHtml.ts
//
// Builds a complete, self-contained HTML document for a customer facing
// estimate, in the design the contractor picked (profiles.estimate_template).
// The same string is rendered two ways on device:
//   • react-native-webview  → in-app preview
//   • expo-print            → PDF for share / email
//
// This mirrors the web app's templates (src/components/documents/
// proposalThemes.tsx) so the customer sees the same design whether it
// comes from the website or the phone. Pure string output, no React.

export type ProposalItemRow = {
  description?: string | null
  qty?: number | null
  unit?: string | null
  rate?: number | null
  amount?: number | null
  section?: string | null
  is_optional?: boolean | null
  is_excluded?: boolean | null
}

export type ProposalCompany = {
  name?: string | null
  company_name?: string | null
  address?: string | null
  company_address?: string | null
  phone?: string | null
  company_phone?: string | null
  email?: string | null
  company_email?: string | null
  website?: string | null
  company_website?: string | null
  logo_url?: string | null
  estimate_template?: string | null
  warranty_default?: string | null
}

export type ProposalContact = {
  name?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  job_title?: string | null
  scope_text?: string | null
  exclusions_text?: string | null
  terms_text?: string | null
}

const PAYMENT_TERMS = '50% deposit due upon approval · 40% due at material delivery or midpoint · 10% due upon substantial completion.'
const DISCLAIMER = 'Pricing includes labor, material, standard equipment, placement, finishing, and cleanup for the listed scope only. Pricing is based on visible site conditions at time of estimating. Any hidden conditions, field changes, requested by owner additions, or scope deviations may require additional pricing through written change order approval. Estimate valid for 30 days.'

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function money(n: unknown, cents = true): string {
  return Number(n || 0).toLocaleString('en-US', {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0
  })
}
function fmtDate(d?: Date | string | null): string {
  if (!d) return '\u2003'
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return '\u2003'
  return dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}
function itemAmount(it: ProposalItemRow): number {
  return Number(it.amount != null ? it.amount : Number(it.qty || 1) * Number(it.rate || 0))
}
function qtyLabel(it: ProposalItemRow): string {
  const q = Number(it.qty || 0)
  if (!q) return ''
  return `${q}${it.unit ? ` ${esc(it.unit)}` : ''}`
}
function companyField(c: ProposalCompany, a: keyof ProposalCompany, b: keyof ProposalCompany): string {
  return String((c[a] ?? c[b] ?? '') || '')
}
function addressLines(p: { address?: string | null; phone?: string | null; email?: string | null; website?: string | null }): string[] {
  const out: string[] = []
  if (p.address) out.push(String(p.address))
  const contact = [p.phone, p.email].filter(Boolean).join(' · ')
  if (contact) out.push(contact)
  if (p.website) out.push(String(p.website))
  return out
}

export type ProposalNormalized = {
  template: string
  companyName: string
  companyLines: string[]
  logoUrl: string | null
  recipientName: string
  recipientLines: string[]
  projectTitle: string
  scopeText: string
  warrantyText: string
  exclusions: string[]
  number: string
  issuedAt: string
  expiresAt: string
  baseItems: ProposalItemRow[]
  upgradeItems: ProposalItemRow[]
  subtotal: number
  total: number
}

export function normalizeProposal(
  company: ProposalCompany,
  contact: ProposalContact,
  items: ProposalItemRow[],
  opts: { number?: string; issuedAt?: Date | string | null; expiresAt?: Date | string | null } = {}
): ProposalNormalized {
  const base: ProposalItemRow[] = []
  const upgrades: ProposalItemRow[] = []
  const exclusions: string[] = []
  let subtotal = 0
  for (const it of items || []) {
    if (it.is_excluded) { exclusions.push(String(it.description || 'Excluded scope')); continue }
    if (it.is_optional) { upgrades.push(it); continue }
    subtotal += itemAmount(it)
    base.push(it)
  }
  for (const line of String(contact.exclusions_text || '').split(/\n+/).map((s) => s.trim()).filter(Boolean)) {
    exclusions.push(line)
  }
  const companyName = companyField(company, 'name', 'company_name') || 'My Company'
  const companyAddr = companyField(company, 'address', 'company_address')
  const companyPhone = companyField(company, 'phone', 'company_phone')
  const companyEmail = companyField(company, 'email', 'company_email')
  const companyWeb = companyField(company, 'website', 'company_website')
  return {
    template: String(company.estimate_template || 'classic').toLowerCase(),
    companyName,
    companyLines: addressLines({ address: companyAddr, phone: companyPhone, email: companyEmail, website: companyWeb }),
    logoUrl: company.logo_url || null,
    recipientName: String(contact.name || '\u2003'),
    recipientLines: addressLines(contact),
    projectTitle: String(contact.job_title || '').trim(),
    scopeText: String(contact.scope_text || '').trim(),
    warrantyText: String(contact.terms_text || company.warranty_default || '').trim(),
    exclusions,
    number: opts.number || 'EST',
    issuedAt: fmtDate(opts.issuedAt || new Date()),
    expiresAt: fmtDate(opts.expiresAt),
    baseItems: base,
    upgradeItems: upgrades,
    subtotal,
    total: subtotal
  }
}

function logoHtml(url: string | null, name: string, align: 'left' | 'right', monoColor: string): string {
  if (url) {
    return `<img src="${esc(url)}" alt="logo" style="max-height:70px;max-width:220px;object-fit:contain;display:block;${align === 'right' ? 'margin-left:auto;' : ''}" />`
  }
  const mono = (name || 'MC').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'MC'
  return `<div style="width:64px;height:64px;border-radius: 10px;background:${monoColor};color:#F2EDE4;display:flex;align-items:center;justify-content:center;font-size: 24px;font-weight:700;letter-spacing: 0;${align === 'right' ? 'margin-left:auto;' : ''}">${esc(mono)}</div>`
}

function itemsTable(items: ProposalItemRow[], opts: { headBg?: string; headColor?: string; headLine?: string; ink: string }): string {
  const { headBg, headColor = '#F2EDE4', headLine, ink } = opts
  const headStyle = headBg
    ? `background:${headBg};color:${headColor};`
    : `border-bottom:1px solid ${headLine || ink};color:${ink};`
  const thBase = `padding:12px 8px;font-size: 12px;font-weight:700;letter-spacing: 0;${headStyle}`
  const rows = items.map((it) => `
    <tr style="border-bottom:1px solid #F2EDE4;">
      <td style="padding:12px 8px 12px 0;color:${ink};line-height:1.4;vertical-align:top;">${esc(it.description || '\u2003')}</td>
      <td style="padding:12px 0 12px 8px;text-align:right;color:${ink};white-space:nowrap;">${qtyLabel(it)}</td>
      <td style="padding:12px 0 12px 8px;text-align:right;color:${ink};white-space:nowrap;">${money(it.rate)}</td>
      <td style="padding:12px 0 12px 8px;text-align:right;color:${ink};font-weight:600;white-space:nowrap;">${money(itemAmount(it))}</td>
    </tr>`).join('')
  return `
    <table style="width:100%;border-collapse:collapse;font-size: 14px;">
      <thead><tr>
        <th style="${thBase}text-align:left;">Description</th>
        <th style="${thBase}text-align:right;width:16%;">Qty</th>
        <th style="${thBase}text-align:right;width:20%;">Unit Price</th>
        <th style="${thBase}text-align:right;width:20%;">Amount</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>`
}

function supportingHtml(n: ProposalNormalized, accent: string, mid: string, muted: string): string {
  const label = (t: string) => `<div style="font-size: 12px;font-weight:700;letter-spacing: 0;text-transform:uppercase;color:${accent};margin-bottom:6px;">${t}</div>`
  const sections: string[] = []
  if (n.template !== 'editorial' && n.scopeText) {
    sections.push(`<section>${label('Scope of Work')}<p style="margin:0;font-size: 14px;line-height:1.6;color:${mid};white-space:pre-wrap;">${esc(n.scopeText)}</p></section>`)
  }
  if (n.upgradeItems.length) {
    const rows = n.upgradeItems.map((it) => `
      <tr style="border-bottom:1px solid #F2EDE4;">
        <td style="padding:8px 8px 8px 0;color:${mid};">${esc(it.description || '\u2003')}</td>
        <td style="padding:8px 0;text-align:right;color:${mid};">${qtyLabel(it)}</td>
        <td style="padding:8px 0;text-align:right;color:${mid};">${money(it.rate)}</td>
        <td style="padding:8px 0 8px 8px;text-align:right;color:${mid};font-weight:600;">${money(itemAmount(it))}</td>
      </tr>`).join('')
    sections.push(`<section>${label('Optional upgrades')}<table style="width:100%;border-collapse:collapse;font-size: 14px;"><tbody>${rows}</tbody></table></section>`)
  }
  sections.push(`<section>${label('Payment terms')}<p style="margin:0;font-size: 14px;line-height:1.55;color:${mid};">${PAYMENT_TERMS}</p></section>`)
  if (n.warrantyText) sections.push(`<section>${label('Warranty')}<p style="margin:0;font-size: 14px;line-height:1.55;color:${mid};">${esc(n.warrantyText)}</p></section>`)
  if (n.exclusions.length) sections.push(`<section>${label('Exclusions')}<p style="margin:0;font-size: 14px;line-height:1.55;color:${mid};">${n.exclusions.map(esc).join(' · ')}</p></section>`)
  sections.push(`
    <section>
      ${label('Approval')}
      <p style="margin:0 0 26px;font-size: 12px;line-height:1.5;color:${mid};max-width:62ch;">By signing below, the customer authorizes the company to perform the work outlined in this estimate and agrees to the terms and conditions contained herein.</p>
      <div style="display:flex;gap:24px;">
        ${signature('Client signature', n.recipientName, muted)}
        ${signature('Contractor signature', n.companyName, muted)}
      </div>
    </section>`)
  return `<div style="display:flex;flex-direction:column;gap:24px;margin-top:30px;">${sections.join('')}</div>`
}
function signature(labelText: string, _name: string, muted: string): string {
  return `<div style="flex:1;">
    <div style="height:48px;border-bottom:1px solid #141414;"></div>
    <div style="margin-top:6px;display:flex;justify-content:space-between;font-size: 12px;color:${muted};letter-spacing: 0;">
      <span style="font-weight:700;letter-spacing: 0;text-transform:uppercase;">${labelText}</span><span>Date</span>
    </div>
  </div>`
}
function disclaimerHtml(color: string): string {
  return `<div style="margin-top:36px;font-size: 12px;line-height:1.5;color:${color};">${DISCLAIMER}</div>`
}

function pageWrap(inner: string, bg: string, color: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8" />
  <meta name="viewport" content="width=816, initial-scale=1" />
  <style>
    @page { size: Letter; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html,body { margin:0; padding:0; background:${bg}; }
    body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color:${color}; }
    .serif { font-family: Georgia, 'Times New Roman', serif; }
    .page { width:816px; max-width:100%; margin:0 auto; background:${bg}; padding:48px 48px 48px; }
    table { table-layout: fixed; }
    td, th { word-break: break-word; overflow-wrap: anywhere; }
  </style></head><body><div class="page">${inner}</div></body></html>`
}

function renderSlate(n: ProposalNormalized): string {
  const bar = '#5C5C5C'
  const meta = (l: string, v: string) => `<div><div style="font-size: 12px;font-weight:700;letter-spacing: 0;text-transform:uppercase;opacity:.85;">${l}</div><div style="font-size: 14px;font-weight:600;margin-top:2px;">${esc(v)}</div></div>`
  const party = (l: string, name: string, lines: string[]) => `<div style="min-width:0;">
    <div style="font-size: 12px;font-weight:700;letter-spacing: 0;text-transform:uppercase;color:#141414;margin-bottom:6px;">${l}</div>
    <div style="font-size: 14px;color:#141414;line-height:1.55;"><div style="font-weight:700;color:#141414;">${esc(name)}</div>${lines.map((x) => `<div>${esc(x)}</div>`).join('')}</div></div>`
  const inner = `
    <div style="margin-bottom:24px;">${logoHtml(n.logoUrl, n.companyName, 'left', '#141414')}</div>
    <div style="background:${bar};color:#F2EDE4;display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;padding:12px 48px;margin:0 -56px;">
      ${meta('Estimate No.', n.number)}${meta('Issue Date', n.issuedAt)}${meta('Valid Until', n.expiresAt)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;padding:24px 0;border-bottom:1px solid #F2EDE4;">
      ${party('From', n.companyName, n.companyLines)}${party('For', n.recipientName, n.recipientLines)}
    </div>
    ${n.projectTitle ? `<div style="margin-top:22px;"><div style="font-size: 12px;font-weight:700;letter-spacing: 0;text-transform:uppercase;color:#5C5C5C;margin-bottom:4px;">Project</div><div style="font-size: 20px;font-weight:600;color:#141414;">${esc(n.projectTitle)}</div></div>` : ''}
    <div style="margin-top:18px;">${itemsTable(n.baseItems, { headBg: '#141414', ink: '#141414' })}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:16px;"><div style="min-width:300px;">${totalsHtml(n, '#141414')}</div></div>
    ${supportingHtml(n, bar, '#141414', '#5C5C5C')}
    ${disclaimerHtml('#C9963A')}`
  return pageWrap(inner, '#F2EDE4', '#141414')
}

function renderMint(n: ProposalNormalized): string {
  const green = '#5C5C5C'
  const meta = (l: string, v: string) => `<div style="display:flex;justify-content:space-between;gap:12px;"><span style="font-size: 12px;font-weight:700;color:${green};">${l}</span><span style="font-size: 12px;color:#141414;">${esc(v)}</span></div>`
  const inner = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:10px;">
      <div style="min-width:0;max-width:62%;">
        <div style="font-size: 20px;font-weight:700;color:#141414;">${esc(n.companyName)}</div>
        ${n.companyLines.map((l) => `<div style="font-size: 12px;color:#5C5C5C;line-height:1.5;">${esc(l)}</div>`).join('')}
      </div>
      ${logoHtml(n.logoUrl, n.companyName, 'right', green)}
    </div>
    <div style="text-align:right;margin:14px 0 26px;"><span class="serif" style="font-size: 24px;letter-spacing: 0;color:${green};font-weight:700;">ESTIMATE</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:26px;">
      <div style="min-width:0;">
        <div style="font-size: 12px;font-weight:700;color:${green};margin-bottom:4px;">To</div>
        <div style="font-size: 16px;color:#141414;margin-bottom:4px;">${esc(n.recipientName)}</div>
        ${n.recipientLines.map((l) => `<div style="font-size: 12px;color:#5C5C5C;line-height:1.5;">${esc(l)}</div>`).join('')}
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;">${meta('Estimate #', n.number)}${meta('Estimate date', n.issuedAt)}${meta('Valid until', n.expiresAt)}</div>
    </div>
    ${n.projectTitle ? `<div style="margin-bottom:8px;"><div style="font-size: 12px;font-weight:700;letter-spacing: 0;text-transform:uppercase;color:#5C5C5C;margin-bottom:4px;">Project</div><div style="font-size: 20px;font-weight:600;color:${green};">${esc(n.projectTitle)}</div></div>` : ''}
    ${itemsTable(n.baseItems, { headBg: green, ink: '#141414' })}
    <div style="display:flex;justify-content:flex-end;margin-top:16px;"><div style="min-width:300px;">${totalsHtml(n, green, '#F2EDE4')}</div></div>
    ${supportingHtml(n, green, '#141414', '#5C5C5C')}
    ${disclaimerHtml('#C9963A')}`
  return pageWrap(inner, '#F2EDE4', '#141414')
}

function renderEditorial(n: ProposalNormalized): string {
  const sand = '#F2EDE4', tan = '#C9963A', ink = '#141414'
  const col = (lines: string[]) => `<div style="min-width:0;padding-right:12px;">${lines.filter(Boolean).map((l, i) => `<div style="font-size: 12px;line-height:1.5;color:${i === 0 ? ink : '#5C5C5C'};font-weight:${i === 0 ? 700 : 400};overflow-wrap:anywhere;">${esc(l)}</div>`).join('')}</div>`
  const meta = (l: string, v: string) => `<div style="display:flex;justify-content:space-between;gap:12px;"><span style="font-size: 12px;color:${tan};">${l}</span><span style="font-size: 12px;color:${ink};">${esc(v)}</span></div>`
  const inner = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
      <div>
        ${n.projectTitle ? `<div class="serif" style="font-size: 24px;color:${ink};margin-bottom:2px;">${esc(n.projectTitle)}</div>` : ''}
        <div class="serif" style="font-size: 24px;line-height:1;color:${tan};letter-spacing: 0;">ESTIMATE</div>
      </div>
      ${logoHtml(n.logoUrl, n.companyName, 'right', tan)}
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:24px;margin:34px 0 28px;">
      ${col([n.companyName, ...n.companyLines])}
      ${col([n.recipientName, ...n.recipientLines])}
      <div style="display:flex;flex-direction:column;gap:12px;">${meta('Date', n.issuedAt)}${meta('Estimate #', n.number)}${meta('Est. Total', money(n.total, false))}</div>
    </div>
    ${n.scopeText ? `<section style="margin-bottom:26px;"><div class="serif" style="font-size: 20px;color:${tan};margin-bottom:8px;letter-spacing: 0;">SCOPE OF WORK</div><p style="margin:0;font-size: 12px;line-height:1.7;color:#5C5C5C;white-space:pre-wrap;">${esc(n.scopeText)}</p></section>` : ''}
    <div class="serif" style="font-size: 20px;color:${tan};margin-bottom:8px;letter-spacing: 0;">COST BREAKDOWN</div>
    ${itemsTable(n.baseItems, { headLine: tan, ink })}
    <div style="display:flex;justify-content:flex-end;align-items:baseline;gap:24px;margin-top:18px;">
      <span class="serif" style="font-size: 20px;color:${tan};letter-spacing: 0;">TOTAL</span>
      <span class="serif" style="font-size: 20px;color:${ink};">${money(n.total)}</span>
    </div>
    ${supportingHtml(n, tan, '#5C5C5C', '#5C5C5C')}
    ${disclaimerHtml('#5C5C5C')}`
  return pageWrap(inner, sand, ink)
}

function renderClassic(n: ProposalNormalized): string {
  const gold = '#C9963A', ink = '#141414'
  const party = (l: string, name: string, lines: string[]) => `<div style="min-width:0;">
    <div style="height:1px;background:#141414;opacity:.85;margin-bottom:12px;"></div>
    <div style="font-size: 12px;font-weight:700;letter-spacing: 0;text-transform:uppercase;color:#141414;margin-bottom:8px;">${l}</div>
    <div style="font-size: 14px;font-weight:700;color:#141414;">${esc(name)}</div>
    ${lines.map((x) => `<div style="font-size: 14px;color:#141414;line-height:1.5;">${esc(x)}</div>`).join('')}</div>`
  const inner = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:24px;">
      ${logoHtml(n.logoUrl, n.companyName, 'left', gold)}
      <div style="text-align:right;">
        <div style="font-size: 24px;font-weight:700;color:${ink};">ESTIMATE #${esc(n.number)}</div>
        <div style="height:1px;background:#141414;margin:12px 0;"></div>
        <div style="font-size: 12px;font-weight:700;letter-spacing: 0;text-transform:uppercase;">Sent on</div>
        <div style="font-size: 14px;">${n.issuedAt}</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:28px;">${party('Recipient', n.recipientName, n.recipientLines)}${party('Sender', n.companyName, n.companyLines)}</div>
    ${n.projectTitle ? `<div style="margin-top:24px;"><div style="font-size: 12px;font-weight:700;letter-spacing: 0;text-transform:uppercase;color:#5C5C5C;margin-bottom:4px;">Project</div><div class="serif" style="font-size: 24px;color:${ink};">${esc(n.projectTitle)}</div></div>` : ''}
    <div style="margin-top:18px;">${itemsTable(n.baseItems, { headBg: gold, ink })}</div>
    <div style="display:flex;justify-content:flex-end;margin-top:16px;"><div style="min-width:300px;">${totalsHtml(n, ink)}</div></div>
    ${supportingHtml(n, gold, '#141414', '#5C5C5C')}
    ${disclaimerHtml('#C9963A')}`
  return pageWrap(inner, '#F2EDE4', ink)
}

function totalsHtml(n: ProposalNormalized, accentText: string, boxed?: string): string {
  const showSub = Math.abs(n.subtotal - n.total) > 0.005
  const subRow = showSub
    ? `<div style="display:flex;justify-content:space-between;padding:4px 0;font-size: 14px;"><span style="color:#5C5C5C;">Subtotal</span><span>${money(n.subtotal)}</span></div>`
    : ''
  const totalRow = boxed
    ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;background:${boxed};padding:12px 12px;border-radius: 10px;"><span style="font-size: 14px;font-weight:700;color:${accentText};">Total</span><span style="font-size: 16px;font-weight:700;color:${accentText};">${money(n.total)}</span></div>`
    : `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:12px;border-top:1px solid rgba(20, 20, 20,.12);"><span style="font-size: 14px;font-weight:700;color:${accentText};">Total</span><span style="font-size: 16px;font-weight:700;color:${accentText};">${money(n.total)}</span></div>`
  return subRow + totalRow
}

export function buildProposalHtml(
  company: ProposalCompany,
  contact: ProposalContact,
  items: ProposalItemRow[],
  opts: { number?: string; issuedAt?: Date | string | null; expiresAt?: Date | string | null } = {}
): string {
  const n = normalizeProposal(company, contact, items, opts)
  switch (n.template) {
    case 'slate': return renderSlate(n)
    case 'mint': return renderMint(n)
    case 'editorial': return renderEditorial(n)
    default: return renderClassic(n)
  }
}
