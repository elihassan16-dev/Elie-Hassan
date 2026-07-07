-- ============================================================================
-- Goldstone Properties — Rental Portfolio
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run (idempotent).
--
-- Backs the Rental Portfolio tab: buy-and-hold properties with units, leases,
-- tenants, mortgage terms, management fees, a per-month rent/expense ledger, and
-- an optional QuickBooks project link. Same {id, data} JSONB shape as the other
-- config-style tables so the app round-trips the whole object.
-- ============================================================================

create table if not exists public.rentals (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.rentals enable row level security;

-- Any signed-in team member can read/write rentals (mirrors the other collections).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='rentals' and policyname='rentals_all') then
    create policy rentals_all on public.rentals
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Realtime so changes propagate live across sessions/devices.
do $$
begin
  begin
    alter publication supabase_realtime add table public.rentals;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================================
-- Done.
-- ============================================================================
