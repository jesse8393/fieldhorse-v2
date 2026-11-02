import { Link } from 'react-router-dom'
import { ArrowRight, CalendarDays, Camera, FileText, Play, Wallet } from 'lucide-react'
import WelcomeFilm from '../components/experience/WelcomeFilm.tsx'
import BrandMark from '../components/experience/BrandMark.tsx'
import { QUICK_GUIDES } from '../lib/quickGuides.ts'
import './landing.css'

const FEATURES = [
  { icon: FileText, title: 'From conversation to proposal.', body: 'Keep customers, scope, and estimates together. Pick up exactly where you left off.' },
  { icon: CalendarDays, title: 'A clear plan for everyone.', body: 'See upcoming visits and assigned work. Give every job a place in your day.' },
  { icon: Wallet, title: 'Know where money stands.', body: 'Review invoices and recorded payments. Follow outstanding balances back to each job.' }
]

export default function Landing() {
  return (
    <main className="fh-landing">
      <a className="fh-experience-skip" href="#landing-title">Skip to content</a>
      <header className="fh-landing-header">
        <BrandMark />
        <nav aria-label="Welcome navigation">
          <Link className="fh-landing-guide-link" to="/learn">Quick guides</Link>
          <Link className="fh-landing-secondary" to="/login">Sign in<ArrowRight size={16} aria-hidden="true" /></Link>
        </nav>
      </header>
      <section className="fh-landing-hero" aria-labelledby="landing-title">
        <div className="fh-landing-hero__copy">
          <p className="fh-landing-eyebrow"><span aria-hidden="true" />Built for your working day</p>
          <h1 id="landing-title" tabIndex={-1}>Good work.<br /><span>Less busywork.</span></h1>
          <p className="fh-landing-intro">Jobs, schedules, customers, and invoices together. Keep work moving from wherever you work.</p>
          <div className="fh-landing-actions">
            <Link className="fh-landing-primary" to="/login?mode=signup">Create a free account<ArrowRight size={18} aria-hidden="true" /></Link>
            <Link className="fh-landing-text-link" to="/learn">See how it works<Play size={15} aria-hidden="true" /></Link>
          </div>
          <p className="fh-landing-note">Free during early access.</p>
        </div>
        <div className="fh-landing-hero__visual">
          <WelcomeFilm />
          <div className="fh-landing-image-caption"><span>A FieldHorse welcome film</span><span>01 / Fieldwork</span></div>
        </div>
      </section>
      <section className="fh-landing-workspace" aria-labelledby="landing-workspace-title">
        <div className="fh-landing-workspace__copy">
          <p className="fh-landing-eyebrow">A little more breathing room</p>
          <h2 id="landing-workspace-title">Open your day.<br />Know your next move.</h2>
          <p>Upcoming visits. Jobs needing attention. A quick place for notes and photos. Start with what matters now.</p>
          <Link className="fh-landing-text-link" to="/learn?guide=day">Explore your daily workflow<ArrowRight size={18} aria-hidden="true" /></Link>
        </div>
        <div className="fh-landing-product-frame">
          <div className="fh-landing-product-frame__bar"><span>fieldhorse.</span><span>Sample workspace</span></div>
          <img src="/media/fieldhorse-today.webp" alt="FieldHorse Today showing upcoming visits and work needing attention in a sample workspace" width="1280" height="960" loading="lazy" decoding="async" />
        </div>
      </section>
      <section className="fh-landing-features" aria-label="What you can do">
        {FEATURES.map(({ icon: Icon, title, body }, index) => <article key={title}>
          <div className="fh-landing-feature__meta"><Icon size={22} aria-hidden="true" /><span>0{index + 1}</span></div>
          <h2>{title}</h2><p>{body}</p>
        </article>)}
      </section>
      <section className="fh-landing-guides" aria-labelledby="landing-guides-title">
        <div className="fh-landing-section-heading"><div><p className="fh-landing-eyebrow">Find your rhythm</p><h2 id="landing-guides-title">A few minutes. A better start.</h2></div><Link className="fh-landing-text-link" to="/learn">All quick guides<ArrowRight size={18} aria-hidden="true" /></Link></div>
        <div className="fh-landing-guide-grid">{QUICK_GUIDES.map((guide, index) => <Link className="fh-landing-guide-card" to={`/learn?guide=${guide.id}`} key={guide.id}>
          <div className="fh-landing-guide-card__top"><span>0{index + 1}</span>{index === 0 ? <FileText size={22} aria-hidden="true" /> : index === 1 ? <CalendarDays size={22} aria-hidden="true" /> : <Camera size={22} aria-hidden="true" />}</div>
          <h3>{guide.title}</h3><p>{guide.description}</p><span className="fh-landing-guide-card__action">Watch guide<ArrowRight size={16} aria-hidden="true" /></span>
        </Link>)}</div>
      </section>
      <footer className="fh-landing-footer"><BrandMark /><p>Your work. In one place.</p><nav aria-label="Legal"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav></footer>
    </main>
  )
}
