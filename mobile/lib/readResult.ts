import { fetchAllRows } from '../../src/lib/fetchAllRows'

// A failed or incomplete fetch is not an empty customer book or a zero balance.
export function assertReadResults(...results: { error?: unknown }[]): void {
  for (const result of results) {
    if (result.error) throw result.error
  }
}

// Aggregate screens must read every page before showing a balance.
export async function readAllRows<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>) {
  return { data: await fetchAllRows<T>(build), error: null }
}
