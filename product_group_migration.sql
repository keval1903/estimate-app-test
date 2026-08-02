-- ============================================================
-- ESTIMATE APP - PRODUCT GROUP MIGRATION
-- Run this script in Supabase SQL Editor
-- ============================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS product_group TEXT DEFAULT 'Uncategorized';
