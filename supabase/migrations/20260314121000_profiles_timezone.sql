-- Add timezone to profiles so it can be shared across reddit accounts
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS timezone TEXT;
