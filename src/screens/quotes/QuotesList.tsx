// Quotes, /quotes (Phase 9, decision D65). Every quote of the company as a
// hairline row: the title, the client, the money and the status chip. A row
// opens the quote. New quote goes to the create screen (Task 8). Loading
// shows the list's skeleton, a failed read an error with Try again, and no
// quotes "No quotes yet." (D49).

import { useCallback, useEffect, useRef, useState } from 'react'
import { FileText, Plus } from 'lucide-react'
import { Button, Chip, EmptyState, Row, SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { supabase } from '../../lib/supabase.ts'
import { newRecordRoute, recordRoute } from '../../lib/records.ts'
import { statusChip } from '../ContactDetail/lib/quoteStatus.ts'
import { QUOTE_SELECT, quoteStatusView, quoteTitle, type QuoteWithClient } from './quoteShape.ts'
import './quotes.css'

type ListState = { status: 'loading' | 'ready' | 'failed'; rows: QuoteWithClient[] }

export default function QuotesList() {
  const { user } = useAuth()
  const [state, setState] = useState<ListState>({ status: 'loading', rows: [] })
  const seq = useRef(0)
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  const load = useCallback(async () => {
    if (!user?.id) return
    const mine = ++seq.current
    const { data, error } = await supabase
      .from('fh_quotes')
      .select(QUOTE_SELECT)
      .order('updated_at', { ascending: false })
    if (mine !== seq.current) return
    if (error) { setState((s) => ({ status: 'failed', rows: s.rows })); return }
    setState({ status: 'ready', rows: (data || []) as unknown as QuoteWithClient[] })
  }, [user?.id])
  useEffect(() => { void load() }, [load])

  return (
    <div className="fhqt-page fhqt-page--list">
      <header className="fhqt-list-head">
        <h1 className="fhqt-list-title" ref={titleRef} tabIndex={-1}>Quotes</h1>
        <Button variant="secondary" size="mini" icon={Plus} to={newRecordRoute('quote')}>New quote</Button>
      </header>
      {state.status === 'loading' ? (
        <div className="fhqt-loading"><SkeletonRows rows={5} label="Loading quotes" /></div>
      ) : state.status === 'failed' && state.rows.length === 0 ? (
        <DataErrorState title="Couldn't load quotes" message="Check your connection and try again." actionLabel="Try again" onRetry={() => { void load() }} />
      ) : state.rows.length === 0 ? (
        <EmptyState icon={FileText} title="No quotes yet." action={<Button variant="secondary" icon={Plus} to={newRecordRoute('quote')}>New quote</Button>} />
      ) : (
        <ul className="fhqt-rows" aria-label="Quotes">
          {state.rows.map((q) => {
            const chip = statusChip(quoteStatusView(q))
            return (
              <Row
                key={q.id}
                as="li"
                title={quoteTitle(q)}
                subline={q.fh_clients?.name || 'No client'}
                money={Number(q.amount) || 0}
                next={<Chip tone={chip.tone} label={chip.label} />}
                to={recordRoute('quote', q.id)}
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}
