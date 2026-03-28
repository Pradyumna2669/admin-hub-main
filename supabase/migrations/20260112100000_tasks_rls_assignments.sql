-- Allow clients to SELECT tasks if they have an assignment for the task
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Clients can view tasks for their assignments"
  ON public.tasks FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.task_assignments ta
      WHERE ta.task_id = public.tasks.id
        AND ta.user_id = auth.uid()
    )
  );
