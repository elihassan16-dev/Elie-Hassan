-- Attachments storage for chat (photos, PDFs, voice notes).
-- Run once in Supabase → SQL Editor. Creates a public "attachments" bucket and
-- lets any signed-in user upload; files are readable by their public URL.

insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', true)
on conflict (id) do nothing;

-- Signed-in users can upload into the bucket.
drop policy if exists attachments_insert on storage.objects;
create policy attachments_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'attachments');

-- Signed-in users can read (public bucket also serves files by URL).
drop policy if exists attachments_select on storage.objects;
create policy attachments_select on storage.objects
  for select to authenticated
  using (bucket_id = 'attachments');

-- (Optional) let uploaders remove their own files.
drop policy if exists attachments_delete on storage.objects;
create policy attachments_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'attachments' and owner = auth.uid());
