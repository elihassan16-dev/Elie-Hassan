-- ============================================================================
-- Goldstone Properties — Supabase schema
-- Paste this whole file into:  Supabase Dashboard → SQL Editor → New query → Run
-- Safe to run more than once (idempotent).
-- ============================================================================

-- ── users (profile mirror of auth.users) ────────────────────────────────────
create table if not exists public.users (
  id         uuid primary key references auth.users(id) on delete cascade,
  email      text,
  name       text,
  role       text not null default 'member' check (role in ('admin','member')),
  created_at timestamptz not null default now()
);

-- Helper: is the current user an admin? (SECURITY DEFINER avoids RLS recursion.)
-- Defined after public.users so the SQL body validates.
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.users where id = auth.uid() and role = 'admin'
  );
$$;

-- Any real teammate (admin or member) — contractor logins are NOT team.
create or replace function public.is_team()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(select 1 from public.users where id = auth.uid() and role in ('admin','member'));
$$;

-- When someone signs up, create their profile row. Your email is seeded as admin.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    case when lower(new.email) = 'elihassan16@gmail.com' then 'admin' else 'member' end
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill: if you already created your auth user before running this, make a
-- profile row for every existing auth user (and set your admin flag).
insert into public.users (id, email, name, role)
select u.id, u.email,
       coalesce(u.raw_user_meta_data->>'name', split_part(u.email,'@',1)),
       case when lower(u.email) = 'elihassan16@gmail.com' then 'admin' else 'member' end
from auth.users u
on conflict (id) do nothing;

update public.users set role = 'admin' where lower(email) = 'elihassan16@gmail.com';

-- ── properties / leads / contacts / automations ─────────────────────────────
-- Rich nested app objects live in `data` (jsonb); scalar columns are denormalized
-- copies for querying/sorting. The app always reads the full object from `data`.
create table if not exists public.properties (
  id         text primary key,
  address    text,
  city       text,
  state      text,
  zip        text,
  status     text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

create table if not exists public.leads (
  id          text primary key,
  address     text,
  city        text,
  state       text,
  zip         text,
  lead_status text,
  data        jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now(),
  updated_by  uuid default auth.uid()
);

create table if not exists public.contacts (
  id    text primary key,
  name  text,
  role  text,
  phone text,
  email text,
  data  jsonb not null default '{}'::jsonb
);

create table if not exists public.automations (
  id      text primary key,
  trigger text,
  data    jsonb not null default '{}'::jsonb
);

-- ── tasks (queryable, denormalized read model) ──────────────────────────────
-- Maintained automatically from each property's nested task list by a trigger,
-- so you get a real flat tasks table for reporting without any client sync logic.
create table if not exists public.tasks (
  id           uuid primary key default gen_random_uuid(),
  property_id  text references public.properties(id) on delete cascade,
  prop_address text,
  prop_status  text,
  cat          text,
  text         text,
  status       text default 'Not Started',
  assignee     text,
  deleted      boolean default false,
  task_contact jsonb,
  synced_at    timestamptz not null default now()
);
create index if not exists tasks_property_id_idx on public.tasks(property_id);
create index if not exists tasks_assignee_idx    on public.tasks(assignee);

create or replace function public.sync_property_tasks()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (tg_op = 'DELETE') then
    delete from public.tasks where property_id = old.id;
    return old;
  end if;

  delete from public.tasks where property_id = new.id;

  insert into public.tasks (property_id, prop_address, prop_status, cat, text, status, assignee, deleted, task_contact)
  select new.id,
         coalesce(new.address,'') || case when coalesce(new.city,'') <> '' then ', ' || new.city else '' end,
         new.status,
         t->>'cat',
         t->>'text',
         coalesce(t->>'status', 'Not Started'),
         t->>'assignee',
         coalesce((t->>'deleted')::boolean, false),
         t->'taskContact'
  from jsonb_array_elements(coalesce(new.data->'tasks', '[]'::jsonb)) as t
  where coalesce(t->>'text','') <> '';

  return new;
end;
$$;

drop trigger if exists trg_sync_property_tasks on public.properties;
create trigger trg_sync_property_tasks
  after insert or update or delete on public.properties
  for each row execute function public.sync_property_tasks();

-- ── Row Level Security ──────────────────────────────────────────────────────
alter table public.users       enable row level security;
alter table public.properties  enable row level security;
alter table public.leads       enable row level security;
alter table public.contacts    enable row level security;
alter table public.automations enable row level security;
alter table public.tasks       enable row level security;

-- users: everyone signed in can read the team (for assignment dropdowns);
-- you can edit your own row, admins can edit anyone (e.g. promote to admin).
drop policy if exists users_select on public.users;
create policy users_select on public.users for select to authenticated using (true);
drop policy if exists users_update on public.users;
create policy users_update on public.users for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());
drop policy if exists users_insert on public.users;
create policy users_insert on public.users for insert to authenticated
  with check (id = auth.uid() or public.is_admin());

-- Shared business data: any signed-in user can read and UPDATE (so members can
-- complete tasks / edit deal data); only admins can ADD or DELETE records.
do $$
declare tbl text;
begin
  foreach tbl in array array['properties','leads','contacts','automations'] loop
    execute format('drop policy if exists %1$s_select on public.%1$s', tbl);
    execute format('create policy %1$s_select on public.%1$s for select to authenticated using (true)', tbl);

    execute format('drop policy if exists %1$s_update on public.%1$s', tbl);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (true) with check (true)', tbl);

    execute format('drop policy if exists %1$s_insert on public.%1$s', tbl);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_team())', tbl);

    execute format('drop policy if exists %1$s_delete on public.%1$s', tbl);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.is_admin())', tbl);
  end loop;
end $$;

-- Converting a lead to Under Contract deletes the lead row — members do this
-- too, so lead deletes are team-wide (property/contact deletes stay admin-only).
drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated using (public.is_team());

-- tasks: read-only to clients (the table is maintained by the trigger above).
drop policy if exists tasks_select on public.tasks;
create policy tasks_select on public.tasks for select to authenticated using (true);

-- ── Realtime: broadcast row changes to all connected clients ────────────────
do $$
declare tbl text;
begin
  foreach tbl in array array['properties','leads','contacts','automations','users'] loop
    begin
      execute format('alter publication supabase_realtime add table public.%I', tbl);
    exception when duplicate_object then null; -- already in the publication
    end;
  end loop;
end $$;

-- ============================================================================
-- Done. Next: create your login user (Authentication → Users → Add user),
-- then open the app and sign in. The first admin login auto-seeds your 50
-- properties + contacts + leads.
-- ============================================================================
