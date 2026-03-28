-- Add task_completion_time to tasks table
DO $$ BEGIN
  ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS task_completion_time INTEGER DEFAULT 60;
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- Create activity_logs table if it doesn't exist
DO $$ BEGIN
  CREATE TABLE IF NOT EXISTS public.activity_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id UUID,
    details JSONB,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
  );
EXCEPTION WHEN others THEN
  NULL;
END $$;

-- Enable RLS on activity_logs
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policy: Admins can view all activity logs
DROP POLICY IF EXISTS "Admins can view all activity logs" ON public.activity_logs;
CREATE POLICY "Admins can view all activity logs"
  ON public.activity_logs FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policy: Users can view their own activity logs
DROP POLICY IF EXISTS "Users can view their own activity logs" ON public.activity_logs;
CREATE POLICY "Users can view their own activity logs"
  ON public.activity_logs FOR SELECT
  USING (auth.uid() = user_id);

-- RLS Policy: Anyone can insert activity logs
DROP POLICY IF EXISTS "Anyone can insert activity logs" ON public.activity_logs;
CREATE POLICY "Anyone can insert activity logs"
  ON public.activity_logs FOR INSERT
  WITH CHECK (true);

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id ON public.activity_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity ON public.activity_logs(entity_type, entity_id);
