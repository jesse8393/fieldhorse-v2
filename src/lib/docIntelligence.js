// Document intelligence — Phase 19 / Audit Move #1.
//
// Take a photo of a handwritten estimate, scanned contract, business
// card, or paste a screenshot of an inbound email. Claude Vision parses
// it into structured fields the user would otherwise re-type.
//
// Two parsers shipped:
//   parseLeadFromImage(dataUrl)    -> { name, phone, email, address,
//                                       job_title, job_type, amount, notes }
//   parseExpenseFromImage(dataUrl) -> { description, amount, category,
//                                       expense_date }
//
// Both run vision on Claude Sonnet via the existing /api/claude proxy
// so the API key never ships to the browser.

import { JOB_TYPES } from './jobTypes.js'
import { claudeVision, extractJson } from './anthropic.js'

const EXPENSE_CATEGORIES = ['Materials', 'Fuel', 'Permits', 'Equipment', 'Other']

const LEAD_SYSTEM = `You are an OCR + extraction engine for a contractor's CRM. You will be shown a single image — usually a handwritten estimate, a scanned printed contract, a business card, a screenshot of an email or text, or a phone photo of a paper bid. Your job is to extract a single contractor lead.

Return ONLY one JSON object with these keys, using null for anything you can't read or infer with high confidence:

{
  "name": string or null,           // homeowner name OR company / GC name
  "phone": string or null,          // first phone number you can read
  "email": string or null,
  "address": string or null,        // job site address; street + city if visible
  "job_title": string or null,      // a short, useful job description e.g. "Kitchen remodel — full gut"
  "job_type": one of [${JOB_TYPES.map(t => `"${t.value}"`).join(', ')}] or null,
  "amount": number or null,         // total dollars, no formatting (42000 not "$42,000")
  "notes": string or null           // anything else worth capturing — scope notes, timeline, materials, special asks
}

Rules:
- Currency: drop $ + commas, return a plain number. Reject negative numbers.
- If multiple totals appear, pick the grand total. Skip subtotals + tax lines.
- If there's no recognizable structure, return all nulls — don't hallucinate.
- Do not include any prose before or after the JSON.`

const EXPENSE_SYSTEM = `You are an OCR + extraction engine for a contractor's expense tracking. You will be shown a single image — usually a receipt, an invoice, a credit-card slip, or a screenshot of a vendor email. Your job is to extract one expense line.

Return ONLY one JSON object with these keys, using null for anything you can't read with high confidence:

{
  "description": string or null,        // e.g. "Lumber — 2x4 studs", "Dump fee", "Diesel fill-up"
  "amount": number or null,             // total dollars, no formatting
  "category": one of ["Materials", "Fuel", "Permits", "Equipment", "Other"] or null,
  "expense_date": string or null        // ISO date YYYY-MM-DD if visible on receipt
}

Rules:
- Pick the GRAND TOTAL (or "Total Due" / "Amount Charged"). Skip line items, subtotals, tax-only.
- Category is your best guess: lumber/concrete/paint -> Materials; gas/diesel -> Fuel; city/county fees -> Permits; tool rental -> Equipment; everything else -> Other.
- expense_date: if you only see "04/24" assume current year. If the date is unreadable, return null.
- No prose, no fences, JSON only.`

// Compress an image to under maxBytes by re-encoding through a canvas
// at progressively lower JPEG quality. Returns a data URL.
//
// Most phone photos land at 3-8 MB; Claude Vision pricing is per
// (resolution + tokens), so we want to ship the smallest image that
// still has readable text. ~1.2 MB at 90% quality is a safe ceiling.
export async function compressImageToDataUrl(file, maxBytes = 1_200_000, maxDim = 1600) {
  if (!file) throw new Error('compressImageToDataUrl: file required')

  const objUrl = URL.createObjectURL(file)
  const img = new Image()
  await new Promise((resolve, reject) => {
    img.onload = resolve
    img.onerror = () => reject(new Error('Could not decode image'))
    img.src = objUrl
  })

  // Scale down if either dimension exceeds maxDim
  let { width, height } = img
  const scale = Math.min(1, maxDim / Math.max(width, height))
  width = Math.round(width * scale)
  height = Math.round(height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  ctx.drawImage(img, 0, 0, width, height)
  URL.revokeObjectURL(objUrl)

  // Walk down quality until the result fits maxBytes
  for (const quality of [0.92, 0.85, 0.78, 0.7, 0.6, 0.5]) {
    const dataUrl = canvas.toDataURL('image/jpeg', quality)
    // base64 ~= bytes * 4/3, so estimate bytes from string length
    const approxBytes = Math.floor(dataUrl.length * 0.75)
    if (approxBytes <= maxBytes || quality <= 0.5) return dataUrl
  }
  return canvas.toDataURL('image/jpeg', 0.5)
}

// Read a clipboard event for an image and return a File. Returns null
// if the paste didn't contain an image. Used by NewLeadSheet's paste
// handler so the user can screenshot an email and Cmd-V into the form.
export function imageFromClipboardEvent(e) {
  const items = e.clipboardData?.items || []
  for (const item of items) {
    if (item.type?.startsWith('image/')) {
      return item.getAsFile()
    }
  }
  return null
}

export async function parseLeadFromImage(dataUrl) {
  const res = await claudeVision({
    system: LEAD_SYSTEM,
    prompt: 'Extract this lead. Return only the JSON object specified in your system prompt.',
    imageData: dataUrl,
    maxTokens: 800
  })
  const text = res?.content?.[0]?.text || ''
  const parsed = extractJson(text)
  if (!parsed) throw new Error("Couldn't parse vision response")
  return normalizeLead(parsed)
}

export async function parseExpenseFromImage(dataUrl) {
  const res = await claudeVision({
    system: EXPENSE_SYSTEM,
    prompt: 'Extract this expense. Return only the JSON object specified in your system prompt.',
    imageData: dataUrl,
    maxTokens: 400
  })
  const text = res?.content?.[0]?.text || ''
  const parsed = extractJson(text)
  if (!parsed) throw new Error("Couldn't parse vision response")
  return normalizeExpense(parsed)
}

function normalizeLead(p) {
  // Coerce types + strip junk so the parsed object slots cleanly into
  // the form state. Anything questionable becomes null so the field
  // stays empty rather than getting a hallucinated value.
  const out = {
    name: nullableString(p.name),
    phone: nullableString(p.phone),
    email: nullableString(p.email),
    address: nullableString(p.address),
    job_title: nullableString(p.job_title),
    job_type: null,
    amount: typeof p.amount === 'number' && p.amount > 0 ? Math.round(p.amount) : null,
    notes: nullableString(p.notes)
  }
  if (typeof p.job_type === 'string') {
    const valid = JOB_TYPES.find((t) => t.value.toLowerCase() === p.job_type.toLowerCase())
    if (valid) out.job_type = valid.value
  }
  return out
}

function normalizeExpense(p) {
  const cat = typeof p.category === 'string'
    ? EXPENSE_CATEGORIES.find((c) => c.toLowerCase() === p.category.toLowerCase())
    : null
  let date = null
  if (typeof p.expense_date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.expense_date)) {
    date = p.expense_date
  }
  return {
    description: nullableString(p.description),
    amount: typeof p.amount === 'number' && p.amount > 0 ? Math.round(p.amount * 100) / 100 : null,
    category: cat || 'Materials',
    expense_date: date
  }
}

function nullableString(v) {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t.length > 0 ? t : null
}
