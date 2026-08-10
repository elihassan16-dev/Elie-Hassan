-- Moshe texted from the app and the send worked, but the conversation and
-- Elie's reply never showed on his login: READING sms_messages was admin-only
-- (sms_messages_select used is_admin()), so member logins (Moshe, Esti) got
-- zero rows back while server-side sends kept working. The whole team may
-- read the shared texting store now — same is_team() rule the BoldTrail
-- leads already use. Deletes stay admin-only, and contractors keep no access
-- (is_team covers admin + member only).
-- Paste into Supabase -> SQL Editor -> Run.

drop policy if exists sms_messages_select on public.sms_messages;
create policy sms_messages_select on public.sms_messages
  for select to authenticated using (public.is_team());
