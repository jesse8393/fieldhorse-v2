import { useMemo, useState } from 'react'
import { SegmentedTabs } from '../../../components/v3'
import MilestonesSection from '../sections/Milestones.tsx'
import TodosSection from '../sections/Todos.tsx'
import ScheduledSection from '../sections/Scheduled.tsx'
import InspectionsSection from '../sections/Inspections.tsx'
import InvitePartnerSection from '../sections/InvitePartner.tsx'
import InsuranceSection from '../sections/InsuranceSection.tsx'

/**
 * DETAILS tab, sub-tab router for the work-plan side of a job.
 *
 * Sub-tabs: Milestones · Tasks · Scheduled · Inspections · Partner
 *
 * Inspections sub-tab is always present (the section UI renders the toggle
 * + the dashed empty state when has_inspections is off, no functionality
 * is hidden behind the flag, just the trade grid).
 *
 * Sub-tab state lives here, not in the parent shell. Switching to FINANCIALS
 * and back resets to the default 'milestones', matches PWA expectations.
 */
const SUB_TABS = [
  { id: 'milestones',  label: 'Milestones' },
  { id: 'todos',       label: 'Tasks' },
  { id: 'scheduled',   label: 'Scheduled' },
  { id: 'inspections', label: 'Inspections' },
  { id: 'insurance',   label: 'Insurance' },
  { id: 'partner',     label: 'Partner' }
]

export default function DetailsTab({
  contact,
  inspections,
  scheduleItems,
  userId,
  fetchAll,
  patch,
  onOpenAddEvent,
  onOpenInvitePartner,
  insurance
}: any) {
  const [sub, setSub] = useState('milestones')

  // Sub-tabs with counts where they make the screen more useful
  const subTabsWithCounts = useMemo(() => {
    const milestones = Array.isArray(contact?.milestones) ? contact.milestones : []
    return SUB_TABS.map((t) => {
      if (t.id === 'milestones') {
        const undone = milestones.filter((m: any) => !m.done).length
        return undone > 0 ? { ...t, count: undone } : t
      }
      if (t.id === 'scheduled') {
        return scheduleItems.length > 0 ? { ...t, count: scheduleItems.length } : t
      }
      if (t.id === 'inspections' && contact?.has_inspections) {
        return inspections.length > 0 ? { ...t, count: inspections.length } : t
      }
      return t
    })
  }, [contact, scheduleItems, inspections])

  return (
    <div>
      <div style={{ paddingTop: 12 }}>
        <SegmentedTabs
          value={sub}
          onChange={setSub}
          tabs={subTabsWithCounts}
          variant="pill"
          ariaLabel="Details sub-tabs"
        />
      </div>

      <div className="v3-section" style={{ margin: '12px var(--v3-gutter) 24px' }}>
        {sub === 'milestones' && (
          <MilestonesSection contact={contact} patch={patch} />
        )}
        {sub === 'todos' && (
          <TodosSection jobId={contact?.id} userId={userId} />
        )}
        {sub === 'scheduled' && (
          <ScheduledSection
            scheduleItems={scheduleItems}
            onOpenAddEvent={onOpenAddEvent}
          />
        )}
        {sub === 'inspections' && (
          <InspectionsSection
            contact={contact}
            inspections={inspections}
            userId={userId}
            fetchAll={fetchAll}
            patch={patch}
          />
        )}
        {sub === 'insurance' && (
          <InsuranceSection
            contact={contact}
            userId={userId}
            insurance={insurance}
            onChange={() => fetchAll?.()}
          />
        )}
        {sub === 'partner' && (
          <InvitePartnerSection
            contact={contact}
            onOpenInvitePartner={onOpenInvitePartner}
          />
        )}
      </div>
    </div>
  )
}
