// The browser tab title for each signed in screen (WCAG 2.4.2): the
// screen's name, then the app's, so every screen reads differently in the
// tab list, the history and to a screen reader. AppShell sets it on each
// route change and reads the name out in a polite live region.

export const APP_NAME = 'Fieldhorse'

// First match wins, so a record's own screens come before the record.
const SCREENS: Array<[RegExp, string]> = [
  [/^\/$/, 'Today'],
  [/^\/(jobs|work|pipeline)$/, 'Jobs'],
  [/^\/jobs\/new$/, 'New job'],
  [/^\/jobs\/[^/]+\/payment$/, 'Log payment'],
  [/^\/jobs\/[^/]+\/complete$/, 'Mark complete'],
  [/^\/jobs\/[^/]+\/follow-up$/, 'Follow up'],
  [/^\/jobs\/[^/]+\/partner$/, 'Invite a partner'],
  [/^\/jobs\/[^/]+\/more$/, 'More for this job'],
  [/^\/jobs\/[^/]+$/, 'Job'],
  [/^\/leads$/, 'Leads'],
  [/^\/leads\/new$/, 'New lead'],
  [/^\/leads\/[^/]+$/, 'Lead'],
  [/^\/quotes$/, 'Quotes'],
  [/^\/quotes\/new$/, 'New quote'],
  [/^\/quotes\/[^/]+\/terms$/, 'Scope and terms'],
  [/^\/quotes\/[^/]+\/preview$/, 'Proposal preview'],
  [/^\/quotes\/[^/]+\/approve$/, 'Approve quote'],
  [/^\/quotes\/[^/]+$/, 'Quote'],
  [/^\/invoices$/, 'Money'],
  [/^\/invoices\/new$/, 'New invoice'],
  [/^\/invoices\/[^/]+\/payment$/, 'Collect payment'],
  [/^\/invoices\/[^/]+\/edit$/, 'Edit invoice'],
  [/^\/invoices\/[^/]+\/remind$/, 'Send a reminder'],
  [/^\/invoices\/[^/]+$/, 'Invoice'],
  [/^\/clients$/, 'Customers'],
  [/^\/clients\/new$/, 'New customer'],
  [/^\/clients\/merge$/, 'Merge customers'],
  [/^\/clients\/[^/]+\/statement$/, 'Customer statement'],
  [/^\/clients\/[^/]+$/, 'Customer'],
  [/^\/schedule$/, 'Schedule'],
  [/^\/schedule\/new$/, 'New event'],
  [/^\/schedule\/[^/]+\/edit$/, 'Edit event'],
  [/^\/new$/, 'New'],
  [/^\/capture$/, 'Capture'],
  [/^\/search$/, 'Search'],
  [/^\/workspace$/, 'Workspace'],
  [/^\/notifications$/, 'Notifications'],
  [/^\/inbox(\/.*)?$/, 'Inbox'],
  [/^\/notes$/, 'Notes'],
  [/^\/activity$/, 'Activity'],
  [/^\/analytics$/, 'Reports'],
  [/^\/pour-window$/, 'Pour window'],
  [/^\/bid$/, 'Bid'],
  [/^\/compose$/, 'Draft a message'],
  [/^\/import$/, 'Import'],
  [/^\/settings$/, 'Settings'],
  [/^\/templates$/, 'Templates'],
  [/^\/team\/invite$/, 'Invite a teammate'],
  [/^\/team$/, 'Team'],
  [/^\/crew$/, 'Crew'],
  [/^\/timesheets$/, 'Timesheets'],
  [/^\/tasks$/, 'Tasks'],
  [/^\/subs\/new$/, 'New sub'],
  [/^\/subs\/[^/]+$/, 'Sub'],
  [/^\/subs$/, 'Subs'],
  [/^\/partners$/, 'Partners'],
  [/^\/sub-portal\/profile$/, 'Sub portal profile'],
  [/^\/sub-portal$/, 'Sub portal'],
  [/^\/miles\/new$/, 'Log miles'],
  [/^\/learn$/, 'Learn'],
]

/** The screen's own name, or null for a path no signed in screen owns. */
export function screenName(pathname: string): string | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  for (const [pattern, name] of SCREENS) if (pattern.test(path)) return name
  return null
}

/** "Quotes · Fieldhorse", or the app's name alone for an unknown path. */
export function pageTitle(pathname: string): string {
  const name = screenName(pathname)
  return name ? `${name} · ${APP_NAME}` : APP_NAME
}
