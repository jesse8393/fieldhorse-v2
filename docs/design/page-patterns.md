# Workspace page patterns

The shared workspace hierarchy lives in `src/styles/page-system.css` and `src/styles/tokens.css`. Existing `fh-build` and `v3` pages use the same rules. Public proposals, PDFs and image based feature stages retain their task specific composition.

1. Page titles use Barlow Condensed, 30 pixels on desktop and 24 pixels on phone, with a 1.12 line height. Section headings use the same display family. Label and helper text use Barlow at 14 pixels with a 1.4 or 1.5 line height. Editable settings text uses 16 pixels.
2. Desktop page content uses 24 pixel gutters and vertical section gaps. Phone pages use the existing 20 pixel shell gutter. Cards share paper surfaces, token borders, 14 pixel corners and the quiet shared shadow.
3. Global search remains in the desktop topbar. The primary page action belongs beside search or the page heading. Row actions stay inside their row. Controls have an actual 44 pixel minimum height, without invisible overlapping hit regions.
4. Secondary text uses the measured secondary ink token at full opacity. Avoid combining muted color and reduced opacity. Status colors always accompany text.
5. Settings use six URL views: Business, Documents, Payments, Rates, Preferences and Account. A view saves only its own profile fields. Switching views retains drafts and marks their navigation entries. Rate, logo, location, theme and device notification controls save with their own actions. Existing template, rate and location links remain valid.
6. Preserve responsive task differences such as the Today feature stage, schedule grid and financial table. Match their reading hierarchy and controls rather than forcing every task into one card arrangement.

Verification covers computed typography and control bounds, day and night token contrast, settings section isolation, draft retention and narrow viewport overflow. Human preference testing remains necessary before assigning a design quality score.
