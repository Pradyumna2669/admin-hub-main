ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS whatsapp_phone_e164 TEXT,
  ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS whatsapp_last_verified_at TIMESTAMP WITH TIME ZONE;

CREATE UNIQUE INDEX IF NOT EXISTS profiles_whatsapp_phone_e164_unique_idx
  ON public.profiles (whatsapp_phone_e164)
  WHERE whatsapp_phone_e164 IS NOT NULL;

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS public_order_code TEXT;

UPDATE public.tasks
SET public_order_code = 'ORD-' || upper(substr(md5(id::text), 1, 8))
WHERE public_order_code IS NULL;

ALTER TABLE public.tasks
  ALTER COLUMN public_order_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS tasks_public_order_code_unique_idx
  ON public.tasks (public_order_code);
