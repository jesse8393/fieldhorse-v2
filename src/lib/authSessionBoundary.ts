/**
 * What a purge removes. queuedWork: the offline queues too. Only a sign
 * out the person chose clears them (after giving them a chance to sync).
 * A session that ended on its own (a refused refresh token) or another
 * account arriving keeps them: every queued entry is tagged with its
 * owner and only drains for that owner, so it waits for them to sign in.
 */
export type PurgeScope = { queuedWork: boolean }

/** Hold authenticated screens until the previous account's local data is gone. */
export function createAuthSessionBoundary<T extends { user: { id: string } }>(options: {
  purge: (scope: PurgeScope) => Promise<void>
  hold: () => void
  publish: (session: T | null) => void
}) {
  let userId: string | null = null
  let revision = 0
  let active = true
  let pending = Promise.resolve()
  let signOutChosen = false
  function update(event: string, session: T | null) {
    if (!active) return
    const ticket = ++revision
    const nextId = session?.user.id ?? null
    if (event === 'SIGNED_OUT' || (userId !== null && nextId !== userId)) {
      const scope = { queuedWork: event === 'SIGNED_OUT' && signOutChosen }
      if (event === 'SIGNED_OUT') signOutChosen = false
      options.hold()
      // purge clears the in-memory book synchronously before its first await.
      // Every later event waits for all outstanding storage cleanup as well.
      pending = Promise.all([pending, options.purge(scope)]).then(() => undefined)
    }
    userId = nextId
    void pending.then(() => {
      if (active && revision === ticket) options.publish(session)
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
