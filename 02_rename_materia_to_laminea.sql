  -- ============================================================
  -- 02_rename_materia_to_laminea.sql
  -- Run this in your Supabase SQL Editor to rename the Materia platform to Laminea
  -- ============================================================

  -- 1. Drop existing check constraints that restrict to ('ccai', 'dc', 'materia', 'phs')
  ALTER TABLE sites DROP CONSTRAINT IF EXISTS sites_platform_check;
  ALTER TABLE client_sites DROP CONSTRAINT IF EXISTS client_sites_platform_check;
  ALTER TABLE estimates DROP CONSTRAINT IF EXISTS estimates_platform_check;
  ALTER TABLE client_purchases DROP CONSTRAINT IF EXISTS client_purchases_platform_check;
  ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_platform_check;
  ALTER TABLE stock_history DROP CONSTRAINT IF EXISTS stock_history_platform_check;
ALTER TABLE clients DROP CONSTRAINT IF EXISTS clients_platform_check;
ALTER TABLE catalogue DROP CONSTRAINT IF EXISTS catalogue_platform_check;
ALTER TABLE selection_sheets DROP CONSTRAINT IF EXISTS selection_sheets_platform_check;

  -- 2. Rename columns and sequences in 'products'
  ALTER TABLE products RENAME COLUMN in_materia TO in_laminea;
  ALTER TABLE products RENAME COLUMN rate_materia TO rate_laminea;

  -- Recreate index on the new column name
  DROP INDEX IF EXISTS products_in_materia_index;
  CREATE INDEX IF NOT EXISTS products_in_laminea_index ON products (in_laminea);

  -- Rename sequence if it exists
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'bill_number_seq_materia') THEN
      ALTER SEQUENCE bill_number_seq_materia RENAME TO bill_number_seq_laminea;
    END IF;
  END $$;

  -- 3. Update the data
  UPDATE sites SET platform = 'laminea' WHERE platform = 'materia';
  UPDATE client_sites SET platform = 'laminea' WHERE platform = 'materia';
  UPDATE estimates SET platform = 'laminea' WHERE platform = 'materia';
  UPDATE client_purchases SET platform = 'laminea' WHERE platform = 'materia';
  UPDATE payments SET platform = 'laminea' WHERE platform = 'materia';
  UPDATE stock_history SET platform = 'laminea' WHERE platform = 'materia';
UPDATE clients SET platform = 'laminea' WHERE platform = 'materia';
UPDATE catalogue SET platform = 'laminea' WHERE platform = 'materia';
UPDATE selection_sheets SET platform = 'laminea' WHERE platform = 'materia';

  -- 4. Re-add the constraints with 'laminea' instead of 'materia'
  ALTER TABLE sites ADD CONSTRAINT sites_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));
  ALTER TABLE client_sites ADD CONSTRAINT client_sites_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));
  ALTER TABLE estimates ADD CONSTRAINT estimates_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));
  ALTER TABLE client_purchases ADD CONSTRAINT client_purchases_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));
  ALTER TABLE payments ADD CONSTRAINT payments_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));
  ALTER TABLE stock_history ADD CONSTRAINT stock_history_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));
ALTER TABLE clients ADD CONSTRAINT clients_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));
ALTER TABLE catalogue ADD CONSTRAINT catalogue_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));
ALTER TABLE selection_sheets ADD CONSTRAINT selection_sheets_platform_check CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs'));

  -- 5. Update the RPC function to use 'laminea' instead of 'materia'
  DROP FUNCTION IF EXISTS get_next_bill_number(text);

  CREATE OR REPLACE FUNCTION get_next_bill_number(p_platform TEXT)
  RETURNS BIGINT
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path = public
  AS $$
  DECLARE
      next_val INTEGER;
  BEGIN
      CASE p_platform
          WHEN 'ccai' THEN
              RETURN nextval('public.bill_number_seq_ccai'::regclass);
          WHEN 'dc' THEN
              RETURN nextval('public.bill_number_seq_dc'::regclass);
          WHEN 'laminea' THEN
              RETURN nextval('public.bill_number_seq_laminea'::regclass);
          WHEN 'phs' THEN
              RETURN nextval('public.bill_number_seq_phs'::regclass);
          ELSE
              RAISE EXCEPTION 'Unknown platform %', p_platform;
      END CASE;
  END;
  $$;
  
  REVOKE ALL ON FUNCTION get_next_bill_number(TEXT) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION get_next_bill_number(TEXT) TO authenticated;

  -- 6. Update the admin statistics RPC function
  CREATE OR REPLACE FUNCTION get_admin_dashboard_stats()
  RETURNS json
  LANGUAGE plpgsql
  SECURITY DEFINER
  AS $$
  DECLARE
    result json;
  BEGIN
    SELECT json_build_object(
      'users_count', (SELECT COUNT(*) FROM user_roles),
      'active_users', (SELECT COUNT(*) FROM user_roles WHERE is_active = TRUE),
      'products_count', (SELECT COUNT(*) FROM products),
      'ccai_products', (SELECT COUNT(*) FROM products WHERE in_ccai = TRUE),
      'dc_products', (SELECT COUNT(*) FROM products WHERE in_dc = TRUE),
      'laminea_products', (SELECT COUNT(*) FROM products WHERE in_laminea = TRUE),
      'phs_products', (SELECT COUNT(*) FROM products WHERE in_phs = TRUE),
      'estimates_count', (SELECT COUNT(*) FROM estimates),
      'clients_count', (SELECT COUNT(*) FROM clients)
    ) INTO result;
    
    RETURN result;
  END;
  $$;
