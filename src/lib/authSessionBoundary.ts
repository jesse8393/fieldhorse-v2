/** Hold authenticated screens until the previous account's local data is gone. */
export function createAuthSessionBoundary<T extends { user: { id: string } }>(options: {
  purge: () => Promise<void>
  hold: () => void
  publish: (session: T | null) => void
}) {
  let userId: string | null = null
  let revision = 0
  let active = true
  let pending = Promise.resolve()
  function update(event: string, session: T | null) {
    if (!active) return
    const ticket = ++revision
    const nextId = session?.user.id ?? null
    if (event === 'SIGNED_OUT' || (userId !== null && nextId !== userId)) {
      options.hold()
      // purge clears the in-memory book synchronously before its first await.
      // Every later event waits for all outstanding storage cleanup as well.
      pending = Promise.all([pending, options.purge()]).then(() => undefined)
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
    flush: () => pending,
    dispose: () => { active = false },
  }
}
