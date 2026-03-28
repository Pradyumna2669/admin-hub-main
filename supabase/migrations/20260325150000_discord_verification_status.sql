-- Track Discord server membership and role verification status on worker profiles.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS discord_in_server BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discord_verified BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS discord_last_checked_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS discord_verified_at TIMESTAMP WITH TIME ZONE;

CREATE INDEX IF NOT EXISTS profiles_discord_verification_idx
  ON public.profiles (discord_verified, discord_in_server);
