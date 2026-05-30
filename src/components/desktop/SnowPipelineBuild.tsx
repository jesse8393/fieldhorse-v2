// SnowPipelineBuild — kanban-style pipeline view for the Build
// direction. Rendered inside SnowJobsBuild when the user toggles to
// "Pipeline" view, but exported as a standalone component so a
// future /pipeline or /leads route can mount it directly.
//
// Five stage columns (Lead / Quote / Active / Invoicing / Won) with
// deal cards per stage, ranked by amount. Read-only for now — drag
// and drop is a future enhancement.

import { ChevronRight, Plus } from 'lucide-react'
import { money } from '../../lib/format.ts'

type Contact = {
  id: string
  name: string
  stage: string
  amount?: number | null
  job_title?: string | null
  job_type?: string | null
  updated_at?: string | null
  created_at?: string | null
}

type Props = {
  contacts: Contact[]
  onOpenJob: (id: string) => void
  onNewLead?: () => void
}

type StageDef = { key: string; label: string; tone: 'lead' | 'quote' | 'job' | 'invoice' | 'won' }

const STAGES: StageDef[] = [
  { key: 'lead',    label: 'Lead',      tone: 'lead' },
  { key: 'quote',   label: 'Quote',     tone: 'quote' },
  { key: 'job',     label: 'Active',    tone: 'job' },
  { key: 'invoice', label: 'Invoicing', tone: 'invoice' },
  { key: 'closed',  label: 'Won',       tone: 'won' },
]

function relTime(iso: any) {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  if (diff < 3_600_000) return `${Math.max(1, Math.floor(diff / 60_000))}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function SnowPipelineBuild({ contacts, onOpenJob, onNewLead }: Props) {
  const grouped = STAGES.map((s) => {
    const items = contacts
      .filter((c) => String(c.stage || '').toLowerCase() === s.key)
      .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
    const total = items.reduce((sum, c) => sum + Number(c.amount || 0), 0)
    return { ...s, items, total }
  })

  return (
    <section className="fh-build-pipeline-board">
      {grouped.map((col) => (
        <article key={col.key} className="fh-build-pipeline-col">
          <header className={`fh-build-pipeline-col__head is-stage-${col.tone}`}>
            <div>
              <div className="fh-build-pipeline-col__label">{col.label}</div>
              <div className="fh-build-pipeline-col__total">{money(col.total)}</div>
            </div>
            <div className="fh-build-pipeline-col__count">{col.items.length}</div>
          </header>

          <div className="fh-build-pipeline-col__body">
            {col.items.length === 0 && (
              <div className="fh-build-pipeline-col__empty">
                {col.key === 'lead' && onNewLead ? (
                  <button type="button" className="fh-build-pipeline-col__empty-add" onClick={onNewLead}>
                    <Plus size={13} /> Add lead
                  </button>
                ) : (
                  <span>No {col.label.toLowerCase()} deals</span>
                )}
              </div>
            )}

            {col.items.slice(0, 25).map((c) => (
              <button
                key={c.id}
                type="button"
                className={`fh-build-pipeline-card is-stage-${col.tone}`}
                onClick={() => onOpenJob(c.id)}
              >
                <div className="fh-build-pipeline-card__top">
                  <span className="fh-build-pipeline-card__name" title={c.name || 'Untitled'}>
                    {c.name || 'Untitled'}
                  </span>
                  <span className="fh-build-pipeline-card__amount">{money(c.amount || 0)}</span>
                </div>
                <div className="fh-build-pipeline-card__meta">
                  <span className="fh-build-pipeline-card__sub">
                    {c.job_title || c.job_type || '—'}
                  </span>
                  {(c.updated_at || c.created_at) && (
                    <span className="fh-build-pipeline-card__time">
                      {relTime(c.updated_at || c.created_at)}
                    </span>
                  )}
                </div>
                <ChevronRight size={13} className="fh-build-pipeline-card__chev" />
              </button>
            ))}

            {col.items.length > 25 && (
              <div className="fh-build-pipeline-col__more">
                + {col.items.length - 25} more
              </div>
            )}
          </div>
        </article>
      ))}
    </section>
  )
}
