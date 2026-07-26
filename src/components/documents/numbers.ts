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

// Year anchor: prefer the document's issue date so a proposal sent as
// PCC-2026-4F2A in December doesn't re-render as PCC-2027-4F2A when the
// customer opens it in January (UI audit L4). Falls back to "now" only
// when no issue date exists.
function yearOf(issuedAt?: string | Date | null) {
  if (issuedAt) {
    const d = issuedAt instanceof Date ? issuedAt : new Date(issuedAt)
    if (!Number.isNaN(d.getTime())) return d.getFullYear()
  }
  return new Date().getFullYear()
}

export function proposalNumber(companyName: string | null | undefined, seed: string | null | undefined, issuedAt?: string | Date | null) {
  const pfx = companyPrefix(companyName) || 'PROPOSAL'
  return `${pfx}-${yearOf(issuedAt)}-${seedTail(seed)}`
}

export function invoiceNumber(companyName: string | null | undefined, seed: string | null | undefined, issuedAt?: string | Date | null) {
  const pfx = companyPrefix(companyName)
  const y = yearOf(issuedAt)
  const tail = seedTail(seed)
  return pfx ? `${pfx}-INV-${y}-${tail}` : `INVOICE-${y}-${tail}`
}

/**
 * Sequence-aware invoice number — the form a real business uses.
 *
 * fh_invoices.sequence_number is unique only PER JOB (per contact_id),
 * so a bare "PCC-INV-003" collides across every job — each job restarts
 * at 001. To keep numbers unique across the whole company we prefix a
 * short, stable per-job discriminator drawn from the contact id
 * (the `seed`): "PCC-4F2A-03". Same job + same draw always yields the
 * same number, so the emailed PDF and the web link agree, and two
 * different jobs never share an invoice number.
 *
 * Falls back to the year+seed form when no sequence exists (legacy
 * whole-job invoices).
 */
export function invoiceNumberFromSequence(
  companyName: string | null | undefined,
  sequence: number | null | undefined,
  seed?: string | null
) {
  const seq = Number(sequence)
  if (!Number.isFinite(seq) || seq <= 0) return invoiceNumber(companyName, seed)
  const pfx = companyPrefix(companyName)
  const job = jobDiscriminator(seed)
  const num = String(Math.floor(seq)).padStart(2, '0')
  const body = job ? `${job}-${num}` : String(Math.floor(seq)).padStart(3, '0')
  return pfx ? `${pfx}-${body}` : `INV-${body}`
}

// Short, stable per-job tag from the contact id: 4 uppercased
// alphanumerics off the tail. Deterministic, so the same job always
// renders the same tag on every draw and every delivery surface.
function jobDiscriminator(seed: string | null | undefined) {
  const clean = String(seed || '').replace(/[^a-zA-Z0-9]/g, '').toUpperCase()
  return clean ? clean.slice(-4) : ''
}
