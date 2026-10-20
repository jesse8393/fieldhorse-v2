// Approve a quote by hand, /quotes/:id/approve (Phase 9, Task 10, D57).
// The ApproveQuoteSheet from the job page, as a screen: it reads the lines
// fresh by quote_id, snapshots the quote (lines, scope, terms, exclusions,
// expiry, client, company) and calls fn_approve_quote_version with the
// quote id. Task 11 teaches the function to write fh_quotes; until then the
// screen marks the quote approved itself once the version row is confirmed
// by a second read. Approving never makes the quote a job (D54): Make this a
// job on the quote screen does that, when Jesse says so.
//
// Nothing here sends anything. A customer's own approval through the share
// link is recorded by /api/public-link-approve, not here.

import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Lock } from 'lucide-react'
import { Button, Field, Icon, SkeletonRows } from '../../components/fh'
import { cx } from '../../components/fh/cx.ts'
import { formatMoney } from '../../components/fh/money.ts'
import DataErrorState from '../../components/DataErrorState.tsx'
import LoadingValue from '../../components/LoadingValue.tsx'
import SignaturePad from '../../components/SignaturePad.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { supabase } from '../../lib/supabase.ts'
import { useLinkedClientEmail } from '../../lib/queries.ts'
import { customerEmail } from '../../lib/customerEmail.ts'
import { quoteNumber } from '../../lib/quotes.ts'
import { recordRoute } from '../../lib/records.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { toastSuccess } from '../../lib/toast.ts'
import { keepFocusOnRetry } from '../../lib/retryFocus.ts'
import { relativeAgo, shortDate } from '../ContactDetail/lib/quoteStatus.ts'
import QuoteHeader, { useGoBack } from './QuoteHeader.tsx'
import { useQuote } from './useQuote.ts'
import { quoteTitle, type QuoteWithClient } from './quoteShape.ts'
import { companyFromProfile, legacyContactId } from './quoteDocument.ts'
import './quotes.css'

const METHODS = [
  { value: 'verbal',          label: 'Verbal' },
  { value: 'text',            label: 'Text' },
  { value: 'email',           label: 'Email' },
  { value: 'in_person',       label: 'In person' },
  { value: 'signature_drawn', label: 'Signature, drawn' },
  { value: 'signature_typed', label: 'Signature, typed' }
] as const

const LINES_FAILED = "We couldn't load the lines."

export default function QuoteApprove() {
  const { id = '' } = useParams()
  const state = useQuote(id)
  const home = recordRoute('quote', id)
  if (state.status !== 'ready') {
    return (
      <div className="fhqt-page">
        <QuoteHeader kicker="Approve" home={home} />
        {state.status === 'loading' ? (
          <div className="fhqt-loading"><SkeletonRows rows={4} label="Loading the quote" /></div>
        ) : state.status === 'missing' ? (
          <DataErrorState title="This quote is gone" message="It may have been deleted." actionLabel="" />
        ) : (
          <DataErrorState title="Couldn't load the quote" message="Check your connection and try again." actionLabel="Try again" onRetry={() => { void state.refresh() }} />
        )}
      </div>
    )
  }
  return <ApproveForm quote={state.quote} patch={state.patch} home={home} />
}

function ApproveForm({ quote, patch, home }: { quote: QuoteWithClient; patch: ReturnType<typeof useQuote>['patch']; home: string }) {
  const { user } = useAuth()
  const { profile } = useProfile()
  const userId = user?.id
  const goBack = useGoBack(home)
  const client = quote.fh_clients ?? null

  const [method, setMethod] = useState<string>('verbal')
  const [name, setName] = useState(client?.name || '')
  const [email, setEmail] = useState('')
  const [note, setNote] = useState('')
  // signatureKind mirrors the schema ('drawn' | 'typed' | null); signatureData
  // is a PNG data URL (drawn) or plain text (typed).
  const [signatureKind, setSignatureKind] = useState<'drawn' | 'typed' | null>(null)
  const [signatureData, setSignatureData] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [err, setErr] = useState('')
  const titleRef = useRef<HTMLHeadingElement>(null)

  // The customer's email, found the way the quote sends (the client's, read
  // fresh). It starts the approval's email and goes on the approved copy.
  // Set once the field is typed in, the client's email arriving a beat
  // later leaves what was typed alone.
  const linked = useLinkedClientEmail(quote.client_id)
  const foundEmail = customerEmail({ email: '', fh_clients: { email: linked.data ?? null } })
  const emailEdited = useRef(false)
  useEffect(() => { if (!emailEdited.current) setEmail(foundEmail) }, [foundEmail])

  // The lines, read fresh so the snapshot is the truth of the moment. Try
  // again reads them again without clearing the form.
  const [items, setItems] = useState<any[]>([])
  const [loadingItems, setLoadingItems] = useState(true)
  const [itemsFailed, setItemsFailed] = useState(false)
  const [itemsKey, setItemsKey] = useState(0)
  useEffect(() => {
    let alive = true
    setLoadingItems(true)
    setItemsFailed(false)
    ;(async () => {
      const { data, error } = await supabase
        .from('fh_quote_items')
        .select('*')
        .eq('quote_id', quote.id)
        .order('sort_order', { ascending: true })
      if (!alive) return
      if (error) { setItemsFailed(true); setLoadingItems(false); return }
      setItems(data || [])
      setLoadingItems(false)
    })()
    return () => { alive = false }
  }, [quote.id, itemsKey])

  const totals = useMemo(() => {
    const base = items.filter((i) => !i.is_optional && !i.is_excluded)
    const optional = items.filter((i) => i.is_optional && !i.is_excluded)
    const excluded = items.filter((i) => i.is_excluded)
    const sum = (list: any[]) => list.reduce((s, i) => s + Number(i.amount || 0), 0)
    return { base: sum(base), optional: sum(optional), baseCount: base.length, optionalCount: optional.length, excludedCount: excluded.length }
  }, [items])

  const expired = useMemo(() => {
    if (!quote.expires_at) return false
    const t = new Date(quote.expires_at).getTime()
    return Number.isFinite(t) && t < Date.now()
  }, [quote.expires_at])

  const commitDisabled = totals.baseCount === 0 || loadingItems || itemsFailed || !name.trim() || submitting

  function changeMethod(next: string) {
    if (next === method) return
    hapticTap()
    setMethod(next)
    if (next === 'signature_drawn') { setSignatureKind('drawn'); setSignatureData(null) }
    else if (next === 'signature_typed') { setSignatureKind('typed'); setSignatureData(name.trim() || '') }
    else { setSignatureKind(null); setSignatureData(null) }
  }

  async function commit() {
    if (commitDisabled || !userId) return
    setErr('')
    setSubmitting(true)
    try {
      const company = companyFromProfile(profile)
      const snapshot = {
        quote_number: quoteNumber(company.name, quote.id, quote.sent_at || quote.created_at),
        snapshot_taken_at: new Date().toISOString(),
        quote_id: quote.id,
        company,
        contact: {
          id: quote.id,
          name: client?.name || null,
          address: client?.address || null,
          phone: client?.phone || null,
          email: foundEmail || null,
          job_title: quote.title || null
        },
        scope_text: quote.scope_text || null,
        terms_text: quote.terms_text || null,
        exclusions_text: quote.exclusions_text || null,
        quote_expires_at: quote.expires_at || null,
        items: items.map((i) => ({
          section: i.section || null,
          description: i.description,
          qty: Number(i.qty || 0),
          unit: i.unit || null,
          rate: Number(i.rate || 0),
          amount: Number(i.amount || 0),
          notes: i.notes || null,
          is_optional: !!i.is_optional,
          is_excluded: !!i.is_excluded,
          sort_order: Number(i.sort_order || 0)
        })),
        totals: { base: totals.base, optional: totals.optional, excluded_count: totals.excludedCount }
      }
      const isSignature = method === 'signature_drawn' || method === 'signature_typed'
      const sigKind = isSignature ? signatureKind : null
      const sigData = isSignature && signatureData && signatureData.trim().length > 0 ? signatureData : null

      const { data: rpcData, error: rpcErr } = await supabase.rpc('fn_approve_quote_version', {
        p_user_id: userId,
        p_quote_id: quote.id,
        p_contact_id: legacyContactId(quote),
        p_snapshot: snapshot,
        p_base_total: totals.base,
        p_optional_total: totals.optional,
        p_excluded_count: totals.excludedCount,
        p_approval_method: method,
        p_approved_by_name: name.trim(),
        p_approved_by_email: email.trim() || null,
        p_approval_note: note.trim() || null,
        p_signature_kind: sigKind,
        p_signature_data: sigData
      } as any)
      if (rpcErr) {
        console.error('[approve-quote] RPC error:', rpcErr)
        throw new Error('Approval could not be saved. Please try again.')
      }
      const versionRow = Array.isArray(rpcData) ? rpcData[0] : rpcData
      if (!versionRow?.id) {
        console.error('[approve-quote] RPC returned no row:', rpcData)
        throw new Error('Approval could not be saved. Please try again.')
      }
      // The function's word is not enough: a second read must find the row
      // before the quote is marked approved or success is claimed.
      const { data: confirmed, error: verifyErr } = await supabase
        .from('fh_quote_versions')
        .select('id, version_number, approved_at')
        .eq('id', versionRow.id)
        .eq('user_id', userId)
        .maybeSingle()
      if (verifyErr) {
        console.error('[approve-quote] readback error:', verifyErr)
        throw new Error('Approval could not be saved. Please try again.')
      }
      if (!confirmed) throw new Error("The approval was sent, but we couldn't confirm it saved. Please try again.")

      await patch({ status: 'approved', approved_version_id: confirmed.id })
      toastSuccess('Quote approved', `Approved version ${confirmed.version_number}, ${formatMoney(totals.base)}`)
      try {
        await supabase.from('fh_notifications').insert({
          user_id: userId,
          kind: 'quote_approved',
          title: `Quote approved, ${formatMoney(totals.base)}`,
          body: `${client?.name || 'Client'} signed off via ${method}`,
          link: recordRoute('quote', quote.id)
        })
      } catch { /* best effort */ }
      goBack()
    } catch (e: any) {
      console.error('[approve-quote] failed:', e)
      const ours = e?.message && /^(Approval|The approval|Add at least)/.test(e.message)
      setErr(ours ? e.message : 'Approval could not be saved. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="fhqt-page">
      <QuoteHeader kicker="Approve" home={home} />
      <h1 className="fhqt-title" ref={titleRef} tabIndex={-1}>Lock the approved quote.</h1>
      <p className="fhqt-sub">
        Creates a permanent record of what {client?.name || 'this customer'} agreed to. Later edits to lines or terms do not change this snapshot.
      </p>

      <form className="fhqt-form fhqt-form--page" onSubmit={(e) => { e.preventDefault(); void commit() }}>
        {err && <p role="alert" className="fhqt-alert">{err}</p>}

        <div className="fhqt-card">
          <div className="fhqt-card__row">
            <span className="fhqt-card__name">{quoteTitle(quote)}{client?.name ? `, ${client.name}` : ''}</span>
            <span className="fhqt-card__amount">
              {loadingItems ? <LoadingValue label="Loading the total" width={72} height={18} /> : itemsFailed ? null : formatMoney(totals.base)}
            </span>
          </div>
          {!itemsFailed && (
            <p className="fhqt-card__line">
              {loadingItems
                ? 'Loading the lines'
                : `${totals.baseCount} base, ${totals.optionalCount} optional${totals.optional > 0 ? ` (${formatMoney(totals.optional)})` : ''}, ${totals.excludedCount} excluded`}
            </p>
          )}
          {quote.status === 'sent' && quote.sent_at && <p className="fhqt-card__line">{relativeAgo(quote.sent_at, 'Sent')}</p>}
        </div>

        <p className="fhqt-notice">
          <Icon icon={Lock} size={18} />
          <span>Different from sending the PDF. Use this when the customer says yes: lines, scope and terms freeze at this moment.</span>
        </p>

        {expired && (
          <p className="fhqt-alert">
            This quote expired on {shortDate(quote.expires_at)}. You can still approve, just confirm the customer is fine with the original price.
          </p>
        )}

        <div className="fhqt-kind">
          <span className="fhqt-kind__label" id="fhqt-method-label">How was it approved?</span>
          <div role="radiogroup" aria-labelledby="fhqt-method-label" className="fhqt-seg fhqt-seg--wrap">
            {METHODS.map((m) => (
              <button
                key={m.value}
                type="button"
                role="radio"
                aria-checked={method === m.value}
                disabled={submitting}
                className={cx('fhqt-seg__option', method === m.value && 'is-on')}
                onClick={() => changeMethod(m.value)}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="fhqt-kind__help">Customers can sign themselves through the share link. Those approvals are recorded on their own.</p>
        </div>

        {method === 'signature_drawn' && (
          <SignaturePad
            value={signatureData}
            onChange={setSignatureData}
            label="Customer signature"
            hint="Optional, use this when the customer signs in person."
            height={150}
          />
        )}
        {method === 'signature_typed' && (
          <Field
            label="Customer signature"
            value={signatureData || ''}
            placeholder={name || 'Customer types their name'}
            helper="Optional, use this when the customer signs in person."
            disabled={submitting}
            onChange={(e) => setSignatureData(e.target.value)}
          />
        )}

        <Field
          label="Approved by"
          value={name}
          placeholder={client?.name || 'Customer name'}
          disabled={submitting}
          required
          onChange={(e) => setName(e.target.value)}
        />
        <Field
          label="Email (optional)"
          type="email"
          inputMode="email"
          value={email}
          placeholder="name@domain.com"
          disabled={submitting}
          onChange={(e) => { emailEdited.current = true; setEmail(e.target.value) }}
        />
        <Field
          label="Note (optional)"
          multiline
          rows={2}
          value={note}
          placeholder="Confirmed by phone Friday morning, deposit on Monday."
          disabled={submitting}
          onChange={(e) => setNote(e.target.value)}
        />

        {itemsFailed && !loadingItems && (
          <DataErrorState
            compact
            title={LINES_FAILED}
            message="Check your connection and try again."
            actionLabel="Try again"
            onRetry={() => {
              keepFocusOnRetry(titleRef.current)
              setItemsKey((k) => k + 1)
            }}
          />
        )}
        {totals.baseCount === 0 && !loadingItems && !itemsFailed && (
          <p className="fhqt-sub">Add at least one line in the total on the quote before approving.</p>
        )}

        <Button type="submit" variant="primary" size="lg" block disabled={commitDisabled} loading={submitting}>
          Approve quote
        </Button>
      </form>
    </div>
  )
}
