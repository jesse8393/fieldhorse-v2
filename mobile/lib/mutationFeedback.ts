export type MutationResult = { error: { message: string } | null }

// Keep one request per action in flight. A refused or interrupted save
// must never trigger draft clearing, navigation, or a success message.
export function createMutationFeedback(options: {
  active: () => boolean
  pending: (keys: ReadonlySet<string>) => void
  failed: (title: string, message: string) => void
}) {
  const requests = new Set<string>()
  return async function run<T extends MutationResult>(
    key: string,
    title: string,
    request: () => Promise<T>,
  ): Promise<T | null> {
    if (!options.active() || requests.has(key)) return null
    requests.add(key)
    options.pending(new Set(requests))
    try {
      const result = await request()
      if (!options.active()) return null
      if (result.error) {
        options.failed(title, result.error.message || 'Changes could not be saved. Try again.')
        return null
      }
      return result
    } catch (error) {
      if (options.active()) {
        const message = error instanceof Error ? error.message : 'Connection interrupted. Please try again.'
        options.failed(title, message)
      }
      return null
    } finally {
      requests.delete(key)
      if (options.active()) options.pending(new Set(requests))
    }
  }
}
