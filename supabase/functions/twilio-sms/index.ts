// twilio-sms: inbound SMS / MMS and delivery status callbacks from Twilio.
// Configure on each Twilio number:
//   Messaging  "A message comes in"  POST  {FUNCTIONS_URL}/twilio-sms
// Status callbacks are set per message by the worker ({FUNCTIONS_URL}/twilio-sms?event=status).
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, readBody, twiml, twilioSignatureOk, xmlEscape, e164, rpc, log, text, tick } from "./lib.ts";

const STOP_WORDS = new Set(["stop", "stopall", "unsubscribe", "cancel", "end", "quit", "stop all"]);
const START_WORDS = new Set(["start", "unstop", "yes", "subscribe"]);

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return text("ok");
  const { data: p } = await readBody(req);
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const validate = (Deno.env.get("TWILIO_VALIDATE_SIGNATURE") ?? "true") !== "false";
  if (validate && !(await twilioSignatureOk(req, p, authToken))) {
    log("twilio-sms", "bad signature", { url: req.url });
    return text("forbidden", 403);
  }
  const db = admin();
  const url = new URL(req.url);

  // ---------------------------------------------------------- delivery status
  if (url.searchParams.get("event") === "status" || (p.MessageStatus && !p.Body && !p.NumMedia)) {
    const sid = String(p.MessageSid ?? p.SmsSid ?? "");
    const status = String(p.MessageStatus ?? p.SmsStatus ?? "");
    const err = p.ErrorCode ? `Twilio error ${p.ErrorCode}` : null;
    if (sid && status) {
      await rpc(db, "fh_message_provider_status", { p_provider: "twilio", p_provider_message_id: sid, p_status: status, p_error: err, p_extra: { error_code: p.ErrorCode ?? null } }).catch((e) => log("twilio-sms", "status rpc failed", e.message));
    }
    return text("", 204);
  }

  // ---------------------------------------------------------- inbound message
  const sid = String(p.MessageSid ?? p.SmsSid ?? "");
  const from = e164(p.From);
  const to = e164(p.To);
  const body = String(p.Body ?? "").trim();
  if (!sid || !from || !to) return twiml("");

  const { data: number } = await db.from("fh_phone_numbers").select("id, org_id, status").eq("e164", to).maybeSingle();
  if (!number) { log("twilio-sms", "unknown number", { to }); return twiml(""); }

  const resolved = await rpc<{ client_id: string; is_new: boolean }[] | { client_id: string; is_new: boolean }>(db, "fh_resolve_client", {
    p_org_id: number.org_id, p_phone: from, p_email: null, p_name: null, p_address: null, p_source: "inbound_sms",
  });
  const r = Array.isArray(resolved) ? resolved[0] : resolved;
  const clientId = r.client_id;
  const conversationId = await rpc<string>(db, "fh_conversation_for_client", { p_org_id: number.org_id, p_client_id: clientId });

  // keyword handling (Twilio Advanced Opt Out also enforces these at the carrier edge)
  const word = body.toLowerCase().replace(/[.!]/g, "");
  let reply: string | null = null;
  if (STOP_WORDS.has(word)) {
    await rpc(db, "fh_consent_set", { p_org_id: number.org_id, p_client_id: clientId, p_channel: "sms", p_status: "opted_out", p_source: "keyword:STOP" });
  } else if (START_WORDS.has(word)) {
    await rpc(db, "fh_consent_set", { p_org_id: number.org_id, p_client_id: clientId, p_channel: "sms", p_status: "opted_in", p_source: "keyword:START" });
  } else if (word === "help") {
    const { data: org } = await db.rpc("fh_org_ctx", { p_org_id: number.org_id });
    reply = `${org?.name ?? "We"}: reply STOP to opt out, START to opt back in. Call ${org?.phone ?? "us"} for help.`;
  }

  const media: { url: string; type: string }[] = [];
  const n = Number(p.NumMedia ?? 0);
  for (let i = 0; i < n; i++) {
    const u = p[`MediaUrl${i}`]; if (u) media.push({ url: String(u), type: String(p[`MediaContentType${i}`] ?? "") });
  }

  const { error } = await db.from("fh_messages").insert({
    org_id: number.org_id, conversation_id: conversationId, client_id: clientId,
    channel: media.length ? "mms" : "sms", direction: "inbound", status: "received",
    body, from_address: from, to_address: to, media, provider: "twilio", provider_message_id: sid,
    sent_by_kind: "contact", phone_number_id: number.id, dedupe_key: `twilio:${sid}`,
  });
  if (error && !String(error.message).includes("duplicate")) log("twilio-sms", "insert failed", error.message);

  // react now instead of waiting for the next cron minute
  await tick(db);

  return twiml(reply ? `<Message>${xmlEscape(reply)}</Message>` : "");
});
