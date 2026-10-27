import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useCommunicationHistory } from '../lib/communicationHistory.ts'
import './communication-history.css'

export default function CommunicationHistory({ contactId, clientId, refreshKey = 0 }: { contactId?: string; clientId?: string | null; refreshKey?: number }) {
  const history = useCommunicationHistory(contactId, clientId)
  const [search, setSearch] = useState('')
  const [channel, setChannel] = useState('all')
  const [expanded, setExpanded] = useState<string[]>([])
  useEffect(() => {
    if (refreshKey > 0) history.refresh()
    // A successful user action explicitly requests a fresh read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey])
  const rows = history.entries.filter((entry) => (channel === 'all' || entry.channel === channel)
    && `${entry.title} ${entry.body} ${entry.recipient}`.toLowerCase().includes(search.toLowerCase().trim()))
  return (
    <section className="fh-communication" aria-label="Communication history">
      <div className="fh-communication__heading">
        <h2>Communication history</h2>
        <button type="button" onClick={history.refresh}>Refresh</button>
      </div>
      <p className="fh-communication__note">Connected messages and recorded job communications appear together. Phone and email app replies stay in those apps. Reported sent means someone confirmed sending; it does not confirm delivery.</p>
      <div className="fh-communication__filters">
        <label>Search history<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Message, subject or recipient" /></label>
        <label>Channel<select value={channel} onChange={(event) => setChannel(event.target.value)}><option value="all">All channels</option><option value="email">Email</option><option value="sms">SMS</option><option value="call">Call</option></select></label>
      </div>
      {history.failedSources.length > 0 && <p role="alert" className="fh-communication__error">{history.failedSources.join(' and ')} could not load. Available history remains below. Refresh to try again.</p>}
      {history.loading ? <p role="status">Loading communication history…</p> : rows.length === 0 ? <p>{search || channel !== 'all' ? 'No matching messages in loaded history.' : history.failedSources.length ? 'No available history to display.' : 'No communications recorded yet.'}</p> : (
        <ol className="fh-communication__list">
          {rows.map((entry) => {
            const open = expanded.includes(entry.id)
            const long = entry.body.length > 360
            return (
              <li key={entry.id}>
                <div className="fh-communication__meta"><span>{entry.channel === 'sms' ? 'SMS' : entry.channel || 'Activity'} · {entry.status}</span><time dateTime={entry.at}>{entry.at ? new Date(entry.at).toLocaleString(undefined, { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Date unavailable'}</time></div>
                <h3>{entry.title}</h3>
                {entry.recipient && <p className="fh-communication__recipient">{entry.recipient}</p>}
                <p className="fh-communication__body">{long && !open ? `${entry.body.slice(0, 360)}…` : entry.body || 'No message text recorded.'}</p>
                <div className="fh-communication__actions">
                  {long && <button type="button" aria-expanded={open} onClick={() => setExpanded((ids) => open ? ids.filter((id) => id !== entry.id) : [...ids, entry.id])}>{open ? 'Show less' : 'Read full message'}</button>}
                  {entry.conversationId && <Link to={`/inbox/${entry.conversationId}`}>Open conversation</Link>}
                  {entry.contactId && !contactId && <Link to={`/compose?contact=${encodeURIComponent(entry.contactId)}&channel=${entry.channel === 'email' ? 'email' : 'sms'}`}>Write a message</Link>}
                </div>
              </li>
            )
          })}
        </ol>
      )}
      {history.hasMore && <button type="button" className="fh-communication__more" onClick={history.loadMore} disabled={history.loadingMore}>{history.loadingMore ? 'Loading…' : 'Load older history'}</button>}
    </section>
  )
}
