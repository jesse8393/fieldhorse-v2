// The New screen (PHASE9_PLAN Task 8, SPEC D58). One New button opens this
// full screen: Lead, Quote, Job, Invoice, and Client under them. Each row
// goes straight to that record's create screen; nobody is asked "who is
// this for" first, the client is picked or typed on the create screen. A
// ?client= in the query string (from a client's own page) rides along to
// every row.

import { useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { IconButton, Row } from '../components/fh'
import { newRecordRoute, type RecordKind } from '../lib/records.ts'
import { hapticTap } from '../lib/haptics.ts'
import './new/new.css'

const ROWS: { kind: RecordKind; title: string; subline: string }[] = [
  { kind: 'lead', title: 'Lead', subline: 'Someone who called. No quote yet.' },
  { kind: 'quote', title: 'Quote', subline: 'Scope and a price to send.' },
  { kind: 'job', title: 'Job', subline: 'Work that is on.' },
  { kind: 'invoice', title: 'Invoice', subline: 'Bill a job or a client.' },
  { kind: 'client', title: 'Client', subline: 'A customer on file.' }
]

export default function New() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const clientId = params.get('client')
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  function goBack() {
    hapticTap()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/')
  }

  return (
    <div className="fhnew">
      <header className="fhnew-head">
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
        <h1 className="fhnew-title" ref={titleRef} tabIndex={-1}>New</h1>
      </header>
      <p className="fhnew-lede">Any of these can start on its own.</p>
      <ul className="fhnew-rows" aria-label="What to create">
        {ROWS.map((r) => (
          <Row
            key={r.kind}
            as="li"
            title={r.title}
            subline={r.subline}
            to={newRecordRoute(r.kind, clientId ? { client: clientId } : undefined)}
          />
        ))}
      </ul>
    </div>
  )
}
