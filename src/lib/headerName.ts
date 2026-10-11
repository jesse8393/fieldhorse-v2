// The short company name the phone header shows beside the monogram.
//
// The workspace name comes first because it is the name the team chose
// for the app, then the profile's company name, then the person's own
// name. A trailing legal word ("Company", "Co.", "LLC") is dropped so
// "Parker Construction Company" reads "Parker Construction" and fits.

const TRAILING_SUFFIX = /[\s,]+(company|co\.?|llc\.?)$/i

function shorten(name: string): string {
  const short = name.replace(TRAILING_SUFFIX, '').trim()
  return short || name
}

export function headerName(
  orgName: string | null | undefined,
  companyName: string | null | undefined,
  fullName: string | null | undefined
): string {
  for (const candidate of [orgName, companyName, fullName]) {
    const name = candidate?.trim()
    if (name) return shorten(name)
  }
  return 'Your company'
}
