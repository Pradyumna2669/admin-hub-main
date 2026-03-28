-- Provide a reliable way for admins/owners to see each user's auth provider.
-- Reads auth schema via SECURITY DEFINER and returns best provider per user.

CREATE OR REPLACE FUNCTION public.list_user_auth_providers()
RETURNS TABLE (user_id UUID, provider TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  RETURN QUERY
  SELECT
    u.id AS user_id,
    COALESCE(
      (SELECT MIN(i.provider) FROM auth.identities i WHERE i.user_id = u.id AND i.provider <> 'email'),
      (SELECT MIN(i.provider) FROM auth.identities i WHERE i.user_id = u.id),
      u.raw_app_meta_data->>'provider',
      u.raw_user_meta_data->>'provider',
      'email'
    ) AS provider
  FROM auth.users u;
END;
$$;

