-- Team members' messages to external contractor chats were vanishing on send.
-- The intended rule has always been: EVERY team member (admin or member) can
-- read and write the contractor threads (tasks / messages / docs), and each
-- contractor company can only touch its own. This re-applies that rule from
-- scratch in case the live database drifted from it.
-- Paste into Supabase -> SQL Editor -> Run. Safe to run more than once.

create or replace function public.is_team()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(select 1 from public.users where id = auth.uid() and role in ('admin','member'));
$$;

create or replace function public.contractor_org()
returns text
language sql
security definer
stable
set search_path = public
as $$
  select coalesce((select contractor_org_id from public.users where id = auth.uid() and role = 'contractor'), '');
$$;

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
