import { useMemo, useState } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { Plus, Clock } from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { signedUrlsFor, SIGNED_URL_REUSE_MS } from '../../../lib/signedUrls.ts'
import { Button, EmptyState, SpineEntry } from '../../../components/fh'
import { buildSpine } from '../lib/spine.ts'
import type { SpineInspectionInput } from '../lib/spine.ts'
import { composeActivityEvents } from '../sections/composeActivityEvents.ts'
import './job-phone.css'

// The Spine on the phone Job page (spec 9.4): every note, photo batch,
// payment, schedule event, stage move and inspection on the job, newest
// first, built by buildSpine. "Add" opens Capture attached to this job.
//
// Photos come from one query shared with the header (cover and count):
// the job's photo rows, signed through signedUrlsFor so the Files tab
// reuses the same URLs. A photo that fails to sign keeps its place in
// the count but never renders as a thumbnail or a cover.

const BUCKET = 'job-photos'
const FIRST_PAGE = 10

export type JobPhotoRow = {
  id: string
  storage_path: string
  uploaded_at: string
  caption: string | null
}

type JobPhotoData = {
  rows: JobPhotoRow[]
  urls: Record<string, string>
  signedAt: number
}

export type JobPhotos = {
  /** Newest first, each with its signed url or null. */
  rows: (JobPhotoRow & { url: string | null })[]
  count: number
  /** The newest photo that signed, for the header. */
  cover: { url: string; alt: string } | null
}

export function jobPhotosKey(jobId: string | null | undefined) {
  return ['jobDetailPhotos', jobId] as const
}

async function fetchJobPhotos(queryClient: QueryClient, jobId: string): Promise<JobPhotoData> {
  const { data, error } = await supabase
    .from('fh_job_files')
    .select('id, storage_path, uploaded_at, caption')
    .eq('job_id', jobId)
    .eq('kind', 'photo')
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  const rows = ((data || []) as JobPhotoRow[]).filter((r) => r?.id && r.storage_path)
  const urls: Record<string, string> = {}
  if (rows.length > 0) {
    try {
      const byPath = await signedUrlsFor(queryClient, BUCKET, rows.map((r) => r.storage_path))
      for (const r of rows) {
        const url = byPath.get(r.storage_path)
        if (url) urls[r.id] = url
      }
    } catch {
      // Signing failed: the rows still count, the header falls back to onyx.
    }
  }
  return { rows, urls, signedAt: Date.now() }
}

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

  return useMemo(() => {
    // A persisted copy can outlive its signed URLs; never hand out one
    // that may have expired, so no image ever renders broken.
    const fresh = !!data && Date.now() - data.signedAt < SIGNED_URL_REUSE_MS
    const rows = (data?.rows ?? [])
      .map((r) => ({ ...r, url: fresh ? data?.urls[r.id] ?? null : null }))
      .sort((a, b) => String(b.uploaded_at).localeCompare(String(a.uploaded_at)))
    const first = rows.find((r) => r.url)
    return {
      rows,
      count: rows.length,
      cover: first?.url ? { url: first.url, alt: first.caption?.trim() || 'Newest job photo' } : null
    }
  }, [data])
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
      stageTransitions
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
        <h2 id="fhj-spine-title" className="fhj-spine__title">Spine</h2>
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
