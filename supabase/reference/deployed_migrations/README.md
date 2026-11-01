# Recovered database history

Sixteen original SQL records were recovered from Supabase migration history on November 1, 2026. Their filenames preserve recorded versions and names. This directory contains reference source only. Nothing here was applied to production.

Keep these files outside active migrations. Replaying them against an existing database can overwrite newer functions and restart automation schedules. Reconcile historical order and dependencies in an isolated staging database first. The manifest records checksums for this captured source.

Automated credential pattern scanning found no embedded credential signatures. The SQL contains schema definitions, functions, generic defaults and scheduling statements. Recovery does not certify every function or prove a complete database restore. Source review remains explicitly tracked in the audit ledger.
