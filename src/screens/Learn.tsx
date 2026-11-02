import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Play } from 'lucide-react'
import BrandMark from '../components/experience/BrandMark.tsx'
import { QUICK_GUIDES, quickGuide } from '../lib/quickGuides.ts'
import './landing.css'
import './learn.css'

function GuidePlayer({ id, title }: { id: string; title: string }) {
  const [started, setStarted] = useState(false)
  const [failed, setFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (failed) retryRef.current?.focus({ preventScroll: true })
    else if (started) videoRef.current?.focus({ preventScroll: true })
  }, [started, failed])
  return <div className="fh-guide-player">
    {started && !failed ? <video ref={videoRef} tabIndex={0} controls autoPlay playsInline preload="none" poster={`/media/guide-${id}.webp`} aria-label={`${title} video`} onError={() => setFailed(true)}>
      <source src={`/media/guide-${id}.mp4`} type="video/mp4" onError={() => setFailed(true)} />
      <track kind="captions" src={`/media/guide-${id}.vtt`} srcLang="en" label="English" default />
    </video> : <button ref={retryRef} type="button" onClick={() => { setFailed(false); setStarted(true) }} aria-label={`${failed ? 'Retry' : 'Play'} ${title}`}>
      <img src={`/media/guide-${id}.webp`} alt="Recorded FieldHorse sample workspace" width="720" height="1280" />
      <span className="fh-guide-player__play"><Play size={20} fill="currentColor" aria-hidden="true" />{failed ? 'Retry guide' : 'Play guide'}</span>
    </button>}
    {failed && <p role="status">Video unavailable. Follow written steps alongside.</p>}
  </div>
}

export default function Learn() {
  const [params, setParams] = useSearchParams()
  const guide = quickGuide(params.get('guide'))
  const headingRef = useRef<HTMLHeadingElement>(null)
  const firstGuide = useRef(guide.id)
  useEffect(() => {
    if (firstGuide.current !== guide.id) headingRef.current?.focus({ preventScroll: true })
    firstGuide.current = guide.id
  }, [guide.id])
  return <main className="fh-landing fh-learn">
    <a className="fh-experience-skip" href="#guide-title">Skip to guide</a>
    <header className="fh-landing-header"><BrandMark /><Link className="fh-landing-secondary" to="/"><ArrowLeft size={16} aria-hidden="true" />Back to FieldHorse</Link></header>
    <div className="fh-learn-intro"><p className="fh-landing-eyebrow">Make yourself at home</p><h1>Small steps.<br /><span>A confident start.</span></h1><p>Three quick guides through actual FieldHorse screens. Follow at your own pace.</p></div>
    <nav className="fh-guide-nav" aria-label="Quick guides">{QUICK_GUIDES.map((item, index) => <button key={item.id} type="button" aria-current={item.id === guide.id ? 'page' : undefined} onClick={() => setParams({ guide: item.id })}><span>0{index + 1}</span>{item.title}<ArrowRight size={18} aria-hidden="true" /></button>)}</nav>
    <section className="fh-guide-detail" aria-labelledby="guide-title">
      <div className="fh-guide-recording"><GuidePlayer key={guide.id} id={guide.id} title={guide.title} /><p>Recorded with sample records.</p></div>
      <div className="fh-guide-copy"><p className="fh-landing-eyebrow">Your quick guide</p><h2 id="guide-title" ref={headingRef} tabIndex={-1}>{guide.title}</h2><p>{guide.description}</p>
        <ol className="fh-guide-steps">{guide.steps.map((step, index) => <li key={step.title}><span aria-hidden="true">0{index + 1}</span><div><h3>{step.title}</h3><p>{step.detail}</p></div></li>)}</ol>
        <Link className="fh-landing-primary" to={guide.href}>{guide.action}<ArrowRight size={18} aria-hidden="true" /></Link><p className="fh-guide-access-note">Your role determines available tools.</p>
      </div>
    </section>
    <footer className="fh-landing-footer"><BrandMark /><p>Your work. In one place.</p><nav aria-label="Legal"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link></nav></footer>
  </main>
}
