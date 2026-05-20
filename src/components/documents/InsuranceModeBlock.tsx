// src/components/documents/InsuranceModeBlock.tsx
//
// Optional block for insurance-restoration jobs (roofing, water, fire,
// storm). Renders ONLY when the parent passes an `insurance` payload
// with at least a claim number or carrier — otherwise returns null so
// the template stays clean for cash jobs.
//
// Fields (all optional):
//   claim_number, carrier, adjuster, deductible, rcv, acv,
//   depreciation, supplement_amount, mortgage_company
//
// Schema note (NOT YET MIGRATED):
//   The current Supabase schema has no insurance_* columns on
//   fh_contacts and no dedicated fh_insurance_claims table. The
//   recommendation is to add a new table for this so the contact row
//   stays narrow + cash jobs aren't polluted with NULL insurance cols.
//   Proposed migration lives in:
//     supabase/migrations/018_insurance_claims.sql  (draft, not applied)
//   Until that migration lands, parents can pass an `insurance` object
//   from any source (form state, ad-hoc jsonb column, etc.).

import { DOC_COLORS, typeStyle, resolveBrandGold } from './tokens.ts'
import { money } from './format.ts'

export default function InsuranceModeBlock({ insurance = null, company }: { insurance?: any; company?: any }) {
  if (!insurance) return null
  const hasAny = ['claim_number', 'carrier', 'adjuster', 'deductible', 'rcv', 'acv', 'depreciation', 'supplement_amount', 'mortgage_company']
    .some((k) => insurance[k] != null && insurance[k] !== '')
  if (!hasAny) return null

  const gold = resolveBrandGold(company)

  const fields = [
    { label: 'Claim number',     value: insurance.claim_number },
    { label: 'Carrier',          value: insurance.carrier },
    { label: 'Adjuster',         value: insurance.adjuster },
    { label: 'Deductible',       value: insurance.deductible != null ? money(insurance.deductible) : '' },
    { label: 'RCV',              value: insurance.rcv != null ? money(insurance.rcv) : '' },
    { label: 'ACV',              value: insurance.acv != null ? money(insurance.acv) : '' },
    { label: 'Depreciation',     value: insurance.depreciation != null ? money(insurance.depreciation) : '' },
    { label: 'Supplement',       value: insurance.supplement_amount != null ? money(insurance.supplement_amount) : '' },
    { label: 'Mortgage company', value: insurance.mortgage_company }
  ].filter((f) => f.value)

  return (
    <section
      style={{
        padding: '20px 22px',
        border: `1px solid ${gold}`,
        borderRadius: 6,
        background: DOC_COLORS.paperSoft,
        breakInside: 'avoid'
      }}
    >
      <div
        style={{
          ...typeStyle('eyebrow'),
          color: gold,
          marginBottom: 14
        }}
      >
        Insurance claim
      </div>
      <dl
        style={{
          margin: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: '14px 24px'
        }}
      >
        {fields.map((f) => (
          <div key={f.label}>
            <dt style={{ ...typeStyle('label'), color: DOC_COLORS.inkMuted, marginBottom: 4 }}>
              {f.label}
            </dt>
            <dd style={{ ...typeStyle('stamp'), color: DOC_COLORS.ink, margin: 0 }}>
              {f.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
