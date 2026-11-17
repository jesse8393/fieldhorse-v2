// Reads which database functions, tables and columns the code uses, and
// compares them with a schema: the one in src/lib/database.types.ts, or the
// live one read from production. Shared by scripts/check-schema-refs.mjs and
// the e2e mock (scripts/qa-mock.mjs), which uses the same schema to refuse
// requests the real database would refuse.
//
// A schema here is a plain object:
//   { tables: { name: { columns: string[], view: boolean } },
//     functions: { name: { overloads: Array<Array<{ name, optional }>> } } }
// A function overload is the list of its named parameters.

const IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/

// ---- database.types.ts -------------------------------------------------------

/**
 * Parses the generated Database type. Only the public schema's Tables, Views
 * and Functions are read; the layout is the one `supabase gen types` writes.
 * @param {string} text
 */
export function parseDatabaseTypes(text) {
  const lines = text.split('\n')
  const start = lines.findIndex((l) => l.startsWith('export type Database = {'))
  if (start < 0) throw new Error('database.types.ts has no Database type')
  let end = lines.findIndex((l, i) => i > start && l === '}')
  if (end < 0) end = lines.length
  const publicStart = lines.findIndex((l, i) => i > start && i < end && l === '  public: {')
  if (publicStart < 0) throw new Error('database.types.ts has no public schema')
  const schema = { tables: {}, functions: {} }

  const section = (name) => {
    const from = lines.findIndex((l, i) => i > publicStart && i < end && l === `    ${name}: {`)
    if (from < 0) return []
    const to = lines.findIndex((l, i) => i > from && l === '    }')
    return lines.slice(from + 1, to < 0 ? end : to)
  }

  for (const [sectionName, view] of [['Tables', false], ['Views', true]]) {
    let current = null
    let part = null
    for (const line of section(sectionName)) {
      const name = /^ {6}([A-Za-z_0-9]+): \{$/.exec(line)
      if (name) {
        current = { columns: [], view }
        schema.tables[name[1]] = current
        part = null
        continue
      }
      const sub = /^ {8}(Row|Insert|Update|Relationships):/.exec(line)
      if (sub) { part = sub[1]; continue }
      const col = /^ {10}([A-Za-z_0-9]+)\??:/.exec(line)
      if (col && current && part === 'Row') current.columns.push(col[1])
    }
  }

  // A function entry starts at six spaces; its text runs to the next one.
  const fnLines = section('Functions')
  let fnName = null
  let buffer = []
  const flush = () => {
    if (!fnName) return
    schema.functions[fnName] = { overloads: functionOverloads(buffer.join('\n')) }
  }
  for (const line of fnLines) {
    const m = /^ {6}([A-Za-z_0-9]+):/.exec(line)
    if (m) {
      flush()
      fnName = m[1]
      buffer = [line.slice(m[0].length)]
    } else {
      buffer.push(line)
    }
  }
  flush()
  return schema
}

function functionOverloads(text) {
  const overloads = []
  const re = /Args:\s*/g
  let m
  while ((m = re.exec(text))) {
    const at = m.index + m[0].length
    if (text.startsWith('never', at)) { overloads.push([]); continue }
    if (text[at] !== '{') { overloads.push(null); continue }
    const close = readBalanced(text, at)
    const params = []
    for (const part of splitTop(text.slice(at + 1, close - 1), /[;\n,]/)) {
      const p = /^\s*"?([A-Za-z_0-9]*)"?(\?)?\s*:/.exec(part)
      if (p) params.push({ name: p[1], optional: Boolean(p[2]) })
    }
    // A function that takes one unnamed json argument accepts any body.
    overloads.push(params.some((p) => p.name === '') ? null : params)
  }
  return overloads.length ? overloads : [null]
}

// ---- source scanning ---------------------------------------------------------

/** Blanks out comments, keeping offsets and line numbers. */
export function stripComments(src) {
  let out = ''
  let i = 0
  const n = src.length
  let quote = null
  const templateDepth = []
  while (i < n) {
    const c = src[i]
    const d = src[i + 1]
    if (quote === "'" || quote === '"') {
      out += c
      if (c === '\\' && i + 1 < n) { out += d; i += 2; continue }
      if (c === quote || c === '\n') quote = null
      i++
      continue
    }
    if (quote === '`') {
      out += c
      if (c === '\\' && i + 1 < n) { out += d; i += 2; continue }
      if (c === '`') quote = null
      else if (c === '$' && d === '{') { out += d; i += 2; templateDepth.push(0); quote = null; continue }
      i++
      continue
    }
    if (c === '/' && d === '/') {
      while (i < n && src[i] !== '\n') { out += ' '; i++ }
      continue
    }
    if (c === '/' && d === '*') {
      const close = src.indexOf('*/', i + 2)
      const stop = close < 0 ? n : close + 2
      for (; i < stop; i++) out += src[i] === '\n' ? '\n' : ' '
      continue
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; i++; continue }
    if (templateDepth.length) {
      const top = templateDepth.length - 1
      if (c === '{') templateDepth[top]++
      else if (c === '}') {
        if (templateDepth[top] === 0) { templateDepth.pop(); quote = '`'; out += c; i++; continue }
        templateDepth[top]--
      }
    }
    out += c
    i++
  }
  return out
}

// Index just past a quoted string that starts at i.
function skipString(text, i) {
  const q = text[i]
  let j = i + 1
  while (j < text.length) {
    const c = text[j]
    if (c === '\\') { j += 2; continue }
    if (c === q) return j + 1
    if (q === '`' && c === '$' && text[j + 1] === '{') { j = readBalanced(text, j + 1); continue }
    if (q !== '`' && c === '\n') return j
    j++
  }
  return j
}

// Index just past the bracket that closes the one at i.
function readBalanced(text, i) {
  const open = text[i]
  const close = { '(': ')', '{': '}', '[': ']', '<': '>' }[open]
  let depth = 0
  let j = i
  while (j < text.length) {
    const c = text[j]
    if (c === "'" || c === '"' || c === '`') { j = skipString(text, j); continue }
    if (c === open) depth++
    else if (c === close) { depth--; if (depth === 0) return j + 1 }
    j++
  }
  return j
}

// Splits on a separator at bracket depth 0, outside strings.
function splitTop(text, sep = /,/) {
  const out = []
  let depth = 0
  let cur = ''
  let i = 0
  while (i < text.length) {
    const c = text[i]
    if (c === "'" || c === '"' || c === '`') {
      const j = skipString(text, i)
      cur += text.slice(i, j)
      i = j
      continue
    }
    if (c === '(' || c === '{' || c === '[') depth++
    if (c === ')' || c === '}' || c === ']') depth--
    if (depth === 0 && sep.test(c)) { out.push(cur); cur = '' } else cur += c
    i++
  }
  out.push(cur)
  return out.map((s) => s.trim()).filter(Boolean)
}

// The value of a string literal argument, or null for anything else (a
// variable, or a template with an expression in it).
function literal(arg) {
  const m = /^(['"`])([\s\S]*)\1$/.exec((arg || '').trim())
  if (!m) return null
  if (m[1] === '`' && m[2].includes('${')) return null
  return m[2]
}

// Top level keys of an object literal's text, braces included. Spreads and
// computed keys are skipped.
function objectKeys(text) {
  const t = text.trim()
  if (!t.startsWith('{')) return null
  const keys = []
  for (const part of splitTop(t.slice(1, readBalanced(t, 0) - 1))) {
    if (part.startsWith('...') || part.startsWith('[')) continue
    const m = /^(['"]?)([A-Za-z_$][\w$]*)\1\s*(:|$)/.exec(part)
    if (m) keys.push(m[2])
  }
  return keys
}

// The method calls chained after offset i: .select(...).eq(...) and so on.
function readChain(text, i) {
  const calls = []
  for (;;) {
    let j = i
    while (j < text.length && /\s/.test(text[j])) j++
    if (text[j] === '?' && text[j + 1] === '.') j++
    if (text[j] !== '.') break
    const m = /^\.([A-Za-z_$][\w$]*)\s*/.exec(text.slice(j, j + 120))
    if (!m) break
    let k = j + m[0].length
    if (text[k] === '<') {
      k = readBalanced(text, k)
      while (/\s/.test(text[k])) k++
    }
    if (text[k] !== '(') break
    const close = readBalanced(text, k)
    calls.push({ method: m[1], args: splitTop(text.slice(k + 1, close - 1)) })
    i = close
  }
  return calls
}

// A PostgREST select list as a tree: columns and embedded resources.
export function parseSelect(text) {
  const items = []
  for (let part of splitTop(text.replace(/\s+/g, ' '))) {
    if (part.startsWith('...')) part = part.slice(3).trim()
    if (part === '*' || part === '') continue
    const paren = part.indexOf('(')
    if (paren >= 0) {
      const head = part.slice(0, paren).trim()
      const inner = part.slice(paren + 1, part.lastIndexOf(')'))
      // An aggregate: count(), amount.sum()
      if (head === '' || head === 'count' || head.endsWith('.count')) continue
      if (head.includes('.') && !head.includes(':')) {
        const column = head.split('.')[0]
        if (IDENT.test(column)) items.push({ kind: 'column', name: column })
        continue
      }
      const colon = head.indexOf(':')
      const alias = colon >= 0 ? head.slice(0, colon).trim() : null
      const target = (colon >= 0 ? head.slice(colon + 1) : head).split('!')[0].trim()
      if (!IDENT.test(target)) continue
      items.push({ kind: 'embed', name: target, alias: alias || target, children: parseSelect(inner) })
      continue
    }
    let column = part.replace(/::[A-Za-z_][\w ]*(\[\])?/g, '')
    const colon = column.indexOf(':')
    if (colon >= 0) column = column.slice(colon + 1)
    column = column.split('->')[0].trim()
    if (IDENT.test(column)) items.push({ kind: 'column', name: column })
  }
  return items
}

// Columns named in an or=/and= filter string: a.eq.1,and(b.gt.2,c.is.null)
function filterColumns(text) {
  const out = []
  for (const item of splitTop(text)) {
    const nested = /^(?:not\.)?(and|or)\((.*)\)$/s.exec(item)
    if (nested) { out.push(...filterColumns(nested[2])); continue }
    const column = item.split('.')[0].split('->')[0].trim()
    if (IDENT.test(column)) out.push(column)
  }
  return out
}

const COLUMN_FIRST = new Set([
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'likeAllOf', 'likeAnyOf', 'ilikeAllOf', 'ilikeAnyOf',
  'is', 'in', 'contains', 'containedBy', 'overlaps', 'textSearch', 'not', 'filter', 'order',
  'rangeGt', 'rangeGte', 'rangeLt', 'rangeLte', 'rangeAdjacent'
])

function lineOf(text, offset) {
  let line = 1
  for (let i = 0; i < offset && i < text.length; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

/**
 * Every rpc, table and column the given files use.
 * @param {{ path: string, text: string }[]} files
 */
export function collectRefs(files) {
  const refs = { rpcs: [], tables: [], columns: [] }
  for (const { path, text: raw } of files) {
    const text = stripComments(raw)
    const at = (offset) => ({ file: path, line: lineOf(text, offset) })

    for (const m of text.matchAll(/\.rpc\(\s*(['"`])([A-Za-z_0-9]+)\1/g)) {
      const open = m.index + m[0].indexOf('(')
      const args = splitTop(text.slice(open + 1, readBalanced(text, open) - 1))
      let argNames = []
      if (args.length > 1) argNames = objectKeys(args[1])
      refs.rpcs.push({ name: m[2], args: argNames, ...at(m.index) })
    }
    for (const m of text.matchAll(/\/rest\/v1\/rpc\/([a-z_0-9]+)/g)) {
      refs.rpcs.push({ name: m[1], args: null, ...at(m.index) })
    }

    for (const m of text.matchAll(/\.from\(\s*(['"`])([A-Za-z_0-9]+)\1\s*\)/g)) {
      // supabase.storage.from('bucket') names a storage bucket.
      if (/storage\s*\??$/.test(text.slice(Math.max(0, m.index - 40), m.index))) continue
      const table = m[2]
      const where = at(m.index)
      refs.tables.push({ name: table, ...where })
      const column = (tbl, name, via) => refs.columns.push({ table: tbl, column: name, via, ...where })
      // Embedded resources by alias, so a filter on alias.column finds its table.
      const embeds = new Map()
      const walkSelect = (tbl, items) => {
        for (const item of items) {
          if (item.kind === 'column') column(tbl, item.name, 'select')
          else {
            refs.tables.push({ name: item.name, parent: tbl, ...where, embed: true })
            embeds.set(item.alias, item.name)
            embeds.set(item.name, item.name)
            walkSelect(item.name, item.children)
          }
        }
      }
      const resolve = (path) => {
        const parts = path.split('->')[0].split('.')
        const name = parts.pop().trim()
        if (parts.length === 0) return { tbl: table, name }
        const tbl = embeds.get(parts[parts.length - 1])
        return tbl ? { tbl, name } : null
      }
      for (const call of readChain(text, m.index + m[0].length)) {
        const first = call.args[0]
        if (call.method === 'select') {
          const sel = literal(first)
          if (sel !== null) walkSelect(table, parseSelect(sel))
        } else if (COLUMN_FIRST.has(call.method)) {
          const name = literal(first)
          if (name === null) continue
          let tbl = table
          if (call.method === 'order' && call.args[1]) {
            const ref = /(?:referencedTable|foreignTable)\s*:\s*(['"`])([A-Za-z_0-9]+)\1/.exec(call.args[1])
            if (ref) tbl = embeds.get(ref[2]) || null
          }
          if (tbl === table) {
            const r = resolve(name)
            if (r && IDENT.test(r.name)) column(r.tbl, r.name, call.method === 'order' ? 'order' : 'filter')
          } else if (tbl && IDENT.test(name)) column(tbl, name, 'order')
        } else if (call.method === 'or') {
          const text2 = literal(first)
          if (text2 === null) continue
          let tbl = table
          const ref = call.args[1] && /(?:referencedTable|foreignTable)\s*:\s*(['"`])([A-Za-z_0-9]+)\1/.exec(call.args[1])
          if (ref) tbl = embeds.get(ref[2]) || null
          if (tbl) for (const name of filterColumns(text2)) column(tbl, name, 'filter')
        } else if (call.method === 'match') {
          for (const key of objectKeys(first || '') || []) column(table, key, 'filter')
        } else if (call.method === 'insert' || call.method === 'upsert' || call.method === 'update') {
          const via = call.method === 'update' ? 'update' : 'insert'
          const arg = (first || '').trim()
          const objects = arg.startsWith('[') ? splitTop(arg.slice(1, readBalanced(arg, 0) - 1)) : [arg]
          for (const obj of objects) for (const key of objectKeys(obj) || []) column(table, key, via)
          const conflict = call.args[1] && /onConflict\s*:\s*(['"`])([^'"`]+)\1/.exec(call.args[1])
          if (conflict) for (const key of conflict[2].split(',')) column(table, key.trim(), 'onConflict')
        }
      }
    }
  }
  return refs
}

// ---- comparing ---------------------------------------------------------------

function argsFit(names, overload) {
  if (overload === null) return true
  const params = new Set(overload.map((p) => p.name))
  if (!names.every((n) => params.has(n))) return false
  return overload.every((p) => p.optional || names.includes(p.name))
}

/**
 * The references the schema does not have.
 * @returns {{ kind: 'rpc' | 'rpc-args' | 'table' | 'column', name: string, file: string, line: number, detail?: string }[]}
 */
export function compareRefs(refs, schema) {
  const problems = []
  const seen = new Set()
  const add = (p) => {
    const key = `${p.kind} ${p.name} ${p.file}:${p.line}`
    if (seen.has(key)) return
    seen.add(key)
    problems.push(p)
  }
  for (const r of refs.rpcs) {
    const fn = schema.functions[r.name]
    if (!fn) { add({ kind: 'rpc', name: r.name, file: r.file, line: r.line }); continue }
    if (r.args && !fn.overloads.some((o) => argsFit(r.args, o))) {
      const want = fn.overloads.map((o) => (o ? o.map((p) => p.name + (p.optional ? '?' : '')).join(', ') : 'any')).join(' | ')
      add({ kind: 'rpc-args', name: r.name, file: r.file, line: r.line, detail: `called with (${r.args.join(', ')}), takes (${want})` })
    }
  }
  for (const t of refs.tables) {
    if (schema.tables[t.name]) continue
    // An embed may name a foreign key column instead of a table.
    if (t.embed && schema.tables[t.parent]?.columns.includes(t.name)) continue
    if (t.embed && !schema.tables[t.parent]) continue
    add({ kind: 'table', name: t.name, file: t.file, line: t.line })
  }
  for (const c of refs.columns) {
    const table = schema.tables[c.table]
    if (!table) continue
    if (!table.columns.includes(c.column)) add({ kind: 'column', name: `${c.table}.${c.column}`, file: c.file, line: c.line, detail: c.via })
  }
  return problems
}

// ---- production schema ---------------------------------------------------------

/**
 * How production can be read with the given environment.
 *
 * The anon key is not enough. PostgREST builds its OpenAPI document for the
 * role that asks (openapi-mode follow-privileges, Supabase's setting) and
 * leaves out every table and function that role cannot use, and the
 * migrations revoke EXECUTE from anon on many functions. Read with the anon
 * key, those would look missing. Supabase also restricts that document to
 * secret and service keys. So production is read either from the catalog
 * (SUPABASE_DB_URL, a read only connection string) or from the OpenAPI
 * document with the service role key.
 * @param {Record<string, string | undefined>} env
 */
export function productionPlan(env) {
  const dbUrl = (env.SUPABASE_DB_URL || '').trim()
  if (dbUrl) return { kind: 'catalog', dbUrl }
  const url = (env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').trim().replace(/\/+$/, '')
  const key = (env.SUPABASE_SERVICE_ROLE_KEY || '').trim()
  if (url && key) return { kind: 'openapi', url: `${url}/rest/v1/`, key }
  return {
    kind: 'none',
    reason: 'Production was not checked: set SUPABASE_DB_URL, or SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. The anon key cannot see functions revoked from anon.'
  }
}

/** The schema a PostgREST OpenAPI document describes. */
export function schemaFromOpenApi(doc) {
  const schema = { tables: {}, functions: {} }
  for (const [name, def] of Object.entries(doc?.definitions ?? {})) {
    schema.tables[name] = { columns: Object.keys(def?.properties ?? {}), view: false }
  }
  for (const [path, item] of Object.entries(doc?.paths ?? {})) {
    const m = /^\/rpc\/([A-Za-z_0-9]+)$/.exec(path)
    if (!m) continue
    const body = (item?.post?.parameters ?? []).find((p) => p.in === 'body')
    const props = body?.schema?.properties
    if (!props) { schema.functions[m[1]] = { overloads: [null] }; continue }
    const required = new Set(body.schema.required ?? [])
    const params = Object.keys(props).map((name) => ({ name, optional: !required.has(name) }))
    schema.functions[m[1]] = { overloads: [params.some((p) => p.name === '') ? null : params] }
  }
  return schema
}

/**
 * The schema from catalog rows: columns as { table, column } and function
 * overloads as { name, args: [{ name, optional }] }.
 */
export function schemaFromCatalog({ columns, functions }) {
  const schema = { tables: {}, functions: {} }
  for (const { table, column } of columns) {
    (schema.tables[table] ||= { columns: [], view: false }).columns.push(column)
  }
  for (const { name, args } of functions) {
    const fn = (schema.functions[name] ||= { overloads: [] })
    fn.overloads.push(args.some((a) => a.name === '') ? null : args)
  }
  return schema
}

/** One line per problem, for the console. */
export function formatProblems(problems) {
  return problems.map((p) => {
    const what = { rpc: 'function', 'rpc-args': 'function arguments', table: 'table', column: 'column' }[p.kind]
    return `  ${p.file}:${p.line}  ${what} ${p.name}${p.detail ? ` (${p.detail})` : ''}`
  })
}
