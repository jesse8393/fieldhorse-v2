import { useState } from 'react'
import { SegmentedTabs } from '../../../components/v3'
import PhotosSection from '../sections/Photos.jsx'
import FilesSection from '../sections/Files.jsx'
import MessagesSection from '../sections/Messages.jsx'

/**
 * FILES tab — sub-tab router for media + comms.
 *
 * Sub-tabs: Photos · Files · Messages
 *
 * Default sub: Photos (highest-frequency for jobsite documentation).
 */
const SUB_TABS = [
  { id: 'photos',   label: 'Photos' },
  { id: 'files',    label: 'Files' },
  { id: 'messages', label: 'Messages' }
]

export default function FilesTab({ contact, notes = [], userId, fetchAll }: any) {
  const [sub, setSub] = useState('photos')

  return (
    <div>
      <div style={{ paddingTop: 12 }}>
        <SegmentedTabs
          value={sub}
          onChange={setSub}
          tabs={SUB_TABS}
          variant="pill"
          ariaLabel="Files sub-tabs"
        />
      </div>

      <div className="v3-section" style={{ margin: '12px var(--v3-gutter) 24px' }}>
        {sub === 'photos' && (
          <PhotosSection jobId={contact?.id} userId={userId} />
        )}
        {sub === 'files' && (
          <FilesSection jobId={contact?.id} userId={userId} />
        )}
        {sub === 'messages' && (
          <MessagesSection
            contactId={contact?.id}
            userId={userId}
            notes={notes}
            fetchAll={fetchAll}
          />
        )}
      </div>
    </div>
  )
}
