-- ============================================================
-- ESTIMATE APP - MULTI-PLATFORM MIGRATION
-- Platforms: CCAI, DC, Laminea, PHS
--
-- Confirmed rules:
-- 1. Estimates and estimate numbers are platform-specific.
-- 2. Clients and ledgers are platform-specific.
-- 3. Catalogue records are platform-specific.
-- 4. Product master is shared.
-- 5. Product availability and prices are platform-specific.
-- 6. Product stock and minimum stock are shared.
--
-- Run this entire script in the Supabase SQL Editor.
-- ============================================================

BEGIN;


-- ============================================================
-- 1. PRODUCTS TABLE
-- ============================================================

-- Platform availability
ALTER TABLE products
ADD COLUMN IF NOT EXISTS in_ccai BOOLEAN NOT NULL DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS in_dc BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS in_laminea BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS in_phs BOOLEAN NOT NULL DEFAULT FALSE;

-- Platform-specific rates
ALTER TABLE products
ADD COLUMN IF NOT EXISTS rate_ccai NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS rate_dc NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS rate_laminea NUMERIC(12,2),
ADD COLUMN IF NOT EXISTS rate_phs NUMERIC(12,2);

-- Existing products belong to CCAI.
UPDATE products
SET
    in_ccai = COALESCE(in_ccai, TRUE),
    in_dc = COALESCE(in_dc, FALSE),
    in_laminea = COALESCE(in_laminea, FALSE),
    in_phs = COALESCE(in_phs, FALSE);

-- Copy the existing product rate to the CCAI rate.
UPDATE products
SET rate_ccai = rate
WHERE rate_ccai IS NULL;

-- Remove zero defaults if an earlier migration added them.
ALTER TABLE products
ALTER COLUMN rate_dc DROP DEFAULT,
ALTER COLUMN rate_laminea DROP DEFAULT,
ALTER COLUMN rate_phs DROP DEFAULT;

-- Every product must be enabled for at least one platform.
ALTER TABLE products
DROP CONSTRAINT IF EXISTS products_platform_required;

ALTER TABLE products
ADD CONSTRAINT products_platform_required
CHECK (
    in_ccai
    OR in_dc
    OR in_laminea
    OR in_phs
);

-- An enabled platform must have a corresponding rate.
ALTER TABLE products
DROP CONSTRAINT IF EXISTS products_platform_rates_check;

ALTER TABLE products
ADD CONSTRAINT products_platform_rates_check
CHECK (
    (NOT in_ccai OR rate_ccai IS NOT NULL)
    AND (NOT in_dc OR rate_dc IS NOT NULL)
    AND (NOT in_laminea OR rate_laminea IS NOT NULL)
    AND (NOT in_phs OR rate_phs IS NOT NULL)
);

-- Rates cannot be negative.
ALTER TABLE products
DROP CONSTRAINT IF EXISTS products_platform_rates_non_negative;

ALTER TABLE products
ADD CONSTRAINT products_platform_rates_non_negative
CHECK (
    (rate_ccai IS NULL OR rate_ccai >= 0)
    AND (rate_dc IS NULL OR rate_dc >= 0)
    AND (rate_laminea IS NULL OR rate_laminea >= 0)
    AND (rate_phs IS NULL OR rate_phs >= 0)
);


-- ============================================================
-- 2. CLIENTS TABLE
-- ============================================================

ALTER TABLE clients
ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ccai';

UPDATE clients
SET platform = 'ccai'
WHERE platform IS NULL;

UPDATE clients
SET platform = LOWER(platform);

ALTER TABLE clients
ALTER COLUMN platform SET DEFAULT 'ccai',
ALTER COLUMN platform SET NOT NULL;

ALTER TABLE clients
DROP CONSTRAINT IF EXISTS clients_platform_check;

ALTER TABLE clients
ADD CONSTRAINT clients_platform_check
CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));

-- Remove the old global name-uniqueness constraint.
ALTER TABLE clients
DROP CONSTRAINT IF EXISTS clients_name_key;

-- Also remove this constraint if an earlier version added it.
-- Different clients within one platform may have the same name.
ALTER TABLE clients
DROP CONSTRAINT IF EXISTS clients_name_platform_key;


-- ============================================================
-- 3. ESTIMATES TABLE
-- ============================================================

ALTER TABLE estimates
ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ccai',
ADD COLUMN IF NOT EXISTS platform_estimate_number BIGINT;

UPDATE estimates
SET platform = 'ccai'
WHERE platform IS NULL;

UPDATE estimates
SET platform = LOWER(platform);

-- bill_number is INT4, so it can safely be copied to BIGINT.
UPDATE estimates
SET platform_estimate_number = bill_number
WHERE platform_estimate_number IS NULL
  AND bill_number IS NOT NULL;

ALTER TABLE estimates
ALTER COLUMN platform SET DEFAULT 'ccai',
ALTER COLUMN platform SET NOT NULL;

ALTER TABLE estimates
DROP CONSTRAINT IF EXISTS estimates_platform_check;

ALTER TABLE estimates
ADD CONSTRAINT estimates_platform_check
CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));

-- Stop the migration if duplicate CCAI bill numbers already exist.
DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM estimates
        WHERE platform_estimate_number IS NOT NULL
        GROUP BY platform, platform_estimate_number
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate platform estimate numbers found. Resolve them before running this migration.';
    END IF;
END;
$$;

DROP INDEX IF EXISTS estimates_platform_number_unique;

CREATE UNIQUE INDEX estimates_platform_number_unique
ON estimates (platform, platform_estimate_number)
WHERE platform_estimate_number IS NOT NULL;


-- ============================================================
-- 4. PAYMENTS TABLE
-- ============================================================

ALTER TABLE payments
ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ccai';

UPDATE payments
SET platform = 'ccai'
WHERE platform IS NULL;

UPDATE payments
SET platform = LOWER(platform);

ALTER TABLE payments
ALTER COLUMN platform SET DEFAULT 'ccai',
ALTER COLUMN platform SET NOT NULL;

ALTER TABLE payments
DROP CONSTRAINT IF EXISTS payments_platform_check;

ALTER TABLE payments
ADD CONSTRAINT payments_platform_check
CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));


-- ============================================================
-- 5. CLIENT PURCHASES TABLE
-- ============================================================

ALTER TABLE client_purchases
ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ccai';

UPDATE client_purchases
SET platform = 'ccai'
WHERE platform IS NULL;

UPDATE client_purchases
SET platform = LOWER(platform);

ALTER TABLE client_purchases
ALTER COLUMN platform SET DEFAULT 'ccai',
ALTER COLUMN platform SET NOT NULL;

ALTER TABLE client_purchases
DROP CONSTRAINT IF EXISTS client_purchases_platform_check;

ALTER TABLE client_purchases
ADD CONSTRAINT client_purchases_platform_check
CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));


-- ============================================================
-- 6. CLIENT SITES TABLE
-- ============================================================

ALTER TABLE client_sites
ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ccai';

UPDATE client_sites
SET platform = 'ccai'
WHERE platform IS NULL;

UPDATE client_sites
SET platform = LOWER(platform);

ALTER TABLE client_sites
ALTER COLUMN platform SET DEFAULT 'ccai',
ALTER COLUMN platform SET NOT NULL;

ALTER TABLE client_sites
DROP CONSTRAINT IF EXISTS client_sites_platform_check;

ALTER TABLE client_sites
ADD CONSTRAINT client_sites_platform_check
CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));


-- ============================================================
-- 7. STOCK HISTORY TABLE
-- ============================================================
-- Product stock remains shared.
-- The platform identifies where each stock movement originated.

ALTER TABLE stock_history
ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ccai';

UPDATE stock_history
SET platform = 'ccai'
WHERE platform IS NULL;

UPDATE stock_history
SET platform = LOWER(platform);

ALTER TABLE stock_history
ALTER COLUMN platform SET DEFAULT 'ccai',
ALTER COLUMN platform SET NOT NULL;

ALTER TABLE stock_history
DROP CONSTRAINT IF EXISTS stock_history_platform_check;

ALTER TABLE stock_history
ADD CONSTRAINT stock_history_platform_check
CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));


-- ============================================================
-- 8. SELECTION SHEETS TABLE
-- ============================================================

ALTER TABLE selection_sheets
ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ccai';

UPDATE selection_sheets
SET platform = 'ccai'
WHERE platform IS NULL;

UPDATE selection_sheets
SET platform = LOWER(platform);

ALTER TABLE selection_sheets
ALTER COLUMN platform SET DEFAULT 'ccai',
ALTER COLUMN platform SET NOT NULL;

ALTER TABLE selection_sheets
DROP CONSTRAINT IF EXISTS selection_sheets_platform_check;

ALTER TABLE selection_sheets
ADD CONSTRAINT selection_sheets_platform_check
CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));


-- ============================================================
-- 9. CATALOGUE TABLE
-- ============================================================
-- Catalogues are separate for every platform.

ALTER TABLE catalogue
ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ccai';

UPDATE catalogue
SET platform = 'ccai'
WHERE platform IS NULL;

UPDATE catalogue
SET platform = LOWER(platform);

ALTER TABLE catalogue
ALTER COLUMN platform SET DEFAULT 'ccai',
ALTER COLUMN platform SET NOT NULL;

ALTER TABLE catalogue
DROP CONSTRAINT IF EXISTS catalogue_platform_check;

ALTER TABLE catalogue
ADD CONSTRAINT catalogue_platform_check
CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));


-- ============================================================
-- 10. INDEPENDENT ESTIMATE-NUMBER SEQUENCES
-- ============================================================

CREATE SEQUENCE IF NOT EXISTS bill_number_seq_ccai
START WITH 1
INCREMENT BY 1;

CREATE SEQUENCE IF NOT EXISTS bill_number_seq_dc
START WITH 1
INCREMENT BY 1;

CREATE SEQUENCE IF NOT EXISTS bill_number_seq_laminea
START WITH 1
INCREMENT BY 1;

CREATE SEQUENCE IF NOT EXISTS bill_number_seq_phs
START WITH 1
INCREMENT BY 1;

-- Set the next CCAI number to one greater than the current
-- highest existing CCAI estimate number.
SELECT setval(
    'bill_number_seq_ccai',
    COALESCE(
        (
            SELECT MAX(platform_estimate_number)
            FROM estimates
            WHERE platform = 'ccai'
        ),
        0
    ) + 1,
    FALSE
);


-- ============================================================
-- 11. ATOMIC FUNCTION FOR NEXT ESTIMATE NUMBER
-- ============================================================

CREATE OR REPLACE FUNCTION get_next_bill_number(p_platform TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    CASE LOWER(TRIM(p_platform))
        WHEN 'ccai' THEN
            RETURN nextval('public.bill_number_seq_ccai'::regclass);

        WHEN 'dc' THEN
            RETURN nextval('public.bill_number_seq_dc'::regclass);

        WHEN 'laminea' THEN
            RETURN nextval('public.bill_number_seq_laminea'::regclass);

        WHEN 'phs' THEN
            RETURN nextval('public.bill_number_seq_phs'::regclass);

        ELSE
            RAISE EXCEPTION 'Invalid platform: %', p_platform;
    END CASE;
END;
$$;

-- Restrict function access.
REVOKE ALL
ON FUNCTION get_next_bill_number(TEXT)
FROM PUBLIC;

GRANT EXECUTE
ON FUNCTION get_next_bill_number(TEXT)
TO authenticated;


-- ============================================================
-- 12. FILTERING INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS estimates_platform_index
ON estimates (platform);

CREATE INDEX IF NOT EXISTS clients_platform_index
ON clients (platform);

CREATE INDEX IF NOT EXISTS payments_platform_index
ON payments (platform);

CREATE INDEX IF NOT EXISTS client_purchases_platform_index
ON client_purchases (platform);

CREATE INDEX IF NOT EXISTS client_sites_platform_index
ON client_sites (platform);

CREATE INDEX IF NOT EXISTS stock_history_platform_index
ON stock_history (platform);

CREATE INDEX IF NOT EXISTS selection_sheets_platform_index
ON selection_sheets (platform);

CREATE INDEX IF NOT EXISTS catalogue_platform_index
ON catalogue (platform);

CREATE INDEX IF NOT EXISTS products_in_ccai_index
ON products (in_ccai)
WHERE in_ccai = TRUE;

CREATE INDEX IF NOT EXISTS products_in_dc_index
ON products (in_dc)
WHERE in_dc = TRUE;

CREATE INDEX IF NOT EXISTS products_in_laminea_index
ON products (in_laminea)
WHERE in_laminea = TRUE;

CREATE INDEX IF NOT EXISTS products_in_phs_index
ON products (in_phs)
WHERE in_phs = TRUE;


COMMIT;


-- ============================================================
-- MIGRATION COMPLETE
-- ============================================================

-- Verification query 1:
-- Confirm product migration and CCAI-rate backfill.

SELECT
    COUNT(*) AS total_products,
    COUNT(*) FILTER (WHERE in_ccai) AS ccai_products,
    COUNT(*) FILTER (WHERE in_dc) AS dc_products,
    COUNT(*) FILTER (WHERE in_laminea) AS laminea_products,
    COUNT(*) FILTER (WHERE in_phs) AS phs_products,
    COUNT(*) FILTER (WHERE in_ccai AND rate_ccai IS NULL)
        AS ccai_products_missing_rate
FROM products;


-- Verification query 2:
-- Confirm estimates were assigned to CCAI.

SELECT
    platform,
    COUNT(*) AS estimate_count,
    MIN(platform_estimate_number) AS lowest_number,
    MAX(platform_estimate_number) AS highest_number
FROM estimates
GROUP BY platform
ORDER BY platform;


-- Verification query 3:
-- Preview independent sequence values.
-- WARNING: Calling nextval consumes a number.
-- Run this only if consuming one test number is acceptable.

/*
SELECT
    get_next_bill_number('ccai') AS next_ccai,
    get_next_bill_number('dc') AS next_dc,
    get_next_bill_number('laminea') AS next_laminea,
    get_next_bill_number('phs') AS next_phs;
*/


-- Verification query 4:
-- Check that no estimate-number duplicates exist.

SELECT
    platform,
    platform_estimate_number,
    COUNT(*) AS duplicate_count
FROM estimates
WHERE platform_estimate_number IS NOT NULL
GROUP BY platform, platform_estimate_number
HAVING COUNT(*) > 1;


-- ============================================================
-- 7. SITES TABLE
-- ============================================================

ALTER TABLE sites
ADD COLUMN IF NOT EXISTS platform TEXT DEFAULT 'ccai';

UPDATE sites
SET platform = 'ccai'
WHERE platform IS NULL;

UPDATE sites
SET platform = LOWER(platform);

ALTER TABLE sites
ALTER COLUMN platform SET DEFAULT 'ccai',
ALTER COLUMN platform SET NOT NULL;

ALTER TABLE sites
DROP CONSTRAINT IF EXISTS sites_platform_check;

ALTER TABLE sites
ADD CONSTRAINT sites_platform_check
CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));

CREATE INDEX IF NOT EXISTS sites_platform_index
ON sites (platform);

