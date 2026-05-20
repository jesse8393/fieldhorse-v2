import { useAccountLabels, formatAttribution } from '../../lib/accountAttribution.ts'

/**
 * PostedByChip — compact byline for shared-job content.
 *
 * Renders a small uppercase eyebrow-style chip:
 *   "Posted by Parker Construction Co."
 *   "Added by Office Admin · Partner"
 *   "Created by you"
 *
 * Resolves the user_id → display label via the fh_resolve_account_labels
 * RPC (migration 016). Falls back to "Posted by someone on this job"
 * when the lookup fails or returns nothing — never leaks a raw uuid.
 *
 * Intentionally NOT a full card or visual redesign — this is inline
 * attribution that sits below an existing item's content.
 *
 * Props:
 *   userId    — required; the row's creator user_id
 *   verb      — 'posted' | 'added' | 'created' (default 'posted')
 *   showRole  — boolean; append "· Partner" / "· Owner" when known
 *   style     — additional styles to merge
 */
type PostedByChipProps = {
  userId?: string | null
  verb?: 'posted' | 'added' | 'created'
  showRole?: boolean
  style?: import('react').CSSProperties
}

export default function PostedByChip({ userId, verb = 'posted', showRole = false, style }: PostedByChipProps) {
  // Stable single-element array reference per render isn't required —
  // the hook keys off a deduped/sorted CSV of ids, so passing [userId]
  // here is fine even if it's a new array each render.
  const labels = useAccountLabels(userId ? [userId] : [])
  const entry = userId ? labels.get(String(userId)) || null : null
  const text = formatAttribution(entry, verb, showRole)

  return (
    <span
      style={{
        display: 'inline-block',
        fontFamily: 'var(--font-body)',
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        color: 'var(--v3-text-muted)',
        lineHeight: 1.3,
        whiteSpace: 'normal',
        overflowWrap: 'anywhere',
        ...style
      }}
    >
      {text}
    </span>
  )
}
