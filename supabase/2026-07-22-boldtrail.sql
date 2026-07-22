-- BoldTrail (kvCORE) buyer leads — one row per interested buyer, written by the
-- server-side sync (service role). The team reads them; they render inside each
-- property's Showings section matched by the propertyBoost "pb<address>" tag.
-- Paste into Supabase -> SQL Editor -> Run. Idempotent.

create table if not exists public.bt_leads (
  id         text primary key,
  phone      text,
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.bt_leads enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='bt_leads' loop
    execute format('drop policy if exists %I on public.bt_leads', pol.policyname);
  end loop;
end $$;
create policy bt_leads_select on public.bt_leads for select to authenticated using (public.is_team());
create policy bt_leads_delete on public.bt_leads for delete to authenticated using (public.is_admin());

-- Live updates: new leads pop into the Showings section instantly.
do $$
begin
  execute 'alter publication supabase_realtime add table public.bt_leads';
exception when duplicate_object then null;
end $$;
