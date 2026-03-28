-- Allow authenticated users to upsert push subscriptions by endpoint (avoids RLS conflicts on endpoint reuse)
CREATE OR REPLACE FUNCTION public.upsert_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_user_agent text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Remove any existing subscription with the same endpoint
  DELETE FROM public.push_subscriptions WHERE endpoint = p_endpoint;

  -- Insert new subscription for current user
  INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  VALUES (auth.uid(), p_endpoint, p_p256dh, p_auth, p_user_agent);
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_push_subscription(text, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.upsert_push_subscription(text, text, text, text) TO authenticated;
