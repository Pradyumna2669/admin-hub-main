-- Chat directory RPC
-- Exposes only safe member fields for chat UIs without opening full profiles to all users.

CREATE OR REPLACE FUNCTION public.list_chat_directory()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  reddit_username text,
  avatar_url text,
  role public.app_role
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p.user_id,
    p.full_name,
    p.reddit_username,
    p.avatar_url,
    ur.role
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT r.role
    FROM public.user_roles r
    WHERE r.user_id = p.user_id
    ORDER BY
      CASE r.role
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'worker' THEN 3
        ELSE 4
      END
    LIMIT 1
  ) ur ON true
  WHERE auth.uid() IS NOT NULL
  ORDER BY COALESCE(NULLIF(p.full_name, ''), p.reddit_username, p.email);
$$;

GRANT EXECUTE ON FUNCTION public.list_chat_directory() TO authenticated;
