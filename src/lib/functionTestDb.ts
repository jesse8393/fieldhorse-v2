// Test helper only. A small in memory stand in for the supabase-js client,
// with enough of the query builder for a Netlify function to run for real
// against rows a test seeds. Every read, write and rpc is logged so a test
// can assert on what the handler actually did.

export type Row = Record<string, any>
export type FakeDb = {
  tables: Record<string, Row[]>
  /** Access token to auth user. */
  users: Record<string, Row>
  /** rpc name to implementation; the limiter allows everything unless set. */
  rpc: Record<string, (args: any) => any>
  log: Array<{ op: string; table?: string; fn?: string; payload?: any; rows?: number }>
  /** Table to error message for insert and update. */
  failWrites: Record<string, string>
  seq: number
}

export function newFakeDb(tables: Record<string, Row[]> = {}): FakeDb {
  return { tables, users: {}, rpc: {}, log: [], failWrites: {}, seq: 0 }
}

class Query implements PromiseLike<any> {
  private tests: Array<(r: Row) => boolean> = []
  private op: 'select' | 'insert' | 'update' = 'select'
  private payload: any = null
  private returning = false
  private one: 'single' | 'maybe' | null = null
  private orderBy: Array<{ col: string; asc: boolean }> = []
  private lim: number | null = null
  private rng: [number, number] | null = null

  constructor(private db: FakeDb, private table: string) {}

  private add(test: (r: Row) => boolean) { this.tests.push(test); return this }
  select() { if (this.op !== 'select') this.returning = true; return this }
  insert(payload: any) { this.op = 'insert'; this.payload = payload; return this }
  update(payload: any) { this.op = 'update'; this.payload = payload; return this }
  eq(col: string, v: any) { return this.add((r) => r[col] === v) }
  neq(col: string, v: any) { return this.add((r) => r[col] != null && r[col] !== v) }
  is(col: string, v: any) { return this.add((r) => (r[col] ?? null) === v) }
  in(col: string, list: any[]) { return this.add((r) => list.includes(r[col])) }
  order(col: string, opts?: { ascending?: boolean }) { this.orderBy.push({ col, asc: opts?.ascending !== false }); return this }
  limit(n: number) { this.lim = n; return this }
  range(a: number, b: number) { this.rng = [a, b]; return this }
  single() { this.one = 'single'; return this }
  maybeSingle() { this.one = 'maybe'; return this }

  private rows(): Row[] { return (this.db.tables[this.table] ||= []) }

  private run(): { data: any; error: any } {
    const fail = this.db.failWrites[this.table]
    if (this.op !== 'select' && fail) {
      this.db.log.push({ op: `${this.op}:failed`, table: this.table, payload: this.payload })
      return { data: null, error: { message: fail, code: 'XX000' } }
    }
    if (this.op === 'insert') {
      const made = (Array.isArray(this.payload) ? this.payload : [this.payload]).map((item: Row) => {
        const row = { id: `${this.table}-${++this.db.seq}`, ...item }
        this.rows().push(row)
        return row
      })
      this.db.log.push({ op: 'insert', table: this.table, payload: this.payload, rows: made.length })
      return this.shape(made)
    }
    let hit = this.rows().filter((r) => this.tests.every((t) => t(r)))
    if (this.op === 'update') {
      for (const r of hit) Object.assign(r, this.payload)
      this.db.log.push({ op: 'update', table: this.table, payload: this.payload, rows: hit.length })
      return this.shape(hit)
    }
    for (const o of [...this.orderBy].reverse()) {
      hit = [...hit].sort((a, b) => (a[o.col] === b[o.col] ? 0 : (a[o.col] > b[o.col] ? 1 : -1) * (o.asc ? 1 : -1)))
    }
    if (this.rng) hit = hit.slice(this.rng[0], this.rng[1] + 1)
    if (this.lim != null) hit = hit.slice(0, this.lim)
    this.db.log.push({ op: 'select', table: this.table, rows: hit.length })
    return this.shape(hit, true)
  }

  private shape(rows: Row[], isSelect = false): { data: any; error: any } {
    if (!isSelect && !this.returning && !this.one) return { data: null, error: null }
    const copy = rows.map((r) => ({ ...r }))
    if (this.one === 'single') {
      return copy.length === 1 ? { data: copy[0], error: null } : { data: null, error: { message: 'no single row', code: 'PGRST116' } }
    }
    if (this.one === 'maybe') {
      return copy.length > 1 ? { data: null, error: { message: 'multiple rows', code: 'PGRST116' } } : { data: copy[0] ?? null, error: null }
    }
    return { data: copy, error: null }
  }

  then<T1 = any, T2 = never>(ok?: ((v: any) => T1 | PromiseLike<T1>) | null, bad?: ((e: any) => T2 | PromiseLike<T2>) | null): PromiseLike<T1 | T2> {
    return Promise.resolve().then(() => this.run()).then(ok, bad)
  }
}

export function fakeSupabase(db: FakeDb) {
  return {
    from: (table: string) => new Query(db, table),
    rpc: async (fn: string, args: any) => {
      db.log.push({ op: 'rpc', fn, payload: args })
      const impl = db.rpc[fn]
      if (impl) return { data: await impl(args), error: null }
      if (fn === 'fh_increment_rate_limit') return { data: [{ request_count: 1, allowed: true }], error: null }
      return { data: null, error: { message: `function ${fn} does not exist`, code: 'PGRST202' } }
    },
    auth: {
      getUser: async (token: string) => {
        const user = db.users[token]
        return user ? { data: { user }, error: null } : { data: { user: null }, error: { message: 'invalid JWT' } }
      }
    },
    storage: {
      from: () => ({ download: async () => ({ data: new Blob(['%PDF-1.4 test']), error: null }) })
    }
  }
}

/** What a handler posted to a provider, as the test's fetch stub recorded it. */
export type Outbound = { host: string; body: any; headers: Record<string, string> }

/** A fetch stub that records every call and answers as Resend and Anthropic do. */
export function recordingFetch(outbound: Outbound[], anthropic: () => unknown = () => ({ content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn' })) {
  return async (input: any, init?: any) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    outbound.push({ host: url.host, body: JSON.parse(String(init?.body || '{}')), headers: init?.headers || {} })
    if (url.host === 'api.resend.com') return new Response(JSON.stringify({ id: 'email_test' }), { status: 200 })
    if (url.host === 'api.anthropic.com') return new Response(JSON.stringify(anthropic()), { status: 200 })
    throw new Error(`test refused a live call to ${url.host}`)
  }
}
