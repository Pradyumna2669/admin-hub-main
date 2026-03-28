-- Preserve manually assigned roles during auth bootstrap.
-- Previously ensure_user_bootstrap() deleted user_roles on each login/session
-- and rebuilt the role from auth metadata / initial_admins, which downgraded
-- manually assigned owners back to admin.

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
  existing_role public.app_role;
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

  SELECT public.get_user_role(p_user_id)
  INTO existing_role;

  IF existing_role IS NULL THEN
    INSERT INTO public.user_roles (user_id, role)
    VALUES (p_user_id, effective_role)
    ON CONFLICT (user_id) DO NOTHING;
  END IF;
END;
$$;
