// src/screens/PublicDoc.tsx
//
// Public client-facing document page at /p/:token. Resolves the
// token via the /api/public-link Netlify function (on the server,
// service-role) and renders the same ProposalTemplate or
// InvoiceTemplate the contractor sees in-app.
//
// White-label: every byte the customer sees belongs to the
// contractor. The page chrome is a neutral cream backdrop framing
// the letter-paper template, no FieldHorse name, logo, or
// navigation surfaces appear. The browser tab title is set to the
// contractor's company name + the project so the link looks like
// it came from them.
//
// Auth: this route renders OUTSIDE the AppShell (no Gated wrapper).
// Anyone with the token can view; the on the server function gates
// expiry / revocation / not-found.

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ProposalTemplate,
  InvoiceTemplate,
  mapItemsToScope,
  resolveBrandGold
} from '../components/documents'
import ApproveProposalBar from '../components/public/ApproveProposalBar.tsx'
import { safePayUrl } from '../lib/payLink.ts'
import { gatherStatement } from '../lib/statement.ts'

export default function PublicDoc() {
  const { token } = useParams()
  const [state, setState] = useState<any>({ loading: true, data: null, error: null })

  const load = useCallback(async () => {
    if (!token) return
    try {
      const res = await fetch(`/api/public-link?token=${encodeURIComponent(token)}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) {
        setState({ loading: false, data: null, error: body?.message || 'This link is no longer available.' })
        return
      }
      setState({ loading: false, data: body, error: null })
      // Brand the browser tab as the contractor's, not ours.
      const co = body.company?.name || 'Document'
      const proj = body.contact?.job_title || body.contact?.name || ''
      document.title = `${co}${proj ? `, ${proj}` : ''}`
    } catch (e: any) {
      setState({ loading: false, data: null, error: 'Could not load this document. Check the link and try again.' })
    }
  }, [token])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await load()
    })()
    return () => { cancelled = true }
  }, [load])

  const { loading, data, error } = state

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#F2EDE4',
        padding: 'calc(24px + env(safe-area-inset-top, 0px)) 12px 40px',
        boxSizing: 'border-box'
      }}
    >
      {loading && <Loading />}
      {!loading && error && <ErrorState message={error} />}
      {!loading && data && data.kind === 'proposal' && (
        <>
          <ProposalView data={data} />
          {(data.contact?.proposal_status || '').toLowerCase() !== 'approved' && (
            <ApproveProposalBar
              token={token}
              companyName={data.company?.name || ''}
              contactName={data.contact?.name || ''}
              contractTotal={Number(data.contact?.amount || 0) || null}
              initialName={data.contact?.name || ''}
              onApproved={load}
            />
          )}
          {(data.contact?.proposal_status || '').toLowerCase() === 'approved' && (
            <ApprovedNote companyName={data.company?.name} />
          )}
        </>
      )}
      {!loading && data && data.kind === 'invoice'  && <InvoiceView  data={data} />}
      {!loading && data && data.kind === 'change_order' && (
        <ChangeOrderView data={data} token={token} onApproved={load} />
      )}
      {!loading && data && data.kind === 'statement' && <StatementView data={data} />}
      {/* Fallback so an unrecognized link kind never renders a blank page. */}
      {!loading && data && !['proposal', 'invoice', 'change_order', 'statement'].includes(data.kind) && (
        <ErrorState message="This document type can't be displayed here. Please ask the sender for an updated link." />
      )}
    </div>
  )
}

/* Customer facing change order page: contractor letterhead feel, the
   one CO this link points at, contract before/after, and the same
   typed-signature approval bar proposals use. */
function ChangeOrderView({ data, token, onApproved }: any) {
  const { contact, company, changeOrders } = data
  // Respect the contractor's brand accent instead of hardcoding gold, so
  // the change order matches the estimate/invoice they've been receiving.
  const brand = resolveBrandGold(company)
  const co = (changeOrders || []).find((c: any) => c.id === data.change_order_id)
  if (!co) return <ErrorState message="This change order is no longer available." />

  const priorApproved = (changeOrders || [])
    .filter((c: any) => c.status === 'approved' && c.id !== co.id)
    .reduce((s: number, c: any) => s + Number(c.amount || 0), 0)
  const contractBefore = Number(contact?.amount || 0) + priorApproved
  const delta = Number(co.amount || 0)
  const contractAfter = contractBefore + delta
  const isCredit = delta < 0
  const approved = co.status === 'approved'

  return (
    <>
      <div style={{
        maxWidth: 760, margin: '0 auto',
        padding: '32px 24px 24px',
        borderRadius: 10, background: 'white',
        boxShadow: '0 24px 64px -32px rgba(20, 20, 20, 0.3)',
        fontFamily: "'DM Sans', system-ui, sans-serif", color: '#141414'
      }}>
        {/* Letterhead */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 16, borderBottom: '2px solid #141414' }}>
          <div style={{ minWidth: 0 }}>
            {company?.logo_url && (
              <img src={company.logo_url} alt="" style={{ height: 34, marginBottom: 8, display: 'block' }} />
            )}
            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 20, fontWeight: 600, letterSpacing: 0 }}>
              {company?.name || 'Contractor'}
            </div>
            {(company?.phone || company?.email) && (
              <div style={{ fontSize: 12, color: '#5C5C5C', marginTop: 2 }}>
                {[company.phone, company.email].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: brand }}>
              Change order
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 24, fontWeight: 600 }}>
              #{co.sequence_number}
            </div>
          </div>
        </div>

        {/* Project + change */}
        <div style={{ padding: '16px 0 4px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: '#5C5C5C' }}>
            Project
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>
            {contact?.job_title || contact?.name || 'Construction services'}
          </div>
          {contact?.address && (
            <div style={{ fontSize: 12, color: '#5C5C5C', marginTop: 2 }}>{contact.address}</div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: '#5C5C5C', marginTop: 18 }}>
            Change in scope
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 3 }}>{co.title}</div>
          {co.description && (
            <p style={{ margin: '8px 0 0', fontSize: 14, lineHeight: 1.6, color: '#141414', whiteSpace: 'pre-wrap' }}>
              {co.description}
            </p>
          )}
        </div>

        {/* Money table */}
        <div style={{ marginTop: 20, borderTop: '1px solid #F2EDE4' }}>
          <MoneyRow label="Contract before this change" value={moneyFmt(contractBefore)} />
          <MoneyRow
            label={isCredit ? 'This change (credit)' : 'This change'}
            value={`${isCredit ? '−' : '+'}${moneyFmt(Math.abs(delta))}`}
            accent={isCredit ? '#2D7A4F' : brand}
          />
          <MoneyRow label="Contract after approval" value={moneyFmt(contractAfter)} strong />
        </div>
      </div>

      {!approved && (
        <ApproveProposalBar
          token={token}
          variant="change_order"
          companyName={company?.name || ''}
          contactName={contact?.name || ''}
          contractTotal={contractAfter}
          initialName={contact?.name || ''}
          onApproved={onApproved}
        />
      )}
      {approved && (
        <div style={{
          maxWidth: 760, margin: '24px auto 0', padding: '24px 24px',
          borderRadius: 10, background: 'rgba(45, 122, 79, 0.10)',
          border: '1px solid rgba(45, 122, 79, 0.40)',
          fontFamily: "'DM Sans', system-ui, sans-serif", color: '#141414', textAlign: 'center'
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: '#2D7A4F', marginBottom: 6 }}>
            Change order approved
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
            Signed{co.approved_by_name ? ` by ${co.approved_by_name}` : ''}{co.approved_at ? ` on ${new Date(co.approved_at).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}` : ''}. {company?.name || 'The contractor'} has been notified.
          </p>
        </div>
      )}
    </>
  )
}

function MoneyRow({ label, value, strong, accent }: any) {
  return (
    <div style={{
      display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
      padding: '12px 0', borderBottom: '1px solid #F2EDE4'
    }}>
      <span style={{ fontSize: strong ? 13 : 12.5, fontWeight: strong ? 700 : 500, color: strong ? '#141414' : '#5C5C5C' }}>
        {label}
      </span>
      <span style={{
        fontFamily: "'Cormorant Garamond', Georgia, serif",
        fontSize: strong ? 22 : 17, fontWeight: 600,
        color: accent || '#141414'
      }}>
        {value}
      </span>
    </div>
  )
}

function moneyFmt(n: any) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

function ApprovedNote({ companyName }: any) {
  return (
    <div
      style={{
        maxWidth: 760,
        margin: '24px auto 0',
        padding: '24px 24px',
        borderRadius: 10,
        background: 'rgba(45, 122, 79, 0.10)',
        border: '1px solid rgba(45, 122, 79, 0.40)',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        color: '#141414',
        textAlign: 'center'
      }}
    >
      <div style={{
        fontSize: 12, fontWeight: 700, letterSpacing: 0,
        textTransform: 'uppercase', color: '#2D7A4F', marginBottom: 6
      }}>
        Proposal approved
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
        {companyName ? `${companyName} has` : 'The contractor has'} a record of your approval. They'll be in touch with next steps.
      </p>
    </div>
  )
}

function Loading() {
  return (
    <div
      style={{
        maxWidth: 600, margin: '20vh auto',
        padding: 24, background: 'white', borderRadius: 10,
        fontFamily: "'DM Sans', sans-serif", color: '#5C5C5C',
        textAlign: 'center', boxShadow: '0 24px 48px -24px rgba(20, 20, 20,0.15)'
      }}
    >
      Loading…
    </div>
  )
}

function ErrorState({ message }: any) {
  return (
    <div
      style={{
        maxWidth: 480, margin: '20vh auto',
        padding: 24, background: 'white', borderRadius: 10,
        fontFamily: "'DM Sans', sans-serif", color: '#141414',
        textAlign: 'center', boxShadow: '0 24px 48px -24px rgba(20, 20, 20,0.2)'
      }}
    >
      <div style={{
        fontSize: 12, fontWeight: 700, letterSpacing: 0,
        textTransform: 'uppercase', color: '#C9963A', marginBottom: 10
      }}>
        Unavailable
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#141414' }}>
        {message}
      </p>
    </div>
  )
}

function ProposalView({ data }: any) {
  const { contact, company, items, changeOrders, insurance, photos } = data
  const mapped = mapItemsToScope(items)
  const exclusionsArray = [
    ...(mapped.exclusions || []),
    ...((contact?.exclusions_text || '').split(/\n+/).map((s: any) => s.trim()).filter(Boolean))
  ]
  return (
    <ProposalTemplate
      company={company}
      contact={contact}
      project={{
        title: contact?.job_title || contact?.name || 'Construction services',
        address: contact?.address || ''
      }}
      scopeSections={mapped.scopeSections}
      upgrades={mapped.upgrades}
      pricing={{
        baseTotal: mapped.baseTotal,
        upgradeTotal: mapped.upgradeTotal,
        discount: 0,
        taxRate: 0
      }}
      // terms_text is the contractor's PAYMENT terms, it was being
      // shoved under the Warranty heading while the payment section
      // showed a hardcoded 50/40/10 schedule the contractor never set.
      paymentTermsText={contact?.terms_text || ''}
      warrantyText={company?.warranty_default || ''}
      exclusions={exclusionsArray}
      insurance={insurance}
      changeOrders={changeOrders}
      photos={photos || []}
      meta={{
        issuedAt: contact?.quote_sent_at || contact?.created_at,
        expiresAt: contact?.quote_expires_at || null
      }}
      status={(contact?.proposal_status || 'sent').toLowerCase()}
    />
  )
}

function InvoiceView({ data }: any) {
  const { contact, company, payments, changeOrders, insurance, photos } = data
  const paid = (payments || []).reduce((s: any, p: any) => s + Number(p.amount || 0), 0)
  // Raw contract amount, passed to InvoiceTemplate, which folds in approved
  // COs itself. The customer facing balance MUST include approved COs too,
  // or the link shows "PAID" while change order money is still owed.
  const contractTotal = Number(contact?.amount || 0)
  const approvedCO = (changeOrders || [])
    .filter((co: any) => co?.status === 'approved')
    .reduce((s: any, co: any) => s + Number(co?.amount || 0), 0)
  const balance = Math.max(0, contractTotal + approvedCO - paid)
  // The specific draw this link bills: the oldest still-open invoice
  // row. Gives the document a real sequence number, issue date, and
  // due date instead of anonymous whole-job math. Absent rows (legacy
  // jobs) degrade to the whole-job presentation.
  //
  // Only ISSUED draws are shown to the customer, draft (never-sent)
  // and void rows must never leak into the public billing schedule or
  // be selected as "this invoice" (a draft's amount/due date is not a
  // real bill). Customer-visible statuses: sent, paid, overdue.
  const VISIBLE = new Set(['sent', 'paid', 'overdue'])
  const invoiceRows = (data.invoices || []).filter((inv: any) => inv && VISIBLE.has(String(inv.status || '').toLowerCase()))
  const currentInvoice = invoiceRows.find((inv: any) => String(inv.status || '').toLowerCase() !== 'paid') || null
  const thisInvoiceAmount = currentInvoice ? Math.min(balance, Number(currentInvoice.amount || 0)) : balance
  return (
    <>
    {/* The Pay button quotes THE SAME number as the page's "Amount due"
        hero, it used to quote the whole remaining balance while the
        hero showed the current draw, so a $2,500 deposit page carried a
        "Pay $10,000 now" button. */}
    {balance > 0.5 && <PayNowBar company={company} amount={thisInvoiceAmount} />}
    <InvoiceTemplate
      company={company}
      contact={contact}
      project={{
        title: contact?.job_title || 'Construction services',
        address: contact?.address || ''
      }}
      contractTotal={contractTotal}
      payments={payments}
      previouslyPaid={paid}
      thisInvoice={thisInvoiceAmount}
      balanceRemaining={balance}
      invoices={invoiceRows}
      currentInvoice={currentInvoice}
      meta={{
        issuedAt: currentInvoice?.issued_at || contact?.created_at,
        dueDate: currentInvoice?.due_at || null
      }}
      status={balance < 0.5 ? 'paid' : 'outstanding'}
      insurance={insurance}
      changeOrders={changeOrders}
      photos={photos || []}
    />
    </>
  )
}

/* Customer facing statement, one letterhead page rolling up every
   open job for this client. Uses the same gatherStatement rollup the
   in-app sheet + emailed PDF use, so the web view always agrees with
   what the contractor sent. */
function StatementView({ data }: any) {
  const { client, company, jobs, payments, changeOrders } = data
  const brand = resolveBrandGold(company)
  const rolled = gatherStatement(jobs || [], payments || [], changeOrders || [])
  const who = client?.company_name || client?.name || 'Customer'
  const today = new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <>
      {rolled.totalDue > 0.5 && <PayNowBar company={company} amount={rolled.totalDue} />}
      <div style={{
        maxWidth: 760, margin: '0 auto',
        padding: '32px 24px 24px',
        borderRadius: 10, background: 'white',
        boxShadow: '0 24px 64px -32px rgba(20, 20, 20, 0.3)',
        fontFamily: "'DM Sans', system-ui, sans-serif", color: '#141414'
      }}>
        {/* Letterhead */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, paddingBottom: 16, borderBottom: '2px solid #141414' }}>
          <div style={{ minWidth: 0 }}>
            {company?.logo_url && (
              <img src={company.logo_url} alt="" style={{ height: 34, marginBottom: 8, display: 'block' }} />
            )}
            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 20, fontWeight: 600, letterSpacing: 0 }}>
              {company?.name || 'Contractor'}
            </div>
            {(company?.phone || company?.email) && (
              <div style={{ fontSize: 12, color: '#5C5C5C', marginTop: 2 }}>
                {[company.phone, company.email].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: brand }}>
              Statement
            </div>
            <div style={{ fontSize: 12, color: '#5C5C5C', marginTop: 4 }}>{today}</div>
          </div>
        </div>

        {/* Billed-to */}
        <div style={{ padding: '16px 0 4px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: '#5C5C5C' }}>
            Statement for
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>{who}</div>
          {client?.address && (
            <div style={{ fontSize: 12, color: '#5C5C5C', marginTop: 2 }}>{client.address}</div>
          )}
        </div>

        {/* Per-property lines */}
        {rolled.lines.length === 0 ? (
          <div style={{ marginTop: 20, padding: '24px 0', textAlign: 'center', color: '#5C5C5C', fontSize: 14, borderTop: '1px solid #F2EDE4' }}>
            Nothing outstanding right now, every project is paid in full. Thank you.
          </div>
        ) : (
          <div style={{ marginTop: 20, borderTop: '1px solid #F2EDE4' }}>
            {rolled.lines.map((l: any) => (
              <div key={l.contactId} style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12,
                padding: '12px 0', borderBottom: '1px solid #F2EDE4'
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#141414', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {l.property}
                  </div>
                  <div style={{ fontSize: 12, color: '#5C5C5C', marginTop: 2 }}>
                    {moneyFmt(l.paid)} paid of {moneyFmt(l.contract)}
                  </div>
                </div>
                <span style={{ flexShrink: 0, fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 20, fontWeight: 600, color: '#141414' }}>
                  {moneyFmt(l.balance)}
                </span>
              </div>
            ))}
            <MoneyRow label="Total due" value={moneyFmt(rolled.totalDue)} strong accent={brand} />
          </div>
        )}
      </div>
    </>
  )
}

/* Customer facing "Pay now" bar, the contractor's bring-your-own pay
   link (Venmo / Zelle / Square / Stripe Payment Link) plus any
   instructions. Renders nothing when the contractor hasn't set a link.
   Cream-paper aesthetic to match the document, not the app chrome. */
function PayNowBar({ company, amount }: any) {
  const brand = resolveBrandGold(company)
  const link = (company?.payment_link || '').trim()
  const instructions = (company?.payment_instructions || '').trim()
  if (!link && !instructions) return null
  // Allow-list the scheme so a pasted `javascript:`/`data:` link can
  // never become an href on this customer facing page.
  const url = safePayUrl(link)
  const amountLabel = amount > 0
    ? Number(amount).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    : ''
  return (
    <div style={{
      maxWidth: 760, margin: '0 auto 16px',
      padding: '24px 24px', borderRadius: 10,
      background: '#F2EDE4', border: '1px solid rgba(201, 150, 58, 0.45)',
      boxShadow: '0 24px 64px -32px rgba(20, 20, 20, 0.25)',
      fontFamily: "'DM Sans', system-ui, sans-serif", color: '#141414',
      textAlign: 'center'
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase', color: brand, marginBottom: 10 }}>
        Pay your balance
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block', padding: '12px 24px', borderRadius: 10,
            background: 'linear-gradient(135deg, #C9963A 0%, #C9963A 100%)',
            color: '#141414', fontSize: 14, fontWeight: 700, textDecoration: 'none',
            letterSpacing: 0, boxShadow: '0 6px 16px rgba(201, 150, 58, 0.3)'
          }}
        >
          Pay{amountLabel ? ` ${amountLabel}` : ''} now
        </a>
      )}
      {instructions && (
        <p style={{ margin: `${url ? 14 : 0}px 0 0`, fontSize: 14, lineHeight: 1.5, color: '#5C5C5C', whiteSpace: 'pre-wrap' }}>
          {instructions}
        </p>
      )}
    </div>
  )
}
