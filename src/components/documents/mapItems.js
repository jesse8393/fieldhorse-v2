// src/components/documents/mapItems.js
//
// Shared mapper that turns a flat array of fh_quote_items rows into the
// section-grouped shape both ProposalTemplate (HTML preview) and the
// jsPDF generateQuote function (PDF export) expect.
//
// Item shape (from fh_quote_items, migration 011):
//   { id, contact_id, user_id, section, description, qty, unit, rate,
//     amount, notes, is_optional, is_excluded, sort_order }
//
// Output:
//   { scopeSections, upgrades, exclusions, baseTotal, upgradeTotal }
//
// Grouping rules:
//   - is_excluded:      row goes to `exclusions[]` (string list)
//   - is_optional:      row goes to `upgrades[]` (bucketed by section)
//   - default:          row goes to `scopeSections[]` (bucketed by section)
//
// Section title comes from the `section` column ("Roofing", "Demolition",
// "Concrete", etc.); the contractor's choice from the curated picker
// on the Quote tab. Empty → "General".

export function mapItemsToScope(items = []) {
  const groups = []
  const groupIndex = new Map()
  const upgradeBuckets = []
  const exclusions = []
  let baseTotal = 0
  let upgradeTotal = 0

  for (const it of items) {
    const amt = Number(it.amount != null ? it.amount : (Number(it.qty || 1) * Number(it.rate || 0)))
    if (it.is_excluded) {
      exclusions.push(it.description || 'Excluded scope')
      continue
    }
    const sectionTitle = (it.section || 'General').trim() || 'General'
    if (it.is_optional) {
      upgradeTotal += amt
      let bucket = upgradeBuckets.find((b) => b.title === sectionTitle)
      if (!bucket) {
        bucket = { id: `upgrade:${sectionTitle}`, title: sectionTitle, items: [] }
        upgradeBuckets.push(bucket)
      }
      bucket.items.push(it)
      continue
    }
    baseTotal += amt
    let i = groupIndex.get(sectionTitle)
    if (i == null) {
      i = groups.length
      groupIndex.set(sectionTitle, i)
      groups.push({ id: `sec:${sectionTitle}`, title: sectionTitle, items: [] })
    }
    groups[i].items.push(it)
  }

  return {
    scopeSections: groups,
    upgrades: upgradeBuckets,
    exclusions,
    baseTotal,
    upgradeTotal
  }
}
