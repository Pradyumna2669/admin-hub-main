-- Seed task type rates and migrate legacy task_type values.
-- This is intentionally separate from the enum ADD VALUE migration to avoid:
-- ERROR: unsafe use of new value ... of enum type task_type (SQLSTATE 55P04)

-- Migrate legacy task_type values to the new ones (safe if already migrated)
UPDATE public.tasks SET task_type = 'normal_comment' WHERE task_type = 'comment';
UPDATE public.tasks SET task_type = 'linked_comments' WHERE task_type = 'linked_comment';
UPDATE public.tasks SET task_type = 'non_linked_post' WHERE task_type = 'normal_post';

DO $$
BEGIN
  ALTER TABLE public.tasks ALTER COLUMN task_type SET DEFAULT 'normal_comment';
EXCEPTION WHEN others THEN
  NULL;
END $$;

INSERT INTO public.task_type_rates (task_type, amount)
VALUES
  ('normal_comment', 15),
  ('support_comment', 10),
  ('linked_comments', 20),
  ('non_linked_crosspost', 20),
  ('linked_post_crosspost', 40),
  ('non_linked_post', 30),
  ('linked_post', 50)
ON CONFLICT (task_type) DO NOTHING;

-- Backfill task amounts that are missing/zero using the configured rates
UPDATE public.tasks t
SET amount = r.amount
FROM public.task_type_rates r
WHERE t.task_type = r.task_type
  AND (t.amount IS NULL OR t.amount = 0);

