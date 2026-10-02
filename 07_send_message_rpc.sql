BEGIN;

CREATE OR REPLACE FUNCTION public.send_code_finder_message(
    p_message TEXT,
    p_enquiry_id UUID DEFAULT NULL,
    p_reply_to_message_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_user_id UUID;
    v_cf_user_id UUID;
    v_effective_enquiry_id UUID;
    v_reply_enquiry_id UUID;
    v_message TEXT;
    v_message_id UUID;
    v_result JSONB;
    v_rate_result JSONB;
BEGIN
    ---------------------------------------------------------------------------
    -- 1. Authenticate caller
    ---------------------------------------------------------------------------

    v_auth_user_id := auth.uid();

    IF v_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'Not authenticated';
    END IF;

    ---------------------------------------------------------------------------
    -- 2. Resolve active Code Finder account
    ---------------------------------------------------------------------------

    SELECT id
    INTO v_cf_user_id
    FROM public.code_finder_users
    WHERE auth_user_id = v_auth_user_id
      AND is_active IS TRUE
      AND must_change_password IS FALSE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Invalid or inactive Code Finder account';
    END IF;

    ---------------------------------------------------------------------------
    -- 3. Validate message
    ---------------------------------------------------------------------------

    v_message := BTRIM(p_message);

    IF v_message IS NULL
       OR REGEXP_REPLACE(
              v_message,
              '[[:space:]]',
              '',
              'g'
          ) = ''
       OR CHAR_LENGTH(v_message) > 2000 THEN
        RAISE EXCEPTION 'Message must be between 1 and 2000 characters';
    END IF;

    ---------------------------------------------------------------------------
    -- 4. Database-side safety rate limit
    --
    -- Keep the Vercel user+IP rate limit as well. A separate namespace avoids
    -- counting the same request twice in the existing "message" namespace.
    ---------------------------------------------------------------------------

    SELECT public.check_rate_limit_v2(
        'message_rpc',
        v_auth_user_id::TEXT,
        20,
        60
    )
    INTO v_rate_result;

    IF COALESCE(
        (v_rate_result ->> 'allowed')::BOOLEAN,
        FALSE
    ) IS NOT TRUE THEN
        RAISE EXCEPTION 'Too many messages. Please wait.';
    END IF;

    v_effective_enquiry_id := p_enquiry_id;

    ---------------------------------------------------------------------------
    -- 5. Validate reply ownership
    ---------------------------------------------------------------------------

    IF p_reply_to_message_id IS NOT NULL THEN
        SELECT enquiry_id
        INTO v_reply_enquiry_id
        FROM public.code_finder_messages
        WHERE id = p_reply_to_message_id
          AND code_finder_user_id = v_cf_user_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Reply message not found or access denied';
        END IF;

        -- When replying to an enquiry-linked message, inherit its enquiry.
        IF v_effective_enquiry_id IS NULL
           AND v_reply_enquiry_id IS NOT NULL THEN
            v_effective_enquiry_id := v_reply_enquiry_id;
        END IF;

        -- Prevent linking a reply to a different enquiry.
        IF v_effective_enquiry_id IS NOT NULL
           AND v_reply_enquiry_id IS NOT NULL
           AND v_effective_enquiry_id <> v_reply_enquiry_id THEN
            RAISE EXCEPTION 'Reply message belongs to a different enquiry';
        END IF;
    END IF;

    ---------------------------------------------------------------------------
    -- 6. Validate enquiry ownership
    ---------------------------------------------------------------------------

    IF v_effective_enquiry_id IS NOT NULL THEN
        PERFORM 1
        FROM public.code_finder_enquiries
        WHERE id = v_effective_enquiry_id
          AND code_finder_user_id = v_cf_user_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Enquiry not found or access denied';
        END IF;
    END IF;

    ---------------------------------------------------------------------------
    -- 7. Insert message
    --
    -- Existing triggers will:
    -- - create the staff push-notification outbox record;
    -- - process clarification replies when enquiry_id is present.
    ---------------------------------------------------------------------------

    INSERT INTO public.code_finder_messages (
        code_finder_user_id,
        enquiry_id,
        sender_type,
        sender_auth_user_id,
        message,
        reply_to_message_id
    )
    VALUES (
        v_cf_user_id,
        v_effective_enquiry_id,
        'CLIENT',
        v_auth_user_id,
        v_message,
        p_reply_to_message_id
    )
    RETURNING id
    INTO v_message_id;

    ---------------------------------------------------------------------------
    -- 8. Return safe message fields
    ---------------------------------------------------------------------------

    SELECT JSONB_BUILD_OBJECT(
        'id', message.id,
        'enquiry_id', message.enquiry_id,
        'sender_type', message.sender_type,
        'message', message.message,
        'created_at', message.created_at,
        'reply_to_message_id', message.reply_to_message_id
    )
    INTO v_result
    FROM public.code_finder_messages AS message
    WHERE message.id = v_message_id;

    RETURN v_result;
END;
$$;

REVOKE ALL
ON FUNCTION public.send_code_finder_message(TEXT, UUID, UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.send_code_finder_message(TEXT, UUID, UUID)
TO authenticated;

COMMIT;
