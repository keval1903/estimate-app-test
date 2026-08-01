-- GST Migration for Estimates Table
-- Run this script in your Supabase SQL Editor

ALTER TABLE estimates ADD COLUMN IF NOT EXISTS sub_total NUMERIC(12,2) DEFAULT 0;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS gst_percent NUMERIC(5,2) DEFAULT 0;
ALTER TABLE estimates ADD COLUMN IF NOT EXISTS gst_amount NUMERIC(12,2) DEFAULT 0;
