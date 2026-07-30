// routePrefetch, speed pass: warm lazy route chunks on nav hover.
//
// Every route below is lazy-loaded in App.tsx; the first visit normally
// pays a chunk download + parse on click. Hovering a sidebar link is a
// strong intent signal, so we fire the same dynamic import() the router
// would, Vite dedupes identical specifiers into the same chunk, so this
// adds zero bundle weight and the router finds the module already cached.
//
// Fire-and-forget: failures are ignored (the router import will retry
// with real error handling on actual navigation).

const ROUTE_CHUNKS: Record<string, () => Promise<unknown>> = {
  '/work':        () => import('../screens/Work.tsx'),
  // Legacy board paths redirect to /work, warm the Work chunk.
  '/leads':       () => import('../screens/Work.tsx'),
  '/quotes':      () => import('../screens/Work.tsx'),
  '/pipeline':    () => import('../screens/Work.tsx'),
  '/jobs':        () => import('../screens/Work.tsx'),
  '/clients':     () => import('../screens/Clients.tsx'),
  '/notes':       () => import('../screens/Notes.tsx'),
  '/schedule':    () => import('../screens/Schedule.tsx'),
  '/activity':    () => import('../screens/Activity.tsx'),
  '/bid':         () => import('../screens/Bid.tsx'),
  '/compose':     () => import('../screens/Compose.tsx'),
  '/analytics':   () => import('../screens/Analytics.tsx'),
  '/invoices':    () => import('../screens/Invoices.tsx'),
  '/settings':    () => import('../screens/Settings.tsx'),
  '/pour-window': () => import('../screens/PourWindow.tsx'),
  '/subs':        () => import('../screens/Subs.tsx'),
  '/partners':    () => import('../screens/Partners.tsx'),
  '/team':        () => import('../screens/Team.tsx'),
  '/crew':        () => import('../screens/Crew.tsx'),
  '/tasks':       () => import('../screens/Tasks.tsx'),
  '/timesheets':  () => import('../screens/Timesheets.tsx'),
  '/sub-portal':  () => import('../screens/SubPortal.tsx'),
  '/import':      () => import('../screens/Importer.tsx')
}

const warmed = new Set<string>()

/** Prefetch the lazy chunk for a nav destination ('/jobs?view=doing' ok). */
export function prefetchRoute(to: string) {
  const path = to.split('?')[0].split('#')[0]
  if (warmed.has(path)) return
  const load = ROUTE_CHUNKS[path]
  if (!load) return
  warmed.add(path)
  load().catch(() => { warmed.delete(path) })
}
