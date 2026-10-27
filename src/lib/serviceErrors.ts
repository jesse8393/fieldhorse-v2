// Public messages describe recovery without exposing provider or database details.
type ServiceError = { message?: unknown; code?: unknown; status?: unknown }

export function aiDraftError(error: unknown): string {
  const detail = error as ServiceError | null
  const code = String(detail?.code || detail?.message || '').toLowerCase()
  const status = Number(detail?.status)
  if (status === 401 || code.includes('invalid_token') || code.includes('missing_token')) {
    return 'Your session needs to reconnect before AI drafting can continue. Keep your message here and try again after reconnecting.'
  }
  if (status === 429) return 'AI drafting is busy. Keep writing your message and try again shortly.'
  if (code.includes('missing_api_key') || code.includes('server_misconfigured')) {
    return 'AI drafting is not ready for this workspace. You can write and send your own message below.'
  }
  if (code.includes('timed out') || code.includes('failed to fetch') || status === 404) {
    return 'AI drafting could not connect. Check your connection or keep writing your message below.'
  }
  return 'AI drafting is unavailable right now. Your message is still here. You can edit it or try again.'
}

export function teamLoadError(error: unknown): string {
  const detail = error as ServiceError | null
  if (detail?.message === 'server_misconfigured') {
    return 'Team access needs workspace setup before the roster can load. Contact your workspace administrator or support, then retry.'
  }
  if (Number(detail?.status) === 401) {
    return 'Your session needs to reconnect before the team roster can load. Reconnect and try again.'
  }
  if (Number(detail?.status) === 403) {
    return 'You do not have access to this team roster. Check your selected workspace or contact its administrator.'
  }
  return 'Could not load your team roster. Check your connection and try again.'
}
