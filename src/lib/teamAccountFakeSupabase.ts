// Test helper for the team and account function tests.
//
// A small in memory stand in for the supabase-js client: enough of the
// PostgREST query builder for the Netlify handlers to run for real against
// rows a test seeds. Every write is applied and logged so a test can assert
// on what a handler actually changed.

export type Row = Record<string, any>
export type FakeState = {
  tables: Record<string, Row[]>
  users: Record<string, Row>            // access token -> auth user
  rpc: Record<string, (args: any) => any>
  log: Array<{ op: string; table?: string; fn?: string; filters?: string[]; payload?: any; rows?: number }>
  failWrites?: Record<string, string>   // table -> error message for insert/update
  deletedUsers: string[]
  seq: number
}

export function newState(tables: Record<string, Row[]> = {}): FakeState {
  return { tables, users: {}, rpc: {}, log: [], deletedUsers: [], seq: 0 }
}

type Pred = { text: string; test: (r: Row) => boolean }

function splitTop(s: string): string[] {
  const out: string[] = []
  let depth = 0
  let cur = ''
  for (const ch of s) {
    if (ch === '(') depth++
    if (ch === ')') depth--
    if (ch === ',' && depth === 0) { out.push(cur); cur = '' } else cur += ch
  }
  if (cur) out.push(cur)
  return out
}

function parseOrTerm(term: string): (r: Row) => boolean {
  const [col, op, ...rest] = term.split('.')
  const value = rest.join('.')
  if (op === 'is' && value === 'null') return (r) => r[col] === null || r[col] === undefined
  if (op === 'eq') return (r) => String(r[col]) === value
  if (op === 'neq') return (r) => r[col] !== null && r[col] !== undefined && String(r[col]) !== value
  if (op === 'in') {
    const list = value.replace(/^\(|\)$/g, '').split(',')
    return (r) => list.includes(String(r[col]))
  }
  throw new Error(`fake supabase: unsupported or() term ${term}`)
}

class Query implements PromiseLike<any> {
  private preds: Pred[] = []
  private op: 'select' | 'insert' | 'update' | 'delete' | 'upsert' = 'select'
  private payload: any = null
  private returning = false
  private wantSingle: 'single' | 'maybe' | null = null
  private head = false
  private wantCount = false
  private orderBy: Array<{ col: string; asc: boolean }> = []
  private lim: number | null = null
  private rng: [number, number] | null = null
  private upsertOpts: any = null

  constructor(private state: FakeState, private table: string) {}

  private add(text: string, test: (r: Row) => boolean) { this.preds.push({ text, test }); return this }

  select(_cols?: string, opts?: { count?: string; head?: boolean }) {
    if (this.op !== 'select') this.returning = true
    if (opts?.head) this.head = true
    if (opts?.count) this.wantCount = true
    return this
  }
  insert(payload: any) { this.op = 'insert'; this.payload = payload; return this }
  update(payload: any) { this.op = 'update'; this.payload = payload; return this }
  upsert(payload: any, opts?: any) { this.op = 'upsert'; this.payload = payload; this.upsertOpts = opts; return this }
  delete() { this.op = 'delete'; return this }

  eq(col: string, v: any) { return this.add(`${col}=eq.${v}`, (r) => r[col] === v) }
  neq(col: string, v: any) { return this.add(`${col}=neq.${v}`, (r) => r[col] !== null && r[col] !== undefined && r[col] !== v) }
  is(col: string, v: any) { return this.add(`${col}=is.${v}`, (r) => (r[col] ?? null) === v) }
  in(col: string, list: any[]) { return this.add(`${col}=in.(${list.join(',')})`, (r) => list.includes(r[col])) }
  gt(col: string, v: any) { return this.add(`${col}=gt.${v}`, (r) => r[col] > v) }
  gte(col: string, v: any) { return this.add(`${col}=gte.${v}`, (r) => r[col] >= v) }
  lt(col: string, v: any) { return this.add(`${col}=lt.${v}`, (r) => r[col] < v) }
  lte(col: string, v: any) { return this.add(`${col}=lte.${v}`, (r) => r[col] <= v) }
  ilike(col: string, v: string) { return this.add(`${col}=ilike.${v}`, (r) => String(r[col] ?? '').toLowerCase() === String(v).toLowerCase()) }
  not(col: string, op: string, v: any) {
    if (op === 'is' && v === null) return this.add(`${col}=not.is.null`, (r) => r[col] !== null && r[col] !== undefined)
    throw new Error(`fake supabase: unsupported not(${col}, ${op})`)
  }
  match(obj: Record<string, any>) {
    for (const [k, v] of Object.entries(obj)) this.add(`${k}=eq.${v}`, (r) => (r[k] ?? null) === v)
    return this
  }
  or(expr: string) {
    const terms = splitTop(expr).map(parseOrTerm)
    return this.add(`or=(${expr})`, (r) => terms.some((t) => t(r)))
  }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy.push({ col, asc: opts?.ascending !== false }); return this }
  limit(n: number) { this.lim = n; return this }
  range(a: number, b: number) { this.rng = [a, b]; return this }
  single() { this.wantSingle = 'single'; return this }
  maybeSingle() { this.wantSingle = 'maybe'; return this }

  private rows(): Row[] { return (this.state.tables[this.table] ||= []) }
  private matching(): Row[] { return this.rows().filter((r) => this.preds.every((p) => p.test(r))) }

  private run(): { data: any; error: any; count?: number | null } {
    const filters = this.preds.map((p) => p.text)
    const fail = this.state.failWrites?.[this.table]
    if (this.op === 'insert' || this.op === 'upsert') {
      if (fail) { this.state.log.push({ op: `${this.op}:failed`, table: this.table, payload: this.payload }); return { data: null, error: { message: fail, code: 'XX000' } } }
      const list = Array.isArray(this.payload) ? this.payload : [this.payload]
      const made: Row[] = []
      for (const item of list) {
        const key = this.upsertOpts?.onConflict
        const existing = this.op === 'upsert' && key ? this.rows().find((r) => r[key] === item[key]) : null
        if (existing) { if (!this.upsertOpts?.ignoreDuplicates) Object.assign(existing, item); made.push(existing); continue }
        const row = { id: `${this.table}-${++this.state.seq}`, created_at: new Date().toISOString(), ...item }
        this.rows().push(row)
        made.push(row)
      }
      this.state.log.push({ op: this.op, table: this.table, payload: this.payload, rows: made.length })
      return this.shape(made)
    }
    if (this.op === 'update') {
      if (fail) { this.state.log.push({ op: 'update:failed', table: this.table, filters, payload: this.payload }); return { data: null, error: { message: fail, code: 'XX000' } } }
      const hit = this.matching()
      for (const r of hit) Object.assign(r, this.payload)
      this.state.log.push({ op: 'update', table: this.table, filters, payload: this.payload, rows: hit.length })
      return this.shape(hit)
    }
    if (this.op === 'delete') {
      const hit = this.matching()
      this.state.tables[this.table] = this.rows().filter((r) => !hit.includes(r))
      this.state.log.push({ op: 'delete', table: this.table, filters, rows: hit.length })
      return this.shape(hit)
    }
    let hit = this.matching()
    for (const o of [...this.orderBy].reverse()) {
      hit = [...hit].sort((a, b) => (a[o.col] === b[o.col] ? 0 : (a[o.col] > b[o.col] ? 1 : -1) * (o.asc ? 1 : -1)))
    }
    const count = hit.length
    if (this.rng) hit = hit.slice(this.rng[0], this.rng[1] + 1)
    if (this.lim != null) hit = hit.slice(0, this.lim)
    this.state.log.push({ op: 'select', table: this.table, filters, rows: hit.length })
    if (this.head) return { data: null, error: null, count }
    const shaped = this.shape(hit, true)
    return this.wantCount ? { ...shaped, count } : shaped
  }

  private shape(rows: Row[], isSelect = false): { data: any; error: any } {
    if (!isSelect && !this.returning && !this.wantSingle) return { data: null, error: null }
    const copy = rows.map((r) => ({ ...r }))
    if (this.wantSingle === 'single') {
      if (copy.length !== 1) return { data: null, error: { message: 'JSON object requested, multiple (or no) rows returned', code: 'PGRST116' } }
      return { data: copy[0], error: null }
    }
    if (this.wantSingle === 'maybe') {
      if (copy.length > 1) return { data: null, error: { message: 'multiple rows', code: 'PGRST116' } }
      return { data: copy[0] ?? null, error: null }
    }
    return { data: copy, error: null }
  }

  then<T1 = any, T2 = never>(ok?: ((v: any) => T1 | PromiseLike<T1>) | null, bad?: ((e: any) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    return Promise.resolve().then(() => this.run()).then(ok, bad)
  }
}

export function fakeClient(state: FakeState) {
  return {
    from: (table: string) => new Query(state, table),
    rpc: async (fn: string, args: any) => {
      state.log.push({ op: 'rpc', fn, payload: args })
      const impl = state.rpc[fn]
      if (!impl) {
        if (fn === 'fh_increment_rate_limit' || fn === 'fh_increment_webhook_rate_limit') return { data: [{ request_count: 1, allowed: true }], error: null }
        if (fn === 'fh_record_public_link_view') return { data: null, error: null }
        return { data: null, error: { message: `function ${fn} does not exist`, code: 'PGRST202' } }
      }
      try { return { data: await impl(args), error: null } } catch (e: any) { return { data: null, error: { message: e.message } } }
    },
    auth: {
      getUser: async (token: string) => {
        const user = state.users[token]
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }
      },
      admin: {
        getUserById: async (id: string) => ({ data: { user: Object.values(state.users).find((u) => u.id === id) || null }, error: null }),
        deleteUser: async (id: string) => { state.deletedUsers.push(id); state.log.push({ op: 'auth.deleteUser', payload: id }); return { data: {}, error: null } }
      }
    },
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => { state.log.push({ op: 'storage.download', table: bucket, payload: path }); return { data: new Blob(['%PDF-1.4 test']), error: null } },
        createSignedUrls: async (paths: string[]) => ({ data: paths.map((p) => ({ path: p, signedUrl: `https://signed.example.test/${p}` })), error: null }),
        createSignedUploadUrl: async (path: string) => ({ data: { signedUrl: `https://signed.example.test/upload/${path}`, token: 'tok' }, error: null }),
        list: async () => ({ data: [], error: null }),
        remove: async (paths: string[]) => { state.log.push({ op: 'storage.remove', table: bucket, payload: paths }); return { data: [], error: null } }
      })
    }
  }
}
