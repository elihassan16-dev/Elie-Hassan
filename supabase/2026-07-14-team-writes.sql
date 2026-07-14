-- Members couldn't move a lead to Under Contract: inserting the new
-- properties row (and deleting the lead) was admin-only. Trusted teammates
-- (role admin OR member) may now ADD rows on the shared business tables and
-- delete leads; property/contact/automation deletes stay admin-only.
-- Paste into Supabase -> SQL Editor -> Run.

create or replace function public.is_team()
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists(select 1 from public.users where id = auth.uid() and role in ('admin','member'));
$$;

do $$
declare tbl text;
begin
  foreach tbl in array array['properties','leads','contacts','automations'] loop
    execute format('drop policy if exists %1$s_insert on public.%1$s', tbl);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.is_team())', tbl);
  end loop;
end $$;

drop policy if exists leads_delete on public.leads;
create policy leads_delete on public.leads for delete to authenticated using (public.is_team());
