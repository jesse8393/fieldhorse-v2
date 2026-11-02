import { Link } from 'react-router-dom'
import { ArrowUpRight, CalendarPlus, Camera, Plus } from 'lucide-react'
import { openCapture } from '../../lib/captureAttach.ts'
import './today-actions.css'

export default function TodayQuickActions({ showNewJob = true }: { showNewJob?: boolean }) {
  return <section className="fh-today-actions" aria-label="Daily shortcuts">
    <div className="fh-today-actions__heading"><span>Keep work moving</span><Link to="/learn">Quick guides<ArrowUpRight size={14} aria-hidden="true" /></Link></div>
    <div className="fh-today-actions__items">
      {showNewJob && <Link to="/jobs/new"><Plus size={20} aria-hidden="true" /><span>New job</span></Link>}
      <Link to="/schedule/new"><CalendarPlus size={20} aria-hidden="true" /><span>Add visit</span></Link>
      <button type="button" onClick={() => openCapture()}><Camera size={20} aria-hidden="true" /><span>Capture update</span></button>
    </div>
  </section>
}
