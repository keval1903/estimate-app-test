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
