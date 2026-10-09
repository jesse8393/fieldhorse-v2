# UI Audit Response (July 26, 2026)

Response to the 43-item external UI audit (items 1–42 received; the
report was cut off mid-item at #43). Status per finding, with the root
cause where it differs from the surface symptom.

## Fixed

| # | Finding | Fix |
|---|---|---|
| 1 | Team page raw DB error, feature dead | Root cause was migrations 053–057 never applied to production (the `default_hourly_rate` column didn't exist). Applied. Plus: human error messages client- and server-side, in-flight guard on the roster load. |
| 2 | Invisible icon buttons (0.67px SVGs) | Global `svg { flex-shrink: 0 }` reset — covers Tasks delete/done, Timesheets flag/approve, Forecast weather icons. Delete-task keeps its existing Undo toast (equivalent safety to a confirm, one less tap). |
| 3 | Invoice/Clients tables clipped with no scroll | Table cards scroll horizontally; wide list tables share a 640px min-width so columns stay aligned while overflowing. |
| 4 | Home right rail rendered off-viewport | Grid tracks floored at 980px+ inside a ~700px container. Rebuilt as minmax(0,fr) tiers: 1 col ≥900, 2 cols + full-width saved rail ≥1200, 3 cols ≥1500. |
| 5 | Forecast 7-day strip self-colliding | Tiles keep a 96px minimum and the strip scrolls; icons restored by #2's fix. |
| 6 | Tables misaligned everywhere | Root cause: a later-in-file mobile `display:flex` baseline silently overrode the desktop grid rules at every width. Scoped it to <900px — header and cells now share the same grid tracks on all six screens. |
| 7 | Bad URLs silently land on Home | Real 404 view (`src/screens/NotFound.tsx`) with the failed path and a route back. |
| 8 | Silent required-field validation | New-event modal and Add-milestone: inline error, `aria-invalid`, red border, focus moved to the field. |
| 9 | Month view isn't a month | Desktop month view now renders the labeled calendar month (1st → last day) with per-month navigation. |
| 10 | Job picker unusable (8× "Justin Bryan") | Options carry project/address + stage; lost-stage rows excluded; newest first. |
| 11 | Data disagrees between screens | Work "All" chip now counts everything (26→28 mismatch); Schedule's hardcoded "Crews active · 4"/"Conflicts · 0" replaced with real metrics; Home labels renamed to what they measure; Field Reports list labeled "Latest 6 of N"; Last touch clamped to record creation; Analytics Invoiced YTD takes the larger of the two estimates. Follow-up counts intentionally differ per surface (deals due vs queued actions vs cooling clients) — now labeled distinctly instead of all claiming "follow-ups". |
| 12 | Zero-length punches approvable | Surfaced as `invalid` by the timesheets endpoint; shown with a red "Invalid" chip, excluded from Approve-all, KPIs, and (already) job cost. |
| 14 | Dots overlap deal counts on Home | Gone with the duplicate stage-tile grid (see #32). |
| 15 | Work filter chips stacked in the corner | Chips get their own full-width wrapping row under the heading. |
| 16 | FABs cover content | 160px bottom padding reserved on every desktop page body. |
| 17 | Colored card stripes | Removed; stage communicated by the pill badge only. |
| 18 | Fallback strings as hero headlines | Rail-card headline capped below H1 (42→30px); `data-empty` renders fallbacks at quiet body scale; worst offenders ("Source not set", "Phase B", "Capture in /notes") converted. |
| 19 | Internal roadmap/routes shown to customers | Team/Crew/Templates copy rewritten as customer-facing language; no phase names, no route paths, no design-system glossary. |
| 20 | Quote tab title collapses into buttons | Header wraps; title column keeps a 260px minimum; display size clamps. |
| 21 | Raw UUID as estimate number | Workspace eyebrow uses the same `proposalNumber()` the customer documents use; document numbers now anchor their year to the issue date (no January renumbering). |
| 22 | Charts render as two slashes | They were decorative CSS gradients pretending to be sparklines — no data behind them. Removed. |
| 23 | Toast overlaps header | Toasts bottom-anchored with offsets clear of the mobile nav. |
| 24 | Inconsistent disabled buttons | One `.v3-btn--primary:disabled` token: fill dropped entirely, muted text. |
| 25 | Native scrollbar under subtabs | Tab strips hide the native scrollbar (still wheel/drag scrollable). |
| 26 | 15px layout jump on menu open | `scrollbar-gutter: stable` on the root. |
| 27 | Bottom-sheet modal on desktop | Drawers ≥900px: centered, 600px max width, 88dvh max height. |
| 28 | Weather works on 2 of 8 screens | Shared `TopbarWeather` with a 10-minute cache replaces six hardcoded "Weather not set" spans — every header resolves the same numbers. |
| 29 | Duplicate filter controls on Clients | Segmented-control card removed; the counted pill row is the filter. |
| 30 | Filter state lost on refresh | Work `?stage=`, Clients `?filter=`, Invoices `?view=`, Timesheets `?window=` — all in the URL, shareable, refresh-proof. |
| 31/32 | Nested cards + Home duplicates its pipeline twice | The stage-tile grid inside the pipeline hero (5 nested cards duplicating the workflow strip above it) removed; hero keeps the money figure + stage line. |
| 33 | DONE and ACTIVE both green | Done uses the stage-closed steel; green reserved for Active. |
| 35 | Two off-palette reds | All 13 raw `#ee4942` occurrences (and alpha washes) mapped to the `--v3-danger-bright` token. |
| 37 | Third font family shipped | Instrument Serif removed from the Google Fonts request; `--font-serif` (both copies) and `DOC_FONTS.serif` map to DM Sans. Two-family brand restored. |
| 38 | Gradient text | All three `background-clip: text` rules replaced with solid brand gold. |
| 39 | ui-monospace / -apple-system leaks | `button/input/select/textarea { font-family: inherit }` + `kbd` set to the body family. |
| 40 | Global 16px !important on inputs | Scoped to ≤767px (its iOS-zoom purpose); desktop inputs match neighboring controls again. |
| 42 | H1 differs on Work | `.jobs-title` now uses the app-wide display scale (Bebas, clamp to 36px, weight 400). |

## Partially addressed

- **#13 slow blank paint on /pipeline, /tasks** — route-level skeletons
  already exist (`RouteFallback`); the multi-second paint block needs
  in-browser profiling this environment can't do (no Supabase env, app
  can't boot here). The `/pipeline` redirect itself is instant; suspect
  the data-fetch waterfall. Left for a profiling session.
- **#34 off-palette hex sweep** — the notable offenders are fixed (the
  duplicate reds, gradient golds, milestone green wash). The remaining
  ~60 hexes are a token-migration project across 8,900 lines of CSS;
  doing it blind (no visual pass possible here) risks regressions on
  every screen. Recommend a dedicated pass with visual review.
- **#36 decorative green** — milestone checkbox wash and Home stage dot
  fixed; remaining instances (report link chips, Mint estimate theme —
  a user-selectable product theme) left deliberately.

## Deferred (with reasons)

- **#41 nineteen breakpoints** — consolidating to 3–4 tokens touches
  every media query in the app; without the ability to render at
  multiple widths (the audit itself couldn't resize this environment's
  browser), a blind refactor is high-risk. Needs its own change with
  screenshot coverage.
- **Audit blockers A/B/C** — width passes, valid-data submits, and auth
  flows remain untested for the same environmental reasons the auditor
  hit.
- **Items #43+** — the report was truncated mid-item 43; send the
  remainder and they'll be triaged the same way.

## Also noted
- The "Audit Test Lead (Claude)" record the auditor found in production
  predates this session and was not created here; it should be deleted
  from the live account (one tap in the app — not done from here since
  it's production data).
