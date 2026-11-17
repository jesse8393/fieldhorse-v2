// mobile/lib/apiBase.ts
//
// The web site that serves the /api functions, the customer document
// pages (/p/{token}) and the privacy and terms pages. A build can point
// elsewhere with EXPO_PUBLIC_API_BASE_URL; without it the app talks to
// the live site, never to a retired domain.

export const DEFAULT_API_BASE = 'https://animated-kheer-db7c2c.netlify.app'

export const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL || DEFAULT_API_BASE).replace(/\/+$/, '')
