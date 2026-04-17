// Fieldhorse icon system — 24px viewBox, 1.5px stroke, currentColor
// Unified export. <Icon name="home" size={22} />

const ICONS = {
  // Nav
  home: (
    <>
      <path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-4v-6h-6v6H5a1 1 0 0 1-1-1z" />
    </>
  ),
  jobs: (
    <>
      <rect x="3" y="6" width="18" height="14" rx="1.8" />
      <path d="M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6" />
      <path d="M3 12h18" />
    </>
  ),
  notes: (
    <>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M15 3v3h3" />
      <path d="M9 11h7M9 15h7M9 19h4" />
    </>
  ),
  schedule: (
    <>
      <rect x="3.5" y="5" width="17" height="15" rx="1.6" />
      <path d="M3.5 9h17" />
      <path d="M8 3v4M16 3v4" />
      <circle cx="8" cy="14" r="0.9" fill="currentColor" />
      <circle cx="12" cy="14" r="0.9" fill="currentColor" />
    </>
  ),
  more: (
    <>
      <circle cx="5" cy="12" r="1.5" fill="currentColor" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" />
      <circle cx="19" cy="12" r="1.5" fill="currentColor" />
    </>
  ),

  // Actions
  plus: (
    <>
      <path d="M12 5v14M5 12h14" />
    </>
  ),
  check: (
    <>
      <path d="M5 12.5 10 17 19 7" />
    </>
  ),
  x: (
    <>
      <path d="M6 6l12 12M18 6 6 18" />
    </>
  ),
  edit: (
    <>
      <path d="M4 15.5 4 20h4.5L19 9.5 14.5 5z" />
      <path d="M13.5 6l4.5 4.5" />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V4h6v3" />
      <path d="M6 7l1 13h10l1-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  chevron: (
    <>
      <path d="M9 6l6 6-6 6" />
    </>
  ),
  chevronDown: (
    <>
      <path d="M6 9l6 6 6-6" />
    </>
  ),
  arrowRight: (
    <>
      <path d="M5 12h14" />
      <path d="M13 6l6 6-6 6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.5" />
      <path d="M16 16l4 4" />
    </>
  ),
  filter: (
    <>
      <path d="M4 6h16M7 12h10M10 18h4" />
    </>
  ),
  camera: (
    <>
      <path d="M4 8h3l2-2h6l2 2h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="3.5" />
    </>
  ),
  upload: (
    <>
      <path d="M12 4v12" />
      <path d="M6 10l6-6 6 6" />
      <path d="M4 20h16" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v12" />
      <path d="M6 14l6 6 6-6" />
      <path d="M4 4h16" />
    </>
  ),
  phone: (
    <>
      <path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h2.2a1 1 0 0 1 1 .7l1.2 3.2a1 1 0 0 1-.2 1L8.2 10.4a13 13 0 0 0 5.4 5.4l1.5-1.5a1 1 0 0 1 1-.2l3.2 1.2a1 1 0 0 1 .7 1v2.2a1.5 1.5 0 0 1-1.5 1.5C10.3 20 4 13.7 4 5.5z" />
    </>
  ),
  message: (
    <>
      <path d="M4 5h16v11H8l-4 4z" />
    </>
  ),
  mail: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="1.5" />
      <path d="M3 7l9 7 9-7" />
    </>
  ),
  mic: (
    <>
      <rect x="9.5" y="3" width="5" height="11" rx="2.5" />
      <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
      <path d="M12 18v3" />
    </>
  ),

  // Weather
  sun: (
    <>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4" />
    </>
  ),
  cloud: (
    <>
      <path d="M7 18a4 4 0 0 1 0-8 6 6 0 0 1 11.6 2.2A3.5 3.5 0 0 1 17.5 18z" />
    </>
  ),
  rain: (
    <>
      <path d="M7 14a4 4 0 0 1 0-8 6 6 0 0 1 11.6 2.2A3.5 3.5 0 0 1 17.5 14z" />
      <path d="M9 18l-1 2M13 18l-1 2M17 18l-1 2" />
    </>
  ),
  snow: (
    <>
      <path d="M12 3v18M4.5 7.5l15 9M4.5 16.5l15-9" />
    </>
  ),
  fog: (
    <>
      <path d="M4 9h16M4 13h16M6 17h12" />
    </>
  ),

  // Stages
  lead: (
    <>
      <path d="M12 3l2.5 5.3 5.5.6-4 4 1.1 5.6L12 15.8 6.9 18.5 8 12.9 4 8.9l5.5-.6z" />
    </>
  ),
  quote: (
    <>
      <path d="M6 4h9l4 4v12H6z" />
      <path d="M15 4v4h4" />
      <path d="M9 12h7M9 16h5" />
    </>
  ),
  job: (
    <>
      <path d="M4 9l8-5 8 5v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M9 20v-6h6v6" />
    </>
  ),
  invoice: (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  closed: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M8 12l3 3 5-6" />
    </>
  ),
  lost: (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),

  // Tools
  bid: (
    <>
      <path d="M4 20V6a2 2 0 0 1 2-2h9l5 5v11" />
      <path d="M14 4v6h6" />
      <path d="M8 14h8M8 18h5" />
    </>
  ),
  compose: (
    <>
      <path d="M12 3l1.8 3.8L18 8l-3.2 3 .8 4.2L12 13l-3.6 2.2.8-4.2L6 8l4.2-1.2z" />
    </>
  ),
  partner: (
    <>
      <circle cx="9" cy="9" r="3.3" />
      <path d="M3.5 19a5.5 5.5 0 0 1 11 0" />
      <circle cx="17" cy="10" r="2.6" />
      <path d="M15 19a4 4 0 0 1 6 0" />
    </>
  ),
  analytics: (
    <>
      <path d="M4 20V4" />
      <path d="M4 20h16" />
      <path d="M8 16v-4M12 16V8M16 16v-7" />
    </>
  ),
  inspection: (
    <>
      <path d="M6 3h9l3 3v15H6z" />
      <path d="M9 12l2 2 4-4" />
    </>
  ),
  ai: (
    <>
      <path d="M12 3l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" />
      <path d="M18 15l.9 1.8L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-1.2z" />
    </>
  ),

  // Utility
  bolt: (
    <>
      <path d="M13 3 4 14h7l-1 7 9-11h-7z" />
    </>
  ),
  pin: (
    <>
      <path d="M12 21c-4-5.5-6-9-6-12a6 6 0 0 1 12 0c0 3-2 6.5-6 12z" />
      <circle cx="12" cy="9.5" r="2.3" />
    </>
  ),
  dollar: (
    <>
      <path d="M12 3v18" />
      <path d="M16 7.5a3.5 3.5 0 0 0-3.5-2.5h-2a3 3 0 0 0 0 6h3a3 3 0 0 1 0 6h-2A3.5 3.5 0 0 1 8 16.5" />
    </>
  ),
  settings: (
    <>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H5a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h5" />
      <path d="M14 8l4 4-4 4" />
      <path d="M18 12H9" />
    </>
  )
}

export default function Icon({ name, size = 22, strokeWidth = 1.5, className = '', style, ...rest }) {
  const content = ICONS[name]
  if (!content) return null
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      style={style}
      aria-hidden="true"
      {...rest}
    >
      {content}
    </svg>
  )
}
