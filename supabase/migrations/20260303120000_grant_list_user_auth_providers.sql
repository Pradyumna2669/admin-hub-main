-- PostgREST only exposes RPCs that the current role can EXECUTE.
-- Grant execute to authenticated users; function itself enforces admin/owner.

GRANT EXECUTE ON FUNCTION public.list_user_auth_providers() TO authenticated;
