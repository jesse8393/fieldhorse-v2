// mobile/lib/invoiceHtml.ts
//
// Branded invoice PDF/preview HTML. Uses the same accent palette as the
// contractor's chosen estimate template (profiles.estimate_template) so
// the invoice feels like part of the same brand family. Rendered via
// react-native-webview (preview) and expo-print (PDF / share / email).

import type { ProposalCompany } from './proposalHtml'

export type InvoicePayment = { method?: string | null; amount?: number | null; paidOn?: string | null; reference?: string | null }
export type InvoiceData = {
  number?: string
  issuedAt?: Date | string | null
  jobTitle?: string | null
  total: number
  paid: number
  balance: number
  payments: InvoicePayment[]
}
export type InvoiceContact = { name?: string | null; address?: string | null; phone?: string | null; email?: string | null }

const ACCENTS: Record<string, string> = {
  classic: '#C9963A', slate: '#5C5C5C', mint: '#5C5C5C', editorial: '#C9963A'
}

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function money(n: unknown): string {
  return Number(n || 0).toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtDate(d?: Date | string | null): string {
  if (!d) return new Date().toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
}
function field(c: ProposalCompany, a: keyof ProposalCompany, b: keyof ProposalCompany): string {
  return String((c[a] ?? c[b] ?? '') || '')
}
function lines(p: { address?: string | null; phone?: string | null; email?: string | null; website?: string | null }): string[] {
  const out: string[] = []
  if (p.address) out.push(String(p.address))
  const c = [p.phone, p.email].filter(Boolean).join(' · ')
  if (c) out.push(c)
  if (p.website) out.push(String(p.website))
  return out
}
function logoHtml(url: string | null, name: string, accent: string): string {
  if (url) return `<img src="${esc(url)}" alt="logo" style="max-height:64px;max-width:200px;object-fit:contain;display:block;" />`
  const mono = (name || 'MC').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'MC'
  return `<div style="width:60px;height:60px;border-radius: 10px;background:${accent};color:#F2EDE4;display:flex;align-items:center;justify-content:center;font-size: 20px;font-weight:700;">${esc(mono)}</div>`
}

export function buildInvoiceHtml(company: ProposalCompany, contact: InvoiceContact, data: InvoiceData): string {
  const template = String(company.estimate_template || 'classic').toLowerCase()
  const accent = ACCENTS[template] || ACCENTS.classic
  const companyName = field(company, 'name', 'company_name') || 'My Company'
  const companyLines = lines({
    address: field(company, 'address', 'company_address'),
    phone: field(company, 'phone', 'company_phone'),
    email: field(company, 'email', 'company_email'),
    website: field(company, 'website', 'company_website')
  })
  const recipientLines = lines(contact)
  const payRows = (data.payments || []).map((p) => `
    <tr style="border-bottom:1px solid #F2EDE4;">
      <td style="padding:12px 8px 12px 0;color:#141414;text-transform:capitalize;">${esc(p.method || 'Payment')}${p.reference ? ` · ${esc(p.reference)}` : ''}</td>
      <td style="padding:12px 0;text-align:right;color:#5C5C5C;white-space:nowrap;">${esc(fmtDate(p.paidOn))}</td>
      <td style="padding:12px 0 12px 8px;text-align:right;color:#2D7A4F;font-weight:600;white-space:nowrap;">${money(p.amount)}</td>
    </tr>`).join('')

  const inner = `
    <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:16px;">
      <div style="min-width:0;">
        ${logoHtml(company.logo_url || null, companyName, accent)}
        <div style="font-size: 16px;font-weight:700;color:#141414;margin-top:10px;">${esc(companyName)}</div>
        ${companyLines.map((l) => `<div style="font-size: 12px;color:#5C5C5C;line-height:1.5;overflow-wrap:anywhere;">${esc(l)}</div>`).join('')}
      </div>
      <div style="text-align:right;">
        <div style="font-size: 24px;font-weight:800;letter-spacing: 0;color:${accent};">INVOICE</div>
        <div style="font-size: 12px;color:#5C5C5C;margin-top:6px;">#${esc(data.number || '\u2003')}</div>
        <div style="font-size: 12px;color:#5C5C5C;">${esc(fmtDate(data.issuedAt))}</div>
      </div>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:26px 0;">
      <div style="min-width:0;">
        <div style="font-size: 12px;font-weight:700;letter-spacing: 0;text-transform:uppercase;color:${accent};margin-bottom:6px;">Bill To</div>
        <div style="font-size: 14px;font-weight:700;color:#141414;">${esc(contact.name || '\u2003')}</div>
        ${recipientLines.map((l) => `<div style="font-size: 12px;color:#5C5C5C;line-height:1.5;overflow-wrap:anywhere;">${esc(l)}</div>`).join('')}
      </div>
      <div style="text-align:right;">
        <div style="font-size: 12px;font-weight:700;letter-spacing: 0;text-transform:uppercase;color:${accent};margin-bottom:6px;">Balance Due</div>
        <div style="font-size: 24px;font-weight:800;color:#141414;">${money(data.balance)}</div>
      </div>
    </div>

    ${data.jobTitle ? `<div style="font-size: 14px;color:#141414;margin-bottom:14px;"><span style="color:#5C5C5C;">Project: </span>${esc(data.jobTitle)}</div>` : ''}

    <table style="width:100%;border-collapse:collapse;font-size: 14px;">
      <thead><tr style="background:${accent};color:#F2EDE4;">
        <th style="text-align:left;padding:12px 12px;font-weight:700;">Description</th>
        <th style="text-align:right;padding:12px 12px;font-weight:700;width:30%;">Amount</th>
      </tr></thead>
      <tbody>
        <tr style="border-bottom:1px solid #F2EDE4;"><td style="padding:12px;color:#141414;">${esc(data.jobTitle || 'Contract amount')}</td><td style="padding:12px;text-align:right;color:#141414;font-weight:600;">${money(data.total)}</td></tr>
      </tbody>
    </table>

    <div style="display:flex;justify-content:flex-end;margin-top:16px;">
      <div style="min-width:300px;">
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size: 14px;"><span style="color:#5C5C5C;">Contract total</span><span>${money(data.total)}</span></div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;font-size: 14px;"><span style="color:#5C5C5C;">Paid to date</span><span style="color:#2D7A4F;">−${money(data.paid)}</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;padding-top:12px;border-top:2px solid ${accent};">
          <span style="font-size: 14px;font-weight:700;color:#141414;">Balance due</span>
          <span style="font-size: 16px;font-weight:800;color:#141414;">${money(data.balance)}</span>
        </div>
      </div>
    </div>

    ${payRows ? `
      <div style="margin-top:30px;">
        <div style="font-size: 12px;font-weight:700;letter-spacing: 0;text-transform:uppercase;color:${accent};margin-bottom:8px;">Payment history</div>
        <table style="width:100%;border-collapse:collapse;font-size: 14px;"><tbody>${payRows}</tbody></table>
      </div>` : ''}

    <div style="margin-top:36px;font-size: 12px;line-height:1.5;color:#C9963A;">Thank you for your business. Please remit the balance due by the date noted above. Past due balances may accrue at 1.5% per month. Pricing covers labor, material, standard equipment, placement, finishing, and cleanup for the scope as billed.</div>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8" /><meta name="viewport" content="width=816, initial-scale=1" />
  <style>
    @page { size: Letter; margin: 0; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    html,body { margin:0; padding:0; background:#F2EDE4; }
    body { font-family: -apple-system, 'Helvetica Neue', Arial, sans-serif; color:#141414; }
    .page { width:816px; max-width:100%; margin:0 auto; padding:48px 48px 48px; }
    table { table-layout: fixed; } td, th { word-break: break-word; overflow-wrap:anywhere; }
  </style></head><body><div class="page">${inner}</div></body></html>`
}
