-- Business texting (Quo / OpenPhone): every SMS the company sends or receives,
-- one row per message, so the app can show real conversation threads on
-- showings, leads, and contacts. Written by the server (service role).
-- Admin-only read for now — the connected Quo number is the admin's own line;
-- opens up per-user once each teammate has their own number.
-- Paste into Supabase -> SQL Editor -> Run. Idempotent.

create table if not exists public.sms_messages (
  id         text primary key,
  phone      text,             -- the OTHER side's number, E.164 (thread key)
  data       jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists sms_messages_phone_idx on public.sms_messages(phone);

alter table public.sms_messages enable row level security;

do $$
declare pol record;
begin
  for pol in select policyname from pg_policies where schemaname='public' and tablename='sms_messages' loop
    execute format('drop policy if exists %I on public.sms_messages', pol.policyname);
  end loop;
end $$;
create policy sms_messages_select on public.sms_messages for select to authenticated using (public.is_admin());
create policy sms_messages_delete on public.sms_messages for delete to authenticated using (public.is_admin());

-- Live updates: replies pop into open threads instantly.
do $$
begin
  execute 'alter publication supabase_realtime add table public.sms_messages';
exception when duplicate_object then null;
end $$;
