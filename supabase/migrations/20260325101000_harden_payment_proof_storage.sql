-- Restrict payment proof storage access to staff and the affected worker.

DROP POLICY IF EXISTS "Owners admins and moderators can read payment proofs" ON storage.objects;
CREATE POLICY "Owners admins and moderators can read payment proofs" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'user_uploads'
    AND (storage.foldername(name))[1] = 'payment-proofs'
    AND (
      public.has_role(auth.uid(), 'owner')
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'moderator')
    )
  );

DROP POLICY IF EXISTS "Workers can read own payment proofs" ON storage.objects;
CREATE POLICY "Workers can read own payment proofs" ON storage.objects
  FOR SELECT
  USING (
    bucket_id = 'user_uploads'
    AND (storage.foldername(name))[1] = 'payment-proofs'
    AND (storage.foldername(name))[2] = auth.uid()::text
  );
