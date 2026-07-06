-- ============================================================================
-- Goldstone Properties — Company / general tasks (not tied to a property)
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run (idempotent).
--
-- Backs the "Company Tasks" section on the Tasks page — general office to-dos
-- that aren't attached to any property. Same {id, data} shape as the office
-- chat, shared live to every signed-in team member.
-- ============================================================================

create table if not exists public.office_tasks (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz default now()
);

alter table public.office_tasks enable row level security;

-- Any signed-in team member can read/write company tasks.
do $$
begin
  if not exists (select 1 from pg_policies where schemaname='public' and tablename='office_tasks' and policyname='office_tasks_all') then
    create policy office_tasks_all on public.office_tasks
      for all to authenticated using (true) with check (true);
  end if;
end $$;

-- Realtime so the list updates live across sessions.
do $$
begin
  begin
    alter publication supabase_realtime add table public.office_tasks;
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================================
-- Done.
-- ============================================================================
