// src/components/documents/numbers.ts
//
// Proposal / invoice number generators. Shared between the HTML
// preview and the jsPDF export so the customer-facing document number
// is identical no matter how it's surfaced.
//
// Format
//   PROPOSAL: {PREFIX}-{YYYY}-{SEQ}        e.g. PCC-2026-A1B2
//   INVOICE:  {PREFIX}-INV-{YYYY}-{SEQ}    e.g. PCC-INV-2026-A1B2
//
// PREFIX derives from the contractor's company name initials, skipping
// stopwords ("the", "of", "and", "&", "a", "an"). 2-3 chars wins.
// When the name is missing or unparseable, the prefix falls back to
// the document-type word ("PROPOSAL" / "INVOICE") so the customer
// never sees the FieldHorse name on their document.
//
// SEQ is the last 4 chars of the source row id (uppercased) so a
// re-generated PDF for the same record gives a stable, repeatable
// number — important when the contractor sends a revision and the
// customer is comparing.

const SKIP_WORDS = new Set(['the', 'of', 'and', '&', 'a', 'an'])

function initials(name: string | null | undefined) {
  if (!name || !String(name).trim()) return ''
  return String(name)
    .trim()
    .split(/\s+/)
    .filter((w) => w && !SKIP_WORDS.has(w.toLowerCase()))
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
}

/**
 * Derive a 2-3 letter prefix from the contractor's company name.
 * Returns '' when the name is missing or has fewer than `minChars`
 * usable initials so the caller can fall back to a doctype word.
 */
export function companyPrefix(companyName: string | null | undefined, { minChars = 2, maxChars = 3 }: { minChars?: number; maxChars?: number } = {}) {
  const init = initials(companyName)
  if (init.length < minChars) return ''
  return init.slice(0, maxChars)
}

function seedTail(seed: string | null | undefined, n = 4) {
  if (!seed) return Math.random().toString(36).slice(2, 2 + n).toUpperCase()
  return String(seed).slice(-n).toUpperCase()
}

export function proposalNumber(companyName: string | null | undefined, seed: string | null | undefined) {
  const pfx = companyPrefix(companyName) || 'PROPOSAL'
  return `${pfx}-${new Date().getFullYear()}-${seedTail(seed)}`
}

export function invoiceNumber(companyName: string | null | undefined, seed: string | null | undefined) {
  const pfx = companyPrefix(companyName)
  const y = new Date().getFullYear()
  const tail = seedTail(seed)
  return pfx ? `${pfx}-INV-${y}-${tail}` : `INVOICE-${y}-${tail}`
}
