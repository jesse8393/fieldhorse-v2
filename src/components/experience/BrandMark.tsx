import { Link } from 'react-router-dom'

export default function BrandMark() {
  return <Link className="fh-landing-wordmark" to="/" aria-label="Fieldhorse home">
    <svg viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 25V4h20M10 25V10h15" stroke="currentColor" strokeWidth="2.5" /></svg>
    <span>fieldhorse.</span>
  </Link>
}
