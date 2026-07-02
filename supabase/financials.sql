-- ============================================================================
-- Goldstone Properties — Financial Section (private lenders / LOC)
-- Paste this whole file into:  Supabase Dashboard → SQL Editor → New query → Run
-- Safe to run more than once (idempotent).
--
-- These two tables back the admin-only Financial Section: private-lender
-- "funders" (each with a capital ledger) and the "draws" (money lent against a
-- property). RLS locks BOTH tables to admins only — members can't read or write
-- them at all, so this data never even reaches a non-admin's browser.
-- ============================================================================

create table if not exists public.funders (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.draws (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

-- ── Row Level Security — admin-only for both tables ─────────────────────────
alter table public.funders enable row level security;
alter table public.draws   enable row level security;

do $$
declare tbl text;
begin
  foreach tbl in array array['funders','draws'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', tbl);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_admin())', tbl);

    execute format('drop policy if exists %1$s_insert on public.%1$s', tbl);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_admin())', tbl);

    execute format('drop policy if exists %1$s_update on public.%1$s', tbl);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_admin()) with check (public.is_admin())', tbl);

    execute format('drop policy if exists %1$s_delete on public.%1$s', tbl);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_admin())', tbl);
  end loop;
end $$;

-- ── Realtime: broadcast changes to connected (admin) clients ────────────────
do $$
declare tbl text;
begin
  foreach tbl in array array['funders','draws'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ============================================================================
-- Done. The Financial Section will start saving here immediately.
-- ============================================================================
