// mobile/lib/docIntelligence.ts — parse a lead from a photo via Claude vision.
// Mirrors the web src/lib/docIntelligence.ts LEAD flow. Takes a base64 data
// URL (from expo-image-picker), asks Claude to OCR + extract a single lead,
// and normalizes the result so it slots cleanly into the NewLeadSheet form.
import { claudeVision } from './anthropic'
import { JOB_TYPES } from './jobTypes'

const LEAD_SYSTEM = `You are an OCR + extraction engine for a contractor's CRM. You will be shown a single image — usually a handwritten estimate, a scanned printed contract, a business card, a screenshot of an email or text, or a phone photo of a paper bid. Your job is to extract a single contractor lead.

Return ONLY one JSON object with these keys, using null for anything you can't read or infer with high confidence:

{
  "name": string or null,
  "phone": string or null,
  "email": string or null,
  "address": string or null,
  "job_title": string or null,
  "job_type": one of [${JOB_TYPES.map((t) => `"${t.value}"`).join(', ')}] or null,
  "amount": number or null,
  "notes": string or null
}

Rules:
- Currency: drop $ + commas, return a plain number. Reject negative numbers.
- If multiple totals appear, pick the grand total. Skip subtotals + tax lines.
- If there's no recognizable structure, return all nulls — don't hallucinate.
- Do not include any prose before or after the JSON.`

function nullableString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t.slice(0, 400) : null
}

function extractJson(text: string): any | null {
  if (!text) return null
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

export type ParsedLead = {
  name: string | null; phone: string | null; email: string | null
  address: string | null; job_title: string | null; job_type: string | null
  amount: number | null; notes: string | null
}

function normalizeLead(p: any): ParsedLead {
  const out: ParsedLead = {
    name: nullableString(p?.name),
    phone: nullableString(p?.phone),
    email: nullableString(p?.email),
    address: nullableString(p?.address),
    job_title: nullableString(p?.job_title),
    job_type: null,
    amount: typeof p?.amount === 'number' && p.amount > 0 ? Math.round(p.amount) : null,
    notes: nullableString(p?.notes)
  }
  if (typeof p?.job_type === 'string') {
    const valid = JOB_TYPES.find((t) => t.value.toLowerCase() === p.job_type.toLowerCase())
    if (valid) out.job_type = valid.value
  }
  return out
}

const EXPENSE_SYSTEM = `You are an OCR + extraction engine for a contractor's expense tracking. You will be shown a single image — usually a receipt, an invoice, a credit-card slip, or a screenshot of a vendor email. Extract one expense line.

Return ONLY one JSON object, using null for anything you can't read with high confidence:

{
  "description": string or null,
  "amount": number or null,
  "category": one of ["Materials", "Fuel", "Permits", "Equipment", "Other"] or null,
  "expense_date": string or null
}

Rules:
- Pick the GRAND TOTAL (or "Total Due" / "Amount Charged"). Skip line items, subtotals, tax-only.
- Category: lumber/concrete/paint -> Materials; gas/diesel -> Fuel; city/county fees -> Permits; tool rental -> Equipment; else Other.
- expense_date: ISO YYYY-MM-DD if visible (assume current year if only month/day); null if unreadable.
- No prose, JSON only.`

export type ParsedExpense = {
  description: string | null; amount: number | null
  category: string | null; expense_date: string | null
}

export async function parseExpenseFromImage(dataUrl: string): Promise<ParsedExpense> {
  const res = await claudeVision({
    system: EXPENSE_SYSTEM,
    prompt: 'Extract this expense. Return only the JSON object specified in your system prompt.',
    imageData: dataUrl,
    maxTokens: 500
  })
  const text = res?.content?.[0]?.text || ''
  const parsed = extractJson(text)
  if (!parsed) throw new Error("Couldn't read that receipt. Try a clearer photo.")
  const CATS = ['Materials', 'Fuel', 'Permits', 'Equipment', 'Other']
  return {
    description: nullableString(parsed.description),
    amount: typeof parsed.amount === 'number' && parsed.amount > 0 ? Math.round(parsed.amount * 100) / 100 : null,
    category: typeof parsed.category === 'string' && CATS.includes(parsed.category) ? parsed.category : null,
    expense_date: nullableString(parsed.expense_date)
  }
}

export async function parseLeadFromImage(dataUrl: string): Promise<ParsedLead> {
  const res = await claudeVision({
    system: LEAD_SYSTEM,
    prompt: 'Extract this lead. Return only the JSON object specified in your system prompt.',
    imageData: dataUrl,
    maxTokens: 800
  })
  const text = res?.content?.[0]?.text || ''
  const parsed = extractJson(text)
  if (!parsed) throw new Error("Couldn't read that image. Try a clearer photo.")
  return normalizeLead(parsed)
}
