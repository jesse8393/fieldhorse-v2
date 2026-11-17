// netlify/functions/lib/storagePath.js
//
// Shared check for a storage path that arrives in a request body.
//
// The send functions (send-quote, send-invoice, send-certificate,
// send-statement, docusign-send) download the named object with the service
// role key and send it to an address the caller chose. sub-doc-confirm
// saves the path on the sub's vendor profiles. All of them used to check
// only that the path began with the caller's user id.
//
// That was not enough. The storage client puts the path into the request
// URL as it is, and fetch then resolves dot segments and splits off a query
// string. So "<caller id>/../../../../../rest/v1/fh_clients?select=*" began
// with the caller's id and still made the service key read
// /rest/v1/fh_clients. The same trick reached any table, the auth admin API
// and other accounts' files, and the answer left as the email attachment.
//
// A path is accepted only when it is a short list of plain segments under
// the caller's own folder, so the URL that gets requested is the path that
// was checked.

const MAX_LENGTH = 300
const MIN_SEGMENTS = 2
const MAX_SEGMENTS = 5

// Letters, digits, dot, underscore and hyphen. Nothing a URL gives meaning
// to: no slash, backslash, percent sign, question mark, hash, space or
// control character, so no encoded form gets through either.
const PLAIN_SEGMENT = /^[A-Za-z0-9._-]+$/
const ONLY_DOTS = /^\.+$/

/**
 * True when `path` names an object inside the storage folder of `ownerId`.
 *
 * All of these must hold:
 *   1. `path` and `ownerId` are non empty strings and `path` is at most 300
 *      characters long.
 *   2. Split on "/", the path has 2 to 5 segments and none is empty.
 *   3. The first segment is exactly `ownerId`.
 *   4. Every segment is made of letters, digits, ".", "_" and "-" and is
 *      not made only of dots, which rules out "." and "..".
 *   5. With `options.prefix` (a list of folder names), the segments after
 *      the owner begin with it and a file name follows.
 *   6. With `options.extensions` (lower case, without the dot), the file
 *      name ends with one of them. Letter case is ignored.
 *
 * An option of the wrong type refuses the path instead of being skipped.
 */
export function isOwnedStoragePath(path, ownerId, options) {
  if (typeof path !== 'string' || typeof ownerId !== 'string') return false
  if (!path || !ownerId || path.length > MAX_LENGTH) return false

  const segments = path.split('/')
  if (segments.length < MIN_SEGMENTS || segments.length > MAX_SEGMENTS) return false
  if (segments[0] !== ownerId) return false
  if (!segments.every((segment) => PLAIN_SEGMENT.test(segment) && !ONLY_DOTS.test(segment))) return false

  const { prefix, extensions } = options || {}
  if (prefix != null) {
    if (!Array.isArray(prefix)) return false
    // The folders between the owner and the file name.
    const folders = segments.slice(1, -1)
    if (folders.length < prefix.length) return false
    if (!prefix.every((name, i) => folders[i] === name)) return false
  }
  if (extensions != null) {
    if (!Array.isArray(extensions)) return false
    const fileName = segments[segments.length - 1].toLowerCase()
    const allowed = extensions.some((ext) => typeof ext === 'string' && ext !== '' && fileName.endsWith(`.${ext.toLowerCase()}`))
    if (!allowed) return false
  }
  return true
}
