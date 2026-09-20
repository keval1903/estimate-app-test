BEGIN;

-- ============================================================
-- 1. Required extensions
-- ============================================================

CREATE EXTENSION IF NOT EXISTS pg_net
WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS pg_cron
WITH SCHEMA extensions;

CREATE EXTENSION IF NOT EXISTS supabase_vault
WITH SCHEMA vault;


-- ============================================================
-- 2. Verify required Vault configuration
-- ============================================================

DO $$
DECLARE
    v_webhook_secret TEXT;
    v_send_url TEXT;
    v_retry_url TEXT;
BEGIN
    SELECT decrypted_secret
    INTO v_webhook_secret
    FROM vault.decrypted_secrets
    WHERE name = 'push_webhook_secret'
    LIMIT 1;

    SELECT decrypted_secret
    INTO v_send_url
    FROM vault.decrypted_secrets
    WHERE name = 'send_push_function_url'
    LIMIT 1;

    SELECT decrypted_secret
    INTO v_retry_url
    FROM vault.decrypted_secrets
    WHERE name = 'process_push_retries_function_url'
    LIMIT 1;

    IF NULLIF(TRIM(v_webhook_secret), '') IS NULL THEN
        RAISE EXCEPTION
            'Vault secret push_webhook_secret is missing or empty';
    END IF;

    IF NULLIF(TRIM(v_send_url), '') IS NULL THEN
        RAISE EXCEPTION
            'Vault secret send_push_function_url is missing or empty';
    END IF;

    IF NULLIF(TRIM(v_retry_url), '') IS NULL THEN
        RAISE EXCEPTION
            'Vault secret process_push_retries_function_url is missing or empty';
    END IF;

    IF v_send_url NOT LIKE 'https://%' THEN
        RAISE EXCEPTION
            'send_push_function_url must use HTTPS';
    END IF;

    IF v_retry_url NOT LIKE 'https://%' THEN
        RAISE EXCEPTION
            'process_push_retries_function_url must use HTTPS';
    END IF;
END;
$$;


-- ============================================================
-- 3. Outbox webhook
-- ============================================================

CREATE OR REPLACE FUNCTION public.notify_push_webhook()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_webhook_secret TEXT;
    v_send_url TEXT;
    v_request_id BIGINT;
BEGIN
    SELECT decrypted_secret
    INTO v_webhook_secret
    FROM vault.decrypted_secrets
    WHERE name = 'push_webhook_secret'
    LIMIT 1;

    SELECT decrypted_secret
    INTO v_send_url
    FROM vault.decrypted_secrets
    WHERE name = 'send_push_function_url'
    LIMIT 1;

    -- Notification configuration must never block enquiry creation.
    IF NULLIF(TRIM(v_webhook_secret), '') IS NULL
       OR NULLIF(TRIM(v_send_url), '') IS NULL THEN
        RAISE WARNING
            'Push notification configuration is missing';
        RETURN NEW;
    END IF;

    BEGIN
        v_request_id := net.http_post(
            url := v_send_url,
            body := jsonb_build_object(
                'record',
                jsonb_build_object('id', NEW.id)
            ),
            headers := jsonb_build_object(
                'Content-Type', 'application/json',
                'Authorization', 'Bearer ' || v_webhook_secret
            ),
            timeout_milliseconds := 5000
        );
    EXCEPTION
        WHEN OTHERS THEN
            -- Do not roll back the enquiry because push failed.
            RAISE WARNING
                'Could not enqueue push webhook for outbox %: %',
                NEW.id,
                SQLERRM;
    END;

    RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION public.notify_push_webhook()
FROM PUBLIC, anon, authenticated;


DROP TRIGGER IF EXISTS trigger_notification_outbox_push
ON public.notification_outbox;

CREATE TRIGGER trigger_notification_outbox_push
AFTER INSERT ON public.notification_outbox
FOR EACH ROW
EXECUTE FUNCTION public.notify_push_webhook();


-- ============================================================
-- 4. Retry invocation function
-- ============================================================

CREATE OR REPLACE FUNCTION public.invoke_process_push_retries()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, pg_temp
AS $$
DECLARE
    v_webhook_secret TEXT;
    v_retry_url TEXT;
    v_request_id BIGINT;
BEGIN
    SELECT decrypted_secret
    INTO v_webhook_secret
    FROM vault.decrypted_secrets
    WHERE name = 'push_webhook_secret'
    LIMIT 1;

    SELECT decrypted_secret
    INTO v_retry_url
    FROM vault.decrypted_secrets
    WHERE name = 'process_push_retries_function_url'
    LIMIT 1;

    IF NULLIF(TRIM(v_webhook_secret), '') IS NULL THEN
        RAISE EXCEPTION
            'Vault secret push_webhook_secret is missing';
    END IF;

    IF NULLIF(TRIM(v_retry_url), '') IS NULL THEN
        RAISE EXCEPTION
            'Vault secret process_push_retries_function_url is missing';
    END IF;

    v_request_id := net.http_post(
        url := v_retry_url,
        body := '{}'::jsonb,
        headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || v_webhook_secret
        ),
        timeout_milliseconds := 5000
    );
END;
$$;

REVOKE ALL
ON FUNCTION public.invoke_process_push_retries()
FROM PUBLIC, anon, authenticated;


-- ============================================================
-- 5. Idempotent retry schedule
-- ============================================================

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM cron.job
        WHERE jobname = 'process_push_retries_job'
    ) THEN
        PERFORM cron.unschedule('process_push_retries_job');
    END IF;

    PERFORM cron.schedule(
        'process_push_retries_job',
        '*/5 * * * *',
        $cron$
            SELECT public.invoke_process_push_retries();
        $cron$
    );
END;
$$;

COMMIT;
