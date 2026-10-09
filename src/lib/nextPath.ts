// The ?next= destination after sign in or sign up (an org invite page,
// say). Only a path on this site is accepted, so a crafted link cannot
// send a fresh session somewhere else: "//evil.com" and "/\evil.com"
// are protocol relative to the browser, and the URL parser drops tabs
// and newlines, which would turn "/\t/evil.com" into "//evil.com".

const SAME_ORIGIN_PATH = /^\/(?![/\\])/
const PROBE_ORIGIN = 'https://next.invalid'

function hasControlOrSpace(value: string) {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i)
    if (code <= 0x20 || code === 0x7f) return true
  }
  return false
}

export function safeNextPath(raw: string | null | undefined): string | null {
  if (!raw || !SAME_ORIGIN_PATH.test(raw) || hasControlOrSpace(raw)) return null
  try {
    if (new URL(raw, PROBE_ORIGIN).origin !== PROBE_ORIGIN) return null
  } catch {
    return null
  }
  return raw
}
