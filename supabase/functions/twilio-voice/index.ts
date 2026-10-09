// twilio-voice: call tracking, forwarding with whisper, voicemail, missed call events,
// owner first "press 1 to connect" calls, voice drops.
// Configure on each Twilio number:
//   Voice  "A call comes in"  POST  {FUNCTIONS_URL}/twilio-voice?action=inbound
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { admin, readBody, twiml, twilioSignatureOk, xmlEscape, e164, rpc, log, text, FUNCTIONS_URL, tick } from "./lib.ts";

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return text("ok");
  const { data: p } = await readBody(req);
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  const validate = (Deno.env.get("TWILIO_VALIDATE_SIGNATURE") ?? "true") !== "false";
  if (validate && !(await twilioSignatureOk(req, p, authToken))) {
    log("twilio-voice", "bad signature", { url: req.url });
    return text("forbidden", 403);
  }
  const db = admin();
  const url = new URL(req.url);
  const action = url.searchParams.get("action") ?? "inbound";
  const messageId = url.searchParams.get("message_id");

  try {
    switch (action) {
      case "inbound": return await inbound(db, p);
      case "whisper": return twiml(`<Say voice="Polly.Matthew">${xmlEscape(url.searchParams.get("text") ?? "Incoming call")}</Say>`);
      case "dial_result": return await dialResult(db, p, messageId);
      case "recording_done": return await recordingDone(db, p, messageId);
      case "transcription": return await transcription(db, p, messageId);
      case "connect": return await connect(db, messageId);
      case "bridge": return await bridge(db, p, messageId);
      case "drop": return await drop(db, messageId);
      case "status": return await status(db, p, messageId);
      default: return twiml("");
    }
  } catch (e) {
    log("twilio-voice", "error", { action, error: (e as Error).message });
    return twiml(`<Say>Sorry, something went wrong. Please try again.</Say>`);
  }
});

// A caller rings one of the org numbers
async function inbound(db: any, p: Record<string, unknown>) {
  const from = e164(p.From); const to = e164(p.To); const sid = String(p.CallSid ?? "");
  if (!to || !sid) return twiml("");
  const { data: number } = await db.from("fh_phone_numbers").select("*").eq("e164", to).maybeSingle();
  if (!number) return twiml(`<Say>This number is not in service.</Say>`);

  let clientId: string | null = null; let conversationId: string | null = null;
  if (from) {
    const resolved = await rpc<any>(db, "fh_resolve_client", { p_org_id: number.org_id, p_phone: from, p_email: null, p_name: null, p_address: null, p_source: number.source_tag ? `call:${number.source_tag}` : "inbound_call" });
    const r = Array.isArray(resolved) ? resolved[0] : resolved;
    clientId = r.client_id;
    conversationId = await rpc<string>(db, "fh_conversation_for_client", { p_org_id: number.org_id, p_client_id: clientId });
    await db.from("fh_messages").insert({
      org_id: number.org_id, conversation_id: conversationId, client_id: clientId, channel: "call", direction: "inbound", status: "received",
      call_status: "ringing", from_address: from, to_address: to, provider: "twilio", provider_message_id: sid, sent_by_kind: "contact",
      phone_number_id: number.id, dedupe_key: `twilio:${sid}`, body: `Incoming call${number.source_tag ? " via " + number.source_tag : ""}`,
    });
  }
  const { data: msg } = await db.from("fh_messages").select("id").eq("dedupe_key", `twilio:${sid}`).maybeSingle();
  const mid = msg?.id ?? "";
  const forward = e164(number.voice_forward_to);
  if (!forward) return voicemailPrompt(number, mid);

  const whisper = number.voice_whisper ?? `Call from ${number.label ?? "your business line"}${number.source_tag ? ", " + number.source_tag : ""}.`;
  const record = number.voice_record ? ` record="record-from-answer-dual" recordingStatusCallback="${FUNCTIONS_URL}/twilio-voice?action=recording_done&amp;message_id=${mid}"` : "";
  return twiml(
    `<Dial timeout="${number.voice_timeout_sec ?? 20}" callerId="${xmlEscape(to)}" action="${FUNCTIONS_URL}/twilio-voice?action=dial_result&amp;message_id=${mid}"${record}>` +
    `<Number url="${FUNCTIONS_URL}/twilio-voice?action=whisper&amp;text=${encodeURIComponent(whisper)}">${xmlEscape(forward)}</Number></Dial>`,
  );
}

function voicemailPrompt(number: any, mid: string) {
  const greeting = number.voicemail_greeting ?? "Thanks for calling. We are with another customer right now. Leave your name, number, and what you need, and we will call you right back.";
  return twiml(
    `<Say voice="Polly.Matthew">${xmlEscape(greeting)}</Say>` +
    `<Record maxLength="120" playBeep="true" action="${FUNCTIONS_URL}/twilio-voice?action=recording_done&amp;message_id=${mid}" transcribe="true" transcribeCallback="${FUNCTIONS_URL}/twilio-voice?action=transcription&amp;message_id=${mid}" />`,
  );
}

// The forward leg ended: answered, or missed
async function dialResult(db: any, p: Record<string, unknown>, mid: string | null) {
  const st = String(p.DialCallStatus ?? "");
  const dur = Number(p.DialCallDuration ?? 0);
  if (!mid) return twiml("");
  const { data: msg } = await db.from("fh_messages").select("id, org_id, client_id, contact_id, phone_number_id, to_address").eq("id", mid).maybeSingle();
  if (!msg) return twiml("");
  const { data: number } = await db.from("fh_phone_numbers").select("*").eq("id", msg.phone_number_id).maybeSingle();
  if (st === "completed" && dur > 0) {
    await db.from("fh_messages").update({ call_status: "completed", call_duration_sec: dur, status: "received", updated_at: new Date().toISOString() }).eq("id", mid);
    await rpc(db, "fh_emit_event", { p_org_id: msg.org_id, p_type: "call.inbound", p_client_id: msg.client_id, p_contact_id: msg.contact_id,
      p_payload: { message_id: mid, channel: "call", call_status: "completed", duration_sec: dur, phone_number_id: msg.phone_number_id }, p_source: "voice", p_dedupe_key: `twilio:call:${mid}:final` }).catch(() => {});
    return twiml("<Hangup/>");
  }
  const missed = st === "no-answer" || st === "busy" || st === "failed" || st === "canceled" || dur === 0 ? (st || "no-answer") : st;
  await db.from("fh_messages").update({ call_status: missed, call_duration_sec: dur, updated_at: new Date().toISOString() }).eq("id", mid);
  await rpc(db, "fh_emit_event", { p_org_id: msg.org_id, p_type: "call.inbound", p_client_id: msg.client_id, p_contact_id: msg.contact_id,
    p_payload: { message_id: mid, channel: "call", call_status: missed, phone_number_id: msg.phone_number_id }, p_source: "voice", p_dedupe_key: `twilio:call:${mid}:final` }).catch(() => {});
  await tick(db);
  return voicemailPrompt(number ?? {}, mid);
}

async function recordingDone(db: any, p: Record<string, unknown>, mid: string | null) {
  if (!mid) return twiml("");
  const rec = p.RecordingUrl ? `${String(p.RecordingUrl)}.mp3` : null;
  const dur = Number(p.RecordingDuration ?? 0);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (rec) patch.recording_url = rec;
  // a Record verb (voicemail) sends RecordingDuration; the Dial record sends RecordingStatus
  if (p.RecordingDuration !== undefined && !p.RecordingStatus) { patch.call_status = "voicemail"; patch.body = `Voicemail (${dur}s)`; }
  await db.from("fh_messages").update(patch).eq("id", mid);
  return twiml(p.RecordingStatus ? "" : "<Say voice=\"Polly.Matthew\">Thank you. We will call you back shortly.</Say><Hangup/>");
}

async function transcription(db: any, p: Record<string, unknown>, mid: string | null) {
  if (!mid) return text("", 204);
  const t = String(p.TranscriptionText ?? "").trim();
  if (t) await db.from("fh_messages").update({ transcript: t, body: `Voicemail: ${t.slice(0, 500)}`, updated_at: new Date().toISOString() }).eq("id", mid);
  return text("", 204);
}

// Owner first call: whisper who it is, press 1 to connect to the lead
async function connect(db: any, mid: string | null) {
  if (!mid) return twiml("<Hangup/>");
  const { data: msg } = await db.from("fh_messages").select("body").eq("id", mid).maybeSingle();
  const whisper = msg?.body ?? "New lead waiting. Press 1 to connect.";
  return twiml(
    `<Gather numDigits="1" timeout="8" action="${FUNCTIONS_URL}/twilio-voice?action=bridge&amp;message_id=${mid}">` +
    `<Say voice="Polly.Matthew">${xmlEscape(whisper)}</Say></Gather><Say voice="Polly.Matthew">No answer. Goodbye.</Say><Hangup/>`,
  );
}

async function bridge(db: any, p: Record<string, unknown>, mid: string | null) {
  if (!mid) return twiml("<Hangup/>");
  const { data: msg } = await db.from("fh_messages").select("to_address, from_address").eq("id", mid).maybeSingle();
  if (String(p.Digits ?? "") !== "1" || !msg?.to_address) {
    await db.from("fh_messages").update({ call_status: "declined", updated_at: new Date().toISOString() }).eq("id", mid);
    return twiml(`<Say voice="Polly.Matthew">Okay, not connecting. Goodbye.</Say><Hangup/>`);
  }
  await db.from("fh_messages").update({ call_status: "connecting", updated_at: new Date().toISOString() }).eq("id", mid);
  return twiml(`<Say voice="Polly.Matthew">Connecting you now.</Say><Dial callerId="${xmlEscape(msg.from_address ?? "")}" record="record-from-answer-dual" recordingStatusCallback="${FUNCTIONS_URL}/twilio-voice?action=recording_done&amp;message_id=${mid}">${xmlEscape(msg.to_address)}</Dial>`);
}

async function drop(db: any, mid: string | null) {
  if (!mid) return twiml("<Hangup/>");
  const { data: o } = await db.from("fh_outbox").select("payload").eq("message_id", mid).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const audio = o?.payload?.audio_url;
  if (!audio) return twiml("<Hangup/>");
  return twiml(`<Pause length="1"/><Play>${xmlEscape(String(audio))}</Play><Hangup/>`);
}

// Outbound call lifecycle
async function status(db: any, p: Record<string, unknown>, mid: string | null) {
  if (!mid) return text("", 204);
  const st = String(p.CallStatus ?? ""); const dur = Number(p.CallDuration ?? 0);
  const patch: Record<string, unknown> = { provider_status: st, updated_at: new Date().toISOString() };
  if (dur) patch.call_duration_sec = dur;
  if (st === "completed") patch.status = "delivered";
  if (["busy", "no-answer", "failed", "canceled"].includes(st)) { patch.status = "undelivered"; patch.call_status = st; }
  await db.from("fh_messages").update(patch).eq("id", mid);
  return text("", 204);
}
