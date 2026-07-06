-- ============================================================================
-- Goldstone Properties — Shared app settings (admin-editable configuration)
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run (idempotent).
--
-- Backs shared, company-wide configuration such as the status-change checklists
-- ("Status Requirements"). Same {id, data} shape as the other config tables.
-- Every signed-in team member can READ so the gates apply for everyone; the app
-- only lets the admin edit them.
-- ============================================================================

create table if not exists public.app_settings (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.app_settings enable row level security;

-- Any signed-in team member can read/write app settings (edit is admin-gated in the app UI).
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='app_settings' and policyname='app_settings_all') then
    create policy app_settings_all on public.app_settings
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Realtime so config changes propagate live across sessions.
do $$
begin
  begin
    alter publication supabase_realtime add table public.app_settings;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================================
-- Done.
-- ============================================================================
