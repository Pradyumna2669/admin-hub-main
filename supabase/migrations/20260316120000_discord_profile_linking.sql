-- Add Discord identity fields to profiles for bot linking

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discord_user_id TEXT,
  ADD COLUMN IF NOT EXISTS discord_username TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_discord_user_id_unique_idx
  ON public.profiles (discord_user_id)
  WHERE discord_user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS profiles_discord_username_idx
  ON public.profiles (discord_username);
