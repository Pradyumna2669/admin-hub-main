-- Add removal compensation rates and track removal payouts on rejected verifications.

-- ------------------------------------------------------------
-- 1) task_type_rates: add removal_amount
-- ------------------------------------------------------------
ALTER TABLE public.task_type_rates
  ADD COLUMN IF NOT EXISTS removal_amount NUMERIC(10,2);

-- Backfill (best-effort): default removal rate = standard rate
UPDATE public.task_type_rates
SET removal_amount = amount
WHERE removal_amount IS NULL;

DO $$
BEGIN
  ALTER TABLE public.task_type_rates ALTER COLUMN removal_amount SET DEFAULT 0;
EXCEPTION WHEN others THEN
  NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.task_type_rates ALTER COLUMN removal_amount SET NOT NULL;
EXCEPTION WHEN others THEN
  NULL;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'task_type_rates_removal_amount_check'
  ) THEN
    ALTER TABLE public.task_type_rates
      ADD CONSTRAINT task_type_rates_removal_amount_check CHECK (removal_amount >= 0);
  END IF;
END $$;

-- Ensure rows exist (don’t override customized rates)
INSERT INTO public.task_type_rates (task_type, amount, removal_amount)
VALUES
  ('normal_comment', 5, 5),
  ('support_comment', 5, 5),
  ('linked_comments', 5, 5),
  ('non_linked_crosspost', 10, 10),
  ('linked_post_crosspost', 10, 10),
  ('non_linked_post', 10, 10),
  ('linked_post', 10, 10)
ON CONFLICT (task_type) DO NOTHING;

-- Update legacy seeded defaults to the new defaults (only when they match the old seed)
UPDATE public.task_type_rates
SET
  amount = 5,
  removal_amount = CASE WHEN removal_amount IN (0, 15) THEN 5 ELSE removal_amount END
WHERE task_type = 'normal_comment' AND amount = 15;

UPDATE public.task_type_rates
SET
  amount = 5,
  removal_amount = CASE WHEN removal_amount IN (0, 10) THEN 5 ELSE removal_amount END
WHERE task_type = 'support_comment' AND amount = 10;

UPDATE public.task_type_rates
SET
  amount = 5,
  removal_amount = CASE WHEN removal_amount IN (0, 20) THEN 5 ELSE removal_amount END
WHERE task_type = 'linked_comments' AND amount = 20;

UPDATE public.task_type_rates
SET
  amount = 10,
  removal_amount = CASE WHEN removal_amount IN (0, 20) THEN 10 ELSE removal_amount END
WHERE task_type = 'non_linked_crosspost' AND amount = 20;

UPDATE public.task_type_rates
SET
  amount = 10,
  removal_amount = CASE WHEN removal_amount IN (0, 40) THEN 10 ELSE removal_amount END
WHERE task_type = 'linked_post_crosspost' AND amount = 40;

UPDATE public.task_type_rates
SET
  amount = 10,
  removal_amount = CASE WHEN removal_amount IN (0, 30) THEN 10 ELSE removal_amount END
WHERE task_type = 'non_linked_post' AND amount = 30;

UPDATE public.task_type_rates
SET
  amount = 10,
  removal_amount = CASE WHEN removal_amount IN (0, 50) THEN 10 ELSE removal_amount END
WHERE task_type = 'linked_post' AND amount = 50;

-- ------------------------------------------------------------
-- 2) task_assignments: mark removal compensation payouts
-- ------------------------------------------------------------
ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS is_removal BOOLEAN NOT NULL DEFAULT false;

