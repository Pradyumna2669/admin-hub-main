-- Add auth provider info to profiles so admin UI can display login method

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auth_provider TEXT;

-- Backfill existing rows (best-effort)
UPDATE public.profiles p
SET auth_provider = COALESCE(u.raw_app_meta_data->>'provider', 'email')
FROM auth.users u
WHERE u.id = p.user_id
  AND (p.auth_provider IS NULL OR p.auth_provider = '');

-- Update handle_new_user trigger function to store provider on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, full_name, auth_provider)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email')
  );

  IF EXISTS (SELECT 1 FROM public.initial_admins WHERE email = NEW.email) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin');
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'role', 'client'));
  END IF;

  RETURN NEW;
END;
$$;

