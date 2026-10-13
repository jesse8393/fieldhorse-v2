import { useEffect, useState } from 'react'
import { Sheet } from '../../../components/fh'
import { DocumentPreviewPane, loadPreviewPhotos } from '../sections/DocumentPreviewPane.tsx'
import './quote-phone.css'

// "Preview as {first name}" (spec 9.6, decision D8): the customer's view of
// the quote, drawn in the app from the lines on screen. It reads the lines
// it is given (so an optional switch just flipped shows here too) and the
// job's photos, and never mints a public link or calls a send route. While
// the lines load it waits, and when their read failed it says so with Try
// again, never a proposal with no lines (Phase 8 follow up A).

export type QuotePreviewSheetProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What the customer is called, for the description. */
  who: string
  company: any
  contact: any
  /** fh_quote_items rows, optimistic edits included. */
  items: any[]
  /** The first read of the lines is still out. */
  linesLoading?: boolean
  /** No read of the lines has worked and the last one failed. */
  linesFailed?: boolean
  /** Reads the lines again. */
  onRetryLines?: () => void
  userId: string | undefined
  insurance?: any
  changeOrders?: any[]
}

export default function QuotePreviewSheet({
  open,
  onOpenChange,
  who,
  company,
  contact,
  items,
  linesLoading = false,
  linesFailed = false,
  onRetryLines,
  userId,
  insurance = null,
  changeOrders = []
}: QuotePreviewSheetProps) {
  const [photos, setPhotos] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const jobId = contact?.id

  // Photos for the proposal's cover and scope sections, best effort: the
  // loader returns none when the query or the signing fails.
  useEffect(() => {
    if (!open || !jobId || !userId) return
    let alive = true
    setLoading(true)
    loadPreviewPhotos(jobId, userId)
      .catch(() => [])
      .then((list) => {
        if (!alive) return
        setPhotos(list || [])
        setLoading(false)
      })
    return () => { alive = false }
  }, [open, jobId, userId])

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Proposal preview"
      description={`This is what ${who} sees. Nothing is sent.`}
      className="fhq-preview-sheet"
    >
      <div className="fhq-preview">
        <DocumentPreviewPane
          bare
          company={company}
          contact={contact}
          items={items}
          photos={photos}
          loading={loading || linesLoading}
          failed={linesFailed}
          onRetry={onRetryLines}
          insurance={insurance}
          changeOrders={changeOrders}
        />
      </div>
    </Sheet>
  )
}
