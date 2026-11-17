// src/lib/publicLinkTestDb.ts
//
// Test helper, not shipped: an in memory stand in for the supabase-js
// client the customer link functions use (public-link, the approve
// endpoints, the DocuSign webhook), enough of the query builder for the
// handlers to run for real against rows a test seeds. Every write lands
// in `tables`, so a test asserts on what a handler actually changed.

export type Row = Record<string, any>

// Splits a PostgREST or() expression on the commas between clauses, not
// the ones inside an in.(a,b) list.
function orClauses(expr: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of expr) {
    if (ch === '(') depth += 1
    if (ch === ')') depth -= 1
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

export function fakeSupabase(tables: Record<string, Row[]>) {
  let nextId = 1
  const matchOr = (row: Row, expr: string) => orClauses(expr).some((part) => {
    const [col, op, ...rest] = part.split('.')
    const value = rest.join('.')
    if (op === 'is') return value === 'null' ? row[col] == null : row[col] === value
    if (op === 'neq') return row[col] !== value
    if (op === 'eq') return row[col] === value
    if (op === 'in') return value.replace(/^\(|\)$/g, '').split(',').includes(String(row[col]))
    return false
  })
  function from(table: string) {
    const rows = (tables[table] ||= [])
    const filters: Array<(r: Row) => boolean> = []
    let mode: 'select' | 'update' | 'insert' | 'delete' = 'select'
    let payload: any = null
    let returning = false
    let order: { col: string; asc: boolean } | null = null
    let limit = Infinity
    const matching = () => rows.filter((r) => filters.every((f) => f(r)))
    const run = (): { data: any; error: any } => {
      if (mode === 'insert') {
        const inserted = (Array.isArray(payload) ? payload : [payload]).map((p) => ({ id: `row-${nextId++}`, created_at: new Date().toISOString(), ...p }))
        rows.push(...inserted)
        return { data: inserted, error: null }
      }
      if (mode === 'update') {
        const hit = matching()
        hit.forEach((r) => Object.assign(r, payload))
        return { data: returning ? hit.map((r) => ({ ...r })) : null, error: null }
      }
      if (mode === 'delete') {
        const hit = matching()
        tables[table] = rows.filter((r) => !hit.includes(r))
        return { data: null, error: null }
      }
      let out = matching()
      if (order) {
        const { col, asc } = order
        out = [...out].sort((a, b) => (a[col] < b[col] ? -1 : a[col] > b[col] ? 1 : 0) * (asc ? 1 : -1))
      }
      return { data: out.slice(0, limit).map((r) => ({ ...r })), error: null }
    }
    const api: any = {
      select: () => { returning = true; return api },
      insert: (p: any) => { mode = 'insert'; payload = p; return api },
      update: (p: any) => { mode = 'update'; payload = p; return api },
      delete: () => { mode = 'delete'; return api },
      eq: (col: string, v: any) => { filters.push((r) => r[col] === v); return api },
      neq: (col: string, v: any) => { filters.push((r) => r[col] !== v); return api },
      is: (col: string, v: any) => { filters.push((r) => (r[col] ?? null) === v); return api },
      in: (col: string, vs: any[]) => { filters.push((r) => vs.includes(r[col])); return api },
      match: (obj: Row) => { filters.push((r) => Object.entries(obj).every(([k, v]) => r[k] === v)); return api },
      or: (expr: string) => { filters.push((r) => matchOr(r, expr)); return api },
      order: (col: string, o: any) => { order = { col, asc: o?.ascending !== false }; return api },
      limit: (n: number) => { limit = n; return api },
      maybeSingle: async () => { const { data, error } = run(); return { data: data?.[0] ?? null, error } },
      single: async () => { const { data, error } = run(); return { data: data?.[0] ?? null, error: data?.[0] ? error : { message: 'no rows' } } },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject)
    }
    return api
  }
  const rpcCalls: Array<{ name: string; params: any }> = []
  const rpc = async (name: string, params: any) => {
    rpcCalls.push({ name, params })
    if (name === 'fh_increment_rate_limit') return { data: [{ request_count: 1, allowed: true }], error: null }
    return { data: null, error: null }
  }
  // Signs every path it is handed, so a test sees exactly what was signed.
  const signed: string[] = []
  const storage = {
    from: () => ({
      createSignedUrls: async (paths: string[]) => {
        signed.push(...paths)
        return { data: paths.map((path) => ({ path, signedUrl: `https://signed.example.test/${path}` })), error: null }
      }
    })
  }
  return { from, rpc, storage, tables, rpcCalls, signed }
}
