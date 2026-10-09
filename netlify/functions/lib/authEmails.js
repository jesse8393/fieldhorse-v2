// netlify/functions/lib/authEmails.js
//
// Resolve auth emails for a known, small set of user ids (an org's roster
// or the people on a timesheet). The previous code called
// auth.admin.listUsers({ perPage: 1000 }) on every request: it downloaded
// every account on the platform to decorate a handful of rows, and once
// the platform passed 1000 users the emails of anyone beyond the first
// page silently came back null.
//
// One getUserById per id, a few at a time. Failures are non fatal: the
// caller renders the row without an email.

export async function emailsForUsers(admin, userIds, { concurrency = 8 } = {}) {
  const ids = Array.from(new Set((userIds || []).filter(Boolean)))
  const out = {}
  for (let i = 0; i < ids.length; i += concurrency) {
    const batch = ids.slice(i, i + concurrency)
    const results = await Promise.allSettled(batch.map((id) => admin.auth.admin.getUserById(id)))
    results.forEach((res, idx) => {
      if (res.status === 'fulfilled' && res.value?.data?.user?.email) {
        out[batch[idx]] = res.value.data.user.email
      }
    })
  }
  return out
}
