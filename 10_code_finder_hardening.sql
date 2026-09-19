-- Code Finder Hardening Migration
-- Phase 3: Atomic enquiry creation RPC with idempotency
-- Phase 4: Normalized username column
-- Phase 5: Namespaced rate limiting

BEGIN;

-- ============================================================
-- Phase 4: Add normalized_username column
-- ============================================================

-- Add generated column for normalized username (spaces stripped, uppercased)
ALTER TABLE public.code_finder_users
ADD COLUMN IF NOT EXISTS normalized_username TEXT
  GENERATED ALWAYS AS (
    UPPER(REGEXP_REPLACE(TRIM(username), '\s+', '', 'g'))
  ) STORED;

-- Unique index on the generated column (replaces old uniqueness approach)
CREATE UNIQUE INDEX IF NOT EXISTS code_finder_users_normalized_username_idx
ON public.code_finder_users (normalized_username);


-- ============================================================
-- Phase 3: Add idempotency_key column to enquiries
-- ============================================================

ALTER TABLE public.code_finder_enquiries
ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS code_finder_enquiries_idempotency_idx
ON public.code_finder_enquiries (code_finder_user_id, idempotency_key)
WHERE idempotency_key IS NOT NULL;


-- ============================================================
-- Phase 3: Atomic enquiry creation RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_code_finder_enquiry(
  p_user_id UUID,
  p_items JSONB,            -- array of {alternative_code_snapshot, requested_quantity, availability_status, checked_at}
  p_client_note TEXT DEFAULT NULL,
  p_checked_at TIMESTAMPTZ DEFAULT NOW(),
  p_idempotency_key TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_enquiry_id UUID;
  v_enquiry_number BIGINT;
  v_existing RECORD;
  v_item JSONB;
BEGIN
  -- Idempotency check: if key already exists for this user, return the existing enquiry
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id, enquiry_number INTO v_existing
    FROM public.code_finder_enquiries
    WHERE code_finder_user_id = p_user_id
      AND idempotency_key = p_idempotency_key;

    IF FOUND THEN
      RETURN jsonb_build_object(
        'enquiry_id', v_existing.id,
        'enquiry_number', v_existing.enquiry_number,
        'duplicate', true
      );
    END IF;
  END IF;

  -- Validate items
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'No items provided';
  END IF;

  IF jsonb_array_length(p_items) > 25 THEN
    RAISE EXCEPTION 'Maximum 25 items per enquiry';
  END IF;

  -- Insert enquiry header
  INSERT INTO public.code_finder_enquiries (
    code_finder_user_id, status, client_note, checked_at, idempotency_key
  ) VALUES (
    p_user_id, 'NEW', p_client_note, p_checked_at, p_idempotency_key
  )
  RETURNING id, enquiry_number INTO v_enquiry_id, v_enquiry_number;

  -- Insert all items
  INSERT INTO public.code_finder_enquiry_items (
    enquiry_id,
    alternative_code_snapshot,
    requested_quantity,
    availability_status,
    checked_at
  )
  SELECT
    v_enquiry_id,
    item->>'alternative_code_snapshot',
    (item->>'requested_quantity')::NUMERIC(12,2),
    item->>'availability_status',
    (item->>'checked_at')::TIMESTAMPTZ
  FROM jsonb_array_elements(p_items) AS item;

  RETURN jsonb_build_object(
    'enquiry_id', v_enquiry_id,
    'enquiry_number', v_enquiry_number,
    'duplicate', false
  );
END;
$$;

-- Only service_role should call this
REVOKE ALL ON FUNCTION public.create_code_finder_enquiry FROM PUBLIC, anon, authenticated;


-- ============================================================
-- Phase 5: Namespaced rate limiting table + RPC
-- ============================================================

-- Create a dedicated table for namespaced rate limits
CREATE TABLE IF NOT EXISTS public.code_finder_rate_limits (
  namespace TEXT NOT NULL,
  key_hash  TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (namespace, key_hash)
);

-- Disable RLS (service_role only access, same pattern as other code_finder tables)
ALTER TABLE public.code_finder_rate_limits ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.code_finder_rate_limits FROM anon, authenticated;


CREATE OR REPLACE FUNCTION public.check_rate_limit_v2(
  p_namespace TEXT,
  p_key_hash TEXT,
  p_max_requests INTEGER DEFAULT 10,
  p_window_seconds INTEGER DEFAULT 60
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row RECORD;
  v_now TIMESTAMPTZ := NOW();
  v_window_start TIMESTAMPTZ := v_now - (p_window_seconds || ' seconds')::INTERVAL;
BEGIN
  -- Try to get existing record
  SELECT * INTO v_row
  FROM public.code_finder_rate_limits
  WHERE namespace = p_namespace AND key_hash = p_key_hash
  FOR UPDATE;

  IF NOT FOUND THEN
    -- First request in this window
    INSERT INTO public.code_finder_rate_limits (namespace, key_hash, request_count, window_start)
    VALUES (p_namespace, p_key_hash, 1, v_now)
    ON CONFLICT (namespace, key_hash) DO UPDATE
      SET request_count = 1, window_start = v_now;
    RETURN jsonb_build_object('allowed', true, 'remaining', p_max_requests - 1);
  END IF;

  IF v_row.window_start < v_window_start THEN
    -- Window expired, reset
    UPDATE public.code_finder_rate_limits
    SET request_count = 1, window_start = v_now
    WHERE namespace = p_namespace AND key_hash = p_key_hash;
    RETURN jsonb_build_object('allowed', true, 'remaining', p_max_requests - 1);
  END IF;

  IF v_row.request_count >= p_max_requests THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'Rate limit exceeded');
  END IF;

  -- Increment
  UPDATE public.code_finder_rate_limits
  SET request_count = request_count + 1
  WHERE namespace = p_namespace AND key_hash = p_key_hash;

  RETURN jsonb_build_object('allowed', true, 'remaining', p_max_requests - v_row.request_count - 1);
END;
$$;

REVOKE ALL ON FUNCTION public.check_rate_limit_v2 FROM PUBLIC, anon, authenticated;


-- Periodic cleanup of old rate limit entries (optional, can be called by cron)
CREATE OR REPLACE FUNCTION public.cleanup_rate_limits(p_older_than_minutes INTEGER DEFAULT 10)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_deleted INTEGER;
BEGIN
  DELETE FROM public.code_finder_rate_limits
  WHERE window_start < NOW() - (p_older_than_minutes || ' minutes')::INTERVAL;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_rate_limits FROM PUBLIC, anon, authenticated;

COMMIT;
