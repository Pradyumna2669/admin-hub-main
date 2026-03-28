-- Create categories table
CREATE TABLE IF NOT EXISTS public.categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Create category_assignments table (assigns categories to clients)
CREATE TABLE IF NOT EXISTS public.category_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id UUID REFERENCES public.categories(id) ON DELETE CASCADE NOT NULL,
  client_user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  assigned_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE(category_id, client_user_id)
);

ALTER TABLE public.category_assignments ENABLE ROW LEVEL SECURITY;

-- Add category_id to tasks table if it doesn't exist
DO $$ BEGIN
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.categories(id) ON DELETE SET NULL;
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- Add amount column to tasks if it doesn't exist
DO $$ BEGIN
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS amount DECIMAL(10, 2) DEFAULT 0;
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- RLS Policies for categories
DROP POLICY IF EXISTS "Admins can create and manage categories" ON public.categories;
DROP POLICY IF EXISTS "Clients and workers can view assigned categories" ON public.categories;

CREATE POLICY "Admins can create and manage categories"
  ON public.categories FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients and workers can view assigned categories"
  ON public.categories FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.category_assignments ca
      WHERE ca.category_id = public.categories.id
        AND ca.client_user_id = auth.uid()
    )
  );

-- RLS Policies for category_assignments
DROP POLICY IF EXISTS "Admins can manage category assignments" ON public.category_assignments;
DROP POLICY IF EXISTS "Clients can view their category assignments" ON public.category_assignments;

CREATE POLICY "Admins can manage category assignments"
  ON public.category_assignments FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients can view their category assignments"
  ON public.category_assignments FOR SELECT
  USING (auth.uid() = client_user_id);

-- Update tasks RLS to consider categories
DROP POLICY IF EXISTS "Clients can view tasks for their assignments" ON public.tasks;
DROP POLICY IF EXISTS "Clients can SELECT tasks when they have an assignment for the task" ON public.tasks;
DROP POLICY IF EXISTS "Clients can view tasks in their categories" ON public.tasks;
DROP POLICY IF EXISTS "Admins can manage tasks" ON public.tasks;
DROP POLICY IF EXISTS "Workers can view tasks assigned to them" ON public.tasks;
DROP POLICY IF EXISTS "Workers can update their assignment status" ON public.tasks;

CREATE POLICY "Admins can manage all tasks"
  ON public.tasks FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients can view tasks in their categories"
  ON public.tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.category_assignments ca
      WHERE ca.category_id = public.tasks.category_id
        AND ca.client_user_id = auth.uid()
    )
  );

CREATE POLICY "Workers can view tasks assigned to them"
  ON public.tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.task_assignments ta
      WHERE ta.task_id = public.tasks.id
        AND ta.user_id = auth.uid()
    )
  );

CREATE POLICY "Workers can update their assignment status"
  ON public.tasks FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM public.task_assignments ta
      WHERE ta.task_id = public.tasks.id
        AND ta.user_id = auth.uid()
    )
  );
