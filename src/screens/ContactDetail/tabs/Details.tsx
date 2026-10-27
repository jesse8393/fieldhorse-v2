import MilestonesSection from '../sections/Milestones.tsx'
import TodosSection from '../sections/Todos.tsx'
import ScheduledSection from '../sections/Scheduled.tsx'
import InspectionsSection from '../sections/Inspections.tsx'
import InvitePartnerSection from '../sections/InvitePartner.tsx'
import InsuranceSection from '../sections/InsuranceSection.tsx'

export default function DetailsTab({
  section = 'details',
  contact,
  inspections,
  scheduleItems,
  userId,
  fetchAll,
  patch,
  onOpenAddEvent,
  onOpenInvitePartner,
  insurance,
  canSeeMoney = false
}: any) {
  const sub = ({ details: 'milestones', tasks: 'todos', schedule: 'scheduled' } as Record<string, string>)[section] || section
  if (sub === 'insurance' && !canSeeMoney) return null
  return (
    <div>
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
