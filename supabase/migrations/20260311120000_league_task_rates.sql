-- Add league-based rate tiers and worker league tagging.

-- ------------------------------------------------------------
-- Profiles: add league tag
-- ------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS league TEXT;

-- Best-effort backfill for existing workers
UPDATE public.profiles
SET league = CASE
  WHEN (cqs ILIKE 'high' OR cqs ILIKE 'highest') THEN
    CASE
      WHEN karma >= 50000 THEN 'diamond'
      WHEN karma >= 25000 THEN 'diamond'
      WHEN karma >= 5000 THEN 'platinum'
      WHEN karma >= 1000 THEN 'gold'
      WHEN karma >= 200 THEN 'silver'
      ELSE 'bronze'
    END
  ELSE
    CASE
      WHEN karma >= 50000 THEN 'diamond'
      WHEN karma >= 25000 THEN 'platinum'
      WHEN karma >= 5000 THEN 'gold'
      WHEN karma >= 1000 THEN 'silver'
      ELSE 'bronze'
    END
END
WHERE league IS NULL AND karma IS NOT NULL;

-- ------------------------------------------------------------
-- Task type rates: add league column + composite primary key
-- ------------------------------------------------------------
ALTER TABLE public.task_type_rates
  ADD COLUMN IF NOT EXISTS league TEXT;

UPDATE public.task_type_rates
SET league = 'bronze'
WHERE league IS NULL;

DO $$
BEGIN
  ALTER TABLE public.task_type_rates ALTER COLUMN league SET DEFAULT 'bronze';
EXCEPTION WHEN others THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.task_type_rates ALTER COLUMN league SET NOT NULL;
EXCEPTION WHEN others THEN
  NULL;
END $$;

ALTER TABLE public.task_type_rates DROP CONSTRAINT IF EXISTS task_type_rates_pkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'task_type_rates_pkey'
  ) THEN
    ALTER TABLE public.task_type_rates ADD PRIMARY KEY (league, task_type);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'task_type_rates_league_check'
  ) THEN
    ALTER TABLE public.task_type_rates
      ADD CONSTRAINT task_type_rates_league_check
      CHECK (league IN ('bronze', 'silver', 'gold', 'platinum', 'diamond'));
  END IF;
END $$;

-- Refresh bronze defaults if old seed values were still present
UPDATE public.task_type_rates
SET amount = CASE task_type
  WHEN 'support_comment' THEN 10
  WHEN 'normal_comment' THEN 15
  WHEN 'linked_comments' THEN 20
  WHEN 'non_linked_crosspost' THEN 30
  WHEN 'linked_post_crosspost' THEN 30
  WHEN 'non_linked_post' THEN 40
  WHEN 'linked_post' THEN 50
  ELSE amount
END
WHERE league = 'bronze' AND amount IN (5, 10);

UPDATE public.task_type_rates
SET removal_amount = CASE task_type
  WHEN 'support_comment' THEN 5
  WHEN 'normal_comment' THEN 5
  WHEN 'linked_comments' THEN 5
  WHEN 'non_linked_crosspost' THEN 10
  WHEN 'linked_post_crosspost' THEN 10
  WHEN 'non_linked_post' THEN 10
  WHEN 'linked_post' THEN 10
  ELSE removal_amount
END
WHERE league = 'bronze' AND removal_amount IN (0, 5, 10);

-- Seed per-league rates (do not override custom values)
INSERT INTO public.task_type_rates (league, task_type, amount, removal_amount)
VALUES
  -- Bronze
  ('bronze', 'support_comment', 10, 5),
  ('bronze', 'normal_comment', 15, 5),
  ('bronze', 'linked_comments', 20, 5),
  ('bronze', 'non_linked_crosspost', 30, 10),
  ('bronze', 'linked_post_crosspost', 30, 10),
  ('bronze', 'non_linked_post', 40, 10),
  ('bronze', 'linked_post', 50, 10),
  -- Silver
  ('silver', 'support_comment', 15, 5),
  ('silver', 'normal_comment', 20, 5),
  ('silver', 'linked_comments', 25, 5),
  ('silver', 'non_linked_crosspost', 30, 10),
  ('silver', 'linked_post_crosspost', 30, 10),
  ('silver', 'non_linked_post', 50, 10),
  ('silver', 'linked_post', 70, 10),
  -- Gold
  ('gold', 'support_comment', 15, 5),
  ('gold', 'normal_comment', 20, 10),
  ('gold', 'linked_comments', 25, 10),
  ('gold', 'non_linked_crosspost', 35, 15),
  ('gold', 'linked_post_crosspost', 35, 15),
  ('gold', 'non_linked_post', 60, 20),
  ('gold', 'linked_post', 80, 20),
  -- Platinum
  ('platinum', 'support_comment', 18, 8),
  ('platinum', 'normal_comment', 25, 15),
  ('platinum', 'linked_comments', 30, 15),
  ('platinum', 'non_linked_crosspost', 40, 15),
  ('platinum', 'linked_post_crosspost', 40, 15),
  ('platinum', 'non_linked_post', 100, 20),
  ('platinum', 'linked_post', 150, 25),
  -- Diamond
  ('diamond', 'support_comment', 20, 10),
  ('diamond', 'normal_comment', 30, 15),
  ('diamond', 'linked_comments', 35, 15),
  ('diamond', 'non_linked_crosspost', 50, 20),
  ('diamond', 'linked_post_crosspost', 50, 20),
  ('diamond', 'non_linked_post', 150, 30),
  ('diamond', 'linked_post', 200, 40)
ON CONFLICT (league, task_type) DO NOTHING;

-- ------------------------------------------------------------
-- Policies: allow workers to read, admins/owners to manage
-- ------------------------------------------------------------
ALTER TABLE public.task_type_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins and owners can manage task_type_rates" ON public.task_type_rates;
DROP POLICY IF EXISTS "Authenticated can read task_type_rates" ON public.task_type_rates;

CREATE POLICY "Authenticated can read task_type_rates"
  ON public.task_type_rates FOR SELECT
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and owners can manage task_type_rates"
  ON public.task_type_rates FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );
