CREATE OR REPLACE FUNCTION public.update_my_session_token(new_token TEXT) 
RETURNS void 
LANGUAGE sql 
SECURITY DEFINER 
AS $$ 
  UPDATE user_roles SET current_session_token = new_token WHERE id = auth.uid(); 
$$;
