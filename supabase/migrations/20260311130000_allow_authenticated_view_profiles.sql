-- Allow any authenticated user, including workers, to read profile rows.
-- This keeps write access unchanged while making profiles visible across users.

DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;

CREATE POLICY "Authenticated users can view all profiles"
  ON public.profiles FOR SELECT
  TO authenticated
  USING (auth.uid() IS NOT NULL);
