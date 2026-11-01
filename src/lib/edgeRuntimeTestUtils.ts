import { readFileSync } from 'node:fs'
import { webcrypto } from 'node:crypto'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'
import { vi } from 'vitest'

// Execute the actual Edge Function source with network and service clients
// replaced. This checks request authorization without a Deno server or secrets.
export function edgeRuntime(env: Record<string, string> = {}, overrides: Record<string, unknown> = {}) {
  const createClient = vi.fn(() => ({}))
  let handler: (request: Request) => Promise<Response>
  const context = {
    Deno: { env: { get: (key: string) => env[key] }, serve: (fn: typeof handler) => { handler = fn } },
    crypto: webcrypto, Request, Response, URL, URLSearchParams, TextEncoder, TextDecoder, AbortSignal, Uint8Array, atob, btoa, setTimeout, clearTimeout,
    console: { log: vi.fn() },
    fetch: vi.fn(() => { throw new Error('No external requests in Edge Function regression tests') }),
    ...overrides
  }
  function load(path: string, dependencies: Record<string, unknown>) {
    const exports: Record<string, any> = {}
    const source = readFileSync(new URL(`../../supabase/functions/${path}`, import.meta.url), 'utf8')
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } })
    const sandbox: Record<string, any> = { ...context, exports, require: (name: string) => {
      if (name in dependencies) return dependencies[name]
      if (name === 'jsr:@supabase/functions-js/edge-runtime.d.ts') return {}
      throw new Error(`Unexpected dependency: ${name}`)
    } }
    runInNewContext(outputText, sandbox)
    return { exports, sandbox }
  }
  const shared = load('_shared/lib.ts', { 'jsr:@supabase/supabase-js@2': { createClient } }).exports
  return { shared, createClient, load, endpoint(name: string) {
    load(`${name}/index.ts`, { './lib.ts': shared, 'jsr:@supabase/supabase-js@2': { createClient } })
    return (req: Request) => handler(req)
  } }
}

