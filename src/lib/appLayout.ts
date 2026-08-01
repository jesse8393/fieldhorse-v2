export type AppLayoutMode = 'mobile-frame' | 'prose' | 'responsive'

const RESPONSIVE_ROUTES = new Set([
  '/',
  '/work',
  '/leads',
  '/quotes',
  '/pipeline',
  '/jobs',
  '/clients',
  '/schedule',
  '/compose',
  '/bid',
  '/invoices',
  '/analytics',
  '/subs',
  '/settings',
  '/import',
  '/pour-window',
  '/notes',
  '/activity',
  '/crew',
  '/tasks',
  '/team',
  '/timesheets',
  '/partners',
  '/sub-portal',
  '/templates',
])

const RESPONSIVE_PREFIXES = [
  '/leads/',
  '/quotes/',
  '/jobs/',
  '/clients/',
  '/subs/',
  '/invoices/',
]

/**
 * Resolves the shell width for authenticated routes.
 * Responsive routes still collapse to the mobile frame below 900px in CSS.
 */
export function layoutForPath(pathname: string): AppLayoutMode {
  if (RESPONSIVE_ROUTES.has(pathname)) return 'responsive'
  if (RESPONSIVE_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return 'responsive'
  return 'mobile-frame'
}
