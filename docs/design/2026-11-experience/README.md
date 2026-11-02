# FieldHorse welcome and daily workflow experience

The public welcome page now introduces FieldHorse through one fieldwork film, an actual sample workspace, and three short guides. Today exposes everyday shortcuts and the phone job page keeps Call, Message, Navigate and Photos visible before opening job details.

## Visual direction

Use the existing white, charcoal and copper tokens, Manrope, a clear type hierarchy, generous space and quiet borders. The existing Day and Night themes remain available. Copper marks an action or selected state. Fieldwork imagery belongs on the welcome page; operational screens remain focused on records and actions.

The welcome film is a deliberate play action with a still visible first. Videos are not part of the service worker precache and no video element or source is mounted until requested. Guides use native controls, English captions, readable steps and retry states. Changing guides unmounts the previous player. Playback and failure transfer keyboard focus to the available control.

## Media

All assets are self hosted under `public/media`. No Higgsfield account or runtime API call is required to display them.

| Asset | Purpose | Format |
| --- | --- | --- |
| `fieldhorse-craft.webp`, `fieldhorse-craft-small.webp` | Responsive still for the welcome film | WebP, 1344 and 800 pixels wide |
| `fieldhorse-welcome.mp4` | Eight second fieldwork introduction | H.264, 1280 pixels wide, silent, fast start |
| `fieldhorse-today.webp` | Actual desktop Today screen with sample records | WebP, 1280 by 960 |
| `guide-job.mp4` | Create a job, choose a customer, enter title and scope, save | H.264, 720 by 1280, about 17 seconds |
| `guide-day.mp4` | Check Today, create a visit, link a job, review Schedule | H.264, 720 by 1280, about 16 seconds |
| `guide-update.mp4` | Open a job, review Photos, Contract balance and Invoices | H.264, 720 by 1280, about 17 seconds |
| `guide-*.webp`, `guide-*.vtt` | Still previews and English step captions | WebP and WebVTT |

The still and welcome film are synthetic content generated through the connected Higgsfield account. The still used GPT Image 2.5, job `bbadad2c-5bd9-44dd-b42e-e9fa988e05c0`. The film used Seedance 2.5 with the still as its reference, job `a81955a5-963d-4708-8d4b-91e1a1be9463`. The film has no narration, logos, testimonials or customer claims.

The tutorials are recordings of this branch's actual browser UI, not generated interfaces. Browser network routes used the shared QA mock with synthetic Oak & Stone, Alex Morgan, Morgan Davis and 100 Sample Lane records. Job and visit writes were retained inside that isolated mock to demonstrate the saved result. Photos use the synthetic framing image. No production workspace was read or changed. The page labels these recordings as sample records.

To refresh a guide, record the current UI against synthetic fixtures at a 450 by 800 viewport, verify each save against the local mock, crop any capture padding, export H.264 with `yuv420p` and fast start at 720 by 1280, update the WebVTT timings and poster, and run the playback tests. Replace exported files only after FFprobe and full decode succeed.

## Verification

Local checks passed: TypeScript, ESLint, design audit, production build, and 1,537 unit tests. Browser checks covered 49 public/login cases, all 40 applicable Job cases, and 22 experience/Today cases. The experience coverage includes 320 pixel Day and Night layouts, complete media loading, deliberate playback, retry after network failure, captions, focus, switching guides, schedule and capture navigation, and crew financial visibility.

Local browser testing used Chromium 153 with Playwright and Node 24 because those were available in the execution environment. Repository CI uses its pinned Node 22 and Playwright Chromium. The existing build emits a warning about `stages.ts` being both statically and dynamically imported.

This change covers the web application and responsive phone layouts. It does not resolve the backend, financial authorization, quote conversion deployment or native release issues documented in the existing audit and PR #235.
