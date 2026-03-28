ALTER TABLE public.categories
ADD COLUMN IF NOT EXISTS claim_cooldown_minutes INTEGER
CHECK (claim_cooldown_minutes IS NULL OR claim_cooldown_minutes >= 0);
