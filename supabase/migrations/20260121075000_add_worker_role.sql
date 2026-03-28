-- Add worker role to app_role enum type
-- This must run first, before the categories_and_worker_role migration
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE 'worker';
EXCEPTION WHEN duplicate_object THEN
  NULL;
END $$;
