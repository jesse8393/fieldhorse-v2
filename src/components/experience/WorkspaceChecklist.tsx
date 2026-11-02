import { Link } from 'react-router-dom'
import { ArrowUpRight, Check, Circle } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { useMembership } from '../../contexts/MembershipContext.tsx'
import { useCompanyJobs, useUpcomingEvents } from '../../lib/queries.ts'
import './workspace-experience.css'

function ChecklistRecords() {
  const { user } = useAuth()
  const { profile, loading: profileLoading, error: profileError, refresh: refreshProfile } = useProfile()
  const jobs = useCompanyJobs()
  const visits = useUpcomingEvents(user?.id)
  const items = [
    { title: 'Make it your workspace', detail: 'Review your company name and logo.', href: '/settings', ready: Boolean(profile?.company_name?.trim()), pending: profileLoading, failed: Boolean(profileError), retry: refreshProfile },
    { title: 'Give your work a home', detail: 'Add a job with customer details.', href: jobs.data?.length ? '/jobs' : '/jobs/new', ready: Boolean(jobs.data?.length), pending: jobs.isPending, failed: jobs.isError, retry: jobs.refetch },
    { title: 'Plan your next visit', detail: 'Connect upcoming work to your calendar.', href: visits.data?.length ? '/schedule' : '/schedule/new', ready: Boolean(visits.data?.length), pending: visits.isPending, failed: visits.isError, retry: visits.refetch }
  ]
  const ready = items.filter(item => item.ready && !item.failed && !item.pending).length
  const unknown = items.some(item => item.failed || item.pending)
  return <section id="workspace-checklist" className="fh-workspace-checklist" aria-labelledby="workspace-checklist-title">
    <div className="fh-workspace-checklist__heading"><div><p className="fh-workspace-eyebrow">Your workspace</p><h2 id="workspace-checklist-title">Ready for your next workday.</h2></div><span>{unknown ? 'Checking your workspace' : `${ready} of 3 ready`}</span></div>
    <ol>{items.map(item => <li key={item.title}>
      <span className={`fh-workspace-checklist__mark${item.ready && !item.pending && !item.failed ? ' is-ready' : ''}`} aria-hidden="true">{item.ready && !item.pending && !item.failed ? <Check size={18} /> : <Circle size={18} />}</span>
      <div><h3>{item.title}</h3><p>{item.detail}</p><span className="fh-workspace-checklist__state">{item.failed ? 'Could not check records' : item.pending ? 'Checking records' : item.ready ? 'Ready' : 'Next step'}</span></div>
      {item.failed ? <button type="button" onClick={() => { void item.retry?.() }} aria-label={`Retry ${item.title.toLowerCase()}`}>Retry</button> : <Link to={item.href} aria-label={`${item.ready ? 'Review' : 'Start'}: ${item.title}`}><span>{item.ready ? 'Review' : 'Start'}</span><ArrowUpRight size={16} aria-hidden="true" /></Link>}
    </li>)}</ol>
    <p className="fh-workspace-checklist__note">Checklist reflects saved records and upcoming visits.</p>
  </section>
}

export default function WorkspaceChecklist() {
  const { user } = useAuth()
  const { role, loading } = useMembership()
  if (!user || loading || !role || !['owner', 'admin', 'manager'].includes(role)) return null
  return <ChecklistRecords />
}
