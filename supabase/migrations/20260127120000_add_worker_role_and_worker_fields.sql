-- 20260127_add_worker_role_and_worker_fields.sql
-- 1. Add 'worker' to app_role enum if not present
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role' AND e.enumlabel = 'worker'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'worker';
  END IF;
END$$;

-- 2. Ensure worker fields exist in profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reddit_username TEXT,
  ADD COLUMN IF NOT EXISTS reddit_data JSONB;

-- 3. (Manual step) In Supabase dashboard, create a storage bucket named 'user_uploads' if it does not exist.
--    This is required for screenshot uploads.
