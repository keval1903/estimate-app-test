BEGIN;

-- 1. Restore the original handle_new_user trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
  INSERT INTO public.user_roles (id, username, role, is_active)
  VALUES (
    NEW.id,
    SPLIT_PART(NEW.email, '@', 1), -- Extract username from username@estimateapp.local
    'STAFF',
    true
  );
  RETURN NEW;
END;
$function$;

-- 2. Drop the tables in reverse order of creation
DROP TABLE IF EXISTS public.code_finder_messages CASCADE;
DROP TABLE IF EXISTS public.code_finder_enquiry_items CASCADE;
DROP TABLE IF EXISTS public.code_finder_enquiries CASCADE;
DROP TABLE IF EXISTS public.code_finder_users CASCADE;

COMMIT;
