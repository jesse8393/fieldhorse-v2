import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, Check, FileText, Wallet } from 'lucide-react'
import './landing.css'

const FEATURES = [
  { icon: FileText, title: 'Scope to proposal', body: 'Build estimates, review line items, and send proposals from your phone.' },
  { icon: CalendarDays, title: 'Know what happens next', body: 'Keep visits, crew schedules, and job updates together.' },
  { icon: Wallet, title: 'Keep money in view', body: 'Track invoices, record payments, and see outstanding balances.' }
]

export default function Landing() {
  return (
    <main className="fh-landing">
      <header className="fh-landing-header">
        <Link className="fh-landing-wordmark" to="/" aria-label="Fieldhorse home">
          <svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 25V4h20M10 25V10h15" stroke="currentColor" strokeWidth="2.5" /></svg>
          <span>fieldhorse.</span>
        </Link>
        <Link className="fh-landing-secondary" to="/login">Sign in</Link>
      </header>

      <section className="fh-landing-hero" aria-labelledby="landing-title">
        <p className="fh-landing-eyebrow">Field operations for contractors</p>
        <h1 id="landing-title">Run the whole business<br /><span>from your pocket.</span></h1>
        <p className="fh-landing-intro">Customers, estimates, jobs, schedules, and invoices. One place to keep work moving.</p>
        <div className="fh-landing-actions">
          <Link className="fh-landing-primary" to="/login?mode=signup">Create a free account<ArrowRight size={20} aria-hidden="true" /></Link>
          <Link className="fh-landing-secondary" to="/login">Sign in</Link>
        </div>
        <p className="fh-landing-note">Free during early access.</p>
      </section>

      <section className="fh-landing-preview" aria-labelledby="landing-preview-title">
        <div className="fh-landing-preview__heading"><h2 id="landing-preview-title">Your work, at a glance</h2><span>Sample workspace</span></div>
        <div className="fh-landing-preview__columns">
          <div>
            <p className="fh-landing-eyebrow">Today</p>
            <h3>Ready for tomorrow’s pour.</h3>
            <p>Oak Street patio</p>
            <ul className="fh-landing-checklist">
              <li><Check size={18} aria-hidden="true" />Confirm concrete delivery</li>
              <li><Check size={18} aria-hidden="true" />Review access with homeowner</li>
            </ul>
          </div>
          <div className="fh-landing-visit">
            <CalendarDays size={22} aria-hidden="true" /><p>Next visit</p>
            <h3>Site preparation</h3><p>Tomorrow · 8:30 AM</p>
            <span>Schedule and job details together</span>
          </div>
        </div>
        <p className="fh-landing-preview__caption">Illustrative records. Your workspace shows your own jobs.</p>
      </section>

      <section className="fh-landing-features" aria-label="What you can do">
        {FEATURES.map(({ icon: Icon, title, body }) => <article key={title}>
          <Icon size={24} aria-hidden="true" /><h2>{title}</h2><p>{body}</p>
        </article>)}
      </section>
      <section className="fh-landing-team" aria-labelledby="landing-team-title">
        <h2 id="landing-team-title">Start solo. Bring your crew.</h2>
        <p>Add team members when you need them. Keep assigned work and timesheets alongside your jobs.</p>
      </section>
      <footer className="fh-landing-footer">
        <span>Fieldhorse. Field operations for contractors.</span>
        <nav aria-label="Legal"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav>
      </footer>
    </main>
  )
}
