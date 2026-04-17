export default function Wordmark({
  inverse = false,
  size = '1rem',
  tagline = false,
  tag = 'FIELD OPERATIONS PLATFORM'
}) {
  return (
    <span
      className={`fh-wordmark-stack${inverse ? ' fh-wordmark-stack--inverse' : ''}`}
      aria-label="Fieldhorse — Field Operations Platform"
    >
      <span className="fh-wordmark" style={{ fontSize: size }}>
        <span className="field">FIELD</span><span className="horse">HORSE</span>
      </span>
      {tagline && <span className="fh-tagline">{tag}</span>}
    </span>
  )
}
