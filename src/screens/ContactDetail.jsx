// Re-export stub. The implementation moved to ContactDetail/index.jsx as part
// of the v3 modular architecture (Drop 3 — feat/v3-foundation branch).
//
// The legacy 2,556-line monolith is preserved at ContactDetail.legacy.jsx
// during the transition so subsequent drops (3.1 Details, 3.2 Financials,
// 3.3 Files) can copy section logic out of it. Once all 10 sections are
// rebuilt in v3, ContactDetail.legacy.jsx will be deleted.
export { default } from './ContactDetail/index.tsx'
