CREATE OR REPLACE FUNCTION public.handle_first_completed_task_referral()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed' THEN
    PERFORM public.award_referral_for_first_completed_task(NEW.user_id, NEW.task_id);
  END IF;

  RETURN NEW;
END;
$$;
