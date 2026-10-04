-- FICUS module 4: photo, audio and file uploads (Supabase Storage).
-- Run once in the Supabase SQL Editor after 03_log_and_time.sql. Safe to re-run.
--
-- Every upload (fig photos and attachments, tracker check-in photos, task and
-- project media, binder covers, voice notes) goes to one bucket named `uploads`.
-- Each file is stored as `<user id>/<random name>.<ext>`, and the app saves the
-- file's public URL inside the fig / task / project that uses it.
--
-- The bucket is public so those saved URLs keep working forever (signed URLs
-- expire). Nobody can list the bucket; a file can only be opened by someone who
-- has its link, and the random 32-character name makes links unguessable.
-- Only the signed-in owner can add, replace or delete files in their folder.
--
-- 50 MB is the largest single file the Supabase Free plan allows. On a paid
-- plan you can raise file_size_limit here (and the global limit under
-- Project Settings -> Storage) to allow longer videos.

insert into storage.buckets (id, name, public, file_size_limit)
values ('uploads', 'uploads', true, 52428800)
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit;

drop policy if exists "Users upload into their own folder" on storage.objects;
create policy "Users upload into their own folder"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users read their own uploads" on storage.objects;
create policy "Users read their own uploads"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users replace their own uploads" on storage.objects;
create policy "Users replace their own uploads"
  on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  )
  with check (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );

drop policy if exists "Users delete their own uploads" on storage.objects;
create policy "Users delete their own uploads"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'uploads'
    and (storage.foldername(name))[1] = (select auth.uid())::text
  );
