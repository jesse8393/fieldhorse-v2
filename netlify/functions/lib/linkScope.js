// netlify/functions/lib/linkScope.js
//
// Which rows a customer link may reach.
//
// The public functions used to load a link's job, client, change orders
// and statement jobs with .eq('user_id', link.user_id), so a link only
// worked when the teammate who created it had also created the job. An
// admin sending the owner's proposal gave the customer "not found", and a
// statement listed only the jobs its sender had personally created.
//
// A link belongs to a company: its org_id is stamped from the job (or the
// client for statements) when it is created. Rows are matched on that org.
// Links from before org stamping fall back to the creator's rows.

/** Filter object for supabase-js .match(): the link's company, else its creator. */
export function linkScope(link) {
  if (link?.org_id) return { org_id: link.org_id }
  return { user_id: link?.user_id ?? null }
}
