-- Add reddit fields to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reddit_username TEXT,
  ADD COLUMN IF NOT EXISTS reddit_data JSONB;

-- Create payment status enum
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'payment_status') THEN
    CREATE TYPE public.payment_status AS ENUM ('pending', 'processing', 'paid', 'failed', 'cancelled');
  END IF;
END$$;

-- Create task_items table to represent sub-items of a task
CREATE TABLE IF NOT EXISTS public.task_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  target_link TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.task_items ENABLE ROW LEVEL SECURITY;

-- Create task_assignments table to assign tasks to users with payment info
CREATE TABLE IF NOT EXISTS public.task_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id UUID REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  amount NUMERIC(10,2) DEFAULT 0,
  payment_status payment_status NOT NULL DEFAULT 'pending',
  status public.task_status NOT NULL DEFAULT 'pending',
  submitted_at TIMESTAMP WITH TIME ZONE,
  submitted_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

ALTER TABLE public.task_assignments ENABLE ROW LEVEL SECURITY;

-- Simple RLS policy so admins can manage assignments and clients can view their own
CREATE POLICY "Admins can manage assignments"
  ON public.task_assignments FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Clients can view their assignments"
  ON public.task_assignments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Clients can update their assignment status"
  ON public.task_assignments FOR UPDATE
  USING (auth.uid() = user_id);
