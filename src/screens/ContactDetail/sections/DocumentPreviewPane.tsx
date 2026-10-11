import { useEffect, useState } from 'react'
import { supabase } from '../../../lib/supabase.ts'
import { ProposalTemplate, mapItemsToScope } from '../../../components/documents'

// The customer facing render of a quote, and the photo loader that feeds
// it and the PDF. Both lived inside tabs/Quote.tsx; they moved here
// unchanged so the desktop Document view and the phone's "Preview as"
// sheet (phone/QuotePreviewSheet.tsx) draw the same proposal.

// `bare` drops the dark backdrop the desktop Document view sets behind the
// letter, for the phone sheet, which already sits on its own surface.
export function DocumentPreviewPane({ company, contact, items, photos = [], loading, insurance = null, changeOrders = [], bare = false }: any) {
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

  return (
    <div
      style={bare ? { padding: 0 } : {
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
      {loading && (
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
      {!loading && (
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
export async function loadProjectPhotosForPdf(jobId: any, userId: any) {
  if (!jobId || !userId) return []
  // Every photo on the job, whoever uploaded it (RLS scopes the tenant).
  const { data, error } = await supabase
    .from('fh_job_files')
    .select('id, storage_path, caption, section_tag, kind, uploaded_at')
    .eq('job_id', jobId)
    .eq('kind', 'photo')
    .order('uploaded_at', { ascending: true })
    .limit(8)
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
