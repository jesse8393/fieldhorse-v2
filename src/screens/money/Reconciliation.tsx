import { Link, useSearchParams } from 'react-router-dom'
import { formatMoney, Row } from '../../components/fh'
import type { ReconciliationGroup } from '../../lib/moneyReconciliation.ts'

export function ReconciliationLinks({ groups }: { groups: ReconciliationGroup[] }) {
  return <section className="fhm-reconciliation" aria-label="Billing reconciliation">
    <h2>Billing reconciliation</h2>
    <p>Each amount opens its contributing records. These categories overlap; do not add them together.</p>
    <div className="fhm-reconciliation__links">{groups.slice(0, 4).map(group => <Link key={group.id} to={`/invoices?panel=reconciliation&bucket=${encodeURIComponent(group.id)}`}><span>{group.label}</span><strong>{formatMoney(group.total)}</strong></Link>)}</div>
  </section>
}

export function ReconciliationPanel({ groups }: { groups: ReconciliationGroup[] }) {
  const [params] = useSearchParams()
  const selected = groups.find(g => g.id === params.get('bucket')) ?? groups[0]
  return <section className="fhm-reconciliation" aria-label="Contributing billing records">
    <nav className="fhm-reconciliation__nav" aria-label="Reconciliation categories">{groups.map(group => <Link replace key={group.id} aria-current={selected.id === group.id ? 'page' : undefined} to={`/invoices?panel=reconciliation&bucket=${encodeURIComponent(group.id)}`}>{group.label}</Link>)}</nav>
    <h2>{selected.label}</h2>
    <p>{selected.explanation}</p>
    <p><strong>{formatMoney(selected.total)}</strong> across {selected.rows.length} {selected.rows.length === 1 ? 'record' : 'records'}. All contributing records shown.</p>
    {selected.rows.length === 0 ? <p>No records contribute to this amount.</p> : <ul className="fhm-rows">{selected.rows.map(row => <Row as="li" key={row.id} title={row.title} subline={row.detail} money={row.amount} to={row.to} />)}</ul>}
  </section>
}
