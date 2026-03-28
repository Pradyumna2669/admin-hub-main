-- Normalize user_roles to a single highest-priority role per user and
-- make get_user_role deterministic.

WITH ranked_roles AS (
  SELECT
    id,
    user_id,
    role,
    row_number() OVER (
      PARTITION BY user_id
      ORDER BY
        CASE role::text
          WHEN 'owner' THEN 1
          WHEN 'admin' THEN 2
          WHEN 'moderator' THEN 3
          WHEN 'worker' THEN 4
          ELSE 5
        END,
        created_at ASC,
        id ASC
    ) AS role_rank
  FROM public.user_roles
),
duplicate_roles AS (
  SELECT id
  FROM ranked_roles
  WHERE role_rank > 1
)
DELETE FROM public.user_roles
WHERE id IN (SELECT id FROM duplicate_roles);

CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_id_key
  ON public.user_roles (user_id);

CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  ORDER BY
    CASE role::text
      WHEN 'owner' THEN 1
      WHEN 'admin' THEN 2
      WHEN 'moderator' THEN 3
      WHEN 'worker' THEN 4
      ELSE 5
    END,
    created_at ASC,
    id ASC
  LIMIT 1
$$;
