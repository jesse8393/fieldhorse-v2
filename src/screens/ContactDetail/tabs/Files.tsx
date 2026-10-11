import { useEffect, useState } from 'react'
import { SegmentedTabs } from '../../../components/v3'
import { tabPanelProps } from '../../../lib/tabs.ts'
import PhotosSection from '../sections/Photos.tsx'
import FilesSection from '../sections/Files.tsx'
import MessagesSection from '../sections/Messages.tsx'

/**
 * FILES tab, sub-tab router for media + comms.
 *
 * Sub-tabs: Photos · Files · Messages
 *
 * Default sub: Photos (highest-frequency for jobsite documentation).
 *
 * incomingPhotos: files the phone page's camera button took. They switch
 * the tab to Photos, which uploads them the same way as Add Photos.
 */
const SUB_TABS = [
  { id: 'photos',   label: 'Photos' },
  { id: 'files',    label: 'Files' },
  { id: 'messages', label: 'Messages' }
]

export default function FilesTab({ contact, notes = [], userId, fetchAll, incomingPhotos = null, onIncomingPhotosHandled }: any) {
  const [sub, setSub] = useState('photos')
  const hasIncoming = Array.isArray(incomingPhotos) && incomingPhotos.length > 0
  useEffect(() => {
    if (hasIncoming) setSub('photos')
  }, [hasIncoming])

  return (
    <div>
      <div style={{ paddingTop: 12 }}>
        <SegmentedTabs
          value={sub}
          onChange={setSub}
          tabs={SUB_TABS}
          variant="pill"
          ariaLabel="Files sub-tabs"
          idBase="fh-job-files"
        />
      </div>

      <div className="v3-section" {...tabPanelProps('fh-job-files', sub)} style={{ margin: '12px var(--v3-gutter) 24px' }}>
        {sub === 'photos' && (
          <PhotosSection
            jobId={contact?.id}
            userId={userId}
            incomingFiles={incomingPhotos}
            onIncomingHandled={onIncomingPhotosHandled}
          />
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
