

-- ==========================================
-- FILE: 00_full_database_schema.sql
-- ==========================================

-- =============================================================================
-- File: supabase_setup.sql
-- =============================================================================
-- ============================================================
-- ESTIMATE APP - SUPABASE DATABASE SETUP
-- Run this entire script in Supabase SQL Editor
-- ============================================================

-- 1. PRODUCTS TABLE
CREATE TABLE IF NOT EXISTS products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  product_name TEXT NOT NULL,
  length NUMERIC(10,2),
  width NUMERIC(10,2),
  unit TEXT NOT NULL DEFAULT 'Nos.',
  rate NUMERIC(12,2) NOT NULL DEFAULT 0,
  calculation_type TEXT NOT NULL DEFAULT 'QUANTITY',
  has_stock BOOLEAN DEFAULT FALSE,
  stock NUMERIC(12,2) DEFAULT 0,
  min_stock NUMERIC(12,2) DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration for existing database:
ALTER TABLE products ADD COLUMN IF NOT EXISTS min_stock NUMERIC(12,2) DEFAULT 5;
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_remark BOOLEAN DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS has_discount BOOLEAN DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS keyword VARCHAR(255);

-- Update check constraint to allow FEET
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_calculation_type_check;
ALTER TABLE products ADD CONSTRAINT products_calculation_type_check CHECK (calculation_type IN ('QUANTITY', 'SQFT', 'INCH', 'FEET'));
-- 2. SITES TABLE (for site name autocomplete)
CREATE TABLE IF NOT EXISTS sites (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    site_name TEXT NOT NULL UNIQUE,
    platform TEXT NOT NULL DEFAULT 'ccai' CHECK (platform IN ('ccai', 'dc', 'laminea', 'phs')),
    created_at TIMESTAMPTZ DEFAULT NOW()
  );

-- 3. BILL NUMBER SEQUENCE (safe atomic increment)
CREATE SEQUENCE IF NOT EXISTS bill_number_seq START WITH 1;

-- 4. ESTIMATES TABLE
CREATE TABLE IF NOT EXISTS estimates (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  bill_number INTEGER NOT NULL UNIQUE,
  bill_date TEXT NOT NULL,
  transport TEXT,
  client_name TEXT,
  client_mobile TEXT,
  prepared_by TEXT,
  site_name TEXT,
  type TEXT NOT NULL DEFAULT 'ESTIMATE',
  total_nos NUMERIC(12,2) DEFAULT 0,
  total_quantity NUMERIC(12,2) DEFAULT 0,
  grand_total NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration for existing database:
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'ESTIMATE';
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS client_name TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS client_mobile TEXT;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS prepared_by TEXT;

-- Update CHECK constraints to allow 'INCH' calculation type
ALTER TABLE products DROP CONSTRAINT IF EXISTS products_calculation_type_check;
ALTER TABLE products ADD CONSTRAINT products_calculation_type_check CHECK (calculation_type IN ('SQFT', 'INCH', 'QUANTITY'));

ALTER TABLE estimate_items DROP CONSTRAINT IF EXISTS estimate_items_calculation_type_snapshot_check;
ALTER TABLE estimate_items ADD CONSTRAINT estimate_items_calculation_type_snapshot_check CHECK (calculation_type_snapshot IN ('SQFT', 'INCH', 'QUANTITY'));

-- 5. ESTIMATE ITEMS TABLE (snapshots of product at time of estimate)
CREATE TABLE IF NOT EXISTS estimate_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  estimate_id UUID NOT NULL REFERENCES estimates(id) ON DELETE CASCADE,
  serial_number INTEGER NOT NULL,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name_snapshot TEXT NOT NULL,
  length_snapshot NUMERIC(10,2),
  width_snapshot NUMERIC(10,2),
  nos NUMERIC(12,2),
  quantity NUMERIC(12,2),
  unit_snapshot TEXT,
  rate NUMERIC(12,2) NOT NULL,
  calculation_type_snapshot TEXT NOT NULL DEFAULT 'QUANTITY',
  amount NUMERIC(12,2) NOT NULL DEFAULT 0,
  remark TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Migration for existing database:
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS remark TEXT;
ALTER TABLE estimate_items ADD COLUMN IF NOT EXISTS discount_percent NUMERIC(5,2) DEFAULT 0;

-- Update check constraint to allow FEET
ALTER TABLE estimate_items DROP CONSTRAINT IF EXISTS estimate_items_calculation_type_snapshot_check;
ALTER TABLE estimate_items ADD CONSTRAINT estimate_items_calculation_type_snapshot_check CHECK (calculation_type_snapshot IN ('QUANTITY', 'SQFT', 'INCH', 'FEET'));

-- 6. SAFE BILL NUMBER FUNCTION (atomic, no duplicates)
CREATE OR REPLACE FUNCTION get_next_bill_number()
RETURNS INTEGER
LANGUAGE plpgsql
AS $$
DECLARE
  next_num INTEGER;
BEGIN
  SELECT NEXTVAL('bill_number_seq') INTO next_num;
  RETURN next_num;
END;
$$;

-- 7. SEED BILL SEQUENCE to start after any existing estimates
-- (If this is fresh, starts at 1. Change 290 below to start from a specific number)
SELECT SETVAL('bill_number_seq', 290);

-- 8. AUTO-UPDATE updated_at TRIGGER
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER products_updated_at
  BEFORE UPDATE ON products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE OR REPLACE TRIGGER estimates_updated_at
  BEFORE UPDATE ON estimates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- 9. DISABLE ROW LEVEL SECURITY (simple app, no auth needed)
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE sites DISABLE ROW LEVEL SECURITY;
ALTER TABLE estimates DISABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_items DISABLE ROW LEVEL SECURITY;

-- 10. SEED SAMPLE PRODUCTS (from your estimate image)
INSERT INTO products (product_name, length, width, unit, rate, calculation_type) VALUES
  ('C PLY 4 18 MM 7 x 4', 7, 4, 'Sq.Ft', 57.50, 'SQFT'),
  ('C PLY 4 12 MM 7 x 4', 7, 4, 'Sq.Ft', 48.00, 'SQFT'),
  ('25 MM BLOCK BOARD A GRADE CAL 7 x 4', 7, 4, 'Sq.Ft', 100.00, 'SQFT'),
  ('LAMINATE FABRIC 5027', NULL, NULL, 'Nos.', 460.00, 'QUANTITY'),
  ('FALCOFIX ULTRA MARINE', NULL, NULL, 'Nos.', 190.00, 'QUANTITY'),
  ('NAILS 14 X 1 3/4', NULL, NULL, 'Kg.', 130.00, 'QUANTITY'),
  ('NAILS 14 X 1 1/2', NULL, NULL, 'Kg.', 130.00, 'QUANTITY'),
  ('ABRO TAPE 40M ASIAN', NULL, NULL, 'Bundle', 190.00, 'QUANTITY')
ON CONFLICT DO NOTHING;

-- ============================================================
-- DONE! All tables, sequences, functions created successfully.
-- ============================================================


-- =============================================================================
-- File: rbac_migration.sql
-- =============================================================================
-- RBAC Migration Script
-- Run this in Supabase SQL Editor

-- 1. Create user_roles table
CREATE TABLE IF NOT EXISTS user_roles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'STAFF' CHECK (role IN ('ADMIN', 'STAFF')),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Create trigger to automatically add new auth users to user_roles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_roles (id, username, role, is_active)
  VALUES (
    NEW.id,
    SPLIT_PART(NEW.email, '@', 1), -- Extract username from username@estimateapp.local
    'STAFF',
    true
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Drop trigger if exists so we can recreate it
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 3. Disable RLS for user_roles so the client can query and update it easily
-- Note: In a production app with public signups, RLS should be enabled.
-- Since this is an internal business app, we disable RLS for simplicity.
ALTER TABLE user_roles DISABLE ROW LEVEL SECURITY;

-- 4. Set existing users to ADMIN (since the owner is the only one who has logged in so far)
-- We manually insert the existing auth.users into user_roles if they don't exist
INSERT INTO user_roles (id, username, role, is_active)
SELECT id, SPLIT_PART(email, '@', 1), 'ADMIN', true
FROM auth.users
ON CONFLICT (id) DO UPDATE SET role = 'ADMIN';

-- 5. RPC function to allow ADMINs to reset user passwords
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.admin_reset_password(target_user_id UUID, new_password TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify caller is an ADMIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE id = auth.uid() AND role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can reset passwords';
  END IF;

  -- Update the password in auth.users
  UPDATE auth.users 
  SET encrypted_password = crypt(new_password, gen_salt('bf'))
  WHERE id = target_user_id;
END;
$$;


-- =============================================================================
-- File: single_session_migration.sql
-- =============================================================================
-- Add current_session_token and session_expires_at to user_roles
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS current_session_token TEXT;
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS session_expires_at TIMESTAMPTZ;


-- =============================================================================
-- File: gst_migration.sql
-- =============================================================================
-- GST Migration for Estimates Table
-- Run this script in your Supabase SQL Editor

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS sub_total NUMERIC(12,2) DEFAULT 0;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5,2) DEFAULT 0;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(12,2) DEFAULT 0;


-- =============================================================================
-- File: ledger_migration.sql
-- =============================================================================
-- ============================================================
-- ESTIMATE APP - CLIENT LEDGER SYSTEM UPDATE
-- Run this entire script in Supabase SQL Editor
-- ============================================================

-- Ensure the update function exists
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 1. CLIENTS TABLE
CREATE TABLE IF NOT EXISTS clients (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  mobile TEXT,
  opening_balance NUMERIC(12,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Auto-update updated_at for clients
CREATE OR REPLACE TRIGGER clients_updated_at
  BEFORE UPDATE ON clients
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

ALTER TABLE clients DISABLE ROW LEVEL SECURITY;

-- 2. PAYMENTS TABLE
CREATE TABLE IF NOT EXISTS payments (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  payment_date TEXT NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  payment_mode TEXT,
  reference_number TEXT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE payments DISABLE ROW LEVEL SECURITY;

-- 3. LINK ESTIMATES TO CLIENTS
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS client_id UUID REFERENCES clients(id) ON DELETE SET NULL;

-- 4. MIGRATE EXISTING ESTIMATES (Auto-create clients based on existing names)
-- Insert unique client names from existing estimates (ignoring null/empty)
INSERT INTO clients (name, mobile)
SELECT DISTINCT TRIM(client_name), MAX(client_mobile)
FROM estimates
WHERE client_name IS NOT NULL AND TRIM(client_name) != ''
GROUP BY TRIM(client_name)
ON CONFLICT (name) DO NOTHING;

-- Update the client_id on all existing estimates
UPDATE estimates e
SET client_id = c.id
FROM clients c
WHERE TRIM(e.client_name) = c.name;

-- ============================================================
-- DONE! Ledger tables created and existing estimates linked.
-- ============================================================


-- =============================================================================
-- File: client_purchases_migration.sql
-- =============================================================================
-- ============================================================
-- ESTIMATE APP - PARTYWISE STOCK MIGRATION
-- Run this script in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS client_purchases (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  product_id UUID REFERENCES products(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  unit TEXT,
  rate NUMERIC,
  amount NUMERIC,
  bill_number TEXT,
  bill_date TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disable Row Level Security so the app can insert/read freely
ALTER TABLE client_purchases DISABLE ROW LEVEL SECURITY;

-- Optional: Create an index to speed up lookups by client_id
CREATE INDEX IF NOT EXISTS idx_client_purchases_client_id ON client_purchases(client_id);


-- =============================================================================
-- File: product_group_migration.sql
-- =============================================================================
-- ============================================================
-- ESTIMATE APP - PRODUCT GROUP MIGRATION
-- Run this script in Supabase SQL Editor
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS product_group TEXT DEFAULT 'Uncategorized';


-- =============================================================================
-- File: delete_user_migration.sql
-- =============================================================================
-- Add RPC function to allow ADMINs to delete users
CREATE OR REPLACE FUNCTION public.admin_delete_user(target_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify caller is an ADMIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_roles 
    WHERE id = auth.uid() AND role = 'ADMIN'
  ) THEN
    RAISE EXCEPTION 'Unauthorized: Only admins can delete users';
  END IF;

  -- Cannot delete yourself
  IF auth.uid() = target_user_id THEN
    RAISE EXCEPTION 'Cannot delete your own account';
  END IF;

  -- Delete the user from auth.users (this will cascade to user_roles)
  DELETE FROM auth.users WHERE id = target_user_id;
END;
$$;


-- =============================================================================
-- File: stock_history_migration.sql
-- =============================================================================
-- Add columns for decoupling from estimates table
ALTER TABLE stock_history
ADD COLUMN bill_number VARCHAR(255),
ADD COLUMN site_name VARCHAR(255);

-- Update the foreign key to SET NULL instead of CASCADE (if it exists)
-- This ensures that when an estimate is deleted, the stock history remains
ALTER TABLE stock_history
DROP CONSTRAINT IF EXISTS stock_history_estimate_id_fkey;

ALTER TABLE stock_history
ADD CONSTRAINT stock_history_estimate_id_fkey
FOREIGN KEY (estimate_id) REFERENCES estimates(id) ON DELETE SET NULL;


-- =============================================================================
-- File: selection_sheets_migration.sql
-- =============================================================================
-- ============================================================
-- ESTIMATE APP - SELECTION SHEETS MIGRATION
-- Run this script in Supabase SQL Editor
-- ============================================================

CREATE TABLE IF NOT EXISTS selection_sheets (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_name TEXT NOT NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Disable Row Level Security so the app can insert/read freely
ALTER TABLE selection_sheets DISABLE ROW LEVEL SECURITY;

-- Optional: Create an index to speed up lookups by client_name
CREATE INDEX IF NOT EXISTS idx_selection_sheets_client_name ON selection_sheets(client_name);

-- ============================================================
-- BUCKET SETUP (If Supabase allows doing this via SQL)
-- If this fails, you will need to manually create a public bucket
-- named 'selection_images' in the Supabase Dashboard -> Storage
-- ============================================================

INSERT INTO storage.buckets (id, name, public) 
VALUES ('selection_images', 'selection_images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public access to read images
CREATE POLICY "Public Access" 
ON storage.objects FOR SELECT 
USING (bucket_id = 'selection_images');

-- Allow ONLY authenticated users to insert images
CREATE POLICY "Allow Uploads" 
ON storage.objects FOR INSERT 
TO authenticated
WITH CHECK (bucket_id = 'selection_images');

-- Allow ONLY authenticated users to delete images
CREATE POLICY "Allow Deletions" 
ON storage.objects FOR DELETE 
TO authenticated 
USING (bucket_id = 'selection_images');


-- =============================================================================
-- File: client_sites_migration.sql
-- =============================================================================
-- Migration: Create client_sites table
CREATE TABLE IF NOT EXISTS client_sites (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
  site_name TEXT NOT NULL,
  party_name TEXT,
  location TEXT,
  carpenter TEXT,
  carpenter_phone TEXT,
  start_date DATE,
  end_date DATE,
  status TEXT DEFAULT 'ACTIVE',
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Trigger to update updated_at automatically
CREATE OR REPLACE TRIGGER client_sites_updated_at
  BEFORE UPDATE ON client_sites
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Disable RLS for simplicity as this app relies on client-side logic + basic Auth checks
ALTER TABLE client_sites DISABLE ROW LEVEL SECURITY;


-- =============================================================================
-- File: rls_migration.sql
-- =============================================================================
-- =============================================================================
-- CCAI ESTIMATE APP - RLS MIGRATION
-- Safely enable Row Level Security (RLS) across all tables
-- =============================================================================

-- 1. Create SECURITY DEFINER role-check functions
-- These run as the database owner (bypassing RLS) to prevent infinite recursion
-- when policies need to check a user's role in the user_roles table.

CREATE OR REPLACE FUNCTION public.is_active_staff()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles 
    WHERE id = auth.uid() 
      AND is_active = true
      AND session_expires_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM user_roles 
    WHERE id = auth.uid() 
      AND role = 'ADMIN' 
      AND is_active = true
      AND session_expires_at > now()
  );
$$;

CREATE OR REPLACE FUNCTION public.update_my_session_token(new_token text, expires_at timestamptz DEFAULT NULL)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE user_roles 
  SET current_session_token = new_token,
      session_expires_at = CASE 
        WHEN new_token IS NULL THEN NULL 
        ELSE COALESCE(expires_at, now() + interval '1 day') 
      END
  WHERE id = auth.uid();
$$;

-- 2. Enable RLS on all tables
ALTER TABLE user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE sites ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimates ENABLE ROW LEVEL SECURITY;
ALTER TABLE estimate_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE clients ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_purchases ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE selection_sheets ENABLE ROW LEVEL SECURITY;
ALTER TABLE client_sites ENABLE ROW LEVEL SECURITY;

-- 3. Drop existing policies to prevent conflicts (idempotent)
DO $$ 
DECLARE 
  t text;
BEGIN 
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS "Allow active staff full access" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Users can read own role" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins can read all roles" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins can update roles" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "Admins can delete roles" ON %I', t);
  END LOOP;
END $$;

-- 4. Apply Universal Business Policy to all business tables
-- This allows STAFF and ADMIN full CRUD access to all operational data
DO $$ 
DECLARE
  tables text[] := ARRAY[
    'products', 'sites', 'estimates', 'estimate_items', 'clients', 
    'payments', 'client_purchases', 'stock_history', 'selection_sheets', 
    'client_sites'
  ];
  t text;
BEGIN
  FOREACH t IN ARRAY tables
  LOOP
    EXECUTE format(
      'CREATE POLICY "Allow active staff full access" ON %I ' ||
      'FOR ALL TO authenticated ' ||
      'USING (public.is_active_staff()) ' ||
      'WITH CHECK (public.is_active_staff());',
      t
    );
  END LOOP;
END $$;

-- 5. Apply Specific Policies for user_roles table
-- STAFF can read their own role (so login works)
CREATE POLICY "Users can read own role" 
  ON user_roles 
  FOR SELECT 
  TO authenticated 
  USING (auth.uid() = id);

-- ADMIN can read all roles
CREATE POLICY "Admins can read all roles" 
  ON user_roles 
  FOR SELECT 
  TO authenticated 
  USING (public.is_admin());

-- ADMIN can update roles (activate/deactivate, change role)
CREATE POLICY "Admins can update roles" 
  ON user_roles 
  FOR UPDATE 
  TO authenticated 
  USING (public.is_admin());

-- ADMIN can delete roles
CREATE POLICY "Admins can delete roles" 
  ON user_roles 
  FOR DELETE 
  TO authenticated 
  USING (public.is_admin());

-- (Insert is handled by the handle_new_user trigger which runs as SECURITY DEFINER)

-- =============================================================================
-- Migration Complete
-- =============================================================================


-- ============================================================
-- ESTIMATE APP - CATALOGUE SETUP
-- Run this script in Supabase SQL Editor
-- ============================================================

-- 1. CATALOGUE ITEMS TABLE (for inventory dropdown)
CREATE TABLE IF NOT EXISTS catalogue_items (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  item_name TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE catalogue_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users on catalogue_items" 
  ON catalogue_items FOR ALL TO authenticated 
  USING (true) WITH CHECK (true);

-- 2. CATALOGUE TABLE (for lent items)
CREATE TABLE IF NOT EXISTS catalogue (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  lent_date DATE NOT NULL,
  client_name TEXT NOT NULL,
  location TEXT,
  inventory_item TEXT NOT NULL,
  quantity NUMERIC(12,2) DEFAULT 1,
  mobile TEXT,
  advance_amount NUMERIC(12,2) DEFAULT 0,
  is_returned BOOLEAN DEFAULT false,
  return_date DATE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE catalogue ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all for authenticated users on catalogue" 
  ON catalogue FOR ALL TO authenticated 
  USING (true) WITH CHECK (true);

-- 3. AUTO-UPDATE updated_at TRIGGER FOR CATALOGUE
CREATE OR REPLACE TRIGGER catalogue_updated_at
  BEFORE UPDATE ON catalogue
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- ============================================================
-- DONE! Catalogue tables and policies created.
-- ============================================================
-- ============================================================
-- ESTIMATE APP - CLIENT LEDGER UPGRADES
-- Run this script in Supabase SQL Editor
-- ============================================================

-- Add new columns to clients table
ALTER TABLE clients
ADD COLUMN IF NOT EXISTS company_name TEXT,
ADD COLUMN IF NOT EXISTS owner_name TEXT,
ADD COLUMN IF NOT EXISTS office_location TEXT,
ADD COLUMN IF NOT EXISTS secondary_mobile TEXT,
ADD COLUMN IF NOT EXISTS client_type TEXT DEFAULT 'GREEN';

-- ============================================================
-- DONE! Client tables updated successfully.
-- ============================================================
-- ============================================================
-- ESTIMATE APP - PREVIOUS BALANCE MIGRATION
-- Run this script in Supabase SQL Editor
-- ============================================================

-- 1. Add previous_balance column to estimates table
ALTER TABLE estimates
ADD COLUMN IF NOT EXISTS previous_balance NUMERIC(12,2) DEFAULT 0;

-- 2. Backfill existing estimates with their historically accurate previous balance
-- This ensures old bills freeze their ledger totals exactly as they were on their creation day.
WITH historical_balances AS (
  SELECT 
    e.id AS estimate_id,
    COALESCE(c.opening_balance, 0) 
    + COALESCE((
        SELECT SUM(grand_total) 
        FROM estimates past_e
        WHERE past_e.client_id = e.client_id 
          AND past_e.type IN ('ESTIMATE', 'DELETED_ESTIMATE')
          AND past_e.id != e.id
          AND (
            past_e.bill_date < e.bill_date 
            OR (past_e.bill_date = e.bill_date AND past_e.created_at < e.created_at)
          )
    ), 0)
    - COALESCE((
        SELECT SUM(grand_total) 
        FROM estimates past_r
        WHERE past_r.client_id = e.client_id 
          AND past_r.type IN ('RETURN', 'DELETED_RETURN')
          AND past_r.id != e.id
          AND (
            past_r.bill_date < e.bill_date 
            OR (past_r.bill_date = e.bill_date AND past_r.created_at < e.created_at)
          )
    ), 0)
    - COALESCE((
        SELECT SUM(amount) 
        FROM payments p
        WHERE p.client_id = e.client_id 
          AND (
            p.payment_date < e.bill_date 
            OR (p.payment_date = e.bill_date AND p.created_at < e.created_at)
          )
    ), 0) AS calculated_prev_balance
  FROM estimates e
  LEFT JOIN clients c ON c.id = e.client_id
  WHERE e.client_id IS NOT NULL
)
UPDATE estimates
SET previous_balance = hb.calculated_prev_balance
FROM historical_balances hb
WHERE estimates.id = hb.estimate_id;

-- ============================================================
-- DONE! Estimates table updated successfully.
-- ============================================================
-- ============================================================
-- ESTIMATE APP - BALANCE FIX MIGRATION (DATE PARSING)
-- Run this script in Supabase SQL Editor to correctly sort DD/MM/YYYY strings!
-- ============================================================

-- 1. Create a robust date parsing function to handle mixed date formats
CREATE OR REPLACE FUNCTION parse_custom_date(d text) RETURNS date AS $$
BEGIN
  IF d IS NULL OR d = '' THEN RETURN '1970-01-01'::date; END IF;
  
  -- If it starts with YYYY-MM-DD (e.g., 2026-08-14)
  IF d ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN
    RETURN substring(d FROM 1 FOR 10)::date;
  END IF;

  -- Otherwise assume DD/MM/YYYY or DD-MM-YYYY
  -- REPLACE safely standardizes slashes to dashes, though TO_DATE handles both
  RETURN TO_DATE(substring(d FROM 1 FOR 10), 'DD/MM/YYYY');
EXCEPTION WHEN OTHERS THEN
  -- Fallback to epoch if unparseable
  RETURN '1970-01-01'::date;
END;
$$ LANGUAGE plpgsql;

-- 2. Recalculate historical balances properly using actual date comparisons
WITH historical_balances AS (
  SELECT 
    e.id AS estimate_id,
    COALESCE(c.opening_balance, 0) 
    + COALESCE((
        SELECT SUM(grand_total) 
        FROM estimates past_e
        WHERE past_e.client_id = e.client_id 
          AND past_e.type IN ('ESTIMATE', 'DELETED_ESTIMATE')
          AND past_e.id != e.id
          AND (
            parse_custom_date(past_e.bill_date) < parse_custom_date(e.bill_date)
            OR (parse_custom_date(past_e.bill_date) = parse_custom_date(e.bill_date) AND past_e.created_at < e.created_at)
          )
    ), 0)
    - COALESCE((
        SELECT SUM(grand_total) 
        FROM estimates past_r
        WHERE past_r.client_id = e.client_id 
          AND past_r.type IN ('RETURN', 'DELETED_RETURN')
          AND past_r.id != e.id
          AND (
            parse_custom_date(past_r.bill_date) < parse_custom_date(e.bill_date)
            OR (parse_custom_date(past_r.bill_date) = parse_custom_date(e.bill_date) AND past_r.created_at < e.created_at)
          )
    ), 0)
    - COALESCE((
        SELECT SUM(amount) 
        FROM payments p
        WHERE p.client_id = e.client_id 
          AND (
            parse_custom_date(p.payment_date) < parse_custom_date(e.bill_date)
            OR (parse_custom_date(p.payment_date) = parse_custom_date(e.bill_date) AND p.created_at < e.created_at)
          )
    ), 0) AS calculated_prev_balance
  FROM estimates e
  LEFT JOIN clients c ON c.id = e.client_id
  WHERE e.client_id IS NOT NULL
)
UPDATE estimates
SET previous_balance = hb.calculated_prev_balance
FROM historical_balances hb
WHERE estimates.id = hb.estimate_id;

-- ============================================================
-- DONE! All previous_balances have been successfully restored!
-- ============================================================
ALTER TABLE catalogue_items DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- Added User Alias (Prepared By Default)
-- ============================================================
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS alias TEXT;

-- ============================================================
-- RPC for space and case insensitive matching of alternative codes
-- ============================================================
CREATE OR REPLACE FUNCTION search_laminea_availability_codes(search_codes TEXT[])
RETURNS TABLE(alternative_code TEXT, product_id UUID, is_active BOOLEAN)
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT alternative_code, product_id, is_active
  FROM laminea_product_codes
  WHERE is_active = true
    AND REPLACE(UPPER(alternative_code), ' ', '') = ANY (
      SELECT REPLACE(UPPER(c), ' ', '') FROM UNNEST(search_codes) c
    );
$$;


-- ==========================================
-- FILE: 01_platform_migration.sql
-- ==========================================

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



-- ==========================================
-- FILE: 02_rename_materia_to_laminea.sql
-- ==========================================

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
      v_prefix INTEGER;
      v_max_val INTEGER;
      v_next_val INTEGER;
  BEGIN
      -- prefix format: YYMM (e.g. 2610 for Oct 2026)
      v_prefix := TO_CHAR(CURRENT_DATE, 'YYMM')::INTEGER;
      
      -- Find max for the given platform that starts with this prefix
      SELECT MAX(bill_number) INTO v_max_val
      FROM estimates
      WHERE platform = p_platform
        AND bill_number >= (v_prefix * 1000)
        AND bill_number < ((v_prefix + 1) * 1000);
        
      IF v_max_val IS NULL THEN
          -- First bill of the month: 2610001
          v_next_val := (v_prefix * 1000) + 1;
      ELSE
          v_next_val := v_max_val + 1;
      END IF;
      
      RETURN v_next_val;
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


-- ==========================================
-- FILE: 03_laminea_alternative_codes.sql
-- ==========================================

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
        ON DELETE CASCADE,
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
    IF TG_OP = 'UPDATE' THEN
        -- Allow updates if they are only setting foreign keys to NULL (due to ON DELETE SET NULL)
        IF NEW.id = OLD.id 
           AND NEW.action = OLD.action 
           AND NEW.alternative_code = OLD.alternative_code
           AND NEW.reason IS NOT DISTINCT FROM OLD.reason
           AND NEW.import_batch_id IS NOT DISTINCT FROM OLD.import_batch_id
           AND NEW.created_at = OLD.created_at
           AND (NEW.previous_product_id IS NOT DISTINCT FROM OLD.previous_product_id OR NEW.previous_product_id IS NULL)
           AND (NEW.new_product_id IS NOT DISTINCT FROM OLD.new_product_id OR NEW.new_product_id IS NULL)
           AND (NEW.actor IS NOT DISTINCT FROM OLD.actor OR NEW.actor IS NULL)
        THEN
            RETURN NEW;
        END IF;
    END IF;

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


-- ==========================================
-- FILE: 04_process_estimate_atomic_rpc.sql
-- ==========================================

BEGIN;

-- =============================================================================
-- File: 04_process_estimate_atomic_rpc_fixed.sql
-- Description: Atomic Estimate lifecycle RPC used after
--              03_laminea_alternative_codes.sql and its security patch.
--
-- Important deployment note:
--   Deploy this RPC before changing the frontend. Keep the existing direct-write
--   RLS policies until the frontend has been fully migrated and verified. Direct
--   estimate/stock writes should be locked down in a later cutover migration.
-- =============================================================================

-- Remove obsolete overloads from earlier drafts so PostgREST exposes only the
-- final signature below.
DROP FUNCTION IF EXISTS public.process_estimate_atomic(
    UUID, TEXT, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN
);

DROP FUNCTION IF EXISTS public.process_estimate_atomic(
    TEXT, UUID, TEXT, TEXT, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT,
    JSONB, JSONB, NUMERIC
);

DROP FUNCTION IF EXISTS public.process_estimate_atomic(
    TEXT, UUID, UUID, TEXT, TEXT, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT,
    TEXT, JSONB, JSONB, NUMERIC
);

CREATE FUNCTION public.process_estimate_atomic(
    p_action TEXT,
    p_estimate_id UUID,
    p_idempotency_key UUID,
    p_platform TEXT,
    p_doc_type TEXT,
    -- Retained in the signature for frontend compatibility. New document
    -- numbers are always generated inside this RPC; this value is ignored.
    p_bill_number INTEGER DEFAULT NULL,
    p_bill_date TEXT DEFAULT NULL,
    p_client_id UUID DEFAULT NULL,
    p_client_name TEXT DEFAULT NULL,
    p_client_mobile TEXT DEFAULT NULL,
    p_prepared_by TEXT DEFAULT NULL,
    p_order_by TEXT DEFAULT NULL,
    p_site_name TEXT DEFAULT NULL,
    p_totals JSONB DEFAULT NULL,
    p_items JSONB DEFAULT NULL,
    p_previous_balance NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_est_id UUID;
    v_bill_num INTEGER;
    v_old_doc_type TEXT;

    v_item JSONB;
    v_new_item JSONB;
    v_old_items JSONB := '[]'::JSONB;
    v_new_items JSONB := '[]'::JSONB;
    v_idx INTEGER := 1;

    v_input_pid UUID;
    v_pid UUID;
    v_product_name TEXT;
    v_platform_enabled BOOLEAN;
    v_has_stock BOOLEAN;
    v_alt_code TEXT;
    v_actual_code TEXT;
    v_calc_type TEXT;
    v_unit TEXT;
    v_remark TEXT;

    v_length NUMERIC;
    v_width NUMERIC;
    v_nos NUMERIC;
    v_quantity NUMERIC;
    v_rate NUMERIC;
    v_discount NUMERIC;
    v_amount NUMERIC;
    v_qty NUMERIC;

    v_total_nos NUMERIC;
    v_total_quantity NUMERIC;
    v_sub_total NUMERIC;
    v_gst_percent NUMERIC;
    v_gst_amount NUMERIC;
    v_grand_total NUMERIC;

    v_old_effect NUMERIC;
    v_new_effect NUMERIC;
    v_delta NUMERIC;
    v_product_ids UUID[];
    v_history_type TEXT;
    v_rec RECORD;
BEGIN
    -- -------------------------------------------------------------------------
    -- Authentication and request normalization
    -- -------------------------------------------------------------------------
    IF public.is_active_staff() IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Unauthorized: active staff session required.';
    END IF;

    p_action := UPPER(BTRIM(COALESCE(p_action, '')));
    p_platform := LOWER(BTRIM(COALESCE(p_platform, '')));
    p_doc_type := UPPER(BTRIM(COALESCE(p_doc_type, '')));

    IF p_action NOT IN ('SAVE', 'DELETE', 'REVERT') THEN
        RAISE EXCEPTION 'Invalid action: %', p_action;
    END IF;

    IF p_platform NOT IN ('ccai', 'dc', 'laminea', 'phs') THEN
        RAISE EXCEPTION 'Invalid platform: %', p_platform;
    END IF;

    IF p_action = 'SAVE' AND p_doc_type NOT IN ('ESTIMATE', 'QUOTATION', 'RETURN') THEN
        RAISE EXCEPTION 'Invalid document type for SAVE: %', p_doc_type;
    END IF;

    -- -------------------------------------------------------------------------
    -- Idempotency for document creation
    --
    -- The advisory transaction lock closes the SELECT/INSERT race. The unique
    -- constraint on estimates.idempotency_key remains the final safeguard.
    -- -------------------------------------------------------------------------
    IF p_action = 'SAVE' AND p_estimate_id IS NULL THEN
        IF p_idempotency_key IS NULL THEN
            RAISE EXCEPTION 'Idempotency key is required when creating a document.';
        END IF;

        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(p_idempotency_key::TEXT, 0)
        );

        SELECT e.id, e.bill_number
        INTO v_est_id, v_bill_num
        FROM public.estimates e
        WHERE e.idempotency_key = p_idempotency_key
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', TRUE,
                'estimate_id', v_est_id,
                'bill_number', v_bill_num,
                'message', 'Already processed'
            );
        END IF;
    END IF;

    -- =========================================================================
    -- REVERT: ESTIMATE -> QUOTATION
    -- =========================================================================
    IF p_action = 'REVERT' THEN
        IF p_estimate_id IS NULL THEN
            RAISE EXCEPTION 'Estimate ID is required for REVERT.';
        END IF;

        SELECT e.type, e.bill_number, e.site_name
        INTO v_old_doc_type, v_bill_num, p_site_name
        FROM public.estimates e
        WHERE e.id = p_estimate_id
          AND e.platform = p_platform
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Estimate not found on this platform.';
        END IF;

        IF v_old_doc_type = 'QUOTATION' THEN
            RETURN jsonb_build_object('success', TRUE, 'message', 'Already a quotation');
        END IF;

        IF v_old_doc_type <> 'ESTIMATE' THEN
            RAISE EXCEPTION 'Only an ESTIMATE can be reverted to QUOTATION.';
        END IF;

        v_product_ids := ARRAY(
            SELECT DISTINCT ei.product_id
            FROM public.estimate_items ei
            WHERE ei.estimate_id = p_estimate_id
              AND ei.product_id IS NOT NULL
            ORDER BY ei.product_id
        );

        IF COALESCE(array_length(v_product_ids, 1), 0) > 0 THEN
            FOR v_rec IN
                SELECT p.id, COALESCE(p.stock, 0) AS stock
                FROM public.products p
                WHERE p.id = ANY(v_product_ids)
                  AND p.has_stock = TRUE
                ORDER BY p.id
                FOR NO KEY UPDATE
            LOOP
                SELECT COALESCE(SUM(
                    CASE
                        WHEN ei.calculation_type_snapshot IN ('SQFT', 'INCH', 'FEET')
                            THEN COALESCE(ei.nos, 0)
                        ELSE COALESCE(ei.quantity, 0)
                    END
                ), 0)
                INTO v_delta
                FROM public.estimate_items ei
                WHERE ei.estimate_id = p_estimate_id
                  AND ei.product_id = v_rec.id;

                IF v_delta > 0 THEN
                    UPDATE public.products
                    SET stock = COALESCE(stock, 0) + v_delta
                    WHERE id = v_rec.id;

                    -- Preserve each contributing alternative code separately.
                    INSERT INTO public.stock_history (
                        platform, product_id, change_type, quantity_changed,
                        estimate_id, bill_number, site_name, alternative_code
                    )
                    SELECT
                        p_platform,
                        v_rec.id,
                        'REVERT_TO_QUOTATION',
                        SUM(CASE
                            WHEN ei.calculation_type_snapshot IN ('SQFT', 'INCH', 'FEET')
                                THEN COALESCE(ei.nos, 0)
                            ELSE COALESCE(ei.quantity, 0)
                        END),
                        p_estimate_id,
                        v_bill_num::TEXT,
                        p_site_name,
                        NULLIF(public.normalize_laminea_code(ei.alternative_code_snapshot), '')
                    FROM public.estimate_items ei
                    WHERE ei.estimate_id = p_estimate_id
                      AND ei.product_id = v_rec.id
                    GROUP BY NULLIF(public.normalize_laminea_code(ei.alternative_code_snapshot), '')
                    HAVING SUM(CASE
                        WHEN ei.calculation_type_snapshot IN ('SQFT', 'INCH', 'FEET')
                            THEN COALESCE(ei.nos, 0)
                        ELSE COALESCE(ei.quantity, 0)
                    END) <> 0;
                END IF;
            END LOOP;
        END IF;

        DELETE FROM public.client_purchases
        WHERE bill_number = v_bill_num::TEXT
          AND platform = p_platform;

        UPDATE public.estimates
        SET type = 'QUOTATION',
            is_archived = FALSE,
            updated_at = NOW()
        WHERE id = p_estimate_id;

        RETURN jsonb_build_object('success', TRUE, 'message', 'Reverted to quotation successfully');
    END IF;

    -- =========================================================================
    -- DELETE
    -- =========================================================================
    IF p_action = 'DELETE' THEN
        IF p_estimate_id IS NULL THEN
            RAISE EXCEPTION 'Estimate ID is required for DELETE.';
        END IF;

        SELECT e.type, e.bill_number, e.site_name
        INTO v_old_doc_type, v_bill_num, p_site_name
        FROM public.estimates e
        WHERE e.id = p_estimate_id
          AND e.platform = p_platform
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Estimate not found on this platform.';
        END IF;

        IF v_old_doc_type IN ('DELETED_ESTIMATE', 'DELETED_RETURN') THEN
            RETURN jsonb_build_object('success', TRUE, 'message', 'Already deleted');
        END IF;

        IF v_old_doc_type = 'QUOTATION' THEN
            DELETE FROM public.client_purchases
            WHERE bill_number = v_bill_num::TEXT
              AND platform = p_platform;

            DELETE FROM public.estimates
            WHERE id = p_estimate_id;

            RETURN jsonb_build_object('success', TRUE, 'message', 'Quotation deleted successfully');
        END IF;

        IF v_old_doc_type NOT IN ('ESTIMATE', 'RETURN') THEN
            RAISE EXCEPTION 'Unsupported document state for DELETE: %', v_old_doc_type;
        END IF;

        v_product_ids := ARRAY(
            SELECT DISTINCT ei.product_id
            FROM public.estimate_items ei
            WHERE ei.estimate_id = p_estimate_id
              AND ei.product_id IS NOT NULL
            ORDER BY ei.product_id
        );

        IF COALESCE(array_length(v_product_ids, 1), 0) > 0 THEN
            FOR v_rec IN
                SELECT p.id, COALESCE(p.stock, 0) AS stock
                FROM public.products p
                WHERE p.id = ANY(v_product_ids)
                  AND p.has_stock = TRUE
                ORDER BY p.id
                FOR NO KEY UPDATE
            LOOP
                SELECT COALESCE(SUM(
                    CASE
                        WHEN ei.calculation_type_snapshot IN ('SQFT', 'INCH', 'FEET')
                            THEN COALESCE(ei.nos, 0)
                        ELSE COALESCE(ei.quantity, 0)
                    END
                ), 0)
                INTO v_qty
                FROM public.estimate_items ei
                WHERE ei.estimate_id = p_estimate_id
                  AND ei.product_id = v_rec.id;

                IF v_qty > 0 THEN
                    v_delta := CASE
                        WHEN v_old_doc_type = 'ESTIMATE' THEN v_qty
                        ELSE -v_qty
                    END;

                    IF v_delta < 0 AND v_rec.stock + v_delta < 0 THEN
                        RAISE EXCEPTION
                            'Insufficient stock while deleting return. Product %, current %, required %',
                            v_rec.id, v_rec.stock, ABS(v_delta);
                    END IF;

                    UPDATE public.products
                    SET stock = COALESCE(stock, 0) + v_delta
                    WHERE id = v_rec.id;

                    v_history_type := CASE
                        WHEN v_old_doc_type = 'ESTIMATE' THEN 'ESTIMATE_DELETED_RESTORE'
                        ELSE 'RETURN_DELETED_DEDUCT'
                    END;

                    INSERT INTO public.stock_history (
                        platform, product_id, change_type, quantity_changed,
                        estimate_id, bill_number, site_name, alternative_code
                    )
                    SELECT
                        p_platform,
                        v_rec.id,
                        v_history_type,
                        SUM(CASE
                            WHEN ei.calculation_type_snapshot IN ('SQFT', 'INCH', 'FEET')
                                THEN COALESCE(ei.nos, 0)
                            ELSE COALESCE(ei.quantity, 0)
                        END) * CASE WHEN v_old_doc_type = 'ESTIMATE' THEN 1 ELSE -1 END,
                        p_estimate_id,
                        v_bill_num::TEXT,
                        p_site_name,
                        NULLIF(public.normalize_laminea_code(ei.alternative_code_snapshot), '')
                    FROM public.estimate_items ei
                    WHERE ei.estimate_id = p_estimate_id
                      AND ei.product_id = v_rec.id
                    GROUP BY NULLIF(public.normalize_laminea_code(ei.alternative_code_snapshot), '')
                    HAVING SUM(CASE
                        WHEN ei.calculation_type_snapshot IN ('SQFT', 'INCH', 'FEET')
                            THEN COALESCE(ei.nos, 0)
                        ELSE COALESCE(ei.quantity, 0)
                    END) <> 0;
                END IF;
            END LOOP;
        END IF;

        UPDATE public.estimates
        SET type = CASE
                WHEN v_old_doc_type = 'ESTIMATE' THEN 'DELETED_ESTIMATE'
                ELSE 'DELETED_RETURN'
            END,
            is_archived = TRUE,
            updated_at = NOW()
        WHERE id = p_estimate_id;

        UPDATE public.client_purchases
        SET is_archived = TRUE
        WHERE bill_number = v_bill_num::TEXT
          AND platform = p_platform;

        RETURN jsonb_build_object('success', TRUE, 'message', 'Deleted successfully');
    END IF;

    -- =========================================================================
    -- SAVE: validate items, then CREATE or UPDATE
    -- =========================================================================
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'SAVE requires items to be a JSON array.';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'SAVE requires at least one item.';
    END IF;

    IF jsonb_typeof(p_totals) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'SAVE requires a totals JSON object.';
    END IF;

    v_total_nos := COALESCE(NULLIF(BTRIM(p_totals->>'total_nos'), '')::NUMERIC, 0);
    v_total_quantity := COALESCE(NULLIF(BTRIM(p_totals->>'total_quantity'), '')::NUMERIC, 0);
    v_sub_total := COALESCE(NULLIF(BTRIM(p_totals->>'sub_total'), '')::NUMERIC, 0);
    v_gst_percent := COALESCE(NULLIF(BTRIM(p_totals->>'gst_percent'), '')::NUMERIC, 0);
    v_gst_amount := COALESCE(NULLIF(BTRIM(p_totals->>'gst_amount'), '')::NUMERIC, 0);
    v_grand_total := COALESCE(NULLIF(BTRIM(p_totals->>'grand_total'), '')::NUMERIC, 0);

    IF p_bill_date IS NULL OR BTRIM(p_bill_date) = '' THEN
        RAISE EXCEPTION 'Bill date is required for SAVE.';
    END IF;

    IF v_total_nos < 0 OR v_total_quantity < 0 OR v_sub_total < 0
       OR v_gst_percent < 0 OR v_gst_amount < 0 OR v_grand_total < 0 THEN
        RAISE EXCEPTION 'Document totals cannot be negative.';
    END IF;

    IF v_gst_percent > 100 THEN
        RAISE EXCEPTION 'GST percentage cannot exceed 100.';
    END IF;

    IF p_client_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.id = p_client_id
          AND c.platform = p_platform
    ) THEN
        RAISE EXCEPTION 'Client does not belong to this platform.';
    END IF;

    FOR v_item IN
        SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Every estimate item must be a JSON object.';
        END IF;

        v_input_pid := NULLIF(BTRIM(v_item->>'product_id'), '')::UUID;
        v_pid := v_input_pid;
        v_has_stock := NULL;
        v_alt_code := NULLIF(BTRIM(v_item->>'alternative_code_snapshot'), '');
        v_actual_code := NULLIF(BTRIM(v_item->>'actual_code_snapshot'), '');
        v_product_name := NULLIF(BTRIM(v_item->>'product_name_snapshot'), '');
        v_calc_type := UPPER(BTRIM(COALESCE(v_item->>'calculation_type_snapshot', '')));
        v_unit := NULLIF(BTRIM(v_item->>'unit_snapshot'), '');
        v_remark := NULLIF(BTRIM(v_item->>'remark'), '');

        v_length := NULLIF(BTRIM(v_item->>'length_snapshot'), '')::NUMERIC;
        v_width := NULLIF(BTRIM(v_item->>'width_snapshot'), '')::NUMERIC;
        v_nos := COALESCE(NULLIF(BTRIM(v_item->>'nos'), '')::NUMERIC, 0);
        v_quantity := COALESCE(NULLIF(BTRIM(v_item->>'quantity'), '')::NUMERIC, 0);
        v_rate := COALESCE(NULLIF(BTRIM(v_item->>'rate'), '')::NUMERIC, 0);
        v_discount := COALESCE(NULLIF(BTRIM(v_item->>'discount_percent'), '')::NUMERIC, 0);
        v_amount := COALESCE(NULLIF(BTRIM(v_item->>'amount'), '')::NUMERIC, 0);

        IF v_calc_type NOT IN ('QUANTITY', 'SQFT', 'INCH', 'FEET') THEN
            RAISE EXCEPTION 'Invalid calculation type for item %: %', v_idx, v_calc_type;
        END IF;

        IF v_length < 0 OR v_width < 0 OR v_nos < 0 OR v_quantity < 0
           OR v_rate < 0 OR v_amount < 0 OR v_discount < 0 OR v_discount > 100 THEN
            RAISE EXCEPTION 'Invalid negative value or discount for item %.', v_idx;
        END IF;

        v_qty := CASE
            WHEN v_calc_type IN ('SQFT', 'INCH', 'FEET') THEN v_nos
            ELSE v_quantity
        END;

        IF p_platform = 'laminea' THEN
            IF v_alt_code IS NOT NULL THEN
                SELECT
                    lpc.product_id,
                    lpc.alternative_code,
                    p.product_code,
                    p.product_name,
                    p.has_stock
                INTO
                    v_pid,
                    v_alt_code,
                    v_actual_code,
                    v_product_name,
                    v_has_stock
                FROM public.laminea_product_codes lpc
                JOIN public.products p ON p.id = lpc.product_id
                WHERE public.normalize_laminea_code(lpc.alternative_code)
                        = public.normalize_laminea_code(v_alt_code)
                  AND lpc.is_active = TRUE
                  AND p.in_laminea = TRUE
                  AND p.has_stock = TRUE
                  AND p.product_code IS NOT NULL
                  AND BTRIM(p.product_code) <> '';

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'No active Laminea mapping found for alternative code %.', v_alt_code;
                END IF;

                IF v_input_pid IS NOT NULL AND v_input_pid <> v_pid THEN
                    RAISE EXCEPTION 'Alternative code does not match the submitted product for item %.', v_idx;
                END IF;
            ELSIF v_input_pid IS NOT NULL THEN
                -- Every Product Master item enabled for Laminea is selectable.
                -- Alternative-code mappings are optional. A directly selected
                -- stock-managed product still participates in stock movement.
                SELECT
                    p.product_name,
                    p.in_laminea,
                    p.has_stock,
                    NULLIF(BTRIM(p.product_code), '')
                INTO
                    v_product_name,
                    v_platform_enabled,
                    v_has_stock,
                    v_actual_code
                FROM public.products p
                WHERE p.id = v_input_pid;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Product not found for item %.', v_idx;
                END IF;

                IF v_platform_enabled IS DISTINCT FROM TRUE THEN
                    RAISE EXCEPTION 'Product is not enabled for platform laminea.';
                END IF;

                -- No alternative code was selected. Keep it NULL so public
                -- outputs can omit this item/code; actual code is retained as
                -- an internal snapshot when Product Master provides one.
                v_pid := v_input_pid;
                v_alt_code := NULL;
            ELSIF v_actual_code IS NOT NULL THEN
                RAISE EXCEPTION 'Actual code cannot be supplied for an unmapped manual Laminea item.';
            END IF;
        ELSE
            -- Alternative/actual snapshots are exclusive to Laminea.
            v_alt_code := NULL;
            v_actual_code := NULL;

            IF v_pid IS NOT NULL THEN
                SELECT
                    p.product_name,
                    p.has_stock,
                    CASE p_platform
                        WHEN 'ccai' THEN p.in_ccai
                        WHEN 'dc' THEN p.in_dc
                        WHEN 'phs' THEN p.in_phs
                        ELSE FALSE
                    END
                INTO v_product_name, v_has_stock, v_platform_enabled
                FROM public.products p
                WHERE p.id = v_pid;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Product not found for item %.', v_idx;
                END IF;

                IF v_platform_enabled IS DISTINCT FROM TRUE THEN
                    RAISE EXCEPTION 'Product is not enabled for platform %.', p_platform;
                END IF;
            END IF;
        END IF;

        -- Product Master items get their name from the database. Manual items
        -- must provide one explicitly.
        IF v_product_name IS NULL THEN
            RAISE EXCEPTION 'Product name is required for item %.', v_idx;
        END IF;

        v_new_effect := CASE
            WHEN v_pid IS NULL OR v_has_stock IS DISTINCT FROM TRUE THEN 0
            WHEN p_doc_type = 'ESTIMATE' THEN -v_qty
            WHEN p_doc_type = 'RETURN' THEN v_qty
            ELSE 0
        END;

        v_new_item := jsonb_build_object(
            'serial_number', v_idx,
            'product_id', v_pid,
            'product_name_snapshot', v_product_name,
            'length_snapshot', v_length,
            'width_snapshot', v_width,
            'nos', v_nos,
            'quantity', v_quantity,
            'unit_snapshot', v_unit,
            'rate', v_rate,
            'discount_percent', v_discount,
            'calculation_type_snapshot', v_calc_type,
            'amount', v_amount,
            'remark', v_remark,
            'actual_code_snapshot', v_actual_code,
            'alternative_code_snapshot', v_alt_code,
            'new_effect', v_new_effect
        );

        v_new_items := v_new_items || jsonb_build_array(v_new_item);
        v_idx := v_idx + 1;
    END LOOP;

    -- Lock and capture the current version only after the complete replacement
    -- payload has passed validation.
    IF p_estimate_id IS NOT NULL THEN
        v_est_id := p_estimate_id;

        SELECT e.type, e.bill_number
        INTO v_old_doc_type, v_bill_num
        FROM public.estimates e
        WHERE e.id = v_est_id
          AND e.platform = p_platform
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Estimate not found on this platform.';
        END IF;

        IF v_old_doc_type IN ('DELETED_ESTIMATE', 'DELETED_RETURN') THEN
            RAISE EXCEPTION 'Deleted documents cannot be edited.';
        END IF;

        IF v_old_doc_type NOT IN ('ESTIMATE', 'QUOTATION', 'RETURN') THEN
            RAISE EXCEPTION 'Unsupported existing document type: %', v_old_doc_type;
        END IF;

        SELECT COALESCE(
            jsonb_agg(to_jsonb(ei) ORDER BY ei.serial_number),
            '[]'::JSONB
        )
        INTO v_old_items
        FROM public.estimate_items ei
        WHERE ei.estimate_id = v_est_id;

        DELETE FROM public.estimate_items
        WHERE estimate_id = v_est_id;

        UPDATE public.estimates
        SET bill_date = p_bill_date,
            transport = UPPER(BTRIM(p_client_name)),
            client_name = UPPER(BTRIM(p_client_name)),
            client_mobile = BTRIM(p_client_mobile),
            order_by = UPPER(BTRIM(p_order_by)),
            client_id = p_client_id,
            prepared_by = UPPER(BTRIM(p_prepared_by)),
            site_name = NULLIF(UPPER(BTRIM(p_site_name)), ''),
            type = p_doc_type,
            total_nos = v_total_nos,
            total_quantity = v_total_quantity,
            sub_total = v_sub_total,
            gst_percent = v_gst_percent,
            gst_amount = v_gst_amount,
            grand_total = v_grand_total,
            previous_balance = COALESCE(p_previous_balance, 0),
            is_archived = FALSE,
            updated_at = NOW()
        WHERE id = v_est_id;
    ELSE
        -- p_bill_number is deliberately ignored. The database owns numbering.
        v_bill_num := public.get_next_bill_number(p_platform)::INTEGER;

        INSERT INTO public.estimates (
            bill_number, platform, platform_estimate_number, bill_date,
            transport, client_name, client_mobile, order_by, client_id,
            prepared_by, site_name, type, idempotency_key,
            total_nos, total_quantity, sub_total, gst_percent, gst_amount,
            grand_total, previous_balance, is_archived
        ) VALUES (
            v_bill_num,
            p_platform,
            v_bill_num,
            p_bill_date,
            UPPER(BTRIM(p_client_name)),
            UPPER(BTRIM(p_client_name)),
            BTRIM(p_client_mobile),
            UPPER(BTRIM(p_order_by)),
            p_client_id,
            UPPER(BTRIM(p_prepared_by)),
            NULLIF(UPPER(BTRIM(p_site_name)), ''),
            p_doc_type,
            p_idempotency_key,
            v_total_nos,
            v_total_quantity,
            v_sub_total,
            v_gst_percent,
            v_gst_amount,
            v_grand_total,
            COALESCE(p_previous_balance, 0),
            FALSE
        )
        RETURNING id INTO v_est_id;
    END IF;

    INSERT INTO public.estimate_items (
        estimate_id, serial_number, product_id, product_name_snapshot,
        length_snapshot, width_snapshot, nos, quantity, unit_snapshot,
        rate, discount_percent, calculation_type_snapshot, amount, remark,
        actual_code_snapshot, alternative_code_snapshot
    )
    SELECT
        v_est_id,
        (x.value->>'serial_number')::INTEGER,
        NULLIF(x.value->>'product_id', '')::UUID,
        x.value->>'product_name_snapshot',
        NULLIF(x.value->>'length_snapshot', '')::NUMERIC,
        NULLIF(x.value->>'width_snapshot', '')::NUMERIC,
        COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0),
        COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0),
        x.value->>'unit_snapshot',
        COALESCE(NULLIF(x.value->>'rate', '')::NUMERIC, 0),
        COALESCE(NULLIF(x.value->>'discount_percent', '')::NUMERIC, 0),
        x.value->>'calculation_type_snapshot',
        COALESCE(NULLIF(x.value->>'amount', '')::NUMERIC, 0),
        x.value->>'remark',
        x.value->>'actual_code_snapshot',
        x.value->>'alternative_code_snapshot'
    FROM jsonb_array_elements(v_new_items) AS x(value)
    ORDER BY (x.value->>'serial_number')::INTEGER;

    v_product_ids := ARRAY(
        SELECT DISTINCT ids.id
        FROM (
            SELECT NULLIF(x.value->>'product_id', '')::UUID AS id
            FROM jsonb_array_elements(v_new_items) AS x(value)
            UNION
            SELECT NULLIF(x.value->>'product_id', '')::UUID AS id
            FROM jsonb_array_elements(v_old_items) AS x(value)
        ) ids
        WHERE ids.id IS NOT NULL
        ORDER BY ids.id
    );

    IF COALESCE(array_length(v_product_ids, 1), 0) > 0 THEN
        FOR v_rec IN
            SELECT p.id, COALESCE(p.stock, 0) AS stock
            FROM public.products p
            WHERE p.id = ANY(v_product_ids)
              AND p.has_stock = TRUE
            ORDER BY p.id
            FOR NO KEY UPDATE
        LOOP
            SELECT COALESCE(SUM(
                CASE
                    WHEN v_old_doc_type = 'ESTIMATE' THEN
                        -CASE
                            WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET')
                                THEN COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0)
                            ELSE COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0)
                        END
                    WHEN v_old_doc_type = 'RETURN' THEN
                        CASE
                            WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET')
                                THEN COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0)
                            ELSE COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0)
                        END
                    ELSE 0
                END
            ), 0)
            INTO v_old_effect
            FROM jsonb_array_elements(v_old_items) AS x(value)
            WHERE NULLIF(x.value->>'product_id', '')::UUID = v_rec.id;

            SELECT COALESCE(SUM(
                COALESCE(NULLIF(x.value->>'new_effect', '')::NUMERIC, 0)
            ), 0)
            INTO v_new_effect
            FROM jsonb_array_elements(v_new_items) AS x(value)
            WHERE NULLIF(x.value->>'product_id', '')::UUID = v_rec.id;

            v_delta := v_new_effect - v_old_effect;

            IF v_delta <> 0 THEN
                IF v_delta < 0 AND v_rec.stock + v_delta < 0 THEN
                    RAISE EXCEPTION
                        'Insufficient stock. Product %, current %, required deduction %',
                        v_rec.id, v_rec.stock, ABS(v_delta);
                END IF;

                UPDATE public.products
                SET stock = COALESCE(stock, 0) + v_delta
                WHERE id = v_rec.id;

                v_history_type := CASE
                    WHEN p_estimate_id IS NULL AND p_doc_type = 'ESTIMATE' THEN 'ESTIMATE_DEDUCT'
                    WHEN p_estimate_id IS NULL AND p_doc_type = 'RETURN' THEN 'RETURN_ADD'
                    WHEN v_old_doc_type = 'QUOTATION' AND p_doc_type = 'ESTIMATE' THEN 'QUOTATION_CONVERT'
                    WHEN v_old_doc_type = 'ESTIMATE' AND p_doc_type = 'QUOTATION' THEN 'REVERT_TO_QUOTATION'
                    WHEN v_old_doc_type = p_doc_type AND p_doc_type = 'ESTIMATE' THEN 'ESTIMATE_UPDATE'
                    WHEN v_old_doc_type = p_doc_type AND p_doc_type = 'RETURN' THEN 'RETURN_UPDATE'
                    ELSE COALESCE(v_old_doc_type, 'NEW') || '_TO_' || p_doc_type
                END;

                -- Insert one history row per alternative code. The sum of these
                -- rows is exactly the aggregate product stock change above.
                WITH old_code_effects AS (
                    SELECT
                        COALESCE(
                            NULLIF(public.normalize_laminea_code(x.value->>'alternative_code_snapshot'), ''),
                            ''
                        ) AS code_key,
                        SUM(CASE
                            WHEN v_old_doc_type = 'ESTIMATE' THEN
                                -CASE
                                    WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET')
                                        THEN COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0)
                                    ELSE COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0)
                                END
                            WHEN v_old_doc_type = 'RETURN' THEN
                                CASE
                                    WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET')
                                        THEN COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0)
                                    ELSE COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0)
                                END
                            ELSE 0
                        END) AS effect
                    FROM jsonb_array_elements(v_old_items) AS x(value)
                    WHERE NULLIF(x.value->>'product_id', '')::UUID = v_rec.id
                    GROUP BY 1
                ),
                new_code_effects AS (
                    SELECT
                        COALESCE(
                            NULLIF(public.normalize_laminea_code(x.value->>'alternative_code_snapshot'), ''),
                            ''
                        ) AS code_key,
                        SUM(COALESCE(NULLIF(x.value->>'new_effect', '')::NUMERIC, 0)) AS effect
                    FROM jsonb_array_elements(v_new_items) AS x(value)
                    WHERE NULLIF(x.value->>'product_id', '')::UUID = v_rec.id
                    GROUP BY 1
                ),
                code_keys AS (
                    SELECT code_key FROM old_code_effects
                    UNION
                    SELECT code_key FROM new_code_effects
                )
                INSERT INTO public.stock_history (
                    platform, product_id, change_type, quantity_changed,
                    estimate_id, bill_number, site_name, alternative_code
                )
                SELECT
                    p_platform,
                    v_rec.id,
                    v_history_type,
                    COALESCE(n.effect, 0) - COALESCE(o.effect, 0),
                    v_est_id,
                    v_bill_num::TEXT,
                    p_site_name,
                    NULLIF(k.code_key, '')
                FROM code_keys k
                LEFT JOIN old_code_effects o USING (code_key)
                LEFT JOIN new_code_effects n USING (code_key)
                WHERE COALESCE(n.effect, 0) - COALESCE(o.effect, 0) <> 0;
            END IF;
        END LOOP;
    END IF;

    -- Always clear the old ledger rows for this platform/bill before rebuilding.
    DELETE FROM public.client_purchases
    WHERE bill_number = v_bill_num::TEXT
      AND platform = p_platform;

    IF p_doc_type IN ('ESTIMATE', 'RETURN') AND p_client_id IS NOT NULL THEN
        INSERT INTO public.client_purchases (
            client_id, product_id, product_name, quantity, unit, rate, amount,
            bill_number, bill_date, platform, is_archived
        )
        SELECT
            p_client_id,
            NULLIF(x.value->>'product_id', '')::UUID,
            COALESCE(NULLIF(x.value->>'product_name_snapshot', ''), 'Manual Item'),
            CASE WHEN p_doc_type = 'RETURN' THEN -1 ELSE 1 END *
                CASE
                    WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET')
                        THEN COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0)
                    ELSE COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0)
                END,
            CASE
                WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET') THEN 'Nos.'
                ELSE COALESCE(x.value->>'unit_snapshot', '')
            END,
            COALESCE(NULLIF(x.value->>'rate', '')::NUMERIC, 0),
            CASE WHEN p_doc_type = 'RETURN' THEN -1 ELSE 1 END *
                COALESCE(NULLIF(x.value->>'amount', '')::NUMERIC, 0),
            v_bill_num::TEXT,
            p_bill_date,
            p_platform,
            FALSE
        FROM jsonb_array_elements(v_new_items) AS x(value)
        WHERE
            CASE
                WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET')
                    THEN COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0)
                ELSE COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0)
            END > 0
            OR COALESCE(NULLIF(x.value->>'amount', '')::NUMERIC, 0) > 0;
    END IF;

    IF p_site_name IS NOT NULL AND BTRIM(p_site_name) <> '' THEN
        INSERT INTO public.sites (site_name, platform)
        VALUES (UPPER(BTRIM(p_site_name)), p_platform)
        ON CONFLICT (platform, site_name) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'estimate_id', v_est_id,
        'bill_number', v_bill_num
    );
END;
$$;

REVOKE ALL ON FUNCTION public.process_estimate_atomic(
    TEXT, UUID, UUID, TEXT, TEXT, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT,
    TEXT, JSONB, JSONB, NUMERIC
) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.process_estimate_atomic(
    TEXT, UUID, UUID, TEXT, TEXT, INTEGER, TEXT, UUID, TEXT, TEXT, TEXT, TEXT,
    TEXT, JSONB, JSONB, NUMERIC
) TO authenticated;

COMMIT;


-- ==========================================
-- FILE: 05_process_estimate_patch.sql
-- ==========================================

BEGIN;

-- =============================================================================
-- File: 05_process_estimate_patch.sql
-- Description: Patches the process_estimate_atomic RPC to allow inactive Laminea 
--              codes when editing historical documents that already contain them.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.process_estimate_atomic(
    p_action TEXT,
    p_estimate_id UUID,
    p_idempotency_key UUID,
    p_platform TEXT,
    p_doc_type TEXT,
    p_bill_number INTEGER DEFAULT NULL,
    p_bill_date TEXT DEFAULT NULL,
    p_client_id UUID DEFAULT NULL,
    p_client_name TEXT DEFAULT NULL,
    p_client_mobile TEXT DEFAULT NULL,
    p_prepared_by TEXT DEFAULT NULL,
    p_order_by TEXT DEFAULT NULL,
    p_site_name TEXT DEFAULT NULL,
    p_totals JSONB DEFAULT NULL,
    p_items JSONB DEFAULT NULL,
    p_previous_balance NUMERIC DEFAULT 0
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_est_id UUID;
    v_bill_num INTEGER;
    v_old_doc_type TEXT;

    v_item JSONB;
    v_new_item JSONB;
    v_old_items JSONB := '[]'::JSONB;
    v_new_items JSONB := '[]'::JSONB;
    v_idx INTEGER := 1;

    v_input_pid UUID;
    v_pid UUID;
    v_product_name TEXT;
    v_platform_enabled BOOLEAN;
    v_has_stock BOOLEAN;
    v_alt_code TEXT;
    v_actual_code TEXT;
    v_calc_type TEXT;
    v_unit TEXT;
    v_remark TEXT;

    v_length NUMERIC;
    v_width NUMERIC;
    v_nos NUMERIC;
    v_quantity NUMERIC;
    v_rate NUMERIC;
    v_discount NUMERIC;
    v_amount NUMERIC;
    v_qty NUMERIC;

    v_total_nos NUMERIC;
    v_total_quantity NUMERIC;
    v_sub_total NUMERIC;
    v_gst_percent NUMERIC;
    v_gst_amount NUMERIC;
    v_grand_total NUMERIC;

    v_old_effect NUMERIC;
    v_new_effect NUMERIC;
    v_delta NUMERIC;
    v_product_ids UUID[];
    v_history_type TEXT;
    v_rec RECORD;
BEGIN
    -- -------------------------------------------------------------------------
    -- Authentication and request normalization
    -- -------------------------------------------------------------------------
    IF public.is_active_staff() IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Unauthorized: active staff session required.';
    END IF;

    p_action := UPPER(BTRIM(COALESCE(p_action, '')));
    p_platform := LOWER(BTRIM(COALESCE(p_platform, '')));
    p_doc_type := UPPER(BTRIM(COALESCE(p_doc_type, '')));

    IF p_action NOT IN ('SAVE', 'DELETE', 'REVERT') THEN
        RAISE EXCEPTION 'Invalid action: %', p_action;
    END IF;

    IF p_platform NOT IN ('ccai', 'dc', 'laminea', 'phs') THEN
        RAISE EXCEPTION 'Invalid platform: %', p_platform;
    END IF;

    IF p_action = 'SAVE' AND p_doc_type NOT IN ('ESTIMATE', 'QUOTATION', 'RETURN') THEN
        RAISE EXCEPTION 'Invalid document type for SAVE: %', p_doc_type;
    END IF;

    -- -------------------------------------------------------------------------
    -- Idempotency for document creation
    -- -------------------------------------------------------------------------
    IF p_action = 'SAVE' AND p_estimate_id IS NULL THEN
        IF p_idempotency_key IS NULL THEN
            RAISE EXCEPTION 'Idempotency key is required when creating a document.';
        END IF;

        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(p_idempotency_key::TEXT, 0)
        );

        SELECT e.id, e.bill_number
        INTO v_est_id, v_bill_num
        FROM public.estimates e
        WHERE e.idempotency_key = p_idempotency_key
          AND e.platform = p_platform
        LIMIT 1;

        IF FOUND THEN
            RETURN jsonb_build_object(
                'success', TRUE,
                'estimate_id', v_est_id,
                'bill_number', v_bill_num,
                'message', 'Already processed'
            );
        END IF;
    END IF;

    -- =========================================================================
    -- REVERT: ESTIMATE -> QUOTATION
    -- =========================================================================
    IF p_action = 'REVERT' THEN
        IF p_estimate_id IS NULL THEN
            RAISE EXCEPTION 'Estimate ID is required for REVERT.';
        END IF;

        SELECT e.type, e.bill_number, e.site_name
        INTO v_old_doc_type, v_bill_num, p_site_name
        FROM public.estimates e
        WHERE e.id = p_estimate_id
          AND e.platform = p_platform
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Estimate not found on this platform.';
        END IF;

        IF v_old_doc_type = 'QUOTATION' THEN
            RETURN jsonb_build_object('success', TRUE, 'message', 'Already a quotation');
        END IF;

        IF v_old_doc_type <> 'ESTIMATE' THEN
            RAISE EXCEPTION 'Only an ESTIMATE can be reverted to QUOTATION.';
        END IF;

        v_product_ids := ARRAY(
            SELECT DISTINCT ei.product_id
            FROM public.estimate_items ei
            WHERE ei.estimate_id = p_estimate_id
              AND ei.product_id IS NOT NULL
            ORDER BY ei.product_id
        );

        IF COALESCE(array_length(v_product_ids, 1), 0) > 0 THEN
            FOR v_rec IN
                SELECT p.id, COALESCE(p.stock, 0) AS stock
                FROM public.products p
                WHERE p.id = ANY(v_product_ids)
                  AND p.has_stock = TRUE
                ORDER BY p.id
                FOR NO KEY UPDATE
            LOOP
                SELECT COALESCE(SUM(
                    CASE
                        WHEN ei.calculation_type_snapshot IN ('SQFT', 'INCH', 'FEET')
                            THEN COALESCE(ei.nos, 0)
                        ELSE COALESCE(ei.quantity, 0)
                    END
                ), 0)
                INTO v_delta
                FROM public.estimate_items ei
                WHERE ei.estimate_id = p_estimate_id
                  AND ei.product_id = v_rec.id;

                IF v_delta > 0 THEN
                    UPDATE public.products
                    SET stock = COALESCE(stock, 0) + v_delta
                    WHERE id = v_rec.id;

                    INSERT INTO public.stock_history (
                        platform, product_id, change_type, quantity_changed,
                        estimate_id, bill_number, site_name, alternative_code
                    )
                    SELECT
                        p_platform,
                        v_rec.id,
                        'REVERT_TO_QUOTATION',
                        SUM(CASE
                            WHEN ei.calculation_type_snapshot IN ('SQFT', 'INCH', 'FEET')
                                THEN COALESCE(ei.nos, 0)
                            ELSE COALESCE(ei.quantity, 0)
                        END),
                        p_estimate_id,
                        v_bill_num::TEXT,
                        p_site_name,
                        NULLIF(public.normalize_laminea_code(ei.alternative_code_snapshot), '')
                    FROM public.estimate_items ei
                    WHERE ei.estimate_id = p_estimate_id
                      AND ei.product_id = v_rec.id
                    GROUP BY NULLIF(public.normalize_laminea_code(ei.alternative_code_snapshot), '')
                    HAVING SUM(CASE
                        WHEN ei.calculation_type_snapshot IN ('SQFT', 'INCH', 'FEET')
                            THEN COALESCE(ei.nos, 0)
                        ELSE COALESCE(ei.quantity, 0)
                    END) <> 0;
                END IF;
            END LOOP;
        END IF;

        DELETE FROM public.client_purchases
        WHERE bill_number = v_bill_num::TEXT
          AND platform = p_platform;

        UPDATE public.estimates
        SET type = 'QUOTATION',
            is_archived = FALSE,
            updated_at = NOW()
        WHERE id = p_estimate_id;

        RETURN jsonb_build_object('success', TRUE, 'message', 'Reverted to quotation successfully');
    END IF;

    -- =========================================================================
    -- DELETE
    -- =========================================================================
    IF p_action = 'DELETE' THEN
        IF p_estimate_id IS NULL THEN
            RAISE EXCEPTION 'Estimate ID is required for DELETE.';
        END IF;

        SELECT e.type, e.bill_number, e.site_name
        INTO v_old_doc_type, v_bill_num, p_site_name
        FROM public.estimates e
        WHERE e.id = p_estimate_id
          AND e.platform = p_platform
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Estimate not found on this platform.';
        END IF;

        IF v_old_doc_type IN ('DELETED_ESTIMATE', 'DELETED_RETURN') THEN
            RETURN jsonb_build_object('success', TRUE, 'message', 'Already deleted');
        END IF;

        IF v_old_doc_type = 'QUOTATION' THEN
            DELETE FROM public.client_purchases
            WHERE bill_number = v_bill_num::TEXT
              AND platform = p_platform;

            DELETE FROM public.estimates
            WHERE id = p_estimate_id;

            RETURN jsonb_build_object('success', TRUE, 'message', 'Quotation deleted successfully');
        END IF;

        IF v_old_doc_type NOT IN ('ESTIMATE', 'RETURN') THEN
            RAISE EXCEPTION 'Unsupported document state for DELETE: %', v_old_doc_type;
        END IF;

        v_product_ids := ARRAY(
            SELECT DISTINCT ei.product_id
            FROM public.estimate_items ei
            WHERE ei.estimate_id = p_estimate_id
              AND ei.product_id IS NOT NULL
            ORDER BY ei.product_id
        );

        IF COALESCE(array_length(v_product_ids, 1), 0) > 0 THEN
            FOR v_rec IN
                SELECT p.id, COALESCE(p.stock, 0) AS stock
                FROM public.products p
                WHERE p.id = ANY(v_product_ids)
                  AND p.has_stock = TRUE
                ORDER BY p.id
                FOR NO KEY UPDATE
            LOOP
                SELECT COALESCE(SUM(
                    CASE
                        WHEN ei.calculation_type_snapshot IN ('SQFT', 'INCH', 'FEET')
                            THEN COALESCE(ei.nos, 0)
                        ELSE COALESCE(ei.quantity, 0)
                    END
                ), 0)
                INTO v_qty
                FROM public.estimate_items ei
                WHERE ei.estimate_id = p_estimate_id
                  AND ei.product_id = v_rec.id;

                IF v_qty > 0 THEN
                    v_delta := CASE
                        WHEN v_old_doc_type = 'ESTIMATE' THEN v_qty
                        ELSE -v_qty
                    END;

                    IF v_delta < 0 AND v_rec.stock + v_delta < 0 THEN
                        RAISE EXCEPTION
                            'Insufficient stock while deleting return. Product %, current %, required %',
                            v_rec.id, v_rec.stock, ABS(v_delta);
                    END IF;

                    UPDATE public.products
                    SET stock = COALESCE(stock, 0) + v_delta
                    WHERE id = v_rec.id;

                    v_history_type := CASE
                        WHEN v_old_doc_type = 'ESTIMATE' THEN 'ESTIMATE_DELETED_RESTORE'
                        ELSE 'RETURN_DELETED_DEDUCT'
                    END;

                    INSERT INTO public.stock_history (
                        platform, product_id, change_type, quantity_changed,
                        estimate_id, bill_number, site_name, alternative_code
                    )
                    SELECT
                        p_platform,
                        v_rec.id,
                        v_history_type,
                        SUM(CASE
                            WHEN ei.calculation_type_snapshot IN ('SQFT', 'INCH', 'FEET')
                                THEN COALESCE(ei.nos, 0)
                            ELSE COALESCE(ei.quantity, 0)
                        END) * CASE WHEN v_old_doc_type = 'ESTIMATE' THEN 1 ELSE -1 END,
                        p_estimate_id,
                        v_bill_num::TEXT,
                        p_site_name,
                        NULLIF(public.normalize_laminea_code(ei.alternative_code_snapshot), '')
                    FROM public.estimate_items ei
                    WHERE ei.estimate_id = p_estimate_id
                      AND ei.product_id = v_rec.id
                    GROUP BY NULLIF(public.normalize_laminea_code(ei.alternative_code_snapshot), '')
                    HAVING SUM(CASE
                        WHEN ei.calculation_type_snapshot IN ('SQFT', 'INCH', 'FEET')
                            THEN COALESCE(ei.nos, 0)
                        ELSE COALESCE(ei.quantity, 0)
                    END) <> 0;
                END IF;
            END LOOP;
        END IF;

        UPDATE public.estimates
        SET type = CASE
                WHEN v_old_doc_type = 'ESTIMATE' THEN 'DELETED_ESTIMATE'
                ELSE 'DELETED_RETURN'
            END,
            is_archived = TRUE,
            updated_at = NOW()
        WHERE id = p_estimate_id;

        UPDATE public.client_purchases
        SET is_archived = TRUE
        WHERE bill_number = v_bill_num::TEXT
          AND platform = p_platform;

        RETURN jsonb_build_object('success', TRUE, 'message', 'Deleted successfully');
    END IF;

    -- =========================================================================
    -- SAVE: validate items, then CREATE or UPDATE
    -- =========================================================================
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'SAVE requires items to be a JSON array.';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'SAVE requires at least one item.';
    END IF;

    IF jsonb_typeof(p_totals) IS DISTINCT FROM 'object' THEN
        RAISE EXCEPTION 'SAVE requires a totals JSON object.';
    END IF;

    v_total_nos := COALESCE(NULLIF(BTRIM(p_totals->>'total_nos'), '')::NUMERIC, 0);
    v_total_quantity := COALESCE(NULLIF(BTRIM(p_totals->>'total_quantity'), '')::NUMERIC, 0);
    v_sub_total := COALESCE(NULLIF(BTRIM(p_totals->>'sub_total'), '')::NUMERIC, 0);
    v_gst_percent := COALESCE(NULLIF(BTRIM(p_totals->>'gst_percent'), '')::NUMERIC, 0);
    v_gst_amount := COALESCE(NULLIF(BTRIM(p_totals->>'gst_amount'), '')::NUMERIC, 0);
    v_grand_total := COALESCE(NULLIF(BTRIM(p_totals->>'grand_total'), '')::NUMERIC, 0);

    IF p_bill_date IS NULL OR BTRIM(p_bill_date) = '' THEN
        RAISE EXCEPTION 'Bill date is required for SAVE.';
    END IF;

    IF v_total_nos < 0 OR v_total_quantity < 0 OR v_sub_total < 0
       OR v_gst_percent < 0 OR v_gst_amount < 0 OR v_grand_total < 0 THEN
        RAISE EXCEPTION 'Document totals cannot be negative.';
    END IF;

    IF v_gst_percent > 100 THEN
        RAISE EXCEPTION 'GST percentage cannot exceed 100.';
    END IF;

    IF p_client_id IS NOT NULL AND NOT EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.id = p_client_id
          AND c.platform = p_platform
    ) THEN
        RAISE EXCEPTION 'Client does not belong to this platform.';
    END IF;

    -- Lock and capture the current version BEFORE validating items
    -- so that we can verify inactive Laminea mappings against v_old_items.
    IF p_estimate_id IS NOT NULL THEN
        v_est_id := p_estimate_id;

        SELECT e.type, e.bill_number
        INTO v_old_doc_type, v_bill_num
        FROM public.estimates e
        WHERE e.id = v_est_id
          AND e.platform = p_platform
        FOR UPDATE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Estimate not found on this platform.';
        END IF;

        IF v_old_doc_type IN ('DELETED_ESTIMATE', 'DELETED_RETURN') THEN
            RAISE EXCEPTION 'Deleted documents cannot be edited.';
        END IF;

        IF v_old_doc_type NOT IN ('ESTIMATE', 'QUOTATION', 'RETURN') THEN
            RAISE EXCEPTION 'Unsupported existing document type: %', v_old_doc_type;
        END IF;

        SELECT COALESCE(
            jsonb_agg(to_jsonb(ei) ORDER BY ei.serial_number),
            '[]'::JSONB
        )
        INTO v_old_items
        FROM public.estimate_items ei
        WHERE ei.estimate_id = v_est_id;
    END IF;

    FOR v_item IN
        SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Every estimate item must be a JSON object.';
        END IF;

        v_input_pid := NULLIF(BTRIM(v_item->>'product_id'), '')::UUID;
        v_pid := v_input_pid;
        v_has_stock := NULL;
        v_alt_code := NULLIF(BTRIM(v_item->>'alternative_code_snapshot'), '');
        v_actual_code := NULLIF(BTRIM(v_item->>'actual_code_snapshot'), '');
        v_product_name := NULLIF(BTRIM(v_item->>'product_name_snapshot'), '');
        v_calc_type := UPPER(BTRIM(COALESCE(v_item->>'calculation_type_snapshot', '')));
        v_unit := NULLIF(BTRIM(v_item->>'unit_snapshot'), '');
        v_remark := NULLIF(BTRIM(v_item->>'remark'), '');

        v_length := NULLIF(BTRIM(v_item->>'length_snapshot'), '')::NUMERIC;
        v_width := NULLIF(BTRIM(v_item->>'width_snapshot'), '')::NUMERIC;
        v_nos := COALESCE(NULLIF(BTRIM(v_item->>'nos'), '')::NUMERIC, 0);
        v_quantity := COALESCE(NULLIF(BTRIM(v_item->>'quantity'), '')::NUMERIC, 0);
        v_rate := COALESCE(NULLIF(BTRIM(v_item->>'rate'), '')::NUMERIC, 0);
        v_discount := COALESCE(NULLIF(BTRIM(v_item->>'discount_percent'), '')::NUMERIC, 0);
        v_amount := COALESCE(NULLIF(BTRIM(v_item->>'amount'), '')::NUMERIC, 0);

        IF v_calc_type NOT IN ('QUANTITY', 'SQFT', 'INCH', 'FEET') THEN
            RAISE EXCEPTION 'Invalid calculation type for item %: %', v_idx, v_calc_type;
        END IF;

        IF v_length < 0 OR v_width < 0 OR v_nos < 0 OR v_quantity < 0
           OR v_rate < 0 OR v_amount < 0 OR v_discount < 0 OR v_discount > 100 THEN
            RAISE EXCEPTION 'Invalid negative value or discount for item %.', v_idx;
        END IF;

        v_qty := CASE
            WHEN v_calc_type IN ('SQFT', 'INCH', 'FEET') THEN v_nos
            ELSE v_quantity
        END;

        IF p_platform = 'laminea' THEN
            IF v_alt_code IS NOT NULL THEN
                SELECT
                    lpc.product_id,
                    lpc.alternative_code,
                    p.product_code,
                    p.product_name,
                    p.has_stock
                INTO
                    v_pid,
                    v_alt_code,
                    v_actual_code,
                    v_product_name,
                    v_has_stock
                FROM public.laminea_product_codes lpc
                JOIN public.products p ON p.id = lpc.product_id
                WHERE public.normalize_laminea_code(lpc.alternative_code)
                        = public.normalize_laminea_code(v_alt_code)
                  AND (
                      lpc.is_active = TRUE
                      OR (
                          p_estimate_id IS NOT NULL 
                          AND EXISTS (
                              SELECT 1
                              FROM jsonb_array_elements(v_old_items) AS x(val)
                              WHERE public.normalize_laminea_code(x.val->>'alternative_code_snapshot') = public.normalize_laminea_code(v_alt_code)
                                AND NULLIF(x.val->>'product_id', '')::UUID = lpc.product_id
                          )
                      )
                  )
                  AND p.in_laminea = TRUE
                  AND p.has_stock = TRUE
                  AND p.product_code IS NOT NULL
                  AND BTRIM(p.product_code) <> '';

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'No active Laminea mapping found for alternative code %.', v_alt_code;
                END IF;

                IF v_input_pid IS NOT NULL AND v_input_pid <> v_pid THEN
                    RAISE EXCEPTION 'Alternative code does not match the submitted product for item %.', v_idx;
                END IF;
            ELSIF v_input_pid IS NOT NULL THEN
                SELECT
                    p.product_name,
                    p.in_laminea,
                    p.has_stock,
                    NULLIF(BTRIM(p.product_code), '')
                INTO
                    v_product_name,
                    v_platform_enabled,
                    v_has_stock,
                    v_actual_code
                FROM public.products p
                WHERE p.id = v_input_pid;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Product not found for item %.', v_idx;
                END IF;

                IF v_platform_enabled IS DISTINCT FROM TRUE THEN
                    RAISE EXCEPTION 'Product is not enabled for platform laminea.';
                END IF;

                v_pid := v_input_pid;
                v_alt_code := NULL;
            ELSIF v_actual_code IS NOT NULL THEN
                RAISE EXCEPTION 'Actual code cannot be supplied for an unmapped manual Laminea item.';
            END IF;
        ELSE
            v_alt_code := NULL;
            v_actual_code := NULL;

            IF v_pid IS NOT NULL THEN
                SELECT
                    p.product_name,
                    p.has_stock,
                    CASE p_platform
                        WHEN 'ccai' THEN p.in_ccai
                        WHEN 'dc' THEN p.in_dc
                        WHEN 'phs' THEN p.in_phs
                        ELSE FALSE
                    END
                INTO v_product_name, v_has_stock, v_platform_enabled
                FROM public.products p
                WHERE p.id = v_pid;

                IF NOT FOUND THEN
                    RAISE EXCEPTION 'Product not found for item %.', v_idx;
                END IF;

                IF v_platform_enabled IS DISTINCT FROM TRUE THEN
                    RAISE EXCEPTION 'Product is not enabled for platform %.', p_platform;
                END IF;
            END IF;
        END IF;

        IF v_product_name IS NULL THEN
            RAISE EXCEPTION 'Product name is required for item %.', v_idx;
        END IF;

        v_new_effect := CASE
            WHEN v_pid IS NULL OR v_has_stock IS DISTINCT FROM TRUE THEN 0
            WHEN p_doc_type = 'ESTIMATE' THEN -v_qty
            WHEN p_doc_type = 'RETURN' THEN v_qty
            ELSE 0
        END;

        v_new_item := jsonb_build_object(
            'serial_number', v_idx,
            'product_id', v_pid,
            'product_name_snapshot', v_product_name,
            'length_snapshot', v_length,
            'width_snapshot', v_width,
            'nos', v_nos,
            'quantity', v_quantity,
            'unit_snapshot', v_unit,
            'rate', v_rate,
            'discount_percent', v_discount,
            'calculation_type_snapshot', v_calc_type,
            'amount', v_amount,
            'remark', v_remark,
            'actual_code_snapshot', v_actual_code,
            'alternative_code_snapshot', v_alt_code,
            'new_effect', v_new_effect
        );

        v_new_items := v_new_items || jsonb_build_array(v_new_item);
        v_idx := v_idx + 1;
    END LOOP;

    -- The locking/extraction block that was originally here has been moved up!
    IF p_estimate_id IS NOT NULL THEN
        DELETE FROM public.estimate_items
        WHERE estimate_id = v_est_id;

        UPDATE public.estimates
        SET bill_date = p_bill_date,
            transport = UPPER(BTRIM(p_client_name)),
            client_name = UPPER(BTRIM(p_client_name)),
            client_mobile = BTRIM(p_client_mobile),
            order_by = UPPER(BTRIM(p_order_by)),
            client_id = p_client_id,
            prepared_by = UPPER(BTRIM(p_prepared_by)),
            site_name = NULLIF(UPPER(BTRIM(p_site_name)), ''),
            type = p_doc_type,
            total_nos = v_total_nos,
            total_quantity = v_total_quantity,
            sub_total = v_sub_total,
            gst_percent = v_gst_percent,
            gst_amount = v_gst_amount,
            grand_total = v_grand_total,
            previous_balance = COALESCE(p_previous_balance, 0),
            is_archived = FALSE,
            updated_at = NOW()
        WHERE id = v_est_id;
    ELSE
        -- p_bill_number is deliberately ignored. The database owns numbering.
        v_bill_num := public.get_next_bill_number(p_platform)::INTEGER;

        INSERT INTO public.estimates (
            bill_number, platform, platform_estimate_number, bill_date,
            transport, client_name, client_mobile, order_by, client_id,
            prepared_by, site_name, type, idempotency_key,
            total_nos, total_quantity, sub_total, gst_percent, gst_amount,
            grand_total, previous_balance, is_archived
        ) VALUES (
            v_bill_num,
            p_platform,
            v_bill_num,
            p_bill_date,
            UPPER(BTRIM(p_client_name)),
            UPPER(BTRIM(p_client_name)),
            BTRIM(p_client_mobile),
            UPPER(BTRIM(p_order_by)),
            p_client_id,
            UPPER(BTRIM(p_prepared_by)),
            NULLIF(UPPER(BTRIM(p_site_name)), ''),
            p_doc_type,
            p_idempotency_key,
            v_total_nos,
            v_total_quantity,
            v_sub_total,
            v_gst_percent,
            v_gst_amount,
            v_grand_total,
            COALESCE(p_previous_balance, 0),
            FALSE
        )
        RETURNING id INTO v_est_id;
    END IF;

    INSERT INTO public.estimate_items (
        estimate_id, serial_number, product_id, product_name_snapshot,
        length_snapshot, width_snapshot, nos, quantity, unit_snapshot,
        rate, discount_percent, calculation_type_snapshot, amount, remark,
        actual_code_snapshot, alternative_code_snapshot
    )
    SELECT
        v_est_id,
        (x.value->>'serial_number')::INTEGER,
        NULLIF(x.value->>'product_id', '')::UUID,
        x.value->>'product_name_snapshot',
        NULLIF(x.value->>'length_snapshot', '')::NUMERIC,
        NULLIF(x.value->>'width_snapshot', '')::NUMERIC,
        COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0),
        COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0),
        x.value->>'unit_snapshot',
        COALESCE(NULLIF(x.value->>'rate', '')::NUMERIC, 0),
        COALESCE(NULLIF(x.value->>'discount_percent', '')::NUMERIC, 0),
        x.value->>'calculation_type_snapshot',
        COALESCE(NULLIF(x.value->>'amount', '')::NUMERIC, 0),
        x.value->>'remark',
        x.value->>'actual_code_snapshot',
        x.value->>'alternative_code_snapshot'
    FROM jsonb_array_elements(v_new_items) AS x(value)
    ORDER BY (x.value->>'serial_number')::INTEGER;

    v_product_ids := ARRAY(
        SELECT DISTINCT ids.id
        FROM (
            SELECT NULLIF(x.value->>'product_id', '')::UUID AS id
            FROM jsonb_array_elements(v_new_items) AS x(value)
            UNION
            SELECT NULLIF(x.value->>'product_id', '')::UUID AS id
            FROM jsonb_array_elements(v_old_items) AS x(value)
        ) ids
        WHERE ids.id IS NOT NULL
        ORDER BY ids.id
    );

    IF COALESCE(array_length(v_product_ids, 1), 0) > 0 THEN
        FOR v_rec IN
            SELECT p.id, COALESCE(p.stock, 0) AS stock
            FROM public.products p
            WHERE p.id = ANY(v_product_ids)
              AND p.has_stock = TRUE
            ORDER BY p.id
            FOR NO KEY UPDATE
        LOOP
            SELECT COALESCE(SUM(
                CASE
                    WHEN v_old_doc_type = 'ESTIMATE' THEN
                        -CASE
                            WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET')
                                THEN COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0)
                            ELSE COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0)
                        END
                    WHEN v_old_doc_type = 'RETURN' THEN
                        CASE
                            WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET')
                                THEN COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0)
                            ELSE COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0)
                        END
                    ELSE 0
                END
            ), 0)
            INTO v_old_effect
            FROM jsonb_array_elements(v_old_items) AS x(value)
            WHERE NULLIF(x.value->>'product_id', '')::UUID = v_rec.id;

            SELECT COALESCE(SUM(
                COALESCE(NULLIF(x.value->>'new_effect', '')::NUMERIC, 0)
            ), 0)
            INTO v_new_effect
            FROM jsonb_array_elements(v_new_items) AS x(value)
            WHERE NULLIF(x.value->>'product_id', '')::UUID = v_rec.id;

            v_delta := v_new_effect - v_old_effect;

            IF v_delta <> 0 THEN
                IF v_delta < 0 AND v_rec.stock + v_delta < 0 THEN
                    RAISE EXCEPTION
                        'Insufficient stock. Product %, current %, required deduction %',
                        v_rec.id, v_rec.stock, ABS(v_delta);
                END IF;

                UPDATE public.products
                SET stock = COALESCE(stock, 0) + v_delta
                WHERE id = v_rec.id;

                v_history_type := CASE
                    WHEN p_estimate_id IS NULL AND p_doc_type = 'ESTIMATE' THEN 'ESTIMATE_DEDUCT'
                    WHEN p_estimate_id IS NULL AND p_doc_type = 'RETURN' THEN 'RETURN_ADD'
                    WHEN v_old_doc_type = 'QUOTATION' AND p_doc_type = 'ESTIMATE' THEN 'QUOTATION_CONVERT'
                    WHEN v_old_doc_type = 'ESTIMATE' AND p_doc_type = 'QUOTATION' THEN 'REVERT_TO_QUOTATION'
                    WHEN v_old_doc_type = p_doc_type AND p_doc_type = 'ESTIMATE' THEN 'ESTIMATE_UPDATE'
                    WHEN v_old_doc_type = p_doc_type AND p_doc_type = 'RETURN' THEN 'RETURN_UPDATE'
                    ELSE COALESCE(v_old_doc_type, 'NEW') || '_TO_' || p_doc_type
                END;

                WITH old_code_effects AS (
                    SELECT
                        COALESCE(
                            NULLIF(public.normalize_laminea_code(x.value->>'alternative_code_snapshot'), ''),
                            ''
                        ) AS code_key,
                        SUM(CASE
                            WHEN v_old_doc_type = 'ESTIMATE' THEN
                                -CASE
                                    WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET')
                                        THEN COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0)
                                    ELSE COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0)
                                END
                            WHEN v_old_doc_type = 'RETURN' THEN
                                CASE
                                    WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET')
                                        THEN COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0)
                                    ELSE COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0)
                                END
                            ELSE 0
                        END) AS effect
                    FROM jsonb_array_elements(v_old_items) AS x(value)
                    WHERE NULLIF(x.value->>'product_id', '')::UUID = v_rec.id
                    GROUP BY 1
                ),
                new_code_effects AS (
                    SELECT
                        COALESCE(
                            NULLIF(public.normalize_laminea_code(x.value->>'alternative_code_snapshot'), ''),
                            ''
                        ) AS code_key,
                        SUM(COALESCE(NULLIF(x.value->>'new_effect', '')::NUMERIC, 0)) AS effect
                    FROM jsonb_array_elements(v_new_items) AS x(value)
                    WHERE NULLIF(x.value->>'product_id', '')::UUID = v_rec.id
                    GROUP BY 1
                ),
                code_keys AS (
                    SELECT code_key FROM old_code_effects
                    UNION
                    SELECT code_key FROM new_code_effects
                )
                INSERT INTO public.stock_history (
                    platform, product_id, change_type, quantity_changed,
                    estimate_id, bill_number, site_name, alternative_code
                )
                SELECT
                    p_platform,
                    v_rec.id,
                    v_history_type,
                    COALESCE(n.effect, 0) - COALESCE(o.effect, 0),
                    v_est_id,
                    v_bill_num::TEXT,
                    p_site_name,
                    NULLIF(k.code_key, '')
                FROM code_keys k
                LEFT JOIN old_code_effects o USING (code_key)
                LEFT JOIN new_code_effects n USING (code_key)
                WHERE COALESCE(n.effect, 0) - COALESCE(o.effect, 0) <> 0;
            END IF;
        END LOOP;
    END IF;

    DELETE FROM public.client_purchases
    WHERE bill_number = v_bill_num::TEXT
      AND platform = p_platform;

    IF p_doc_type IN ('ESTIMATE', 'RETURN') AND p_client_id IS NOT NULL THEN
        INSERT INTO public.client_purchases (
            client_id, product_id, product_name, quantity, unit, rate, amount,
            bill_number, bill_date, platform, is_archived
        )
        SELECT
            p_client_id,
            NULLIF(x.value->>'product_id', '')::UUID,
            COALESCE(NULLIF(x.value->>'product_name_snapshot', ''), 'Manual Item'),
            CASE WHEN p_doc_type = 'RETURN' THEN -1 ELSE 1 END *
                CASE
                    WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET')
                        THEN COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0)
                    ELSE COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0)
                END,
            CASE
                WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET') THEN 'Nos.'
                ELSE COALESCE(x.value->>'unit_snapshot', '')
            END,
            COALESCE(NULLIF(x.value->>'rate', '')::NUMERIC, 0),
            CASE WHEN p_doc_type = 'RETURN' THEN -1 ELSE 1 END *
                COALESCE(NULLIF(x.value->>'amount', '')::NUMERIC, 0),
            v_bill_num::TEXT,
            p_bill_date,
            p_platform,
            FALSE
        FROM jsonb_array_elements(v_new_items) AS x(value)
        WHERE
            CASE
                WHEN x.value->>'calculation_type_snapshot' IN ('SQFT', 'INCH', 'FEET')
                    THEN COALESCE(NULLIF(x.value->>'nos', '')::NUMERIC, 0)
                ELSE COALESCE(NULLIF(x.value->>'quantity', '')::NUMERIC, 0)
            END > 0
            OR COALESCE(NULLIF(x.value->>'amount', '')::NUMERIC, 0) > 0;
    END IF;

    IF p_site_name IS NOT NULL AND BTRIM(p_site_name) <> '' THEN
        INSERT INTO public.sites (site_name, platform)
        VALUES (UPPER(BTRIM(p_site_name)), p_platform)
        ON CONFLICT (platform, site_name) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'estimate_id', v_est_id,
        'bill_number', v_bill_num
    );
END;
$$;

COMMIT;


-- ==========================================
-- FILE: 06_user_alias.sql
-- ==========================================

-- Add alias column to user_roles for the "Prepared By" default
ALTER TABLE user_roles ADD COLUMN IF NOT EXISTS alias TEXT;


-- ==========================================
-- FILE: 07_space_insensitive_search.sql
-- ==========================================

-- Create a function to search alternative codes ignoring spaces and case
CREATE OR REPLACE FUNCTION search_laminea_availability_codes(search_codes TEXT[])
RETURNS TABLE(alternative_code TEXT, product_id UUID, is_active BOOLEAN)
LANGUAGE sql
SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT alternative_code, product_id, is_active
  FROM laminea_product_codes
  WHERE is_active = true
    AND REPLACE(UPPER(alternative_code), ' ', '') = ANY (
      SELECT REPLACE(UPPER(c), ' ', '') FROM UNNEST(search_codes) c
    );
$$;

REVOKE ALL ON FUNCTION public.search_laminea_availability_codes(TEXT[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.search_laminea_availability_codes(TEXT[]) TO service_role;


-- ==========================================
-- FILE: 08_laminea_atomic_import.sql
-- ==========================================

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


-- ==========================================
-- FILE: 09_code_finder_client_portal.sql
-- ==========================================

BEGIN;

-- 1. Modify the handle_new_user trigger to exclude Code Finder users
CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path = public, pg_temp
AS $function$
BEGIN
  IF COALESCE(
      NEW.raw_app_meta_data ->> 'account_type',
      ''
  ) <> 'code_finder' 
  AND LOWER(COALESCE(NEW.email, '')) NOT LIKE '%@codefinder.local'
  THEN
      INSERT INTO public.user_roles (id, username, role, is_active)
      VALUES (
        NEW.id,
        SPLIT_PART(NEW.email, '@', 1),
        'STAFF',
        true
      );
  END IF;

  RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;

-- 2. Create the Code Finder User table
CREATE TABLE public.code_finder_users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    auth_user_id UUID NOT NULL UNIQUE
        REFERENCES auth.users(id)
        ON DELETE RESTRICT,

    username TEXT NOT NULL
        CHECK (LENGTH(TRIM(username)) BETWEEN 1 AND 50),
    client_name TEXT NOT NULL
        CHECK (LENGTH(TRIM(client_name)) BETWEEN 1 AND 150),
    contact_person TEXT
        CHECK (
            contact_person IS NULL
            OR LENGTH(TRIM(contact_person)) BETWEEN 1 AND 150
        ),
    mobile TEXT,

    laminea_client_id UUID
        REFERENCES public.clients(id)
        ON DELETE SET NULL,

    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    must_change_password BOOLEAN NOT NULL DEFAULT TRUE,

    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX code_finder_users_username_unique
ON public.code_finder_users (
    UPPER(REGEXP_REPLACE(TRIM(username), '\s+', '', 'g'))
);

CREATE TRIGGER code_finder_users_updated_at
BEFORE UPDATE ON public.code_finder_users
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

-- 3. Create Enquiries table
CREATE TABLE public.code_finder_enquiries (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enquiry_number BIGINT GENERATED BY DEFAULT AS IDENTITY UNIQUE,

    code_finder_user_id UUID NOT NULL
        REFERENCES public.code_finder_users(id)
        ON DELETE CASCADE,

    status TEXT NOT NULL DEFAULT 'NEW'
        CHECK (status IN (
            'NEW',
            'UNDER_REVIEW',
            'AWAITING_CLIENT',
            'CONFIRMED',
            'CONVERTED_TO_ESTIMATE',
            'REJECTED',
            'CANCELLED'
        )),

    client_note TEXT
        CHECK (
            client_note IS NULL
            OR LENGTH(client_note) <= 2000
        ),
    internal_note TEXT
        CHECK (
            internal_note IS NULL
            OR LENGTH(internal_note) <= 5000
        ),
    ordered_by TEXT
        CONSTRAINT code_finder_enquiries_ordered_by_check CHECK (
            ordered_by IS NULL
            OR LENGTH(TRIM(ordered_by)) BETWEEN 1 AND 100
        ),

    converted_estimate_id UUID
        REFERENCES public.estimates(id)
        ON DELETE SET NULL,

    checked_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT code_finder_enquiries_id_user_unique UNIQUE (id, code_finder_user_id)
);

CREATE TRIGGER code_finder_enquiries_updated_at
BEFORE UPDATE ON public.code_finder_enquiries
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at();

CREATE INDEX code_finder_enquiries_user_created_idx
ON public.code_finder_enquiries
(code_finder_user_id, created_at DESC);

CREATE INDEX code_finder_enquiries_status_idx
ON public.code_finder_enquiries(status);

CREATE UNIQUE INDEX code_finder_enquiries_estimate_unique
ON public.code_finder_enquiries(converted_estimate_id)
WHERE converted_estimate_id IS NOT NULL;


-- 4. Create Enquiry Items table
CREATE TABLE public.code_finder_enquiry_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    enquiry_id UUID NOT NULL
        REFERENCES public.code_finder_enquiries(id)
        ON DELETE CASCADE,

    alternative_code_snapshot TEXT NOT NULL
        CHECK (
            LENGTH(TRIM(alternative_code_snapshot)) BETWEEN 1 AND 100
        ),
    requested_quantity NUMERIC(12,2) NOT NULL
        CHECK (requested_quantity > 0),

    availability_status TEXT NOT NULL
        CHECK (availability_status IN (
            'AVAILABLE',
            'PLEASE_CONFIRM',
            'CODE_NOT_FOUND'
        )),

    checked_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX code_finder_enquiry_items_enquiry_idx
ON public.code_finder_enquiry_items(enquiry_id);

-- 5. Create Messages table
CREATE TABLE public.code_finder_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    code_finder_user_id UUID NOT NULL
        REFERENCES public.code_finder_users(id)
        ON DELETE CASCADE,

    enquiry_id UUID,

    sender_type TEXT NOT NULL
        CHECK (sender_type IN ('CLIENT', 'STAFF', 'SYSTEM')),

    sender_auth_user_id UUID
        REFERENCES auth.users(id)
        ON DELETE SET NULL,

    message TEXT NOT NULL
        CHECK (
            LENGTH(TRIM(message)) BETWEEN 1 AND 2000
        ),

    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    FOREIGN KEY (enquiry_id, code_finder_user_id)
        REFERENCES public.code_finder_enquiries(id, code_finder_user_id)
        ON DELETE CASCADE
);

CREATE INDEX code_finder_messages_user_created_idx
ON public.code_finder_messages
(code_finder_user_id, created_at);

CREATE INDEX code_finder_messages_enquiry_idx
ON public.code_finder_messages(enquiry_id)
WHERE enquiry_id IS NOT NULL;


-- 6. Enable RLS and Restrict Access
ALTER TABLE public.code_finder_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_finder_enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_finder_enquiry_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_finder_messages ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.code_finder_users FROM anon, authenticated;
REVOKE ALL ON public.code_finder_enquiries FROM anon, authenticated;
REVOKE ALL ON public.code_finder_enquiry_items FROM anon, authenticated;
REVOKE ALL ON public.code_finder_messages FROM anon, authenticated;

COMMIT;


-- ==========================================
-- FILE: 10_code_finder_hardening.sql
-- ==========================================

-- =============================================================================
-- File: 10_code_finder_hardening.sql
--
-- Phase 3: Atomic enquiry creation with idempotency
-- Phase 4: Normalized username
-- Phase 5: Persistent namespaced rate limiting
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. NORMALIZED USERNAME
-- =============================================================================

ALTER TABLE public.code_finder_users
ADD COLUMN IF NOT EXISTS normalized_username TEXT
GENERATED ALWAYS AS (
    UPPER(
        REGEXP_REPLACE(
            TRIM(username),
            '\s+',
            '',
            'g'
        )
    )
) STORED;

CREATE UNIQUE INDEX IF NOT EXISTS
code_finder_users_normalized_username_idx
ON public.code_finder_users(normalized_username);

-- The new generated-column index replaces the old expression index.
DROP INDEX IF EXISTS public.code_finder_users_username_unique;


-- =============================================================================
-- 2. ENQUIRY IDEMPOTENCY
-- =============================================================================

ALTER TABLE public.code_finder_enquiries
ADD COLUMN IF NOT EXISTS idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS
code_finder_enquiries_idempotency_idx
ON public.code_finder_enquiries(
    code_finder_user_id,
    idempotency_key
)
WHERE idempotency_key IS NOT NULL;


-- =============================================================================
-- 3. ATOMIC ENQUIRY CREATION
--
-- p_user_id must be public.code_finder_users.id,
-- not auth.users.id.
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_code_finder_enquiry(
    UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT
);

CREATE OR REPLACE FUNCTION public.create_code_finder_enquiry(
    p_user_id UUID,
    p_items JSONB,
    p_client_note TEXT DEFAULT NULL,
    p_checked_at TIMESTAMPTZ DEFAULT NOW(),
    p_idempotency_key TEXT DEFAULT NULL,
    p_ordered_by TEXT DEFAULT NULL
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

    v_code TEXT;
    v_status TEXT;
    v_quantity NUMERIC(12,2);

    v_checked_at TIMESTAMPTZ;
    v_idempotency_key TEXT;
BEGIN
    ---------------------------------------------------------------------------
    -- Validate Code Finder user
    ---------------------------------------------------------------------------

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Code Finder user ID is required.';
    END IF;

    PERFORM 1
    FROM public.code_finder_users
    WHERE id = p_user_id
      AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Code Finder user is inactive or does not exist.';
    END IF;


    ---------------------------------------------------------------------------
    -- Validate idempotency key
    ---------------------------------------------------------------------------

    v_idempotency_key := NULLIF(TRIM(p_idempotency_key), '');

    IF v_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required.';
    END IF;

    IF LENGTH(v_idempotency_key) NOT BETWEEN 8 AND 100 THEN
        RAISE EXCEPTION 'Idempotency key must contain between 8 and 100 characters.';
    END IF;


    ---------------------------------------------------------------------------
    -- Validate enquiry
    ---------------------------------------------------------------------------

    IF p_client_note IS NOT NULL
       AND LENGTH(p_client_note) > 2000 THEN
        RAISE EXCEPTION 'Client note cannot exceed 2000 characters.';
    END IF;

    IF p_ordered_by IS NOT NULL
       AND LENGTH(TRIM(p_ordered_by)) > 100 THEN
        RAISE EXCEPTION 'Ordered by cannot exceed 100 characters.';
    END IF;

    IF p_items IS NULL
       OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Items must be provided as a JSON array.';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'At least one enquiry item is required.';
    END IF;

    IF jsonb_array_length(p_items) > 25 THEN
        RAISE EXCEPTION 'Maximum 25 items are allowed per enquiry.';
    END IF;

    v_checked_at := COALESCE(p_checked_at, NOW());


    ---------------------------------------------------------------------------
    -- Validate every item before creating the enquiry
    ---------------------------------------------------------------------------

    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_items)
    LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Every enquiry item must be a JSON object.';
        END IF;

        v_code := NULLIF(
            TRIM(v_item ->> 'alternative_code_snapshot'),
            ''
        );

        IF v_code IS NULL THEN
            RAISE EXCEPTION 'Alternative code is required for every item.';
        END IF;

        IF LENGTH(v_code) > 100 THEN
            RAISE EXCEPTION 'Alternative code cannot exceed 100 characters.';
        END IF;

        BEGIN
            v_quantity :=
                (v_item ->> 'requested_quantity')::NUMERIC(12,2);
        EXCEPTION
            WHEN invalid_text_representation
              OR numeric_value_out_of_range THEN
                RAISE EXCEPTION
                    'Invalid requested quantity for alternative code %.',
                    v_code;
        END;

        IF v_quantity IS NULL OR v_quantity <= 0 THEN
            RAISE EXCEPTION
                'Requested quantity must be greater than zero for alternative code %.',
                v_code;
        END IF;

        v_status := v_item ->> 'availability_status';

        IF v_status IS NULL
           OR v_status NOT IN (
               'AVAILABLE',
               'PLEASE_CONFIRM',
               'CODE_NOT_FOUND'
           ) THEN
            RAISE EXCEPTION
                'Invalid availability status for alternative code %.',
                v_code;
        END IF;
    END LOOP;


    ---------------------------------------------------------------------------
    -- Prevent duplicate normalized codes inside the same enquiry payload
    ---------------------------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS item(value)
        GROUP BY UPPER(
            REGEXP_REPLACE(
                TRIM(item.value ->> 'alternative_code_snapshot'),
                '\s+',
                '',
                'g'
            )
        )
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate alternative codes were found in the enquiry.';
    END IF;


    ---------------------------------------------------------------------------
    -- Insert enquiry atomically.
    --
    -- ON CONFLICT makes concurrent retries safe. Only one enquiry is created.
    ---------------------------------------------------------------------------

    INSERT INTO public.code_finder_enquiries (
        code_finder_user_id,
        status,
        client_note,
        checked_at,
        idempotency_key,
        ordered_by
    )
    VALUES (
        p_user_id,
        'NEW',
        NULLIF(TRIM(p_client_note), ''),
        v_checked_at,
        v_idempotency_key,
        NULLIF(TRIM(p_ordered_by), '')
    )
    ON CONFLICT (
        code_finder_user_id,
        idempotency_key
    )
    WHERE idempotency_key IS NOT NULL
    DO NOTHING
    RETURNING id, enquiry_number
    INTO v_enquiry_id, v_enquiry_number;


    ---------------------------------------------------------------------------
    -- Existing request with the same idempotency key
    ---------------------------------------------------------------------------

    IF v_enquiry_id IS NULL THEN
        SELECT id, enquiry_number
        INTO v_existing
        FROM public.code_finder_enquiries
        WHERE code_finder_user_id = p_user_id
          AND idempotency_key = v_idempotency_key;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Unable to resolve the existing idempotent enquiry.';
        END IF;

        RETURN jsonb_build_object(
            'success', TRUE,
            'enquiry_id', v_existing.id,
            'enquiry_number', v_existing.enquiry_number,
            'duplicate', TRUE
        );
    END IF;


    ---------------------------------------------------------------------------
    -- Insert all enquiry items
    ---------------------------------------------------------------------------

    INSERT INTO public.code_finder_enquiry_items (
        enquiry_id,
        alternative_code_snapshot,
        requested_quantity,
        availability_status,
        checked_at
    )
    SELECT
        v_enquiry_id,
        TRIM(item.value ->> 'alternative_code_snapshot'),
        (item.value ->> 'requested_quantity')::NUMERIC(12,2),
        item.value ->> 'availability_status',
        v_checked_at
    FROM jsonb_array_elements(p_items) AS item(value);


    RETURN jsonb_build_object(
        'success', TRUE,
        'enquiry_id', v_enquiry_id,
        'enquiry_number', v_enquiry_number,
        'duplicate', FALSE
    );
END;
$$;


-- The RPC can only be called using the service-role key.

REVOKE ALL ON FUNCTION public.create_code_finder_enquiry(
    UUID,
    JSONB,
    TEXT,
    TIMESTAMPTZ,
    TEXT,
    TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_code_finder_enquiry(
    UUID,
    JSONB,
    TEXT,
    TIMESTAMPTZ,
    TEXT,
    TEXT
) TO service_role;


-- =============================================================================
-- 4. PERSISTENT NAMESPACED RATE LIMITING
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.code_finder_rate_limits (
    namespace TEXT NOT NULL,
    key_hash TEXT NOT NULL,
    request_count INTEGER NOT NULL DEFAULT 1,
    window_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    window_seconds INTEGER NOT NULL DEFAULT 60,

    CONSTRAINT code_finder_rate_limits_pkey
        PRIMARY KEY (namespace, key_hash)
);

-- Supports rerunning after an earlier version of this migration.

ALTER TABLE public.code_finder_rate_limits
ADD COLUMN IF NOT EXISTS window_seconds INTEGER NOT NULL DEFAULT 60;

ALTER TABLE public.code_finder_rate_limits
ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.code_finder_rate_limits
FROM PUBLIC, anon, authenticated;


-- =============================================================================
-- 5. ATOMIC RATE-LIMIT RPC
-- =============================================================================

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
    v_namespace TEXT;
    v_key_hash TEXT;

    v_now TIMESTAMPTZ := NOW();
    v_window INTERVAL;

    v_request_count INTEGER;
    v_window_start TIMESTAMPTZ;
    v_allowed BOOLEAN;
    v_remaining INTEGER;
    v_retry_after INTEGER;
BEGIN
    v_namespace := LOWER(NULLIF(TRIM(p_namespace), ''));
    v_key_hash := LOWER(NULLIF(TRIM(p_key_hash), ''));

    IF v_namespace IS NULL
       OR LENGTH(v_namespace) NOT BETWEEN 1 AND 50 THEN
        RAISE EXCEPTION 'Invalid rate-limit namespace.';
    END IF;

    IF v_key_hash IS NULL
       OR LENGTH(v_key_hash) NOT BETWEEN 32 AND 128 THEN
        RAISE EXCEPTION 'Invalid rate-limit key hash.';
    END IF;

    IF p_max_requests IS NULL
       OR p_max_requests NOT BETWEEN 1 AND 10000 THEN
        RAISE EXCEPTION 'Invalid maximum request limit.';
    END IF;

    IF p_window_seconds IS NULL
       OR p_window_seconds NOT BETWEEN 1 AND 86400 THEN
        RAISE EXCEPTION 'Invalid rate-limit window.';
    END IF;

    v_window := make_interval(secs => p_window_seconds);


    ---------------------------------------------------------------------------
    -- One atomic UPSERT prevents concurrent requests from losing increments.
    ---------------------------------------------------------------------------

    INSERT INTO public.code_finder_rate_limits AS existing_limit (
        namespace,
        key_hash,
        request_count,
        window_start,
        window_seconds
    )
    VALUES (
        v_namespace,
        v_key_hash,
        1,
        v_now,
        p_window_seconds
    )
    ON CONFLICT (namespace, key_hash)
    DO UPDATE
    SET
        request_count =
            CASE
                WHEN existing_limit.window_start <= v_now - v_window
                    THEN 1
                ELSE existing_limit.request_count + 1
            END,

        window_start =
            CASE
                WHEN existing_limit.window_start <= v_now - v_window
                    THEN v_now
                ELSE existing_limit.window_start
            END,

        window_seconds = p_window_seconds
    RETURNING request_count, window_start
    INTO v_request_count, v_window_start;


    v_allowed := v_request_count <= p_max_requests;

    v_remaining := GREATEST(
        p_max_requests - v_request_count,
        0
    );

    IF v_allowed THEN
        v_retry_after := 0;
    ELSE
        v_retry_after := GREATEST(
            CEIL(
                EXTRACT(
                    EPOCH FROM (
                        (v_window_start + v_window) - v_now
                    )
                )
            )::INTEGER,
            0
        );
    END IF;


    RETURN jsonb_build_object(
        'allowed', v_allowed,
        'remaining', v_remaining,
        'retry_after_seconds', v_retry_after,
        'reset_at', v_window_start + v_window
    );
END;
$$;


REVOKE ALL ON FUNCTION public.check_rate_limit_v2(
    TEXT,
    TEXT,
    INTEGER,
    INTEGER
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.check_rate_limit_v2(
    TEXT,
    TEXT,
    INTEGER,
    INTEGER
) TO service_role;


-- =============================================================================
-- 6. RATE-LIMIT CLEANUP FUNCTION
-- =============================================================================

CREATE OR REPLACE FUNCTION public.cleanup_rate_limits(
    p_grace_minutes INTEGER DEFAULT 10
)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_deleted INTEGER;
BEGIN
    IF p_grace_minutes IS NULL
       OR p_grace_minutes NOT BETWEEN 1 AND 10080 THEN
        RAISE EXCEPTION 'Invalid cleanup grace period.';
    END IF;

    DELETE FROM public.code_finder_rate_limits
    WHERE
        window_start
        + make_interval(secs => window_seconds)
        < NOW() - make_interval(mins => p_grace_minutes);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;

    RETURN v_deleted;
END;
$$;


REVOKE ALL ON FUNCTION public.cleanup_rate_limits(INTEGER)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.cleanup_rate_limits(INTEGER)
TO service_role;


COMMIT;


-- ==========================================
-- FILE: 11_customer_enquiries_staff.sql
-- ==========================================

-- Phase 8 v4 corrected migration. Run ONCE, in staging first.
-- Replaces the unrun draft; aborts if its proposal tables already exist.
-- Does not replace process_estimate_atomic or change stock directly.
-- Frontend/Edge changes listed at end are required before enabling Phase 8.
BEGIN;
DO $$
BEGIN
 IF to_regclass('public.code_finder_proposals') IS NOT NULL THEN
  RAISE EXCEPTION 'Phase 8 tables already exist. Do not rerun; use a schema-specific upgrade.';
 END IF;
 IF to_regprocedure('public.process_estimate_atomic(text,uuid,uuid,text,text,integer,text,uuid,text,text,text,text,text,jsonb,jsonb,numeric)') IS NULL THEN
  RAISE EXCEPTION 'Expected estimate RPC signature missing; transaction aborted.';
 END IF;
 IF to_regprocedure('public.normalize_alternative_code(text)') IS NULL THEN
  RAISE EXCEPTION 'Alternative-code normalization function missing.';
 END IF;
END $$;
CREATE OR REPLACE FUNCTION public.cf8_require_staff() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 IF current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role' THEN
  RETURN;
 END IF;
 IF NOT EXISTS (SELECT 1 FROM public.user_roles
 WHERE id=auth.uid() AND is_active IS TRUE AND role IN ('ADMIN','STAFF'))
 OR public.is_active_staff() IS DISTINCT FROM TRUE THEN
 RAISE EXCEPTION 'Active internal staff access required'; END IF;
END $$;
REVOKE ALL ON FUNCTION public.cf8_require_staff() FROM PUBLIC, anon, authenticated;
ALTER TABLE public.code_finder_enquiries ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
-- Historical confirmation times are unknown; deliberately do not invent them.


-- 1. Safely update any existing 'CONVERTED_TO_ESTIMATE' statuses to 'CONFIRMED'
UPDATE public.code_finder_enquiries
SET status = 'CONFIRMED'
WHERE status = 'CONVERTED_TO_ESTIMATE';

-- 2. Strictly decouple internal document lifecycle from customer status
ALTER TABLE public.code_finder_enquiries
DROP CONSTRAINT IF EXISTS code_finder_enquiries_status_check;

ALTER TABLE public.code_finder_enquiries
ADD CONSTRAINT code_finder_enquiries_status_check
CHECK (status IN ('NEW', 'UNDER_REVIEW', 'AWAITING_CLIENT', 'CONFIRMED', 'REJECTED', 'CANCELLED'));

-- 3. Mapping Snapshot at Enquiry Submission
ALTER TABLE public.code_finder_enquiry_items
ADD COLUMN IF NOT EXISTS product_id_snapshot UUID REFERENCES public.products(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS product_code_snapshot TEXT,
ADD COLUMN IF NOT EXISTS mapping_revision_at TIMESTAMPTZ;

-- 4. Versioned Proposal History
CREATE TABLE public.code_finder_proposals (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    enquiry_id UUID NOT NULL REFERENCES public.code_finder_enquiries(id) ON DELETE CASCADE,
    revision INTEGER NOT NULL,
    proposal_type TEXT NOT NULL CHECK (proposal_type IN ('QUANTITY_PROPOSAL', 'CLARIFICATION')),
    staff_note TEXT CHECK (staff_note IS NULL OR LENGTH(staff_note) <= 1000),
    submitted_by UUID NOT NULL REFERENCES auth.users(id),
    submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    superseded_at TIMESTAMPTZ,
    responded_by UUID REFERENCES public.code_finder_users(id),
    response TEXT CHECK (response IS NULL OR response IN ('ACCEPTED', 'REPLIED', 'CANCELLED')),
    responded_at TIMESTAMPTZ,
    UNIQUE (enquiry_id, revision)
);

CREATE TABLE public.code_finder_proposal_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    proposal_id UUID NOT NULL REFERENCES public.code_finder_proposals(id) ON DELETE CASCADE,
    enquiry_item_id UUID NOT NULL REFERENCES public.code_finder_enquiry_items(id) ON DELETE CASCADE,
    proposed_quantity NUMERIC(12,2) NOT NULL CHECK (proposed_quantity > 0 AND proposed_quantity <> 'NaN'::numeric),
    UNIQUE (proposal_id, enquiry_item_id),
    item_note TEXT CHECK (item_note IS NULL OR LENGTH(item_note) <= 500)
);

CREATE INDEX code_finder_proposals_enquiry_idx ON public.code_finder_proposals(enquiry_id, revision DESC);

-- 5. Staff Read Tracking
CREATE TABLE public.code_finder_enquiry_reads (
    enquiry_id UUID NOT NULL REFERENCES public.code_finder_enquiries(id) ON DELETE CASCADE,
    staff_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    read_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (enquiry_id, staff_user_id)
);

CREATE TABLE public.code_finder_message_reads (
    code_finder_user_id UUID NOT NULL REFERENCES public.code_finder_users(id) ON DELETE CASCADE,
    staff_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    last_read_message_created_at TIMESTAMPTZ,
    last_read_message_id UUID REFERENCES public.code_finder_messages(id) ON DELETE SET NULL,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (code_finder_user_id, staff_user_id)
);

-- 6. Notification Outbox with Atomic Claiming
CREATE TABLE public.notification_outbox (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type TEXT NOT NULL CHECK (event_type IN ('NEW_ENQUIRY', 'NEW_MESSAGE', 'PROPOSAL_RESPONSE')),
    event_payload JSONB NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    processed_at TIMESTAMPTZ,
    retry_count INTEGER NOT NULL DEFAULT 0,
    max_retries INTEGER NOT NULL DEFAULT 3,
    next_retry_at TIMESTAMPTZ,
    processing_lease_until TIMESTAMPTZ,
    notification_tag TEXT
);

CREATE INDEX notification_outbox_pending_idx
ON public.notification_outbox(next_retry_at)
WHERE processed_at IS NULL;

CREATE TABLE public.push_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    endpoint TEXT NOT NULL,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_success_at TIMESTAMPTZ,
    failure_count INTEGER NOT NULL DEFAULT 0,
    UNIQUE (user_id, endpoint)
);

CREATE TABLE public.push_delivery_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    outbox_id UUID NOT NULL REFERENCES public.notification_outbox(id) ON DELETE CASCADE,
    subscription_id UUID NOT NULL REFERENCES public.push_subscriptions(id) ON DELETE CASCADE,
    attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL CHECK (status IN ('SUCCESS', 'FAILED', 'EXPIRED')),
    UNIQUE (outbox_id, subscription_id)
);

-- 7. RLS and Grants
ALTER TABLE public.code_finder_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_finder_proposal_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_finder_enquiry_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.code_finder_message_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

-- Read-only business data
GRANT SELECT ON public.code_finder_enquiries TO authenticated;
GRANT SELECT ON public.code_finder_enquiry_items TO authenticated;
GRANT SELECT ON public.code_finder_messages TO authenticated;
GRANT SELECT ON public.code_finder_users TO authenticated;
GRANT SELECT ON public.code_finder_proposals TO authenticated;
GRANT SELECT ON public.code_finder_proposal_items TO authenticated;

-- Message Insert
GRANT INSERT ON public.code_finder_messages TO authenticated;

-- Tracking mutations
GRANT SELECT, INSERT, UPDATE ON public.code_finder_enquiry_reads TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.code_finder_message_reads TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;

-- Policies
CREATE POLICY "staff_read_enquiries" ON public.code_finder_enquiries FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "staff_read_items" ON public.code_finder_enquiry_items FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "staff_read_users" ON public.code_finder_users FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "staff_read_proposals" ON public.code_finder_proposals FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "staff_read_proposal_items" ON public.code_finder_proposal_items FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "staff_read_messages" ON public.code_finder_messages FOR SELECT TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "staff_send_messages" ON public.code_finder_messages FOR INSERT TO authenticated
    WITH CHECK (
        sender_type = 'STAFF' 
        AND sender_auth_user_id = auth.uid()
        AND EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF'))
    );

CREATE POLICY "own_enquiry_reads" ON public.code_finder_enquiry_reads FOR ALL TO authenticated
    USING (staff_user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE id=auth.uid() AND is_active AND role IN ('ADMIN','STAFF')))
WITH CHECK (staff_user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE id=auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "own_message_reads" ON public.code_finder_message_reads FOR ALL TO authenticated
    USING (staff_user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE id=auth.uid() AND is_active AND role IN ('ADMIN','STAFF')))
WITH CHECK (staff_user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE id=auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

CREATE POLICY "own_push_subs" ON public.push_subscriptions FOR ALL TO authenticated
    USING (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE id=auth.uid() AND is_active AND role IN ('ADMIN','STAFF')))
WITH CHECK (user_id = auth.uid() AND EXISTS (SELECT 1 FROM public.user_roles WHERE id=auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));


-- 8. Core RPCs

-- update_enquiry_status
CREATE OR REPLACE FUNCTION public.update_enquiry_status(p_enquiry_id UUID, p_new_status TEXT, p_internal_note TEXT DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_status TEXT;
    v_has_unresolved BOOLEAN;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT status INTO v_current_status
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF p_new_status IS NULL THEN RAISE EXCEPTION 'Status required'; END IF;
    IF p_new_status = 'AWAITING_CLIENT' THEN
      RAISE EXCEPTION 'Use submit_proposal to send a clarification or proposal';
    END IF;
    IF p_new_status = 'CONFIRMED' THEN
        -- Block if there are unresolved quantity proposals
        SELECT EXISTS (
            SELECT 1 FROM public.code_finder_proposals
            WHERE enquiry_id = p_enquiry_id
              AND proposal_type = 'QUANTITY_PROPOSAL'
              AND superseded_at IS NULL AND response IS DISTINCT FROM 'ACCEPTED'
        ) INTO v_has_unresolved;

        IF v_has_unresolved THEN
            RAISE EXCEPTION 'Cannot confirm enquiry with an unresolved quantity proposal.';
        END IF;
    END IF;

    IF v_current_status = 'NEW' AND p_new_status NOT IN ('UNDER_REVIEW', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid transition from NEW to %', p_new_status;
    END IF;

    IF v_current_status = 'UNDER_REVIEW' AND p_new_status NOT IN ('AWAITING_CLIENT', 'CONFIRMED', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid transition from UNDER_REVIEW to %', p_new_status;
    END IF;

    IF v_current_status = 'AWAITING_CLIENT' AND p_new_status NOT IN ('UNDER_REVIEW', 'REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid transition from AWAITING_CLIENT to %', p_new_status;
    END IF;

    IF v_current_status = 'CONFIRMED' AND p_new_status NOT IN ('CANCELLED') THEN
        RAISE EXCEPTION 'Invalid transition from CONFIRMED to %', p_new_status;
    END IF;

    IF v_current_status IN ('REJECTED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Terminal status cannot be changed.';
    END IF;

    UPDATE public.code_finder_enquiries
    SET status = p_new_status,
        confirmed_at = CASE WHEN p_new_status = 'CONFIRMED' THEN NOW() ELSE confirmed_at END,
        internal_note = COALESCE(p_internal_note, internal_note),
        updated_at = NOW()
    WHERE id = p_enquiry_id;
END;
$$;
REVOKE ALL ON FUNCTION public.update_enquiry_status(UUID, TEXT, TEXT) FROM PUBLIC, anon;

-- submit_proposal
CREATE OR REPLACE FUNCTION public.submit_proposal(p_enquiry_id UUID, p_type TEXT, p_staff_note TEXT, p_items JSONB DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_status TEXT;
    v_next_rev INTEGER;
    v_proposal_id UUID;
    v_item RECORD;
BEGIN
    PERFORM public.cf8_require_staff();

    IF NULLIF(BTRIM(p_staff_note), '') IS NULL THEN
      RAISE EXCEPTION 'Customer-visible explanation required';
    END IF;
    IF p_type IS NULL OR p_type NOT IN ('QUANTITY_PROPOSAL', 'CLARIFICATION') THEN
        RAISE EXCEPTION 'Invalid proposal type';
    END IF;

    SELECT status INTO v_status
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF v_status <> 'UNDER_REVIEW' THEN
        RAISE EXCEPTION 'Enquiry must be UNDER_REVIEW to submit a proposal';
    END IF;

    SELECT COALESCE(MAX(revision), 0) + 1 INTO v_next_rev
    FROM public.code_finder_proposals
    WHERE enquiry_id = p_enquiry_id;

    -- Retain history; unresolved superseded versions no longer block confirmation.
    UPDATE public.code_finder_proposals SET superseded_at=NOW()
 WHERE enquiry_id=p_enquiry_id AND superseded_at IS NULL AND proposal_type=p_type;
    INSERT INTO public.code_finder_proposals (enquiry_id, revision, proposal_type, staff_note, submitted_by)
    VALUES (p_enquiry_id, v_next_rev, p_type, p_staff_note, auth.uid())
    RETURNING id INTO v_proposal_id;

    IF p_type = 'QUANTITY_PROPOSAL' THEN
        IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
            RAISE EXCEPTION 'Items must be an array';
        END IF;
        IF jsonb_array_length(p_items) = 0 THEN
            RAISE EXCEPTION 'Quantity proposal requires items';
        END IF;

        -- Each version is a complete quantity proposal, not a partial delta.
        IF jsonb_array_length(p_items) <> (SELECT count(*) FROM public.code_finder_enquiry_items WHERE enquiry_id=p_enquiry_id) THEN
          RAISE EXCEPTION 'Include every enquiry item exactly once';
        END IF;
        FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
            IF NOT EXISTS (
                SELECT 1 FROM public.code_finder_enquiry_items 
                WHERE id = (v_item.value->>'enquiry_item_id')::UUID 
                  AND enquiry_id = p_enquiry_id
            ) THEN
                RAISE EXCEPTION 'Invalid enquiry item provided';
            END IF;

            INSERT INTO public.code_finder_proposal_items (proposal_id, enquiry_item_id, proposed_quantity, item_note)
            VALUES (
                v_proposal_id, 
                (v_item.value->>'enquiry_item_id')::UUID, 
                (v_item.value->>'proposed_quantity')::NUMERIC,
                v_item.value->>'item_note'
            );
        END LOOP;
    END IF;

    UPDATE public.code_finder_enquiries
    SET status = 'AWAITING_CLIENT',
        updated_at = NOW()
    WHERE id = p_enquiry_id;
END;
$$;
REVOKE ALL ON FUNCTION public.submit_proposal(UUID, TEXT, TEXT, JSONB) FROM PUBLIC, anon;

-- respond_to_proposal (Service Role / Edge function only)
CREATE OR REPLACE FUNCTION public.respond_to_proposal(p_proposal_id UUID, p_user_id UUID, p_response TEXT)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_proposal RECORD;
    v_enquiry RECORD;
    v_max_rev INTEGER;
BEGIN
    IF p_user_id IS NULL OR p_response IS NULL OR NOT EXISTS
      (SELECT 1 FROM public.code_finder_users WHERE id=p_user_id AND is_active IS TRUE) THEN
      RAISE EXCEPTION 'Active customer required';
    END IF;
    -- Always lock enquiry before proposal, consistent with staff operations.
    SELECT e.* INTO v_enquiry FROM public.code_finder_enquiries e
    JOIN public.code_finder_proposals p ON p.enquiry_id=e.id
    WHERE p.id=p_proposal_id FOR UPDATE OF e;
    IF NOT FOUND OR v_enquiry.code_finder_user_id IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'Enquiry unavailable';
    END IF;
    SELECT * INTO v_proposal FROM public.code_finder_proposals WHERE id=p_proposal_id FOR UPDATE;
    IF v_proposal.superseded_at IS NOT NULL THEN RAISE EXCEPTION 'Proposal superseded'; END IF;
    IF v_proposal.response = p_response AND v_proposal.responded_by = p_user_id THEN RETURN; END IF;
    IF v_enquiry.status NOT IN ('AWAITING_CLIENT','UNDER_REVIEW') OR v_proposal.response IS NOT NULL THEN
      RAISE EXCEPTION 'Proposal cannot be answered in its current state';
    END IF;
    IF p_response='REPLIED' AND v_proposal.proposal_type='QUANTITY_PROPOSAL' THEN
      RAISE EXCEPTION 'Send a chat message; a quantity proposal requires explicit acceptance';
    END IF;
    IF p_response = 'ACCEPTED' AND v_proposal.proposal_type <> 'QUANTITY_PROPOSAL' THEN
        RAISE EXCEPTION 'Cannot ACCEPT a clarification';
    END IF;

    IF p_response NOT IN ('ACCEPTED', 'REPLIED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid response';
    END IF;

    UPDATE public.code_finder_proposals
    SET response = p_response,
        responded_by = p_user_id,
        responded_at = NOW()
    WHERE id = p_proposal_id;

    IF p_response IN ('ACCEPTED', 'REPLIED') THEN
        UPDATE public.code_finder_enquiries
        SET status = 'UNDER_REVIEW', updated_at = NOW()
        WHERE id = v_enquiry.id;
    ELSIF p_response = 'CANCELLED' THEN
        UPDATE public.code_finder_enquiries
        SET status = 'CANCELLED', updated_at = NOW()
        WHERE id = v_enquiry.id;
    END IF;
END;
$$;
REVOKE ALL ON FUNCTION public.respond_to_proposal(UUID, UUID, TEXT) FROM PUBLIC, anon, authenticated;


-- resolve_enquiry_items
CREATE OR REPLACE FUNCTION public.resolve_enquiry_items(p_enquiry_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT jsonb_agg(
        jsonb_build_object(
            'enquiry_item_id', cei.id,
            'alternative_code_snapshot', cei.alternative_code_snapshot,
            'requested_quantity', cei.requested_quantity,
            'agreed_quantity', COALESCE(api.proposed_quantity, cei.requested_quantity),
            'product_id_snapshot', cei.product_id_snapshot,
            'current_product_id', lpc.product_id,
            'current_product_name', p.product_name,
            'current_stock', p.stock,
            'current_rate', p.rate_laminea,
            'current_calculation_type', p.calculation_type,
            'is_mapped', (lpc.product_id IS NOT NULL),
            'is_reassigned', (cei.product_id_snapshot IS NOT NULL AND lpc.product_id IS NOT NULL AND cei.product_id_snapshot <> lpc.product_id),
            'is_disabled', (lpc.id IS NOT NULL AND lpc.is_active = FALSE),
            'was_not_found', (cei.availability_status = 'CODE_NOT_FOUND')
        )
    ) INTO v_result
    FROM public.code_finder_enquiry_items cei
    LEFT JOIN public.laminea_product_codes lpc ON public.normalize_alternative_code(lpc.alternative_code) = public.normalize_alternative_code(cei.alternative_code_snapshot)
    LEFT JOIN public.products p ON p.id = lpc.product_id AND p.in_laminea = TRUE
    LEFT JOIN public.code_finder_proposals ap ON ap.enquiry_id=cei.enquiry_id
      AND ap.superseded_at IS NULL AND ap.proposal_type='QUANTITY_PROPOSAL' AND ap.response='ACCEPTED'
    LEFT JOIN public.code_finder_proposal_items api ON api.proposal_id=ap.id AND api.enquiry_item_id=cei.id
    WHERE cei.enquiry_id = p_enquiry_id;

    RETURN v_result;
END;
$$;
REVOKE ALL ON FUNCTION public.resolve_enquiry_items(UUID) FROM PUBLIC, anon;

-- create_estimate_from_enquiry
CREATE OR REPLACE FUNCTION public.create_estimate_from_enquiry(
    p_enquiry_id UUID,
    p_idempotency_key UUID,
    p_platform TEXT,
    p_doc_type TEXT,
    p_bill_date TEXT,
    p_client_id UUID,
    p_client_name TEXT,
    p_client_mobile TEXT,
    p_prepared_by TEXT,
    p_order_by TEXT,
    p_site_name TEXT,
    p_totals JSONB,
    p_items JSONB,
    p_previous_balance NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_enquiry RECORD;
    v_has_unresolved BOOLEAN;
    v_est_result JSONB;
    v_item JSONB;
    v_resolved JSONB;
    v_expected JSONB;
    v_est_id UUID;
    v_type TEXT;
    v_normalized_items JSONB := '[]'::jsonb;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT * INTO v_enquiry
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF v_enquiry.status <> 'CONFIRMED' THEN
        RAISE EXCEPTION 'Enquiry must be CONFIRMED before creating an estimate';
    END IF;

    IF p_platform IS DISTINCT FROM 'laminea' OR p_doc_type NOT IN ('ESTIMATE', 'QUOTATION') THEN
      RAISE EXCEPTION 'This operation creates Laminea estimates or quotations only';
    END IF;
    IF p_idempotency_key IS NULL THEN RAISE EXCEPTION 'Idempotency key required'; END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.code_finder_users u JOIN public.clients c ON c.id=u.laminea_client_id
      WHERE u.id=v_enquiry.code_finder_user_id AND c.id=p_client_id AND c.platform='laminea'
    ) THEN RAISE EXCEPTION 'Link the customer to the correct Laminea client first'; END IF;
    IF v_enquiry.converted_estimate_id IS NOT NULL THEN
      SELECT type INTO v_type FROM public.estimates WHERE id=v_enquiry.converted_estimate_id;
      IF v_type NOT IN ('ESTIMATE', 'QUOTATION') THEN
        RAISE EXCEPTION 'Existing linked document requires internal review; do not create another';
      END IF;
      RETURN jsonb_build_object('success',true,'estimate_id',v_enquiry.converted_estimate_id,'duplicate',true);
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.code_finder_proposals
        WHERE enquiry_id = p_enquiry_id
          AND proposal_type = 'QUANTITY_PROPOSAL'
          AND superseded_at IS NULL AND response IS DISTINCT FROM 'ACCEPTED'
    ) INTO v_has_unresolved;

    IF v_has_unresolved THEN
        RAISE EXCEPTION 'Cannot convert enquiry with an unresolved quantity proposal.';
    END IF;

    -- Stabilize mapping and product eligibility until the stock RPC completes.
    PERFORM m.id FROM public.laminea_product_codes m
    JOIN public.code_finder_enquiry_items i ON
      public.normalize_alternative_code(i.alternative_code_snapshot)=public.normalize_alternative_code(m.alternative_code)
    WHERE i.enquiry_id=p_enquiry_id ORDER BY m.id FOR SHARE OF m;
    PERFORM p.id FROM public.products p
    WHERE p.id IN (
      SELECT m.product_id FROM public.laminea_product_codes m
      JOIN public.code_finder_enquiry_items i ON
       public.normalize_alternative_code(i.alternative_code_snapshot)=public.normalize_alternative_code(m.alternative_code)
      WHERE i.enquiry_id=p_enquiry_id)
    ORDER BY p.id FOR NO KEY UPDATE;
    v_resolved := public.resolve_enquiry_items(p_enquiry_id);
    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' OR v_resolved IS NULL THEN
      RAISE EXCEPTION 'Estimate items required';
    END IF;
    IF jsonb_array_length(p_items) <> jsonb_array_length(v_resolved) THEN
      RAISE EXCEPTION 'Include every agreed enquiry item once';
    END IF;
    IF (SELECT count(DISTINCT x->>'enquiry_item_id') FROM jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) THEN
      RAISE EXCEPTION 'Duplicate or missing enquiry item IDs';
    END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_items) LOOP
      SELECT x INTO v_expected FROM jsonb_array_elements(v_resolved) x
      WHERE x->>'enquiry_item_id'=v_item->>'enquiry_item_id';
      IF v_expected IS NULL OR v_expected->>'current_product_name' IS NULL
        OR (v_expected->>'is_disabled')::boolean
        OR (v_expected->>'is_reassigned')::boolean
        OR v_expected->>'product_id_snapshot' IS NULL
        OR (v_expected->>'was_not_found')::boolean THEN
        RAISE EXCEPTION 'Missing historical mapping or changed/ineligible code: resolve internally before conversion';
      END IF;
      IF v_item->>'product_id' IS DISTINCT FROM v_expected->>'current_product_id'
        OR public.normalize_alternative_code(v_item->>'alternative_code_snapshot') IS DISTINCT FROM
           public.normalize_alternative_code(v_expected->>'alternative_code_snapshot')
        OR v_item->>'calculation_type_snapshot' IS DISTINCT FROM v_expected->>'current_calculation_type'
        OR (CASE WHEN v_expected->>'current_calculation_type' IN ('SQFT','INCH','FEET')
             THEN (v_item->>'nos')::numeric ELSE (v_item->>'quantity')::numeric END)
           IS DISTINCT FROM (v_expected->>'agreed_quantity')::numeric THEN
        RAISE EXCEPTION 'Estimate item differs from the agreed enquiry';
      END IF;
      -- Preserve canonical code spelling for the existing stock RPC.
      SELECT jsonb_set(v_item,'{alternative_code_snapshot}',to_jsonb(alternative_code))
      INTO v_item FROM public.laminea_product_codes
      WHERE public.normalize_alternative_code(alternative_code)=
            public.normalize_alternative_code(v_expected->>'alternative_code_snapshot') AND is_active;
      IF v_item IS NULL THEN RAISE EXCEPTION 'Mapping unavailable'; END IF;
      v_normalized_items := v_normalized_items || jsonb_build_array(v_item);
    END LOOP;
    -- Existing RPC validates calculations and performs all stock movements.
    -- Caller-supplied prices remain editable by authorized staff as in the main editor.
    -- Call existing atomic function
    v_est_result := public.process_estimate_atomic(
        p_action => 'SAVE',
        p_estimate_id => NULL,
        p_platform => p_platform,
        p_doc_type => p_doc_type,
        p_bill_date => p_bill_date,
        p_client_name => p_client_name,
        p_prepared_by => p_prepared_by,
        p_totals => p_totals,
        p_items => v_normalized_items,
        p_client_id => p_client_id,
        p_client_mobile => p_client_mobile,
        p_order_by => p_order_by,
        p_site_name => p_site_name,
        p_previous_balance => p_previous_balance,
        p_idempotency_key => p_idempotency_key
    );

    IF (v_est_result->>'success') IS DISTINCT FROM 'true' OR v_est_result->>'estimate_id' IS NULL THEN
      RAISE EXCEPTION 'Estimate save failed; transaction rolled back';
    END IF;
    v_est_id := (v_est_result->>'estimate_id')::uuid;
    IF NOT EXISTS (SELECT 1 FROM public.estimates WHERE id=v_est_id AND platform='laminea'
       AND client_id=p_client_id AND type IN ('ESTIMATE', 'QUOTATION')) THEN
      RAISE EXCEPTION 'Unexpected estimate returned by existing RPC';
    END IF;
    IF EXISTS (SELECT 1 FROM public.code_finder_enquiries WHERE converted_estimate_id=v_est_id AND id<>p_enquiry_id) THEN
      RAISE EXCEPTION 'Estimate already linked to another enquiry';
    END IF;
    UPDATE public.code_finder_enquiries SET converted_estimate_id=v_est_id WHERE id=p_enquiry_id;
    RETURN v_est_result;
END;
$$;
REVOKE ALL ON FUNCTION public.create_estimate_from_enquiry(UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, JSONB, NUMERIC) FROM PUBLIC, anon;

-- Read tracking updates
CREATE OR REPLACE FUNCTION public.mark_enquiry_read(p_enquiry_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.cf8_require_staff();

    INSERT INTO public.code_finder_enquiry_reads (enquiry_id, staff_user_id, read_at)
    VALUES (p_enquiry_id, auth.uid(), NOW())
    ON CONFLICT (enquiry_id, staff_user_id) DO UPDATE SET read_at = NOW();
END;
$$;
REVOKE ALL ON FUNCTION public.mark_enquiry_read(UUID) FROM PUBLIC, anon;

CREATE OR REPLACE FUNCTION public.update_message_read_cursor(p_cf_user_id UUID, p_message_created_at TIMESTAMPTZ, p_message_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.cf8_require_staff();

    IF NOT EXISTS (
        SELECT 1 FROM public.code_finder_messages 
        WHERE id = p_message_id AND code_finder_user_id = p_cf_user_id
    ) THEN
        RAISE EXCEPTION 'Invalid message reference';
    END IF;

    SELECT created_at INTO p_message_created_at FROM public.code_finder_messages WHERE id=p_message_id;
    INSERT INTO public.code_finder_message_reads (code_finder_user_id, staff_user_id, last_read_message_created_at, last_read_message_id, updated_at)
    VALUES (p_cf_user_id, auth.uid(), p_message_created_at, p_message_id, NOW())
    ON CONFLICT (code_finder_user_id, staff_user_id) DO UPDATE 
    SET last_read_message_created_at = p_message_created_at,
        last_read_message_id = p_message_id,
        updated_at = NOW()
    WHERE code_finder_message_reads.last_read_message_created_at IS NULL OR
      (code_finder_message_reads.last_read_message_created_at,code_finder_message_reads.last_read_message_id)
      < (EXCLUDED.last_read_message_created_at,EXCLUDED.last_read_message_id);
END;
$$;
REVOKE ALL ON FUNCTION public.update_message_read_cursor(UUID, TIMESTAMPTZ, UUID) FROM PUBLIC, anon;

-- 9. Notification Triggers

CREATE OR REPLACE FUNCTION public.notify_new_enquiry()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    INSERT INTO public.notification_outbox (event_type, event_payload, notification_tag, next_retry_at)
    VALUES (
        'NEW_ENQUIRY', 
        jsonb_build_object('enquiry_id', NEW.id, 'user_id', NEW.code_finder_user_id),
        'enquiry:' || NEW.id,
        NOW()
    );
    RETURN NEW;
END;
$$;
CREATE TRIGGER trigger_notify_new_enquiry AFTER INSERT ON public.code_finder_enquiries FOR EACH ROW EXECUTE FUNCTION public.notify_new_enquiry();

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
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trigger_notify_new_message AFTER INSERT ON public.code_finder_messages FOR EACH ROW EXECUTE FUNCTION public.notify_new_message();

CREATE OR REPLACE FUNCTION public.notify_proposal_response()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF NEW.response IS NOT NULL AND OLD.response IS NULL THEN
        INSERT INTO public.notification_outbox (event_type, event_payload, notification_tag, next_retry_at)
        VALUES (
            'PROPOSAL_RESPONSE', 
            jsonb_build_object('enquiry_id', NEW.enquiry_id, 'proposal_id', NEW.id, 'response', NEW.response),
            'proposal:' || NEW.id,
            NOW()
        );
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER trigger_notify_proposal_response AFTER UPDATE ON public.code_finder_proposals FOR EACH ROW EXECUTE FUNCTION public.notify_proposal_response();

-- 10. Explicit privileges: grants are additive, so revoke broad defaults first.
ALTER TABLE public.notification_outbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.push_delivery_log ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_outbox, public.push_delivery_log FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.notification_outbox, public.push_delivery_log TO service_role;
REVOKE ALL ON public.code_finder_proposals, public.code_finder_proposal_items FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.code_finder_proposals, public.code_finder_proposal_items TO authenticated;
GRANT ALL ON public.code_finder_proposals, public.code_finder_proposal_items TO service_role;
REVOKE ALL ON public.code_finder_enquiry_reads, public.code_finder_message_reads FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.code_finder_enquiry_reads, public.code_finder_message_reads TO authenticated;
REVOKE ALL ON public.push_subscriptions FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.push_subscriptions TO authenticated;
GRANT ALL ON public.push_subscriptions TO service_role;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER ON
 public.code_finder_enquiries, public.code_finder_enquiry_items, public.code_finder_users FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_enquiry_status(uuid,text,text),
 public.submit_proposal(uuid,text,text,jsonb), public.resolve_enquiry_items(uuid),
 public.mark_enquiry_read(uuid), public.update_message_read_cursor(uuid,timestamptz,uuid),
 public.create_estimate_from_enquiry(uuid,uuid,text,text,text,uuid,text,text,text,text,text,jsonb,jsonb,numeric)
 TO authenticated;
GRANT EXECUTE ON FUNCTION public.respond_to_proposal(uuid,uuid,text) TO service_role;
REVOKE ALL ON FUNCTION public.notify_new_enquiry(),public.notify_new_message(),
 public.notify_proposal_response() FROM PUBLIC, anon, authenticated;

-- Capture new mapping snapshots inside the enquiry transaction. Historical rows
-- remain unknown; never backfill them with today's mapping and call it historical.
CREATE FUNCTION public.cf8_capture_mapping() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 NEW.product_id_snapshot := NULL;
 NEW.product_code_snapshot := NULL;
 NEW.mapping_revision_at := NULL;
 SELECT p.id,p.product_code,m.updated_at
 INTO NEW.product_id_snapshot,NEW.product_code_snapshot,NEW.mapping_revision_at
 FROM public.laminea_product_codes m JOIN public.products p ON p.id=m.product_id
 WHERE public.normalize_alternative_code(m.alternative_code)=
       public.normalize_alternative_code(NEW.alternative_code_snapshot)
   AND m.is_active AND p.in_laminea;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cf8_capture_mapping() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cf8_capture_mapping BEFORE INSERT ON public.code_finder_enquiry_items
FOR EACH ROW EXECUTE FUNCTION public.cf8_capture_mapping();

-- An actual persisted client message resolves clarification only. Quantity
-- proposals remain pending until the explicit acceptance endpoint is called.
CREATE FUNCTION public.cf8_clarification_reply() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_proposal uuid;
BEGIN
 IF NEW.sender_type <> 'CLIENT' OR NEW.enquiry_id IS NULL THEN RETURN NEW; END IF;
 PERFORM 1 FROM public.code_finder_enquiries
 WHERE id=NEW.enquiry_id AND code_finder_user_id=NEW.code_finder_user_id
 AND status='AWAITING_CLIENT' FOR UPDATE;
 IF NOT FOUND THEN RETURN NEW; END IF;
 SELECT id INTO v_proposal FROM public.code_finder_proposals
 WHERE enquiry_id=NEW.enquiry_id AND proposal_type='CLARIFICATION'
 AND superseded_at IS NULL AND response IS NULL FOR UPDATE;
 IF FOUND THEN
  UPDATE public.code_finder_proposals SET response='REPLIED',responded_at=NOW(),
    responded_by=NEW.code_finder_user_id WHERE id=v_proposal;
  UPDATE public.code_finder_enquiries SET status='UNDER_REVIEW' WHERE id=NEW.enquiry_id;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.cf8_clarification_reply() FROM PUBLIC,anon,authenticated;
CREATE TRIGGER cf8_clarification_reply AFTER INSERT ON public.code_finder_messages
FOR EACH ROW EXECUTE FUNCTION public.cf8_clarification_reply();

-- Lease token prevents an expired worker from acknowledging a newer worker's job.
ALTER TABLE public.notification_outbox ADD COLUMN lease_token uuid;
CREATE FUNCTION public.cf8_claim_push(p_limit integer DEFAULT 20)
RETURNS SETOF public.notification_outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
BEGIN
 IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN RAISE EXCEPTION 'Invalid batch size'; END IF;
 RETURN QUERY
 WITH candidates AS (
 SELECT id FROM public.notification_outbox
 WHERE processed_at IS NULL AND retry_count<max_retries
 AND COALESCE(next_retry_at,created_at)<=NOW()
 AND (processing_lease_until IS NULL OR processing_lease_until<NOW())
 ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT p_limit
 )
 UPDATE public.notification_outbox o SET processing_lease_until=NOW()+interval '2 minutes',
 lease_token=gen_random_uuid(), retry_count=retry_count+1
 FROM candidates c WHERE o.id=c.id RETURNING o.*;
END $$;
REVOKE ALL ON FUNCTION public.cf8_claim_push(integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.cf8_claim_push(integer) TO service_role;

-- Staff message retries: frontend supplies a stable UUID for each send attempt.
ALTER TABLE public.code_finder_messages ADD COLUMN IF NOT EXISTS client_message_key uuid;
CREATE UNIQUE INDEX cf8_staff_message_retry
ON public.code_finder_messages(sender_auth_user_id,client_message_key)
WHERE sender_type='STAFF' AND client_message_key IS NOT NULL;

COMMIT;


-- ==========================================
-- FILE: 12_link_code_finder_client.sql
-- ==========================================

BEGIN;

-- ============================================================
-- 1. Link an existing Laminea client
-- ============================================================

CREATE OR REPLACE FUNCTION public.link_code_finder_client(
    p_cf_user_id UUID,
    p_client_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_client JSONB;
BEGIN
    PERFORM public.cf8_require_staff();

    -- Lock the Code Finder user to prevent concurrent changes
    PERFORM 1
    FROM public.code_finder_users
    WHERE id = p_cf_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Code Finder user not found';
    END IF;

    SELECT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'mobile', c.mobile,
        'company_name', c.company_name,
        'owner_name', c.owner_name,
        'platform', c.platform
    )
    INTO v_client
    FROM public.clients c
    WHERE c.id = p_client_id
      AND c.platform = 'laminea';

    IF v_client IS NULL THEN
        RAISE EXCEPTION 'Invalid client or client does not belong to Laminea';
    END IF;

    UPDATE public.code_finder_users
    SET laminea_client_id = p_client_id,
        updated_at = NOW()
    WHERE id = p_cf_user_id;

    RETURN v_client;
END;
$$;

REVOKE ALL
ON FUNCTION public.link_code_finder_client(UUID, UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.link_code_finder_client(UUID, UUID)
TO authenticated;


-- ============================================================
-- 2. Atomically create and link a Laminea client
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_and_link_laminea_client(
    p_cf_user_id UUID,
    p_client_name TEXT,
    p_mobile TEXT DEFAULT NULL,
    p_contact_person TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_client_id UUID;
    v_normalized_name TEXT;
    v_normalized_mobile TEXT;
    v_client JSONB;
BEGIN
    PERFORM public.cf8_require_staff();

    IF p_client_name IS NULL OR TRIM(p_client_name) = '' THEN
        RAISE EXCEPTION 'Client name is required';
    END IF;

    -- Lock the Code Finder user
    PERFORM 1
    FROM public.code_finder_users
    WHERE id = p_cf_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Code Finder user not found';
    END IF;

    v_normalized_name :=
        UPPER(REGEXP_REPLACE(TRIM(p_client_name), '\s+', ' ', 'g'));

    v_normalized_mobile :=
        NULLIF(REGEXP_REPLACE(COALESCE(p_mobile, ''), '\s+', '', 'g'), '');

    -- Prevent two simultaneous requests from creating duplicates
    PERFORM pg_advisory_xact_lock(
        hashtext(
            'code-finder-client:' ||
            v_normalized_name || ':' ||
            COALESCE(v_normalized_mobile, '')
        )
    );

    IF EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.platform = 'laminea'
          AND UPPER(REGEXP_REPLACE(TRIM(c.name), '\s+', ' ', 'g'))
              = v_normalized_name
          AND COALESCE(
                REGEXP_REPLACE(COALESCE(c.mobile, ''), '\s+', '', 'g'),
                ''
              ) = COALESCE(v_normalized_mobile, '')
    ) THEN
        RAISE EXCEPTION
            'A matching Laminea client already exists. Link the existing client instead.';
    END IF;

    INSERT INTO public.clients (
        name,
        company_name,
        owner_name,
        mobile,
        platform,
        opening_balance
    )
    VALUES (
        v_normalized_name,
        v_normalized_name,
        NULLIF(UPPER(TRIM(p_contact_person)), ''),
        v_normalized_mobile,
        'laminea',
        0
    )
    RETURNING id INTO v_client_id;

    UPDATE public.code_finder_users
    SET laminea_client_id = v_client_id,
        updated_at = NOW()
    WHERE id = p_cf_user_id;

    SELECT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'mobile', c.mobile,
        'company_name', c.company_name,
        'owner_name', c.owner_name,
        'platform', c.platform
    )
    INTO v_client
    FROM public.clients c
    WHERE c.id = v_client_id;

    RETURN v_client;
END;
$$;

REVOKE ALL
ON FUNCTION public.create_and_link_laminea_client(
    UUID,
    TEXT,
    TEXT,
    TEXT
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.create_and_link_laminea_client(
    UUID,
    TEXT,
    TEXT,
    TEXT
)
TO authenticated;

COMMIT;


-- ==========================================
-- FILE: 12_restrict_internal_tables.sql
-- ==========================================

BEGIN;

-- 1. Restrict internal ledger table
ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;

-- 2. Restrict internal sequence table
ALTER TABLE public.bill_sequence ENABLE ROW LEVEL SECURITY;

-- 3. Restrict old backup table
ALTER TABLE public.laminea_product_codes_backup_before_08 ENABLE ROW LEVEL SECURITY;

COMMIT;


-- ==========================================
-- FILE: 13_enable_realtime.sql
-- ==========================================

-- Enable Supabase Realtime for Code Finder tables

BEGIN;

-- Add Code Finder tables to the built-in supabase_realtime publication
-- This allows the PostgreSQL changes to be broadcast over WebSockets
ALTER PUBLICATION supabase_realtime ADD TABLE public.code_finder_enquiries;
ALTER PUBLICATION supabase_realtime ADD TABLE public.code_finder_messages;
ALTER PUBLICATION supabase_realtime ADD TABLE public.code_finder_proposals;

COMMIT;


-- ==========================================
-- FILE: 13_fix_message_reads_fkey.sql
-- ==========================================

BEGIN;

ALTER TABLE public.code_finder_message_reads
  DROP CONSTRAINT IF EXISTS code_finder_message_reads_last_read_message_id_fkey;

ALTER TABLE public.code_finder_message_reads
  ADD CONSTRAINT code_finder_message_reads_last_read_message_id_fkey 
  FOREIGN KEY (last_read_message_id) 
  REFERENCES public.code_finder_messages(id) 
  ON DELETE SET NULL;

COMMIT;


-- ==========================================
-- FILE: 14_simplify_enquiry_flow.sql
-- ==========================================

BEGIN;

-- =============================================================================
-- Laminea Code Finder: simplified enquiry -> order workflow
-- NEW -> READY_TO_ORDER
-- NEW/READY_TO_ORDER -> AWAITING_CLIENT -> READY_TO_ORDER
-- READY_TO_ORDER -> ORDER_PLACED
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema and legacy-data migration
-- -----------------------------------------------------------------------------

ALTER TABLE public.code_finder_enquiries
    ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS confirmed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS order_placed_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS order_idempotency_key TEXT;

-- The old constraint must be removed before writing the new status values.
ALTER TABLE public.code_finder_enquiries
    DROP CONSTRAINT IF EXISTS code_finder_enquiries_status_check;

UPDATE public.code_finder_enquiries
SET
    status = 'ORDER_PLACED',
    confirmed_at = COALESCE(confirmed_at, updated_at, created_at),
    order_placed_at = COALESCE(order_placed_at, updated_at, created_at)
WHERE status IN ('CONFIRMED', 'CONVERTED_TO_ESTIMATE');

UPDATE public.code_finder_enquiries
SET status = 'NEW'
WHERE status = 'UNDER_REVIEW';

UPDATE public.code_finder_enquiries
SET status = 'CANCELLED'
WHERE status = 'REJECTED';

ALTER TABLE public.code_finder_enquiries
    ADD CONSTRAINT code_finder_enquiries_status_check
    CHECK (status IN (
        'NEW',
        'AWAITING_CLIENT',
        'READY_TO_ORDER',
        'ORDER_PLACED',
        'CANCELLED'
    ));

CREATE UNIQUE INDEX IF NOT EXISTS code_finder_enquiries_order_idempotency_idx
    ON public.code_finder_enquiries (
        code_finder_user_id,
        order_idempotency_key
    )
    WHERE order_idempotency_key IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 2. Notification routing
-- -----------------------------------------------------------------------------

ALTER TABLE public.notification_outbox
    ADD COLUMN IF NOT EXISTS target_user_id UUID
        REFERENCES auth.users(id) ON DELETE CASCADE,
    ADD COLUMN IF NOT EXISTS target_audience TEXT NOT NULL DEFAULT 'STAFF';

ALTER TABLE public.notification_outbox
    DROP CONSTRAINT IF EXISTS notification_outbox_event_type_check;

ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_event_type_check
    CHECK (event_type IN (
        'NEW_ENQUIRY',
        'NEW_MESSAGE',
        'PROPOSAL_RESPONSE',
        'ENQUIRY_CONFIRMED',
        'PROPOSAL_SUBMITTED',
        'ORDER_PLACED'
    ));

ALTER TABLE public.notification_outbox
    DROP CONSTRAINT IF EXISTS notification_outbox_target_check;

ALTER TABLE public.notification_outbox
    ADD CONSTRAINT notification_outbox_target_check
    CHECK (
        (target_audience = 'STAFF' AND target_user_id IS NULL)
        OR
        (target_audience = 'USER' AND target_user_id IS NOT NULL)
    );

CREATE INDEX IF NOT EXISTS notification_outbox_target_user_idx
    ON public.notification_outbox(target_user_id)
    WHERE target_user_id IS NOT NULL;


-- -----------------------------------------------------------------------------
-- 3. Push subscription endpoint ownership
-- -----------------------------------------------------------------------------

-- Keep the most recently useful row if old data contains the same browser
-- endpoint under more than one user.
WITH ranked_subscriptions AS (
    SELECT
        id,
        ROW_NUMBER() OVER (
            PARTITION BY endpoint
            ORDER BY
                last_success_at DESC NULLS LAST,
                created_at DESC,
                id DESC
        ) AS row_number
    FROM public.push_subscriptions
)
DELETE FROM public.push_subscriptions ps
USING ranked_subscriptions ranked
WHERE ps.id = ranked.id
  AND ranked.row_number > 1;

CREATE UNIQUE INDEX IF NOT EXISTS push_subscriptions_endpoint_unique
    ON public.push_subscriptions(endpoint);


-- -----------------------------------------------------------------------------
-- 4. Retire the legacy generic transition workflow
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.update_enquiry_status(
    p_enquiry_id UUID,
    p_new_status TEXT,
    p_internal_note TEXT DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_current_status TEXT;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT status
    INTO v_current_status
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF p_new_status IS DISTINCT FROM 'CANCELLED' THEN
        RAISE EXCEPTION
            'Use confirm_code_finder_enquiry, submit_proposal, or place_code_finder_order for workflow transitions';
    END IF;

    IF v_current_status = 'CANCELLED' THEN
        RETURN;
    END IF;

    UPDATE public.code_finder_enquiries
    SET
        status = 'CANCELLED',
        internal_note = COALESCE(p_internal_note, internal_note),
        updated_at = NOW()
    WHERE id = p_enquiry_id;
END;
$$;

REVOKE ALL
ON FUNCTION public.update_enquiry_status(UUID, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.update_enquiry_status(UUID, TEXT, TEXT)
TO authenticated;


-- -----------------------------------------------------------------------------
-- 5. Staff confirms an enquiry
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.confirm_code_finder_enquiry(
    p_enquiry_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_enquiry public.code_finder_enquiries%ROWTYPE;
    v_customer_auth_user_id UUID;
    v_has_unresolved_proposal BOOLEAN;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT *
    INTO v_enquiry
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF v_enquiry.status IS DISTINCT FROM 'NEW' THEN
        RAISE EXCEPTION 'Only NEW enquiries can be confirmed directly';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.code_finder_enquiry_items
        WHERE enquiry_id = p_enquiry_id
    ) THEN
        RAISE EXCEPTION 'Enquiry must contain at least one item';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.code_finder_proposals
        WHERE enquiry_id = p_enquiry_id
          AND superseded_at IS NULL
          AND response IS DISTINCT FROM 'ACCEPTED'
    )
    INTO v_has_unresolved_proposal;

    IF v_has_unresolved_proposal THEN
        RAISE EXCEPTION 'Resolve or replace the active proposal before confirming this enquiry';
    END IF;

    SELECT auth_user_id
    INTO v_customer_auth_user_id
    FROM public.code_finder_users
    WHERE id = v_enquiry.code_finder_user_id;

    IF v_customer_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'Code Finder customer account is unavailable';
    END IF;

    UPDATE public.code_finder_enquiries
    SET
        status = 'READY_TO_ORDER',
        confirmed_at = NOW(),
        confirmed_by = auth.uid(),
        updated_at = NOW()
    WHERE id = p_enquiry_id
    RETURNING * INTO v_enquiry;

    INSERT INTO public.notification_outbox (
        event_type,
        event_payload,
        notification_tag,
        next_retry_at,
        target_audience,
        target_user_id
    )
    VALUES (
        'ENQUIRY_CONFIRMED',
        jsonb_build_object(
            'enquiry_id', v_enquiry.id,
            'enquiry_number', v_enquiry.enquiry_number
        ),
        'enquiry-confirmed:' || v_enquiry.id,
        NOW(),
        'USER',
        v_customer_auth_user_id
    );

    RETURN jsonb_build_object(
        'enquiry_id', v_enquiry.id,
        'enquiry_number', v_enquiry.enquiry_number,
        'status', v_enquiry.status,
        'confirmed_at', v_enquiry.confirmed_at
    );
END;
$$;

REVOKE ALL
ON FUNCTION public.confirm_code_finder_enquiry(UUID)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.confirm_code_finder_enquiry(UUID)
TO authenticated;


-- -----------------------------------------------------------------------------
-- 6. Create/edit a proposal (old versions remain immutable history)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.submit_proposal(
    p_enquiry_id UUID,
    p_type TEXT,
    p_staff_note TEXT,
    p_items JSONB DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_enquiry public.code_finder_enquiries%ROWTYPE;
    v_next_revision INTEGER;
    v_proposal_id UUID;
    v_item JSONB;
    v_customer_auth_user_id UUID;
    v_expected_item_count INTEGER;
    v_distinct_item_count INTEGER;
BEGIN
    PERFORM public.cf8_require_staff();

    IF NULLIF(BTRIM(p_staff_note), '') IS NULL THEN
        RAISE EXCEPTION 'Customer-visible explanation is required';
    END IF;

    IF p_type IS NULL
       OR p_type NOT IN ('QUANTITY_PROPOSAL', 'CLARIFICATION') THEN
        RAISE EXCEPTION 'Invalid proposal type';
    END IF;

    SELECT *
    INTO v_enquiry
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF v_enquiry.status NOT IN ('NEW', 'READY_TO_ORDER', 'AWAITING_CLIENT') THEN
        RAISE EXCEPTION
            'Proposal can only be submitted for NEW, READY_TO_ORDER, or AWAITING_CLIENT enquiries';
    END IF;

    SELECT auth_user_id
    INTO v_customer_auth_user_id
    FROM public.code_finder_users
    WHERE id = v_enquiry.code_finder_user_id;

    IF v_customer_auth_user_id IS NULL THEN
        RAISE EXCEPTION 'Code Finder customer account is unavailable';
    END IF;

    IF p_type = 'QUANTITY_PROPOSAL' THEN
        IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'Proposal items must be an array';
        END IF;

        SELECT COUNT(*)
        INTO v_expected_item_count
        FROM public.code_finder_enquiry_items
        WHERE enquiry_id = p_enquiry_id;

        IF v_expected_item_count = 0
           OR jsonb_array_length(p_items) <> v_expected_item_count THEN
            RAISE EXCEPTION 'Include every enquiry item exactly once';
        END IF;

        SELECT COUNT(DISTINCT item->>'enquiry_item_id')
        INTO v_distinct_item_count
        FROM jsonb_array_elements(p_items) AS item;

        IF v_distinct_item_count <> v_expected_item_count THEN
            RAISE EXCEPTION 'Duplicate or missing enquiry item IDs';
        END IF;

        FOR v_item IN
            SELECT value FROM jsonb_array_elements(p_items)
        LOOP
            IF NULLIF(v_item->>'enquiry_item_id', '') IS NULL
               OR NULLIF(v_item->>'proposed_quantity', '') IS NULL THEN
                RAISE EXCEPTION 'Each proposal item requires an item ID and quantity';
            END IF;

            IF (v_item->>'proposed_quantity')::NUMERIC <= 0 THEN
                RAISE EXCEPTION 'Proposed quantities must be greater than zero';
            END IF;

            IF NOT EXISTS (
                SELECT 1
                FROM public.code_finder_enquiry_items
                WHERE id = (v_item->>'enquiry_item_id')::UUID
                  AND enquiry_id = p_enquiry_id
            ) THEN
                RAISE EXCEPTION 'Invalid enquiry item provided';
            END IF;
        END LOOP;
    END IF;

    SELECT COALESCE(MAX(revision), 0) + 1
    INTO v_next_revision
    FROM public.code_finder_proposals
    WHERE enquiry_id = p_enquiry_id;

    -- Exactly one proposal may be active for an enquiry. Editing creates a new
    -- version and preserves the previous version.
    UPDATE public.code_finder_proposals
    SET superseded_at = NOW()
    WHERE enquiry_id = p_enquiry_id
      AND superseded_at IS NULL;

    INSERT INTO public.code_finder_proposals (
        enquiry_id,
        revision,
        proposal_type,
        staff_note,
        submitted_by
    )
    VALUES (
        p_enquiry_id,
        v_next_revision,
        p_type,
        BTRIM(p_staff_note),
        auth.uid()
    )
    RETURNING id INTO v_proposal_id;

    IF p_type = 'QUANTITY_PROPOSAL' THEN
        FOR v_item IN
            SELECT value FROM jsonb_array_elements(p_items)
        LOOP
            INSERT INTO public.code_finder_proposal_items (
                proposal_id,
                enquiry_item_id,
                proposed_quantity,
                item_note
            )
            VALUES (
                v_proposal_id,
                (v_item->>'enquiry_item_id')::UUID,
                (v_item->>'proposed_quantity')::NUMERIC,
                NULLIF(BTRIM(v_item->>'item_note'), '')
            );
        END LOOP;
    END IF;

    UPDATE public.code_finder_enquiries
    SET
        status = 'AWAITING_CLIENT',
        confirmed_at = NULL,
        confirmed_by = NULL,
        updated_at = NOW()
    WHERE id = p_enquiry_id;

    INSERT INTO public.notification_outbox (
        event_type,
        event_payload,
        notification_tag,
        next_retry_at,
        target_audience,
        target_user_id
    )
    VALUES (
        'PROPOSAL_SUBMITTED',
        jsonb_build_object(
            'enquiry_id', p_enquiry_id,
            'proposal_id', v_proposal_id,
            'revision', v_next_revision
        ),
        'proposal-submitted:' || v_proposal_id,
        NOW(),
        'USER',
        v_customer_auth_user_id
    );
END;
$$;

REVOKE ALL
ON FUNCTION public.submit_proposal(UUID, TEXT, TEXT, JSONB)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.submit_proposal(UUID, TEXT, TEXT, JSONB)
TO authenticated;


-- -----------------------------------------------------------------------------
-- 7. Customer responds to the latest proposal (Edge Function/service role)
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.respond_to_proposal(
    p_proposal_id UUID,
    p_user_id UUID,
    p_response TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_proposal public.code_finder_proposals%ROWTYPE;
    v_enquiry public.code_finder_enquiries%ROWTYPE;
BEGIN
    IF p_user_id IS NULL OR NOT EXISTS (
        SELECT 1
        FROM public.code_finder_users
        WHERE id = p_user_id
          AND is_active IS TRUE
    ) THEN
        RAISE EXCEPTION 'Active customer required';
    END IF;

    IF p_response NOT IN ('ACCEPTED', 'REPLIED', 'CANCELLED') THEN
        RAISE EXCEPTION 'Invalid response';
    END IF;

    -- Always lock the enquiry first, then the proposal.
    SELECT enquiry.*
    INTO v_enquiry
    FROM public.code_finder_enquiries enquiry
    JOIN public.code_finder_proposals proposal
      ON proposal.enquiry_id = enquiry.id
    WHERE proposal.id = p_proposal_id
    FOR UPDATE OF enquiry;

    IF NOT FOUND OR v_enquiry.code_finder_user_id IS DISTINCT FROM p_user_id THEN
        RAISE EXCEPTION 'Enquiry unavailable';
    END IF;

    SELECT *
    INTO v_proposal
    FROM public.code_finder_proposals
    WHERE id = p_proposal_id
    FOR UPDATE;

    IF v_proposal.superseded_at IS NOT NULL THEN
        RAISE EXCEPTION 'Proposal has been superseded';
    END IF;

    IF v_proposal.response = p_response
       AND v_proposal.responded_by = p_user_id THEN
        RETURN;
    END IF;

    IF v_enquiry.status IS DISTINCT FROM 'AWAITING_CLIENT'
       OR v_proposal.response IS NOT NULL THEN
        RAISE EXCEPTION 'Proposal cannot be answered in its current state';
    END IF;

    IF p_response = 'ACCEPTED'
       AND v_proposal.proposal_type IS DISTINCT FROM 'QUANTITY_PROPOSAL' THEN
        RAISE EXCEPTION 'Only a quantity proposal can be accepted';
    END IF;

    IF p_response = 'REPLIED'
       AND v_proposal.proposal_type IS DISTINCT FROM 'CLARIFICATION' THEN
        RAISE EXCEPTION 'Quantity proposals require explicit acceptance';
    END IF;

    UPDATE public.code_finder_proposals
    SET
        response = p_response,
        responded_by = p_user_id,
        responded_at = NOW()
    WHERE id = p_proposal_id;

    IF p_response = 'ACCEPTED' THEN
        UPDATE public.code_finder_enquiries
        SET
            status = 'READY_TO_ORDER',
            confirmed_at = NOW(),
            confirmed_by = v_proposal.submitted_by,
            updated_at = NOW()
        WHERE id = v_enquiry.id;
    ELSIF p_response = 'REPLIED' THEN
        UPDATE public.code_finder_enquiries
        SET
            status = 'NEW',
            updated_at = NOW()
        WHERE id = v_enquiry.id;
    ELSE
        UPDATE public.code_finder_enquiries
        SET
            status = 'CANCELLED',
            updated_at = NOW()
        WHERE id = v_enquiry.id;
    END IF;

    -- The existing notify_proposal_response trigger creates the staff outbox
    -- event from this proposal update.
END;
$$;

REVOKE ALL
ON FUNCTION public.respond_to_proposal(UUID, UUID, TEXT)
FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE
ON FUNCTION public.respond_to_proposal(UUID, UUID, TEXT)
TO service_role;


-- -----------------------------------------------------------------------------
-- 8. Customer places an order
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.place_code_finder_order(
    p_enquiry_id UUID,
    p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_code_finder_user_id UUID;
    v_enquiry public.code_finder_enquiries%ROWTYPE;
    v_has_unresolved_proposal BOOLEAN;
BEGIN
    SELECT id
    INTO v_code_finder_user_id
    FROM public.code_finder_users
    WHERE auth_user_id = auth.uid()
      AND is_active IS TRUE;

    IF v_code_finder_user_id IS NULL THEN
        RAISE EXCEPTION 'Active Code Finder user required';
    END IF;

    IF NULLIF(BTRIM(p_idempotency_key), '') IS NULL
       OR LENGTH(p_idempotency_key) > 200 THEN
        RAISE EXCEPTION 'Valid idempotency key required';
    END IF;

    SELECT *
    INTO v_enquiry
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF v_enquiry.code_finder_user_id IS DISTINCT FROM v_code_finder_user_id THEN
        RAISE EXCEPTION 'Permission denied';
    END IF;

    IF v_enquiry.status = 'ORDER_PLACED'
       AND v_enquiry.order_idempotency_key = BTRIM(p_idempotency_key) THEN
        RETURN jsonb_build_object(
            'enquiry_id', v_enquiry.id,
            'enquiry_number', v_enquiry.enquiry_number,
            'status', v_enquiry.status,
            'order_placed_at', v_enquiry.order_placed_at,
            'duplicate', TRUE
        );
    END IF;

    IF v_enquiry.status IS DISTINCT FROM 'READY_TO_ORDER' THEN
        RAISE EXCEPTION 'Enquiry must be READY_TO_ORDER before placing an order';
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.code_finder_proposals
        WHERE enquiry_id = p_enquiry_id
          AND superseded_at IS NULL
          AND response IS DISTINCT FROM 'ACCEPTED'
    )
    INTO v_has_unresolved_proposal;

    IF v_has_unresolved_proposal THEN
        RAISE EXCEPTION 'Cannot place an order while a proposal is unresolved';
    END IF;

    UPDATE public.code_finder_enquiries
    SET
        status = 'ORDER_PLACED',
        order_placed_at = NOW(),
        order_idempotency_key = BTRIM(p_idempotency_key),
        updated_at = NOW()
    WHERE id = p_enquiry_id
    RETURNING * INTO v_enquiry;

    INSERT INTO public.notification_outbox (
        event_type,
        event_payload,
        notification_tag,
        next_retry_at,
        target_audience,
        target_user_id
    )
    VALUES (
        'ORDER_PLACED',
        jsonb_build_object(
            'enquiry_id', v_enquiry.id,
            'enquiry_number', v_enquiry.enquiry_number
        ),
        'order-placed:' || v_enquiry.id,
        NOW(),
        'STAFF',
        NULL
    );

    RETURN jsonb_build_object(
        'enquiry_id', v_enquiry.id,
        'enquiry_number', v_enquiry.enquiry_number,
        'status', v_enquiry.status,
        'order_placed_at', v_enquiry.order_placed_at,
        'duplicate', FALSE
    );
END;
$$;

REVOKE ALL
ON FUNCTION public.place_code_finder_order(UUID, TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.place_code_finder_order(UUID, TEXT)
TO authenticated;


-- -----------------------------------------------------------------------------
-- 9. Bind/unbind the current browser push subscription
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.bind_push_subscription(
    p_endpoint TEXT,
    p_keys_p256dh TEXT,
    p_keys_auth TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_user_id UUID := auth.uid();
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF NULLIF(BTRIM(p_endpoint), '') IS NULL
       OR NULLIF(BTRIM(p_keys_p256dh), '') IS NULL
       OR NULLIF(BTRIM(p_keys_auth), '') IS NULL THEN
        RAISE EXCEPTION 'Complete push subscription details are required';
    END IF;

    INSERT INTO public.push_subscriptions (
        user_id,
        endpoint,
        keys_p256dh,
        keys_auth
    )
    VALUES (
        v_user_id,
        BTRIM(p_endpoint),
        BTRIM(p_keys_p256dh),
        BTRIM(p_keys_auth)
    )
    ON CONFLICT (endpoint)
    DO UPDATE SET
        user_id = EXCLUDED.user_id,
        keys_p256dh = EXCLUDED.keys_p256dh,
        keys_auth = EXCLUDED.keys_auth,
        failure_count = 0;
END;
$$;

CREATE OR REPLACE FUNCTION public.unbind_push_subscription(
    p_endpoint TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication required';
    END IF;

    DELETE FROM public.push_subscriptions
    WHERE endpoint = p_endpoint
      AND user_id = auth.uid();
END;
$$;

REVOKE ALL
ON FUNCTION public.bind_push_subscription(TEXT, TEXT, TEXT)
FROM PUBLIC, anon, authenticated;

REVOKE ALL
ON FUNCTION public.unbind_push_subscription(TEXT)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.bind_push_subscription(TEXT, TEXT, TEXT)
TO authenticated;

GRANT EXECUTE
ON FUNCTION public.unbind_push_subscription(TEXT)
TO authenticated;


-- -----------------------------------------------------------------------------
-- 10. Clarification replies must never restore UNDER_REVIEW
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cf8_clarification_reply()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_proposal_id UUID;
BEGIN
    IF NEW.sender_type <> 'CLIENT' OR NEW.enquiry_id IS NULL THEN
        RETURN NEW;
    END IF;

    PERFORM 1
    FROM public.code_finder_enquiries
    WHERE id = NEW.enquiry_id
      AND code_finder_user_id = NEW.code_finder_user_id
      AND status = 'AWAITING_CLIENT'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN NEW;
    END IF;

    SELECT id
    INTO v_proposal_id
    FROM public.code_finder_proposals
    WHERE enquiry_id = NEW.enquiry_id
      AND proposal_type = 'CLARIFICATION'
      AND superseded_at IS NULL
      AND response IS NULL
    FOR UPDATE;

    IF FOUND THEN
        UPDATE public.code_finder_proposals
        SET
            response = 'REPLIED',
            responded_at = NOW(),
            responded_by = NEW.code_finder_user_id
        WHERE id = v_proposal_id;

        UPDATE public.code_finder_enquiries
        SET
            status = 'NEW',
            updated_at = NOW()
        WHERE id = NEW.enquiry_id;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL
ON FUNCTION public.cf8_clarification_reply()
FROM PUBLIC, anon, authenticated;


-- -----------------------------------------------------------------------------
-- 11. Estimate creation is allowed only after the customer places the order
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.create_estimate_from_enquiry(
    p_enquiry_id UUID,
    p_idempotency_key UUID,
    p_platform TEXT,
    p_doc_type TEXT,
    p_bill_date TEXT,
    p_client_id UUID,
    p_client_name TEXT,
    p_client_mobile TEXT,
    p_prepared_by TEXT,
    p_order_by TEXT,
    p_site_name TEXT,
    p_totals JSONB,
    p_items JSONB,
    p_previous_balance NUMERIC
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_enquiry RECORD;
    v_has_unresolved BOOLEAN;
    v_est_result JSONB;
    v_item JSONB;
    v_resolved JSONB;
    v_expected JSONB;
    v_est_id UUID;
    v_type TEXT;
    v_normalized_items JSONB := '[]'::jsonb;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT * INTO v_enquiry
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    IF v_enquiry.status <> 'ORDER_PLACED' THEN
        RAISE EXCEPTION 'The customer must place the order before an estimate can be created';
    END IF;

    IF p_platform IS DISTINCT FROM 'laminea' OR (p_doc_type IS DISTINCT FROM 'ESTIMATE' AND p_doc_type IS DISTINCT FROM 'QUOTATION') THEN
        RAISE EXCEPTION 'This operation creates Laminea estimates or quotations only';
    END IF;

    IF p_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key required';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.code_finder_users customer
        JOIN public.clients client
          ON client.id = customer.laminea_client_id
        WHERE customer.id = v_enquiry.code_finder_user_id
          AND client.id = p_client_id
          AND client.platform = 'laminea'
    ) THEN
        RAISE EXCEPTION 'Link the customer to the correct Laminea client first';
    END IF;

    IF v_enquiry.converted_estimate_id IS NOT NULL THEN
        SELECT type
        INTO v_type
        FROM public.estimates
        WHERE id = v_enquiry.converted_estimate_id;

        IF v_type IS DISTINCT FROM 'ESTIMATE' THEN
            RAISE EXCEPTION 'Existing linked document requires internal review; do not create another';
        END IF;

        RETURN jsonb_build_object(
            'success', TRUE,
            'estimate_id', v_enquiry.converted_estimate_id,
            'duplicate', TRUE
        );
    END IF;

    SELECT EXISTS (
        SELECT 1
        FROM public.code_finder_proposals
        WHERE enquiry_id = p_enquiry_id
          AND superseded_at IS NULL
          AND response IS DISTINCT FROM 'ACCEPTED'
    )
    INTO v_has_unresolved;

    IF v_has_unresolved THEN
        RAISE EXCEPTION 'Cannot convert an enquiry with an unresolved proposal';
    END IF;

    PERFORM mapping.id
    FROM public.laminea_product_codes mapping
    JOIN public.code_finder_enquiry_items item
      ON public.normalize_alternative_code(item.alternative_code_snapshot)
       = public.normalize_alternative_code(mapping.alternative_code)
    WHERE item.enquiry_id = p_enquiry_id
    ORDER BY mapping.id
    FOR SHARE OF mapping;

    PERFORM product.id
    FROM public.products product
    WHERE product.id IN (
        SELECT mapping.product_id
        FROM public.laminea_product_codes mapping
        JOIN public.code_finder_enquiry_items item
          ON public.normalize_alternative_code(item.alternative_code_snapshot)
           = public.normalize_alternative_code(mapping.alternative_code)
        WHERE item.enquiry_id = p_enquiry_id
    )
    ORDER BY product.id
    FOR NO KEY UPDATE;

    v_resolved := public.resolve_enquiry_items(p_enquiry_id);

    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array'
       OR v_resolved IS NULL THEN
        RAISE EXCEPTION 'Estimate items required';
    END IF;

    IF jsonb_array_length(p_items) <> jsonb_array_length(v_resolved) THEN
        RAISE EXCEPTION 'Include every agreed enquiry item once';
    END IF;

    IF (
        SELECT COUNT(DISTINCT item->>'enquiry_item_id')
        FROM jsonb_array_elements(p_items) item
    ) <> jsonb_array_length(p_items) THEN
        RAISE EXCEPTION 'Duplicate or missing enquiry item IDs';
    END IF;

    FOR v_item IN
        SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        SELECT expected
        INTO v_expected
        FROM jsonb_array_elements(v_resolved) expected
        WHERE expected->>'enquiry_item_id' = v_item->>'enquiry_item_id';

        IF v_expected IS NULL
           OR v_expected->>'current_product_name' IS NULL
           OR (v_expected->>'is_disabled')::BOOLEAN
           OR (v_expected->>'is_reassigned')::BOOLEAN
           OR v_expected->>'product_id_snapshot' IS NULL
           OR (v_expected->>'was_not_found')::BOOLEAN THEN
            RAISE EXCEPTION
                'Missing historical mapping or changed/ineligible code: resolve internally before conversion';
        END IF;

        IF v_item->>'product_id' IS DISTINCT FROM v_expected->>'current_product_id'
           OR public.normalize_alternative_code(v_item->>'alternative_code_snapshot')
              IS DISTINCT FROM
              public.normalize_alternative_code(v_expected->>'alternative_code_snapshot')
           OR v_item->>'calculation_type_snapshot'
              IS DISTINCT FROM v_expected->>'current_calculation_type'
           OR (
                CASE
                    WHEN v_expected->>'current_calculation_type' IN ('SQFT', 'INCH', 'FEET')
                        THEN (v_item->>'nos')::NUMERIC
                    ELSE (v_item->>'quantity')::NUMERIC
                END
              ) IS DISTINCT FROM (v_expected->>'agreed_quantity')::NUMERIC THEN
            RAISE EXCEPTION 'Estimate item differs from the agreed enquiry';
        END IF;

        SELECT jsonb_set(
            v_item,
            '{alternative_code_snapshot}',
            to_jsonb(mapping.alternative_code)
        )
        INTO v_item
        FROM public.laminea_product_codes mapping
        WHERE public.normalize_alternative_code(mapping.alternative_code)
              = public.normalize_alternative_code(
                    v_expected->>'alternative_code_snapshot'
                )
          AND mapping.is_active;

        IF v_item IS NULL THEN
            RAISE EXCEPTION 'Mapping unavailable';
        END IF;

        v_normalized_items :=
            v_normalized_items || jsonb_build_array(v_item);
    END LOOP;

    v_est_result := public.process_estimate_atomic(
        p_action => 'SAVE',
        p_estimate_id => NULL,
        p_platform => p_platform,
        p_doc_type => p_doc_type,
        p_bill_date => p_bill_date,
        p_client_name => p_client_name,
        p_prepared_by => p_prepared_by,
        p_totals => p_totals,
        p_items => v_normalized_items,
        p_client_id => p_client_id,
        p_client_mobile => p_client_mobile,
        p_order_by => p_order_by,
        p_site_name => p_site_name,
        p_previous_balance => p_previous_balance,
        p_idempotency_key => p_idempotency_key
    );

    IF (v_est_result->>'success') IS DISTINCT FROM 'true'
       OR v_est_result->>'estimate_id' IS NULL THEN
        RAISE EXCEPTION 'Estimate save failed; transaction rolled back';
    END IF;

    v_est_id := (v_est_result->>'estimate_id')::UUID;

    IF NOT EXISTS (
        SELECT 1
        FROM public.estimates
        WHERE id = v_est_id
          AND platform = 'laminea'
          AND client_id = p_client_id
          AND type IN ('ESTIMATE', 'QUOTATION')
    ) THEN
        RAISE EXCEPTION 'Unexpected estimate returned by existing RPC';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.code_finder_enquiries
        WHERE converted_estimate_id = v_est_id
          AND id <> p_enquiry_id
    ) THEN
        RAISE EXCEPTION 'Estimate already linked to another enquiry';
    END IF;

    UPDATE public.code_finder_enquiries
    SET converted_estimate_id = v_est_id
    WHERE id = p_enquiry_id;

    -- Deliberately keep the customer-visible status as ORDER_PLACED.
    RETURN v_est_result;
END;
$$;

REVOKE ALL
ON FUNCTION public.create_estimate_from_enquiry(
    UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT,
    TEXT, TEXT, TEXT, JSONB, JSONB, NUMERIC
)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.create_estimate_from_enquiry(
    UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT,
    TEXT, TEXT, TEXT, JSONB, JSONB, NUMERIC
)
TO authenticated;

COMMIT;


-- ==========================================
-- FILE: 14_staff_delete_messages.sql
-- ==========================================

BEGIN;

-- Grant DELETE permission to the authenticated role for messages
GRANT DELETE ON public.code_finder_messages TO authenticated;

-- Create an RLS policy that allows active STAFF and ADMIN to delete messages
CREATE POLICY "staff_delete_messages" ON public.code_finder_messages FOR DELETE TO authenticated
    USING (EXISTS (SELECT 1 FROM public.user_roles WHERE id = auth.uid() AND is_active AND role IN ('ADMIN','STAFF')));

COMMIT;


-- ==========================================
-- FILE: 15_add_message_replies.sql
-- ==========================================

BEGIN;

ALTER TABLE public.code_finder_messages
    ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES public.code_finder_messages(id) ON DELETE SET NULL;

COMMIT;


-- ==========================================
-- FILE: 15_recheck_enquiry_stock.sql
-- ==========================================

BEGIN;

-- Remove the stored stock snapshot if the previous script added it.
-- Live stock must always come directly from products.
ALTER TABLE public.code_finder_enquiry_items
DROP COLUMN IF EXISTS live_stock_snapshot;


-- ============================================================
-- 1. Recheck enquiry availability using live database stock
-- ============================================================

CREATE OR REPLACE FUNCTION public.recheck_enquiry_stock(
    p_enquiry_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.cf8_require_staff();

    IF NOT EXISTS (
        SELECT 1
        FROM public.code_finder_enquiries
        WHERE id = p_enquiry_id
    ) THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    WITH resolved AS (
        SELECT
            cei.id AS enquiry_item_id,
            lpc.product_id,
            lpc.is_active,
            p.id AS eligible_product_id,
            p.has_stock,
            p.stock,

            -- Use the latest accepted proposed quantity.
            -- Fall back to the originally requested quantity.
            COALESCE(
                accepted_item.proposed_quantity,
                cei.requested_quantity
            ) AS effective_quantity

        FROM public.code_finder_enquiry_items cei

        LEFT JOIN public.laminea_product_codes lpc
          ON public.normalize_alternative_code(
                 lpc.alternative_code
             ) = public.normalize_alternative_code(
                 cei.alternative_code_snapshot
             )

        LEFT JOIN public.products p
          ON p.id = lpc.product_id
         AND p.in_laminea IS TRUE

        LEFT JOIN LATERAL (
            SELECT cpi.proposed_quantity
            FROM public.code_finder_proposals cp
            JOIN public.code_finder_proposal_items cpi
              ON cpi.proposal_id = cp.id
            WHERE cp.enquiry_id = cei.enquiry_id
              AND cpi.enquiry_item_id = cei.id
              AND cp.proposal_type = 'QUANTITY_PROPOSAL'
              AND cp.response = 'ACCEPTED'
              AND cp.superseded_at IS NULL
            ORDER BY cp.revision DESC, cp.submitted_at DESC
            LIMIT 1
        ) accepted_item ON TRUE

        WHERE cei.enquiry_id = p_enquiry_id
    )

    UPDATE public.code_finder_enquiry_items cei
    SET
        availability_status = CASE
            -- Missing, inactive, or non-Laminea product
            WHEN resolved.product_id IS NULL
              OR resolved.is_active IS DISTINCT FROM TRUE
              OR resolved.eligible_product_id IS NULL
                THEN 'CODE_NOT_FOUND'

            -- Non-stock Laminea products remain valid but require confirmation
            WHEN resolved.has_stock IS DISTINCT FROM TRUE
                THEN 'PLEASE_CONFIRM'

            -- Quantities above 10 always require confirmation
            WHEN resolved.effective_quantity > 10
                THEN 'PLEASE_CONFIRM'

            -- Stock-managed product with sufficient live stock
            WHEN COALESCE(resolved.stock, 0)
                 >= resolved.effective_quantity
                THEN 'AVAILABLE'

            ELSE 'PLEASE_CONFIRM'
        END,

        checked_at = NOW()

    FROM resolved
    WHERE cei.id = resolved.enquiry_item_id;
END;
$$;

REVOKE ALL
ON FUNCTION public.recheck_enquiry_stock(UUID)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.recheck_enquiry_stock(UUID)
TO authenticated;


-- ============================================================
-- 2. Return live product details to staff
-- ============================================================

CREATE OR REPLACE FUNCTION public.resolve_enquiry_items(
    p_enquiry_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_result JSONB;
BEGIN
    PERFORM public.cf8_require_staff();

    IF NOT EXISTS (
        SELECT 1
        FROM public.code_finder_enquiries
        WHERE id = p_enquiry_id
    ) THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'enquiry_item_id',
                    cei.id,

                'alternative_code_snapshot',
                    cei.alternative_code_snapshot,

                'requested_quantity',
                    cei.requested_quantity,

                'agreed_quantity',
                    COALESCE(
                        accepted_item.proposed_quantity,
                        cei.requested_quantity
                    ),

                'product_id_snapshot',
                    cei.product_id_snapshot,

                'current_product_id',
                    lpc.product_id,

                'current_product_name',
                    p.product_name,

                'current_product_code',
                    p.product_code,

                'current_length',
                    p.length,

                'current_width',
                    p.width,

                'current_unit',
                    p.unit,

                'current_has_stock',
                    p.has_stock,

                -- Current live stock from Product Master
                'current_stock',
                    p.stock,

                'current_rate',
                    p.rate_laminea,

                'current_calculation_type',
                    p.calculation_type,

                'is_mapped',
                    (
                        lpc.product_id IS NOT NULL
                        AND p.id IS NOT NULL
                    ),

                'is_reassigned',
                    (
                        cei.product_id_snapshot IS NOT NULL
                        AND lpc.product_id IS NOT NULL
                        AND cei.product_id_snapshot <> lpc.product_id
                    ),

                'is_disabled',
                    (
                        lpc.id IS NOT NULL
                        AND lpc.is_active IS FALSE
                    ),

                'was_not_found',
                    cei.availability_status = 'CODE_NOT_FOUND'
            )
            ORDER BY cei.created_at
        ),
        '[]'::JSONB
    )
    INTO v_result

    FROM public.code_finder_enquiry_items cei

    LEFT JOIN public.laminea_product_codes lpc
      ON public.normalize_alternative_code(
             lpc.alternative_code
         ) = public.normalize_alternative_code(
             cei.alternative_code_snapshot
         )

    LEFT JOIN public.products p
      ON p.id = lpc.product_id
     AND p.in_laminea IS TRUE

    LEFT JOIN LATERAL (
        SELECT cpi.proposed_quantity
        FROM public.code_finder_proposals cp
        JOIN public.code_finder_proposal_items cpi
          ON cpi.proposal_id = cp.id
        WHERE cp.enquiry_id = cei.enquiry_id
          AND cpi.enquiry_item_id = cei.id
          AND cp.proposal_type = 'QUANTITY_PROPOSAL'
          AND cp.response = 'ACCEPTED'
          AND cp.superseded_at IS NULL
        ORDER BY cp.revision DESC, cp.submitted_at DESC
        LIMIT 1
    ) accepted_item ON TRUE

    WHERE cei.enquiry_id = p_enquiry_id;

    RETURN v_result;
END;
$$;

REVOKE ALL
ON FUNCTION public.resolve_enquiry_items(UUID)
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.resolve_enquiry_items(UUID)
TO authenticated;

COMMIT;


-- ==========================================
-- FILE: 16_push_webhooks_and_cron.sql
-- ==========================================

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


-- ==========================================
-- FILE: 17_staff_to_client_push.sql
-- ==========================================

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
        DECLARE
            v_target_user_id UUID;
        BEGIN
            SELECT auth_user_id INTO v_target_user_id FROM public.code_finder_users WHERE id = NEW.code_finder_user_id;
            
            IF v_target_user_id IS NOT NULL THEN
                INSERT INTO public.notification_outbox (event_type, event_payload, notification_tag, target_audience, target_user_id, next_retry_at)
                VALUES (
                    'NEW_STAFF_MESSAGE', 
                    jsonb_build_object('code_finder_user_id', NEW.code_finder_user_id),
                    'staff_message:' || NEW.code_finder_user_id,
                    'USER',
                    v_target_user_id,
                    NOW()
                );
            END IF;
        END;
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


-- ==========================================
-- FILE: 06_code_finder_rpc.sql
-- ==========================================

BEGIN;

CREATE OR REPLACE FUNCTION public.check_laminea_stock_availability(
    p_requests JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_request_count INTEGER;
    v_result JSONB;
BEGIN
    ---------------------------------------------------------------------------
    -- Validate request structure
    ---------------------------------------------------------------------------

    IF p_requests IS NULL
       OR jsonb_typeof(p_requests) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Requests must be provided as a JSON array';
    END IF;

    v_request_count := jsonb_array_length(p_requests);

    IF v_request_count = 0 THEN
        RAISE EXCEPTION 'At least one request is required';
    END IF;

    IF v_request_count > 25 THEN
        RAISE EXCEPTION 'Maximum 25 codes are allowed per request';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_requests) AS request(value)
        WHERE jsonb_typeof(request.value) IS DISTINCT FROM 'object'
    ) THEN
        RAISE EXCEPTION 'Every request must be a JSON object';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_requests) AS request(value)
        WHERE LENGTH(COALESCE(request.value ->> 'code', '')) > 100
    ) THEN
        RAISE EXCEPTION 'Alternative code cannot exceed 100 characters';
    END IF;

    ---------------------------------------------------------------------------
    -- Normalize, aggregate, resolve mapping and calculate availability
    ---------------------------------------------------------------------------

    WITH input_rows AS (
        SELECT
            request.ordinality::INTEGER AS input_order,
            NULLIF(TRIM(request.value ->> 'code'), '') AS display_code,

            public.normalize_alternative_code(
                request.value ->> 'code'
            ) AS normalized_code,

            CASE
                WHEN request.value ->> 'quantity'
                     ~ '^[+]?(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)$'
                THEN (request.value ->> 'quantity')::NUMERIC
                ELSE NULL
            END AS requested_quantity
        FROM jsonb_array_elements(p_requests)
             WITH ORDINALITY AS request(value, ordinality)
    ),

    aggregated AS (
        SELECT
            normalized_code,

            (
                ARRAY_AGG(
                    UPPER(display_code)
                    ORDER BY input_order
                )
            )[1] AS display_code,

            MIN(input_order) AS first_input_order,

            BOOL_OR(
                requested_quantity IS NULL
                OR requested_quantity <= 0
                OR requested_quantity = 'NaN'::NUMERIC
            ) AS has_invalid_quantity,

            SUM(
                requested_quantity
            ) FILTER (
                WHERE requested_quantity IS NOT NULL
                  AND requested_quantity > 0
                  AND requested_quantity <> 'NaN'::NUMERIC
            ) AS total_quantity

        FROM input_rows
        WHERE normalized_code IS NOT NULL
          AND normalized_code <> ''
        GROUP BY normalized_code
    ),

    resolved AS (
        SELECT
            aggregated.normalized_code,
            aggregated.display_code,
            aggregated.first_input_order,
            aggregated.has_invalid_quantity,
            aggregated.total_quantity,

            mapping.product_id,
            product.stock

        FROM aggregated

        LEFT JOIN public.laminea_product_codes AS mapping
          ON mapping.is_active IS TRUE
         AND public.normalize_alternative_code(
                 mapping.alternative_code
             ) = aggregated.normalized_code

        LEFT JOIN public.products AS product
          ON product.id = mapping.product_id
    )

    SELECT COALESCE(
        JSONB_AGG(
            CASE
                WHEN has_invalid_quantity THEN
                    JSONB_BUILD_OBJECT(
                        'code',
                        COALESCE(display_code, normalized_code),

                        'requestedQuantity',
                        'Invalid',

                        'status',
                        'INVALID QUANTITY'
                    )

                WHEN product_id IS NULL THEN
                    JSONB_BUILD_OBJECT(
                        'code',
                        COALESCE(display_code, normalized_code),

                        'requestedQuantity',
                        total_quantity,

                        'status',
                        'CODE NOT FOUND'
                    )

                ELSE
                    JSONB_BUILD_OBJECT(
                        'code',
                        COALESCE(display_code, normalized_code),

                        'requestedQuantity',
                        total_quantity,

                        'status',
                        CASE
                            -- This preserves your current maximum-10 rule.
                            WHEN total_quantity BETWEEN 1 AND 10
                             AND COALESCE(stock, 0) >= total_quantity
                                THEN 'AVAILABLE'
                            ELSE 'PLEASE CONFIRM WITH US'
                        END
                    )
            END
            ORDER BY first_input_order
        ),
        '[]'::JSONB
    )
    INTO v_result
    FROM resolved;

    IF v_result = '[]'::JSONB THEN
        RAISE EXCEPTION 'No valid alternative codes were provided';
    END IF;

    RETURN v_result;
END;
$$;

REVOKE ALL
ON FUNCTION public.check_laminea_stock_availability(JSONB)
FROM PUBLIC, anon, authenticated;

GRANT EXECUTE
ON FUNCTION public.check_laminea_stock_availability(JSONB)
TO service_role;

COMMIT;

-- ==========================================
-- FILE: 07_send_message_rpc.sql
-- ==========================================

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

-- ==========================================
-- FILE: 18_client_maintain_ledger.sql
-- ==========================================

BEGIN;

ALTER TABLE public.clients
ADD COLUMN maintain_ledger BOOLEAN NOT NULL DEFAULT true;

-- Update the RPC to accept opening_balance and maintain_ledger
CREATE OR REPLACE FUNCTION public.create_and_link_laminea_client(
    p_cf_user_id UUID,
    p_client_name TEXT,
    p_mobile TEXT DEFAULT NULL,
    p_contact_person TEXT DEFAULT NULL,
    p_opening_balance NUMERIC DEFAULT 0,
    p_maintain_ledger BOOLEAN DEFAULT true
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_client_id UUID;
    v_normalized_name TEXT;
    v_normalized_mobile TEXT;
    v_client JSONB;
BEGIN
    PERFORM public.cf8_require_staff();

    IF p_client_name IS NULL OR TRIM(p_client_name) = '' THEN
        RAISE EXCEPTION 'Client name is required';
    END IF;

    -- Lock the Code Finder user
    PERFORM 1
    FROM public.code_finder_users
    WHERE id = p_cf_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Code Finder user not found';
    END IF;

    v_normalized_name :=
        UPPER(REGEXP_REPLACE(TRIM(p_client_name), '\s+', ' ', 'g'));

    v_normalized_mobile :=
        NULLIF(REGEXP_REPLACE(COALESCE(p_mobile, ''), '\s+', '', 'g'), '');

    -- Prevent two simultaneous requests from creating duplicates
    PERFORM pg_advisory_xact_lock(
        hashtext(
            'code-finder-client:' ||
            v_normalized_name || ':' ||
            COALESCE(v_normalized_mobile, '')
        )
    );

    IF EXISTS (
        SELECT 1
        FROM public.clients c
        WHERE c.platform = 'laminea'
          AND UPPER(REGEXP_REPLACE(TRIM(c.name), '\s+', ' ', 'g'))
              = v_normalized_name
          AND COALESCE(
                REGEXP_REPLACE(COALESCE(c.mobile, ''), '\s+', '', 'g'),
                ''
              ) = COALESCE(v_normalized_mobile, '')
    ) THEN
        RAISE EXCEPTION
            'A matching Laminea client already exists. Link the existing client instead.';
    END IF;

    INSERT INTO public.clients (
        name,
        company_name,
        owner_name,
        mobile,
        platform,
        opening_balance,
        maintain_ledger
    )
    VALUES (
        v_normalized_name,
        v_normalized_name,
        NULLIF(UPPER(TRIM(p_contact_person)), ''),
        v_normalized_mobile,
        'laminea',
        p_opening_balance,
        p_maintain_ledger
    )
    RETURNING id INTO v_client_id;

    UPDATE public.code_finder_users
    SET laminea_client_id = v_client_id,
        updated_at = NOW()
    WHERE id = p_cf_user_id;

    SELECT jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'mobile', c.mobile,
        'company_name', c.company_name,
        'owner_name', c.owner_name,
        'platform', c.platform,
        'maintain_ledger', c.maintain_ledger
    )
    INTO v_client
    FROM public.clients c
    WHERE c.id = v_client_id;

    RETURN v_client;
END;
$$;

COMMIT;

-- ==========================================
-- FILE: 19_add_ordered_by_to_enquiries.sql
-- ==========================================

BEGIN;

ALTER TABLE public.code_finder_enquiries
ADD COLUMN IF NOT EXISTS ordered_by TEXT;

ALTER TABLE public.code_finder_enquiries
DROP CONSTRAINT IF EXISTS code_finder_enquiries_ordered_by_check;

ALTER TABLE public.code_finder_enquiries
ADD CONSTRAINT code_finder_enquiries_ordered_by_check
CHECK (
    ordered_by IS NULL
    OR LENGTH(TRIM(ordered_by)) BETWEEN 1 AND 100
);

CREATE UNIQUE INDEX IF NOT EXISTS code_finder_enquiries_idempotency_idx
ON public.code_finder_enquiries (
    code_finder_user_id,
    idempotency_key
)
WHERE idempotency_key IS NOT NULL;

--
-- p_user_id must be public.code_finder_users.id,
-- not auth.users.id.
-- =============================================================================

DROP FUNCTION IF EXISTS public.create_code_finder_enquiry(
    UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT
);

CREATE OR REPLACE FUNCTION public.create_code_finder_enquiry(
    p_user_id UUID,
    p_items JSONB,
    p_client_note TEXT DEFAULT NULL,
    p_checked_at TIMESTAMPTZ DEFAULT NOW(),
    p_idempotency_key TEXT DEFAULT NULL,
    p_ordered_by TEXT DEFAULT NULL
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

    v_code TEXT;
    v_status TEXT;
    v_quantity NUMERIC(12,2);

    v_checked_at TIMESTAMPTZ;
    v_idempotency_key TEXT;
BEGIN
    ---------------------------------------------------------------------------
    -- Validate Code Finder user
    ---------------------------------------------------------------------------

    IF p_user_id IS NULL THEN
        RAISE EXCEPTION 'Code Finder user ID is required.';
    END IF;

    PERFORM 1
    FROM public.code_finder_users
    WHERE id = p_user_id
      AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Code Finder user is inactive or does not exist.';
    END IF;


    ---------------------------------------------------------------------------
    -- Validate idempotency key
    ---------------------------------------------------------------------------

    v_idempotency_key := NULLIF(TRIM(p_idempotency_key), '');

    IF v_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required.';
    END IF;

    IF LENGTH(v_idempotency_key) NOT BETWEEN 8 AND 100 THEN
        RAISE EXCEPTION 'Idempotency key must contain between 8 and 100 characters.';
    END IF;


    ---------------------------------------------------------------------------
    -- Validate enquiry
    ---------------------------------------------------------------------------

    IF p_client_note IS NOT NULL
       AND LENGTH(p_client_note) > 2000 THEN
        RAISE EXCEPTION 'Client note cannot exceed 2000 characters.';
    END IF;

    IF p_ordered_by IS NOT NULL
       AND LENGTH(TRIM(p_ordered_by)) > 100 THEN
        RAISE EXCEPTION 'Ordered by cannot exceed 100 characters.';
    END IF;

    IF p_items IS NULL
       OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Items must be provided as a JSON array.';
    END IF;

    IF jsonb_array_length(p_items) = 0 THEN
        RAISE EXCEPTION 'At least one enquiry item is required.';
    END IF;

    IF jsonb_array_length(p_items) > 25 THEN
        RAISE EXCEPTION 'Maximum 25 items are allowed per enquiry.';
    END IF;

    v_checked_at := COALESCE(p_checked_at, NOW());


    ---------------------------------------------------------------------------
    -- Validate every item before creating the enquiry
    ---------------------------------------------------------------------------

    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_items)
    LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Every enquiry item must be a JSON object.';
        END IF;

        v_code := NULLIF(
            TRIM(v_item ->> 'alternative_code_snapshot'),
            ''
        );

        IF v_code IS NULL THEN
            RAISE EXCEPTION 'Alternative code is required for every item.';
        END IF;

        IF LENGTH(v_code) > 100 THEN
            RAISE EXCEPTION 'Alternative code cannot exceed 100 characters.';
        END IF;

        BEGIN
            v_quantity :=
                (v_item ->> 'requested_quantity')::NUMERIC(12,2);
        EXCEPTION
            WHEN invalid_text_representation
              OR numeric_value_out_of_range THEN
                RAISE EXCEPTION
                    'Invalid requested quantity for alternative code %.',
                    v_code;
        END;

        IF v_quantity IS NULL OR v_quantity <= 0 THEN
            RAISE EXCEPTION
                'Requested quantity must be greater than zero for alternative code %.',
                v_code;
        END IF;

        v_status := v_item ->> 'availability_status';

        IF v_status IS NULL
           OR v_status NOT IN (
               'AVAILABLE',
               'PLEASE_CONFIRM',
               'CODE_NOT_FOUND'
           ) THEN
            RAISE EXCEPTION
                'Invalid availability status for alternative code %.',
                v_code;
        END IF;
    END LOOP;


    ---------------------------------------------------------------------------
    -- Prevent duplicate normalized codes inside the same enquiry payload
    ---------------------------------------------------------------------------

    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS item(value)
        GROUP BY UPPER(
            REGEXP_REPLACE(
                TRIM(item.value ->> 'alternative_code_snapshot'),
                '\s+',
                '',
                'g'
            )
        )
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION
            'Duplicate alternative codes were found in the enquiry.';
    END IF;


    ---------------------------------------------------------------------------
    -- Insert enquiry atomically.
    --
    -- ON CONFLICT makes concurrent retries safe. Only one enquiry is created.
    ---------------------------------------------------------------------------

    INSERT INTO public.code_finder_enquiries (
        code_finder_user_id,
        status,
        client_note,
        checked_at,
        idempotency_key,
        ordered_by
    )
    VALUES (
        p_user_id,
        'NEW',
        NULLIF(TRIM(p_client_note), ''),
        v_checked_at,
        v_idempotency_key,
        NULLIF(TRIM(p_ordered_by), '')
    )
    ON CONFLICT (
        code_finder_user_id,
        idempotency_key
    )
    WHERE idempotency_key IS NOT NULL
    DO NOTHING
    RETURNING id, enquiry_number
    INTO v_enquiry_id, v_enquiry_number;


    ---------------------------------------------------------------------------
    -- Existing request with the same idempotency key
    ---------------------------------------------------------------------------

    IF v_enquiry_id IS NULL THEN
        SELECT id, enquiry_number
        INTO v_existing
        FROM public.code_finder_enquiries
        WHERE code_finder_user_id = p_user_id
          AND idempotency_key = v_idempotency_key;

        IF NOT FOUND THEN
            RAISE EXCEPTION
                'Unable to resolve the existing idempotent enquiry.';
        END IF;

        RETURN jsonb_build_object(
            'success', TRUE,
            'enquiry_id', v_existing.id,
            'enquiry_number', v_existing.enquiry_number,
            'duplicate', TRUE
        );
    END IF;


    ---------------------------------------------------------------------------
    -- Insert all enquiry items
    ---------------------------------------------------------------------------

    INSERT INTO public.code_finder_enquiry_items (
        enquiry_id,
        alternative_code_snapshot,
        requested_quantity,
        availability_status,
        checked_at
    )
    SELECT
        v_enquiry_id,
        TRIM(item.value ->> 'alternative_code_snapshot'),
        (item.value ->> 'requested_quantity')::NUMERIC(12,2),
        item.value ->> 'availability_status',
        v_checked_at
    FROM jsonb_array_elements(p_items) AS item(value);


    RETURN jsonb_build_object(
        'success', TRUE,
        'enquiry_id', v_enquiry_id,
        'enquiry_number', v_enquiry_number,
        'duplicate', FALSE
    );
END;
$$;


-- The RPC can only be called using the service-role key.

REVOKE ALL ON FUNCTION public.create_code_finder_enquiry(
    UUID,
    JSONB,
    TEXT,
    TIMESTAMPTZ,
    TEXT,
    TEXT
) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_code_finder_enquiry(
    UUID,
    JSONB,
    TEXT,
    TIMESTAMPTZ,
    TEXT,
    TEXT
) TO service_role;

COMMIT;

-- ==========================================
-- FILE: fix_bill_sequence.sql
-- ==========================================

CREATE OR REPLACE FUNCTION get_next_bill_number(p_platform TEXT)
RETURNS BIGINT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_prefix INTEGER;
    v_max_val INTEGER;
    v_next_val INTEGER;
BEGIN
    -- prefix format: YYMM (e.g. 2610 for Oct 2026)
    v_prefix := TO_CHAR(CURRENT_DATE, 'YYMM')::INTEGER;
    
    -- Find max for the given platform that starts with this prefix
    SELECT MAX(bill_number) INTO v_max_val
    FROM estimates
    WHERE platform = p_platform
      AND bill_number >= (v_prefix * 1000)
      AND bill_number < ((v_prefix + 1) * 1000);
      
    IF v_max_val IS NULL THEN
        -- First bill of the month: 2610001
        v_next_val := (v_prefix * 1000) + 1;
    ELSE
        v_next_val := v_max_val + 1;
    END IF;
    
    RETURN v_next_val;
END;
$$;

-- ==========================================
-- FILE: fix_cf8_staff_access.sql
-- ==========================================

-- Fix cf8_require_staff to allow Supabase Edge Functions (which use the service_role key)
-- to execute RPC calls that require staff permissions.

CREATE OR REPLACE FUNCTION public.cf8_require_staff() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
 -- Allow execution if called with the service_role key (e.g. from Edge Functions)
 IF current_setting('request.jwt.claims', true)::jsonb ->> 'role' = 'service_role' THEN
  RETURN;
 END IF;

 IF NOT EXISTS (SELECT 1 FROM public.user_roles
 WHERE id=auth.uid() AND is_active IS TRUE AND role IN ('ADMIN','STAFF'))
 OR public.is_active_staff() IS DISTINCT FROM TRUE THEN
 RAISE EXCEPTION 'Active internal staff access required'; END IF;
END $$;

-- ==========================================
-- FILE: fix_product_delete.sql
-- ==========================================

-- Fix product deletion being blocked by laminea_product_codes

ALTER TABLE laminea_product_codes 
DROP CONSTRAINT IF EXISTS laminea_product_codes_product_id_fkey;

ALTER TABLE laminea_product_codes 
ADD CONSTRAINT laminea_product_codes_product_id_fkey 
FOREIGN KEY (product_id) 
REFERENCES products(id) 
ON DELETE CASCADE;

-- Update the immutable trigger to allow ON DELETE SET NULL cascades to modify the foreign keys
CREATE OR REPLACE FUNCTION check_laminea_code_audit_immutable()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Allow updates if they are only setting foreign keys to NULL (due to ON DELETE SET NULL)
        IF NEW.id = OLD.id 
           AND NEW.action = OLD.action 
           AND NEW.alternative_code = OLD.alternative_code
           AND NEW.reason IS NOT DISTINCT FROM OLD.reason
           AND NEW.import_batch_id IS NOT DISTINCT FROM OLD.import_batch_id
           AND NEW.created_at = OLD.created_at
           AND (NEW.previous_product_id IS NOT DISTINCT FROM OLD.previous_product_id OR NEW.previous_product_id IS NULL)
           AND (NEW.new_product_id IS NOT DISTINCT FROM OLD.new_product_id OR NEW.new_product_id IS NULL)
           AND (NEW.actor IS NOT DISTINCT FROM OLD.actor OR NEW.actor IS NULL)
        THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Audit records are immutable and cannot be updated or deleted.';
END;
$$ LANGUAGE plpgsql;

-- ==========================================
-- FILE: fix_user_deletion.sql
-- ==========================================

-- Fix code_finder_user deletion being blocked by enquiries and messages

-- 1. Fix code_finder_enquiries -> code_finder_users
ALTER TABLE public.code_finder_enquiries 
DROP CONSTRAINT IF EXISTS code_finder_enquiries_code_finder_user_id_fkey;

ALTER TABLE public.code_finder_enquiries 
ADD CONSTRAINT code_finder_enquiries_code_finder_user_id_fkey 
FOREIGN KEY (code_finder_user_id) 
REFERENCES public.code_finder_users(id) 
ON DELETE CASCADE;

-- 2. Fix code_finder_messages -> code_finder_enquiries
ALTER TABLE public.code_finder_messages 
DROP CONSTRAINT IF EXISTS code_finder_messages_enquiry_id_code_finder_user_id_fkey,
DROP CONSTRAINT IF EXISTS code_finder_messages_enquiry_id_fkey; -- Just in case it was named this

ALTER TABLE public.code_finder_messages 
ADD CONSTRAINT code_finder_messages_enquiry_id_code_finder_user_id_fkey 
FOREIGN KEY (enquiry_id, code_finder_user_id) 
REFERENCES public.code_finder_enquiries(id, code_finder_user_id) 
ON DELETE CASCADE;
