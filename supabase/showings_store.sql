-- ============================================================================
-- Goldstone Properties — persistent Showings store
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run (idempotent).
--
-- ShowingTime's calendar feed only includes a rolling window, so past showings
-- drop off it over time. We mirror every showing we've ever seen into this table
-- so they never disappear — which is what was making saved leads look "reverted
-- to blank" (the showing row itself vanished). Written/read only by the
-- serverless functions via the service role (RLS on, no policies), same as the
-- feed URL in app_settings.
-- ============================================================================

create table if not exists public.showings (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.showings enable row level security;
-- Intentionally no policies: the service role bypasses RLS; clients are denied.

-- ============================================================================
-- Done.
-- ============================================================================
