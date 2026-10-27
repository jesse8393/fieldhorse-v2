import { describe, expect, it } from 'vitest'
import { activeSettingsSection, settingsSectionDirty, settingsSectionPatch } from './settingsSections.ts'

const form = {
  displayName: ' Jesse ', companyName: ' Parker ', services: ['Concrete'],
  companyPhone: ' 555 ', companyEmail: 'office@example.com', companyWebsite: '',
  companyAddress: '', licenseNumber: '', insuredText: '', warrantyDefault: '',
  brandAccentHex: '#C9963A', estimateTemplate: 'mint', paymentLink: 'venmo.com/u/parker',
  paymentInstructions: ' Pay by check ', quoteFollowUpEnabled: true, quoteFollowUpDays: 7,
}

describe('independent settings sections', () => {
  it('saves only business fields and does not validate another section draft', () => {
    expect(settingsSectionPatch('business', { ...form, brandAccentHex: 'unfinished', paymentLink: 'javascript:no' }, {})).toEqual({ full_name: 'Jesse', company_name: 'Parker', services: ['Concrete'] })
  })
  it('validates only the saved document or payment section', () => {
    expect(() => settingsSectionPatch('documents', { ...form, brandAccentHex: 'bad' }, {})).toThrow('brand color')
    expect(() => settingsSectionPatch('payments', { ...form, paymentLink: 'javascript:bad' }, {})).toThrow('web address')
    expect(settingsSectionPatch('payments', form, {})).toEqual({ payment_link: 'https://venmo.com/u/parker', payment_instructions: 'Pay by check' })
  })
  it('preserves unrelated preferences when saving quote reminders', () => {
    const patch = settingsSectionPatch('preferences', form, { theme: 'dark', example: true })
    expect(patch).toEqual({ preferences: { theme: 'dark', example: true, quote_follow_up: { enabled: true, days: 7 } } })
  })
  it('tracks drafts by section independently', () => {
    const edited = { ...form, companyName: 'New name', paymentInstructions: 'New payment' }
    expect(settingsSectionDirty('business', edited, form)).toBe(true)
    expect(settingsSectionDirty('payments', edited, form)).toBe(true)
    expect(settingsSectionDirty('documents', edited, form)).toBe(false)
    expect(settingsSectionDirty('rates', edited, form)).toBe(false)
  })
  it('ignores service order and brand hex letter case', () => {
    expect(settingsSectionDirty('business', { ...form, services: ['Paint', 'Concrete'] }, { ...form, services: ['Concrete', 'Paint'] })).toBe(false)
    expect(settingsSectionDirty('documents', { ...form, brandAccentHex: '#c9963a' }, form)).toBe(false)
  })
  it('supports separate URL views and existing deep links', () => {
    expect(activeSettingsSection('?section=payments', '')).toBe('payments')
    expect(activeSettingsSection('?section=payments', '#templates')).toBe('documents')
    expect(activeSettingsSection('', '#location')).toBe('business')
    expect(activeSettingsSection('', '#rates')).toBe('rates')
    expect(activeSettingsSection('?section=invalid', '')).toBe('business')
  })
})
