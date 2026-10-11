# Phase 6 Implementation Plan: Inbox

**Goal:** An Inbox list and thread on a phone and desktop, matching `base/inbox.jpg`, on the Growth Engine contracts that already exist in `src/lib/database.types.ts`, shown only when the engine is on (D9).

**Spec:** SPEC.md section 9.8.

**Contracts (from `database.types.ts`):**
* View `fh_v_inbox`: `conversation_id, client_id, client_name, company_name, last_preview, last_message_at, last_channel, unread_count, pending_drafts, latest_stage, starred, status, snoozed_until`.
* Tables `fh_messages` (`direction, channel, body, status, read_at, hold_reason, sent_by_kind, agent_run_id, created_at`) and `fh_agent_runs` (`id, status, proposal, conversation_id`).
* RPCs:
  * `fh_send_message({ p_body, p_channel, p_client_id, p_contact_id?, p_subject? })`
  * `fh_conversation_mark_read({ p_conversation_id })`
  * `fh_agent_run_approve({ p_agent_run_id, p_body?, p_channel? })`
  * `fh_agent_run_reject({ p_agent_run_id, p_reason? })`

## Review Focus

1. **Engine off.** No Inbox in the dock or sidebar, and `/inbox` shows "Inbox turns on with messaging" and a link to Settings. Pinned in Task 6.1.
2. **A held message** (`hold_reason` set). It shows "Held: {reason in words}" and never looks sent. Pinned in Task 6.2.
3. **Approving a draft after editing it.** The edited text is what goes in `p_body`. Pinned in Task 6.3.
4. **Double tap on Send.** Exactly one RPC call. Pinned in Task 6.3.
5. **Opening a thread.** Marks it read once, not on every render. Pinned in Task 6.3.

### Task 6.1: Inbox data and the engine switch

**Files:** Create `src/lib/inbox.ts`, `src/lib/inbox.test.ts`. Modify `scripts/qa-mock.mjs` (tables `fh_v_inbox`, `fh_messages`, `fh_agent_runs`, `fh_org_settings` with `engine_enabled`, and RPC routes `/rest/v1/rpc/fh_*` that record calls and return ids), `src/lib/navItems.ts`, `src/components/fh/Dock.tsx`, `src/components/DesktopSidebar.tsx`.

**Interfaces:**
* `useEngineEnabled(): boolean | undefined` reads `fh_org_settings.engine_enabled` for the current org.
* `useInbox()` returns the `fh_v_inbox` rows, newest first.
* `useThread(conversationId)` returns `fh_messages` plus proposed `fh_agent_runs`.
* `sendMessage`, `markRead`, `approveDraft(runId, body)` and `rejectDraft(runId)` wrap the RPCs as TanStack mutations, with a guard against a second call while one is pending.
* Pure `threadItems(messages, runs): ({ kind: 'message'; ... } | { kind: 'draft'; ... })[]` in time order. A held message gets `held: string` in words.
* `INBOX` nav item. The dock's fifth slot is `INBOX` when `useEngineEnabled()` is true, else `SCHEDULE`.

* [ ] **Step 1: Write the failing tests:**
  * `threadItems` ordering;
  * a held message carries the reason in words;
  * the dock item resolver returns Schedule for false or undefined and Inbox for true.
* [ ] **Step 2:** Run. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 6.2: Inbox list

**Files:** Create `src/screens/inbox/Inbox.tsx`, `src/screens/inbox/inbox.css`. Modify `src/App.tsx` (lazy routes `/inbox` and `/inbox/:conversationId`).

**Layout:**
* Title "Inbox".
* Rows: name, preview, time, unread dot, a job chip from `latest_stage`, and a "Draft ready" info chip when `pending_drafts > 0`.
* Empty: "No conversations yet."
* Engine off: the message from Review Focus 1.

* [ ] **Step 1:** Write the failing e2e test: with the engine on, the rows and the "Draft ready" chip show; with it off, the engine off message shows and the dock has Schedule.
* [ ] **Step 2:** Run. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 6.3: Thread with the AI draft

**Files:** Create `src/screens/inbox/Thread.tsx`.

**Layout:**
* Header: name, a job chip linking to the job, a call button.
* Bubbles: sent in ink with linen text, received on paper with a hairline.
* Day labels.
* The draft panel:
  * "Draft reply" and an editable text area;
  * brushed gold "Send", which calls `approveDraft` with the current text;
  * quiet "Discard", which calls `rejectDraft`.
* Composer: text field, dictation through the browser `SpeechRecognition`, the same way `CaptureSheet.tsx` does it, dark send button.
* Mark read once on open.

* [ ] **Step 1: Write the failing e2e tests** with RPC call recording in the mock:
  * editing the draft then Send records one `fh_agent_run_approve` call whose `p_body` equals the edited text;
  * double tapping Send records one call;
  * opening the thread records one `fh_conversation_mark_read`.
* [ ] **Step 2:** Run. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 6.4: Phase 6 side by side review

* [ ] Add the thread next to `base/inbox.jpg`. Review, fix, rerun, `test:all`, `audit:design`, push, draft pull request.
