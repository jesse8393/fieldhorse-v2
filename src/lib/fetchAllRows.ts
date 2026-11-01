// PostgREST caps every response at the server's max-rows (Supabase
// default: 1000) even when no .limit() is set, so the "deliberately
// uncapped" aggregate fetches below were silently losing their oldest
// rows past 1000 (payments dropped from A/R sums, jobs from rollups).
// This pages through .range() windows until a short page arrives.
// Callers MUST give the query a stable order (we pass an id tiebreak)
// or pages can overlap/skip under concurrent writes.
const FETCH_PAGE = 1000
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await build(from, from + FETCH_PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < FETCH_PAGE) break
  }
  return out
}
