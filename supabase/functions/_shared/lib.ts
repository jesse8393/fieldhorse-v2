// Shared helpers for the Fieldhorse growth engine edge functions.
// Copied into every function folder at deploy time (Supabase MCP deploys one folder at a time).
import { createClient, type SupabaseClient } from "jsr:@supabase/supabase-js@2";

export const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
export const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
export const FUNCTIONS_URL = (Deno.env.get("PUBLIC_FUNCTIONS_URL") ?? `${SUPABASE_URL}/functions/v1`).replace(/\/$/, "");

export function admin(): SupabaseClient {
  return createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
}

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...CORS, ...extra } });
}

export function text(body: string, status = 200, contentType = "text/plain; charset=utf-8"): Response {
  return new Response(body, { status, headers: { "Content-Type": contentType, ...CORS } });
}

export function twiml(inner: string): Response {
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${inner}</Response>`, {
    status: 200, headers: { "Content-Type": "text/xml; charset=utf-8" },
  });
}

export function xmlEscape(s: string): string {
  return (s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

export function htmlEscape(s: string): string {
  return xmlEscape(s);
}

/** Parse JSON or form encoded bodies into a plain object. */
export async function readBody(req: Request): Promise<{ data: Record<string, unknown>; raw: string }> {
  const raw = await req.text();
  const ct = (req.headers.get("content-type") ?? "").toLowerCase();
  if (!raw) return { data: {}, raw };
  if (ct.includes("application/json")) {
    try { return { data: JSON.parse(raw), raw }; } catch { return { data: {}, raw }; }
  }
  if (ct.includes("application/x-www-form-urlencoded") || ct.includes("multipart/form-data")) {
    const out: Record<string, unknown> = {};
    if (ct.includes("multipart/form-data")) {
      // re-parse from a cloned request is not possible after text(); multipart is rare for our senders
      const fd = new URLSearchParams(raw);
      for (const [k, v] of fd.entries()) out[k] = v;
      return { data: out, raw };
    }
    const params = new URLSearchParams(raw);
    for (const [k, v] of params.entries()) out[k] = v;
    return { data: out, raw };
  }
  try { return { data: JSON.parse(raw), raw }; } catch { return { data: { body: raw }, raw }; }
}

export async function sha256hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmac(algo: "SHA-1" | "SHA-256", key: string, msg: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: algo }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, new TextEncoder().encode(msg));
}

export function b64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

export function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * Twilio request signature: base64(HMAC-SHA1(authToken, url + sorted(key+value)...)).
 * Tries the URL as seen by the runtime and the public URL, since gateways rewrite hosts.
 */
export async function twilioSignatureOk(req: Request, params: Record<string, unknown>, authToken: string | undefined): Promise<boolean> {
  if (!authToken) return false;
  const sig = req.headers.get("x-twilio-signature") ?? "";
  if (!sig) return false;
  const u = new URL(req.url);
  const idx = u.pathname.indexOf("/functions/v1/");
  const tail = idx >= 0 ? u.pathname.slice(idx + "/functions/v1".length) : u.pathname;
  const candidates = new Set<string>([req.url, `${FUNCTIONS_URL}${tail}${u.search}`, `https://${u.host}${u.pathname}${u.search}`]);
  const keys = Object.keys(params).sort();
  const suffix = keys.map((k) => k + String(params[k] ?? "")).join("");
  for (const url of candidates) {
    const expected = b64(await hmac("SHA-1", authToken, url + suffix));
    if (timingSafeEqual(expected, sig)) return true;
  }
  return false;
}

/** Meta webhook signature: sha256=hex(HMAC-SHA256(appSecret, rawBody)) */
export async function metaSignatureOk(req: Request, raw: string, appSecret: string | undefined): Promise<boolean> {
  if (!appSecret) return false;
  const header = req.headers.get("x-hub-signature-256") ?? "";
  if (!header.startsWith("sha256=")) return false;
  const expected = "sha256=" + hex(await hmac("SHA-256", appSecret, raw));
  return timingSafeEqual(expected, header);
}

/** Svix style signature used by Resend webhooks. */
export async function svixSignatureOk(req: Request, raw: string, secret: string | undefined): Promise<boolean> {
  if (!secret) return false;
  const id = req.headers.get("svix-id") ?? "";
  const ts = req.headers.get("svix-timestamp") ?? "";
  const sigs = (req.headers.get("svix-signature") ?? "").split(" ").map((s) => s.split(",")[1] ?? "");
  if (!id || !ts || !sigs.length) return false;
  const keyB64 = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  const keyBytes = Uint8Array.from(atob(keyB64), (c) => c.charCodeAt(0));
  const k = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = b64(await crypto.subtle.sign("HMAC", k, new TextEncoder().encode(`${id}.${ts}.${raw}`)));
  return sigs.some((s) => timingSafeEqual(s, expected));
}

export function e164(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null;
  let d = String(raw).replace(/[^0-9+]/g, "");
  if (d.startsWith("+")) {
    d = "+" + d.slice(1).replace(/[^0-9]/g, "");
    return d.length >= 11 && d.length <= 16 ? d : null;
  }
  d = d.replace(/[^0-9]/g, "");
  if (d.length === 10) return "+1" + d;
  if (d.length === 11 && d.startsWith("1")) return "+" + d;
  return null;
}

export function clientIp(req: Request): string {
  return (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("cf-connecting-ip") || "0.0.0.0";
}

export function log(scope: string, msg: string, extra?: unknown) {
  console.log(JSON.stringify({ scope, msg, ...(extra ? { extra } : {}) }));
}

export async function rpc<T = unknown>(db: SupabaseClient, fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(`${fn}: ${error.message}`);
  return data as T;
}

/** Twilio REST helper */
export async function twilioRequest(path: string, form: Record<string, string>): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const sid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const token = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!sid || !token) throw new Error("provider not configured: TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN");
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}${path}`, {
    method: "POST",
    headers: { Authorization: "Basic " + btoa(`${sid}:${token}`), "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(form).toString(),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

export function twilioConfigured(): boolean {
  return !!(Deno.env.get("TWILIO_ACCOUNT_SID") && Deno.env.get("TWILIO_AUTH_TOKEN"));
}
export function resendConfigured(): boolean {
  return !!Deno.env.get("RESEND_API_KEY");
}
export function anthropicConfigured(): boolean {
  return !!Deno.env.get("ANTHROPIC_API_KEY");
}

/** Nudge the engine right away instead of waiting for the next cron minute. Never throws. */
export async function tick(db: SupabaseClient): Promise<void> {
  try { await db.rpc("fh_automation_tick"); } catch { /* cron will pick it up */ }
}
