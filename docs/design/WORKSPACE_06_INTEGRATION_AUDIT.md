# Workspace 06 integration audit

Reviewed October 31, 2026. Work continues from draft PR #230 at `19f141f16c87dcf678f7b0c0e2fabeb5d9ad0ee4`. That revision passed CI run 445. The earlier `b764c7fff65659a47d7cb84fa7018dd268503678` result does not certify these changes.

This pass traces customer selection, job creation, task completion, Undo, offline replay, scheduling prerequisites, photo storage, role policies, and financial displays. It changes application source and tests only. No production data, database configuration, migrations, or production application deployment changed during this pass.

## Reproduced and repaired

1. Saving a typed existing customer copied the typed form fields instead of stored customer details. Jobs could lose phone, email, and address while still linking the correct customer ID. Customer resolution now reads the selected record within its workspace before saving. Missing records and failed reads retain the form and show an error.

2. Job, lead, and quote drafts saved a customer ID but discarded that selection on restoration. Customers sharing a name could resolve to a different record. Restored drafts retain their chosen ID. Resolution revalidates that ID against current workspace access.

3. Offline update replay did not request affected rows. A permission filtered update or deleted record could change nothing and still show as synced. Replay now requires returned row evidence. The task view reconciles both successful and rejected replay.

4. The outbox retained a timestamp and random text fallback for row IDs. Browsers without native `crypto.randomUUID` therefore generated invalid PostgreSQL UUIDs. Outbox inserts and queue keys now use the shared secure UUID helper.

5. An online Undo could reach the server before an earlier offline completion. Replaying the older completion then reversed Undo. Updates now serialize per record within the running app. New updates join pending work in order. A flush requested during another pass schedules another pass for appended edits. Cross tab simultaneous writers remain release validation.

6. Queued inserts and photo metadata without an explicit organization could inherit whichever company was active when replay ran. New entries capture their original workspace before waiting. Explicit organization values remain intact. Previously queued entries without organization metadata cannot establish their original workspace and require review before rollout.

7. IndexedDB request success preceded transaction commit. An eventual transaction abort could therefore receive a false saved response. Offline writes now await transaction completion. An abort regression confirms failure reaches the caller.

8. Task reads could replace queued completion or creation with older server state. Task reads now overlay this user's pending writes. Queue changes trigger reconciliation. Obsolete reads cannot overwrite a newer job view. Offline completion copy explicitly reports pending synchronization.

## Available integration evidence

Connected database inspection used read only catalog and aggregate queries. Customer links, task links, and job schedule links showed no organization mismatches. Existing photo metadata had matching storage objects. Both application file buckets were private. This verifies stored integrity and configuration, not authenticated download access or successful writes.

Customer, job, task, schedule, and photo tables had row security enabled. Invoice and payment restrictions for financial roles were restrictive policies. Crew expense entry remained available by design. Source review confirmed role filtering in job navigation and financial presentation. These checks do not replace owner, manager, crew, partner, and revoked membership sessions through the API.

Only the main Supabase branch was available. Its schedule table lacked `assigned_user_ids`. The pending crew allocation and invoice safeguards remained unapplied. The redesigned scheduling path reads and writes the new assignment column. Release requires migration validation in an isolated Supabase environment before production approval. No compatibility fallback removes those safeguards.

The current Netlify preview status reported ready. Opening the preview redirected to Netlify team protection. Automatic approval review denied access to Netlify's account origin. Preview interaction therefore remains unverified. No protection was bypassed.

## Checks and limits

Focused regression tests failed against the original behavior for missing customer details, discarded selection validation, invalid UUIDs, false replay success, workspace attribution, and Undo ordering. The repaired regression tests pass locally. A separate IndexedDB abort test checks committed storage behavior.

Local TypeScript, ESLint, design audit, RLS source audit, production build, and the unit suite passed. Local database tests passed 98 isolated checks. Those tests cover selected schema fixtures, not the complete historical migration chain. Local Node was 24.22.1; normal CI uses required Node 22 and PostgreSQL 17, including independent connection contention tests.

Six new browser regressions cover customer contact copying, duplicate name draft restoration, revoked customer access, delayed completion plus Undo, refused replay, and UUID fallback task creation. Each runs in desktop and phone CI projects. Their stateful responses remain controlled fixtures. They do not establish real Supabase authentication, real storage authorization, or physical phone behavior.

Local browser execution could not start because the matching Chromium binary was absent. Its download returned invalid archives. Current CI must execute these tests before this revision receives a browser pass claim. Consult checks for the current commit, never an earlier green revision.

Release remains blocked on authorized preview access, an isolated Supabase integration environment, pending migration validation, actual role sessions, offline and reconnect checks on physical phones, and production approval. PR #230 remains a draft.
