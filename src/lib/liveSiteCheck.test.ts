import { execFile } from 'node:child_process'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

// T4. Every live Netlify function answered 500 for days because the Supabase
// server key was missing, and nothing noticed. scripts/check-live-site.mjs is
// the daily check (.github/workflows/live-site-check.yml). These tests run it
// against a stub server on this machine, never against the live site.
import { checkSite } from '../../scripts/check-live-site.mjs'

const SCRIPT = fileURLToPath(new URL('../../scripts/check-live-site.mjs', import.meta.url))
const PAGE = '<!doctype html><html><head><script type="module" crossorigin src="/assets/index-abc123.js"></script></head><body><div id="root"></div></body></html>'

type Seen = { method: string; url: string; headers: IncomingMessage['headers']; body: string }
type Handler = (req: IncomingMessage, res: ServerResponse, body: string) => void

const send = (res: ServerResponse, status: number, type: string, body: string) => { res.writeHead(status, { 'content-type': type }); res.end(body) }
const sendJson = (res: ServerResponse, status: number, body: unknown) => send(res, status, 'application/json', JSON.stringify(body))

// A healthy site: the page, its script, and 404 for tokens that do not exist.
const healthy: Handler = (req, res) => {
  const path = (req.url || '').split('?')[0]
  if (path === '/') return send(res, 200, 'text/html; charset=UTF-8', PAGE)
  if (path === '/assets/index-abc123.js') return send(res, 200, 'application/javascript', 'console.log(1)')
  if (path === '/api/public-link') return sendJson(res, 404, { error: 'not_found', message: 'This link is no longer available.' })
  if (path === '/api/partner-invite-info') return sendJson(res, 404, { error: 'invite_not_found' })
  if (path === '/api/org-invite-info') return sendJson(res, 404, { error: 'invite_not_found' })
  return send(res, 200, 'text/html; charset=UTF-8', PAGE) // the SPA fallback
}

let server: Server | null = null
let seen: Seen[] = []

async function stub(handler: Handler): Promise<string> {
  seen = []
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c })
    req.on('end', () => { seen.push({ method: req.method || '', url: req.url || '', headers: req.headers, body }); handler(req, res, body) })
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

async function stopStub() {
  if (!server) return
  server.closeAllConnections()
  await new Promise<void>((resolve) => server!.close(() => resolve()))
  server = null
}

afterEach(stopStub)

function runCli(url: string): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile(process.execPath, [SCRIPT, url], { timeout: 30_000 }, (error, stdout, stderr) => {
      resolve({ code: error ? Number((error as any).code ?? 1) : 0, out: `${stdout}${stderr}` })
    })
  })
}

const failed = (results: Array<{ name: string; ok: boolean }>) => results.filter((r) => !r.ok).map((r) => r.name)

describe('live site check', () => {
  it('passes a healthy site and exits 0', async () => {
    const url = await stub(healthy)
    const results = await checkSite(url)
    expect(failed(results)).toEqual([])
    expect(results.map((r) => r.name)).toEqual(['Home page', 'App script', 'Customer link function', 'Partner invite function', 'Team invite function'])
    const cli = await runCli(url)
    expect(cli.code).toBe(0)
  })

  it('fails every function that answers a server error, and the run exits 1', async () => {
    const url = await stub((req, res, body) => {
      if ((req.url || '').startsWith('/api/')) return sendJson(res, 500, { error: 'server_misconfigured' })
      return healthy(req, res, body)
    })
    const results = await checkSite(url)
    expect(failed(results)).toEqual(['Customer link function', 'Partner invite function', 'Team invite function'])
    expect(results.find((r) => r.name === 'Customer link function')!.detail).toMatch(/500.*server_misconfigured/)
    const cli = await runCli(url)
    expect(cli.code).toBe(1)
    expect(cli.out).toMatch(/Customer link function/)
    expect(cli.out).toMatch(/server_misconfigured/)
  })

  it('fails a function that is missing, where the site falls back to the app page', async () => {
    const url = await stub((req, res, body) => {
      if ((req.url || '').startsWith('/api/public-link')) return send(res, 200, 'text/html; charset=UTF-8', PAGE)
      return healthy(req, res, body)
    })
    expect(failed(await checkSite(url))).toEqual(['Customer link function'])
  })

  it('fails when the page or its script does not load', async () => {
    const broken = await stub((req, res, body) => {
      if (req.url === '/') return send(res, 503, 'text/html', 'Service unavailable')
      return healthy(req, res, body)
    })
    expect(failed(await checkSite(broken))).toEqual(['Home page', 'App script'])
    await stopStub()

    const noScript = await stub((req, res, body) => {
      if ((req.url || '').startsWith('/assets/')) return send(res, 404, 'text/html', 'Not found')
      return healthy(req, res, body)
    })
    expect(failed(await checkSite(noScript))).toEqual(['App script'])
  })

  it('fails, rather than hanging, when the site does not answer', async () => {
    const url = await stub(() => { /* never answers */ })
    const results = await checkSite(url, { timeoutMs: 200 })
    expect(failed(results)).toEqual(['Home page', 'App script', 'Customer link function', 'Partner invite function', 'Team invite function'])
  })

  it('asks only harmless questions and sends no credentials', async () => {
    const url = await stub(healthy)
    await checkSite(url)
    expect(seen.map((s) => `${s.method} ${s.url.split('?')[0]}`)).toEqual([
      'GET /', 'GET /assets/index-abc123.js', 'GET /api/public-link', 'GET /api/partner-invite-info', 'POST /api/org-invite-info',
    ])
    for (const s of seen) {
      expect(s.headers.authorization).toBeUndefined()
      expect(s.headers.cookie).toBeUndefined()
    }
    const tokens = seen.filter((s) => s.url.startsWith('/api/')).map((s) => new URL(s.url, url).searchParams.get('token') ?? JSON.parse(s.body).token)
    expect(new Set(tokens).size).toBe(1)
    expect(tokens[0]).toMatch(/^uptime-check-/)
  })
})
