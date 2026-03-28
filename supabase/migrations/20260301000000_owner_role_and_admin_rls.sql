-- Add 'owner' role and allow owner to use admin features via RLS

-- 1) Add 'owner' to app_role enum (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    WHERE t.typname = 'app_role'
      AND e.enumlabel = 'owner'
  ) THEN
    ALTER TYPE public.app_role ADD VALUE 'owner';
  END IF;
END$$;

-- 2) Update RLS policies to allow admin OR owner

-- profiles
DROP POLICY IF EXISTS "Admins can view all profiles" ON public.profiles;
DROP POLICY IF EXISTS "Admins and owners can view all profiles" ON public.profiles;
CREATE POLICY "Admins and owners can view all profiles"
  ON public.profiles FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

-- user_roles
DROP POLICY IF EXISTS "Admins can view all roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins and owners can view all roles" ON public.user_roles;
CREATE POLICY "Admins and owners can view all roles"
  ON public.user_roles FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

DROP POLICY IF EXISTS "Admins can manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "Admins and owners can manage roles" ON public.user_roles;
CREATE POLICY "Admins and owners can manage roles"
  ON public.user_roles FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

-- links
DROP POLICY IF EXISTS "Admins can manage links" ON public.links;
DROP POLICY IF EXISTS "Admins and owners can manage links" ON public.links;
CREATE POLICY "Admins and owners can manage links"
  ON public.links FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

-- categories
DROP POLICY IF EXISTS "Admins can create and manage categories" ON public.categories;
DROP POLICY IF EXISTS "Admins and owners can create and manage categories" ON public.categories;
CREATE POLICY "Admins and owners can create and manage categories"
  ON public.categories FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

-- category_assignments
DROP POLICY IF EXISTS "Admins can manage category assignments" ON public.category_assignments;
DROP POLICY IF EXISTS "Admins and owners can manage category assignments" ON public.category_assignments;
CREATE POLICY "Admins and owners can manage category assignments"
  ON public.category_assignments FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

-- tasks (multiple historical policy names)
DROP POLICY IF EXISTS "Admins can do everything with tasks" ON public.tasks;
DROP POLICY IF EXISTS "Admins can manage tasks" ON public.tasks;
DROP POLICY IF EXISTS "Admins can manage all tasks" ON public.tasks;
DROP POLICY IF EXISTS "Admins and owners can manage all tasks" ON public.tasks;
CREATE POLICY "Admins and owners can manage all tasks"
  ON public.tasks FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

-- task_items
DROP POLICY IF EXISTS "Admins can manage task_items" ON public.task_items;
DROP POLICY IF EXISTS "Admins and owners can manage task_items" ON public.task_items;
CREATE POLICY "Admins and owners can manage task_items"
  ON public.task_items FOR ALL
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

-- activity_logs
DROP POLICY IF EXISTS "Admins can view all logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Admins can view all activity logs" ON public.activity_logs;
DROP POLICY IF EXISTS "Admins and owners can view all activity logs" ON public.activity_logs;
CREATE POLICY "Admins and owners can view all activity logs"
  ON public.activity_logs FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
  );

-- messages: allow admins/owners to read messages (no STAFF_UUID concept)
DROP POLICY IF EXISTS "Admins can read staff-worker messages" ON public.messages;
DROP POLICY IF EXISTS "Admins and owners can read all messages" ON public.messages;
CREATE POLICY "Admins and owners can read all messages"
  ON public.messages FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'owner')
    OR auth.uid() = sender_id
    OR auth.uid() = receiver_id
  );
