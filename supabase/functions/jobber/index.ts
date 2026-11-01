// jobber: Jobber is the system of record. This function connects a Jobber account
// to a company (OAuth with PKCE), receives Jobber webhooks, and mirrors Jobber
// clients, requests, quotes, jobs, invoices and visits into the Fieldhorse core
// tables through the fh_jobber_apply RPC (migration 080). The growth engine
// triggers on those tables emit the events every workflow already understands.
//
// Routes (all under {FUNCTIONS_URL}/jobber):
//   GET  /callback?code&state        Jobber redirects here after the owner approves the app
//   POST /webhook                    Jobber webhooks (X-Jobber-Hmac-SHA256 over the raw body)
//   POST /connect   {org_id}         signed in manager: returns the Jobber authorize URL
//   GET  /status?org=<org_id>        signed in member: connection and sync status
//   POST /disconnect {org_id}        signed in manager: revoke at Jobber and forget the tokens
//   POST /sync {org_id, mode}        manager or worker secret: history load (full) or catch up (recent)
//   POST /process {account_id?}      worker secret: drain queued webhook events
//   GET  /schema?org=<org_id>        worker secret: the pruned selections in use (debugging)
//   GET  /health
//
// Secrets: JOBBER_CLIENT_ID, JOBBER_CLIENT_SECRET, WORKER_SECRET. Optional: APP_URL
// (where the callback sends the browser afterwards), JOBBER_GRAPHQL_VERSION.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";
import { admin, json, text, htmlEscape, readBody, jobberSignatureOk, rpc, log, tick, SUPABASE_URL, FUNCTIONS_URL } from "./lib.ts";

const TOKEN_URL = "https://api.getjobber.com/api/oauth/token";
const GRAPHQL_URL = "https://api.getjobber.com/api/graphql";
const GRAPHQL_VERSION = Deno.env.get("JOBBER_GRAPHQL_VERSION") ?? "2025-04-16";
const CLIENT_ID = Deno.env.get("JOBBER_CLIENT_ID") ?? "";
const CLIENT_SECRET = Deno.env.get("JOBBER_CLIENT_SECRET") ?? "";
const WORKER_SECRET = Deno.env.get("WORKER_SECRET") ?? "";
const APP_URL = (Deno.env.get("APP_URL") ?? "").replace(/\/$/, "");
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const CHUNK_BUDGET_MS = 40_000;
const PAGE_SIZE = 25;
const OLD_OBJECT_MS = 24 * 3600 * 1000;

// ---------------------------------------------------------------------------
// selections: what we want from each Jobber type. Introspection prunes any
// field this API version does not have, so a rename on Jobber's side costs a
// column, never the whole sync.
// ---------------------------------------------------------------------------
type Sel = { [field: string]: true | string | Sel };
const ADDRESS: Sel = { street1: true, street2: true, street: true, city: true, province: true, postalCode: true, country: true };
const CLIENT: Sel = {
  id: true, firstName: true, lastName: true, companyName: true, name: true, title: true, isCompany: true, isLead: true, isArchived: true,
  createdAt: true, updatedAt: true, jobberWebUri: true,
  emails: { id: true, address: true, description: true, primary: true },
  phones: { id: true, number: true, description: true, primary: true, smsAllowed: true },
  billingAddress: ADDRESS,
  clientProperties: { __args: "(first: 5)", nodes: { id: true, address: ADDRESS } },
  properties: { __args: "(first: 5)", nodes: { id: true, address: ADDRESS } },
  tags: { __args: "(first: 30)", nodes: { label: true } },
};
const REQUEST: Sel = {
  id: true, title: true, requestStatus: true, createdAt: true, updatedAt: true, jobberWebUri: true, contactName: true, email: true, phone: true, companyName: true, source: true,
  client: { id: true }, property: { id: true, address: ADDRESS }, assessment: { id: true, startAt: true, endAt: true, completedAt: true },
};
const QUOTE: Sel = {
  id: true, quoteNumber: true, title: true, quoteStatus: true, createdAt: true, updatedAt: true, transitionedAt: true, jobberWebUri: true, clientHubUri: true, message: true,
  client: { id: true }, property: { id: true, address: ADDRESS }, request: { id: true }, jobs: { __args: "(first: 5)", nodes: { id: true } },
  amounts: { subtotal: true, total: true, depositAmount: true, discountAmount: true, taxAmount: true, outstandingDepositAmount: true, nonTaxAmount: true },
};
const JOB: Sel = {
  id: true, jobNumber: true, title: true, jobStatus: true, jobType: true, startAt: true, endAt: true, completedAt: true, total: true, createdAt: true, updatedAt: true, jobberWebUri: true, instructions: true,
  client: { id: true }, property: { id: true, address: ADDRESS }, quote: { id: true }, invoices: { __args: "(first: 10)", nodes: { id: true } },
};
const INVOICE: Sel = {
  id: true, invoiceNumber: true, subject: true, invoiceStatus: true, dueDate: true, issuedDate: true, receivedDate: true, createdAt: true, updatedAt: true, jobberWebUri: true, clientHubUri: true, message: true,
  client: { id: true }, jobs: { __args: "(first: 5)", nodes: { id: true } }, linkedJobs: { __args: "(first: 5)", nodes: { id: true } },
  amounts: { subtotal: true, total: true, depositAmount: true, discountAmount: true, invoiceBalance: true, paymentsTotal: true, taxAmount: true, tipsTotal: true },
};
const VISIT: Sel = {
  id: true, title: true, instructions: true, visitStatus: true, startAt: true, endAt: true, completedAt: true, allDay: true, createdAt: true, updatedAt: true, isComplete: true,
  client: { id: true }, property: { id: true, address: ADDRESS }, job: { id: true, jobNumber: true, title: true },
  assignedUsers: { __args: "(first: 10)", nodes: { id: true, name: { full: true } } },
};

type Entity = "client" | "request" | "quote" | "job" | "invoice" | "visit";
const ENTITIES: Record<Entity, { one: string; list: string; type: string; spec: Sel; cap: number }> = {
  client: { one: "client", list: "clients", type: "Client", spec: CLIENT, cap: 6000 },
  request: { one: "request", list: "requests", type: "Request", spec: REQUEST, cap: 3000 },
  quote: { one: "quote", list: "quotes", type: "Quote", spec: QUOTE, cap: 3000 },
  job: { one: "job", list: "jobs", type: "Job", spec: JOB, cap: 4000 },
  visit: { one: "visit", list: "visits", type: "Visit", spec: VISIT, cap: 4000 },
  invoice: { one: "invoice", list: "invoices", type: "Invoice", spec: INVOICE, cap: 4000 },
};
const SYNC_ORDER: Entity[] = ["client", "request", "quote", "job", "visit", "invoice"];

const TOPIC_ENTITY: Record<string, Entity | "skip" | "connect" | "disconnect"> = {
  CLIENT_CREATE: "client", CLIENT_UPDATE: "client",
  REQUEST_CREATE: "request", REQUEST_UPDATE: "request",
  QUOTE_CREATE: "quote", QUOTE_UPDATE: "quote", QUOTE_SENT: "quote", QUOTE_APPROVED: "quote",
  JOB_CREATE: "job", JOB_UPDATE: "job", JOB_CLOSED: "job",
  INVOICE_CREATE: "invoice", INVOICE_UPDATE: "invoice",
  VISIT_CREATE: "visit", VISIT_UPDATE: "visit", VISIT_COMPLETE: "visit",
  PAYMENT_CREATE: "skip", PAYMENT_UPDATE: "skip",
  APP_CONNECT: "connect", APP_DISCONNECT: "disconnect",
};

// ---------------------------------------------------------------------------
// http
// ---------------------------------------------------------------------------
Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "OPTIONS") return text("", 204);
  const idx = url.pathname.indexOf("/jobber");
  const path = (idx >= 0 ? url.pathname.slice(idx + "/jobber".length) : url.pathname).replace(/\/+$/, "") || "/";
  try {
    if (path === "/health") return json({ ok: true, configured: !!(CLIENT_ID && CLIENT_SECRET), version: GRAPHQL_VERSION });
    if (path === "/callback" && req.method === "GET") return await handleCallback(req, url);
    if (path === "/webhook" && req.method === "POST") return await handleWebhook(req);
    if (path === "/connect" && req.method === "POST") return await handleConnect(req);
    if (path === "/status" && req.method === "GET") return await handleStatus(req, url);
    if (path === "/disconnect" && req.method === "POST") return await handleDisconnect(req);
    if (path === "/sync" && req.method === "POST") return await handleSync(req);
    if (path === "/process" && req.method === "POST") return await handleProcess(req);
    if (path === "/schema" && req.method === "GET") return await handleSchema(req, url);
    return json({ error: "not found" }, 404);
  } catch (e) {
    log("jobber", "unhandled", (e as Error).message);
    return json({ error: (e as Error).message }, 500);
  }
});

function workerOk(req: Request): boolean {
  const h = req.headers.get("authorization") ?? "";
  return !!WORKER_SECRET && h === `Bearer ${WORKER_SECRET}`;
}

function userClient(req: Request): SupabaseClient | null {
  const h = req.headers.get("authorization") ?? "";
  if (!h.startsWith("Bearer ") || !ANON_KEY) return null;
  return createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: h } }, auth: { persistSession: false, autoRefreshToken: false } });
}

function waitUntil(p: Promise<unknown>) {
  // deno-lint-ignore no-explicit-any
  const rt = (globalThis as any).EdgeRuntime;
  if (rt?.waitUntil) rt.waitUntil(p.catch((e: Error) => log("jobber", "background failed", e.message)));
  else p.catch((e: Error) => log("jobber", "background failed", e.message));
}

// ---------------------------------------------------------------------------
// connect + callback
// ---------------------------------------------------------------------------
async function handleConnect(req: Request): Promise<Response> {
  const user = userClient(req);
  if (!user) return json({ error: "sign in required" }, 401);
  const { data } = await readBody(req);
  const orgId = String(data.org_id ?? "");
  if (!orgId) return json({ error: "org_id required" }, 400);
  const { data: res, error } = await user.rpc("fh_jobber_connect_start", { p_org_id: orgId, p_redirect_to: data.redirect_to ?? null });
  if (error) return json({ error: error.message }, error.message.includes("not allowed") ? 403 : 400);
  return json(res);
}

async function handleCallback(req: Request, url: URL): Promise<Response> {
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const denied = url.searchParams.get("error");
  if (denied) return page("Connection cancelled", `Jobber reported: ${htmlEscape(denied)}. Nothing was changed. You can close this tab and try again from Settings.`, false);
  if (!code || !state) return page("Missing details", "Jobber did not send a code and state. Start the connection again from Settings.", false);
  if (!CLIENT_ID || !CLIENT_SECRET) return page("Not configured yet", "JOBBER_CLIENT_ID and JOBBER_CLIENT_SECRET are not set on this function. Add them in Supabase Edge Function secrets, then start the connection again.", false);
  const db = admin();
  const st = await rpc<Record<string, string> | null>(db, "fh_jobber_oauth_state_take", { p_state: state });
  if (!st) return page("Link expired", "That connection link was already used or has expired. Start the connection again from Settings.", false);

  const redirectUri = FUNCTIONS_URL + "/jobber/callback";
  const form = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "authorization_code", code, redirect_uri: redirectUri, code_verifier: st.code_verifier });
  const tres = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString() });
  const tok = await tres.json().catch(() => ({}));
  if (!tres.ok || !tok.access_token) {
    log("jobber", "token exchange failed", { status: tres.status, error: tok.error, description: tok.error_description });
    return page("Jobber did not accept the connection", `Token exchange failed (${tres.status} ${htmlEscape(String(tok.error ?? ""))}). Check that the callback URL on the Jobber app is exactly ${htmlEscape(redirectUri)}, then try again.`, false);
  }
  const expiresAt = new Date(Date.now() + Number(tok.expires_in ?? 3600) * 1000).toISOString();
  // the connection row first, so the account lookup below can use the normal token path
  const integrationId = await rpc<string>(db, "fh_jobber_connection_upsert", {
    p_org_id: st.org_id, p_user_id: st.user_id ?? null, p_account_id: null, p_display_name: null, p_scopes: tok.scope ?? null,
    p_access: tok.access_token, p_refresh: tok.refresh_token ?? null, p_expires_at: expiresAt,
    p_meta: { graphql_version: GRAPHQL_VERSION, token_type: tok.token_type ?? "Bearer" },
  });
  let accountId: string | null = null;
  let accountName: string | null = null;
  try {
    const acct = await fetchAccount(db, integrationId);
    accountId = acct.id; accountName = acct.name;
    await rpc(db, "fh_jobber_connection_upsert", {
      p_org_id: st.org_id, p_user_id: st.user_id ?? null, p_account_id: accountId, p_display_name: accountName, p_scopes: tok.scope ?? null,
      p_access: tok.access_token, p_refresh: tok.refresh_token ?? null, p_expires_at: expiresAt, p_meta: {},
    });
  } catch (e) {
    // APP_CONNECT carries the account id; fh_jobber_account_claim picks it up
    log("jobber", "account lookup failed, waiting for APP_CONNECT", (e as Error).message);
  }
  // kick the history load: queued state + pg_net kick, and an inline chunk in case pg_net is quiet
  try { await rpc(db, "fh_jobber_sync_request", { p_org_id: st.org_id, p_mode: "full" }); } catch (e) { log("jobber", "sync request failed", (e as Error).message); }
  waitUntil(runSyncChunk(db, st.org_id, "full"));

  if (APP_URL) {
    const to = st.redirect_to && st.redirect_to.startsWith("/") ? st.redirect_to : "/settings/integrations";
    const sep = to.includes("?") ? "&" : "?";
    return Response.redirect(`${APP_URL}${to}${sep}jobber=connected`, 302);
  }
  return page("Jobber connected", `${htmlEscape(accountName ?? "Your Jobber account")} is now linked. The history load has started and new activity in Jobber will flow in on its own. You can close this tab.`, true);
}

function page(title: string, body: string, ok: boolean): Response {
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${htmlEscape(title)}</title>
<style>body{margin:0;background:#141414;color:#F2EDE4;font-family:"DM Sans",system-ui,sans-serif;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
.card{max-width:520px;background:#1c1c1c;border:1px solid #2a2a2a;border-radius:16px;padding:32px}
h1{font-family:"Bebas Neue","DM Sans",sans-serif;letter-spacing:.04em;font-size:36px;margin:0 0 12px;color:${ok ? "#C9963A" : "#F2EDE4"}}
p{line-height:1.5;color:#c9c4bb;margin:0}</style></head><body><div class="card"><h1>${htmlEscape(title)}</h1><p>${body}</p></div></body></html>`;
  return new Response(html, { status: ok ? 200 : 400, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

// ---------------------------------------------------------------------------
// status, disconnect, sync, process, schema
// ---------------------------------------------------------------------------
async function handleStatus(req: Request, url: URL): Promise<Response> {
  const user = userClient(req);
  if (!user) return json({ error: "sign in required" }, 401);
  const orgId = url.searchParams.get("org") ?? "";
  const { data, error } = await user.rpc("fh_jobber_status", { p_org_id: orgId });
  if (error) return json({ error: error.message }, error.message.includes("not allowed") ? 403 : 400);
  return json(data);
}

async function handleDisconnect(req: Request): Promise<Response> {
  const user = userClient(req);
  if (!user) return json({ error: "sign in required" }, 401);
  const { data } = await readBody(req);
  const orgId = String(data.org_id ?? "");
  // manager check through a guarded RPC before touching anything
  const { error: guard } = await user.rpc("fh_jobber_settings_set", { p_org_id: orgId, p_patch: {} });
  if (guard) return json({ error: guard.message }, guard.message.includes("not allowed") ? 403 : 400);
  const db = admin();
  const info = await rpc<Record<string, unknown> | null>(db, "fh_jobber_integration_for_org", { p_org_id: orgId });
  if (!info) return json({ ok: true, already: true });
  let revoked = false;
  try {
    const res = await gql(db, String(info.integration_id), `mutation { appDisconnect { app { name } userErrors { message } } }`, {});
    revoked = !(res.data?.appDisconnect?.userErrors?.length);
  } catch (e) { log("jobber", "appDisconnect failed", (e as Error).message); }
  await rpc(db, "fh_jobber_disconnect", { p_integration: info.integration_id, p_reason: "disconnected from the app" });
  return json({ ok: true, revoked_at_jobber: revoked });
}

async function handleSync(req: Request): Promise<Response> {
  const { data } = await readBody(req);
  const orgId = String(data.org_id ?? "");
  const mode = data.mode === "recent" ? "recent" : "full";
  if (!orgId) return json({ error: "org_id required" }, 400);
  const db = admin();
  if (workerOk(req)) {
    waitUntil(runSyncChunk(db, orgId, mode));
    return json({ ok: true, started: true, mode });
  }
  const user = userClient(req);
  if (!user) return json({ error: "sign in required" }, 401);
  const { data: res, error } = await user.rpc("fh_jobber_sync_request", { p_org_id: orgId, p_mode: mode });
  if (error) return json({ error: error.message }, error.message.includes("not allowed") ? 403 : 400);
  waitUntil(runSyncChunk(db, orgId, mode));
  return json(res);
}

async function handleProcess(req: Request): Promise<Response> {
  if (!workerOk(req)) return json({ error: "forbidden" }, 403);
  const { data } = await readBody(req);
  const db = admin();
  waitUntil(processEvents(db, data.account_id ? String(data.account_id) : null, Number(data.limit ?? 50)));
  return json({ ok: true, started: true });
}

async function handleSchema(req: Request, url: URL): Promise<Response> {
  if (!workerOk(req)) return json({ error: "forbidden" }, 403);
  const db = admin();
  const info = await rpc<Record<string, unknown> | null>(db, "fh_jobber_integration_for_org", { p_org_id: url.searchParams.get("org") ?? "" });
  if (!info || info.status !== "connected") return json({ error: "not connected" }, 400);
  const intId = String(info.integration_id);
  const out: Record<string, unknown> = {};
  for (const [k, e] of Object.entries(ENTITIES)) {
    const q = await typeInfo(db, intId, "Query");
    out[k] = { one: q?.fields.has(e.one) ?? false, list: q?.fields.has(e.list) ?? false, selection: await buildSelection(db, intId, e.type, e.spec), listArgs: q?.fields.get(e.list)?.args ?? [] };
  }
  return json(out);
}

// ---------------------------------------------------------------------------
// webhooks
// ---------------------------------------------------------------------------
async function handleWebhook(req: Request): Promise<Response> {
  const { data: body, raw } = await readBody(req);
  if (!(await jobberSignatureOk(req, raw, CLIENT_SECRET))) {
    log("jobber", "bad webhook signature");
    return text("forbidden", 403);
  }
  // deno-lint-ignore no-explicit-any
  const ev: any = (body as any)?.data?.webHookEvent ?? {};
  const topic = String(ev.topic ?? "");
  const accountId = String(ev.accountId ?? "");
  const itemId = ev.itemId ? String(ev.itemId) : null;
  const occurredAt = ev.occurredAt ?? ev.occuredAt ?? null;
  if (!topic || !accountId) return json({ ok: true, ignored: true });
  const db = admin();
  if (topic === "APP_CONNECT") {
    try { await rpc(db, "fh_jobber_account_claim", { p_account_id: accountId }); } catch (e) { log("jobber", "account claim failed", (e as Error).message); }
  }
  const id = await rpc<string | null>(db, "fh_jobber_events_enqueue", { p_account_id: accountId, p_topic: topic, p_app_id: ev.appId ?? null, p_item_id: itemId, p_occurred_at: occurredAt, p_raw: body });
  if (id) waitUntil(processEvents(db, accountId, 50));
  // Jobber wants the acknowledgement inside a second; the work continues in the background
  return json({ ok: true, queued: !!id });
}

async function processEvents(db: SupabaseClient, accountId: string | null, limit: number): Promise<void> {
  const rows = await rpc<Array<Record<string, unknown>>>(db, "fh_jobber_events_claim", { p_limit: limit, p_account_id: accountId });
  if (!rows?.length) return;
  let applied = 0;
  for (const ev of rows) {
    try {
      const result = await processEvent(db, ev);
      await rpc(db, "fh_jobber_event_finish", { p_id: ev.id, p_status: result.status, p_error: result.error ?? null, p_result: result.result ?? null });
      if (result.status === "done") applied++;
    } catch (e) {
      await rpc(db, "fh_jobber_event_finish", { p_id: ev.id, p_status: "error", p_error: (e as Error).message, p_result: null }).catch(() => {});
    }
  }
  if (applied) await tick(db);
}

async function processEvent(db: SupabaseClient, ev: Record<string, unknown>): Promise<{ status: "done" | "skipped" | "error"; error?: string; result?: unknown }> {
  const topic = String(ev.topic);
  const kind = TOPIC_ENTITY[topic];
  const info = await rpc<Record<string, unknown> | null>(db, "fh_jobber_integration_for_account", { p_account_id: ev.account_id });
  if (!info) {
    // APP_CONNECT may arrive before the callback finished; leave it for a retry
    if (topic === "APP_CONNECT") {
      const claimed = await rpc<string | null>(db, "fh_jobber_account_claim", { p_account_id: ev.account_id });
      return claimed ? { status: "done", result: { claimed } } : { status: "error", error: "no connection for this Jobber account yet" };
    }
    return { status: "skipped", result: { reason: "no connection for this Jobber account" } };
  }
  const intId = String(info.integration_id);
  if (kind === "connect") return { status: "done", result: { integration_id: intId } };
  if (kind === "disconnect") {
    await rpc(db, "fh_jobber_disconnect", { p_integration: intId, p_reason: "disconnected in Jobber" });
    return { status: "done", result: { disconnected: intId } };
  }
  if (info.status !== "connected") return { status: "skipped", result: { reason: `connection is ${info.status}` } };
  if (!kind) return { status: "skipped", result: { reason: "topic not handled" } };
  if (kind === "skip") return { status: "skipped", result: { reason: "covered by INVOICE_UPDATE" } };
  if (!ev.item_id) return { status: "skipped", result: { reason: "no item id" } };
  const res = await mirror(db, intId, kind, String(ev.item_id), { closed: topic === "JOB_CLOSED" });
  return { status: "done", result: res };
}

/** Fetch one object from Jobber and apply it, pulling the client first when the engine has not seen it. */
async function mirror(db: SupabaseClient, intId: string, entity: Entity, id: string, opts: { closed?: boolean; suppress?: boolean } = {}): Promise<unknown> {
  const obj = await fetchOne(db, intId, entity, id);
  if (!obj) return { skipped: "not found at jobber", entity, id };
  return await applyObject(db, intId, entity, obj, opts);
}

async function applyObject(db: SupabaseClient, intId: string, entity: Entity, obj: Record<string, unknown>, opts: { closed?: boolean; suppress?: boolean } = {}): Promise<unknown> {
  let suppress = opts.suppress ?? false;
  if (!suppress) {
    // an old object the engine never saw is history: mirror it quietly
    const created = Date.parse(String(obj.createdAt ?? ""));
    if (!Number.isNaN(created) && Date.now() - created > OLD_OBJECT_MS) {
      const known = await rpc<string | null>(db, "fh_jobber_ref", { p_integration: intId, p_entity: entity, p_ext: String(obj.id) });
      if (!known) suppress = true;
    }
  }
  let res = await rpc<Record<string, unknown>>(db, "fh_jobber_apply", { p_integration: intId, p_entity: entity, p_obj: obj, p_opts: { suppress, closed: !!opts.closed } });
  if (res?.skipped === "client_missing" && res.client_ext) {
    const client = await fetchOne(db, intId, "client", String(res.client_ext));
    if (client) {
      await rpc(db, "fh_jobber_apply", { p_integration: intId, p_entity: "client", p_obj: client, p_opts: { suppress: true } });
      res = await rpc<Record<string, unknown>>(db, "fh_jobber_apply", { p_integration: intId, p_entity: entity, p_obj: obj, p_opts: { suppress, closed: !!opts.closed } });
    }
  }
  return res;
}

// ---------------------------------------------------------------------------
// history load
// ---------------------------------------------------------------------------
async function runSyncChunk(db: SupabaseClient, orgId: string, mode: "full" | "recent"): Promise<void> {
  const info = await rpc<Record<string, unknown> | null>(db, "fh_jobber_integration_for_org", { p_org_id: orgId });
  if (!info || info.status !== "connected") return;
  const intId = String(info.integration_id);
  if (!(await rpc<boolean>(db, "fh_jobber_sync_lease", { p_integration: intId, p_seconds: 120 }))) { log("jobber", "sync busy", { orgId }); return; }
  // deno-lint-ignore no-explicit-any
  const sync: any = (info.metadata as any)?.sync ?? {};
  if (sync.status === "done" && !sync.requested_at) { await releaseLease(db, intId); return; }
  const stages = SYNC_ORDER;
  let stageIdx = Math.max(0, stages.indexOf((sync.stage as Entity) ?? "client"));
  let cursor: string | null = sync.cursor ?? null;
  const counts: Record<string, number> = { ...(sync.counts ?? {}) };
  const errors: Record<string, number> = { ...(sync.errors ?? {}) };
  let lastError: string | null = sync.error ?? null;
  const since: string | null = mode === "recent" ? new Date(Date.now() - 36 * 3600 * 1000).toISOString() : null;
  const started = Date.now();
  const save = (patch: Record<string, unknown>) =>
    rpc(db, "fh_jobber_sync_state_set", { p_integration: intId, p_patch: { status: "running", mode, stage: stages[stageIdx] ?? null, cursor, counts, errors, error: lastError, updated_at: new Date().toISOString(), ...patch } });
  await save({});
  try {
    while (stageIdx < stages.length) {
      const entity = stages[stageIdx];
      const page = await fetchList(db, intId, entity, cursor, PAGE_SIZE, entity === "visit" ? (since ?? new Date(Date.now() - 90 * 86400 * 1000).toISOString()) : since);
      if (page === null) { stageIdx++; cursor = null; await save({}); continue; } // list not available on this API version
      for (const obj of page.nodes) {
        try {
          await applyObject(db, intId, entity, obj, { suppress: mode === "full" });
          counts[entity] = (counts[entity] ?? 0) + 1;
        } catch (e) {
          errors[entity] = (errors[entity] ?? 0) + 1;
          lastError = `${entity} ${String(obj.id)}: ${(e as Error).message}`.slice(0, 500);
          log("jobber", "apply failed", { entity, id: obj.id, error: (e as Error).message });
        }
      }
      cursor = page.hasNextPage ? page.endCursor : null;
      if (!page.hasNextPage || (counts[entity] ?? 0) >= ENTITIES[entity].cap) { stageIdx++; cursor = null; }
      await save({});
      if (Date.now() - started > CHUNK_BUDGET_MS && stageIdx < stages.length) {
        await save({ lease_until: null });
        await rpc(db, "fh_jobber_kick", { p_path: "sync", p_body: { org_id: orgId, mode, source: "chain" } });
        return;
      }
    }
    await save({ status: "done", stage: null, cursor: null, finished_at: new Date().toISOString(), requested_at: null, lease_until: null });
    await tick(db);
  } catch (e) {
    lastError = (e as Error).message.slice(0, 500);
    log("jobber", "sync chunk failed", lastError);
    await save({ status: "error", lease_until: null });
    if (/reauthorize|not connected/i.test(lastError)) await rpc(db, "fh_jobber_mark_error", { p_integration: intId, p_status: "expired", p_error: lastError }).catch(() => {});
  }
}

async function releaseLease(db: SupabaseClient, intId: string) {
  await rpc(db, "fh_jobber_sync_state_set", { p_integration: intId, p_patch: { lease_until: null } }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Jobber API: tokens, GraphQL, introspection
// ---------------------------------------------------------------------------
type Tokens = { integration_id: string; org_id: string; status: string; account_id: string | null; access_token: string | null; refresh_token: string | null; expires_at: string | null; metadata: Record<string, unknown> };

async function accessToken(db: SupabaseClient, intId: string, force = false): Promise<string> {
  let t = await rpc<Tokens | null>(db, "fh_jobber_tokens_get", { p_integration: intId });
  if (!t || t.status !== "connected" || !t.access_token) throw new Error("not connected");
  const expiresIn = t.expires_at ? Date.parse(t.expires_at) - Date.now() : 0;
  if (!force && expiresIn > 120_000) return t.access_token;
  const lease = await rpc<boolean>(db, "fh_jobber_refresh_lease", { p_integration: intId, p_seconds: 30 });
  if (!lease) {
    await sleep(2500);
    t = await rpc<Tokens | null>(db, "fh_jobber_tokens_get", { p_integration: intId });
    if (t?.access_token && t.expires_at && Date.parse(t.expires_at) - Date.now() > 120_000) return t.access_token;
    // The other worker owns the rotating refresh token. Never exchange it
    // without the lease, even after waiting; a later queue retry can try again.
    throw new Error("token refresh in progress; retry later");
  }
  if (!t?.refresh_token) throw new Error("reauthorize: no refresh token");
  const form = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: "refresh_token", refresh_token: t.refresh_token });
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: form.toString() });
  const tok = await res.json().catch(() => ({}));
  if (!res.ok || !tok.access_token) {
    const msg = `reauthorize: refresh failed (${res.status} ${tok.error ?? ""})`;
    if (res.status === 400 || res.status === 401) await rpc(db, "fh_jobber_mark_error", { p_integration: intId, p_status: "expired", p_error: msg }).catch(() => {});
    throw new Error(msg);
  }
  const expiresAt = new Date(Date.now() + Number(tok.expires_in ?? 3600) * 1000).toISOString();
  await rpc(db, "fh_jobber_tokens_set", { p_integration: intId, p_access: tok.access_token, p_refresh: tok.refresh_token ?? null, p_expires_at: expiresAt });
  return tok.access_token;
}

class GqlError extends Error {
  constructor(msg: string, public errors: unknown[]) { super(msg); }
}

// deno-lint-ignore no-explicit-any
async function gql(db: SupabaseClient, intId: string, query: string, variables: Record<string, unknown>, attempt = 0, forceRefresh = false): Promise<{ data: any; extensions: any }> {
  const token = await accessToken(db, intId, forceRefresh);
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "X-JOBBER-GRAPHQL-VERSION": GRAPHQL_VERSION, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ query, variables }),
  });
  if (res.status === 401 && attempt === 0) return gql(db, intId, query, variables, 1, true);
  if (res.status === 429 && attempt < 3) { await sleep(2000 * (attempt + 1)); return gql(db, intId, query, variables, attempt + 1); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`jobber ${res.status}: ${JSON.stringify(body).slice(0, 300)}`);
  const errors: Array<{ message?: string; extensions?: { code?: string } }> = body.errors ?? [];
  if (errors.length) {
    if (errors.some((e) => e.extensions?.code === "THROTTLED") && attempt < 4) {
      const ts = body.extensions?.cost?.throttleStatus;
      const need = Math.max(0, Number(body.extensions?.cost?.requestedQueryCost ?? 1000) - Number(ts?.currentlyAvailable ?? 0));
      await sleep(Math.min(20_000, 1000 + (need / Math.max(1, Number(ts?.restoreRate ?? 500))) * 1000));
      return gql(db, intId, query, variables, attempt + 1);
    }
    throw new GqlError("graphql: " + errors.map((e) => e.message).join("; ").slice(0, 500), errors);
  }
  const avail = Number(body.extensions?.cost?.throttleStatus?.currentlyAvailable ?? 10_000);
  if (avail < 1500) await sleep(2000);
  return { data: body.data ?? {}, extensions: body.extensions ?? {} };
}

async function fetchAccount(db: SupabaseClient, intId: string): Promise<{ id: string; name: string | null }> {
  const q = await typeInfo(db, intId, "Query");
  if (!INTROSPECTION_OFF && !q?.fields.has("account")) throw new Error("account query not available");
  const acct = INTROSPECTION_OFF ? null : await typeInfo(db, intId, q?.fields.get("account")?.type ?? "Account");
  const fields = INTROSPECTION_OFF ? ["id", "name"] : ["id", "name"].filter((f) => acct?.fields.has(f));
  const res = await gql(db, intId, `query { account { ${fields.join(" ")} } }`, {});
  const a = res.data?.account ?? {};
  if (!a.id) throw new Error("account id missing");
  return { id: String(a.id), name: a.name ? String(a.name) : null };
}

async function fetchOne(db: SupabaseClient, intId: string, entity: Entity, id: string): Promise<Record<string, unknown> | null> {
  const e = ENTITIES[entity];
  const q = await typeInfo(db, intId, "Query");
  const f = q?.fields.get(e.one);
  if (!f && !INTROSPECTION_OFF) throw new Error(`query ${e.one} not available on this API version`);
  const idType = f?.argTypes["id"] ?? "EncodedId!";
  const sel = await buildSelection(db, intId, f?.type ?? e.type, e.spec);
  const res = await gql(db, intId, `query One($id: ${idType}) { ${e.one}(id: $id) { ${sel} } }`, { id });
  return res.data?.[e.one] ?? null;
}

async function fetchList(db: SupabaseClient, intId: string, entity: Entity, after: string | null, first: number, since: string | null):
  Promise<{ nodes: Array<Record<string, unknown>>; hasNextPage: boolean; endCursor: string | null } | null> {
  const e = ENTITIES[entity];
  const q = await typeInfo(db, intId, "Query");
  const f = INTROSPECTION_OFF ? { args: [] as string[], argTypes: {} as Record<string, string> } : q?.fields.get(e.list);
  if (!f) return null;
  const sel = await buildSelection(db, intId, e.type, e.spec);
  const varDefs: string[] = ["$first: Int!", "$after: String"];
  const args: string[] = ["first: $first", "after: $after"];
  const variables: Record<string, unknown> = { first, after };
  let filtered = false;
  if (since && f.args.includes("filter") && f.argTypes["filter"]) {
    const filterType = f.argTypes["filter"].replace(/!|\[|\]/g, "");
    const key = entity === "visit" ? "startAt" : "updatedAt";
    const rangeType = await inputFieldType(db, intId, filterType, key);
    const range = rangeType ? await typeInfo(db, intId, rangeType) : null;
    if (range?.inputFields.has("after")) {
      varDefs.push(`$filter: ${f.argTypes["filter"]}`);
      args.push("filter: $filter");
      variables.filter = { [key]: { after: since } };
      filtered = true;
    }
  }
  // a catch up run without a date filter would re read all history every day; webhooks cover it instead
  if (since && !filtered && entity !== "visit") return { nodes: [], hasNextPage: false, endCursor: null };
  const query = `query List(${varDefs.join(", ")}) { ${e.list}(${args.join(", ")}) { nodes { ${sel} } pageInfo { hasNextPage endCursor } } }`;
  const res = await gql(db, intId, query, variables);
  const conn = res.data?.[e.list];
  if (!conn) return { nodes: [], hasNextPage: false, endCursor: null };
  return { nodes: conn.nodes ?? [], hasNextPage: !!conn.pageInfo?.hasNextPage, endCursor: conn.pageInfo?.endCursor ?? null };
}

let INTROSPECTION_OFF = false;
type FieldInfo = { name: string; type: string | null; args: string[]; argTypes: Record<string, string> };
type TypeInfo = { name: string; kind: string; fields: Map<string, FieldInfo>; inputFields: Map<string, string> };
const TYPE_CACHE = new Map<string, { at: number; info: TypeInfo | null }>();
const SEL_CACHE = new Map<string, { at: number; sel: string }>();
const CACHE_MS = 6 * 3600 * 1000;

function unwrap(t: { kind?: string; name?: string | null; ofType?: unknown } | null | undefined): string | null {
  let cur = t;
  while (cur && (cur.kind === "NON_NULL" || cur.kind === "LIST")) cur = cur.ofType as typeof cur;
  return cur?.name ?? null;
}
function typeRef(t: { kind?: string; name?: string | null; ofType?: unknown } | null | undefined): string {
  if (!t) return "";
  if (t.kind === "NON_NULL") return typeRef(t.ofType as typeof t) + "!";
  if (t.kind === "LIST") return "[" + typeRef(t.ofType as typeof t) + "]";
  return t.name ?? "";
}

async function typeInfo(db: SupabaseClient, intId: string, typeName: string): Promise<TypeInfo | null> {
  const hit = TYPE_CACHE.get(typeName);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.info;
  if (INTROSPECTION_OFF) return null;
  let res: { data: any };
  try {
    res = await gql(db, intId, `query T($n: String!) { __type(name: $n) { name kind
      fields { name args { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } }
      inputFields { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } } }`, { n: typeName });
  } catch (e) {
    if (e instanceof GqlError) { INTROSPECTION_OFF = true; log("jobber", "introspection unavailable, using static selections", e.message); return null; }
    throw e;
  }
  const t = res.data?.__type;
  if (!t && typeName === "Query") { INTROSPECTION_OFF = true; log("jobber", "introspection returned nothing, using static selections"); return null; }
  let info: TypeInfo | null = null;
  if (t) {
    const fields = new Map<string, FieldInfo>();
    for (const f of t.fields ?? []) {
      const argTypes: Record<string, string> = {};
      for (const a of f.args ?? []) argTypes[a.name] = typeRef(a.type);
      fields.set(f.name, { name: f.name, type: unwrap(f.type), args: (f.args ?? []).map((a: { name: string }) => a.name), argTypes });
    }
    const inputFields = new Map<string, string>();
    for (const f of t.inputFields ?? []) inputFields.set(f.name, unwrap(f.type) ?? "");
    info = { name: t.name, kind: t.kind, fields, inputFields };
  }
  TYPE_CACHE.set(typeName, { at: Date.now(), info });
  return info;
}

async function inputFieldType(db: SupabaseClient, intId: string, inputType: string, field: string): Promise<string | null> {
  const info = await typeInfo(db, intId, inputType);
  return info?.inputFields.get(field) ?? null;
}

async function buildSelection(db: SupabaseClient, intId: string, typeName: string, spec: Sel): Promise<string> {
  const key = `${typeName}:${JSON.stringify(spec)}`;
  const hit = SEL_CACHE.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.sel;
  const info = await typeInfo(db, intId, typeName);
  const parts: string[] = [];
  if (INTROSPECTION_OFF) {
    const sel = specToString(spec);
    SEL_CACHE.set(key, { at: Date.now(), sel });
    return sel;
  }
  if (info) {
    for (const [k, v] of Object.entries(spec)) {
      if (k === "__args" || typeof v === "string") continue;
      const f = info.fields.get(k);
      if (!f) continue;
      if (v === true) { parts.push(k); continue; }
      const child = v as Sel;
      let args = typeof child.__args === "string" ? child.__args : "";
      if (!args && f.args.includes("first")) args = "(first: 10)";
      if (args && !f.args.includes("first")) args = "";
      const inner = f.type ? await buildSelection(db, intId, f.type, child) : "";
      if (inner) parts.push(`${k}${args} { ${inner} }`);
    }
  }
  const sel = parts.join(" ");
  SEL_CACHE.set(key, { at: Date.now(), sel });
  return sel;
}

function specToString(spec: Sel): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(spec)) {
    if (k === "__args" || typeof v === "string") continue;
    if (v === true) { parts.push(k); continue; }
    const child = v as Sel;
    parts.push(`${k}${typeof child.__args === "string" ? child.__args : ""} { ${specToString(child)} }`);
  }
  return parts.join(" ");
}

function sleep(ms: number): Promise<void> { return new Promise((r) => setTimeout(r, ms)); }
