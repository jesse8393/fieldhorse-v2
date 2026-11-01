// automation-worker: drains fh_outbox. Sends SMS / email / calls, runs webhooks and AI agents.
// Invoked by pg_cron through pg_net (fh_automation_tick) and safe to call by hand:
//   curl -X POST $FUNCTIONS_URL/automation-worker -H "Authorization: Bearer $WORKER_SECRET"
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {
  admin, json, rpc, log, FUNCTIONS_URL, twilioRequest, twilioConfigured, resendConfigured, anthropicConfigured, e164 } from "./lib.ts";

const WORKER = `worker-${crypto.randomUUID().slice(0, 8)}`;
const TIME_BUDGET_MS = 45_000;
const BATCH = 20;

type Outbox = {
  id: string; org_id: string; kind: string; payload: Record<string, any>; attempts: number; max_attempts: number;
  run_id: string | null; message_id: string | null; client_id: string | null; campaign_id: string | null;
  agent_run_id: string | null; phone_number_id: string | null;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return json({ ok: true });
  const secret = Deno.env.get("WORKER_SECRET");
  const auth = req.headers.get("authorization") ?? "";
  if (!secret || auth !== `Bearer ${secret}`) return json({ error: "unauthorized" }, 401);

  const db = admin();
  const started = Date.now();
  const stats = { claimed: 0, done: 0, failed: 0, deferred: 0, retry: 0 };

  while (Date.now() - started < TIME_BUDGET_MS) {
    const rows = await rpc<Outbox[]>(db, "fh_outbox_claim", { p_worker: WORKER, p_limit: BATCH });
    if (!rows || rows.length === 0) break;
    stats.claimed += rows.length;
    for (const row of rows) {
      try {
        const r = await process(db, row);
        if (r.deferred) { stats.deferred++; continue; }
        await rpc(db, "fh_outbox_complete", { p_id: row.id, p_ok: true, p_result: r.result ?? {}, p_error: null, p_retryable: true });
        stats.done++;
      } catch (err) {
        const e = err as Error & { retryable?: boolean };
        const retryable = e.retryable !== false;
        log("worker", "job failed", { id: row.id, kind: row.kind, error: e.message, retryable });
        await rpc(db, "fh_outbox_complete", { p_id: row.id, p_ok: false, p_result: {}, p_error: e.message.slice(0, 500), p_retryable: retryable });
        if (retryable && row.attempts < row.max_attempts) stats.retry++; else stats.failed++;
      }
    }
  }
  return json({ ok: true, worker: WORKER, ...stats, ms: Date.now() - started });
});

function fatal(msg: string): Error {
  const e = new Error(msg) as Error & { retryable?: boolean };
  e.retryable = false;
  return e;
}

/** Put a job back in the queue without burning an attempt (provider not configured yet). */
async function defer(db: any, row: Outbox, reason: string, minutes = 30) {
  await db.from("fh_outbox").update({
    status: "queued", locked_at: null, locked_by: null, attempts: Math.max(0, row.attempts - 1),
    next_attempt_at: new Date(Date.now() + minutes * 60_000).toISOString(), last_error: reason, updated_at: new Date().toISOString(),
  }).eq("id", row.id);
  if (row.message_id) {
    await db.from("fh_messages").update({ status: "held", hold_reason: "provider_not_configured", error: reason, updated_at: new Date().toISOString() }).eq("id", row.message_id);
  }
  log("worker", "deferred", { id: row.id, kind: row.kind, reason });
}

async function process(db: any, row: Outbox): Promise<{ result?: Record<string, unknown>; deferred?: boolean }> {
  switch (row.kind) {
    case "sms":
    case "mms":
      return sendSms(db, row);
    case "email":
      return sendEmail(db, row);
    case "call":
      return placeCall(db, row);
    case "voice_drop":
      return voiceDrop(db, row);
    case "webhook":
      return callWebhook(db, row);
    case "messenger":
    case "instagram":
      return sendMessenger(db, row);
    case "agent":
      return runAgent(db, row);
    case "push":
      return { result: { skipped: "push not wired yet" } };
    default:
      throw fatal(`unknown outbox kind ${row.kind}`);
  }
}

async function loadMessage(db: any, row: Outbox) {
  const id = row.message_id;
  const { data, error } = await db.from("fh_messages").select("*").eq("id", id).eq("org_id", row.org_id).single();
  if (error) throw new Error(`message lookup failed: ${error.message}`);
  if (!data || data.org_id !== row.org_id || data.client_id !== row.client_id) throw fatal("message does not belong to this outbox context");
  return data;
}

// ---------------------------------------------------------------- SMS via Twilio
async function sendSms(db: any, row: Outbox) {
  if (!twilioConfigured()) { await defer(db, row, "Twilio not configured: set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN"); return { deferred: true }; }
  const msg = await loadMessage(db, row);
  if (["canceled", "sent", "delivered"].includes(msg.status)) return { result: { skipped: msg.status } };
  const to = e164(row.payload.to ?? msg.to_address);
  const from = row.payload.from ?? msg.from_address;
  if (!to) throw fatal("no valid destination number");
  if (!from) throw fatal("no sending number on this org");
  const form: Record<string, string> = {
    To: to, From: from, Body: msg.body ?? "",
    StatusCallback: `${FUNCTIONS_URL}/twilio-sms?event=status`,
  };
  const media: string[] = Array.isArray(msg.media) ? msg.media.map((m: any) => (typeof m === "string" ? m : m?.url)).filter(Boolean) : [];
  if (media[0]) form.MediaUrl = media[0];
  const res = await twilioRequest("/Messages.json", form);
  if (!res.ok) {
    const code = Number(res.body.code ?? 0);
    const msgTxt = `twilio ${res.status}: ${res.body.message ?? "error"} (${code})`;
    // 21610 = unsubscribed recipient, 21211 = invalid number, 21614 = not a mobile
    if ([21610, 21211, 21614, 21408, 21606].includes(code)) throw fatal(msgTxt);
    throw new Error(msgTxt);
  }
  return { result: { provider: "twilio", provider_message_id: res.body.sid, provider_status: res.body.status, status: "sent" } };
}

// ---------------------------------------------------------------- Email via Resend
async function sendEmail(db: any, row: Outbox) {
  if (!resendConfigured()) { await defer(db, row, "Resend not configured: set RESEND_API_KEY"); return { deferred: true }; }
  const msg = await loadMessage(db, row);
  if (["canceled", "sent", "delivered"].includes(msg.status)) return { result: { skipped: msg.status } };
  const { data: settings } = await db.from("fh_org_settings").select("default_from_email, default_from_name, reply_domain, app_base_url").eq("org_id", row.org_id).single();
  const { data: conv } = await db.from("fh_conversations").select("email_thread_token").eq("id", msg.conversation_id).single();
  const fromEmail = msg.from_address ?? settings?.default_from_email;
  if (!fromEmail) throw fatal("no from address: set default_from_email in org settings");
  const fromName = settings?.default_from_name ?? "";
  const replyTo = settings?.reply_domain && conv?.email_thread_token ? `reply+${conv.email_thread_token}@${settings.reply_domain}` : undefined;
  const unsubscribe = conv?.email_thread_token ? `${FUNCTIONS_URL}/public-api/u/${conv.email_thread_token}` : undefined;
  const textBody = (msg.body ?? "") + (msg.purpose === "marketing" && unsubscribe ? `\n\nTo stop these emails: ${unsubscribe}` : "");
  const htmlBody = msg.body_html
    ? msg.body_html + (msg.purpose === "marketing" && unsubscribe ? `<p style="font-size:12px;color:#777">To stop these emails, <a href="${unsubscribe}">unsubscribe here</a>.</p>` : "")
    : undefined;
  const payload: Record<string, unknown> = {
    from: fromName ? `${fromName} <${fromEmail}>` : fromEmail,
    to: [msg.to_address],
    subject: msg.subject ?? "(no subject)",
    text: textBody,
    ...(htmlBody ? { html: htmlBody } : {}),
    ...(replyTo ? { reply_to: replyTo } : {}),
    headers: { "X-Entity-Ref-ID": msg.id, ...(unsubscribe ? { "List-Unsubscribe": `<${unsubscribe}>` } : {}) },
    tags: [{ name: "org", value: row.org_id.slice(0, 8) }, { name: "purpose", value: msg.purpose ?? "transactional" }],
  };
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST", headers: { Authorization: `Bearer ${Deno.env.get("RESEND_API_KEY")}`, "Content-Type": "application/json", "Idempotency-Key": `message/${msg.id}` },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = `resend ${res.status}: ${body?.message ?? body?.error ?? "error"}`;
    if (res.status >= 400 && res.status < 500 && res.status !== 429 && body?.name !== "concurrent_idempotent_requests") throw fatal(m);
    throw new Error(m);
  }
  return { result: { provider: "resend", provider_message_id: body.id, status: "sent" } };
}

// ---------------------------------------------------------------- Owner first call, press 1 to connect
async function placeCall(db: any, row: Outbox) {
  if (!twilioConfigured()) { await defer(db, row, "Twilio not configured: set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN"); return { deferred: true }; }
  const msg = await loadMessage(db, row);
  if (["canceled", "sent", "delivered"].includes(msg.status)) return { result: { skipped: msg.status } };
  const ownerTo = e164(row.payload.owner_to);
  const from = row.payload.from ?? msg.from_address;
  const clientTo = e164(row.payload.to ?? msg.to_address);
  if (!ownerTo) throw fatal("no owner phone to ring: set voice_forward_to on the org number");
  if (!from) throw fatal("no org number to call from");
  if (!clientTo) throw fatal("client has no valid phone");
  const res = await twilioRequest("/Calls.json", {
    To: ownerTo, From: from,
    Url: `${FUNCTIONS_URL}/twilio-voice?action=connect&message_id=${msg.id}`,
    StatusCallback: `${FUNCTIONS_URL}/twilio-voice?action=status&message_id=${msg.id}`,
    StatusCallbackEvent: "completed",
    Timeout: "25",
  });
  if (!res.ok) throw new Error(`twilio ${res.status}: ${res.body.message ?? "error"}`);
  return { result: { provider: "twilio", provider_message_id: res.body.sid, provider_status: res.body.status, status: "sent" } };
}

// ---------------------------------------------------------------- Voice drop (a normal call that plays a recording)
async function voiceDrop(db: any, row: Outbox) {
  if (!twilioConfigured()) { await defer(db, row, "Twilio not configured"); return { deferred: true }; }
  const msg = await loadMessage(db, row);
  if (["canceled", "sent", "delivered"].includes(msg.status)) return { result: { skipped: msg.status } };
  const to = e164(row.payload.to ?? msg.to_address);
  const from = row.payload.from ?? msg.from_address;
  const audio = row.payload.audio_url;
  if (!to || !from || !audio) throw fatal("voice drop needs to, from, and audio_url");
  const res = await twilioRequest("/Calls.json", {
    To: to, From: from,
    Url: `${FUNCTIONS_URL}/twilio-voice?action=drop&message_id=${msg.id}`,
    StatusCallback: `${FUNCTIONS_URL}/twilio-voice?action=status&message_id=${msg.id}`,
    StatusCallbackEvent: "completed",
    MachineDetection: "Enable",
  });
  if (!res.ok) throw new Error(`twilio ${res.status}: ${res.body.message ?? "error"}`);
  return { result: { provider: "twilio", provider_message_id: res.body.sid, status: "sent" } };
}

// ---------------------------------------------------------------- Messenger / Instagram DM via Graph API
async function sendMessenger(db: any, row: Outbox) {
  const msg = await loadMessage(db, row);
  if (["canceled", "sent", "delivered"].includes(msg.status)) return { result: { skipped: msg.status } };
  const { data: channel } = await db.from("fh_channels").select("config, external_id").eq("org_id", row.org_id).eq("kind", "messenger").eq("status", "active").order("created_at").limit(1).maybeSingle();
  const token = channel?.config?.page_token;
  if (!token) { await defer(db, row, "Messenger not configured: add a page token to the messenger channel"); return { deferred: true }; }
  const psid = row.payload.to ?? msg.to_address;
  if (!psid) throw fatal("client has no messenger id");
  const res = await fetch(`https://graph.facebook.com/v21.0/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ recipient: { id: psid }, messaging_type: "RESPONSE", message: { text: msg.body ?? "" } }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = `meta ${res.status}: ${body?.error?.message ?? "error"} (${body?.error?.code ?? ""})`;
    // 10 = outside the 24h messaging window, 551 = user unavailable
    if ([10, 551, 100].includes(Number(body?.error?.code))) throw fatal(m);
    throw new Error(m);
  }
  return { result: { provider: "meta", provider_message_id: body.message_id, status: "sent" } };
}

// ---------------------------------------------------------------- Outbound webhook
async function callWebhook(db: any, row: Outbox) {
  const { url, method = "POST", headers = {}, body } = row.payload;
  if (!url) throw fatal("webhook without url");
  const allowedHosts = (Deno.env.get("AUTOMATION_WEBHOOK_HOSTS") ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  if (!allowedHosts.length) {
    await defer(db, row, "Outbound webhooks need an operator-approved AUTOMATION_WEBHOOK_HOSTS allowlist");
    return { deferred: true };
  }
  const destination = new URL(url);
  if (destination.protocol !== "https:" || destination.username || destination.password
      || (destination.port && destination.port !== "443") || !allowedHosts.includes(destination.hostname.toLowerCase())) {
    throw fatal("webhook destination is not approved");
  }
  const res = await fetch(destination.href, {
    method, headers: { "Content-Type": "application/json", "User-Agent": "Fieldhorse-Growth/1.0", ...headers },
    body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
    redirect: "error", signal: AbortSignal.timeout(15_000),
  });
  // Never buffer an arbitrary webhook response in its entirety.
  const reader = res.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (reader && size < 4096) {
      const { done, value } = await reader.read();
      if (done) break;
      const part = value.subarray(0, 4096 - size);
      chunks.push(part); size += part.byteLength;
    }
  } finally { await reader?.cancel(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const part of chunks) { bytes.set(part, offset); offset += part.byteLength; }
  const textBody = new TextDecoder().decode(bytes);
  if (!res.ok) {
    const m = `webhook ${res.status}: ${textBody.slice(0, 200)}`;
    if (res.status >= 400 && res.status < 500 && res.status !== 429) throw fatal(m);
    throw new Error(m);
  }
  return { result: { status_code: res.status, response: textBody.slice(0, 500) } };
}

// ---------------------------------------------------------------- AI agent (Claude)
const AGENT_TOOLS = [
  { name: "propose_message", description: "Propose one message to send to the client. Use the channel that fits the thread.",
    input_schema: { type: "object", properties: { channel: { type: "string", enum: ["sms", "email"] }, body: { type: "string" }, subject: { type: "string" } }, required: ["channel", "body"] } },
  { name: "add_tag", description: "Add a tag to the client record.", input_schema: { type: "object", properties: { tag: { type: "string" } }, required: ["tag"] } },
  { name: "set_stage", description: "Move the client's job to a pipeline stage.", input_schema: { type: "object", properties: { stage: { type: "string", enum: ["lead", "quote", "job", "closed", "lost"] } }, required: ["stage"] } },
  { name: "create_task", description: "Create a task for the owner.", input_schema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] } },
  { name: "escalate", description: "Hand this thread to the owner with a one line summary. Use for pricing, legal, insurance, complaints.", input_schema: { type: "object", properties: { summary: { type: "string" } }, required: ["summary"] } },
  { name: "no_action", description: "Nothing should be sent right now.", input_schema: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"] } },
];

async function saveAgentRun(db: any, run: any, patch: Record<string, unknown>) {
  const { data, error } = await db.from("fh_agent_runs").update(patch).eq("id", run.id).eq("org_id", run.org_id).select("id").maybeSingle();
  if (error || !data) throw new Error(`agent run save failed: ${error?.message ?? "row not found"}`);
}

async function runAgent(db: any, row: Outbox) {
  if (!anthropicConfigured()) { await defer(db, row, "Anthropic not configured: set ANTHROPIC_API_KEY"); return { deferred: true }; }
  const { data: ar, error: runError } = await db.from("fh_agent_runs").select("*").eq("id", row.agent_run_id).eq("org_id", row.org_id).single();
  if (runError) throw new Error(`agent run lookup failed: ${runError.message}`);
  if (!ar || ar.org_id !== row.org_id || ar.client_id !== row.client_id) throw fatal("agent run does not belong to this outbox context");
  if (!["pending", "running"].includes(ar.status)) return { result: { skipped: ar.status } };
  await saveAgentRun(db, ar, { status: "running", updated_at: new Date().toISOString() });
  const { data: agent, error: agentError } = await db.from("fh_agents").select("*").eq("id", ar.agent_id).eq("org_id", row.org_id).single();
  if (agentError) throw new Error(`agent lookup failed: ${agentError.message}`);
  if (!agent || agent.status !== "active") throw fatal("agent missing or paused");

  const ctx = await rpc<any>(db, "fh_client_ctx", { p_client_id: ar.client_id, p_contact_id: ar.contact_id, p_event: ar.input ?? {} });
  const system = await rpc<string>(db, "fh_render_template", { p_text: agent.system_prompt, p_ctx: ctx });

  const { data: history, error: historyError } = await db.from("fh_messages")
    .select("channel, direction, body, subject, created_at, sent_by_kind, status")
    .eq("conversation_id", ar.conversation_id).eq("org_id", row.org_id).neq("channel", "note")
    .order("created_at", { ascending: false }).limit(20);
  if (historyError) throw new Error(`conversation lookup failed: ${historyError.message}`);
  const thread = [...(history ?? [])].reverse().map((m: any) =>
    `[${m.created_at.slice(0, 16)} ${m.direction === "inbound" ? "CLIENT" : "US"} via ${m.channel}${m.status === "held" ? " (not sent, held)" : ""}] ${m.subject ? m.subject + " :: " : ""}${m.body ?? ""}`).join("\n");

  const lastInbound = (history ?? []).find((m: any) => m.direction === "inbound");
  const guard = agent.guardrails ?? {};
  const escalateWords: string[] = guard.escalate_keywords ?? [];
  const forcedDraftReason = lastInbound && escalateWords.some((w) => (lastInbound.body ?? "").toLowerCase().includes(String(w).toLowerCase()))
    ? "escalation keyword in last client message" : null;

  const userPrompt = [
    `CLIENT RECORD:\n${JSON.stringify({ client: ctx.client, job: ctx.job }, null, 0)}`,
    `CONVERSATION (oldest first):\n${thread || "(no messages yet)"}`,
    ar.input?.instructions ? `INSTRUCTIONS FROM THE WORKFLOW OR OWNER:\n${ar.input.instructions}` : "",
    `Decide what to do. Call exactly one primary tool (propose_message, escalate, or no_action). You may also call add_tag, set_stage, or create_task as side actions.`,
  ].filter(Boolean).join("\n\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({
      model: agent.model || "claude-sonnet-5",
      max_tokens: 1024,
      system,
      tools: AGENT_TOOLS.filter((t) => (agent.tools ?? []).includes(t.name) || t.name === "no_action" || t.name === "propose_message"),
      messages: [{ role: "user", content: userPrompt }],
    }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const m = `anthropic ${res.status}: ${body?.error?.message ?? "error"}`;
    if (res.status === 400 || res.status === 401 || res.status === 403) throw fatal(m);
    throw new Error(m);
  }

  const blocks: any[] = body.content ?? [];
  const toolUses = blocks.filter((b) => b.type === "tool_use");
  const textOut = blocks.filter((b) => b.type === "text").map((b) => b.text).join("\n");
  const proposal: Record<string, any> = { actions: [] as any[] };
  for (const t of toolUses) {
    if (t.name === "propose_message") { proposal.channel = t.input.channel; proposal.body = t.input.body; if (t.input.subject) proposal.subject = t.input.subject; }
    else if (t.name === "escalate") { proposal.escalate = t.input.summary; proposal.actions.push({ type: "add_tag", tag: "needs_owner" }); }
    else if (t.name === "no_action") { proposal.no_action = t.input.reason; }
    else if (t.name === "add_tag") proposal.actions.push({ type: "add_tag", tag: t.input.tag });
    else if (t.name === "set_stage") proposal.actions.push({ type: "set_stage", stage: t.input.stage });
    else if (t.name === "create_task") proposal.actions.push({ type: "create_task", text: t.input.text });
  }
  const usage = body.usage ?? {};
  const base = { output: { text: textOut, tool_uses: toolUses.map((t) => ({ name: t.name, input: t.input })), model: body.model }, proposal, tokens_in: usage.input_tokens ?? null, tokens_out: usage.output_tokens ?? null, updated_at: new Date().toISOString() };

  // side actions that never need approval: tasks for the owner
  for (const a of proposal.actions) {
    if (a.type === "create_task") {
      await rpc(db, "fh_notify_org", { p_org_id: row.org_id, p_kind: "task", p_title: a.text, p_body: `From ${agent.name}`, p_link: `/inbox?client=${ar.client_id}`, p_to: "owners", p_user_ids: null }).catch(() => {});
    }
  }

  if (proposal.no_action || (!proposal.body && !proposal.escalate)) {
    await saveAgentRun(db, ar, { ...base, status: "no_action", error: proposal.no_action ?? null });
    return { result: { status: "no_action" } };
  }
  if (proposal.escalate && !proposal.body) {
    await saveAgentRun(db, ar, { ...base, status: "proposed" });
    await rpc(db, "fh_notify_org", { p_org_id: row.org_id, p_kind: "escalation", p_title: `${agent.name}: needs you`, p_body: proposal.escalate, p_link: `/inbox?client=${ar.client_id}`, p_to: "owners", p_user_ids: null }).catch(() => {});
    await rpc(db, "fh_tag_add", { p_org_id: row.org_id, p_client_id: ar.client_id, p_tag: "needs_owner", p_source: "agent", p_user: null }).catch(() => {});
    return { result: { status: "escalated" } };
  }

  // auto send only inside the rules
  let autoOk = !proposal.escalate && ar.mode === "auto" && ["auto", "auto_within_rules"].includes(agent.autonomy) && !forcedDraftReason;
  let autoBlock: string | null = forcedDraftReason ?? (proposal.escalate ? "agent requested owner review" : null);
  if (autoOk && guard.business_hours_only) {
    const inWindow = await rpc<boolean>(db, "fh_in_send_window", { p_org_id: row.org_id, p_at: new Date().toISOString() });
    if (!inWindow) { autoOk = false; autoBlock = "outside send window"; }
  }
  if (autoOk && guard.max_messages_per_client_per_day) {
    const since = new Date(); since.setHours(0, 0, 0, 0);
    const { count, error: countError } = await db.from("fh_messages").select("id", { count: "exact", head: true })
      .eq("client_id", ar.client_id).eq("org_id", row.org_id).eq("direction", "outbound").eq("sent_by_kind", "agent").gte("created_at", since.toISOString());
    if (countError || count === null) { autoOk = false; autoBlock = "could not verify daily agent message cap"; }
    else if (count >= Number(guard.max_messages_per_client_per_day)) { autoOk = false; autoBlock = "daily agent message cap reached"; }
  }
  if (autoOk && guard.never_promise_price && /\$\s?\d/.test(proposal.body ?? "")) { autoOk = false; autoBlock = "draft mentions a dollar amount"; }

  await saveAgentRun(db, ar, { ...base, status: "proposed", error: autoBlock });
  if (autoOk) {
    const msgId = await rpc<string>(db, "fh_agent_run_approve", { p_agent_run_id: ar.id, p_body: null, p_channel: null });
    await saveAgentRun(db, ar, { status: "auto_executed", updated_at: new Date().toISOString() });
    return { result: { status: "auto_executed", message_id: msgId } };
  }
  await rpc(db, "fh_notify_org", { p_org_id: row.org_id, p_kind: "ai_draft", p_title: `${agent.name} drafted a reply for ${ctx?.client?.name ?? "a client"}`, p_body: (proposal.body ?? "").slice(0, 140), p_link: `/inbox?client=${ar.client_id}`, p_to: "owners", p_user_ids: null }).catch(() => {});
  return { result: { status: "proposed", reason: autoBlock } };
}
