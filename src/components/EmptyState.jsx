// Designed empty state — SVG illustration, Bebas title, DM Sans subtitle,
// optional engraved gold CTA. Use anywhere the list has nothing to show.

const ICONS = {
  pipeline: (
    <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="12" y="20" width="56" height="40" rx="2"/>
      <path d="M12 32 L68 32"/>
      <path d="M24 42 L56 42 M24 50 L48 50"/>
      <path d="M24 20 L24 14 L40 14 L40 20"/>
    </svg>
  ),
  search: (
    <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="34" cy="34" r="18"/>
      <path d="M47 47 L64 64"/>
    </svg>
  ),
  note: (
    <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 12 L52 12 L64 24 L64 68 L20 68 Z"/>
      <path d="M52 12 L52 24 L64 24"/>
      <path d="M28 36 L56 36 M28 46 L56 46 M28 56 L46 56"/>
    </svg>
  ),
  calendar: (
    <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="12" y="18" width="56" height="50" rx="2"/>
      <path d="M12 30 L68 30 M26 12 L26 22 M54 12 L54 22"/>
      <path d="M24 44 L30 44 M38 44 L44 44 M52 44 L58 44 M24 54 L30 54 M38 54 L44 54"/>
    </svg>
  ),
  chart: (
    <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 64 L68 64"/>
      <path d="M20 64 L20 46 M34 64 L34 32 M48 64 L48 40 M62 64 L62 22"/>
      <path d="M12 22 L28 34 L42 26 L68 10"/>
    </svg>
  ),
  crew: (
    <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="28" cy="30" r="10"/>
      <circle cx="56" cy="34" r="8"/>
      <path d="M10 66 C12 52 22 46 28 46 C34 46 44 52 46 66"/>
      <path d="M44 66 C46 56 52 50 56 50 C60 50 66 56 68 66"/>
    </svg>
  ),
  receipt: (
    <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 10 L62 10 L62 70 L54 66 L46 70 L38 66 L30 70 L22 66 L18 70 Z"/>
      <path d="M28 26 L52 26 M28 36 L52 36 M28 46 L42 46"/>
      <path d="M46 54 L52 54"/>
    </svg>
  ),
  message: (
    <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 20 L66 20 L66 56 L40 56 L28 66 L28 56 L14 56 Z"/>
      <path d="M26 32 L54 32 M26 42 L46 42"/>
    </svg>
  ),
  briefing: (
    <svg viewBox="0 0 80 80" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20 L68 20 L68 56 L12 56 Z"/>
      <path d="M24 30 L56 30 M24 40 L50 40 M24 50 L40 50"/>
      <path d="M12 20 L40 10 L68 20"/>
    </svg>
  )
}

export default function EmptyState({
  icon = 'pipeline',
  code,
  title,
  sub,
  action,
  onAction
}) {
  return (
    <div className="fh-emptystate" role="status">
      <div className="fh-emptystate__glyph" aria-hidden="true">
        {typeof icon === 'string' ? (ICONS[icon] || ICONS.pipeline) : icon}
      </div>
      {code && <span className="fh-emptystate__code">{code}</span>}
      <h3 className="fh-emptystate__title">{title}</h3>
      {sub && <p className="fh-emptystate__sub">{sub}</p>}
      {action && onAction && (
        <button type="button" className="fh-btn fh-btn--primary fh-emptystate__cta" onClick={onAction}>
          {action}
        </button>
      )}
    </div>
  )
}
