-- Fix cf8_require_staff to allow Supabase Edge Functions (which use the service_role key)
-- to execute RPC calls that require staff permissions.

CREATE OR REPLACE FUNCTION public.cf8_require_staff() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 -- Allow execution if called with the service_role key (e.g. from Edge Functions)
 IF current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role' THEN
  RETURN;
 END IF;

 IF NOT EXISTS (SELECT 1 FROM public.user_roles
 WHERE id=auth.uid() AND is_active IS TRUE AND role IN ('ADMIN','STAFF'))
 OR public.is_active_staff() IS DISTINCT FROM TRUE THEN
 RAISE EXCEPTION 'Active internal staff access required'; END IF;
END $$;
