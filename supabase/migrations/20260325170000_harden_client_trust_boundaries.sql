-- Harden client/server trust boundaries for roles, profiles, task claims,
-- task submissions, and worker verification.

DROP POLICY IF EXISTS "Users can insert their own role" ON public.user_roles;

DROP POLICY IF EXISTS "Users can insert their reddit accounts" ON public.reddit_accounts;
DROP POLICY IF EXISTS "Users can update their reddit accounts" ON public.reddit_accounts;

DROP POLICY IF EXISTS "Workers can create submissions for their tasks" ON public.task_submissions;
DROP POLICY IF EXISTS "Workers can update their own submissions if pending" ON public.task_submissions;

DROP POLICY IF EXISTS "Clients can update their assignment status" ON public.task_assignments;

CREATE OR REPLACE FUNCTION public.is_service_role()
RETURNS BOOLEAN
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(auth.role(), '') = 'service_role'
$$;

CREATE OR REPLACE FUNCTION public.cqs_rank(p_cqs TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(coalesce(p_cqs, '')))
    WHEN 'low' THEN 0
    WHEN 'moderate' THEN 1
    WHEN 'high' THEN 2
    WHEN 'highest' THEN 3
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.minimum_cqs_rank(p_cqs_levels TEXT[])
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT MIN(public.cqs_rank(level_value))
  FROM unnest(COALESCE(p_cqs_levels, ARRAY[]::TEXT[])) AS level_value
  WHERE public.cqs_rank(level_value) IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION public.derive_karma_from_range(p_range TEXT)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN p_range IS NULL OR trim(p_range) = '' THEN NULL
    WHEN lower(trim(p_range)) LIKE '%200%' AND lower(trim(p_range)) LIKE '%1k%' THEN 200
    WHEN lower(trim(p_range)) LIKE '1k%' THEN 1000
    WHEN lower(trim(p_range)) LIKE '5k%' THEN 5000
    WHEN lower(trim(p_range)) LIKE '25k%' THEN 25000
    WHEN lower(trim(p_range)) LIKE '50k%' THEN 50000
    WHEN lower(trim(p_range)) LIKE '100k%' THEN 100000
    WHEN lower(trim(p_range)) LIKE '<1k%' THEN 0
    ELSE NULL
  END
$$;

CREATE OR REPLACE FUNCTION public.derive_karma_from_profile(
  p_karma INTEGER,
  p_karma_range TEXT
)
RETURNS INTEGER
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    CASE
      WHEN p_karma IS NOT NULL AND p_karma >= 0 THEN p_karma
      ELSE NULL
    END,
    public.derive_karma_from_range(p_karma_range),
    0
  )
$$;

CREATE OR REPLACE FUNCTION public.derive_league(
  p_karma INTEGER,
  p_karma_range TEXT,
  p_cqs TEXT
)
RETURNS TEXT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  resolved_karma INTEGER := public.derive_karma_from_profile(p_karma, p_karma_range);
  base_league TEXT;
BEGIN
  base_league := CASE
    WHEN resolved_karma >= 50000 THEN 'diamond'
    WHEN resolved_karma >= 25000 THEN 'platinum'
    WHEN resolved_karma >= 5000 THEN 'gold'
    WHEN resolved_karma >= 1000 THEN 'silver'
    ELSE 'bronze'
  END;

  IF public.cqs_rank(p_cqs) >= 2 THEN
    RETURN CASE base_league
      WHEN 'bronze' THEN 'silver'
      WHEN 'silver' THEN 'gold'
      WHEN 'gold' THEN 'platinum'
      WHEN 'platinum' THEN 'diamond'
      ELSE 'diamond'
    END;
  END IF;

  RETURN base_league;
END;
$$;

CREATE OR REPLACE FUNCTION public.assert_profile_self_service_update()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  old_locked JSONB;
  new_locked JSONB;
BEGIN
  IF COALESCE(current_setting('app.bypass_profile_protection', true), '') = 'on' THEN
    RETURN NEW;
  END IF;

  IF public.is_service_role() THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF public.is_staff_role(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF OLD.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'You can only update your own profile.';
  END IF;

  old_locked := to_jsonb(OLD) - ARRAY['full_name', 'avatar_url', 'upi_id', 'timezone', 'updated_at'];
  new_locked := to_jsonb(NEW) - ARRAY['full_name', 'avatar_url', 'upi_id', 'timezone', 'updated_at'];

  IF new_locked IS DISTINCT FROM old_locked THEN
    RAISE EXCEPTION 'This profile field is managed by the server.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS protect_profile_self_service_updates ON public.profiles;
CREATE TRIGGER protect_profile_self_service_updates
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.assert_profile_self_service_update();

CREATE OR REPLACE FUNCTION public.sync_profile_from_reddit_accounts(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  best_account RECORD;
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
  INTO best_account
  FROM public.reddit_accounts ra
  WHERE ra.user_id = p_user_id
  ORDER BY
    COALESCE(ra.is_verified, false) DESC,
    CASE public.derive_league(ra.karma, ra.karma_range, ra.cqs)
      WHEN 'diamond' THEN 4
      WHEN 'platinum' THEN 3
      WHEN 'gold' THEN 2
      WHEN 'silver' THEN 1
      ELSE 0
    END DESC,
    public.derive_karma_from_profile(ra.karma, ra.karma_range) DESC,
    lower(COALESCE(ra.reddit_username, '')) ASC,
    COALESCE(ra.created_at, now()) ASC
  LIMIT 1;

  PERFORM set_config('app.bypass_profile_protection', 'on', true);

  IF FOUND THEN
    UPDATE public.profiles
    SET
      reddit_username = best_account.reddit_username,
      reddit_profile = best_account.reddit_profile,
      reddit_data = best_account.reddit_data,
      is_verified = best_account.is_verified,
      karma = best_account.karma,
      karma_range = best_account.karma_range,
      cqs = best_account.cqs,
      cqs_proof = best_account.cqs_proof,
      avatar_url = CASE
        WHEN COALESCE(trim(public.profiles.avatar_url), '') = '' THEN best_account.avatar_url
        ELSE public.profiles.avatar_url
      END,
      league = best_account.league
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

CREATE OR REPLACE FUNCTION public.handle_reddit_account_profile_sync()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.sync_profile_from_reddit_accounts(COALESCE(NEW.user_id, OLD.user_id));
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS sync_profile_from_reddit_accounts_on_write ON public.reddit_accounts;
CREATE TRIGGER sync_profile_from_reddit_accounts_on_write
  AFTER INSERT OR UPDATE OR DELETE ON public.reddit_accounts
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_reddit_account_profile_sync();

CREATE OR REPLACE FUNCTION public.backfill_legacy_my_reddit_account()
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  existing_account_id UUID;
  profile_row RECORD;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT id
  INTO existing_account_id
  FROM public.reddit_accounts
  WHERE user_id = current_user_id
  ORDER BY created_at ASC
  LIMIT 1;

  IF existing_account_id IS NOT NULL THEN
    RETURN existing_account_id;
  END IF;

  SELECT
    reddit_username,
    reddit_profile,
    reddit_data,
    is_verified,
    karma,
    karma_range,
    cqs,
    cqs_proof,
    avatar_url
  INTO profile_row
  FROM public.profiles
  WHERE user_id = current_user_id;

  IF profile_row.reddit_username IS NULL OR trim(profile_row.reddit_username) = '' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.reddit_accounts (
    user_id,
    reddit_username,
    reddit_profile,
    reddit_data,
    is_verified,
    karma,
    karma_range,
    cqs,
    cqs_proof,
    avatar_url
  )
  VALUES (
    current_user_id,
    lower(trim(profile_row.reddit_username)),
    profile_row.reddit_profile,
    profile_row.reddit_data,
    COALESCE(profile_row.is_verified, false),
    profile_row.karma,
    profile_row.karma_range,
    profile_row.cqs,
    profile_row.cqs_proof,
    profile_row.avatar_url
  )
  ON CONFLICT (user_id, reddit_username)
  DO UPDATE SET
    reddit_profile = EXCLUDED.reddit_profile,
    reddit_data = EXCLUDED.reddit_data,
    is_verified = EXCLUDED.is_verified,
    karma = EXCLUDED.karma,
    karma_range = EXCLUDED.karma_range,
    cqs = EXCLUDED.cqs,
    cqs_proof = EXCLUDED.cqs_proof,
    avatar_url = EXCLUDED.avatar_url
  RETURNING id INTO existing_account_id;

  RETURN existing_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_my_discord_identity(
  p_discord_user_id TEXT,
  p_discord_username TEXT DEFAULT NULL
)
RETURNS public.profiles
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  resolved_identity_id TEXT;
  updated_profile public.profiles%ROWTYPE;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF p_discord_user_id IS NULL OR trim(p_discord_user_id) = '' THEN
    RAISE EXCEPTION 'Discord identity is required.';
  END IF;

  SELECT COALESCE(
      NULLIF(trim(i.identity_data->>'id'), ''),
      NULLIF(trim(i.identity_data->>'user_id'), ''),
      NULLIF(trim(i.identity_data->>'sub'), '')
    )
  INTO resolved_identity_id
  FROM auth.identities i
  WHERE i.user_id = current_user_id
    AND i.provider = 'discord'
  ORDER BY i.created_at DESC NULLS LAST
  LIMIT 1;

  IF resolved_identity_id IS NULL OR resolved_identity_id <> trim(p_discord_user_id) THEN
    RAISE EXCEPTION 'Discord identity could not be validated.';
  END IF;

  PERFORM set_config('app.bypass_profile_protection', 'on', true);

  UPDATE public.profiles
  SET
    discord_user_id = trim(p_discord_user_id),
    discord_username = NULLIF(trim(COALESCE(p_discord_username, '')), '')
  WHERE user_id = current_user_id
  RETURNING * INTO updated_profile;

  RETURN updated_profile;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_task(
  p_task_id UUID,
  p_reddit_account_id UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  task_row public.tasks%ROWTYPE;
  account_row RECORD;
  latest_started_at TIMESTAMPTZ;
  cooldown_minutes INTEGER := 10;
  required_min_cqs_rank INTEGER;
  worker_cqs_rank INTEGER;
  resolved_league TEXT;
  payout_amount NUMERIC(10,2) := 0;
  assignment_id UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  SELECT *
  INTO task_row
  FROM public.tasks
  WHERE id = p_task_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found.';
  END IF;

  IF task_row.status <> 'pending' THEN
    RAISE EXCEPTION 'Task is no longer available.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND user_id = current_user_id
  ) THEN
    RAISE EXCEPTION 'You already attempted this task.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.task_assignments
    WHERE task_id = p_task_id
      AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'This task has already been claimed.';
  END IF;

  SELECT
    id,
    user_id,
    COALESCE(is_verified, false) AS is_verified,
    karma,
    karma_range,
    cqs
  INTO account_row
  FROM public.reddit_accounts
  WHERE id = p_reddit_account_id
    AND user_id = current_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected Reddit account was not found.';
  END IF;

  IF NOT account_row.is_verified THEN
    RAISE EXCEPTION 'Selected Reddit account is not verified.';
  END IF;

  IF COALESCE(task_row.minimum_karma, 0) > 0
    AND public.derive_karma_from_profile(account_row.karma, account_row.karma_range) < task_row.minimum_karma THEN
    RAISE EXCEPTION 'Selected Reddit account does not meet the minimum karma requirement.';
  END IF;

  required_min_cqs_rank := public.minimum_cqs_rank(task_row.cqs_levels);
  worker_cqs_rank := public.cqs_rank(account_row.cqs);

  IF required_min_cqs_rank IS NOT NULL
    AND (worker_cqs_rank IS NULL OR worker_cqs_rank < required_min_cqs_rank) THEN
    RAISE EXCEPTION 'Selected Reddit account does not meet the minimum CQS requirement.';
  END IF;

  SELECT claim_cooldown_minutes
  INTO cooldown_minutes
  FROM public.task_claim_settings
  LIMIT 1;

  cooldown_minutes := COALESCE(cooldown_minutes, 10);

  IF cooldown_minutes > 0 THEN
    SELECT MAX(started_at)
    INTO latest_started_at
    FROM public.task_assignments
    WHERE user_id = current_user_id
      AND started_at IS NOT NULL;

    IF latest_started_at IS NOT NULL
      AND latest_started_at + make_interval(mins => cooldown_minutes) > now() THEN
      RAISE EXCEPTION 'Claim cooldown active. Try again later.';
    END IF;
  END IF;

  resolved_league := public.derive_league(account_row.karma, account_row.karma_range, account_row.cqs);

  SELECT ttr.amount
  INTO payout_amount
  FROM public.task_type_rates ttr
  WHERE ttr.league = resolved_league
    AND ttr.task_type = task_row.task_type
  LIMIT 1;

  payout_amount := COALESCE(payout_amount, task_row.amount, 0);

  INSERT INTO public.task_assignments (
    task_id,
    user_id,
    reddit_account_id,
    amount,
    status,
    started_at
  )
  VALUES (
    p_task_id,
    current_user_id,
    p_reddit_account_id,
    payout_amount,
    'in_progress',
    now()
  )
  RETURNING id INTO assignment_id;

  RETURN assignment_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.submit_task_submission(
  p_task_id UUID,
  p_submission_links TEXT[],
  p_screenshot_urls TEXT[] DEFAULT NULL,
  p_submission_notes TEXT DEFAULT NULL
)
RETURNS TABLE (submission_id UUID, assignment_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  assignment_row public.task_assignments%ROWTYPE;
  screenshot_value TEXT;
  created_submission_id UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  IF COALESCE(array_length(p_submission_links, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one submission link is required.';
  END IF;

  SELECT *
  INTO assignment_row
  FROM public.task_assignments
  WHERE task_id = p_task_id
    AND user_id = current_user_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task assignment not found.';
  END IF;

  IF assignment_row.status NOT IN ('pending', 'in_progress') THEN
    RAISE EXCEPTION 'This task cannot be submitted in its current status.';
  END IF;

  FOREACH screenshot_value IN ARRAY COALESCE(p_screenshot_urls, ARRAY[]::TEXT[]) LOOP
    IF screenshot_value NOT LIKE 'task-submissions/' || p_task_id::TEXT || '/' || current_user_id::TEXT || '/%' THEN
      RAISE EXCEPTION 'Screenshot path is not valid for this task submission.';
    END IF;
  END LOOP;

  INSERT INTO public.task_submissions (
    task_id,
    user_id,
    reddit_account_id,
    submission_links,
    screenshot_urls,
    submission_notes,
    submitted_at,
    status
  )
  VALUES (
    p_task_id,
    current_user_id,
    assignment_row.reddit_account_id,
    p_submission_links,
    COALESCE(p_screenshot_urls, ARRAY[]::TEXT[]),
    NULLIF(trim(COALESCE(p_submission_notes, '')), ''),
    now(),
    'pending'
  )
  RETURNING id INTO created_submission_id;

  UPDATE public.task_assignments
  SET
    status = 'submitted',
    submitted_at = now()
  WHERE id = assignment_row.id;

  RETURN QUERY
  SELECT created_submission_id, assignment_row.id;
END;
$$;

CREATE OR REPLACE FUNCTION public.get_task_forecast_history(
  p_history_window_days INTEGER DEFAULT 45
)
RETURNS TABLE (created_at TIMESTAMPTZ, task_type TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  RETURN QUERY
  SELECT
    t.created_at,
    t.task_type::TEXT
  FROM public.tasks t
  WHERE t.created_at >= now() - make_interval(days => GREATEST(COALESCE(p_history_window_days, 45), 1))
  ORDER BY t.created_at ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.backfill_legacy_my_reddit_account() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_my_discord_identity(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_task(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.submit_task_submission(UUID, TEXT[], TEXT[], TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_task_forecast_history(INTEGER) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.backfill_legacy_my_reddit_account() TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_my_discord_identity(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_task(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.submit_task_submission(UUID, TEXT[], TEXT[], TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_task_forecast_history(INTEGER) TO authenticated;
