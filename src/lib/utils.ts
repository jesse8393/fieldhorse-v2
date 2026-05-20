import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs))
}

// Phone formatter — render-time only. Store raw digits in the DB so
// search + sms/tel: links keep working; format for display only.
//   "5551234567"      -> "(555) 123-4567"
//   "+15551234567"    -> "+1 (555) 123-4567"
//   "555 1234567"     -> "(555) 123-4567"
//   anything else     -> returned unchanged
export function formatPhone(raw: string | null | undefined): string {
  if (!raw) return ''
  const s = String(raw).trim()
  const digits = s.replace(/\D/g, '')
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`
  }
  if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`
  }
  return s
}
