insert into storage.buckets (id, name, public)
values ('user_avatars', 'user_avatars', true)
on conflict do nothing;

drop policy if exists "Users can upload their own avatars" on storage.objects;
create policy "Users can upload their own avatars"
  on storage.objects for insert
  with check (
    bucket_id = 'user_avatars'
    and owner = auth.uid()
  );

drop policy if exists "Users can update their own avatars" on storage.objects;
create policy "Users can update their own avatars"
  on storage.objects for update
  using (
    bucket_id = 'user_avatars'
    and owner = auth.uid()
  )
  with check (
    bucket_id = 'user_avatars'
    and owner = auth.uid()
  );

drop policy if exists "Users can delete their own avatars" on storage.objects;
create policy "Users can delete their own avatars"
  on storage.objects for delete
  using (
    bucket_id = 'user_avatars'
    and owner = auth.uid()
  );
