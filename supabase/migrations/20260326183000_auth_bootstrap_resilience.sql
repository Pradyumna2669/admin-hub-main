-- Make auth bootstrap best-effort during signup and provide a self-healing
-- authenticated RPC so profile/role rows can be repaired on first session.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now();

CREATE OR REPLACE FUNCTION public.ensure_user_bootstrap(
  p_user_id UUID,
  p_email TEXT,
  p_full_name TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT 'email',
  p_requested_role TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  provider_value TEXT := lower(trim(COALESCE(p_provider, 'email')));
  requested_role TEXT := lower(trim(COALESCE(p_requested_role, '')));
  effective_role public.app_role := 'client';
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'User id is required.';
  END IF;

  IF p_email IS NULL OR trim(p_email) = '' THEN
    RAISE EXCEPTION 'Email is required.';
  END IF;

  IF provider_value = 'discord' AND requested_role = '' THEN
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
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'initial_admins'
  ) AND EXISTS (
    SELECT 1
    FROM public.initial_admins
    WHERE email = p_email
  ) THEN
    effective_role := 'admin';
  END IF;

  INSERT INTO public.profiles (
    user_id,
    email,
    full_name,
    auth_provider,
    created_at,
    updated_at
  )
  VALUES (
    p_user_id,
    lower(trim(p_email)),
    NULLIF(trim(COALESCE(p_full_name, '')), ''),
    NULLIF(provider_value, ''),
    now(),
    now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    email = EXCLUDED.email,
    full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
    auth_provider = COALESCE(EXCLUDED.auth_provider, public.profiles.auth_provider),
    updated_at = now();

  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'users'
  ) THEN
    INSERT INTO public.users (id, credits, created_at, updated_at)
    VALUES (p_user_id, 0, now(), now())
    ON CONFLICT (id) DO NOTHING;
  END IF;

  DELETE FROM public.user_roles WHERE user_id = p_user_id;

  INSERT INTO public.user_roles (user_id, role)
  VALUES (p_user_id, effective_role);
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_my_user_bootstrap(
  p_email TEXT,
  p_full_name TEXT DEFAULT NULL,
  p_provider TEXT DEFAULT 'email',
  p_requested_role TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
BEGIN
  IF current_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated.';
  END IF;

  PERFORM public.ensure_user_bootstrap(
    current_user_id,
    p_email,
    p_full_name,
    p_provider,
    p_requested_role
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_bootstrap(UUID, TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_my_user_bootstrap(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_user_bootstrap(UUID, TEXT, TEXT, TEXT, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.ensure_my_user_bootstrap(TEXT, TEXT, TEXT, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.ensure_user_bootstrap(
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_app_meta_data->>'provider', 'email'),
    NEW.raw_user_meta_data->>'role'
  );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_profile_auth_provider_from_identity()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET
    auth_provider = NEW.provider,
    updated_at = now()
  WHERE user_id = NEW.user_id
    AND (
      auth_provider IS NULL
      OR auth_provider = ''
      OR auth_provider = 'email'
      OR auth_provider <> NEW.provider
    );

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NEW;
END;
$$;
