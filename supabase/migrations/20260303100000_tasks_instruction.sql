-- Add task instructions

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS instruction TEXT;

