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
