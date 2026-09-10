BEGIN;

-- 1. Create temporary backup
CREATE TABLE laminea_product_codes_backup_before_08
AS TABLE laminea_product_codes;

-- 2. Create the strict normalization function
CREATE OR REPLACE FUNCTION normalize_alternative_code(p_code TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT UPPER(
        REGEXP_REPLACE(TRIM(p_code), '\s+', '', 'g')
    );
$$;

-- 3. Duplicate Cleanup Logic
DO $$
DECLARE
    r RECORD;
    target_product UUID;
    keep_id UUID;
    conflict_found BOOLEAN := FALSE;
BEGIN
    -- Check if equivalent codes point to different products
    FOR r IN 
        SELECT 
            normalize_alternative_code(alternative_code) as norm_code,
            COUNT(DISTINCT product_id) as product_count
        FROM laminea_product_codes
        GROUP BY normalize_alternative_code(alternative_code)
        HAVING COUNT(DISTINCT product_id) > 1
    LOOP
        RAISE NOTICE 'Conflict found for code % mapped to multiple products', r.norm_code;
        conflict_found := TRUE;
    END LOOP;

    IF conflict_found THEN
        RAISE EXCEPTION 'Migration aborted due to conflicting duplicate mappings. Resolve manually.';
    END IF;

    -- Consolidate safe duplicates (same normalized code, same product)
    FOR r IN 
        SELECT 
            normalize_alternative_code(alternative_code) as norm_code
        FROM laminea_product_codes
        GROUP BY normalize_alternative_code(alternative_code)
        HAVING COUNT(*) > 1
    LOOP
        -- Determine which row to keep
        -- Rules: Keep active row if exists. If multiple active, keep newest updated_at.
        -- If only inactive, keep newest updated_at.
        SELECT id, product_id INTO keep_id, target_product
        FROM laminea_product_codes
        WHERE normalize_alternative_code(alternative_code) = r.norm_code
        ORDER BY is_active DESC, updated_at DESC
        LIMIT 1;

        -- Create audit records for rows about to be deleted
        INSERT INTO laminea_code_audit (action, alternative_code, previous_product_id, reason, actor)
        SELECT 
            'DEDUPLICATE',
            alternative_code,
            product_id,
            'Normalization migration 08',
            NULL::UUID
        FROM laminea_product_codes
        WHERE normalize_alternative_code(alternative_code) = r.norm_code
          AND id != keep_id;

        -- Delete the duplicates
        DELETE FROM laminea_product_codes
        WHERE normalize_alternative_code(alternative_code) = r.norm_code
          AND id != keep_id;
    END LOOP;
END;
$$;

-- 4. Replace unique index
DROP INDEX IF EXISTS laminea_active_alternative_code_unique;
DROP INDEX IF EXISTS laminea_alternative_code_unique;
CREATE UNIQUE INDEX laminea_alternative_code_unique 
ON laminea_product_codes(normalize_alternative_code(alternative_code));

-- 5. Update the validation trigger
CREATE OR REPLACE FUNCTION check_laminea_mapping_validity()
RETURNS TRIGGER AS $$
DECLARE
    prod_in_laminea BOOLEAN;
    prod_has_stock BOOLEAN;
    prod_unit TEXT;
    prod_code TEXT;
    norm_new_alt TEXT;
BEGIN
    -- Do not assign the space-free normalized value to NEW.alternative_code to preserve display formatting.
    -- Continue formatting the stored value with uppercase and collapsed spaces.
    NEW.alternative_code := UPPER(REGEXP_REPLACE(TRIM(NEW.alternative_code), '\s+', ' ', 'g'));
    
    norm_new_alt := normalize_alternative_code(NEW.alternative_code);

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

    IF NEW.is_active = TRUE THEN
        IF prod_code IS NULL OR TRIM(prod_code) = '' THEN
            RAISE EXCEPTION 'Product does not have an actual product code. Update the product code first.';
        END IF;

        IF norm_new_alt = normalize_alternative_code(prod_code) THEN
            RAISE EXCEPTION 'Alternative code cannot be identical to its actual product code.';
        END IF;

        IF prod_in_laminea IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'Product is not enabled in Laminea.';
        END IF;

        IF prod_has_stock IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'Product does not have stock management enabled.';
        END IF;

        IF UPPER(TRIM(prod_unit)) NOT IN ('NOS.', 'SHEET', 'SHEETS', 'PCS', 'PCS.') THEN
            RAISE EXCEPTION 'Product must use a supported unit (Nos., Sheet, Pcs).';
        END IF;

        IF EXISTS (SELECT 1 FROM products WHERE normalize_alternative_code(product_code) = norm_new_alt) THEN
            RAISE EXCEPTION 'Alternative code conflicts with an actual product code.';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION check_product_code_conflict()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.product_code IS NOT NULL AND TRIM(NEW.product_code) != '' THEN
        IF EXISTS (
            SELECT 1 
            FROM laminea_product_codes 
            WHERE normalize_alternative_code(alternative_code) = normalize_alternative_code(NEW.product_code)
        ) THEN
            RAISE EXCEPTION 'Actual product code conflicts with an existing alternative code.';
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
$$;

REVOKE ALL ON FUNCTION public.check_product_code_conflict() FROM PUBLIC, anon, authenticated;

-- 6. Create RPC import_laminea_alternative_codes
CREATE OR REPLACE FUNCTION import_laminea_alternative_codes(
    p_rows JSONB,
    p_mode TEXT
)
RETURNS JSONB
SECURITY DEFINER SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
DECLARE
    r JSONB;
    v_norm_code TEXT;
    v_new_code TEXT;
    v_prod_id UUID;
    v_existing_id UUID;
    v_existing_prod_id UUID;
    v_existing_active BOOLEAN;
    v_created INT := 0;
    v_reactivated INT := 0;
    v_unchanged INT := 0;
    v_disabled INT := 0;
    v_all_incoming_norm_codes TEXT[] := '{}';
BEGIN
    IF public.is_admin() IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Admin access required';
    END IF;

    IF p_mode NOT IN ('MERGE', 'REPLACE') THEN
        RAISE EXCEPTION 'Invalid mode. Must be MERGE or REPLACE.';
    END IF;

    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'Input must be a JSON array';
    END IF;

    IF p_mode = 'REPLACE' AND jsonb_array_length(p_rows) = 0 THEN
        RAISE EXCEPTION 'REPLACE mode cannot be used with an empty array (would disable all mappings).';
    END IF;

    -- Validate format and extract all normalized codes for REPLACE mode
    FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
        v_new_code := r->>'alternativeCode';
        v_norm_code := normalize_alternative_code(v_new_code);
        
        IF v_norm_code IS NULL OR v_norm_code = '' THEN
            RAISE EXCEPTION 'Blank alternative code encountered in import.';
        END IF;
        
        IF v_norm_code = ANY(v_all_incoming_norm_codes) THEN
            RAISE EXCEPTION 'Duplicate alternative code in import file: %', v_new_code;
        END IF;

        IF NOT (r->>'targetProductId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
            RAISE EXCEPTION 'Invalid target product ID format for code %', v_new_code;
        END IF;
        
        v_prod_id := (r->>'targetProductId')::UUID;
        
        IF v_prod_id IS NULL THEN
            RAISE EXCEPTION 'Missing product ID for code %', v_new_code;
        END IF;

        v_all_incoming_norm_codes := array_append(v_all_incoming_norm_codes, v_norm_code);
    END LOOP;

    -- Lock the mappings table to prevent concurrent modifications
    LOCK TABLE laminea_product_codes IN EXCLUSIVE MODE;

    -- REPLACE mode logic (Disable first)
    IF p_mode = 'REPLACE' THEN
        WITH to_disable AS (
            UPDATE laminea_product_codes
            SET is_active = FALSE
            WHERE is_active = TRUE
              AND NOT (normalize_alternative_code(alternative_code) = ANY(v_all_incoming_norm_codes))
            RETURNING id
        )
        SELECT COUNT(*) INTO v_disabled FROM to_disable;
    END IF;

    -- Process each row
    FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
        v_new_code := r->>'alternativeCode';
        v_norm_code := normalize_alternative_code(v_new_code);
        v_prod_id := (r->>'targetProductId')::UUID;

        -- Find existing mapping
        SELECT id, product_id, is_active INTO v_existing_id, v_existing_prod_id, v_existing_active
        FROM laminea_product_codes
        WHERE normalize_alternative_code(alternative_code) = v_norm_code;

        IF FOUND THEN
            IF v_existing_prod_id != v_prod_id THEN
                -- Conflicts must not be automatically reassigned
                RAISE EXCEPTION 'Conflict: Code % is already assigned to another product.', v_new_code;
            END IF;

            IF v_existing_active THEN
                -- Unchanged
                v_unchanged := v_unchanged + 1;
            ELSE
                -- Reactivate
                UPDATE laminea_product_codes
                SET is_active = TRUE
                WHERE id = v_existing_id;
                v_reactivated := v_reactivated + 1;
            END IF;
        ELSE
            -- New mapping
            INSERT INTO laminea_product_codes (alternative_code, product_id, is_active)
            VALUES (v_new_code, v_prod_id, TRUE);
            v_created := v_created + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'created', v_created,
        'reactivated', v_reactivated,
        'unchanged', v_unchanged,
        'disabled', v_disabled
    );
END;
$$;

REVOKE ALL ON FUNCTION public.import_laminea_alternative_codes(JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_laminea_alternative_codes(JSONB, TEXT) TO authenticated;

COMMIT;
