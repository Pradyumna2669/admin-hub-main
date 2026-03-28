-- Make signup trigger resilient to partial schema rollout so auth signup does not fail with 500s.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  provider_value TEXT := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
  role_value public.app_role := COALESCE(NEW.raw_user_meta_data->>'role', 'client')::public.app_role;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'auth_provider'
  ) THEN
    EXECUTE
      'INSERT INTO public.profiles (user_id, email, full_name, auth_provider)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id) DO NOTHING'
    USING NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), provider_value;
  ELSE
    INSERT INTO public.profiles (user_id, email, full_name)
    VALUES (NEW.id, NEW.email, COALESCE(NEW.raw_user_meta_data->>'full_name', ''))
    ON CONFLICT (user_id) DO NOTHING;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'users'
  ) THEN
    INSERT INTO public.users (id, credits)
    VALUES (NEW.id, 0)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF EXISTS (SELECT 1 FROM public.initial_admins WHERE email = NEW.email) THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'admin')
    ON CONFLICT (user_id) DO UPDATE SET role = 'admin';
  ELSE
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, role_value)
    ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role;
  END IF;

  RETURN NEW;
EXCEPTION
  WHEN invalid_text_representation THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (NEW.id, 'client')
    ON CONFLICT (user_id) DO UPDATE SET role = 'client';

    RETURN NEW;
END;
$$;
