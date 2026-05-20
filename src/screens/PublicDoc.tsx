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
    </div>
  )
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
  )
}
