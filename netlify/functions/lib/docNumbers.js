// netlify/functions/lib/docNumbers.js
//
// Server copy of proposalNumber() from src/components/documents/numbers.ts,
// so an approval snapshot records the same number the customer saw printed
// on the proposal. src/lib/docNumbersFunction.test.ts keeps the two in step.

const SKIP_WORDS = new Set(['the', 'of', 'and', '&', 'a', 'an'])

function initials(name) {
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

function companyPrefix(companyName, { minChars = 2, maxChars = 3 } = {}) {
  const init = initials(companyName)
  if (init.length < minChars) return ''
  return init.slice(0, maxChars)
}

function seedTail(seed, n = 4) {
  if (!seed) return Math.random().toString(36).slice(2, 2 + n).toUpperCase()
  return String(seed).slice(-n).toUpperCase()
}

function yearOf(issuedAt) {
  if (issuedAt) {
    const d = issuedAt instanceof Date ? issuedAt : new Date(issuedAt)
    if (!Number.isNaN(d.getTime())) return d.getFullYear()
  }
  return new Date().getFullYear()
}

export function proposalNumber(companyName, seed, issuedAt) {
  const pfx = companyPrefix(companyName) || 'PROPOSAL'
  return `${pfx}-${yearOf(issuedAt)}-${seedTail(seed)}`
}
