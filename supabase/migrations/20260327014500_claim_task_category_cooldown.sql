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
  category_cooldown_minutes INTEGER;
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

  SELECT c.claim_cooldown_minutes
  INTO category_cooldown_minutes
  FROM public.categories c
  WHERE c.id = task_row.category_id;

  SELECT claim_cooldown_minutes
  INTO cooldown_minutes
  FROM public.task_claim_settings
  LIMIT 1;

  cooldown_minutes := COALESCE(category_cooldown_minutes, cooldown_minutes, 10);

  IF cooldown_minutes > 0 THEN
    SELECT MAX(ta.started_at)
    INTO latest_started_at
    FROM public.task_assignments ta
    JOIN public.tasks t
      ON t.id = ta.task_id
    WHERE ta.user_id = current_user_id
      AND t.category_id IS NOT DISTINCT FROM task_row.category_id
      AND ta.started_at IS NOT NULL;

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
