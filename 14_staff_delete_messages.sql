BEGIN;

-- Grant DELETE permission to the authenticated role for messages
GRANT DELETE ON public.code_finder_messages TO authenticated;

-- Create an RLS policy that allows active STAFF and ADMIN to delete messages
CREATE POLICY "staff_delete_messages" ON public.code_finder_messages FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

COMMIT;
