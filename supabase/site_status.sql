-- ============================================================================
-- Goldstone Properties — Property Site Status (utilities + permits)
-- Paste into: Supabase Dashboard → SQL Editor → New query → Run (idempotent).
--
-- One row per property: gas/water/electric on-off and permit states. The team
-- reads/writes; a contractor login can READ the row only for properties where
-- their company has a job (so the portal can show site status, nothing else).
-- ============================================================================

create table if not exists public.site_status (
  id         text primary key,          -- the property id
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid()
);

alter table public.site_status enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='site_status' loop
    execute format('drop policy if exists %I on public.site_status', pol.policyname);
  end loop;
end $$;

-- Team: everything. Contractor: read-only, and only for properties they work on.
create policy site_status_select on public.site_status for select to authenticated
  using (
    public.is_team()
    or exists (
      select 1 from public.contractor_jobs j
      where j.org_id = public.contractor_org()
        and (j.data->>'propertyId') = public.site_status.id
    )
  );
create policy site_status_write on public.site_status for all to authenticated
  using (public.is_team()) with check (public.is_team());

do $$
begin
  execute 'alter publication supabase_realtime add table public.site_status';
exception when duplicate_object then null;
end $$;

-- ============================================================================
-- Done.
-- ============================================================================
