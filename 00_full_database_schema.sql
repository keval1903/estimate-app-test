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
