// src/components/documents/index.js
//
// Public surface of the document engine. Import from here so screens
// don't reach into individual files (lets us reorganize internals
// without touching every consumer).

export { default as DocumentShell } from './DocumentShell.jsx'
export { default as SectionHeading } from './SectionHeading.tsx'
export { default as LineItemsTable } from './LineItemsTable.tsx'
export { default as ScopeSectionCard } from './ScopeSectionCard.jsx'
export { default as PricingSummaryCard } from './PricingSummaryCard.jsx'
export { default as PaymentTermsBlock, DEFAULT_PAYMENT_SCHEDULE } from './PaymentTermsBlock.tsx'
export { default as ApprovalBlock } from './ApprovalBlock.jsx'
export { default as InvoiceBalanceBlock } from './InvoiceBalanceBlock.jsx'
export { default as PaymentHistoryBlock } from './PaymentHistoryBlock.tsx'
export { default as InsuranceModeBlock } from './InsuranceModeBlock.tsx'
export { default as BillToBlock } from './BillToBlock.tsx'
export { default as ChangeOrdersBlock } from './ChangeOrdersBlock.tsx'

export { default as ProposalTemplate } from './ProposalTemplate.jsx'
export { default as InvoiceTemplate } from './InvoiceTemplate.jsx'

export * from './tokens.ts'
export * from './numbers.ts'
export * from './format.ts'
export * from './mapItems.ts'
