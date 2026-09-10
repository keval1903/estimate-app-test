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
