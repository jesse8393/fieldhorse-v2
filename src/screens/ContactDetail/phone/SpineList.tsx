import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Plus, Clock } from 'lucide-react'
import { Button, EmptyState, SpineEntry } from '../../../components/fh'
import { buildSpine } from '../lib/spine.ts'
import type { SpineInspectionInput } from '../lib/spine.ts'
import { fetchJobPhotos, jobPhotosKey, jobPhotosView } from '../lib/jobPhotos.ts'
import type { JobPhotos } from '../lib/jobPhotos.ts'
import { composeActivityEvents } from '../sections/composeActivityEvents.ts'
import './job-phone.css'

// The Spine on the phone Job page (spec 9.4): every note, photo batch,
// payment, schedule event, stage move and inspection on the job, newest
// first, built by buildSpine. "Add" opens Capture attached to this job.
//
// Photos come from one query shared with the header (cover and count):
// the job's photo rows, each signed URL with the time it was signed, so
// the Files tab reuses the same URLs and none is drawn once it may have
// run out (lib/jobPhotos.ts). A photo that fails to sign keeps its place
// in the count but never renders as a thumbnail or a cover, and one that
// fails to load leaves its entry (SpineEntry). Notes show in full.

const FIRST_PAGE = 10

export { jobPhotosKey }
export type { JobPhotoRow, JobPhotos } from '../lib/jobPhotos.ts'

/** The job's photos for the header and the Spine. */
export function useJobPhotos(jobId: string | null | undefined): JobPhotos {
  const queryClient = useQueryClient()
  const { data } = useQuery({
    queryKey: jobPhotosKey(jobId),
    queryFn: () => fetchJobPhotos(queryClient, jobId as string),
    enabled: !!jobId,
    // Each mount checks again, so photos added on the Files tab show up
    // when the person comes back to the Spine.
    staleTime: 0
  })

  return useMemo(() => jobPhotosView(data, Date.now()), [data])
}

export type SpineListProps = {
  contact: any
  notes?: any[]
  payments?: any[]
  scheduleItems?: any[]
  changeOrders?: any[]
  stageTransitions?: any[]
  inspections?: any[]
  /** Payments and change orders only reach money roles. */
  canSeeMoney?: boolean
  onAdd: () => void
}

export default function SpineList({
  contact,
  notes = [],
  payments = [],
  scheduleItems = [],
  changeOrders = [],
  stageTransitions = [],
  inspections = [],
  canSeeMoney = false,
  onAdd
}: SpineListProps) {
  const photos = useJobPhotos(contact?.id)
  const [showAll, setShowAll] = useState(false)

  const items = useMemo(() => {
    const events = composeActivityEvents({
      contact,
      notes,
      payments: canSeeMoney ? payments : [],
      scheduleItems,
      changeOrders: canSeeMoney ? changeOrders : [],
      stageTransitions,
      // Every note, each in full, so "Show N more" counts what is there.
      fullNotes: true
    })
    const inspectionRows: SpineInspectionInput[] = (inspections || []).map((i: any) => ({
      id: String(i.id),
      result: i.result ?? null,
      inspected_at: i.inspected_at ?? i.created_at ?? null,
      type: i.type ?? i.trade ?? null
    }))
    return buildSpine({
      events,
      photos: photos.rows.map((r) => ({ id: r.id, uploaded_at: r.uploaded_at, caption: r.caption, url: r.url })),
      inspections: inspectionRows,
      now: new Date()
    })
  }, [contact, notes, payments, scheduleItems, changeOrders, stageTransitions, inspections, canSeeMoney, photos.rows])

  const shown = showAll ? items : items.slice(0, FIRST_PAGE)
  const hidden = items.length - shown.length

  return (
    <section className="fhj-spine" aria-labelledby="fhj-spine-title">
      <div className="fhj-spine__head">
        <h2 id="fhj-spine-title" className="fhj-spine__title">Activity</h2>
        <Button variant="quiet" size="mini" icon={Plus} onClick={onAdd} aria-label="Add to this job">
          Add
        </Button>
      </div>

      {items.length === 0 ? (
        <EmptyState
          icon={Clock}
          title="Nothing on this job yet."
          action={<Button variant="secondary" icon={Plus} onClick={onAdd}>Add a note or photo</Button>}
        />
      ) : (
        <ol className="fhj-spine__list">
          {shown.map((item) => {
            // Beyond a week the date stands alone, as in the render.
            const dated = /\d/.test(item.day)
            return (
              <SpineEntry
                key={item.id}
                as="li"
                className={item.id.startsWith('note:') ? 'fhj-spine__note' : undefined}
                time={dated ? item.day : item.time}
                day={dated ? undefined : item.day}
                dateTime={item.at.toISOString()}
                title={item.title}
                subline={item.subline}
                tone={item.tone}
                photos={item.photos}
              />
            )
          })}
        </ol>
      )}

      {hidden > 0 && (
        <Button variant="quiet" size="md" className="fhj-spine__more" onClick={() => setShowAll(true)}>
          Show {hidden} more
        </Button>
      )}
    </section>
  )
}
