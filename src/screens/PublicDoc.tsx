// src/screens/PublicDoc.tsx
//
// Public client-facing document page at /p/:token. Resolves the
// token via the /api/public-link Netlify function (server-side,
// service-role) and renders the same ProposalTemplate or
// InvoiceTemplate the contractor sees in-app.
//
// White-label: every byte the customer sees belongs to the
// contractor. The page chrome is a neutral cream backdrop framing
// the letter-paper template — no FieldHorse name, logo, or
// navigation surfaces appear. The browser tab title is set to the
// contractor's company name + the project so the link looks like
// it came from them.
//
// Auth: this route renders OUTSIDE the AppShell (no Gated wrapper).
// Anyone with the token can view; the server-side function gates
// expiry / revocation / not-found.

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ProposalTemplate,
  InvoiceTemplate,
  mapItemsToScope
} from '../components/documents'
import ApproveProposalBar from '../components/public/ApproveProposalBar.tsx'

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
      document.title = `${co}${proj ? ` — ${proj}` : ''}`
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
        background: '#f0ece2',
        padding: 'calc(20px + env(safe-area-inset-top, 0px)) 12px 40px',
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
    </div>
  )
}

/* Customer-facing change-order page: contractor letterhead feel, the
   one CO this link points at, contract before/after, and the same
   typed-signature approval bar proposals use. */
function ChangeOrderView({ data, token, onApproved }: any) {
  const { contact, company, changeOrders } = data
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
        padding: '32px 28px 28px',
        borderRadius: 6, background: 'white',
        boxShadow: '0 24px 64px -32px rgba(31, 30, 28, 0.3)',
        fontFamily: "'DM Sans', system-ui, sans-serif", color: '#1A1814'
      }}>
        {/* Letterhead */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, paddingBottom: 18, borderBottom: '2px solid #1A1814' }}>
          <div style={{ minWidth: 0 }}>
            {company?.logo_url && (
              <img src={company.logo_url} alt="" style={{ height: 34, marginBottom: 8, display: 'block' }} />
            )}
            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 22, fontWeight: 600, letterSpacing: '0.02em' }}>
              {company?.name || 'Contractor'}
            </div>
            {(company?.phone || company?.email) && (
              <div style={{ fontSize: 11, color: '#6B6A66', marginTop: 2 }}>
                {[company.phone, company.email].filter(Boolean).join(' · ')}
              </div>
            )}
          </div>
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#C8A154' }}>
              Change order
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 28, fontWeight: 600 }}>
              #{co.sequence_number}
            </div>
          </div>
        </div>

        {/* Project + change */}
        <div style={{ padding: '18px 0 4px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6B6A66' }}>
            Project
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, marginTop: 3 }}>
            {contact?.job_title || contact?.name || 'Construction services'}
          </div>
          {contact?.address && (
            <div style={{ fontSize: 12, color: '#6B6A66', marginTop: 2 }}>{contact.address}</div>
          )}

          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#6B6A66', marginTop: 18 }}>
            Change in scope
          </div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 3 }}>{co.title}</div>
          {co.description && (
            <p style={{ margin: '8px 0 0', fontSize: 13.5, lineHeight: 1.6, color: '#3A3833', whiteSpace: 'pre-wrap' }}>
              {co.description}
            </p>
          )}
        </div>

        {/* Money table */}
        <div style={{ marginTop: 20, borderTop: '1px solid #e8e2d4' }}>
          <MoneyRow label="Contract before this change" value={moneyFmt(contractBefore)} />
          <MoneyRow
            label={isCredit ? 'This change (credit)' : 'This change'}
            value={`${isCredit ? '−' : '+'}${moneyFmt(Math.abs(delta))}`}
            accent={isCredit ? '#48825F' : '#C8A154'}
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
          maxWidth: 760, margin: '24px auto 0', padding: '20px 24px',
          borderRadius: 6, background: 'rgba(72, 130, 95, 0.10)',
          border: '1px solid rgba(72, 130, 95, 0.40)',
          fontFamily: "'DM Sans', system-ui, sans-serif", color: '#1A1814', textAlign: 'center'
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#48825F', marginBottom: 6 }}>
            Change order approved
          </div>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
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
      padding: '10px 0', borderBottom: '1px solid #f0ece2'
    }}>
      <span style={{ fontSize: strong ? 13 : 12.5, fontWeight: strong ? 700 : 500, color: strong ? '#1A1814' : '#6B6A66' }}>
        {label}
      </span>
      <span style={{
        fontFamily: "'Cormorant Garamond', Georgia, serif",
        fontSize: strong ? 22 : 17, fontWeight: 600,
        color: accent || '#1A1814'
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
        padding: '20px 24px',
        borderRadius: 6,
        background: 'rgba(72, 130, 95, 0.10)',
        border: '1px solid rgba(72, 130, 95, 0.40)',
        fontFamily: "'DM Sans', system-ui, sans-serif",
        color: '#1A1814',
        textAlign: 'center'
      }}
    >
      <div style={{
        fontSize: 11, fontWeight: 700, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: '#48825F', marginBottom: 6
      }}>
        Proposal approved
      </div>
      <p style={{ margin: 0, fontSize: 13, lineHeight: 1.5 }}>
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
        padding: 24, background: 'white', borderRadius: 8,
        fontFamily: "'DM Sans', sans-serif", color: '#6B6A66',
        textAlign: 'center', boxShadow: '0 24px 48px -24px rgba(0,0,0,0.15)'
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
        padding: 28, background: 'white', borderRadius: 8,
        fontFamily: "'DM Sans', sans-serif", color: '#1A1814',
        textAlign: 'center', boxShadow: '0 24px 48px -24px rgba(0,0,0,0.2)'
      }}
    >
      <div style={{
        fontSize: 12, fontWeight: 700, letterSpacing: '0.18em',
        textTransform: 'uppercase', color: '#C8A154', marginBottom: 10
      }}>
        Unavailable
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#3A3833' }}>
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
      warrantyText={contact?.terms_text || company?.warranty_default || ''}
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
  const contractTotal = Number(contact?.amount || 0)
  const balance = Math.max(0, contractTotal - paid)
  return (
    <>
    {balance > 0.5 && <PayNowBar company={company} amount={balance} />}
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
      thisInvoice={balance}
      balanceRemaining={balance}
      meta={{
        issuedAt: contact?.created_at,
        dueDate: null
      }}
      status={balance < 0.5 ? 'paid' : 'outstanding'}
      insurance={insurance}
      changeOrders={changeOrders}
      photos={photos || []}
    />
    </>
  )
}

/* Customer-facing "Pay now" bar — the contractor's bring-your-own pay
   link (Venmo / Zelle / Square / Stripe Payment Link) plus any
   instructions. Renders nothing when the contractor hasn't set a link.
   Cream-paper aesthetic to match the document, not the app chrome. */
function PayNowBar({ company, amount }: any) {
  const link = (company?.payment_link || '').trim()
  const instructions = (company?.payment_instructions || '').trim()
  if (!link && !instructions) return null
  const url = link
    ? (/^[a-z][a-z0-9+.-]*:/i.test(link) ? link : `https://${link}`)
    : ''
  const amountLabel = amount > 0
    ? Number(amount).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
    : ''
  return (
    <div style={{
      maxWidth: 760, margin: '0 auto 16px',
      padding: '20px 24px', borderRadius: 6,
      background: '#fffaf0', border: '1px solid rgba(200, 161, 84, 0.45)',
      boxShadow: '0 24px 64px -32px rgba(31, 30, 28, 0.25)',
      fontFamily: "'DM Sans', system-ui, sans-serif", color: '#3A3833',
      textAlign: 'center'
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: '#C8A154', marginBottom: 10 }}>
        Pay your balance
      </div>
      {url && (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={{
            display: 'inline-block', padding: '13px 28px', borderRadius: 6,
            background: 'linear-gradient(135deg, #d4af37 0%, #b7872d 100%)',
            color: '#1A1814', fontSize: 15, fontWeight: 700, textDecoration: 'none',
            letterSpacing: '0.02em', boxShadow: '0 6px 16px rgba(201, 150, 58, 0.3)'
          }}
        >
          Pay{amountLabel ? ` ${amountLabel}` : ''} now
        </a>
      )}
      {instructions && (
        <p style={{ margin: `${url ? 14 : 0}px 0 0`, fontSize: 13, lineHeight: 1.5, color: '#5d5d57', whiteSpace: 'pre-wrap' }}>
          {instructions}
        </p>
      )}
    </div>
  )
}
