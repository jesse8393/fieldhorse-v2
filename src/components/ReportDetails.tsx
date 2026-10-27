import type { ReportRecord } from '../lib/reportHistory.ts'

/** Native disclosure keeps long reports and parsed details readable with keyboard or touch. */
export default function ReportDetails({ report }: { report: ReportRecord }) {
  const parsed = report.parsed && typeof report.parsed === 'object' && !Array.isArray(report.parsed)
    ? report.parsed as Record<string, unknown> : {}
  return (
    <details onClick={event => event.stopPropagation()} style={{ marginTop: 8 }}>
      <summary style={{ cursor: 'pointer', minHeight: 44, alignContent: 'center', color: 'var(--v3-primary-text)', fontSize: 14, fontWeight: 600 }}>
        Read full report
      </summary>
      <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontSize: 16, lineHeight: 1.6 }}>
        {report.text || report.body || report.title || '(empty report)'}
      </div>
      {typeof parsed.summary === 'string' && <p><strong>AI summary: </strong>{parsed.summary}</p>}
      {(['action_items', 'risks', 'materials_needed'] as const).map(key => {
        const items = parsed[key]
        if (!Array.isArray(items) || !items.length) return null
        return <div key={key}>
          <strong>{{ action_items: 'Action items', risks: 'Risks', materials_needed: 'Materials' }[key]}</strong>
          <ul>{items.filter(item => typeof item === 'string').map((item, index) => <li key={index}>{item}</li>)}</ul>
        </div>
      })}
      {typeof parsed.follow_up_date === 'string' && <p>Follow up: {parsed.follow_up_date}</p>}
    </details>
  )
}
