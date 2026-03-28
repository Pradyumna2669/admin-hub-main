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
  ) THEN
    RAISE EXCEPTION 'This task has already been claimed.'
      USING ERRCODE = '23505';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_duplicate_task_claims_on_insert ON public.task_assignments;
CREATE TRIGGER prevent_duplicate_task_claims_on_insert
  BEFORE INSERT ON public.task_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_task_claims();

DROP TRIGGER IF EXISTS prevent_duplicate_task_claims_on_update ON public.task_assignments;
CREATE TRIGGER prevent_duplicate_task_claims_on_update
  BEFORE UPDATE OF task_id ON public.task_assignments
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_duplicate_task_claims();
