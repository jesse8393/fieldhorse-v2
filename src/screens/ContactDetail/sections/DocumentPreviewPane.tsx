import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../../lib/supabase.ts'
import { ProposalTemplate, mapItemsToScope } from '../../../components/documents'
import DataErrorState from '../../../components/DataErrorState.tsx'
import { keepFocusOnRetry } from '../../../lib/retryFocus.ts'
import type { PublicDocPayment } from '../../../lib/portalView.ts'

const NO_PAYMENTS: PublicDocPayment[] = []

// The customer facing render of a quote, and the photo loader that feeds
// it and the PDF. Both lived inside tabs/Quote.tsx; they moved here
// unchanged so the desktop Document view and the phone's "Preview as"
// sheet (phone/QuotePreviewSheet.tsx) draw the same proposal. The
// Fieldhorse theme also reads the job's payments, as the customer page
// does, so the preview loads them too (usePreviewPayments), waits for them
// and says so when it cannot read them.

// `bare` drops the dark backdrop the desktop Document view sets behind the
// letter, for the phone sheet, which already sits on its own surface.
// `failed` means the lines could not be read: the pane says so, with Try
// again (`onRetry`), and never draws a proposal with no lines. The pane is
// one element in every state, named Proposal preview, so Try again leaves
// focus on it while the lines (or the payments) are read again.
// `payments` hands the pane the job's payments when the caller has them
// already; without it the Fieldhorse theme reads them itself.
export function DocumentPreviewPane({ company, contact, items, photos = [], payments: givenPayments, loading, failed = false, onRetry, insurance = null, changeOrders = [], bare = false }: any) {
  // Group line items by their `section` field so each trade renders
  // as its own ScopeSectionCard. Order is preserved (groupByOrdered).
  // Optional items (is_optional=true) split into the upgrades array;
  // excluded items become a bullet list under "Exclusions".
  const { scopeSections, upgrades, exclusions, baseTotal, upgradeTotal } = mapItemsToScope(items)
  const status = (contact?.proposal_status || 'draft').toLowerCase()
  const docStatus = status === 'approved' ? 'approved'
    : status === 'sent' ? 'sent'
    : status === 'changes_requested' ? 'sent'
    : status === 'expired' ? 'expired'
    : 'draft'

  // The Fieldhorse theme says what is paid as the customer page does (the
  // deposit received, what is left of it, the steps after approval), so it
  // waits for the job's payments and never draws the quote as if nothing
  // were paid while they are out or after their read failed.
  const paid = usePreviewPayments(company, contact?.id, givenPayments)

  // When the quote is approved, pull the most recent approval snapshot
  // so the preview can stamp the captured signature + date onto the
  // ApprovalBlock. Stays null for draft / sent / expired quotes, the
  // block then renders blank signature lines.
  const [approval, setApproval] = useState<any>(null)
  useEffect(() => {
    let cancelled = false
    if (status !== 'approved' || !contact?.id) {
      setApproval(null)
      return
    }
    ;(async () => {
      const { data } = await supabase
        .from('fh_quote_versions')
        .select('approved_by_name, approved_at, signature_kind, signature_data, approval_method')
        .eq('contact_id', contact.id)
        .eq('status', 'approved')
        .order('approved_at', { ascending: false })
        .limit(1)
        .maybeSingle()
      if (cancelled || !data) return
      const isDrawn = data.signature_kind === 'drawn'
      setApproval({
        mode: 'approved',
        clientName: data.approved_by_name,
        clientSignatureDataUrl: isDrawn ? data.signature_data : null,
        clientApprovedAt: data.approved_at,
        contractorSignatureDataUrl: null,
        contractorApprovedAt: null
      })
    })()
    return () => { cancelled = true }
  }, [status, contact?.id])

  const rootRef = useRef<HTMLDivElement>(null)
  // Read as nothing paid, a failed payments read would tell the contractor
  // the customer still owes a deposit they paid, so it shows its own error.
  const paymentsFailed = !failed && paid.failed
  const waiting = loading || paid.pending

  return (
    <div
      ref={rootRef}
      role="group"
      aria-label="Proposal preview"
      tabIndex={-1}
      // An error stands on its own, not on the letter's dark backdrop.
      style={failed || paymentsFailed ? undefined : bare ? { padding: 0 } : {
        padding: '8px 0 24px',
        // Cream backdrop so the white letter-paper sits visibly on
        // the dark workspace surface without floating.
        background: '#141414',
        margin: '0 -16px',
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: 10
      }}
    >
      {failed && (
        <DataErrorState
          title="Couldn't load the lines"
          message="The preview needs the quote lines. Check your connection and try again."
          actionLabel="Try again"
          onRetry={onRetry ? () => {
            keepFocusOnRetry(rootRef.current)
            onRetry()
          } : undefined}
        />
      )}
      {paymentsFailed && (
        <DataErrorState
          title="Couldn't load the payments"
          message="The preview needs the job's payments to show what is paid. Check your connection and try again."
          actionLabel="Try again"
          onRetry={() => {
            keepFocusOnRetry(rootRef.current)
            paid.retry()
          }}
        />
      )}
      {!failed && !paymentsFailed && waiting && (
        <div style={{
          padding: '24px',
          textAlign: 'center',
          color: 'var(--v3-text-muted)',
          fontFamily: 'var(--font-body)',
          fontSize: 14
        }}>
          Loading preview…
        </div>
      )}
      {!failed && !paymentsFailed && !waiting && (
        <ProposalTemplate
          company={company}
          contact={contact}
          project={{
            title: contact?.job_title || contact?.name || 'Construction services',
            address: contact?.address || ''
          }}
          scopeSections={scopeSections}
          upgrades={upgrades}
          pricing={{
            baseTotal,
            upgradeTotal,
            discount: 0,
            taxRate: 0
          }}
          paymentTermsText={contact?.terms_text || ''}
          warrantyText={company?.warranty_default || ''}
          exclusions={exclusions}
          insurance={insurance}
          changeOrders={changeOrders}
          photos={photos}
          payments={paid.payments}
          approval={approval}
          meta={{
            issuedAt: contact?.quote_sent_at || contact?.created_at,
            expiresAt: contact?.quote_expires_at || null
          }}
          status={docStatus}
        />
      )}
    </div>
  )
}

/**
 * Pull project photos for this job and resolve each storage_path to a
 * signed URL the PDF generator can fetch. Best-effort:
 *   - skips photos with no storage_path
 *   - tolerates per-photo signed-URL failures (filtered out)
 *   - returns [] when the table query fails so the renderer falls
 *     through to its placeholder zones cleanly
 *
 * Each entry returns { url, section_tag, caption } so the renderer can
 * route a tagged photo to its matching scope block. section_tag is
 * sourced from the photo's caption when present (e.g., a caption of
 * "Roofing" tags the photo for the Roofing scope), a lightweight
 * convention that doesn't require a schema change.
 */
export async function loadProjectPhotosForPdf(jobId: any, userId: any, limit = 8) {
  if (!jobId || !userId) return []
  // Every photo on the job, whoever uploaded it (RLS scopes the tenant).
  const { data, error } = await supabase
    .from('fh_job_files')
    .select('id, storage_path, caption, section_tag, kind, uploaded_at')
    .eq('job_id', jobId)
    .eq('kind', 'photo')
    .order('uploaded_at', { ascending: true })
    .limit(limit)
  if (error || !Array.isArray(data) || data.length === 0) return []

  // Sign each path. Failures filter out, the renderer handles missing
  // photos via placeholders without throwing.
  const signed = await Promise.all(
    data.map(async (row) => {
      try {
        const { data: signedRes, error: signErr } = await supabase.storage
          .from('job-photos')
          .createSignedUrl(row.storage_path, 60 * 60)
        if (signErr || !signedRes?.signedUrl) return null
        // section_tag (migration 020) is the source of truth; legacy
        // photos that used the caption-as-tag convention before the
        // column existed fall back so they still distribute correctly.
        const tag = (row.section_tag || '').trim()
          || (row.caption || '').trim()
          || null
        return {
          url: signedRes.signedUrl,
          section_tag: tag,
          caption: row.caption || null
        }
      } catch {
        return null
      }
    })
  )
  return signed.filter(Boolean)
}

// How many photos the customer page gets: the oldest twelve, in upload
// order (netlify/functions/public-link.js). Change both together.
const CUSTOMER_PAGE_PHOTOS = 12

/**
 * The photos the in app preview draws (the desktop Document view and
 * "Preview as"): the same ones the customer page gets, so the preview
 * picks the same cover (the newest of them, PortalView.coverUrl) and shows
 * the same photo blocks. The PDF keeps its eight.
 */
export function loadPreviewPhotos(jobId: any, userId: any) {
  return loadProjectPhotosForPdf(jobId, userId, CUSTOMER_PAGE_PHOTOS)
}

/**
 * The job's payments as the customer page gets them (the fields of
 * /api/public-link's payments the page reads), for the Fieldhorse preview.
 * None without a job. A read that fails throws, never reads as none: the
 * preview would then tell the contractor that a paid deposit is still owed.
 */
export async function loadPreviewPayments(jobId: any): Promise<PublicDocPayment[]> {
  if (!jobId) return []
  const { data, error } = await supabase
    .from('fh_payments')
    .select('id, amount, kind, paid_on')
    .eq('contact_id', jobId)
  if (error) throw new Error(error.message || 'Could not read the payments')
  if (!Array.isArray(data)) throw new Error('Could not read the payments')
  return data as PublicDocPayment[]
}

type PaymentsRead = { jobId: string; attempt: number; rows: PublicDocPayment[] | null }

/**
 * The payments the preview draws. Handed some, those. Otherwise the
 * Fieldhorse theme reads the job's (the letter themes print none, so they
 * ask for none): `pending` until the read for this job lands, `failed`
 * when it did not, and `retry` reads again. Kept with the job and the
 * attempt they belong to, so another job's or an older read's never show.
 */
function usePreviewPayments(company: any, jobId: string | null | undefined, given: PublicDocPayment[] | undefined) {
  const reads = given === undefined && Boolean(jobId) && String(company?.estimate_template || '').toLowerCase() === 'fieldhorse'
  const [attempt, setAttempt] = useState(0)
  const [read, setRead] = useState<PaymentsRead | null>(null)
  useEffect(() => {
    if (!reads || !jobId) return
    let cancelled = false
    void loadPreviewPayments(jobId).then(
      (rows) => { if (!cancelled) setRead({ jobId, attempt, rows }) },
      () => { if (!cancelled) setRead({ jobId, attempt, rows: null }) }
    )
    return () => { cancelled = true }
  }, [reads, jobId, attempt])
  const retry = useCallback(() => setAttempt((n) => n + 1), [])

  if (given !== undefined) return { payments: given, pending: false, failed: false, retry }
  if (!reads) return { payments: NO_PAYMENTS, pending: false, failed: false, retry }
  const current = read && read.jobId === jobId && read.attempt === attempt ? read : null
  return {
    payments: current?.rows ?? NO_PAYMENTS,
    pending: !current,
    failed: Boolean(current) && current?.rows === null,
    retry
  }
}
