export { default as Button } from './Button.tsx'
export { default as Card } from './Card.tsx'
export { default as Pill } from './Pill.tsx'
export { default as SectionHeader } from './SectionHeader.tsx'
export { default as KpiTile } from './KpiTile.jsx'
export { default as QuickAction } from './QuickAction.tsx'
export { default as Sparkline } from './Sparkline.tsx'
export { default as FeedRow } from './FeedRow.jsx'
export { default as JobCard } from './JobCard.jsx'
export { default as StageTimeline } from './StageTimeline.jsx'
export { default as SegmentedTabs } from './SegmentedTabs.jsx'
export { default as NextActionCard } from './NextActionCard.jsx'
export { default as HealthDonut } from './HealthDonut.jsx'
export { default as ProgressMeter } from './ProgressMeter.tsx'

/* Phase 1B canonical primitives — added but not yet migrated to. */
export { default as Eyebrow } from './Eyebrow.tsx'
export { default as StampNumber } from './StampNumber.tsx'
export { default as FilterPill } from './FilterPill.tsx'
export { default as IconButton } from './IconButton.jsx'

/* Phase 3D — canonical floating action button (portal-rendered to
   escape framer-motion containing-block traps). */
export { default as FloatingActionButton } from './FloatingActionButton.tsx'

/* Account attribution — inline byline chip for shared-job content
   ("Posted by Parker Construction Co." etc.). Resolves via the
   fh_resolve_account_labels RPC (migration 016). */
export { default as PostedByChip } from './PostedByChip.tsx'

/* Phase V3-JOBS-1 — unified status badge primitive. One pill family
   for stage (lead/quote/job/invoice/closed/lost), Top Deal, Approved,
   Cold. Replaces the prior mix of inline StagePill + ad-hoc chips. */
export { default as StatusPill } from './StatusPill.tsx'

/* "You've reached the bottom" footer affordance that closes off
   scrollable screens so empty space doesn't read as a gap before the
   bottom nav. marginTop:auto inside a flex column pushes it to the
   bottom on under-filled screens. */
export { default as ScreenCloser } from './ScreenCloser.tsx'
