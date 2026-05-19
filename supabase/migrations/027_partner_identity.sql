-- 027_partner_identity.sql
--
-- Adds partner identity columns to fh_job_partners so invites can carry
-- a name (used in the email greeting) and a role tag (Foreman / Sub /
-- Estimator / Other — surfaced in the inviter's partner list and the
-- email body). Both nullable so legacy rows continue to validate.

alter table public.fh_job_partners
  add column if not exists partner_name text,
  add column if not exists partner_role text;
