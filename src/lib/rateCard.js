// Seed rate card for AI Bid Engine. Per-tenant overrides live in Supabase.
// Values are {low, high} in the unit listed.

export const RATE_CARD = {
  concrete:      { unit: 'sqft', low: 8,    high: 12 },
  framing:       { unit: 'lf',   low: 4,    high: 7 },
  drywall:       { unit: 'sqft', low: 2.5,  high: 4 },
  demo:          { unit: 'sqft', low: 3,    high: 6 },
  roofing:       { unit: 'sqft', low: 5,    high: 9 },
  electrical:    { unit: 'point',low: 150,  high: 250 },
  plumbingRough: { unit: 'lump', low: 800,  high: 1500 },
  insulation:    { unit: 'sqft', low: 1.5,  high: 3 },
  lvpFlooring:   { unit: 'sqft', low: 4,    high: 7 },
  paint:         { unit: 'sqft', low: 1.5,  high: 3 },
  permits:       { unit: 'lump', low: 200,  high: 800 },
  outdoorLiving: { unit: 'sqft', low: 25,   high: 65 }
}

export const TAGLINE = 'Built for the jobsite.'
