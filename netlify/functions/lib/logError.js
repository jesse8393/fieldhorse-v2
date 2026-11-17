// One structured line for a failed database call or step in a function.
//
// Raw Supabase error objects must not be logged: a unique violation's
// details read Key (email)=(...), and a hint or a returned row can carry a
// customer's name, phone or address. This keeps the error code and the
// message with record values taken out (src/lib/errorReport.js), plus the
// company and Netlify's request id so a failure can be tied to an account.
//
//   logError('webhook-lead', 'insert failed', insertErr, { org_id: orgId, request_id })
import { cleanMessage } from '../../../src/lib/errorReport.js'

export function logError(scope, what, error, { org_id = null, request_id = null } = {}) {
  const raw = typeof error === 'string' ? error : error?.message
  const line = {
    scope,
    what,
    code: typeof error?.code === 'string' ? error.code : null,
    message: cleanMessage(typeof raw === 'string' ? raw : String(raw ?? ''))
  }
  if (org_id) line.org_id = String(org_id)
  if (request_id) line.request_id = String(request_id)
  console.error(JSON.stringify(line))
}

/** Netlify's id for this request, for logError. */
export function requestId(request) {
  return request?.headers?.get?.('x-nf-request-id') || null
}
