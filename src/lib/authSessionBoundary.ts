/**
 * What a purge removes. queuedWork: the offline queues too. Only a sign
 * out the person chose clears them (after giving them a chance to sync).
 * A session that ended on its own (a refused refresh token) or another
 * account arriving keeps them: every queued entry is tagged with its
 * owner and only drains for that owner, so it waits for them to sign in.
 */
export type PurgeScope = { queuedWork: boolean }

/**
 * Who the book saved on this device belongs to, kept across page loads.
 * A page load starts with no session of its own, so without this a
 * session that arrives from another account's email link would open on
 * top of the saved cache. Reads and writes must not throw.
 */
export type CacheOwnerStore = {
  read(): string | null
  write(userId: string | null): void
}

/** Hold authenticated screens until the previous account's local data is gone. */
export function createAuthSessionBoundary<T extends { user: { id: string } }>(options: {
  purge: (scope: PurgeScope) => Promise<void>
  hold: () => void
  publish: (session: T | null) => void
  owner?: CacheOwnerStore
}) {
  let userId: string | null = null
  // The account whose data may be on the device. Nothing recorded (a
  // device from before the record existed): the first account adopts it.
  let owner = options.owner?.read() ?? null
  let revision = 0
  let active = true
  let pending = Promise.resolve()
  let signOutChosen = false
  function update(event: string, session: T | null) {
    if (!active) return
    const ticket = ++revision
    const nextId = session?.user.id ?? null
    // No session yet on this page (a cold load, or one that opened signed
    // out) and someone other than the owner arrives. A missing session
    // alone purges nothing: offline with an expired token that is what
    // the owner's own cold open looks like.
    const notTheOwner = userId === null && nextId !== null && owner !== null && nextId !== owner
    const purging = event === 'SIGNED_OUT' || (userId !== null && nextId !== userId) || notTheOwner
    if (purging) {
      const scope = { queuedWork: event === 'SIGNED_OUT' && signOutChosen }
      if (event === 'SIGNED_OUT') signOutChosen = false
      options.hold()
      // purge clears the in-memory book synchronously before its first await.
      // Every later event waits for all outstanding storage cleanup as well.
      pending = Promise.all([pending, options.purge(scope)]).then(() => undefined)
    }
    userId = nextId
    void pending.then(() => {
      if (!active || revision !== ticket) return
      // Record the new owner only once the old one's data is gone, so a
      // page closed mid purge purges again on the next load.
      if ((purging || nextId !== null) && owner !== nextId) {
        owner = nextId
        options.owner?.write(nextId)
      }
      options.publish(session)
    })
  }
  return {
    update,
    async restore(load: Promise<T | null>) {
      const ticket = revision
      const session = await load
      if (active && revision === ticket) update('INITIAL_SESSION', session)
    },
    /**
     * The person tapped Sign out: the next SIGNED_OUT may clear their
     * queued work. Call the returned function if the sign out failed.
     */
    chosenSignOut() {
      signOutChosen = true
      return () => { signOutChosen = false }
    },
    flush: () => pending,
    dispose: () => { active = false },
  }
}
