import { partnerAccessSummary } from '../lib/partnerView.ts'

/** Permission copy follows the actual accepted-partner policies, not job titles. */
export default function PartnerAccessDetails({ status = 'pending', role, open = false }: {
  status?: string
  role?: string | null
  open?: boolean
}) {
  const access = partnerAccessSummary(status, role)
  return (
    <details open={open || undefined} style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--v3-text-muted)', minWidth: 0 }}>
      <summary style={{ cursor: 'pointer', minHeight: 44, display: 'list-item', alignContent: 'center', color: 'var(--v3-text)', fontWeight: 600 }}>
        {access.title}
      </summary>
      <p style={{ margin: '4px 0 8px' }}>{access.status}</p>
      <p style={{ margin: '4px 0 8px' }}>{access.role}</p>
      <dl style={{ margin: 0, display: 'grid', gap: 8 }}>
        <div><dt style={{ fontWeight: 700, color: 'var(--v3-text)' }}>Shared access</dt><dd style={{ margin: 0 }}>{access.included}</dd></div>
        <div><dt style={{ fontWeight: 700, color: 'var(--v3-text)' }}>Stays private</dt><dd style={{ margin: 0 }}>{access.excluded}</dd></div>
        <div><dt style={{ fontWeight: 700, color: 'var(--v3-text)' }}>Quote documents</dt><dd style={{ margin: 0 }}>Standalone quotes require their own customer review link. A job invitation does not grant access to those quotes.</dd></div>
      </dl>
    </details>
  )
}
