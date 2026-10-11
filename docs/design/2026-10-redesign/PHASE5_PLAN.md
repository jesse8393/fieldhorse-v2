# Phase 5 Implementation Plan: What the customer sees, and signing in

**Goal:** The customer quote page and Login match `glamor/g-portal.jpg` and `glamor/g-welcome.jpg`, within decisions D7 and D11.

**Spec:** SPEC.md sections 9.1 and 9.9.

## Review Focus

1. **No logo.** The monogram shows the company initials in brushed gold. Pinned in Task 5.1.
2. **No photos on the job.** The header is onyx only, with no empty image box. Pinned in Task 5.2.
3. **Already approved quote.** The page shows "Approved" instead of the approve bar, with the name and date only when the payload has them (D12). Pinned in Task 5.2.
4. **No payment link set.** No deposit button appears after approval. Pinned in Task 5.2.
5. **Phone keyboard on Login.** Fields stay visible above the keyboard and the button is reachable. Pinned in Task 5.3.

### Task 5.1: Portal view model

**Files:** Create `src/lib/portalView.ts`, `src/lib/portalView.test.ts`

**Interfaces:** `buildPortalView(payload: PublicDocPayload, now: Date): { firstName: string; companyName: string; initials: string; logoUrl: string | null; coverUrl: string | null; trustLine: string | null; headline: string; addressLine: string; total: number; deposit: { pct: number; amount: number }; included: { title: string; amount: number }[]; optional: { title: string; amount: number }[]; steps: string[]; approved: { name: string | null; date: string | null } | null; payUrl: string | null }`

* `PublicDocPayload` does not exist yet. `PublicDoc.tsx` types the response as `any`, so define `PublicDocPayload` in `portalView.ts` from the fields PublicDoc actually reads.
* `approved` is set when `contact.proposal_status === 'approved'`; `name` and `date` are null unless the payload carries them (D12).
* `coverUrl` is the first entry of `payload.photos`.
* `trustLine` joins `insured_text` and the license number, for example "Licensed and insured, Murfreesboro".
* `headline` is "Hi {firstName}, your quote is ready."
* `steps` are three plain sentences built from the payment schedule:
  * "You approve and pay the deposit."
  * "{Company first word} sends you a start date."
  * "You pay the balance after the walkthrough."
* `payUrl` is `safePayUrl(company.payment_link)` or null.

* [ ] **Step 1: Write the failing tests:** first name from "Marco Castellanos"; initials "PC" from "Parker Construction"; no photos gives `coverUrl` null; an approved quote fills `approved`; no payment link gives `payUrl` null; no generated string contains a dash character.
* [ ] **Step 2:** Run. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 5.2: The Fieldhorse proposal theme

**Files:** Modify `src/components/documents/proposalThemes.tsx` (new `FieldhorseProposal`), `src/components/documents/ProposalTemplate.tsx` (`TEMPLATE_COMPONENTS` gains `fieldhorse`; a missing `estimate_template` keeps resolving to classic, per D13), `src/components/public/ApproveProposalBar.tsx` (visual only), `src/screens/PublicDoc.tsx` (page background from tokens), `src/screens/Settings.tsx` (picker option "Fieldhorse"). Test `tests/e2e/portal.spec.ts`.

**Layout:**
* Cover photo fading into onyx, or onyx alone.
* Monogram, company name, trust line, call button.
* Headline and address in linen, gold hairline.
* Total panel in a paper tray: the total and the deposit sentence.
* "What's included" rows.
* "Optional additions": read only rows, each with an "Ask about this" link to the existing request changes flow with the item name prefilled.
* "What happens next": three numbered steps. A real sequence, so numbers are right here.
* Bottom onyx capsule:
  * the approve bar restyled, with the name field and authority checkbox kept;
  * a brushed gold "Approve this quote";
  * the linen link "Ask {company first word} a question first", which opens request changes.
* After approval, a brushed gold "Pay deposit $X" when `payUrl` exists.
* "Powered by Fieldhorse" small at the very bottom.

* [ ] **Step 1: Write the failing e2e tests:** mock `/api/public-link?token=t1` with a proposal payload via `context.route`, then check:
  * the headline is visible;
  * the approve bar is visible and posts only on tap (spy on `/api/public-link-approve`);
  * with `photos: []` there is no `img` in the header;
  * with `proposal_status: 'approved'`, "Approved" is shown and there is no approve bar;
  * with no `payment_link`, there is no "Pay deposit".
* [ ] **Step 2:** Run. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 5.3: Welcome and Login

**Files:** Modify `src/screens/Login.tsx`, `src/screens/ResetPassword.tsx`, `src/screens/PartnerInvite.tsx`, `src/styles/global.css` (remove the forced dark `.fh-auth-screen` block around lines 8774 to 8813). Create `src/screens/auth/auth.css`. Test `tests/e2e/login.spec.ts`.

**Layout:**
* Full screen onyx with grain. When `public/welcome.jpg` loads, show it in the top 55 percent fading into onyx.
* FIELDHORSE wordmark: FIELD in brushed gold, HORSE in linen, gold hairline under it.
* The line "Run every job like a captain."
* Email and password `Field`s with linen labels on onyx.
* Brushed gold "Sign in".
* Outlined linen "Create a workspace", which switches to the existing sign up mode.
* Quiet "Forgot password?".
* The small smoke line "Bring your jobs over from Jobber in a few minutes."
* `ResetPassword` and `PartnerInvite` use the same shell and drop `Aurora` and `GridPattern`.

* [ ] **Step 1: Write the failing e2e tests:**
  * signed out, `/login` shows "Run every job like a captain." and the button "Sign in";
  * the `.fh-auth-screen` hard coded dark colors are gone, checked by the label's computed color equalling linen `rgb(242, 237, 228)` on the onyx background;
  * on mobile, focusing the password field keeps "Sign in" inside the visual viewport.
* [ ] **Step 2:** Run. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 5.4: Phase 5 side by side review

* [ ] Add the portal (390 wide) next to `glamor/g-portal.jpg` and Login next to `glamor/g-welcome.jpg`. Review, fix, rerun, `test:all`, `audit:design`, push, draft pull request.
