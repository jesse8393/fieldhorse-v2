import { Check } from 'lucide-react'
import './workspace-experience.css'

export default function SetupProgress({ company, services, location }: { company: boolean; services: boolean; location: boolean }) {
  return <nav className="fh-setup-progress" aria-label="Workspace setup sections">
    {[{ id: 'company', label: 'Company', done: company }, { id: 'services', label: 'Services', done: services }, { id: 'location', label: 'Location', done: location }].map((step, index) => <a key={step.id} href={`#setup-${step.id}`} onClick={() => document.getElementById(`setup-${step.id}`)?.focus({ preventScroll: true })}>
      <span className={step.done ? 'is-ready' : ''} aria-hidden="true">{step.done ? <Check size={16} /> : index + 1}</span>
      <span>{step.label}<small>{step.done ? 'Added' : step.id === 'location' ? 'Optional' : 'Required'}</small></span>
    </a>)}
  </nav>
}
