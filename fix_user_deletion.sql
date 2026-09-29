-- Fix code_finder_user deletion being blocked by enquiries and messages

-- 1. Fix code_finder_enquiries -> code_finder_users
ALTER TABLE public.code_finder_enquiries 
DROP CONSTRAINT IF EXISTS code_finder_enquiries_code_finder_user_id_fkey;

ALTER TABLE public.code_finder_enquiries 
ADD CONSTRAINT code_finder_enquiries_code_finder_user_id_fkey 
FOREIGN KEY (code_finder_user_id) 
REFERENCES public.code_finder_users(id) 
ON DELETE CASCADE;

-- 2. Fix code_finder_messages -> code_finder_enquiries
ALTER TABLE public.code_finder_messages 
DROP CONSTRAINT IF EXISTS code_finder_messages_enquiry_id_code_finder_user_id_fkey,
DROP CONSTRAINT IF EXISTS code_finder_messages_enquiry_id_fkey; -- Just in case it was named this

ALTER TABLE public.code_finder_messages 
ADD CONSTRAINT code_finder_messages_enquiry_id_code_finder_user_id_fkey 
FOREIGN KEY (enquiry_id, code_finder_user_id) 
REFERENCES public.code_finder_enquiries(id, code_finder_user_id) 
ON DELETE CASCADE;
