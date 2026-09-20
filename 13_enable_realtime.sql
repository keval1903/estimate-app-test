-- Enable Supabase Realtime for Code Finder tables

BEGIN;

-- Add Code Finder tables to the built-in supabase_realtime publication
-- This allows the PostgreSQL changes to be broadcast over WebSockets
ALTER PUBLICATION supabase_realtime ADD TABLE public.code_finder_enquiries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.code_finder_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.code_finder_proposals;

COMMIT;
