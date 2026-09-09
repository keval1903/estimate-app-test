BEGIN;

-- =============================================================================
-- File: 03_laminea_alternative_codes.sql
-- Description: Migration for Laminea Alternative-Code System
-- =============================================================================

-- ============================================================
-- PRE-MIGRATION: Fix existing estimate constraints & cleanup
-- ============================================================

-- Drop obsolete drafts if they exist
DROP FUNCTION IF EXISTS check_and_update_rate_limit(TEXT, INTEGER, INTEGER);
DROP FUNCTION IF EXISTS process_estimate_atomic(UUID, TEXT, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN);

-- The original schema defined bill_number INTEGER NOT NULL UNIQUE.
-- Platform numbering introduced platform_estimate_number and estimates_platform_number_unique.
-- We must drop the global bill_number UNIQUE constraint to allow duplicate numbers across platforms.
DO $$
DECLARE
    con_name TEXT;
BEGIN
    SELECT conname INTO con_name
    FROM pg_constraint
    WHERE conrelid = 'public.estimates'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%(bill_number)%';
      
    IF con_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE estimates DROP CONSTRAINT ' || quote_ident(con_name);
    END IF;

    SELECT conname INTO con_name
    FROM pg_constraint
    WHERE conrelid = 'public.sites'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%(site_name)%';

    IF con_name IS NOT NULL THEN
        EXECUTE 'ALTER TABLE sites DROP CONSTRAINT ' || quote_ident(con_name);
    END IF;
END $$;

-- Ensure platform_estimate_number is populated and NOT NULL
UPDATE estimates SET platform_estimate_number = bill_number WHERE platform_estimate_number IS NULL;
ALTER TABLE estimates ALTER COLUMN platform_estimate_number SET NOT NULL;

-- Reassert platform-number constraint
DROP INDEX IF EXISTS estimates_platform_number_unique;
CREATE UNIQUE INDEX estimates_platform_number_unique ON estimates(platform, platform_estimate_number);

-- Reassert site name constraint
DROP INDEX IF EXISTS sites_platform_site_name_unique;
CREATE UNIQUE INDEX sites_platform_site_name_unique ON sites(platform, site_name);

-- Missing schema columns
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS order_by TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS idempotency_key UUID UNIQUE;

ALTER TABLE client_purchases ADD COLUMN IF NOT EXISTS is_archived BOOLEAN DEFAULT FALSE;


-- ============================================================
-- 1. ADD STABLE PRODUCT CODE
-- ============================================================
ALTER TABLE products ADD COLUMN IF NOT EXISTS product_code TEXT;

-- Create normalization function
CREATE OR REPLACE FUNCTION normalize_laminea_code(p_code TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT UPPER(
        REGEXP_REPLACE(TRIM(p_code), '\s+', ' ', 'g')
    );
$$;

-- Unique case-insensitive normalized index on product_code
CREATE UNIQUE INDEX IF NOT EXISTS products_product_code_unique
ON products (normalize_laminea_code(product_code))
WHERE product_code IS NOT NULL AND TRIM(product_code) <> '';


-- ============================================================
-- 2. CREATE MAPPING TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS laminea_product_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL
        REFERENCES products(id)
        ON DELETE RESTRICT,
    alternative_code TEXT NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disabled_at TIMESTAMPTZ,
    disabled_by UUID REFERENCES user_roles(id) ON DELETE SET NULL
);

-- Unique index for active alternative codes (normalized)
CREATE UNIQUE INDEX IF NOT EXISTS laminea_active_alternative_code_unique
ON laminea_product_codes (normalize_laminea_code(alternative_code))
WHERE is_active = TRUE;

-- Index for product lookups
CREATE INDEX IF NOT EXISTS laminea_product_codes_product_id_idx ON laminea_product_codes(product_id);


-- ============================================================
-- 3. CREATE AUDIT TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS laminea_code_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    action TEXT NOT NULL, -- 'CREATE', 'DISABLE', 'REACTIVATE', 'REASSIGN', 'IMPORT_ADD', 'IMPORT_REPLACE'
    alternative_code TEXT NOT NULL,
    previous_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    new_product_id UUID REFERENCES products(id) ON DELETE SET NULL,
    reason TEXT,
    import_batch_id TEXT,
    actor UUID REFERENCES user_roles(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Prevent direct mutations on audit table
CREATE OR REPLACE FUNCTION check_laminea_code_audit_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit records are immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_laminea_code_audit_immutable ON laminea_code_audit;
CREATE TRIGGER trg_laminea_code_audit_immutable
BEFORE UPDATE OR DELETE ON laminea_code_audit
FOR EACH ROW EXECUTE FUNCTION check_laminea_code_audit_immutable();


-- ============================================================
-- 4. CREATE RATE LIMITS TABLE & CLEANUP
-- ============================================================
CREATE TABLE IF NOT EXISTS laminea_rate_limits (
    ip_hash TEXT PRIMARY KEY,
    request_count INTEGER DEFAULT 1,
    first_request_at TIMESTAMPTZ DEFAULT NOW(),
    last_request_at TIMESTAMPTZ DEFAULT NOW(),
    is_blocked BOOLEAN DEFAULT FALSE,
    blocked_until TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS laminea_rate_limits_last_request_idx
ON laminea_rate_limits(last_request_at);

CREATE OR REPLACE FUNCTION cleanup_laminea_rate_limits()
RETURNS void AS $$
BEGIN
    DELETE FROM laminea_rate_limits
    WHERE last_request_at < NOW() - INTERVAL '1 hour'
      AND (is_blocked = FALSE OR blocked_until < NOW());
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;


-- ============================================================
-- 5. SNAPSHOT FIELDS FOR DOCUMENTS
-- ============================================================
ALTER TABLE estimate_items 
ADD COLUMN IF NOT EXISTS alternative_code_snapshot TEXT,
ADD COLUMN IF NOT EXISTS actual_code_snapshot TEXT;

ALTER TABLE stock_history 
ADD COLUMN IF NOT EXISTS alternative_code TEXT;


-- ============================================================
-- 6. TRIGGERS & CONSTRAINTS
-- ============================================================

-- Auto-update updated_at for laminea_product_codes
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS laminea_product_codes_updated_at ON laminea_product_codes;
CREATE TRIGGER laminea_product_codes_updated_at
  BEFORE UPDATE ON laminea_product_codes
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Enforce Max 10 active codes & Validation
CREATE OR REPLACE FUNCTION check_laminea_mapping_validity()
RETURNS TRIGGER AS $$
DECLARE
    active_count INTEGER;
    prod_in_laminea BOOLEAN;
    prod_has_stock BOOLEAN;
    prod_unit TEXT;
    prod_code TEXT;
BEGIN
    -- Normalize Alternative Code unconditionally
    NEW.alternative_code := normalize_laminea_code(NEW.alternative_code);

    IF TRIM(NEW.alternative_code) = '' THEN
        RAISE EXCEPTION 'Alternative code cannot be blank.';
    END IF;

    IF LENGTH(NEW.alternative_code) > 30 THEN
        RAISE EXCEPTION 'Alternative code length exceeds 30 characters.';
    END IF;

    -- Safely lock the product and check eligibility
    SELECT in_laminea, has_stock, unit, product_code 
    INTO prod_in_laminea, prod_has_stock, prod_unit, prod_code
    FROM products WHERE id = NEW.product_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found.';
    END IF;

    IF prod_code IS NULL OR TRIM(prod_code) = '' THEN
        RAISE EXCEPTION 'Product does not have an actual product code. Update the product code first.';
    END IF;

    IF NEW.alternative_code = normalize_laminea_code(prod_code) THEN
        RAISE EXCEPTION 'Alternative code cannot be identical to its actual product code.';
    END IF;

    IF NEW.is_active = TRUE THEN
        IF prod_in_laminea IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'Product is not enabled in Laminea.';
        END IF;

        IF prod_has_stock IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'Product does not have stock management enabled.';
        END IF;

        IF UPPER(TRIM(prod_unit)) NOT IN ('NOS.', 'SHEET', 'SHEETS', 'PCS', 'PCS.') THEN
            RAISE EXCEPTION 'Product must use a supported unit (Nos., Sheet, Pcs).';
        END IF;

        IF EXISTS (SELECT 1 FROM products WHERE normalize_laminea_code(product_code) = NEW.alternative_code) THEN
            RAISE EXCEPTION 'Alternative code conflicts with an actual product code.';
        END IF;

        -- Enforce Max 10 Codes per product (lock is already held)
        SELECT COUNT(*) INTO active_count FROM laminea_product_codes 
        WHERE product_id = NEW.product_id AND is_active = TRUE AND id IS DISTINCT FROM NEW.id;

        IF active_count >= 10 THEN
            RAISE EXCEPTION 'Product cannot have more than 10 active alternative codes.';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_laminea_mapping_validity ON laminea_product_codes;
CREATE TRIGGER trg_check_laminea_mapping_validity
BEFORE INSERT OR UPDATE ON laminea_product_codes
FOR EACH ROW EXECUTE FUNCTION check_laminea_mapping_validity();


-- Prevent actual code changes that conflict with active alternative codes
CREATE OR REPLACE FUNCTION check_product_code_conflict()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.product_code IS NOT NULL AND TRIM(NEW.product_code) != '' THEN
        IF EXISTS (SELECT 1 FROM laminea_product_codes WHERE normalize_laminea_code(alternative_code) = normalize_laminea_code(NEW.product_code) AND is_active = TRUE) THEN
            RAISE EXCEPTION 'Actual product code conflicts with an existing active alternative code.';
        END IF;
    END IF;
    
    -- If product is rendered ineligible, automatically disable its mappings
    IF NEW.in_laminea IS DISTINCT FROM TRUE OR NEW.has_stock IS DISTINCT FROM TRUE OR UPPER(TRIM(NEW.unit)) NOT IN ('NOS.', 'SHEET', 'SHEETS', 'PCS', 'PCS.') THEN
        UPDATE laminea_product_codes 
        SET is_active = FALSE 
        WHERE product_id = NEW.id AND is_active = TRUE;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_check_product_code_conflict ON products;
CREATE TRIGGER trg_check_product_code_conflict
AFTER UPDATE OF product_code, in_laminea, has_stock, unit ON products
FOR EACH ROW EXECUTE FUNCTION check_product_code_conflict();


-- Audit trigger to automatically capture actions and disabled_by state
CREATE OR REPLACE FUNCTION audit_laminea_mapping()
RETURNS TRIGGER AS $$
DECLARE
    v_action TEXT;
    v_actor UUID := auth.uid();
BEGIN
    IF TG_OP = 'INSERT' THEN
        v_action := 'CREATE';
        
        IF NEW.is_active = FALSE THEN
            NEW.disabled_at := NOW();
            NEW.disabled_by := v_actor;
        END IF;
        
        INSERT INTO laminea_code_audit (action, alternative_code, new_product_id, actor)
        VALUES (v_action, NEW.alternative_code, NEW.product_id, v_actor);
        
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.is_active = FALSE AND OLD.is_active = TRUE THEN
            v_action := 'DISABLE';
            NEW.disabled_at := NOW();
            NEW.disabled_by := v_actor;
            
            INSERT INTO laminea_code_audit (action, alternative_code, previous_product_id, actor)
            VALUES (v_action, NEW.alternative_code, OLD.product_id, v_actor);
            
        ELSIF NEW.is_active = TRUE AND OLD.is_active = FALSE THEN
            v_action := 'REACTIVATE';
            NEW.disabled_at := NULL;
            NEW.disabled_by := NULL;
            
            INSERT INTO laminea_code_audit (action, alternative_code, new_product_id, actor)
            VALUES (v_action, NEW.alternative_code, NEW.product_id, v_actor);
            
        ELSIF NEW.product_id != OLD.product_id THEN
            v_action := 'REASSIGN';
            
            INSERT INTO laminea_code_audit (action, alternative_code, previous_product_id, new_product_id, actor)
            VALUES (v_action, NEW.alternative_code, OLD.product_id, NEW.product_id, v_actor);
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_laminea_mapping ON laminea_product_codes;
CREATE TRIGGER trg_audit_laminea_mapping
BEFORE INSERT OR UPDATE ON laminea_product_codes
FOR EACH ROW EXECUTE FUNCTION audit_laminea_mapping();


-- ============================================================
-- 7. EDGE FUNCTION RATE LIMIT RPC
-- ============================================================
CREATE OR REPLACE FUNCTION check_and_update_rate_limit(
    p_ip_hash TEXT
) RETURNS JSONB AS $$
DECLARE
    v_record RECORD;
    -- Fixed server-side limits
    v_limit INTEGER := 25;
    v_window_minutes INTEGER := 15;
    v_block_minutes INTEGER := 60;
BEGIN
    -- Reset expired block
    UPDATE laminea_rate_limits
    SET is_blocked = FALSE, blocked_until = NULL
    WHERE ip_hash = p_ip_hash AND is_blocked = TRUE AND blocked_until < NOW();

    -- Atomic upsert for rate limiting
    INSERT INTO laminea_rate_limits (ip_hash, request_count, first_request_at, last_request_at)
    VALUES (p_ip_hash, 1, NOW(), NOW())
    ON CONFLICT (ip_hash) DO UPDATE 
    SET 
        request_count = CASE 
            WHEN (NOW() - laminea_rate_limits.first_request_at) > (v_window_minutes * interval '1 minute') THEN 1
            ELSE laminea_rate_limits.request_count + 1
        END,
        first_request_at = CASE 
            WHEN (NOW() - laminea_rate_limits.first_request_at) > (v_window_minutes * interval '1 minute') THEN NOW()
            ELSE laminea_rate_limits.first_request_at
        END,
        last_request_at = NOW()
    RETURNING * INTO v_record;

    IF v_record.is_blocked AND v_record.blocked_until > NOW() THEN
        RETURN jsonb_build_object('allowed', false, 'reason', 'Blocked due to enumeration attempts.');
    END IF;

    IF v_record.request_count > v_limit THEN
        -- Block them
        UPDATE laminea_rate_limits
        SET is_blocked = TRUE,
            blocked_until = NOW() + (v_block_minutes * interval '1 minute')
        WHERE ip_hash = p_ip_hash;
        
        RETURN jsonb_build_object('allowed', false, 'reason', 'Rate limit exceeded. Blocked temporarily.');
    END IF;

    RETURN jsonb_build_object('allowed', true);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;

REVOKE ALL ON FUNCTION check_and_update_rate_limit(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION check_and_update_rate_limit(TEXT) TO service_role;


-- ============================================================
-- 9. RLS POLICIES
-- ============================================================
ALTER TABLE laminea_product_codes ENABLE ROW LEVEL SECURITY;
ALTER TABLE laminea_code_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE laminea_rate_limits ENABLE ROW LEVEL SECURITY;

-- Clean existing policies
DROP POLICY IF EXISTS "Admins full access to mappings" ON laminea_product_codes;
DROP POLICY IF EXISTS "Staff can read active mappings" ON laminea_product_codes;
DROP POLICY IF EXISTS "Admins can read audit" ON laminea_code_audit;
DROP POLICY IF EXISTS "Admins full access to audit" ON laminea_code_audit;

-- Admins can do everything on mappings
CREATE POLICY "Admins full access to mappings" 
ON laminea_product_codes FOR ALL TO authenticated 
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Staff can only read active mappings
CREATE POLICY "Staff can read active mappings" 
ON laminea_product_codes FOR SELECT TO authenticated 
USING (public.is_active_staff() AND is_active = TRUE);

-- Admins read-only on audit (Mutations handled by triggers/RPCs internally)
CREATE POLICY "Admins can read audit" 
ON laminea_code_audit FOR SELECT TO authenticated 
USING (public.is_admin());

-- Rate limits accessed only via RPC / service role
-- No policies needed as it will be accessed via SECURITY DEFINER RPCs

COMMIT;
