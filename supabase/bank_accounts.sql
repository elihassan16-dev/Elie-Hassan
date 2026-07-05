-- ============================================================================
-- Goldstone Properties — Bank accounts (for the Bank Reconciliation page)
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run (idempotent).
--
-- A small shared list of bank accounts you can add on the Bank Reconciliation
-- tab and assign to properties on the Property BS Report. Same {id, data} shape
-- as the funders/draws tables, synced live to every signed-in admin.
-- ============================================================================

create table if not exists public.bank_accounts (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.bank_accounts enable row level security;

-- Signed-in users can read/write (the Financial Section is admin-only in the app).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='bank_accounts' and policyname='bank_accounts_all') then
    create policy bank_accounts_all on public.bank_accounts
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Realtime so the list updates live across sessions.
alter publication supabase_realtime add table public.bank_accounts;

-- ============================================================================
-- Done.
-- ============================================================================
