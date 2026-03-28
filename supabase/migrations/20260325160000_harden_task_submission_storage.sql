insert into storage.buckets (id, name, public)
values ('task-submissions', 'task-submissions', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "Workers can upload own task submission files" on storage.objects;
create policy "Workers can upload own task submission files"
  on storage.objects for insert
  with check (
    bucket_id = 'task-submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Workers can read own task submission files" on storage.objects;
create policy "Workers can read own task submission files"
  on storage.objects for select
  using (
    bucket_id = 'task-submissions'
    and (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "Owners admins and moderators can read task submission files" on storage.objects;
create policy "Owners admins and moderators can read task submission files"
  on storage.objects for select
  using (
    bucket_id = 'task-submissions'
    and (
      public.has_role(auth.uid(), 'owner')
      or public.has_role(auth.uid(), 'admin')
      or public.has_role(auth.uid(), 'moderator')
    )
  );
