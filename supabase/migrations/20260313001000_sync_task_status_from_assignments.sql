CREATE OR REPLACE FUNCTION public.sync_task_status_from_assignments()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_task_id UUID := COALESCE(NEW.task_id, OLD.task_id);
  next_status public.task_status := 'pending';
BEGIN
  IF target_task_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.task_assignments
    WHERE task_id = target_task_id
      AND status IN ('pending', 'in_progress')
  ) OR EXISTS (
    SELECT 1
    FROM public.task_assignments
    WHERE task_id = target_task_id
      AND status::text = 'submitted'
  ) THEN
    next_status := 'in_progress';
  ELSIF EXISTS (
    SELECT 1
    FROM public.task_assignments
    WHERE task_id = target_task_id
      AND status = 'completed'
  ) THEN
    next_status := 'completed';
  ELSIF EXISTS (
    SELECT 1
    FROM public.task_assignments
    WHERE task_id = target_task_id
      AND status = 'cancelled'
  ) THEN
    next_status := 'cancelled';
  END IF;

  UPDATE public.tasks
  SET status = next_status
  WHERE id = target_task_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS sync_task_status_from_assignments_insert ON public.task_assignments;
CREATE TRIGGER sync_task_status_from_assignments_insert
  AFTER INSERT ON public.task_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_task_status_from_assignments();

DROP TRIGGER IF EXISTS sync_task_status_from_assignments_update ON public.task_assignments;
CREATE TRIGGER sync_task_status_from_assignments_update
  AFTER UPDATE OF status, task_id ON public.task_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_task_status_from_assignments();

DROP TRIGGER IF EXISTS sync_task_status_from_assignments_delete ON public.task_assignments;
CREATE TRIGGER sync_task_status_from_assignments_delete
  AFTER DELETE ON public.task_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_task_status_from_assignments();

UPDATE public.tasks t
SET status = CASE
  WHEN EXISTS (
    SELECT 1
    FROM public.task_assignments ta
    WHERE ta.task_id = t.id
      AND (
        ta.status IN ('pending', 'in_progress')
        OR ta.status::text = 'submitted'
      )
  ) THEN 'in_progress'::public.task_status
  WHEN EXISTS (
    SELECT 1
    FROM public.task_assignments ta
    WHERE ta.task_id = t.id
      AND ta.status = 'completed'
  ) THEN 'completed'::public.task_status
  WHEN EXISTS (
    SELECT 1
    FROM public.task_assignments ta
    WHERE ta.task_id = t.id
      AND ta.status = 'cancelled'
  ) THEN 'cancelled'::public.task_status
  ELSE 'pending'::public.task_status
END;
