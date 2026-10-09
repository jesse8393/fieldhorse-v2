// public-api: unauthenticated endpoints used by websites, booking pages, review links and unsubscribe links.
//   POST {FUNCTIONS_URL}/public-api/forms/{orgKey}/{formKey}          JSON or form encoded lead
//   GET  {FUNCTIONS_URL}/public-api/org/{orgKey}                        public org card (name, phone, booking types)
//   GET  {FUNCTIONS_URL}/public-api/booking/{orgKey}/{typeKey}/slots?from=YYYY-MM-DD&days=14
//   POST {FUNCTIONS_URL}/public-api/booking/{orgKey}/{typeKey}          {start, name, phone, email, address, notes, sms_consent}
//   POST {FUNCTIONS_URL}/public-api/booking/cancel/{manageToken}
//   GET  {FUNCTIONS_URL}/public-api/r/{trackKey}                        review link redirect
//   GET  {FUNCTIONS_URL}/public-api/u/{emailThreadToken}                email unsubscribe
//   POST {FUNCTIONS_URL}/public-api/webchat/{orgKey}                    {name, phone, email, message, visitor_id}
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, readBody, json, text, rpc, log, sha256hex, clientIp, CORS, e164, tick } from "./lib.ts";

const bucket = new Map<string, { n: number; t: number }>();
function limited(key: string, max = 20, windowMs = 60_000): boolean {
  const now = Date.now(); const b = bucket.get(key);
  if (!b || now - b.t > windowMs) { bucket.set(key, { n: 1, t: now }); return false; }
  b.n++; return b.n > max;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("public-api");
  const seg = i >= 0 ? parts.slice(i + 1) : parts;
  const db = admin();
  const ip = clientIp(req);
  try {
    if (seg[0] === "forms" && req.method === "POST" && seg[1] && seg[2]) {
      if (limited(`forms:${ip}`, 10)) return json({ ok: false, error: "slow down" }, 429);
      const { data } = await readBody(req);
      if (String(data.website ?? data._honey ?? "").trim() !== "") return json({ ok: true }); // honeypot
      const attribution = {
        source: data.utm_source ?? data.source ?? undefined, medium: data.utm_medium ?? undefined, campaign: data.utm_campaign ?? undefined,
        content: data.utm_content ?? undefined, term: data.utm_term ?? undefined, landing_url: data.landing_url ?? data.page_url ?? req.headers.get("referer") ?? undefined,
        referrer: data.referrer ?? undefined, gclid: data.gclid ?? undefined, fbclid: data.fbclid ?? undefined,
      };
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(data)) if (!k.startsWith("utm_") && !["landing_url", "page_url", "referrer", "website", "_honey", "gclid", "fbclid"].includes(k)) clean[k] = v;
      const result = await rpc<any>(db, "fh_form_submit", {
        p_org_public_key: seg[1], p_form_key: seg[2], p_data: clean, p_attribution: JSON.parse(JSON.stringify(attribution)),
        p_ip_hash: await sha256hex(ip), p_user_agent: req.headers.get("user-agent") ?? null,
      });
      await tick(db);
      const wantsRedirect = url.searchParams.get("redirect") === "1" || (req.headers.get("accept") ?? "").includes("text/html");
      if (wantsRedirect && result?.redirect_url) return new Response(null, { status: 303, headers: { Location: result.redirect_url, ...CORS } });
      return json({ ok: true, thank_you: result?.thank_you ?? "Thank you. We will be in touch shortly.", redirect_url: result?.redirect_url ?? null });
    }

    if (seg[0] === "org" && seg[1] && req.method === "GET") {
      const { data: s } = await db.from("fh_org_settings").select("org_id, timezone, brand").eq("public_key", seg[1]).eq("engine_enabled", true).maybeSingle();
      if (!s) return json({ error: "not found" }, 404);
      const org = await rpc<any>(db, "fh_org_ctx", { p_org_id: s.org_id });
      const { data: types } = await db.from("fh_booking_types").select("key, name, description, duration_min, location_mode").eq("org_id", s.org_id).eq("status", "active");
      return json({ name: org.name, phone: org.phone, website: org.website, timezone: s.timezone, brand: s.brand ?? {}, booking_types: types ?? [] });
    }

    if (seg[0] === "booking" && seg[1] === "cancel" && seg[2] && req.method === "POST") {
      const { data } = await readBody(req);
      return json(await rpc(db, "fh_appointment_cancel_public", { p_manage_token: seg[2], p_reason: data.reason ?? null }));
    }
    if (seg[0] === "booking" && seg[1] && seg[2] && seg[3] === "slots" && req.method === "GET") {
      const from = url.searchParams.get("from"); const days = Number(url.searchParams.get("days") ?? 14);
      return json(await rpc(db, "fh_booking_slots", { p_org_public_key: seg[1], p_type_key: seg[2], p_from: from || null, p_days: Math.min(Math.max(days, 1), 60) }));
    }
    if (seg[0] === "booking" && seg[1] && seg[2] && req.method === "POST") {
      if (limited(`book:${ip}`, 10)) return json({ ok: false, error: "slow down" }, 429);
      const { data } = await readBody(req);
      if (String(data.website ?? "").trim() !== "") return json({ ok: true });
      if (!data.start || !data.name || (!e164(data.phone) && !data.email)) return json({ ok: false, error: "start, name, and a phone or email are required" }, 400);
      const result = await rpc<any>(db, "fh_book_appointment", {
        p_org_public_key: seg[1], p_type_key: seg[2], p_start: data.start, p_name: data.name, p_phone: data.phone ?? null, p_email: data.email ?? null,
        p_address: data.address ?? null, p_notes: data.notes ?? null,
        p_attribution: { source: data.utm_source ?? data.source ?? "booking_page", medium: data.utm_medium ?? null, campaign: data.utm_campaign ?? null, landing_url: data.landing_url ?? req.headers.get("referer") ?? null },
        p_sms_consent: /^(true|yes|on|1)$/i.test(String(data.sms_consent ?? "false")),
      });
      await tick(db);
      return json(result);
    }

    if (seg[0] === "r" && seg[1] && req.method === "GET") {
      const target = await rpc<string | null>(db, "fh_review_click", { p_track_key: seg[1] });
      await tick(db);
      if (!target) return text("This link is no longer active.", 404);
      return new Response(null, { status: 302, headers: { Location: target } });
    }

    if (seg[0] === "u" && seg[1] && req.method === "GET") {
      const { data: conv } = await db.from("fh_conversations").select("org_id, client_id").eq("email_thread_token", seg[1]).maybeSingle();
      if (conv) await rpc(db, "fh_consent_set", { p_org_id: conv.org_id, p_client_id: conv.client_id, p_channel: "email", p_status: "opted_out", p_source: "unsubscribe_link" });
      const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title>
<style>body{font-family:system-ui,sans-serif;background:#F2EDE4;color:#141414;display:grid;place-items:center;min-height:100vh;margin:0}main{background:#fff;padding:40px;border-radius:16px;max-width:420px;text-align:center;box-shadow:0 10px 40px rgba(0,0,0,.08)}h1{font-size:22px;margin:0 0 8px}p{color:#5C5C5C;margin:0}</style></head>
<body><main><h1>You are unsubscribed</h1><p>${conv ? "You will not receive marketing email from us. Replies about your active project still reach us." : "This link has already been used."}</p></main></body></html>`;
      return new Response(page, { status: 200, headers: { "Content-Type": "text/html; charset=utf-8" } });
    }

    if (seg[0] === "webchat" && seg[1] && req.method === "POST") {
      if (limited(`chat:${ip}`, 30)) return json({ ok: false, error: "slow down" }, 429);
      const { data } = await readBody(req);
      const { data: s } = await db.from("fh_org_settings").select("org_id").eq("public_key", seg[1]).eq("engine_enabled", true).maybeSingle();
      if (!s) return json({ error: "not found" }, 404);
      const message = String(data.message ?? "").trim();
      if (!message) return json({ ok: false, error: "message required" }, 400);
      let clientId: string | null = null;
      if (e164(data.phone) || data.email) {
        const r = await rpc<any>(db, "fh_lead_capture", {
          p_org_id: s.org_id, p_via: "webchat", p_name: data.name ?? null, p_phone: data.phone ?? null, p_email: data.email ?? null, p_address: null,
          p_message: message, p_attribution: { source: "webchat", landing_url: data.page_url ?? req.headers.get("referer") ?? null },
          p_dedupe_key: data.visitor_id ? `webchat:${data.visitor_id}:${await sha256hex(message)}` : null, p_sms_consent: /^(true|yes|on|1)$/i.test(String(data.sms_consent ?? "false")), p_data: {},
        });
        clientId = r?.client_id ?? null;
      }
      if (clientId) {
        const conversationId = await rpc<string>(db, "fh_conversation_for_client", { p_org_id: s.org_id, p_client_id: clientId });
        await db.from("fh_messages").insert({ org_id: s.org_id, conversation_id: conversationId, client_id: clientId, channel: "webchat", direction: "inbound", status: "received", body: message, from_address: data.visitor_id ?? null, sent_by_kind: "contact" });
        await tick(db);
      }
      return json({ ok: true, captured: !!clientId, reply: clientId ? "Thanks, we have your message and will text or email you shortly." : "Leave a phone number or email so we can get back to you." });
    }

    return json({ error: "not found" }, 404);
  } catch (e) {
    const msg = (e as Error).message ?? "error";
    log("public-api", "error", { path: url.pathname, msg });
    const status = /unknown org|unknown form|unknown booking|not found/.test(msg) ? 404 : /required|invalid|slot no longer/.test(msg) ? 400 : 500;
    return json({ ok: false, error: msg.replace(/^fh_\w+: /, "") }, status);
  }
});
