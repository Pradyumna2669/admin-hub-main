CREATE TABLE IF NOT EXISTS public.active_user_sessions (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  issued_at bigint NOT NULL,
  device_label text,
  seen_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

ALTER TABLE public.active_user_sessions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own active session" ON public.active_user_sessions;
CREATE POLICY "Users can view own active session"
  ON public.active_user_sessions
  FOR SELECT
  USING (auth.uid() = user_id);

DROP TRIGGER IF EXISTS update_active_user_sessions_updated_at ON public.active_user_sessions;
CREATE TRIGGER update_active_user_sessions_updated_at
  BEFORE UPDATE ON public.active_user_sessions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE FUNCTION public.claim_active_session(
  p_session_id text,
  p_issued_at bigint,
  p_device_label text DEFAULT NULL
)
RETURNS public.active_user_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  claimed_session public.active_user_sessions;
BEGIN
  INSERT INTO public.active_user_sessions (user_id, session_id, issued_at, device_label, seen_at)
  VALUES (auth.uid(), p_session_id, p_issued_at, p_device_label, now())
  ON CONFLICT (user_id) DO UPDATE
  SET
    session_id = EXCLUDED.session_id,
    issued_at = EXCLUDED.issued_at,
    device_label = EXCLUDED.device_label,
    seen_at = now()
  WHERE public.active_user_sessions.issued_at <= EXCLUDED.issued_at
  RETURNING * INTO claimed_session;

  IF claimed_session.user_id IS NULL THEN
    SELECT *
    INTO claimed_session
    FROM public.active_user_sessions
    WHERE user_id = auth.uid();
  END IF;

  RETURN claimed_session;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_active_session(p_session_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.active_user_sessions
  WHERE user_id = auth.uid()
    AND session_id = p_session_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_active_session(text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_active_session(text) TO authenticated;
