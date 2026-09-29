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
