-- =============================================================================
-- File: 03_laminea_alternative_codes_rollback.sql
-- Description: Rollback migration for Laminea Alternative-Code System
-- =============================================================================

-- WARNING: After any estimates use alternative-code snapshots, this production-safe 
-- rollback must disable the feature and retain mapping, audit, stock-history, 
-- and snapshot data. Populated snapshot columns must never be dropped.

-- If you are rolling back a FRESH deployment (before production usage):
-- Uncomment the DROP statements below if you wish to fully remove the objects.

/*
DROP TRIGGER IF EXISTS trg_check_product_code_conflict ON products;
DROP FUNCTION IF EXISTS check_product_code_conflict();

DROP TRIGGER IF EXISTS trg_check_laminea_mapping_validity ON laminea_product_codes;
DROP FUNCTION IF EXISTS check_laminea_mapping_validity();

DROP TRIGGER IF EXISTS laminea_product_codes_updated_at ON laminea_product_codes;

DROP POLICY IF EXISTS "Admins full access to mappings" ON laminea_product_codes;
DROP POLICY IF EXISTS "Staff can read active mappings" ON laminea_product_codes;
DROP POLICY IF EXISTS "Admins full access to audit" ON laminea_code_audit;

DROP FUNCTION IF EXISTS process_estimate_atomic(UUID, TEXT, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN);
DROP FUNCTION IF EXISTS check_and_update_rate_limit(TEXT, INTEGER, INTEGER);

DROP TABLE IF EXISTS laminea_code_audit;
DROP TABLE IF EXISTS laminea_product_codes;
DROP TABLE IF EXISTS laminea_rate_limits;

DROP INDEX IF EXISTS products_product_code_unique;
ALTER TABLE products DROP COLUMN IF EXISTS product_code;

ALTER TABLE estimate_items DROP COLUMN IF EXISTS alternative_code_snapshot;
ALTER TABLE estimate_items DROP COLUMN IF EXISTS actual_code_snapshot;
ALTER TABLE stock_history DROP COLUMN IF EXISTS alternative_code;
*/

-- Safe Production Rollback:
-- Disable active mappings to turn off the feature.
UPDATE laminea_product_codes SET is_active = FALSE WHERE is_active = TRUE;
