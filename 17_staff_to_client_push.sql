BEGIN;

CREATE OR REPLACE FUNCTION public.notify_new_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.sender_type = 'CLIENT' THEN
        INSERT INTO public.notification_outbox (event_type, event_payload, notification_tag, next_retry_at)
        VALUES (
            'NEW_MESSAGE', 
            jsonb_build_object('user_id', NEW.code_finder_user_id),
            'message:' || NEW.code_finder_user_id,
            NOW()
        );
    ELSIF NEW.sender_type = 'STAFF' THEN
        INSERT INTO public.notification_outbox (event_type, event_payload, notification_tag, next_retry_at)
        VALUES (
            'NEW_STAFF_MESSAGE', 
            jsonb_build_object('code_finder_user_id', NEW.code_finder_user_id),
            'staff_message:' || NEW.code_finder_user_id,
            NOW()
        );
    END IF;
    RETURN NEW;
END;
$$;

ALTER TABLE public.notification_outbox
    DROP CONSTRAINT IF EXISTS notification_outbox_event_type_check;

ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_event_type_check
    CHECK (event_type IN (
        'NEW_ENQUIRY',
        'NEW_MESSAGE',
        'NEW_STAFF_MESSAGE',
        'PROPOSAL_RESPONSE',
        'ENQUIRY_CONFIRMED',
        'PROPOSAL_SUBMITTED',
        'ORDER_PLACED'
    ));

COMMIT;
