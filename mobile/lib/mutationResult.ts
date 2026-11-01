// PostgREST can acknowledge an update or delete without affecting a row.
// Callers must request returned IDs before reporting a successful save.
export async function confirmMutation<T>(
  request: PromiseLike<{ data: T; error: { message: string } | null }>,
  expectedRows = 1
): Promise<{ data: T; error: { message: string } | null }> {
  const result = await request
  if (result.error) return result
  const count = Array.isArray(result.data) ? result.data.length : result.data ? 1 : 0
  if (count !== expectedRows) {
    return { ...result, error: new Error('Save could not be confirmed. Refresh and try again.') }
  }
  return result
}
