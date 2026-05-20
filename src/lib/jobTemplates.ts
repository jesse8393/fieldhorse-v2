// Job templates — Phase 19 / Audit Move #5.
//
// A template is a named milestone playbook for a common trade pattern.
// Pick one in NewLeadSheet and the app pre-creates the to-do list for
// the new job so the contractor isn't staring at an empty checklist.
//
// Scope for v1:
//   - Milestones only (insert into fh_job_todos)
//   - One template per common trade pattern; user can also skip
//   - No pre-seeded planned expenses, no auto-invited subs (deferred)
//   - applyTemplate() is fire-and-forget AFTER the lead commits — if it
//     fails the lead still exists, just empty checklist
//
// Add new templates here. The picker auto-filters by jobType, so any
// template whose jobType matches the lead's chosen job_type appears.
// Set jobType to '*' to always show.

export type JobTemplate = {
  slug: string
  label: string
  jobType: string
  description: string
  todos: string[]
}

export const JOB_TEMPLATES: JobTemplate[] = [
  {
    slug: 'roofing-tearoff',
    label: 'Roof tear-off + reshingle',
    jobType: 'Roofing',
    description: 'Standard 2–3 day reroof. Tear-off, dry-in, install, inspect.',
    todos: [
      'Confirm shingle color + brand with homeowner',
      'Measure + order shingles, drip edge, ridge vent',
      'Schedule dump trailer + delivery for tear-off day',
      'Pull permit if required by city',
      'Tear-off crew on-site, tarp landscaping',
      'Inspect decking — replace rotten sheathing',
      'Install ice + water shield + synthetic underlayment',
      'Install drip edge + step flashing at walls',
      'Lay shingles, eaves up, staggered pattern',
      'Ridge cap + ridge vent install',
      'Final cleanup — magnet sweep driveway + yard',
      'Photo set for warranty file + homeowner walk',
      'Collect final payment'
    ]
  },
  {
    slug: 'kitchen-full-gut',
    label: 'Kitchen — full gut + remodel',
    jobType: 'Kitchen',
    description: 'Demo to finish. Cabinets, counters, appliances, electrical, plumbing.',
    todos: [
      'Final design + selections signed off (cabinets, counters, tile)',
      'Order cabinets — confirm lead time',
      'Order countertops once cabinets template-able',
      'Pull permit (electrical + plumbing)',
      'Demo cabinets, counters, flooring',
      'Rough plumbing relocations',
      'Rough electrical — outlets, undercabinet, island',
      'Drywall patch + skim coat',
      'Paint walls + ceiling before cabinets',
      'Cabinet install — uppers first, then base',
      'Counter template + fabrication',
      'Counter install',
      'Backsplash tile + grout',
      'Flooring install',
      'Plumbing trim — sink, faucet, disposal, dishwasher',
      'Electrical trim — outlets, lights, switches',
      'Appliance install + level',
      'Final punch + touch-up paint',
      'Homeowner walk + collect final payment'
    ]
  },
  {
    slug: 'bath-remodel',
    label: 'Bathroom remodel',
    jobType: 'Bath',
    description: 'Standard hall bath gut + tile shower. ~3 weeks once material on-site.',
    todos: [
      'Final selections signed off (tile, vanity, fixtures)',
      'Order tile + vanity + fixtures',
      'Pull permit',
      'Demo tub/shower, vanity, flooring, drywall',
      'Rough plumbing — relocate drain if needed',
      'Rough electrical — fan, lights, outlets',
      'Install tub or shower pan + waterproofing',
      'Cement board + waterproof membrane on shower walls',
      'Tile shower walls + floor',
      'Grout + seal',
      'Drywall + paint',
      'Flooring install',
      'Vanity + countertop install',
      'Plumbing trim — toilet, faucet, shower valve',
      'Electrical trim — fan, lights, switches',
      'Door + trim install',
      'Final caulk + punch',
      'Homeowner walk + collect final payment'
    ]
  },
  {
    slug: 'concrete-slab',
    label: 'Concrete slab pour',
    jobType: 'Concrete',
    description: 'Driveway, garage, or patio slab. Form, pour, finish, cure.',
    todos: [
      'Locate utilities (call 811)',
      'Excavate + grade base',
      'Form perimeter + interior chairs',
      'Lay vapor barrier + rebar grid',
      'Inspect forms + setback',
      'Schedule concrete delivery + pumping if needed',
      'Pour + screed',
      'Bull float + edge',
      'Trowel finish (machine if slab >10 yd)',
      'Cut control joints within 12 hrs',
      'Cover + cure 7 days',
      'Strip forms',
      'Backfill + clean site',
      'Final walk + collect final payment'
    ]
  },
  {
    slug: 'deck-outdoor',
    label: 'Deck or outdoor living',
    jobType: 'Outdoor Living',
    description: 'Composite or PT deck on footings. Permit, frame, deck, rail.',
    todos: [
      'Final design signed off (size, material, rail style)',
      'Pull permit',
      'Locate utilities (call 811)',
      'Dig footings to frost line',
      'Footing inspection',
      'Pour footings + set posts',
      'Frame ledger + beams + joists',
      'Frame inspection',
      'Install deck boards',
      'Install railing + balusters',
      'Stairs + skirting',
      'Final inspection',
      'Stain or seal if PT',
      'Homeowner walk + collect final payment'
    ]
  },
  {
    slug: 'insurance-restoration',
    label: 'Insurance — storm/water restoration',
    jobType: 'Insurance',
    description: 'Adjuster-driven scope. Photo + document everything for the file.',
    todos: [
      'Initial inspection + photo every elevation',
      'Submit photo + scope to adjuster',
      'Receive approved scope + Xactimate sheet',
      'Sign contract + collect ACV check',
      'Order materials per approved scope',
      'Begin work — photo before/during/after every line',
      'Submit invoice + photos for depreciation release',
      'Final inspection + collect depreciation check'
    ]
  },
  {
    slug: 'addition',
    label: 'Addition (room or second-story)',
    jobType: 'Addition',
    description: 'Permit-heavy. Foundation through punch. Stage payment milestones.',
    todos: [
      'Final plans signed off + engineered',
      'Submit permit set to city',
      'Receive permit',
      'Locate utilities + stake corners',
      'Dig + pour foundation footings',
      'Foundation walls + waterproofing',
      'Frame floor system',
      'Frame walls + roof',
      'Roof dry-in (felt + shingles)',
      'Windows + exterior doors',
      'Rough plumbing',
      'Rough electrical',
      'Rough HVAC',
      'Rough inspections',
      'Insulation + drywall',
      'Interior trim + paint',
      'Flooring + tile',
      'Trim plumbing + electrical + HVAC',
      'Final inspection',
      'Punch list + homeowner walk'
    ]
  },
  {
    slug: 'renovation-light',
    label: 'Light renovation (paint + flooring + trim)',
    jobType: 'Renovation',
    description: 'No permit. Cosmetic refresh — paint, flooring, trim.',
    todos: [
      'Color + flooring selections signed off',
      'Order flooring + paint',
      'Mask + protect existing finishes',
      'Patch + sand walls',
      'Prime + paint ceilings',
      'Paint walls',
      'Remove old flooring',
      'Install new flooring',
      'Reinstall + paint trim',
      'Final touch-up + clean',
      'Homeowner walk + collect final payment'
    ]
  }
]

export function getTemplatesForJobType(jobType: string | null | undefined): JobTemplate[] {
  if (!jobType) return []
  return JOB_TEMPLATES.filter((t) => t.jobType === jobType || t.jobType === '*')
}

export function getTemplate(slug: string | null | undefined): JobTemplate | null {
  if (!slug) return null
  return JOB_TEMPLATES.find((t) => t.slug === slug) || null
}

// Apply a template to a freshly-created job. Inserts every milestone as
// a row in fh_job_todos with done=false. Failure is non-fatal — the lead
// still exists, the user just gets an empty checklist.
export async function applyTemplate(supabase: any, { template, jobId, userId }: { template: JobTemplate | null | undefined; jobId: string | undefined; userId: string | undefined }) {
  if (!template?.todos?.length || !jobId || !userId) return { inserted: 0 }
  const rows = template.todos.map((text) => ({
    user_id: userId,
    job_id: jobId,
    text,
    done: false
  }))
  const { error } = await supabase.from('fh_job_todos').insert(rows)
  if (error) {
    // Migration 006 missing? Surface zero so caller can decide.
    return { inserted: 0, error }
  }
  return { inserted: rows.length }
}
