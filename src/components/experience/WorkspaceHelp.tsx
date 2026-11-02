import { Link } from 'react-router-dom'
import { ArrowUpRight, BookOpen, ChevronDown } from 'lucide-react'
import './workspace-experience.css'

const HELP = {
  today: { title: 'Make Today work for you', guide: 'day', steps: ['Start with your next visit.', 'Resolve items needing an answer.', 'Capture updates while details stay fresh.'] },
  jobs: { title: 'Keep every job moving', guide: 'job', steps: ['Create a job with clear scope.', 'Add tasks, visits, and project photos.', 'Review progress before your next visit.'] },
  schedule: { title: 'Plan visits with confidence', guide: 'day', steps: ['Choose a date and time.', 'Link visits to their jobs.', 'Review crew assignments before saving.'] },
  money: { title: 'From approved work to payment', guide: 'billing', steps: ['Review approved scope and payment records.', 'Create and preview your invoice.', 'Record payments after receiving funds.'] },
  quotes: { title: 'Build a clear proposal', guide: 'quote', steps: ['Connect a customer and define scope.', 'Review pricing, terms, and exclusions.', 'Preview before sending for approval.'] },
  customers: { title: 'Keep customer details together', guide: 'job', steps: ['Save contact details once.', 'Connect jobs to existing customers.', 'Review related work before reaching out.'] }
} as const

export default function WorkspaceHelp({ topic }: { topic: keyof typeof HELP }) {
  const help = HELP[topic]
  return <details className="fh-workspace-help">
    <summary><BookOpen size={16} aria-hidden="true" /><span>{help.title}</span><ChevronDown size={16} aria-hidden="true" /></summary>
    <div className="fh-workspace-help__body">
      <ol>{help.steps.map(step => <li key={step}>{step}</li>)}</ol>
      <Link to={`/learn?guide=${help.guide}`}>Open quick guide<ArrowUpRight size={16} aria-hidden="true" /></Link>
    </div>
  </details>
}
