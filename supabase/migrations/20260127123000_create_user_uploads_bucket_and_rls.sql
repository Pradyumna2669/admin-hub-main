-- 20260127_create_user_uploads_bucket_and_rls.sql
-- 1. Create the user_uploads storage bucket
insert into storage.buckets (id, name, public) values ('user_uploads', 'user_uploads', false) on conflict do nothing;

-- 2. Enable RLS on storage.objects (if not already enabled)

-- Allow users to insert their own user_roles row
CREATE POLICY "Users can insert their own role" ON public.user_roles
  FOR INSERT
  WITH CHECK (user_id = auth.uid());

-- 3. Remove any existing policies for user_uploads bucket (if exist)
DROP POLICY IF EXISTS "Authenticated users can upload to their own objects" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can read their own objects" ON storage.objects;

-- 4. Allow authenticated users to upload to their own objects in user_uploads bucket
CREATE POLICY "Authenticated users can upload to their own objects" ON storage.objects
  FOR INSERT
  WITH CHECK (bucket_id = 'user_uploads' AND owner = auth.uid());

-- 5. Allow authenticated users to read their own objects in user_uploads bucket
CREATE POLICY "Authenticated users can read their own objects" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'user_uploads' AND owner = auth.uid());
