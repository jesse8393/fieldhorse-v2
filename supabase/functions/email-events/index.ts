// email-events: delivery events from Resend (svix signed) and inbound replies.
// Resend  dashboard > Webhooks > {FUNCTIONS_URL}/email-events   (events: sent, delivered, bounced, complained, opened, delivery_delayed, received)
// Postmark inbound (optional) > {FUNCTIONS_URL}/email-events?provider=postmark
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, readBody, json, text, svixSignatureOk, rpc, log, timingSafeEqual, tick } from "./lib.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return text("ok");
  const { data: p, raw } = await readBody(req);
  const db = admin();
  const url = new URL(req.url);
  const provider = url.searchParams.get("provider") ?? "resend";

  if (provider === "postmark") {
    const expected = Deno.env.get("POSTMARK_INBOUND_TOKEN");
    const given = url.searchParams.get("token") ?? "";
    if (expected && !timingSafeEqual(expected, given)) return text("forbidden", 403);
    return await inboundEmail(db, {
      from_email: String((p as any).FromFull?.Email ?? p.From ?? ""), from_name: String((p as any).FromFull?.Name ?? ""),
      to: ((p as any).ToFull ?? []).map((t: any) => String(t.Email ?? "")).concat(String(p.To ?? "").split(",")),
      subject: String(p.Subject ?? ""), textBody: String(p.TextBody ?? p.StrippedTextReply ?? ""), html: String(p.HtmlBody ?? ""),
      id: String(p.MessageID ?? ""), provider: "postmark",
    });
  }

  const secret = Deno.env.get("RESEND_WEBHOOK_SECRET");
  const validate = (Deno.env.get("RESEND_VALIDATE_SIGNATURE") ?? "true") !== "false";
  if (validate && !(await svixSignatureOk(req, raw, secret))) {
    log("email-events", "bad signature");
    return text("forbidden", 403);
  }

  const type = String(p.type ?? "");
  const data = (p.data ?? {}) as Record<string, any>;
  const emailId = String(data.email_id ?? data.id ?? "");

  if (type === "email.received" || type === "inbound.received") {
    const tos: string[] = Array.isArray(data.to) ? data.to.map(String) : [String(data.to ?? "")];
    return await inboundEmail(db, {
      from_email: parseAddr(String(data.from ?? "")).email, from_name: parseAddr(String(data.from ?? "")).name,
      to: tos, subject: String(data.subject ?? ""), textBody: String(data.text ?? data.text_body ?? ""), html: String(data.html ?? ""),
      id: emailId, provider: "resend",
    });
  }

  const map: Record<string, string> = {
    "email.sent": "sent", "email.delivered": "delivered", "email.delivery_delayed": "queued",
    "email.bounced": "bounced", "email.complained": "complained", "email.opened": "opened", "email.clicked": "opened", "email.failed": "failed",
  };
  const status = map[type];
  if (status && emailId) {
    const err = type === "email.bounced" ? `bounce: ${data.bounce?.message ?? data.bounce?.type ?? ""}` : type === "email.failed" ? String(data.failed?.reason ?? "failed") : null;
    await rpc(db, "fh_message_provider_status", { p_provider: "resend", p_provider_message_id: emailId, p_status: status, p_error: err, p_extra: { event: type } }).catch((e) => log("email-events", "status rpc failed", e.message));
    if (type === "email.complained") {
      // a spam complaint is an opt out
      const { data: m } = await db.from("fh_messages").select("org_id, client_id").eq("provider", "resend").eq("provider_message_id", emailId).maybeSingle();
      if (m) await rpc(db, "fh_consent_set", { p_org_id: m.org_id, p_client_id: m.client_id, p_channel: "email", p_status: "opted_out", p_source: "complaint" }).catch(() => {});
    }
  }
  return json({ ok: true });
});

function parseAddr(s: string): { email: string; name: string } {
  const m = s.match(/^\s*(?:"?([^"<]*)"?\s*)?<([^>]+)>\s*$/);
  if (m) return { name: (m[1] ?? "").trim(), email: m[2].trim().toLowerCase() };
  return { name: "", email: s.trim().toLowerCase() };
}

async function inboundEmail(db: any, e: { from_email: string; from_name: string; to: string[]; subject: string; textBody: string; html: string; id: string; provider: string }) {
  if (!e.from_email) return json({ ok: true, ignored: "no from" });
  // 1. thread token in the reply address: reply+<token>@domain
  let conv: any = null;
  for (const t of e.to) {
    const m = String(t).toLowerCase().match(/reply\+([a-z0-9_-]+)@/i);
    if (m) {
      const { data } = await db.from("fh_conversations").select("id, org_id, client_id").eq("email_thread_token", m[1]).maybeSingle();
      if (data) { conv = data; break; }
    }
  }
  let orgId = conv?.org_id; let clientId = conv?.client_id; let conversationId = conv?.id;
  // 2. else, the org whose reply domain received it, matched on sender email
  if (!conv) {
    const domains = e.to.map((t) => String(t).toLowerCase().split("@")[1]?.replace(/>.*$/, "")).filter(Boolean);
    const { data: orgs } = await db.from("fh_org_settings").select("org_id, reply_domain, default_from_email").eq("engine_enabled", true);
    const org = (orgs ?? []).find((o: any) => domains.includes(String(o.reply_domain ?? "").toLowerCase()) || domains.includes(String(o.default_from_email ?? "").split("@")[1]?.toLowerCase()));
    if (!org) return json({ ok: true, ignored: "no matching org" });
    orgId = org.org_id;
    const resolved = await rpc<any>(db, "fh_resolve_client", { p_org_id: orgId, p_phone: null, p_email: e.from_email, p_name: e.from_name || null, p_address: null, p_source: "inbound_email" });
    clientId = (Array.isArray(resolved) ? resolved[0] : resolved).client_id;
    conversationId = await rpc<string>(db, "fh_conversation_for_client", { p_org_id: orgId, p_client_id: clientId });
  }
  const body = stripQuoted(e.textBody || htmlToText(e.html));
  const { error } = await db.from("fh_messages").insert({
    org_id: orgId, conversation_id: conversationId, client_id: clientId, channel: "email", direction: "inbound", status: "received",
    subject: e.subject, body, body_html: e.html || null, from_address: e.from_email, to_address: e.to[0] ?? null,
    provider: e.provider, provider_message_id: e.id || null, sent_by_kind: "contact", dedupe_key: e.id ? `${e.provider}:${e.id}` : null,
  });
  if (error && !String(error.message).includes("duplicate")) log("email-events", "insert failed", error.message);
  await tick(db);
  return json({ ok: true });
}

function stripQuoted(t: string): string {
  const lines = t.split(/\r?\n/);
  const out: string[] = [];
  for (const l of lines) {
    if (/^On .+ wrote:$/.test(l.trim()) || /^-----Original Message-----/.test(l.trim()) || /^From: .+/.test(l.trim()) && out.length > 0) break;
    if (l.trim().startsWith(">")) continue;
    out.push(l);
  }
  return out.join("\n").trim();
}

function htmlToText(h: string): string {
  return h.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
}
