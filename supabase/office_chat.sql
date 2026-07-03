-- ============================================================================
-- Goldstone Properties — Office Chat (general team channel, not tied to a property)
-- Paste this whole file into:  Supabase Dashboard → SQL Editor → New query → Run
-- Safe to run more than once (idempotent).
--
-- Backs the "Office Chat" pinned at the top of the Messaging Center. Each message
-- is its own row (so two people posting at once never overwrite each other). Any
-- signed-in teammate can read and post; that's the whole point of a shared channel.
-- ============================================================================

create table if not exists public.office_messages (
  id         text primary key,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.office_messages enable row level security;

-- Shared team channel: every signed-in user can read, post, edit and delete.
drop policy if exists office_messages_select on public.office_messages;
create policy office_messages_select on public.office_messages for select to authenticated using (true);

drop policy if exists office_messages_insert on public.office_messages;
create policy office_messages_insert on public.office_messages for insert to authenticated with check (true);

drop policy if exists office_messages_update on public.office_messages;
create policy office_messages_update on public.office_messages for update to authenticated using (true) with check (true);

drop policy if exists office_messages_delete on public.office_messages;
create policy office_messages_delete on public.office_messages for delete to authenticated using (true);

-- Realtime so new messages appear for everyone live.
do $$
begin
  begin
    execute 'alter publication supabase_realtime add table public.office_messages';
  exception when duplicate_object then null;
  end;
end $$;

-- ============================================================================
-- Done. The Office Chat will start saving here immediately.
-- ============================================================================
