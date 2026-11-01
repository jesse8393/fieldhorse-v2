// A failed or incomplete fetch is not an empty customer book or a zero balance.
export function assertReadResults(...results: { error?: unknown }[]): void {
  for (const result of results) {
    if (result.error) throw result.error
  }
}
