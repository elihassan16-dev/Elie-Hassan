-- ============================================================================
-- Goldstone Properties — Contractor Portal (phase 1: schema + role separation)
-- Paste this whole file into:  Supabase Dashboard → SQL Editor → New query → Run
-- Safe to run more than once (idempotent).
--
-- Adds the "contractor" role and the portal tables (orgs, jobs, tasks,
-- messages, docs) — and, critically, LOCKS DOWN every existing business table
-- so contractor accounts can only reach their own company's portal rows.
-- Team members (admin + member) keep exactly the access they have today, so
-- running this before the portal ships changes nothing visible.
-- ============================================================================

-- ── users: allow the contractor role + link to their company ────────────────
alter table public.users drop constraint if exists users_role_check;
alter table public.users add constraint users_role_check
  check (role in ('admin','member','contractor'));
alter table public.users add column if not exists contractor_org_id text;

-- Helper: is the current user on the Goldstone team (not a contractor)?
create or replace function public.is_team()
returns boolean language sql security definer stable set search_path = public
as $$ select exists (select 1 from public.users where id = auth.uid() and role in ('admin','member')); $$;

-- Helper: the current user's contractor company id ('' when not a contractor).
create or replace function public.contractor_org()
returns text language sql security definer stable set search_path = public
as $$ select coalesce((select contractor_org_id from public.users where id = auth.uid() and role = 'contractor'), ''); $$;

-- ── Portal tables (same {id, data} shape as funders/draws) ──────────────────
create table if not exists public.contractor_orgs (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create table if not exists public.contractor_jobs (
  id         text primary key,
  org_id     text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create table if not exists public.contractor_tasks (
  id         text primary key,
  org_id     text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create table if not exists public.contractor_messages (
  id         text primary key,
  org_id     text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create table if not exists public.contractor_docs (
  id         text primary key,
  org_id     text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);
create index if not exists contractor_jobs_org_idx     on public.contractor_jobs(org_id);
create index if not exists contractor_tasks_org_idx    on public.contractor_tasks(org_id);
create index if not exists contractor_messages_org_idx on public.contractor_messages(org_id);
create index if not exists contractor_docs_org_idx     on public.contractor_docs(org_id);

alter table public.contractor_orgs     enable row level security;
alter table public.contractor_jobs     enable row level security;
alter table public.contractor_tasks    enable row level security;
alter table public.contractor_messages enable row level security;
alter table public.contractor_docs     enable row level security;

-- ── LOCK DOWN existing business tables: team-only ────────────────────────────
-- Drops EVERY existing policy on each table (so no forgotten open policy keeps
-- granting access — policies are OR'd) and recreates the team-gated set.

-- Group A — team read/update, admin insert/delete (unchanged semantics for team):
do $$
declare tbl text; pol record;
begin
  foreach tbl in array array['properties','leads','contacts','automations'] loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=tbl loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_team())', tbl);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_team()) with check (public.is_team())', tbl);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_admin())', tbl);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_admin())', tbl);
  end loop;
end $$;

-- Group B — team read, admin write (Financial Section):
do $$
declare tbl text; pol record;
begin
  foreach tbl in array array['funders','draws'] loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=tbl loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_team())', tbl);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_admin())', tbl);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_admin()) with check (public.is_admin())', tbl);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_admin())', tbl);
  end loop;
end $$;

-- Group C — team full access:
do $$
declare tbl text; pol record;
begin
  foreach tbl in array array['app_settings','bank_accounts','office_messages','office_tasks','rentals'] loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=tbl loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;
    execute format('create policy %1$s_all on public.%1$s for all to authenticated using (public.is_team()) with check (public.is_team())', tbl);
  end loop;
end $$;

-- tasks read model — team only:
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated using (public.is_team());

-- users: team sees the roster; a contractor sees ONLY their own row.
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated
  using (public.is_team() or id = auth.uid());
-- (users_update / users_insert from schema.sql already limit writes to self/admin.)

-- ── Portal table policies ────────────────────────────────────────────────────
-- Orgs: team reads all, admin writes; a contractor reads their own company row.
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='contractor_orgs' loop
    execute format('drop policy if exists %I on public.contractor_orgs', pol.policyname);
  end loop;
end $$;
create policy contractor_orgs_select on public.contractor_orgs for select to authenticated
  using (public.is_team() or id = public.contractor_org());
create policy contractor_orgs_write on public.contractor_orgs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Jobs: team reads, ADMIN writes (price/payments/change orders are admin-only);
-- a contractor reads their own company's jobs.
do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='contractor_jobs' loop
    execute format('drop policy if exists %I on public.contractor_jobs', pol.policyname);
  end loop;
end $$;
create policy contractor_jobs_select on public.contractor_jobs for select to authenticated
  using (public.is_team() or org_id = public.contractor_org());
create policy contractor_jobs_write on public.contractor_jobs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Tasks + messages + docs: both sides read AND write, each scoped to the org.
do $$
declare tbl text; pol record;
begin
  foreach tbl in array array['contractor_tasks','contractor_messages','contractor_docs'] loop
    for pol in select policyname from pg_policies where schemaname='public' and tablename=tbl loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (public.is_team() or org_id = public.contractor_org())', tbl);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_team() or org_id = public.contractor_org())', tbl);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.is_team() or org_id = public.contractor_org()) with check (public.is_team() or org_id = public.contractor_org())', tbl);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_admin() or org_id = public.contractor_org())', tbl);
  end loop;
end $$;

-- ── Realtime for the portal tables ───────────────────────────────────────────
do $$
declare tbl text;
begin
  foreach tbl in array array['contractor_orgs','contractor_jobs','contractor_tasks','contractor_messages','contractor_docs'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception when duplicate_object then null;
    end;
  end loop;
end $$;

-- ============================================================================
-- Done. Team access is unchanged; contractor accounts (created from the app's
-- Contractors section) can only see their own company's jobs/tasks/messages.
-- ============================================================================
