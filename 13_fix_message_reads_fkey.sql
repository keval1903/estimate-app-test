BEGIN;

ALTER TABLE public.code_finder_message_reads
  DROP CONSTRAINT IF EXISTS code_finder_message_reads_last_read_message_id_fkey;

ALTER TABLE public.code_finder_message_reads
  ADD CONSTRAINT code_finder_message_reads_last_read_message_id_fkey 
  FOREIGN KEY (last_read_message_id) 
  REFERENCES public.code_finder_messages(id) 
  ON DELETE SET NULL;

COMMIT;
