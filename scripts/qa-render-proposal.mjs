// QA stub — headless proposal render is not currently feasible.
//
// Why this script can't render the PDF in pure Node:
//   1. pdfLogo.js relies on browser image APIs (URL.createObjectURL,
//      Image, document.createElement('canvas')). With logo_url=null
//      and photos=[] the loader code path never runs, so this is NOT
//      the actual blocker.
//   2. jspdf-autotable v3 exports the autoTable() callable as the
//      default export under Vite's CJS-default interop, but as a
//      DOUBLE-NESTED `module.default.default` under pure Node ESM.
//      Forcing the headless render would require either:
//        a) an interop shim that pre-resolves the autoTable function
//           and patches it back into pdf.js's import (fragile), or
//        b) refactoring pdf.js's autoTable call sites to use the
//           modern plugin API: `applyPlugin(jsPDF); doc.autoTable()`
//           — a production change made solely to support a test.
//      Neither is appropriate for a QA-only smoke test.
//
// What we use instead:
//   - Source-level white-label scan via grep (done in the QA report).
//   - Build verification (npm run build).
//   - Manual browser test via npm run dev (Quote tab → Preview).
//
// Manual test recipe:
//   1. npm run dev
//   2. Sign in (Parker Construction account or any test account).
//   3. Open any job's detail page → Quote tab.
//   4. Add line items across 4 sections:
//        Roof Replacement, Deck to Concrete,
//        Tongue and Groove Ceiling, Mulch Refresh
//      (3-5 items each; rate * qty drives section totals).
//   5. (Optional) Upload photos via Files tab; caption each photo
//      to match a section name to route it to that scope block.
//   6. Set the proposal expires_at ~30 days out.
//   7. Tap "Preview" or "Download" on the Quote action bar.
//   8. Save the PDF as Roy_Residence_FieldHorse_Generated_Proposal.pdf.
//
// To enable headless rendering in the future:
//   - Refactor pdf.js to use jspdf-autotable's plugin API
//     (single one-time change; see notes in the migration plan).
//   - OR add a Node-only shim that re-resolves the autoTable
//     interop. Either approach is straightforward but is
//     deferred to avoid touching production for test-only support.

console.log(
  [
    '',
    'Headless proposal render is not currently runnable in pure Node ESM.',
    'See script header for details. Use the manual browser recipe instead.',
    ''
  ].join('\n')
)
