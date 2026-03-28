CREATE TABLE IF NOT EXISTS public.task_claim_settings (
  id TEXT PRIMARY KEY,
  claim_cooldown_minutes INTEGER NOT NULL DEFAULT 10 CHECK (claim_cooldown_minutes >= 0),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.task_claim_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.task_claim_settings (id, claim_cooldown_minutes)
VALUES ('global', 10)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Authenticated can read task_claim_settings" ON public.task_claim_settings;
CREATE POLICY "Authenticated can read task_claim_settings"
  ON public.task_claim_settings FOR SELECT
  USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Admins and owners can manage task_claim_settings" ON public.task_claim_settings;
CREATE POLICY "Admins and owners can manage task_claim_settings"
  ON public.task_claim_settings FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'moderator')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR public.has_role(auth.uid(), 'moderator')
  );

DROP TRIGGER IF EXISTS update_task_claim_settings_updated_at ON public.task_claim_settings;
CREATE TRIGGER update_task_claim_settings_updated_at
  BEFORE UPDATE ON public.task_claim_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
