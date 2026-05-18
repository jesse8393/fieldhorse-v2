// src/components/documents/index.js
//
// Public surface of the document engine. Import from here so screens
// don't reach into individual files (lets us reorganize internals
// without touching every consumer).

export { default as DocumentShell } from './DocumentShell.jsx'
export { default as SectionHeading } from './SectionHeading.jsx'
export { default as ScopeSectionCard } from './ScopeSectionCard.jsx'
export { default as PricingSummaryCard } from './PricingSummaryCard.jsx'
export { default as PaymentTermsBlock, DEFAULT_PAYMENT_SCHEDULE } from './PaymentTermsBlock.jsx'
export { default as ApprovalBlock } from './ApprovalBlock.jsx'
export { default as InvoiceBalanceBlock } from './InvoiceBalanceBlock.jsx'
export { default as PaymentHistoryBlock } from './PaymentHistoryBlock.jsx'
export { default as InsuranceModeBlock } from './InsuranceModeBlock.jsx'
export { default as BillToBlock } from './BillToBlock.jsx'

export { default as ProposalTemplate } from './ProposalTemplate.jsx'
export { default as InvoiceTemplate } from './InvoiceTemplate.jsx'

export * from './tokens.js'
export * from './numbers.js'
export * from './format.js'
