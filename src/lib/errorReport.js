/** Shared by the browser reporter (reportClientError.ts) and the
 * /api/client-error function. A report carries four short fields and
 * nothing from a customer's records: record ids and link tokens leave the
 * route, and emails, phone numbers, amounts and database key values leave
 * the message.
 * @typedef {{ route: string, build: string, message: string, kind: string }} ErrorReport
 */
const KINDS = new Set(['route', 'app', 'window', 'promise', 'query', 'mutation'])
const text = (value) => (typeof value === 'string' ? value : '')

/** The path alone, with any segment that could be an id or token as :id. */
export function cleanRoute(value) {
  const raw = text(value).trim()
  if (!raw.startsWith('/') || raw.startsWith('//')) return ''
  return raw
    .split(/[?#]/)[0]
    .split('/')
    .map((segment) => (segment && (/\d/.test(segment) || segment.length > 24) ? ':id' : segment))
    .join('/')
    .replace(/[^A-Za-z0-9/:_-]/g, '')
    .slice(0, 120)
}

/** The first line of the message, capped, with record values taken out. */
export function cleanMessage(value) {
  return text(value)
    .split('\n')[0]
    .replace(/=\([^)]*\)/g, '=([value])')
    .replace(/[^\s@'"()]+@[^\s@'"()]+/g, '[email]')
    .replace(/(?<![A-Za-z_])\+?\d[\d.,:\s()-]*\d/g, (run) => ((run.match(/\d/g) || []).length >= 3 ? '[number]' : run))
    .trim()
    .slice(0, 300)
}

/** @returns {ErrorReport} */
export function cleanErrorReport(input) {
  const body = input && typeof input === 'object' ? input : {}
  return {
    route: cleanRoute(body.route),
    build: text(body.build).replace(/[^A-Za-z0-9 .:·_-]/g, '').trim().slice(0, 40),
    message: cleanMessage(body.message),
    kind: KINDS.has(body.kind) ? body.kind : 'other'
  }
}
