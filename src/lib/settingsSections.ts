import { mergeQuoteFollowUpPreferences } from './quoteFollowUp.ts'
import { safePayUrl } from './payLink.ts'

export const SETTINGS_SECTIONS = [
  { id: 'business', label: 'Business', description: 'Company name, logo, services and location.' },
  { id: 'documents', label: 'Documents', description: 'Customer details, branding and proposal design.' },
  { id: 'payments', label: 'Payments', description: 'Payment link and instructions for customers.' },
  { id: 'rates', label: 'Rates', description: 'Trade pricing. Each rate saves independently.' },
  { id: 'preferences', label: 'Preferences', description: 'Quote reminders, appearance and notifications.' },
  { id: 'account', label: 'Account', description: 'Workspace, sign out and account controls.' },
] as const
export type SettingsSection = typeof SETTINGS_SECTIONS[number]['id']

export const SETTINGS_SECTION_FIELDS = {
  business: ['displayName', 'companyName', 'services'],
  documents: ['companyPhone', 'companyEmail', 'companyWebsite', 'companyAddress', 'licenseNumber', 'insuredText', 'warrantyDefault', 'brandAccentHex', 'estimateTemplate'],
  payments: ['paymentLink', 'paymentInstructions'],
  rates: [],
  preferences: ['quoteFollowUpEnabled', 'quoteFollowUpDays'],
  account: [],
} as const

const SECTION_ALIASES: Record<string, SettingsSection> = {
  services: 'business', location: 'business', 'work-location': 'business',
  templates: 'documents', 'quote-reminders': 'preferences', appearance: 'preferences',
  notifications: 'preferences', 'sample-data': 'account',
}

export function settingsSectionFor(value: string): SettingsSection {
  return SETTINGS_SECTIONS.find((section) => section.id === value)?.id ?? SECTION_ALIASES[value] ?? 'business'
}

/** The legacy hash wins so old template and location links still open their section. */
export function activeSettingsSection(search: string, hash: string): SettingsSection {
  return settingsSectionFor(hash.slice(1) || new URLSearchParams(search).get('section') || 'business')
}

export function settingsSectionDirty(section: SettingsSection, form: Record<string, unknown>, stored: Record<string, unknown>) {
  return SETTINGS_SECTION_FIELDS[section].some((key) => {
    const value = form[key]
    const original = stored[key]
    if (Array.isArray(value) && Array.isArray(original)) return [...value].sort().join('|') !== [...original].sort().join('|')
    if (key === 'brandAccentHex') return String(value ?? '').toLowerCase() !== String(original ?? '').toLowerCase()
    return value !== original
  })
}

const nullIfBlank = (value: unknown) => String(value ?? '').trim() || null

/** Only fields belonging to the chosen section may reach the profile write. */
export function settingsSectionPatch(section: SettingsSection, form: Record<string, unknown>, preferences: unknown): Record<string, unknown> {
  switch (section) {
    case 'business':
      return { full_name: nullIfBlank(form.displayName), company_name: String(form.companyName ?? '').trim(), services: form.services }
    case 'documents': {
      const accent = nullIfBlank(form.brandAccentHex)
      if (accent && !/^#[0-9a-fA-F]{6}$/.test(accent)) throw new Error('Enter a six digit brand color, such as #C9963A.')
      return {
        company_phone: nullIfBlank(form.companyPhone), company_email: nullIfBlank(form.companyEmail),
        company_website: nullIfBlank(form.companyWebsite), company_address: nullIfBlank(form.companyAddress),
        license_number: nullIfBlank(form.licenseNumber), insured_text: nullIfBlank(form.insuredText),
        warranty_default: nullIfBlank(form.warrantyDefault), brand_accent_hex: accent?.toLowerCase() ?? null,
        estimate_template: form.estimateTemplate || 'classic',
      }
    }
    case 'payments': {
      const rawLink = nullIfBlank(form.paymentLink)
      const link = safePayUrl(rawLink)
      if (rawLink && !link) throw new Error('Use a payment web address, such as venmo.com/u/yourname.')
      return { payment_link: nullIfBlank(link), payment_instructions: nullIfBlank(form.paymentInstructions) }
    }
    case 'preferences':
      return { preferences: mergeQuoteFollowUpPreferences(preferences, { enabled: Boolean(form.quoteFollowUpEnabled), days: Number(form.quoteFollowUpDays) }) }
    default: return {}
  }
}
