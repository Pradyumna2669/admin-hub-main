-- Shared wallet for arcade + referral credits, plus worker withdrawal requests.

CREATE TABLE IF NOT EXISTS public.credit_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id = TRUE),
  credits_per_inr INTEGER NOT NULL DEFAULT 10 CHECK (credits_per_inr > 0),
  referral_reward_credits INTEGER NOT NULL DEFAULT 200 CHECK (referral_reward_credits > 0),
  min_withdrawal_credits INTEGER NOT NULL DEFAULT 100 CHECK (min_withdrawal_credits > 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

INSERT INTO public.credit_settings (id, credits_per_inr, referral_reward_credits, min_withdrawal_credits)
VALUES (TRUE, 10, 200, 100)
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.credit_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can view credit settings" ON public.credit_settings;
CREATE POLICY "Authenticated users can view credit settings"
  ON public.credit_settings
  FOR SELECT
  TO authenticated
  USING (TRUE);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.assign_referral_code()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.referral_code IS NULL OR btrim(NEW.referral_code) = '' THEN
    NEW.referral_code := 'TASK' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));
  ELSE
    NEW.referral_code := upper(regexp_replace(NEW.referral_code, '[^a-zA-Z0-9]', '', 'g'));
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS assign_referral_code_on_wallet_user ON public.users;
CREATE TRIGGER assign_referral_code_on_wallet_user
  BEFORE INSERT OR UPDATE OF referral_code ON public.users
  FOR EACH ROW
  EXECUTE FUNCTION public.assign_referral_code();

UPDATE public.users
SET referral_code = 'TASK' || upper(substr(replace(id::text, '-', ''), 1, 8))
WHERE referral_code IS NULL OR btrim(referral_code) = '';

CREATE UNIQUE INDEX IF NOT EXISTS users_referral_code_unique_idx
  ON public.users (referral_code);

CREATE INDEX IF NOT EXISTS users_referred_by_user_id_idx
  ON public.users (referred_by_user_id);

CREATE TABLE IF NOT EXISTS public.referral_rewards (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  referred_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  first_task_id UUID REFERENCES public.tasks(id) ON DELETE SET NULL,
  reward_credits INTEGER NOT NULL CHECK (reward_credits > 0),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS referral_rewards_referred_user_unique_idx
  ON public.referral_rewards (referred_user_id);

CREATE INDEX IF NOT EXISTS referral_rewards_referrer_created_idx
  ON public.referral_rewards (referrer_user_id, created_at DESC);

ALTER TABLE public.referral_rewards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their referral rewards" ON public.referral_rewards;
CREATE POLICY "Users can view their referral rewards"
  ON public.referral_rewards
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = referrer_user_id
    OR auth.uid() = referred_user_id
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'moderator')
  );

CREATE TABLE IF NOT EXISTS public.withdrawal_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credits_requested INTEGER NOT NULL CHECK (credits_requested > 0),
  inr_amount NUMERIC(10, 2) NOT NULL CHECK (inr_amount > 0),
  upi_id TEXT,
  notes TEXT,
  admin_notes TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'paid', 'rejected', 'cancelled')),
  processed_at TIMESTAMP WITH TIME ZONE,
  processed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS withdrawal_requests_user_created_idx
  ON public.withdrawal_requests (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS withdrawal_requests_status_created_idx
  ON public.withdrawal_requests (status, created_at DESC);

ALTER TABLE public.withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view their withdrawal requests" ON public.withdrawal_requests;
CREATE POLICY "Users can view their withdrawal requests"
  ON public.withdrawal_requests
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'moderator')
  );

DROP POLICY IF EXISTS "Staff can update withdrawal requests" ON public.withdrawal_requests;
CREATE POLICY "Staff can update withdrawal requests"
  ON public.withdrawal_requests
  FOR UPDATE
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'moderator')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'moderator')
  );

CREATE OR REPLACE FUNCTION public.get_referral_owner(p_code TEXT)
RETURNS TABLE (
  user_id UUID,
  referral_code TEXT,
  full_name TEXT,
  reddit_username TEXT,
  email TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  normalized_code TEXT;
BEGIN
  normalized_code := upper(regexp_replace(COALESCE(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));

  IF normalized_code = '' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    u.referral_code,
    p.full_name,
    p.reddit_username,
    p.email
  FROM public.users u
  LEFT JOIN public.profiles p
    ON p.user_id = u.id
  WHERE u.referral_code = normalized_code
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.get_referral_owner(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_referral_owner(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_referral_code(p_code TEXT)
RETURNS TABLE (
  referrer_user_id UUID,
  referral_code TEXT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  normalized_code TEXT;
  target_referrer_id UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to apply a referral code.';
  END IF;

  normalized_code := upper(regexp_replace(COALESCE(p_code, ''), '[^a-zA-Z0-9]', '', 'g'));

  IF normalized_code = '' THEN
    RAISE EXCEPTION 'Referral code is required.';
  END IF;

  SELECT u.id
  INTO target_referrer_id
  FROM public.users u
  WHERE u.referral_code = normalized_code;

  IF target_referrer_id IS NULL THEN
    RAISE EXCEPTION 'Referral code was not found.';
  END IF;

  IF target_referrer_id = current_user_id THEN
    RAISE EXCEPTION 'You cannot use your own referral code.';
  END IF;

  UPDATE public.users
  SET referred_by_user_id = target_referrer_id,
      updated_at = now()
  WHERE id = current_user_id
    AND referred_by_user_id IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'A referral code has already been used for this account.';
  END IF;

  RETURN QUERY
  SELECT target_referrer_id, normalized_code;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_referral_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_referral_joiners()
RETURNS TABLE (
  referred_user_id UUID,
  full_name TEXT,
  reddit_username TEXT,
  email TEXT,
  joined_at TIMESTAMP WITH TIME ZONE,
  completed_tasks INTEGER,
  reward_credited BOOLEAN,
  reward_credits INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to view referrals.';
  END IF;

  RETURN QUERY
  SELECT
    u.id,
    p.full_name,
    p.reddit_username,
    p.email,
    u.created_at,
    COALESCE(task_counts.completed_tasks, 0)::INTEGER,
    (rr.id IS NOT NULL) AS reward_credited,
    COALESCE(rr.reward_credits, 0)::INTEGER
  FROM public.users u
  LEFT JOIN public.profiles p
    ON p.user_id = u.id
  LEFT JOIN LATERAL (
    SELECT count(*) AS completed_tasks
    FROM public.task_assignments ta
    WHERE ta.user_id = u.id
      AND ta.status = 'completed'
  ) task_counts ON TRUE
  LEFT JOIN public.referral_rewards rr
    ON rr.referred_user_id = u.id
  WHERE u.referred_by_user_id = current_user_id
  ORDER BY u.created_at DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_referral_joiners() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_my_referral_joiners() TO authenticated;

CREATE OR REPLACE FUNCTION public.award_referral_for_first_completed_task(p_referred_user_id UUID, p_first_task_id UUID DEFAULT NULL)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  reward_credits_value INTEGER;
  referrer_id UUID;
  completed_count INTEGER;
BEGIN
  IF p_referred_user_id IS NULL THEN
    RETURN 0;
  END IF;

  SELECT u.referred_by_user_id
  INTO referrer_id
  FROM public.users u
  WHERE u.id = p_referred_user_id;

  IF referrer_id IS NULL THEN
    RETURN 0;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.referral_rewards rr
    WHERE rr.referred_user_id = p_referred_user_id
  ) THEN
    RETURN 0;
  END IF;

  SELECT count(*)
  INTO completed_count
  FROM public.task_assignments ta
  WHERE ta.user_id = p_referred_user_id
    AND ta.status = 'completed';

  IF completed_count <> 1 THEN
    RETURN 0;
  END IF;

  SELECT cs.referral_reward_credits
  INTO reward_credits_value
  FROM public.credit_settings cs
  WHERE cs.id = TRUE;

  reward_credits_value := COALESCE(reward_credits_value, 200);

  INSERT INTO public.referral_rewards (
    referrer_user_id,
    referred_user_id,
    first_task_id,
    reward_credits
  )
  VALUES (
    referrer_id,
    p_referred_user_id,
    p_first_task_id,
    reward_credits_value
  )
  ON CONFLICT (referred_user_id) DO NOTHING;

  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  UPDATE public.users
  SET credits = credits + reward_credits_value,
      updated_at = now()
  WHERE id = referrer_id;

  RETURN reward_credits_value;
END;
$$;

REVOKE ALL ON FUNCTION public.award_referral_for_first_completed_task(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.award_referral_for_first_completed_task(UUID, UUID) TO service_role;

CREATE OR REPLACE FUNCTION public.handle_first_completed_task_referral()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND COALESCE(OLD.status, '') <> 'completed' THEN
    PERFORM public.award_referral_for_first_completed_task(NEW.user_id, NEW.task_id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS award_referral_on_first_completed_task ON public.task_assignments;
CREATE TRIGGER award_referral_on_first_completed_task
  AFTER UPDATE OF status ON public.task_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_first_completed_task_referral();

CREATE OR REPLACE FUNCTION public.create_wallet_withdrawal_request(
  p_credits INTEGER,
  p_notes TEXT DEFAULT NULL
)
RETURNS TABLE (
  request_id UUID,
  credits_requested INTEGER,
  inr_amount NUMERIC,
  remaining_credits INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  current_upi_id TEXT;
  credits_per_inr_value INTEGER;
  min_withdrawal_value INTEGER;
  new_balance INTEGER;
  computed_inr NUMERIC(10, 2);
  created_request_id UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'You must be signed in to request a withdrawal.';
  END IF;

  IF p_credits IS NULL OR p_credits <= 0 THEN
    RAISE EXCEPTION 'Withdrawal credits must be greater than zero.';
  END IF;

  SELECT cs.credits_per_inr, cs.min_withdrawal_credits
  INTO credits_per_inr_value, min_withdrawal_value
  FROM public.credit_settings cs
  WHERE cs.id = TRUE;

  credits_per_inr_value := COALESCE(credits_per_inr_value, 10);
  min_withdrawal_value := COALESCE(min_withdrawal_value, credits_per_inr_value);

  IF p_credits < min_withdrawal_value THEN
    RAISE EXCEPTION 'Minimum withdrawal is % credits.', min_withdrawal_value;
  END IF;

  SELECT p.upi_id
  INTO current_upi_id
  FROM public.profiles p
  WHERE p.user_id = current_user_id;

  IF current_upi_id IS NULL OR btrim(current_upi_id) = '' THEN
    RAISE EXCEPTION 'Add your UPI ID in profile before requesting withdrawal.';
  END IF;

  UPDATE public.users
  SET credits = credits - p_credits,
      updated_at = now()
  WHERE id = current_user_id
    AND credits >= p_credits
  RETURNING credits INTO new_balance;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'You do not have enough credits for this withdrawal.';
  END IF;

  computed_inr := round((p_credits::numeric / credits_per_inr_value::numeric), 2);

  INSERT INTO public.withdrawal_requests (
    user_id,
    credits_requested,
    inr_amount,
    upi_id,
    notes
  )
  VALUES (
    current_user_id,
    p_credits,
    computed_inr,
    current_upi_id,
    NULLIF(btrim(COALESCE(p_notes, '')), '')
  )
  RETURNING id INTO created_request_id;

  RETURN QUERY
  SELECT created_request_id, p_credits, computed_inr, new_balance;
END;
$$;

REVOKE ALL ON FUNCTION public.create_wallet_withdrawal_request(INTEGER, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_wallet_withdrawal_request(INTEGER, TEXT) TO authenticated;

DROP TRIGGER IF EXISTS update_credit_settings_updated_at ON public.credit_settings;
CREATE TRIGGER update_credit_settings_updated_at
  BEFORE UPDATE ON public.credit_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_withdrawal_requests_updated_at ON public.withdrawal_requests;
CREATE TRIGGER update_withdrawal_requests_updated_at
  BEFORE UPDATE ON public.withdrawal_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
