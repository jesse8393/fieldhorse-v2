export { default as Button } from './Button.jsx'
export { default as Card } from './Card.jsx'
export { default as Pill } from './Pill.jsx'
export { default as SectionHeader } from './SectionHeader.jsx'
export { default as KpiTile } from './KpiTile.jsx'
export { default as QuickAction } from './QuickAction.jsx'
export { default as Sparkline } from './Sparkline.jsx'
export { default as FeedRow } from './FeedRow.jsx'
export { default as JobCard } from './JobCard.jsx'
export { default as StageTimeline } from './StageTimeline.jsx'
export { default as SegmentedTabs } from './SegmentedTabs.jsx'
export { default as NextActionCard } from './NextActionCard.jsx'
export { default as HealthDonut } from './HealthDonut.jsx'
export { default as ProgressMeter } from './ProgressMeter.jsx'

/* Phase 1B canonical primitives — added but not yet migrated to. */
export { default as Eyebrow } from './Eyebrow.jsx'
export { default as StampNumber } from './StampNumber.jsx'
export { default as FilterPill } from './FilterPill.jsx'
export { default as IconButton } from './IconButton.jsx'

/* Phase 3D — canonical floating action button (portal-rendered to
   escape framer-motion containing-block traps). */
export { default as FloatingActionButton } from './FloatingActionButton.jsx'

/* Phase V3-JOBS-1 — unified status badge primitive. One pill family
   for stage (lead/quote/job/invoice/closed/lost), Top Deal, Approved,
   Cold. Replaces the prior mix of inline StagePill + ad-hoc chips. */
export { default as StatusPill } from './StatusPill.jsx'
