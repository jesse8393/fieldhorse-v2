import { useEffect, useRef, useState } from 'react'
import { Play } from 'lucide-react'

/** Motion downloads only after deliberate play. A still works on every connection. */
export default function WelcomeFilm() {
  const [requested, setRequested] = useState(false)
  const [failed, setFailed] = useState(false)
  const videoRef = useRef<HTMLVideoElement>(null)
  const retryRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (failed) retryRef.current?.focus({ preventScroll: true })
    else if (requested) videoRef.current?.focus({ preventScroll: true })
  }, [requested, failed])
  return <figure className="fh-welcome-film" aria-label="Construction welcome film">
    <picture><source srcSet="/media/fieldhorse-craft-small.webp" media="(max-width: 600px)" /><img src="/media/fieldhorse-craft.webp" alt="Two builders reviewing plans inside a timber framed home" width="1344" height="752" fetchPriority="high" decoding="async" /></picture>
    {requested && !failed ? <video ref={videoRef} tabIndex={0} className="fh-welcome-film__video" controls autoPlay playsInline muted preload="none" poster="/media/fieldhorse-craft.webp" aria-label="FieldHorse welcome film" onError={() => setFailed(true)}>
      <source src="/media/fieldhorse-welcome.mp4" type="video/mp4" onError={() => setFailed(true)} />
      <track kind="captions" src="/media/fieldhorse-welcome.vtt" srcLang="en" label="Visual description" />
    </video> : <button ref={retryRef} className="fh-welcome-film__play" type="button" onClick={() => { setFailed(false); setRequested(true) }}><Play size={16} fill="currentColor" aria-hidden="true" />{failed ? 'Retry welcome film' : 'Play welcome film'}<span>0:08</span></button>}
    {failed && <p className="fh-welcome-film__error" role="status">Video unavailable. You can keep exploring.</p>}
  </figure>
}
