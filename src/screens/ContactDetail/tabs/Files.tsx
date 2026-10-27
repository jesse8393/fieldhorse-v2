import PhotosSection from '../sections/Photos.tsx'
import FilesSection from '../sections/Files.tsx'
import MessagesSection from '../sections/Messages.tsx'

export default function FilesTab({ section = 'files', contact, notes = [], userId, fetchAll, incomingPhotos = null, onIncomingPhotosHandled }: any) {
  const sub = section === 'files' ? 'photos' : section === 'documents' ? 'files' : section
  return (
    <div>
      <div className="v3-section" data-job-section id={`fh-job-files-panel-${sub}`} tabIndex={-1} style={{ margin: '12px var(--v3-gutter) 24px' }}>
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
