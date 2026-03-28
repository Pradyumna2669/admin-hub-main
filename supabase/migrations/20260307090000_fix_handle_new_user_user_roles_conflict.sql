-- Fix signup trigger: public.user_roles only has UNIQUE (user_id, role),
-- so ON CONFLICT (user_id) fails at runtime and breaks auth signup.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  provider_value TEXT := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
  requested_role TEXT := COALESCE(NEW.raw_user_meta_data->>'role', 'client');
  effective_role public.app_role := 'client';
BEGIN
  IF requested_role = 'worker' THEN
    effective_role := 'worker';
  ELSIF requested_role = 'admin' THEN
    effective_role := 'admin';
  ELSIF requested_role = 'owner' THEN
    effective_role := 'owner';
  ELSE
    effective_role := 'client';
  END IF;

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

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'initial_admins'
  ) AND EXISTS (
    SELECT 1
    FROM public.initial_admins
    WHERE email = NEW.email
  ) THEN
    effective_role := 'admin';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = NEW.id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, effective_role);

  RETURN NEW;
EXCEPTION
  WHEN undefined_table OR undefined_column THEN
    RETURN NEW;
END;
$$;
