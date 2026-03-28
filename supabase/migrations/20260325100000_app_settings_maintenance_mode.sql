CREATE TABLE IF NOT EXISTS public.app_settings (
  id TEXT PRIMARY KEY,
  maintenance_mode BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

INSERT INTO public.app_settings (id, maintenance_mode)
VALUES ('global', false)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public can read app_settings" ON public.app_settings;
CREATE POLICY "Public can read app_settings"
  ON public.app_settings FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Admins and owners can manage app_settings" ON public.app_settings;
CREATE POLICY "Admins and owners can manage app_settings"
  ON public.app_settings FOR ALL
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

DROP TRIGGER IF EXISTS update_app_settings_updated_at ON public.app_settings;
CREATE TRIGGER update_app_settings_updated_at
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
