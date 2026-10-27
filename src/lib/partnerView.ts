import type { PartnerEntry } from './partners.ts'

export function partnerHasStatus(partner: PartnerEntry, status: string): boolean {
  return partner.jobs.length > 0
    ? partner.jobs.some((job) => job.status === status)
    : partner.status === status
}

/** Filter badges count people; invitation/access metrics count job shares. */
export function summarizePartnerShares(partners: PartnerEntry[]) {
  const shares = partners.flatMap((partner) => partner.jobs)
  return {
    all: partners.length,
    pending: partners.filter((partner) => partnerHasStatus(partner, 'pending')).length,
    accepted: partners.filter((partner) => partnerHasStatus(partner, 'accepted')).length,
    revoked: partners.filter((partner) => partnerHasStatus(partner, 'revoked')).length,
    pendingShares: shares.filter((share) => share.status === 'pending').length,
    acceptedShares: shares.filter((share) => share.status === 'accepted').length,
    revokedShares: shares.filter((share) => share.status === 'revoked').length,
    totalShares: shares.length
  }
}

export type PartnerCounts = ReturnType<typeof summarizePartnerShares>

/** Job role names are descriptive labels, not separate permission tiers. */
export function partnerAccessSummary(status: string, role?: string | null) {
  const active = status === 'accepted'
  return {
    title: active ? 'View shared permissions' : 'View invitation permissions',
    status: active ? 'Access active for this job.'
      : status === 'revoked' ? 'Access revoked. This invitation no longer grants job access.'
      : status === 'left' ? 'Partner left this job. This invitation no longer grants job access.'
      : status === 'declined' ? 'Invitation declined. This invitation grants no job access.'
      : 'No access until the invitation is accepted.',
    role: `${role ? `${role} is a job role label` : 'Job role labels describe the work'}. Foreman, Sub, Estimator and Other use the same sharing permissions. Existing company restrictions still apply.`,
    included: 'This job and its linked customer details, schedule, notes, tasks, files and photos. Partners can collaborate on job records and may access job pricing, invoices, payments and approved change orders.',
    excluded: 'Other jobs and customers, company settings, team administration, reusable pricing templates and private insurance claims.',
  }
}
