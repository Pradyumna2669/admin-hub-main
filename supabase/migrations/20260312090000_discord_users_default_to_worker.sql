-- Ensure Discord-authenticated public users enter the tasker flow.
-- Existing Discord users that were created with the fallback `client` role
-- are promoted to `worker`, and future Discord signups default to `worker`
-- unless an explicit staff role is requested.

UPDATE public.user_roles AS ur
SET role = 'worker'
WHERE ur.role = 'client'
  AND EXISTS (
    SELECT 1
    FROM public.profiles AS p
    WHERE p.user_id = ur.user_id
      AND lower(COALESCE(p.auth_provider, '')) = 'discord'
  );

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  provider_value TEXT := COALESCE(NEW.raw_app_meta_data->>'provider', 'email');
  requested_role TEXT := NEW.raw_user_meta_data->>'role';
  effective_role public.app_role := 'client';
BEGIN
  IF provider_value = 'discord' AND (requested_role IS NULL OR requested_role = '') THEN
    effective_role := 'worker';
  ELSIF requested_role = 'worker' THEN
    effective_role := 'worker';
  ELSIF requested_role = 'admin' THEN
    effective_role := 'admin';
  ELSIF requested_role = 'owner' THEN
    effective_role := 'owner';
  ELSIF requested_role = 'moderator' THEN
    effective_role := 'moderator';
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
