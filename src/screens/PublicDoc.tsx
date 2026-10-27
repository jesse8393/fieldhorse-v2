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
// The one exception is the Fieldhorse proposal theme (spec 9.9), a
// phone first page a company picks in Settings: it fills the screen on
// the --fh- tokens (Day and Night follow the customer's phone) and ends
// with a small "Powered by Fieldhorse". A company with no
// estimate_template keeps the classic page above (decision D13).
//
// Auth: this route renders OUTSIDE the AppShell (no Gated wrapper).
// Anyone with the token can view; the on the server function gates
// expiry / revocation / not-found.

import { proposalIssuedAt } from '../lib/proposalDate.ts'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  ProposalTemplate,
  InvoiceTemplate,
  mapItemsToScope,
  resolveBrandGold
} from '../components/documents'
import ApproveProposalBar, { type ApproveCheck } from '../components/public/ApproveProposalBar.tsx'
import type { ProposalPortal } from '../components/documents/proposalThemes.tsx'
import '../components/documents/fieldhorse-proposal.css'
import { safePayUrl } from '../lib/payLink.ts'
import { buildPortalView, portalStatus, quoteFingerprint, type PublicDocPayload } from '../lib/portalView.ts'
import { gatherStatement } from '../lib/statement.ts'

type PublicDocState = { loading: boolean; data: PublicDocPayload | null; error: string | null }

// The Fieldhorse theme draws its own approve capsule and fills the page;
// every other template keeps the classic page and bar.
function isFieldhorse(payload: PublicDocPayload): boolean {
  return payload.kind === 'proposal'
    && String(payload.company?.estimate_template || '').toLowerCase() === 'fieldhorse'
}

// Whether the page drawn from this payload offers the approve bar. The
// render and the check before an approval posts both ask this, so nothing
// posts from a page that, once redrawn, no longer offers approval. The
// Fieldhorse page offers it while the quote is open (PortalView.open); the
// classic page unless it is approved or has changes requested, as it
// always did (D24).
function approvable(payload: PublicDocPayload, now: Date): boolean {
  if (payload.kind !== 'proposal') return false
  if (isFieldhorse(payload)) return buildPortalView(payload, now).open
  const status = portalStatus(payload)
  return status !== 'approved' && status !== 'changes_requested'
}

// "Ask about this" on an optional item opens the request changes form with
// this text in the box; Back puts focus back on the button tapped (opener).
// A new id each tap, so tapping again reopens it.
type AskSeed = { id: number; text: string; opener: HTMLElement | null }

// One read of the link: the quote, or why there is none. `refused` holds
// the server's error and message when it refused the link itself (a 404 or
// 410: revoked, expired, the job deleted, an unknown token); it is null
// when the read failed in a way worth retrying (no answer, too many
// requests, a server error).
type LinkRead =
  | { ok: true; payload: PublicDocPayload }
  | { ok: false; refused: { error: string | null; message: string | null } | null }

export default function PublicDoc() {
  const { token } = useParams()
  const [state, setState] = useState<PublicDocState>({ loading: true, data: null, error: null })
  const [ask, setAsk] = useState<AskSeed | null>(null)
  // Set once the bar has recorded an approval or sent a question. Neither
  // leaves anything to ask, even when the read after it fails and the page
  // still shows the quote as it was.
  const [finished, setFinished] = useState(false)
  // Set while the latest read of the link was refused (revoked, expired,
  // removed). The server takes no question then, so the page offers none;
  // a read that works clears it.
  const [linkRefused, setLinkRefused] = useState(false)
  const onAsk = useCallback((item: string, opener?: HTMLElement) => {
    setAsk((prev) => ({ id: (prev?.id ?? 0) + 1, text: `About \u201c${item}\u201d: `, opener: opener ?? null }))
  }, [])
  // The payload on the page, for the check before an approval posts.
  const shown = useRef<PublicDocPayload | null>(null)
  shown.current = state.data

  // Reads the link. The first read fills the page or shows why it cannot;
  // a later read that fails leaves the page as it is, so a reload after an
  // approval never replaces the thank you with an error.
  const load = useCallback(async (): Promise<LinkRead> => {
    if (!token) return { ok: false, refused: null }
    const keepOrFail = (message: string) => {
      setState((prev) => (prev.data ? prev : { loading: false, data: null, error: message }))
    }
    try {
      const res = await fetch(`/api/public-link?token=${encodeURIComponent(token)}`)
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body?.ok) {
        keepOrFail(body?.message || 'This link is no longer available.')
        const refused = res.status === 404 || res.status === 410
          ? {
              error: typeof body?.error === 'string' ? body.error : null,
              message: typeof body?.message === 'string' ? body.message : null
            }
          : null
        if (refused) setLinkRefused(true)
        return { ok: false, refused }
      }
      setLinkRefused(false)
      setState({ loading: false, data: body, error: null })
      // Brand the browser tab as the contractor's, not ours.
      const co = body.company?.name || 'Document'
      const proj = body.contact?.job_title || body.contact?.name || ''
      document.title = `${co}${proj ? `, ${proj}` : ''}`
      return { ok: true, payload: body as PublicDocPayload }
    } catch {
      keepOrFail('Could not load this document. Check the link and try again.')
      return { ok: false, refused: null }
    }
  }, [token])

  const reload = useCallback(() => { void load() }, [load])

  // After an approval or a question on the Fieldhorse page: read the link
  // again so the page shows what the server now holds, as reopening it
  // would, and drop the question buttons whatever that read brings.
  const afterDecision = useCallback(() => {
    setFinished(true)
    void load()
  }, [load])

  // Before an approval posts, read the quote again, which also redraws the
  // page from what the server now says. When the redrawn page offers no
  // approve bar (approved or sent back for changes meanwhile; on the
  // Fieldhorse page also expired, say at midnight, or closed), nothing
  // posts and the page shows the real state. A total that changed stops
  // the approval with its own message; any other change to what the
  // customer agrees to (the lines, the terms, the warranty) stops it too.
  // A read the server refused (the link revoked, expired or removed)
  // carries its reason to the bar; a read that failed for a moment asks
  // for another try. The classic page still leaves expiry and a closed job
  // to the server, which answers with the reason (D24). The read records a
  // view, which is fine.
  const checkBeforeApprove = useCallback(async (): Promise<ApproveCheck> => {
    const before = shown.current
    const read = await load()
    if (!read.ok) return read.refused ? { refused: read.refused } : 'failed'
    const fresh = read.payload
    const now = new Date()
    if (!approvable(fresh, now)) return 'closed'
    if (!before) return 'ok'
    if (Math.round(buildPortalView(before, now).total * 100) !== Math.round(buildPortalView(fresh, now).total * 100)) return 'changed'
    if (quoteFingerprint(before) !== quoteFingerprint(fresh)) return 'updated'
    return 'ok'
  }, [load])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      if (cancelled) return
      await load()
    })()
    return () => { cancelled = true }
  }, [load])

  const { loading, data, error } = state
  const proposalStatus = data ? portalStatus(data) : ''

  if (!loading && data && isFieldhorse(data)) {
    // Open means approvable: not approved, no changes requested, not
    // expired, not closed (approvable() below says the same). The page's
    // total, so the approval sentence quotes what the page shows.
    const pv = buildPortalView(data, new Date())
    // Only while the server still takes a question (PortalView.canAsk), the
    // link was not just refused, and the customer has not just approved or
    // asked one.
    const canAsk = pv.canAsk && !finished && !linkRefused
    return (
      <div className="fhp-ground">
        <ProposalView
          data={data}
          portal={{
            payload: data,
            onAsk: canAsk ? onAsk : undefined,
            approveBar: pv.open ? (
              <ApproveProposalBar
                skin="fieldhorse"
                token={token}
                companyName={data.company?.name || ''}
                contactName={data.contact?.name || ''}
                contractTotal={pv.total > 0 ? pv.total : (Number(data.contact?.amount || 0) || null)}
                onBeforeApprove={checkBeforeApprove}
                onApproved={afterDecision}
                onRequested={afterDecision}
                onStale={reload}
                requestSeed={ask}
                canAsk={canAsk}
              />
            ) : null
          }}
        />
      </div>
    )
  }

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
          {approvable(data, new Date()) && (
            <ApproveProposalBar
              token={token}
              companyName={data.company?.name || ''}
              contactName={data.contact?.name || ''}
              contractTotal={Number(data.contact?.amount || 0) || null}
              initialName={data.contact?.name || ''}
              onBeforeApprove={checkBeforeApprove}
              onApproved={reload}
              onStale={reload}
            />
          )}
          {proposalStatus === 'approved' && (
            <ApprovedNote companyName={data.company?.name} />
          )}
          {proposalStatus === 'changes_requested' && (
            <ChangesRequestedNote
              companyName={data.company?.name}
              requestedNote={data.contact?.quote_change_request_note}
              requestedAt={data.contact?.quote_change_requested_at}
            />
          )}
        </>
      )}
      {!loading && data && data.kind === 'invoice'  && <InvoiceView  data={data} />}
      {!loading && data && data.kind === 'change_order' && (
        <ChangeOrderView data={data} token={token} onApproved={reload} />
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
        fontFamily: 'var(--font-body)', color: '#141414'
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
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, color: brand }}>
              Change order
            </div>
            <div style={{ fontFamily: "'Cormorant Garamond', Georgia, serif", fontSize: 24, fontWeight: 600 }}>
              #{co.sequence_number}
            </div>
          </div>
        </div>

        {/* Project + change */}
        <div style={{ padding: '16px 0 4px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, color: '#5C5C5C' }}>
            Project
          </div>
          <div style={{ fontSize: 14, fontWeight: 600, marginTop: 3 }}>
            {contact?.job_title || contact?.name || 'Construction services'}
          </div>
          {contact?.address && (
            <div style={{ fontSize: 12, color: '#5C5C5C', marginTop: 2 }}>{contact.address}</div>
          )}

          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, color: '#5C5C5C', marginTop: 18 }}>
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
          fontFamily: 'var(--font-body)', color: '#141414', textAlign: 'center'
        }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, color: 'color-mix(in srgb, var(--v3-success-text) 75%, #141414 25%)', marginBottom: 6 }}>
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
        fontFamily: 'var(--font-body)',
        color: '#141414',
        textAlign: 'center'
      }}
    >
      <div style={{
        fontSize: 12, fontWeight: 700, letterSpacing: 0,
        color: 'color-mix(in srgb, var(--v3-success-text) 75%, #141414 25%)', marginBottom: 6
      }}>
        Proposal approved
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
        {companyName ? `${companyName} has` : 'The contractor has'} a record of your approval. They'll be in touch with next steps.
      </p>
    </div>
  )
}

function ChangesRequestedNote({ companyName, requestedNote, requestedAt }: any) {
  return (
    <div
      style={{
        maxWidth: 760,
        margin: '24px auto 0',
        padding: '24px 24px',
        borderRadius: 10,
        background: 'rgba(201, 150, 58, 0.10)',
        border: '1px solid rgba(201, 150, 58, 0.40)',
        fontFamily: 'var(--font-body)',
        color: '#141414',
        textAlign: 'center'
      }}
    >
      <div style={{
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0,
        color: 'color-mix(in srgb, var(--v3-primary-text) 54%, #141414 46%)',
        marginBottom: 8
      }}>
        Changes requested
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5 }}>
        {companyName || 'The contractor'} has your feedback and will send a revised proposal before approval.
        {requestedAt ? ` Request received ${new Date(requestedAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}.` : ''}
      </p>
      {requestedNote ? (
        <p style={{
          margin: '16px 0 0',
          fontSize: 14,
          lineHeight: 1.5,
          textAlign: 'left',
          color: '#5C5C5C',
          fontStyle: 'italic',
          whiteSpace: 'pre-wrap'
        }}>
          {requestedNote}
        </p>
      ) : null}
    </div>
  )
}

function Loading() {
  return (
    <div
      style={{
        maxWidth: 600, margin: '20vh auto',
        padding: 24, background: 'white', borderRadius: 10,
        fontFamily: 'var(--font-body)', color: '#5C5C5C',
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
        fontFamily: 'var(--font-body)', color: '#141414',
        textAlign: 'center', boxShadow: '0 24px 48px -24px rgba(20, 20, 20,0.2)'
      }}
    >
      <div style={{
        fontSize: 12, fontWeight: 700, letterSpacing: 0,
        color: 'color-mix(in srgb, var(--v3-primary-text) 54%, #141414 46%)', marginBottom: 10
      }}>
        Unavailable
      </div>
      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: '#141414' }}>
        {message}
      </p>
    </div>
  )
}

function ProposalView({ data, portal }: { data: PublicDocPayload; portal?: ProposalPortal }) {
  const { contact, company, items, changeOrders, insurance, photos } = data
  const mapped = mapItemsToScope(items ?? undefined)
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
        issuedAt: proposalIssuedAt(contact || {}),
        expiresAt: contact?.quote_expires_at || null
      }}
      status={portalStatus(data) || 'sent'}
      portal={portal}
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
        fontFamily: 'var(--font-body)', color: '#141414'
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
            <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, color: brand }}>
              Statement
            </div>
            <div style={{ fontSize: 12, color: '#5C5C5C', marginTop: 4 }}>{today}</div>
          </div>
        </div>

        {/* Billed-to */}
        <div style={{ padding: '16px 0 4px' }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, color: '#5C5C5C' }}>
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
      fontFamily: 'var(--font-body)', color: '#141414',
      textAlign: 'center'
    }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 0, color: brand, marginBottom: 10 }}>
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
