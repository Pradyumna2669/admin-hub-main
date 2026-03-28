CREATE OR REPLACE FUNCTION public.sync_profile_from_reddit_accounts(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  primary_account RECORD;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN;
  END IF;

  SELECT
    ra.reddit_username,
    ra.reddit_profile,
    ra.reddit_data,
    COALESCE(ra.is_verified, false) AS is_verified,
    ra.karma,
    ra.karma_range,
    ra.cqs,
    ra.cqs_proof,
    ra.avatar_url,
    public.derive_league(ra.karma, ra.karma_range, ra.cqs) AS league
  INTO primary_account
  FROM public.reddit_accounts ra
  WHERE ra.user_id = p_user_id
  ORDER BY
    COALESCE(ra.created_at, now()) ASC,
    lower(COALESCE(ra.reddit_username, '')) ASC,
    ra.id ASC
  LIMIT 1;

  PERFORM set_config('app.bypass_profile_protection', 'on', true);

  IF FOUND THEN
    UPDATE public.profiles
    SET
      reddit_username = primary_account.reddit_username,
      reddit_profile = primary_account.reddit_profile,
      reddit_data = primary_account.reddit_data,
      is_verified = primary_account.is_verified,
      karma = primary_account.karma,
      karma_range = primary_account.karma_range,
      cqs = primary_account.cqs,
      cqs_proof = primary_account.cqs_proof,
      avatar_url = CASE
        WHEN COALESCE(trim(public.profiles.avatar_url), '') = '' THEN primary_account.avatar_url
        ELSE public.profiles.avatar_url
      END,
      league = primary_account.league
    WHERE user_id = p_user_id;
  ELSE
    UPDATE public.profiles
    SET
      reddit_username = NULL,
      reddit_profile = NULL,
      reddit_data = NULL,
      is_verified = false,
      karma = NULL,
      karma_range = NULL,
      cqs = NULL,
      cqs_proof = NULL,
      league = NULL
    WHERE user_id = p_user_id;
  END IF;
END;
$$;
