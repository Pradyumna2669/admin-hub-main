-- 20260127_fix_activity_logs_rls.sql
-- Remove overly permissive insert policy and replace with user-only insert
DROP POLICY IF EXISTS "Anyone can insert activity logs" ON public.activity_logs;
CREATE POLICY "Users can insert their own activity logs" ON public.activity_logs
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);
