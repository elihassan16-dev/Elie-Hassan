-- QuickBooks connection token store.
-- Run once in Supabase → SQL Editor. RLS is ON with NO policies, so neither the
-- anon nor authenticated keys can read these tokens from the browser — only the
-- serverless functions (which use the service-role key) can touch this table.

create table if not exists public.quickbooks_connection (
  id            text primary key default 'default',
  realm_id      text,
  access_token  text,
  refresh_token text,
  expires_at    timestamptz,
  updated_at    timestamptz default now()
);

alter table public.quickbooks_connection enable row level security;
-- Intentionally no policies: service role bypasses RLS; everyone else is denied.
