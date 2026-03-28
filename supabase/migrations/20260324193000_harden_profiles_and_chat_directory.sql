-- Harden profile reads so authenticated users cannot dump all profiles directly.
-- Keep chat working through a narrow directory RPC that only exposes the fields
-- the chat UI actually needs.

DROP POLICY IF EXISTS "Authenticated users can view all profiles" ON public.profiles;

DROP FUNCTION IF EXISTS public.list_chat_directory();

CREATE OR REPLACE FUNCTION public.list_chat_directory()
RETURNS TABLE (
  user_id uuid,
  full_name text,
  reddit_username text,
  avatar_url text,
  role public.app_role,
  karma integer,
  karma_range text,
  cqs text,
  league text
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
    ur.role,
    p.karma,
    p.karma_range,
    p.cqs,
    p.league
  FROM public.profiles p
  LEFT JOIN LATERAL (
    SELECT r.role
    FROM public.user_roles r
    WHERE r.user_id = p.user_id
    ORDER BY
      CASE r.role::text
        WHEN 'owner' THEN 1
        WHEN 'admin' THEN 2
        WHEN 'moderator' THEN 3
        WHEN 'worker' THEN 4
        ELSE 5
      END
    LIMIT 1
  ) ur ON true
  WHERE auth.uid() IS NOT NULL
  ORDER BY COALESCE(NULLIF(p.full_name, ''), p.reddit_username, p.user_id::text);
$$;

REVOKE ALL ON FUNCTION public.list_chat_directory() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_chat_directory() TO authenticated;
