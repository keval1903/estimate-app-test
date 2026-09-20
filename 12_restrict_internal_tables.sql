BEGIN;

-- 1. Restrict internal ledger table
ALTER TABLE public.stock_ledger ENABLE ROW LEVEL SECURITY;

-- 2. Restrict internal sequence table
ALTER TABLE public.bill_sequence ENABLE ROW LEVEL SECURITY;

-- 3. Restrict old backup table
ALTER TABLE public.laminea_product_codes_backup_before_08 ENABLE ROW LEVEL SECURITY;

COMMIT;
