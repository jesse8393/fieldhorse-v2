// The short company name the phone header and the desktop sidebar show
// beside the monogram, the full name for its title, and whether the
// profile's company (its city and logo) is the workspace named.
//
// The workspace name comes first because it is the name the team chose
// for the app, then the profile's company name, then the person's own
// name. A trailing legal word ("Company", "Co.", "LLC") is dropped so
// "Harlow Construction Company" reads "Harlow Construction" and "Acme LLC"
// reads "Acme", but only when what is left is a name on its own: "My
// Company" (the name the server gives a workspace made without one),
// "Smith & Co.", "Jones and Company" and "The Fence Company" stay whole.

const TRAILING_SUFFIX = /[\s,]+(company|co\.?|llc\.?)$/i
// The legal word finishes the name: it follows a joining word, or an
// article or a word like "My" opens the phrase it ends. companyShortName
// (quoteMoney.ts) reads the same two lists to tell when a company's first
// word cannot stand for the whole name.
export const JOINS_WHAT_FOLLOWS = /(^|\s)(&|\+|and)$/i
export const OPENS_A_PHRASE = /^(the|a|an|my|our|your)(\s|$)/i

// The name without its legal word, to tell whether two spellings name
// the same company ("Smith & Co." and "Smith & Company").
function withoutSuffix(name: string): string {
  return name.replace(TRAILING_SUFFIX, '').trim() || name
}

function shorten(name: string): string {
  const short = withoutSuffix(name)
  if (short === name) return name
  const standsAlone = !JOINS_WHAT_FOLLOWS.test(short) && !OPENS_A_PHRASE.test(short)
  return standsAlone ? short : name
}

function firstName(candidates: Array<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const name = candidate?.trim()
    if (name) return name
  }
  return null
}

export function headerName(
  orgName: string | null | undefined,
  companyName: string | null | undefined,
  fullName: string | null | undefined
): string {
  const name = firstName([orgName, companyName, fullName])
  return name ? shorten(name) : 'Your company'
}

/**
 * The full name behind headerName, for a title on the short one: the
 * profile's company name when it shortens to the name shown ("Harlow
 * Construction Company" behind "Harlow Construction"), else the name the
 * short one came from, with its legal word kept.
 */
export function headerFullName(
  orgName: string | null | undefined,
  companyName: string | null | undefined,
  fullName: string | null | undefined
): string {
  const short = headerName(orgName, companyName, fullName)
  const company = companyName?.trim()
  if (company && shorten(company).toLowerCase() === short.toLowerCase()) return company
  return firstName([orgName, companyName, fullName]) ?? short
}

/**
 * Whether the profile's company is the workspace headerName names, so its
 * city and logo may stand beside that name. The profile belongs to the
 * person, not the workspace: it holds the company they run. That company
 * is the workspace shown while there is no workspace name (the name shown
 * is then the profile's own), when the two names agree once their legal
 * words are set aside ("Smith & Co." and "Smith & Company"), or when this
 * is the one workspace the person owns, whatever it is called. Someone
 * who runs Shyld Roofing and works crew at Harlow Construction sees Harlow
 * with its initials there, never Shyld's city or logo.
 */
export function profileCompanyIsWorkspace({ orgName, companyName, ownsWorkspace, workspacesOwned }: {
  orgName: string | null | undefined
  companyName: string | null | undefined
  /** The person owns the workspace shown. */
  ownsWorkspace: boolean
  /** How many workspaces the person owns, the one shown included. */
  workspacesOwned: number
}): boolean {
  const org = orgName?.trim()
  if (!org) return true
  const company = companyName?.trim()
  if (company && withoutSuffix(company).toLowerCase() === withoutSuffix(org).toLowerCase()) return true
  return ownsWorkspace && workspacesOwned <= 1
}
