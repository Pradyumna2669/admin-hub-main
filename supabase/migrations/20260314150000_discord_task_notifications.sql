ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS discord_message_id TEXT;

ALTER TABLE public.task_assignments
  ADD COLUMN IF NOT EXISTS discord_claim_notified_at TIMESTAMP WITH TIME ZONE;
