export default function Wordmark({ inverse = false, size = '1rem' }) {
  return (
    <span
      className={`fh-wordmark-stack${inverse ? ' fh-wordmark-stack--inverse' : ''}`}
      aria-label="Fieldhorse"
    >
      <span className="fh-wordmark" style={{ fontSize: size }}>
        <span className="field">FIELD</span><span className="horse">HORSE</span>
      </span>
    </span>
  )
}
