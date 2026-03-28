-- Allow admins to manage task_items
ALTER TABLE public.task_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage task_items"
  ON public.task_items FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- Allow clients to view task_items for tasks assigned to them
CREATE POLICY "Clients can view task_items for their assignments"
  ON public.task_items FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.task_assignments ta
      WHERE ta.task_id = public.task_items.task_id
        AND ta.user_id = auth.uid()
    )
  );
