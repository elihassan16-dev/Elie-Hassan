-- App settings store (holds the ShowingTime calendar feed URL, etc.).
-- Run once in Supabase → SQL Editor. RLS ON with NO policies, so the feed URL
-- (a private calendar link) is readable only by the serverless functions via the
-- service-role key — never exposed to the browser.

create table if not exists public.app_settings (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.app_settings enable row level security;
-- Intentionally no policies: service role bypasses RLS; clients are denied.
