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
  END IF;

  UPDATE public.tasks
  SET status = next_status
  WHERE id = target_task_id;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_duplicate_task_claims()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext(NEW.task_id::text));

  IF EXISTS (
    SELECT 1
    FROM public.task_assignments
    WHERE task_id = NEW.task_id
      AND id <> COALESCE(NEW.id, '00000000-0000-0000-0000-000000000000'::uuid)
      AND status <> 'cancelled'
  ) THEN
    RAISE EXCEPTION 'This task has already been claimed.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

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
  ELSE 'pending'::public.task_status
END;
