// Preview as the customer, /quotes/:id/preview (Phase 9, Task 10, D57):
// the customer's view of the quote, drawn in the app from the saved lines.
// It never mints a link or calls a send route. While the lines load it
// waits, and when their read failed it says so with Try again, never a
// proposal with no lines. Download the PDF saves the same document.

import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { Button, SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { useLinkedClientEmail } from '../../lib/queries.ts'
import { previewAsName } from '../../lib/quoteView.ts'
import { recordRoute } from '../../lib/records.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { toastError, toastSuccess } from '../../lib/toast.ts'
import { DocumentPreviewPane, loadPreviewPhotos } from '../ContactDetail/sections/DocumentPreviewPane.tsx'
import { useQuoteItems } from '../ContactDetail/sections/QuoteItems.tsx'
import QuoteHeader from './QuoteHeader.tsx'
import { useQuote } from './useQuote.ts'
import { quoteAsContact, type QuoteWithClient } from './quoteShape.ts'
import { buildQuotePdf, companyFromProfile, downloadQuotePdf, legacyContactId, NoLinesError } from './quoteDocument.ts'
import './quotes.css'

export default function QuotePreview() {
  const { id = '' } = useParams()
  const state = useQuote(id)
  const home = recordRoute('quote', id)
  if (state.status !== 'ready') {
    return (
      <div className="fhqt-page">
        <QuoteHeader kicker="Proposal preview" home={home} />
        {state.status === 'loading' ? (
          <div className="fhqt-loading"><SkeletonRows rows={4} label="Loading the quote" /></div>
        ) : state.status === 'missing' ? (
          <DataErrorState title="This quote is gone" message="It may have been deleted." actionLabel="" />
        ) : (
          <DataErrorState title="Couldn't load the quote" message="Check your connection and try again." actionLabel="Try again" onRetry={() => { void state.refresh() }} />
        )}
      </div>
    )
  }
  return <Preview quote={state.quote} home={home} />
}

function Preview({ quote, home }: { quote: QuoteWithClient; home: string }) {
  const { user } = useAuth()
  const { profile } = useProfile()
  const userId = user?.id
  const items = useQuoteItems({ quoteId: quote.id, userId })
  const linesFailed = !items.loading && items.failed && !items.loaded
  const company = useMemo(() => companyFromProfile(profile), [profile])
  const linked = useLinkedClientEmail(quote.client_id)
  const email = linked.data ?? null
  const contact = useMemo(() => quoteAsContact(quote, email), [quote, email])
  const who = previewAsName(quote.fh_clients?.name)

  // Photos for the cover and the scope sections, from the job the quote came
  // from or became, best effort.
  const [photos, setPhotos] = useState<any[]>([])
  const [photosLoading, setPhotosLoading] = useState(false)
  const source = legacyContactId(quote)
  useEffect(() => {
    if (!source || !userId) return
    let alive = true
    setPhotosLoading(true)
    loadPreviewPhotos(source, userId)
      .catch(() => [])
      .then((list) => {
        if (!alive) return
        setPhotos(list || [])
        setPhotosLoading(false)
      })
    return () => { alive = false }
  }, [source, userId])

  const [downloading, setDownloading] = useState(false)
  async function download() {
    if (!userId || downloading) return
    hapticTap()
    setDownloading(true)
    try {
      const result = await buildQuotePdf({ quote, company, userId, recipientEmail: email })
      await downloadQuotePdf(result)
      toastSuccess('Quote downloaded', result.filename)
    } catch (e) {
      toastError("Couldn't download", e instanceof NoLinesError ? e.message : (e as Error)?.message || 'Try again')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div className="fhqt-page">
      <QuoteHeader kicker="Quote" home={home} />
      <h1 className="fhqt-title" tabIndex={-1}>Proposal preview</h1>
      <p className="fhqt-sub">This is what {who} sees. Nothing is sent.</p>
      <div className="fhqt-preview">
        <DocumentPreviewPane
          bare
          company={company}
          contact={contact}
          items={items.rows}
          photos={photos}
          loading={items.loading || photosLoading}
          failed={linesFailed}
          onRetry={() => { void items.fetchRows() }}
        />
      </div>
      <div className="fhqt-job">
        <Button variant="secondary" size="lg" block loading={downloading} disabled={items.loading || linesFailed} onClick={() => void download()}>
          Download the PDF
        </Button>
      </div>
    </div>
  )
}
