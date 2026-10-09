// meta-leads: Meta (Facebook / Instagram) webhooks for Lead Ads and Messenger.
// App dashboard > Webhooks > Page: subscribe "leadgen" and "messages", callback {FUNCTIONS_URL}/meta-leads
// Verify token = META_VERIFY_TOKEN. Signature = META_APP_SECRET.
// Each page is mapped to an org in fh_channels: kind 'messenger', external_id = page id, config.page_token = long lived page token.
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, readBody, json, text, metaSignatureOk, rpc, log, e164, tick } from "./lib.ts";

const GRAPH = "https://graph.facebook.com/v21.0";

Deno.serve(async (req: Request) => {
  const url = new URL(req.url);
  if (req.method === "GET") {
    const mode = url.searchParams.get("hub.mode"); const token = url.searchParams.get("hub.verify_token"); const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token && token === Deno.env.get("META_VERIFY_TOKEN")) return text(challenge ?? "");
    return text("forbidden", 403);
  }
  if (req.method !== "POST") return text("ok");
  const { data: p, raw } = await readBody(req);
  const validate = (Deno.env.get("META_VALIDATE_SIGNATURE") ?? "true") !== "false";
  if (validate && !(await metaSignatureOk(req, raw, Deno.env.get("META_APP_SECRET")))) {
    log("meta-leads", "bad signature");
    return text("forbidden", 403);
  }
  const db = admin();
  const entries: any[] = Array.isArray(p.entry) ? p.entry : [];
  let handled = 0;
  for (const entry of entries) {
    const pageId = String(entry.id ?? "");
    const { data: channel } = await db.from("fh_channels").select("id, org_id, config").eq("kind", "messenger").eq("external_id", pageId).eq("status", "active").maybeSingle();
    if (!channel) { log("meta-leads", "page not mapped to an org", { pageId }); continue; }
    const pageToken = channel.config?.page_token;

    for (const ch of entry.changes ?? []) {
      if (ch.field === "leadgen" && ch.value?.leadgen_id) {
        try { await handleLead(db, channel.org_id, pageToken, ch.value); handled++; } catch (e) { log("meta-leads", "lead failed", (e as Error).message); }
      }
    }
    for (const m of entry.messaging ?? []) {
      if (m.message && !m.message.is_echo) {
        try { await handleMessage(db, channel.org_id, pageToken, m); handled++; } catch (e) { log("meta-leads", "message failed", (e as Error).message); }
      }
    }
  }
  if (handled) await tick(db);
  return json({ ok: true, handled });
});

async function handleLead(db: any, orgId: string, pageToken: string | undefined, v: any) {
  const leadId = String(v.leadgen_id);
  if (!pageToken) throw new Error("no page_token in channel config");
  const res = await fetch(`${GRAPH}/${leadId}?access_token=${encodeURIComponent(pageToken)}`);
  const lead = await res.json();
  if (!res.ok) throw new Error(`graph ${res.status}: ${lead?.error?.message ?? "error"}`);
  const fields: Record<string, string> = {};
  for (const f of lead.field_data ?? []) fields[String(f.name).toLowerCase()] = (f.values ?? []).join(", ");
  const name = fields.full_name ?? [fields.first_name, fields.last_name].filter(Boolean).join(" ") ?? null;
  const phone = fields.phone_number ?? fields.phone ?? null;
  const email = fields.email ?? null;
  const address = [fields.street_address, fields.city, fields.state, fields.zip_code ?? fields.post_code].filter(Boolean).join(", ") || null;
  const consentKey = Object.keys(fields).find((k) => k.includes("text") || k.includes("sms") || k.includes("consent"));
  const smsConsent = consentKey ? /yes|true|ok|agree/i.test(fields[consentKey]) : false;
  const known = new Set(["full_name", "first_name", "last_name", "phone_number", "phone", "email", "street_address", "city", "state", "zip_code", "post_code"]);
  const extra: Record<string, string> = {};
  for (const [k, val] of Object.entries(fields)) if (!known.has(k)) extra[k] = val;
  const message = Object.entries(extra).map(([k, val]) => `${k.replace(/_/g, " ")}: ${val}`).join("\n") || null;

  const result = await rpc(db, "fh_lead_capture", {
    p_org_id: orgId, p_via: "meta_ads", p_name: name, p_phone: phone, p_email: email, p_address: address, p_message: message,
    p_attribution: { source: "meta_ads", medium: "paid_social", ad_id: v.ad_id ?? lead.ad_id ?? null, campaign: lead.campaign_name ?? null, form_key: "meta_lead", meta_form_id: v.form_id ?? lead.form_id ?? null, platform: lead.platform ?? null },
    p_dedupe_key: `meta:lead:${leadId}`, p_sms_consent: smsConsent, p_data: { ...extra, service: extra.service ?? extra.what_do_you_need ?? null },
  });
  log("meta-leads", "lead captured", result);
}

async function handleMessage(db: any, orgId: string, pageToken: string | undefined, m: any) {
  const psid = String(m.sender?.id ?? ""); const mid = String(m.message?.mid ?? "");
  if (!psid || !mid) return;
  // find the client by stored PSID, else create one named from the Graph profile
  const { data: field } = await db.from("fh_client_fields").select("client_id").eq("org_id", orgId).eq("key", "messenger_psid").eq("value", JSON.stringify(psid)).maybeSingle();
  let clientId = field?.client_id;
  if (!clientId) {
    let name = "Messenger lead";
    if (pageToken) {
      const r = await fetch(`${GRAPH}/${psid}?fields=first_name,last_name&access_token=${encodeURIComponent(pageToken)}`);
      const prof = await r.json().catch(() => ({}));
      if (r.ok) name = [prof.first_name, prof.last_name].filter(Boolean).join(" ") || name;
    }
    const { data: owner } = await db.from("org_members").select("user_id").eq("org_id", orgId).is("revoked_at", null).order("joined_at").limit(1).maybeSingle();
    const { data: c } = await db.from("fh_clients").insert({ user_id: owner?.user_id, org_id: orgId, name, source: "messenger", last_activity_at: new Date().toISOString() }).select("id").single();
    clientId = c.id;
    await db.from("fh_client_fields").insert({ client_id: clientId, org_id: orgId, key: "messenger_psid", value: psid });
    await rpc(db, "fh_tag_add", { p_org_id: orgId, p_client_id: clientId, p_tag: "messenger", p_source: "messenger", p_user: null }).catch(() => {});
  }
  const conversationId = await rpc<string>(db, "fh_conversation_for_client", { p_org_id: orgId, p_client_id: clientId });
  const attachments = (m.message.attachments ?? []).map((a: any) => ({ url: a.payload?.url, type: a.type }));
  const { error } = await db.from("fh_messages").insert({
    org_id: orgId, conversation_id: conversationId, client_id: clientId, channel: "messenger", direction: "inbound", status: "received",
    body: m.message.text ?? (attachments.length ? "[attachment]" : ""), media: attachments, from_address: psid, provider: "meta", provider_message_id: mid,
    sent_by_kind: "contact", dedupe_key: `meta:msg:${mid}`,
  });
  if (error && !String(error.message).includes("duplicate")) throw new Error(error.message);
}
