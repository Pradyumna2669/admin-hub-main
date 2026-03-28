DROP POLICY IF EXISTS "Workers can delete their own in-progress assignments" ON public.task_assignments;
CREATE POLICY "Workers can delete their own in-progress assignments"
  ON public.task_assignments FOR DELETE
  USING (
    auth.uid() = user_id
    AND status IN ('pending', 'in_progress')
  );
