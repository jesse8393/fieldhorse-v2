-- 051 — Bring-your-own payment link
--
-- The contractor pastes their existing pay link (Venmo / Zelle / Square
-- / PayPal / a Stripe Payment Link they created themselves) once. It
-- then renders as a "Pay now" button on invoices, statements, and the
-- customer-facing pages. We integrate with no provider — the contractor
-- brings the link.

alter table public.profiles
  add column if not exists payment_link text,
  add column if not exists payment_instructions text;
