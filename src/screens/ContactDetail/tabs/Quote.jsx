import QuoteItemsSection from '../sections/QuoteItems.jsx'

/**
 * QUOTE tab — the formal sellable scope. Lead → Quote → Approved Job
 * → Production/Expenses → Invoice. Quote is the sendable artifact;
 * once approved (Phase 4C) it becomes the locked baseline that
 * Production and Invoice surfaces inherit from.
 *
 * Phase 4A-2: thin shell that mounts the quote-items section.
 * Phase 4A-4: forward the parent `fetchAll` so write-side rollups
 * refresh `fh_contacts.amount` in the parent ContactDetail state
 * (header, stage timeline, balance, Overview cockpit) immediately
 * after a quote item write. The "Send Quote" CTA, scope/terms/
 * exclusions text, and approval action land in 4B/4C.
 */
export default function QuoteTab({ contact, userId, fetchAll }) {
  return (
    <QuoteItemsSection
      jobId={contact?.id}
      userId={userId}
      onContactRefresh={fetchAll}
    />
  )
}
