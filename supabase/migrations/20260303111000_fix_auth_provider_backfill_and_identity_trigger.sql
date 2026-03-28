-- Fix auth provider detection for OAuth users (Discord/Google/etc.)
-- Prefer auth.identities.provider over raw_app_meta_data, and keep profiles in sync.

-- Ensure column exists (idempotent)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auth_provider TEXT;

-- Backfill/repair: if an OAuth identity exists, update profiles.auth_provider accordingly.
-- This also corrects rows that were previously defaulted to 'email'.
WITH ident AS (
  SELECT
    user_id,
    COALESCE(
      (array_remove(array_agg(DISTINCT provider), 'email'))[1],
      (array_agg(DISTINCT provider))[1]
    ) AS provider
  FROM auth.identities
  GROUP BY user_id
)
UPDATE public.profiles p
SET auth_provider = ident.provider
FROM ident
WHERE p.user_id = ident.user_id
  AND ident.provider IS NOT NULL
  AND (
    p.auth_provider IS NULL
    OR p.auth_provider = ''
    OR (p.auth_provider = 'email' AND ident.provider <> 'email')
  );

-- Keep future OAuth logins correct:
-- When a new identity is created, sync provider into profiles.
CREATE OR REPLACE FUNCTION public.sync_profile_auth_provider_from_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET auth_provider = NEW.provider
  WHERE user_id = NEW.user_id
    AND (
      auth_provider IS NULL
      OR auth_provider = ''
      OR auth_provider = 'email'
      OR auth_provider <> NEW.provider
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_identity_created ON auth.identities;
CREATE TRIGGER on_auth_identity_created
AFTER INSERT ON auth.identities
FOR EACH ROW EXECUTE FUNCTION public.sync_profile_auth_provider_from_identity();

