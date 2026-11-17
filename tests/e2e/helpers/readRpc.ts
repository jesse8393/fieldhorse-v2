// Which POSTs are reads.
//
// PostgREST takes every database function call as a POST to
// /rest/v1/rpc/<name>, so a test that counts POSTs as writes also counts a
// function that only reads. The header bell reads the open reminders
// through fh_my_open_reminders on every signed in screen (AUTO-09). It
// changes nothing, so a write watcher skips it.
const READ_ONLY_RPCS = new Set(['fh_my_open_reminders'])

/** True for a call to a database function that only reads, such as the bell's reminder read. */
export function isReadOnlyRpc(url: string | URL): boolean {
  const name = new URL(url).pathname.split('/rest/v1/rpc/')[1]
  return !!name && READ_ONLY_RPCS.has(name)
}

/** The same check for a call the mock recorded, by function name. */
export function isReadOnlyRpcName(name: string): boolean {
  return READ_ONLY_RPCS.has(name)
}
