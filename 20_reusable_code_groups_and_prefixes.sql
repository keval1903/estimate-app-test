-- =============================================================================
-- File: 20_reusable_code_groups_and_prefixes.sql
-- Description: Reusable alternative-code groups and customer-specific hidden
--              prefixes for the Laminea Estimate App and Code Finder portal.
-- =============================================================================

BEGIN;

-- Corrected revision, 18 October 2026. Upgrade for the existing Estimate App;
-- NOT a fresh-schema installation. Apply INSTEAD OF the supplied draft.
-- All changes are transactional. Staging verification is still required.
-- Calculation reference: available review20 CreateEstimate.jsx snapshot:
-- rate is NET of discount; do not deduct discount_percent a second time.
-- Preserve monthly purchase isolation, historical snapshots, and customer status.
-- Concurrency tradeoff: stock/mapping/document writers use one transaction lock.
-- This deliberately serializes writes, not SELECT/live availability reads.
-- Every custom RPC that takes row locks in these tables must obey this order:
-- enquiry row (conversion only), cf20 mutation lock, mappings, then products.
-- Validation: 32 local regression checks passed in PGlite/PostgreSQL using a
-- representative pre-group schema and simulated Supabase authentication.
-- This is NOT a test against the live Supabase database or multiple sessions.
-- Deploy matching API/frontend group/prefix fields and explicit response
-- allowlists together with this migration. Enable/check admin-only controls.
-- Legacy idempotent documents with no original request metadata require manual
-- review on retry; the script does not invent their original payloads.
-- Run the COMPLETE file in staging first, during a coordinated deployment.

CREATE OR REPLACE FUNCTION public.cf20_take_mutation_lock()
RETURNS void LANGUAGE sql SET search_path = pg_catalog AS $$
    SELECT pg_catalog.pg_advisory_xact_lock(741853, 20);
$$;
REVOKE ALL ON FUNCTION public.cf20_take_mutation_lock() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.cf20_lock_before_statement()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
    PERFORM public.cf20_take_mutation_lock();
    RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION public.cf20_lock_before_statement() FROM PUBLIC, anon, authenticated;

-- Store original request intent rather than comparing against edited documents.
ALTER TABLE public.estimates ADD COLUMN IF NOT EXISTS cf20_request_payload JSONB;
ALTER TABLE public.code_finder_enquiries
    ADD COLUMN IF NOT EXISTS cf20_request_payload JSONB,
    ADD COLUMN IF NOT EXISTS cf20_conversion_request JSONB,
    ADD COLUMN IF NOT EXISTS cf20_conversion_key UUID;

CREATE OR REPLACE FUNCTION public.cf20_estimate_request(
    p_platform TEXT, p_doc_type TEXT, p_bill_date TEXT, p_client_id UUID,
    p_client_name TEXT, p_client_mobile TEXT, p_prepared_by TEXT,
    p_order_by TEXT, p_site_name TEXT, p_totals JSONB, p_items JSONB,
    p_previous_balance NUMERIC
) RETURNS JSONB LANGUAGE sql IMMUTABLE SET search_path = pg_catalog AS $$
    SELECT jsonb_build_object(
        'platform', lower(btrim(p_platform)), 'type', upper(btrim(p_doc_type)),
        'bill_date', btrim(p_bill_date), 'client_id', p_client_id,
        'client_name', upper(btrim(p_client_name)), 'client_mobile', btrim(p_client_mobile),
        'prepared_by', upper(btrim(p_prepared_by)), 'order_by', upper(btrim(p_order_by)),
        'site_name', nullif(upper(btrim(p_site_name)), ''),
        'totals', p_totals, 'previous_balance', coalesce(p_previous_balance, 0),
        'items', coalesce((
            SELECT jsonb_agg(value - 'id' - 'estimate_item_id' - 'base_rate' ORDER BY ord)
            FROM jsonb_array_elements(p_items) WITH ORDINALITY AS x(value,ord)
        ), '[]'::jsonb)
    );
$$;
REVOKE ALL ON FUNCTION public.cf20_estimate_request(TEXT,TEXT,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,NUMERIC)
FROM PUBLIC, anon, authenticated;

-- =============================================================================
-- 1. CODE GROUPS TABLE & HELPERS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.normalize_customer_prefix(p_prefix TEXT)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
PARALLEL SAFE
AS $$
    SELECT NULLIF(
        UPPER(
            REGEXP_REPLACE(
                BTRIM(COALESCE(p_prefix, '')),
                '\s+',
                '',
                'g'
            )
        ),
        ''
    );
$$;

CREATE TABLE IF NOT EXISTS public.laminea_code_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL
        CHECK (LENGTH(BTRIM(name)) BETWEEN 1 AND 100),
    normalized_name TEXT GENERATED ALWAYS AS (
        public.normalize_alternative_code(name)
    ) STORED,
    description TEXT
        CHECK (description IS NULL OR LENGTH(description) <= 500),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    disabled_at TIMESTAMPTZ,
    disabled_by UUID REFERENCES public.user_roles(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS laminea_code_groups_normalized_name_idx
    ON public.laminea_code_groups(normalized_name);

DROP TRIGGER IF EXISTS laminea_code_groups_updated_at ON public.laminea_code_groups;
CREATE TRIGGER laminea_code_groups_updated_at
    BEFORE UPDATE ON public.laminea_code_groups
    FOR EACH ROW
    EXECUTE FUNCTION public.update_updated_at();

CREATE OR REPLACE FUNCTION public.trg_laminea_code_groups_normalize()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.name := UPPER(REGEXP_REPLACE(BTRIM(COALESCE(NEW.name, '')), '\s+', ' ', 'g'));
    IF NEW.name = '' THEN
        RAISE EXCEPTION 'Group name cannot be blank.';
    END IF;

    IF TG_OP = 'INSERT' THEN
        IF NEW.is_active = FALSE THEN
            NEW.disabled_at := COALESCE(NEW.disabled_at, NOW());
            NEW.disabled_by := COALESCE(NEW.disabled_by, auth.uid());
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.is_active = FALSE AND OLD.is_active = TRUE THEN
            NEW.disabled_at := NOW();
            NEW.disabled_by := auth.uid();
        ELSIF NEW.is_active = TRUE AND OLD.is_active = FALSE THEN
            NEW.disabled_at := NULL;
            NEW.disabled_by := NULL;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_laminea_code_groups_normalize ON public.laminea_code_groups;
CREATE TRIGGER trg_laminea_code_groups_normalize
    BEFORE INSERT OR UPDATE ON public.laminea_code_groups
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_laminea_code_groups_normalize();


-- =============================================================================
-- 2. ATTACH laminea_product_codes TO GROUPS & BACKFILL LEGACY MAPPINGS
--    (ON DELETE RESTRICT — groups are disabled, never cascade-deleted)
-- =============================================================================

ALTER TABLE public.laminea_product_codes
    ADD COLUMN IF NOT EXISTS group_id UUID;

ALTER TABLE public.laminea_code_audit
    ADD COLUMN IF NOT EXISTS group_id UUID
        REFERENCES public.laminea_code_groups(id)
        ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS group_name_snapshot TEXT;

-- Temporarily disable mapping triggers while backfilling group_id on legacy rows
-- so historical mappings (including any legacy products with > 5 active codes)
-- are preserved without modification or deletion.
ALTER TABLE public.laminea_product_codes
    DISABLE TRIGGER trg_check_laminea_mapping_validity;
ALTER TABLE public.laminea_product_codes
    DISABLE TRIGGER trg_audit_laminea_mapping;

DO $$
DECLARE
    v_legacy_group_id UUID;
    v_overlimit RECORD;
    v_overlimit_count INTEGER := 0;
BEGIN
    -- Create or locate the initial group if legacy ungrouped mappings exist
    -- or if no groups exist yet.
    IF EXISTS (SELECT 1 FROM public.laminea_product_codes WHERE group_id IS NULL)
       OR NOT EXISTS (SELECT 1 FROM public.laminea_code_groups) THEN

        SELECT id
        INTO v_legacy_group_id
        FROM public.laminea_code_groups
        WHERE normalized_name = 'LEGACYDEFAULTGROUP'
        ORDER BY created_at ASC
        LIMIT 1;

        IF v_legacy_group_id IS NULL THEN
            INSERT INTO public.laminea_code_groups (name, description, is_active)
            VALUES (
                'LEGACY DEFAULT GROUP',
                'Automatically created during migration to preserve existing alternative code mappings.',
                TRUE
            )
            RETURNING id INTO v_legacy_group_id;
        END IF;

        UPDATE public.laminea_product_codes
        SET group_id = v_legacy_group_id
        WHERE group_id IS NULL;
    END IF;

    -- Diagnostic report: log any products that currently have > 5 active codes in a group.
    -- Existing mappings are preserved; staff can review them via get_overlimit_group_products().
    FOR v_overlimit IN
        SELECT
            g.name AS group_name,
            p.product_code,
            p.product_name,
            COUNT(*) AS active_code_count
        FROM public.laminea_product_codes lpc
        JOIN public.laminea_code_groups g ON g.id = lpc.group_id
        LEFT JOIN public.products p ON p.id = lpc.product_id
        WHERE lpc.is_active = TRUE
        GROUP BY g.id, g.name, lpc.product_id, p.product_code, p.product_name
        HAVING COUNT(*) > 5
        ORDER BY COUNT(*) DESC
    LOOP
        v_overlimit_count := v_overlimit_count + 1;
        RAISE NOTICE 'Legacy product exceeds 5 active codes in group "%": [%] % (% active codes preserved)',
            v_overlimit.group_name,
            COALESCE(v_overlimit.product_code, 'NO-CODE'),
            COALESCE(v_overlimit.product_name, 'Unknown'),
            v_overlimit.active_code_count;
    END LOOP;

    IF v_overlimit_count > 0 THEN
        RAISE NOTICE 'Total products with > 5 preserved active codes: %. Use SELECT * FROM public.get_overlimit_group_products() to inspect.',
            v_overlimit_count;
    END IF;
END;
$$;

ALTER TABLE public.laminea_product_codes
    ENABLE TRIGGER trg_check_laminea_mapping_validity;
ALTER TABLE public.laminea_product_codes
    ENABLE TRIGGER trg_audit_laminea_mapping;

ALTER TABLE public.laminea_product_codes
    ALTER COLUMN group_id SET NOT NULL;

ALTER TABLE public.laminea_product_codes
    DROP CONSTRAINT IF EXISTS laminea_product_codes_group_id_fkey;

ALTER TABLE public.laminea_product_codes
    ADD CONSTRAINT laminea_product_codes_group_id_fkey
    FOREIGN KEY (group_id)
    REFERENCES public.laminea_code_groups(id)
    ON DELETE RESTRICT;

-- Replace global unique index with per-group unique index
DROP INDEX IF EXISTS public.laminea_active_alternative_code_unique;
DROP INDEX IF EXISTS public.laminea_alternative_code_unique;

CREATE UNIQUE INDEX IF NOT EXISTS laminea_group_alternative_code_unique
    ON public.laminea_product_codes (
        group_id,
        public.normalize_alternative_code(alternative_code)
    );

CREATE INDEX IF NOT EXISTS laminea_product_codes_group_product_idx
    ON public.laminea_product_codes (group_id, product_id);

-- Helper RPC for staff/admins to inspect any legacy products with > 5 active codes
CREATE OR REPLACE FUNCTION public.get_overlimit_group_products()
RETURNS TABLE (
    group_id UUID,
    group_name TEXT,
    product_id UUID,
    product_code TEXT,
    product_name TEXT,
    active_code_count BIGINT,
    active_codes TEXT[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    PERFORM public.cf8_require_staff();

    RETURN QUERY
    SELECT
        g.id AS group_id,
        g.name AS group_name,
        p.id AS product_id,
        p.product_code,
        p.product_name,
        COUNT(*) AS active_code_count,
        ARRAY_AGG(lpc.alternative_code ORDER BY lpc.alternative_code) AS active_codes
    FROM public.laminea_product_codes lpc
    JOIN public.laminea_code_groups g ON g.id = lpc.group_id
    JOIN public.products p ON p.id = lpc.product_id
    WHERE lpc.is_active = TRUE
    GROUP BY g.id, g.name, p.id, p.product_code, p.product_name
    HAVING COUNT(*) > 5
    ORDER BY COUNT(*) DESC, p.product_name ASC;
END;
$$;

REVOKE ALL ON FUNCTION public.get_overlimit_group_products() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_overlimit_group_products() TO authenticated;


-- =============================================================================
-- 3. GROUP-AWARE VALIDATION & AUDIT TRIGGERS
-- =============================================================================

CREATE OR REPLACE FUNCTION public.check_laminea_mapping_validity()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    prod_in_laminea BOOLEAN;
    prod_has_stock BOOLEAN;
    prod_unit TEXT;
    prod_code TEXT;
    norm_new_alt TEXT;
    v_active_count INTEGER;
BEGIN
    IF NEW.group_id IS NULL THEN
        RAISE EXCEPTION 'Alternative code group is required.';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.laminea_code_groups
        WHERE id = NEW.group_id
    ) THEN
        RAISE EXCEPTION 'Selected alternative code group does not exist.';
    END IF;

    -- Preserve display formatting with uppercase and single internal spaces
    NEW.alternative_code := UPPER(REGEXP_REPLACE(BTRIM(COALESCE(NEW.alternative_code, '')), '\s+', ' ', 'g'));
    norm_new_alt := public.normalize_alternative_code(NEW.alternative_code);

    IF BTRIM(NEW.alternative_code) = '' OR norm_new_alt = '' THEN
        RAISE EXCEPTION 'Alternative code cannot be blank.';
    END IF;

    IF LENGTH(NEW.alternative_code) > 30 THEN
        RAISE EXCEPTION 'Alternative code length exceeds 30 characters.';
    END IF;

    -- Consistent locking order across all mapping mutations:
    -- 1. Group-level advisory lock
    -- 2. (group_id, product_id) advisory lock
    -- 3. Product row lock (FOR NO KEY UPDATE)
    PERFORM pg_advisory_xact_lock(
        hashtext('laminea_code_group:' || NEW.group_id::TEXT)
    );
    PERFORM pg_advisory_xact_lock(
        hashtext('laminea_grp_prod:' || NEW.group_id::TEXT || ':' || NEW.product_id::TEXT)
    );

    -- Lock the product and check eligibility
    SELECT in_laminea, has_stock, unit, product_code
    INTO prod_in_laminea, prod_has_stock, prod_unit, prod_code
    FROM public.products
    WHERE id = NEW.product_id
    FOR NO KEY UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Product not found.';
    END IF;

    IF NEW.is_active = TRUE THEN
        IF prod_code IS NULL OR BTRIM(prod_code) = '' THEN
            RAISE EXCEPTION 'Product does not have an actual product code. Update the product code first.';
        END IF;

        IF norm_new_alt = public.normalize_alternative_code(prod_code) THEN
            RAISE EXCEPTION 'Alternative code cannot be identical to its actual product code.';
        END IF;

        IF prod_in_laminea IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'Product is not enabled in Laminea.';
        END IF;

        IF prod_has_stock IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'Product does not have stock management enabled.';
        END IF;

        IF prod_unit IS NULL OR UPPER(BTRIM(prod_unit)) NOT IN ('NOS.', 'SHEET', 'SHEETS', 'PCS', 'PCS.') THEN
            RAISE EXCEPTION 'Product must use a supported unit (Nos., Sheet, Pcs).';
        END IF;

        IF EXISTS (
            SELECT 1
            FROM public.products
            WHERE product_code IS NOT NULL
              AND BTRIM(product_code) <> ''
              AND public.normalize_alternative_code(product_code) = norm_new_alt
        ) THEN
            RAISE EXCEPTION 'Alternative code conflicts with an actual product code.';
        END IF;

        -- Enforce maximum 5 ACTIVE codes per product within a group whenever adding,
        -- reactivating, or moving a code to a different product/group.
        IF TG_OP = 'INSERT'
           OR OLD.is_active IS DISTINCT FROM TRUE
           OR NEW.product_id IS DISTINCT FROM OLD.product_id
           OR NEW.group_id IS DISTINCT FROM OLD.group_id THEN

            SELECT COUNT(*)
            INTO v_active_count
            FROM public.laminea_product_codes
            WHERE group_id = NEW.group_id
              AND product_id = NEW.product_id
              AND is_active = TRUE
              AND id IS DISTINCT FROM NEW.id;

            IF v_active_count >= 5 THEN
                RAISE EXCEPTION 'A product can have at most 5 active alternative codes within a group.';
            END IF;
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.check_product_code_conflict()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public, pg_temp
LANGUAGE plpgsql
AS $$
BEGIN
    IF NEW.product_code IS NOT NULL AND BTRIM(NEW.product_code) <> '' THEN
        IF EXISTS (
            SELECT 1
            FROM public.laminea_product_codes
            WHERE public.normalize_alternative_code(alternative_code) = public.normalize_alternative_code(NEW.product_code)
        ) THEN
            RAISE EXCEPTION 'Actual product code conflicts with an existing alternative code.';
        END IF;
    END IF;

    -- If product is rendered ineligible (including NULL unit or missing product_code), automatically disable its mappings
    IF NEW.in_laminea IS DISTINCT FROM TRUE
       OR NEW.has_stock IS DISTINCT FROM TRUE
       OR NEW.product_code IS NULL
       OR BTRIM(NEW.product_code) = ''
       OR NEW.unit IS NULL
       OR UPPER(BTRIM(NEW.unit)) NOT IN ('NOS.', 'SHEET', 'SHEETS', 'PCS', 'PCS.') THEN
        UPDATE public.laminea_product_codes
        SET is_active = FALSE
        WHERE product_id = NEW.id
          AND is_active = TRUE;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.check_product_code_conflict() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.check_laminea_code_audit_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'UPDATE' THEN
        -- Allow updates ONLY when foreign keys are set to NULL due to ON DELETE SET NULL
        IF NEW.id = OLD.id
           AND NEW.action = OLD.action
           AND NEW.alternative_code = OLD.alternative_code
           AND NEW.reason IS NOT DISTINCT FROM OLD.reason
           AND NEW.import_batch_id IS NOT DISTINCT FROM OLD.import_batch_id
           AND NEW.group_name_snapshot IS NOT DISTINCT FROM OLD.group_name_snapshot
           AND NEW.created_at = OLD.created_at
           AND (NEW.previous_product_id IS NOT DISTINCT FROM OLD.previous_product_id OR NEW.previous_product_id IS NULL)
           AND (NEW.new_product_id IS NOT DISTINCT FROM OLD.new_product_id OR NEW.new_product_id IS NULL)
           AND (NEW.actor IS NOT DISTINCT FROM OLD.actor OR NEW.actor IS NULL)
           AND (NEW.group_id IS NOT DISTINCT FROM OLD.group_id OR NEW.group_id IS NULL)
        THEN
            RETURN NEW;
        END IF;
    END IF;

    RAISE EXCEPTION 'Audit records are immutable and cannot be updated or deleted.';
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_laminea_mapping()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_action TEXT;
    v_actor UUID := CASE
        WHEN COALESCE(auth.jwt()->>'role', '') = 'service_role'
            THEN NULLIF(current_setting('app.laminea_audit_actor', true), '')::UUID
        ELSE auth.uid()
    END;
    v_reason TEXT := NULLIF(BTRIM(COALESCE(current_setting('app.laminea_audit_reason', true), '')), '');
    v_group_name TEXT;
BEGIN
    SELECT name
    INTO v_group_name
    FROM public.laminea_code_groups
    WHERE id = NEW.group_id;

    IF TG_OP = 'INSERT' THEN
        v_action := 'CREATE';

        IF NEW.is_active = FALSE THEN
            NEW.disabled_at := NOW();
            NEW.disabled_by := v_actor;
        END IF;

        INSERT INTO public.laminea_code_audit (
            action,
            alternative_code,
            new_product_id,
            group_id,
            group_name_snapshot,
            reason,
            actor
        )
        VALUES (
            v_action,
            NEW.alternative_code,
            NEW.product_id,
            NEW.group_id,
            v_group_name,
            v_reason,
            v_actor
        );

    ELSIF TG_OP = 'UPDATE' THEN
        IF NEW.is_active = FALSE AND OLD.is_active = TRUE THEN
            v_action := 'DISABLE';
            NEW.disabled_at := NOW();
            NEW.disabled_by := v_actor;

            INSERT INTO public.laminea_code_audit (
                action,
                alternative_code,
                previous_product_id,
                group_id,
                group_name_snapshot,
                reason,
                actor
            )
            VALUES (
                v_action,
                NEW.alternative_code,
                OLD.product_id,
                NEW.group_id,
                v_group_name,
                v_reason,
                v_actor
            );

        ELSIF NEW.is_active = TRUE AND OLD.is_active = FALSE THEN
            v_action := 'REACTIVATE';
            NEW.disabled_at := NULL;
            NEW.disabled_by := NULL;

            INSERT INTO public.laminea_code_audit (
                action,
                alternative_code,
                new_product_id,
                group_id,
                group_name_snapshot,
                reason,
                actor
            )
            VALUES (
                v_action,
                NEW.alternative_code,
                NEW.product_id,
                NEW.group_id,
                v_group_name,
                v_reason,
                v_actor
            );

        ELSIF NEW.product_id IS DISTINCT FROM OLD.product_id
           OR NEW.alternative_code IS DISTINCT FROM OLD.alternative_code
           OR NEW.group_id IS DISTINCT FROM OLD.group_id THEN
            v_action := 'REASSIGN';

            INSERT INTO public.laminea_code_audit (
                action,
                alternative_code,
                previous_product_id,
                new_product_id,
                group_id,
                group_name_snapshot,
                reason,
                actor
            )
            VALUES (
                v_action,
                NEW.alternative_code,
                OLD.product_id,
                NEW.product_id,
                NEW.group_id,
                v_group_name,
                v_reason,
                v_actor
            );
        END IF;
    END IF;

    RETURN NEW;
END;
$$;


-- =============================================================================
-- 4. RLS & PERMISSIONS FOR CODE GROUPS AND MAPPINGS
--    (Active staff can SELECT; only ADMIN can INSERT/UPDATE; DELETE revoked)
-- =============================================================================

ALTER TABLE public.laminea_code_groups ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.laminea_code_groups FROM PUBLIC, anon;
REVOKE DELETE ON public.laminea_code_groups FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.laminea_code_groups TO authenticated;
GRANT ALL ON public.laminea_code_groups TO service_role;

DROP POLICY IF EXISTS "Staff can read code groups" ON public.laminea_code_groups;
DROP POLICY IF EXISTS "Staff can manage code groups" ON public.laminea_code_groups;
DROP POLICY IF EXISTS "Admins can insert code groups" ON public.laminea_code_groups;
DROP POLICY IF EXISTS "Admins can update code groups" ON public.laminea_code_groups;

CREATE POLICY "Staff can read code groups"
    ON public.laminea_code_groups
    FOR SELECT
    TO authenticated
    USING (public.is_active_staff());

CREATE POLICY "Admins can insert code groups"
    ON public.laminea_code_groups
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update code groups"
    ON public.laminea_code_groups
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());

-- Active staff (ADMIN and STAFF) can read mappings; only ADMIN can insert/update mappings;
-- hard DELETE is revoked from authenticated to preserve mapping history.
REVOKE ALL ON public.laminea_product_codes FROM PUBLIC, anon;
REVOKE DELETE ON public.laminea_product_codes FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.laminea_product_codes TO authenticated;
GRANT ALL ON public.laminea_product_codes TO service_role;

DROP POLICY IF EXISTS "Staff can read active mappings" ON public.laminea_product_codes;
DROP POLICY IF EXISTS "Staff can read all mappings" ON public.laminea_product_codes;
DROP POLICY IF EXISTS "Staff can manage mappings" ON public.laminea_product_codes;
DROP POLICY IF EXISTS "Admins can manage mappings" ON public.laminea_product_codes;
DROP POLICY IF EXISTS "Admins can insert mappings" ON public.laminea_product_codes;
DROP POLICY IF EXISTS "Admins can update mappings" ON public.laminea_product_codes;

CREATE POLICY "Staff can read all mappings"
    ON public.laminea_product_codes
    FOR SELECT
    TO authenticated
    USING (public.is_active_staff());

CREATE POLICY "Admins can insert mappings"
    ON public.laminea_product_codes
    FOR INSERT
    TO authenticated
    WITH CHECK (public.is_admin());

CREATE POLICY "Admins can update mappings"
    ON public.laminea_product_codes
    FOR UPDATE
    TO authenticated
    USING (public.is_admin())
    WITH CHECK (public.is_admin());


-- =============================================================================
-- 5. GROUP MANAGEMENT, 5-SLOT PRODUCT CONFIGURATOR & GROUP-SCOPED IMPORT RPCs
-- =============================================================================

-- Establish a lock BEFORE row-level triggers/direct UPDATE tuple locks.
-- RPCs below take the same lock before their SELECT ... FOR UPDATE/SHARE calls.
DO $cf20$
DECLARE v_table text;
BEGIN
    FOREACH v_table IN ARRAY ARRAY[
        'products','laminea_product_codes','laminea_code_groups','estimates','estimate_items'
    ] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS cf20_serialize_writes ON public.%I', v_table);
        EXECUTE format(
            'CREATE TRIGGER cf20_serialize_writes BEFORE INSERT OR UPDATE OR DELETE ON public.%I '
            'FOR EACH STATEMENT EXECUTE FUNCTION public.cf20_lock_before_statement()', v_table
        );
    END LOOP;
END;
$cf20$;

-- Concurrency: group-local locks remain useful inside this global write fence.

CREATE OR REPLACE FUNCTION public.save_laminea_code_group(
    p_group_id UUID DEFAULT NULL,
    p_name TEXT DEFAULT NULL,
    p_description TEXT DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    v_clean_name TEXT;
    v_norm_name TEXT;
    v_group public.laminea_code_groups%ROWTYPE;
BEGIN
    IF v_jwt_role <> 'service_role' AND public.is_admin() IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Unauthorized: admin access required to manage code groups.';
    END IF;
    PERFORM public.cf20_take_mutation_lock();

    v_clean_name := UPPER(REGEXP_REPLACE(BTRIM(COALESCE(p_name, '')), '\s+', ' ', 'g'));
    v_norm_name := public.normalize_alternative_code(v_clean_name);

    IF v_clean_name = '' OR v_norm_name = '' THEN
        RAISE EXCEPTION 'Group name is required.';
    END IF;

    IF LENGTH(v_clean_name) > 100 THEN
        RAISE EXCEPTION 'Group name cannot exceed 100 characters.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.laminea_code_groups
        WHERE normalized_name = v_norm_name
          AND (p_group_id IS NULL OR id <> p_group_id)
    ) THEN
        RAISE EXCEPTION 'A code group with the name "%" already exists.', v_clean_name;
    END IF;

    IF p_group_id IS NULL THEN
        INSERT INTO public.laminea_code_groups (name, description, is_active)
        VALUES (
            v_clean_name,
            NULLIF(BTRIM(COALESCE(p_description, '')), ''),
            COALESCE(p_is_active, TRUE)
        )
        RETURNING * INTO v_group;
    ELSE
        UPDATE public.laminea_code_groups
        SET
            name = v_clean_name,
            description = NULLIF(BTRIM(COALESCE(p_description, '')), ''),
            is_active = COALESCE(p_is_active, is_active),
            updated_at = NOW()
        WHERE id = p_group_id
        RETURNING * INTO v_group;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Code group not found.';
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'id', v_group.id,
        'name', v_group.name,
        'description', v_group.description,
        'is_active', v_group.is_active,
        'created_at', v_group.created_at,
        'updated_at', v_group.updated_at
    );
END;
$$;

REVOKE ALL ON FUNCTION public.save_laminea_code_group(UUID, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_laminea_code_group(UUID, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;


-- Configure the predefined set of up to 5 base alternative codes for a product within a group
DROP FUNCTION IF EXISTS public.save_group_product_codes(UUID, UUID, JSONB);

CREATE OR REPLACE FUNCTION public.save_group_product_codes(
    p_group_id UUID,
    p_product_id UUID,
    p_codes JSONB,
    p_reason TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    v_raw_code TEXT;
    v_display_code TEXT;
    v_norm_code TEXT;
    v_display_codes TEXT[] := '{}';
    v_norm_codes TEXT[] := '{}';
    v_existing RECORD;
    v_idx INTEGER;
    v_created INTEGER := 0;
    v_reactivated INTEGER := 0;
    v_disabled INTEGER := 0;
    v_updated INTEGER := 0;
BEGIN
    IF v_jwt_role <> 'service_role' AND public.is_admin() IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Unauthorized: admin access required to configure product codes.';
    END IF;
    PERFORM public.cf20_take_mutation_lock();

    IF p_group_id IS NULL OR p_product_id IS NULL THEN
        RAISE EXCEPTION 'Both group and product are required.';
    END IF;

    IF p_codes IS NULL OR jsonb_typeof(p_codes) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Codes must be provided as a JSON array.';
    END IF;

    PERFORM set_config('app.laminea_audit_reason', COALESCE(BTRIM(p_reason), ''), true);

    -- Consistent locking strategy:
    -- 1. Group-level advisory lock (prevents concurrent reassignment races in the same group)
    -- 2. (group_id, product_id) advisory lock
    PERFORM pg_advisory_xact_lock(
        hashtext('laminea_code_group:' || p_group_id::TEXT)
    );
    PERFORM pg_advisory_xact_lock(
        hashtext('laminea_grp_prod:' || p_group_id::TEXT || ':' || p_product_id::TEXT)
    );

    IF NOT EXISTS (SELECT 1 FROM public.laminea_code_groups WHERE id = p_group_id) THEN
        RAISE EXCEPTION 'Code group not found.';
    END IF;

    -- Collect and validate non-blank codes (up to 5 slots)
    FOR v_raw_code IN
        SELECT value #>> '{}'
        FROM jsonb_array_elements(p_codes)
    LOOP
        v_display_code := UPPER(REGEXP_REPLACE(BTRIM(COALESCE(v_raw_code, '')), '\s+', ' ', 'g'));
        v_norm_code := public.normalize_alternative_code(v_display_code);

        IF v_norm_code IS NULL OR v_norm_code = '' THEN
            CONTINUE;
        END IF;

        IF v_norm_code = ANY(v_norm_codes) THEN
            RAISE EXCEPTION 'Duplicate base code "%" entered for this product.', v_display_code;
        END IF;

        v_display_codes := array_append(v_display_codes, v_display_code);
        v_norm_codes := array_append(v_norm_codes, v_norm_code);
    END LOOP;

    IF COALESCE(array_length(v_norm_codes, 1), 0) > 5 THEN
        RAISE EXCEPTION 'A product can have at most 5 base alternative codes within a group.';
    END IF;

    -- Lock existing mappings for this product or matching normalized codes in this group (ordered by id)
    PERFORM lpc.id
    FROM public.laminea_product_codes lpc
    WHERE lpc.group_id = p_group_id
      AND (
          lpc.product_id = p_product_id
          OR public.normalize_alternative_code(lpc.alternative_code) = ANY(v_norm_codes)
      )
    ORDER BY lpc.id
    FOR UPDATE OF lpc;

    -- Lock target product row
    PERFORM p.id
    FROM public.products p
    WHERE p.id = p_product_id
    FOR NO KEY UPDATE OF p;

    -- Check for conflicts with OTHER products in the same group while holding locks
    IF COALESCE(array_length(v_norm_codes, 1), 0) > 0 THEN
        FOR v_existing IN
            SELECT lpc.alternative_code, p.product_code, p.product_name
            FROM public.laminea_product_codes lpc
            LEFT JOIN public.products p ON p.id = lpc.product_id
            WHERE lpc.group_id = p_group_id
              AND lpc.product_id <> p_product_id
              AND public.normalize_alternative_code(lpc.alternative_code) = ANY(v_norm_codes)
        LOOP
            RAISE EXCEPTION 'Base code "%" is already assigned to product [%] % in this group.',
                v_existing.alternative_code,
                COALESCE(v_existing.product_code, '—'),
                COALESCE(v_existing.product_name, 'Unknown');
        END LOOP;
    END IF;

    -- 1. Disable active codes for this (group, product) that were removed from the slots
    WITH disabled_rows AS (
        UPDATE public.laminea_product_codes
        SET is_active = FALSE
        WHERE group_id = p_group_id
          AND product_id = p_product_id
          AND is_active = TRUE
          AND NOT (public.normalize_alternative_code(alternative_code) = ANY(v_norm_codes))
        RETURNING id
    )
    SELECT COUNT(*) INTO v_disabled FROM disabled_rows;

    -- 2. Insert or reactivate each configured slot
    IF COALESCE(array_length(v_norm_codes, 1), 0) > 0 THEN
        FOR v_idx IN 1..array_length(v_norm_codes, 1) LOOP
            v_display_code := v_display_codes[v_idx];
            v_norm_code := v_norm_codes[v_idx];

            SELECT *
            INTO v_existing
            FROM public.laminea_product_codes
            WHERE group_id = p_group_id
              AND public.normalize_alternative_code(alternative_code) = v_norm_code
            FOR UPDATE;

            IF FOUND THEN
                IF v_existing.product_id <> p_product_id THEN
                    RAISE EXCEPTION 'Base code "%" is already assigned to another product in this group.', v_display_code;
                END IF;

                IF v_existing.is_active = FALSE THEN
                    UPDATE public.laminea_product_codes
                    SET
                        is_active = TRUE,
                        alternative_code = v_display_code
                    WHERE id = v_existing.id
                      AND product_id = p_product_id;
                    v_reactivated := v_reactivated + 1;
                ELSIF v_existing.alternative_code IS DISTINCT FROM v_display_code THEN
                    UPDATE public.laminea_product_codes
                    SET alternative_code = v_display_code
                    WHERE id = v_existing.id
                      AND product_id = p_product_id;
                    v_updated := v_updated + 1;
                END IF;
            ELSE
                INSERT INTO public.laminea_product_codes (
                    group_id,
                    product_id,
                    alternative_code,
                    is_active
                )
                VALUES (
                    p_group_id,
                    p_product_id,
                    v_display_code,
                    TRUE
                );
                v_created := v_created + 1;
            END IF;
        END LOOP;
    END IF;

    RETURN jsonb_build_object(
        'success', TRUE,
        'created', v_created,
        'reactivated', v_reactivated,
        'updated', v_updated,
        'disabled', v_disabled
    );
END;
$$;

REVOKE ALL ON FUNCTION public.save_group_product_codes(UUID, UUID, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_group_product_codes(UUID, UUID, JSONB, TEXT) TO authenticated, service_role;


-- Replace global import RPC with multi-group / auto-group-creating atomic import
DROP FUNCTION IF EXISTS public.import_laminea_alternative_codes(JSONB, TEXT);
DROP FUNCTION IF EXISTS public.import_laminea_alternative_codes(JSONB, TEXT, UUID);
DROP FUNCTION IF EXISTS public.import_laminea_alternative_codes(JSONB, TEXT, UUID, UUID);

CREATE OR REPLACE FUNCTION public.import_laminea_alternative_codes(
    p_rows JSONB,
    p_mode TEXT,
    p_group_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    r JSONB;
    v_row_group_id UUID;
    v_raw_group_name TEXT;
    v_clean_group_name TEXT;
    v_norm_group_name TEXT;
    v_raw_group_id TEXT;
    v_group_active BOOLEAN;
    v_norm_code TEXT;
    v_new_code TEXT;
    v_prod_id UUID;
    v_prod_code TEXT;
    v_existing_id UUID;
    v_existing_prod_id UUID;
    v_existing_active BOOLEAN;
    v_created INT := 0;
    v_reactivated INT := 0;
    v_unchanged INT := 0;
    v_disabled INT := 0;
    v_groups_created INT := 0;
    v_seen_group_norm_codes TEXT[] := '{}';
    v_group_norm_key TEXT;
    v_normalized_rows JSONB := '[]'::JSONB;
    v_overlimit_prod RECORD;
    v_grp_id UUID;
BEGIN
    IF v_jwt_role <> 'service_role' AND public.is_admin() IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Unauthorized: admin access required to import alternative codes.';
    END IF;
    PERFORM public.cf20_take_mutation_lock();

    p_mode := UPPER(BTRIM(COALESCE(p_mode, '')));
    IF p_mode NOT IN ('MERGE', 'REPLACE') THEN
        RAISE EXCEPTION 'Invalid mode. Must be MERGE or REPLACE.';
    END IF;

    IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' THEN
        RAISE EXCEPTION 'Input must be a JSON array';
    END IF;

    IF p_mode = 'REPLACE' AND jsonb_array_length(p_rows) = 0 THEN
        RAISE EXCEPTION 'REPLACE mode cannot be used with an empty array (would disable all mappings in the group).';
    END IF;

    -- Validate format, resolve or create group per row (or fallback to p_group_id),
    -- resolve targetProductId (supporting both targetProductId and product_code),
    -- and extract all normalized codes
    FOR r IN SELECT * FROM jsonb_array_elements(p_rows) LOOP
        IF jsonb_typeof(r) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Each import row must be a JSON object.';
        END IF;

        v_new_code := UPPER(REGEXP_REPLACE(BTRIM(COALESCE(r->>'alternativeCode', r->>'alternative_code', '')), '\s+', ' ', 'g'));
        v_norm_code := public.normalize_alternative_code(v_new_code);

        IF v_norm_code IS NULL OR v_norm_code = '' THEN
            RAISE EXCEPTION 'Blank alternative code encountered in import.';
        END IF;

        IF LENGTH(v_new_code) > 30 THEN
            RAISE EXCEPTION 'Alternative code length exceeds 30 characters: %', v_new_code;
        END IF;

        -- Resolve group from row (group / groupName / group_name / groupId / group_id) or fallback p_group_id
        v_row_group_id := NULL;
        v_raw_group_name := BTRIM(COALESCE(r->>'group', r->>'groupName', r->>'group_name', ''));
        v_raw_group_id := BTRIM(COALESCE(r->>'groupId', r->>'group_id', ''));

        IF v_raw_group_name <> '' THEN
            v_clean_group_name := UPPER(REGEXP_REPLACE(v_raw_group_name, '\s+', ' ', 'g'));
            v_norm_group_name := public.normalize_alternative_code(v_clean_group_name);

            IF v_norm_group_name IS NULL OR v_norm_group_name = '' THEN
                RAISE EXCEPTION 'Invalid group name "%" for alternative code %', v_raw_group_name, v_new_code;
            END IF;

            IF LENGTH(v_clean_group_name) > 100 THEN
                RAISE EXCEPTION 'Group name cannot exceed 100 characters: %', v_clean_group_name;
            END IF;

            SELECT id, is_active
            INTO v_row_group_id, v_group_active
            FROM public.laminea_code_groups
            WHERE normalized_name = v_norm_group_name
            FOR UPDATE;

            IF NOT FOUND THEN
                INSERT INTO public.laminea_code_groups (name, is_active)
                VALUES (v_clean_group_name, TRUE)
                RETURNING id INTO v_row_group_id;
                v_groups_created := v_groups_created + 1;
            ELSIF v_group_active IS DISTINCT FROM TRUE THEN
                UPDATE public.laminea_code_groups
                SET is_active = TRUE,
                    updated_at = NOW()
                WHERE id = v_row_group_id;
            END IF;
        ELSIF v_raw_group_id <> '' THEN
            IF NOT (v_raw_group_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
                RAISE EXCEPTION 'Invalid group ID format for alternative code %', v_new_code;
            END IF;
            v_row_group_id := v_raw_group_id::UUID;
            IF NOT EXISTS (
                SELECT 1 FROM public.laminea_code_groups WHERE id = v_row_group_id AND is_active = TRUE
            ) THEN
                RAISE EXCEPTION 'Target code group does not exist or is inactive for code %.', v_new_code;
            END IF;
        ELSIF p_group_id IS NOT NULL THEN
            v_row_group_id := p_group_id;
            IF NOT EXISTS (
                SELECT 1 FROM public.laminea_code_groups WHERE id = v_row_group_id AND is_active = TRUE
            ) THEN
                RAISE EXCEPTION 'Target code group does not exist or is inactive.';
            END IF;
        ELSE
            RAISE EXCEPTION 'Group is required for alternative code %.', v_new_code;
        END IF;

        v_group_norm_key := v_row_group_id::TEXT || ':' || v_norm_code;
        IF v_group_norm_key = ANY(v_seen_group_norm_codes) THEN
            RAISE EXCEPTION 'Duplicate alternative code "%" in the same group within import file.', v_new_code;
        END IF;

        v_prod_id := NULL;
        IF COALESCE(r->>'targetProductId', '') <> '' THEN
            IF NOT (r->>'targetProductId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN
                RAISE EXCEPTION 'Invalid target product ID format for code %', v_new_code;
            END IF;
            v_prod_id := (r->>'targetProductId')::UUID;
        ELSIF COALESCE(r->>'product_code', r->>'productCode', '') <> '' THEN
            v_prod_code := public.normalize_alternative_code(COALESCE(r->>'product_code', r->>'productCode'));
            SELECT p.id
            INTO v_prod_id
            FROM public.products p
            WHERE p.product_code IS NOT NULL
              AND BTRIM(p.product_code) <> ''
              AND public.normalize_alternative_code(p.product_code) = v_prod_code
            LIMIT 1;

            IF v_prod_id IS NULL THEN
                RAISE EXCEPTION 'Product not found for product code "%" (alternative code %)', COALESCE(r->>'product_code', r->>'productCode'), v_new_code;
            END IF;
        ELSE
            RAISE EXCEPTION 'Missing target product for code %', v_new_code;
        END IF;

        v_seen_group_norm_codes := array_append(v_seen_group_norm_codes, v_group_norm_key);
        v_normalized_rows := v_normalized_rows || jsonb_build_array(
            jsonb_build_object(
                'groupId', v_row_group_id,
                'alternativeCode', v_new_code,
                'normCode', v_norm_code,
                'targetProductId', v_prod_id
            )
        );
    END LOOP;

    -- 1. Group-level advisory locks in deterministic order
    FOR v_grp_id IN
        SELECT DISTINCT (row_el.val->>'groupId')::UUID AS grp_id
        FROM jsonb_array_elements(v_normalized_rows) AS row_el(val)
        ORDER BY grp_id
    LOOP
        PERFORM pg_advisory_xact_lock(
            hashtext('laminea_code_group:' || v_grp_id::TEXT)
        );
    END LOOP;

    -- 2. Lock existing mappings in affected groups (ordered by id)
    PERFORM lpc.id
    FROM public.laminea_product_codes lpc
    WHERE lpc.group_id IN (
        SELECT DISTINCT (row_el.val->>'groupId')::UUID
        FROM jsonb_array_elements(v_normalized_rows) AS row_el(val)
    )
    ORDER BY lpc.id
    FOR UPDATE OF lpc;

    -- 3. Lock referenced products (ordered by id)
    PERFORM p.id
    FROM public.products p
    WHERE p.id IN (
        SELECT DISTINCT (row_el.val->>'targetProductId')::UUID
        FROM jsonb_array_elements(v_normalized_rows) AS row_el(val)
    )
    ORDER BY p.id
    FOR NO KEY UPDATE OF p;

    -- Validate that no incoming code conflicts with a different product in its target group
    FOR r IN SELECT * FROM jsonb_array_elements(v_normalized_rows) LOOP
        v_row_group_id := (r->>'groupId')::UUID;
        v_new_code := r->>'alternativeCode';
        v_norm_code := r->>'normCode';
        v_prod_id := (r->>'targetProductId')::UUID;

        SELECT id, product_id, is_active
        INTO v_existing_id, v_existing_prod_id, v_existing_active
        FROM public.laminea_product_codes
        WHERE group_id = v_row_group_id
          AND public.normalize_alternative_code(alternative_code) = v_norm_code;

        IF FOUND AND v_existing_prod_id <> v_prod_id THEN
            RAISE EXCEPTION 'Conflict: Code % is already assigned to another product in this group.', v_new_code;
        END IF;
    END LOOP;

    -- Validate combined active code count per (group, product) (<= 5 in BOTH MERGE and REPLACE modes)
    SELECT
        combined.group_id,
        g.name AS group_name,
        combined.product_id,
        p.product_code,
        p.product_name,
        COUNT(DISTINCT combined.norm_code) AS total_active_codes
    INTO v_overlimit_prod
    FROM (
        SELECT
            (row_el.val->>'groupId')::UUID AS group_id,
            (row_el.val->>'targetProductId')::UUID AS product_id,
            row_el.val->>'normCode' AS norm_code
        FROM jsonb_array_elements(v_normalized_rows) AS row_el(val)
        UNION
        SELECT
            lpc.group_id,
            lpc.product_id,
            public.normalize_alternative_code(lpc.alternative_code) AS norm_code
        FROM public.laminea_product_codes lpc
        WHERE p_mode = 'MERGE'
          AND lpc.is_active = TRUE
          AND (lpc.group_id, lpc.product_id) IN (
              SELECT DISTINCT
                  (r2.val->>'groupId')::UUID,
                  (r2.val->>'targetProductId')::UUID
              FROM jsonb_array_elements(v_normalized_rows) AS r2(val)
          )
    ) AS combined
    LEFT JOIN public.laminea_code_groups g ON g.id = combined.group_id
    LEFT JOIN public.products p ON p.id = combined.product_id
    GROUP BY combined.group_id, g.name, combined.product_id, p.product_code, p.product_name
    HAVING COUNT(DISTINCT combined.norm_code) > 5
    LIMIT 1;

    IF FOUND THEN
        RAISE EXCEPTION 'Import exceeds the maximum of 5 active alternative codes in group "%" for product [%] % (% codes).',
            COALESCE(v_overlimit_prod.group_name, '—'),
            COALESCE(v_overlimit_prod.product_code, '—'),
            COALESCE(v_overlimit_prod.product_name, 'Unknown'),
            v_overlimit_prod.total_active_codes;
    END IF;

    -- REPLACE mode logic (Disable first — scoped strictly to the groups included in the import)
    IF p_mode = 'REPLACE' THEN
        WITH to_disable AS (
            UPDATE public.laminea_product_codes lpc
            SET is_active = FALSE
            WHERE lpc.group_id IN (
                SELECT DISTINCT (row_el.val->>'groupId')::UUID
                FROM jsonb_array_elements(v_normalized_rows) AS row_el(val)
            )
              AND lpc.is_active = TRUE
              AND NOT (
                  (lpc.group_id::TEXT || ':' || public.normalize_alternative_code(lpc.alternative_code))
                  = ANY(v_seen_group_norm_codes)
              )
            RETURNING lpc.id
        )
        SELECT COUNT(*) INTO v_disabled FROM to_disable;
    END IF;

    -- Process each row within its resolved v_row_group_id
    FOR r IN SELECT * FROM jsonb_array_elements(v_normalized_rows) LOOP
        v_row_group_id := (r->>'groupId')::UUID;
        v_new_code := r->>'alternativeCode';
        v_norm_code := r->>'normCode';
        v_prod_id := (r->>'targetProductId')::UUID;

        SELECT id, product_id, is_active
        INTO v_existing_id, v_existing_prod_id, v_existing_active
        FROM public.laminea_product_codes
        WHERE group_id = v_row_group_id
          AND public.normalize_alternative_code(alternative_code) = v_norm_code
        FOR UPDATE;

        IF FOUND THEN
            IF v_existing_prod_id <> v_prod_id THEN
                RAISE EXCEPTION 'Conflict: Code % is already assigned to another product in this group.', v_new_code;
            END IF;

            IF v_existing_active THEN
                v_unchanged := v_unchanged + 1;
            ELSE
                UPDATE public.laminea_product_codes
                SET
                    is_active = TRUE,
                    alternative_code = v_new_code
                WHERE id = v_existing_id;
                v_reactivated := v_reactivated + 1;
            END IF;
        ELSE
            INSERT INTO public.laminea_product_codes (group_id, alternative_code, product_id, is_active)
            VALUES (v_row_group_id, v_new_code, v_prod_id, TRUE);
            v_created := v_created + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'created', v_created,
        'reactivated', v_reactivated,
        'unchanged', v_unchanged,
        'disabled', v_disabled,
        'groups_created', v_groups_created
    );
END;
$$;

REVOKE ALL ON FUNCTION public.import_laminea_alternative_codes(JSONB, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_laminea_alternative_codes(JSONB, TEXT, UUID) TO authenticated, service_role;

-- 4-argument overload supporting (rows, mode, actor_id, target_group_id)
CREATE OR REPLACE FUNCTION public.import_laminea_alternative_codes(
    rows JSONB,
    mode TEXT,
    actor_id UUID,
    target_group_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF COALESCE(auth.jwt()->>'role', '') = 'service_role' THEN
        -- Trusted backend must verify the acting administrator before invoking this.
        IF actor_id IS NULL OR NOT EXISTS (
            SELECT 1 FROM public.user_roles
            WHERE id = actor_id AND role = 'ADMIN' AND is_active IS TRUE
        ) THEN
            RAISE EXCEPTION 'Verified active admin actor is required for server import';
        END IF;
        PERFORM set_config('app.laminea_audit_actor', actor_id::TEXT, true);
    ELSE
        IF public.is_admin() IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'Admin access required';
        END IF;
        IF actor_id IS NOT NULL AND actor_id IS DISTINCT FROM auth.uid() THEN
            RAISE EXCEPTION 'Cannot attribute an import to another user';
        END IF;
        PERFORM set_config('app.laminea_audit_actor', auth.uid()::TEXT, true);
    END IF;

    RETURN public.import_laminea_alternative_codes(
        p_rows => rows,
        p_mode => mode,
        p_group_id => target_group_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.import_laminea_alternative_codes(JSONB, TEXT, UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.import_laminea_alternative_codes(JSONB, TEXT, UUID, UUID) TO authenticated, service_role;


-- =============================================================================
-- 6. CUSTOMER ACCOUNT SETTINGS ON code_finder_users
--    (Group reference + normalized unique customer prefix)
-- =============================================================================

ALTER TABLE public.code_finder_users
    ADD COLUMN IF NOT EXISTS code_group_id UUID
        REFERENCES public.laminea_code_groups(id)
        ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS customer_prefix TEXT;

ALTER TABLE public.code_finder_users
    ADD COLUMN IF NOT EXISTS normalized_prefix TEXT
    GENERATED ALWAYS AS (
        public.normalize_customer_prefix(customer_prefix)
    ) STORED;

ALTER TABLE public.code_finder_users
    DROP CONSTRAINT IF EXISTS code_finder_users_prefix_format_check;

ALTER TABLE public.code_finder_users
    ADD CONSTRAINT code_finder_users_prefix_format_check
    CHECK (
        normalized_prefix IS NULL
        OR normalized_prefix ~ '^[A-Z0-9]{1,10}$'
    );

CREATE UNIQUE INDEX IF NOT EXISTS code_finder_users_normalized_prefix_idx
    ON public.code_finder_users(normalized_prefix)
    WHERE normalized_prefix IS NOT NULL;

CREATE INDEX IF NOT EXISTS code_finder_users_code_group_id_idx
    ON public.code_finder_users(code_group_id);

CREATE OR REPLACE FUNCTION public.trg_validate_code_finder_user_settings()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
    v_group_active BOOLEAN;
    v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
BEGIN
    NEW.customer_prefix := public.normalize_customer_prefix(NEW.customer_prefix);

    IF NEW.customer_prefix IS NOT NULL
       AND NEW.customer_prefix !~ '^[A-Z0-9]{1,10}$' THEN
        RAISE EXCEPTION 'Customer prefix must be 1 to 10 alphanumeric characters (A-Z, 0-9).';
    END IF;

    -- Direct (non-service_role) inserts MUST provide both a code group and a customer prefix.
    -- Service-role inserts from an older deployed Edge Function may insert the base row first
    -- and immediately populate group + prefix via update_code_finder_customer_settings.
    IF TG_OP = 'INSERT' AND v_jwt_role <> 'service_role' THEN
        IF NEW.code_group_id IS NULL THEN
            RAISE EXCEPTION 'Alternative-code group is required when creating a Code Finder account.';
        END IF;
        IF NEW.customer_prefix IS NULL THEN
            RAISE EXCEPTION 'Customer prefix/initials is required when creating a Code Finder account.';
        END IF;
    END IF;

    -- Once assigned on an existing account, prevent clearing group or prefix to NULL
    IF TG_OP = 'UPDATE' THEN
        IF OLD.code_group_id IS NOT NULL AND NEW.code_group_id IS NULL THEN
            RAISE EXCEPTION 'Alternative-code group cannot be cleared once assigned.';
        END IF;
        IF OLD.customer_prefix IS NOT NULL AND NEW.customer_prefix IS NULL THEN
            RAISE EXCEPTION 'Customer prefix cannot be cleared once assigned.';
        END IF;
    END IF;

    -- Validate group is active whenever group is assigned or changed
    IF NEW.code_group_id IS NOT NULL
       AND (TG_OP = 'INSERT' OR NEW.code_group_id IS DISTINCT FROM OLD.code_group_id) THEN
        SELECT is_active
        INTO v_group_active
        FROM public.laminea_code_groups
        WHERE id = NEW.code_group_id;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Selected alternative-code group does not exist.';
        END IF;

        IF v_group_active IS DISTINCT FROM TRUE THEN
            RAISE EXCEPTION 'Cannot assign customer to an inactive alternative-code group.';
        END IF;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_code_finder_user_settings ON public.code_finder_users;
CREATE TRIGGER trg_validate_code_finder_user_settings
    BEFORE INSERT OR UPDATE ON public.code_finder_users
    FOR EACH ROW
    EXECUTE FUNCTION public.trg_validate_code_finder_user_settings();


-- Staff RPC to update Code Finder customer account settings (group, prefix, profile)
CREATE OR REPLACE FUNCTION public.update_code_finder_customer_settings(
    p_cf_user_id UUID,
    p_code_group_id UUID,
    p_customer_prefix TEXT,
    p_client_name TEXT DEFAULT NULL,
    p_contact_person TEXT DEFAULT NULL,
    p_mobile TEXT DEFAULT NULL,
    p_is_active BOOLEAN DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_clean_prefix TEXT;
    v_user public.code_finder_users%ROWTYPE;
    v_group_name TEXT;
BEGIN
    PERFORM public.cf8_require_staff();

    IF p_cf_user_id IS NULL THEN
        RAISE EXCEPTION 'Customer ID is required.';
    END IF;

    IF p_code_group_id IS NULL THEN
        RAISE EXCEPTION 'Alternative-code group is required.';
    END IF;

    v_clean_prefix := public.normalize_customer_prefix(p_customer_prefix);
    IF v_clean_prefix IS NULL OR v_clean_prefix !~ '^[A-Z0-9]{1,10}$' THEN
        RAISE EXCEPTION 'Customer prefix must be 1 to 10 alphanumeric characters (e.g. NJ).';
    END IF;

    SELECT name
    INTO v_group_name
    FROM public.laminea_code_groups
    WHERE id = p_code_group_id
      AND is_active = TRUE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Selected alternative-code group does not exist or is inactive.';
    END IF;

    SELECT *
    INTO v_user
    FROM public.code_finder_users
    WHERE id = p_cf_user_id OR auth_user_id = p_cf_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Code Finder customer not found.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.code_finder_users
        WHERE normalized_prefix = v_clean_prefix
          AND id <> v_user.id
    ) THEN
        RAISE EXCEPTION 'Customer prefix "%" is already assigned to another customer account.', v_clean_prefix;
    END IF;

    UPDATE public.code_finder_users
    SET
        code_group_id = p_code_group_id,
        customer_prefix = v_clean_prefix,
        client_name = COALESCE(NULLIF(BTRIM(p_client_name), ''), client_name),
        contact_person = CASE
            WHEN p_contact_person IS NULL THEN contact_person
            ELSE NULLIF(BTRIM(p_contact_person), '')
        END,
        mobile = CASE
            WHEN p_mobile IS NULL THEN mobile
            ELSE NULLIF(BTRIM(p_mobile), '')
        END,
        is_active = COALESCE(p_is_active, is_active),
        updated_at = NOW()
    WHERE id = v_user.id
    RETURNING * INTO v_user;

    RETURN jsonb_build_object(
        'id', v_user.id,
        'username', v_user.username,
        'client_name', v_user.client_name,
        'contact_person', v_user.contact_person,
        'mobile', v_user.mobile,
        'is_active', v_user.is_active,
        'laminea_client_id', v_user.laminea_client_id,
        'code_group_id', v_user.code_group_id,
        'code_group_name', v_group_name,
        'customer_prefix', v_user.customer_prefix
    );
END;
$$;

REVOKE ALL ON FUNCTION public.update_code_finder_customer_settings(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.update_code_finder_customer_settings(UUID, UUID, TEXT, TEXT, TEXT, TEXT, BOOLEAN) TO authenticated, service_role;


-- Ensure link_code_finder_client and create_and_link_laminea_client are callable by
-- both authenticated staff and service_role (Edge Function), without overload ambiguity.
REVOKE ALL ON FUNCTION public.link_code_finder_client(UUID, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_code_finder_client(UUID, UUID) TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.create_and_link_laminea_client(UUID, TEXT, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.create_and_link_laminea_client(
    p_cf_user_id UUID,
    p_client_name TEXT,
    p_mobile TEXT DEFAULT NULL,
    p_contact_person TEXT DEFAULT NULL,
    p_opening_balance NUMERIC DEFAULT 0,
    p_maintain_ledger BOOLEAN DEFAULT TRUE
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
        COALESCE(p_opening_balance, 0),
        COALESCE(p_maintain_ledger, TRUE)
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

REVOKE ALL ON FUNCTION public.create_and_link_laminea_client(UUID, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_and_link_laminea_client(UUID, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN) TO authenticated, service_role;


-- Ensure ledger-aware client link RPC aliases called by CustomerAccountManager exist
-- Preserves existing client opening_balance unless p_opening_balance is explicitly supplied.
CREATE OR REPLACE FUNCTION public.link_code_finder_client_with_ledger(
    p_cf_user_id UUID,
    p_client_id UUID,
    p_opening_balance NUMERIC DEFAULT NULL,
    p_maintain_ledger BOOLEAN DEFAULT NULL
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

    IF p_opening_balance IS NOT NULL
       AND p_opening_balance IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC) THEN
        RAISE EXCEPTION 'Invalid opening balance.';
    END IF;

    v_client := public.link_code_finder_client(p_cf_user_id, p_client_id);

    UPDATE public.clients
    SET
        maintain_ledger = COALESCE(p_maintain_ledger, maintain_ledger),
        opening_balance = CASE
            WHEN p_opening_balance IS NOT NULL THEN p_opening_balance
            ELSE COALESCE(opening_balance, 0)
        END
    WHERE id = p_client_id
      AND platform = 'laminea';

    SELECT to_jsonb(c) INTO v_client FROM public.clients c WHERE c.id = p_client_id;
    RETURN v_client;
END;
$$;

REVOKE ALL ON FUNCTION public.link_code_finder_client_with_ledger(UUID, UUID, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.link_code_finder_client_with_ledger(UUID, UUID, NUMERIC, BOOLEAN) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.create_and_link_laminea_client_with_ledger(
    p_cf_user_id UUID,
    p_client_name TEXT,
    p_mobile TEXT DEFAULT NULL,
    p_contact_person TEXT DEFAULT NULL,
    p_opening_balance NUMERIC DEFAULT 0,
    p_maintain_ledger BOOLEAN DEFAULT TRUE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_opening_balance IS NOT NULL
       AND p_opening_balance IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC) THEN
        RAISE EXCEPTION 'Invalid opening balance.';
    END IF;

    RETURN public.create_and_link_laminea_client(
        p_cf_user_id,
        p_client_name,
        p_mobile,
        p_contact_person,
        COALESCE(p_opening_balance, 0),
        COALESCE(p_maintain_ledger, TRUE)
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_and_link_laminea_client_with_ledger(UUID, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_and_link_laminea_client_with_ledger(UUID, TEXT, TEXT, TEXT, NUMERIC, BOOLEAN) TO authenticated, service_role;


-- =============================================================================
-- 7. STRICT GROUP-SCOPED STOCK AVAILABILITY LOOKUP
--    (Drops legacy global lookup signatures; preserves exact status rules)
-- =============================================================================

DROP FUNCTION IF EXISTS public.search_laminea_availability_codes(TEXT[]);
DROP FUNCTION IF EXISTS public.check_laminea_stock_availability(JSONB);

CREATE OR REPLACE FUNCTION public.check_laminea_stock_availability(
    p_requests JSONB,
    p_cf_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_auth_uid UUID := auth.uid();
    v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    v_resolved_user_id UUID;
    v_group_id UUID;
    v_prefix TEXT;
    v_group_active BOOLEAN := FALSE;
    v_request_count INTEGER;
    v_result JSONB;
BEGIN
    ---------------------------------------------------------------------------
    -- 1. Explicit customer identity resolution
    --    - User-token calls derive the customer from auth.uid().
    --    - Service-role calls require p_cf_user_id after server authentication.
    --    - Never fall back to current_user inside SECURITY DEFINER.
    ---------------------------------------------------------------------------
    IF v_auth_uid IS NOT NULL THEN
        SELECT id, code_group_id, normalized_prefix
        INTO v_resolved_user_id, v_group_id, v_prefix
        FROM public.code_finder_users
        WHERE auth_user_id = v_auth_uid
          AND is_active IS TRUE
          AND must_change_password IS FALSE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Unauthorized or inactive Code Finder account';
        END IF;

        IF p_cf_user_id IS NOT NULL AND p_cf_user_id <> v_resolved_user_id THEN
            RAISE EXCEPTION 'Cannot override authenticated customer identity';
        END IF;
    ELSIF v_jwt_role = 'service_role' THEN
        IF p_cf_user_id IS NULL THEN
            RAISE EXCEPTION 'Customer ID is required for server availability checks';
        END IF;

        SELECT id, code_group_id, normalized_prefix
        INTO v_resolved_user_id, v_group_id, v_prefix
        FROM public.code_finder_users
        WHERE id = p_cf_user_id
          AND is_active IS TRUE
          AND must_change_password IS FALSE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Unauthorized or inactive Code Finder account';
        END IF;
    ELSE
        RAISE EXCEPTION 'Authentication required';
    END IF;

    IF v_group_id IS NOT NULL AND v_prefix IS NOT NULL THEN
        SELECT is_active
        INTO v_group_active
        FROM public.laminea_code_groups
        WHERE id = v_group_id;
    END IF;

    ---------------------------------------------------------------------------
    -- 2. Validate request structure
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
    -- 3. Normalize, aggregate, resolve strictly within v_group_id, and
    --    compute availability using existing status rules:
    --    AVAILABLE, PLEASE CONFIRM WITH US, CODE NOT FOUND, INVALID QUANTITY
    ---------------------------------------------------------------------------
    WITH input_rows AS (
        SELECT
            request.ordinality::INTEGER AS input_order,
            NULLIF(BTRIM(request.value ->> 'code'), '') AS display_code,
            public.normalize_alternative_code(request.value ->> 'code') AS normalized_code,
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
                    UPPER(REGEXP_REPLACE(display_code, '\s+', ' ', 'g'))
                    ORDER BY input_order
                )
            )[1] AS display_code,
            MIN(input_order) AS first_input_order,
            BOOL_OR(
                requested_quantity IS NULL
                OR requested_quantity <= 0
                OR requested_quantity IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
            ) AS has_invalid_quantity,
            SUM(requested_quantity) FILTER (
                WHERE requested_quantity IS NOT NULL
                  AND requested_quantity > 0
                  AND requested_quantity NOT IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
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
            mapping.alternative_code AS canonical_base_code,
            product.id AS product_id,
            product.has_stock,
            product.stock
        FROM aggregated
        LEFT JOIN public.laminea_product_codes AS mapping
          ON v_group_id IS NOT NULL
         AND v_prefix IS NOT NULL
         AND v_group_active IS TRUE
         AND mapping.group_id = v_group_id
         AND mapping.is_active IS TRUE
         AND public.normalize_alternative_code(mapping.alternative_code) = aggregated.normalized_code
        LEFT JOIN public.products AS product
          ON product.id = mapping.product_id
         AND product.in_laminea IS TRUE
    )

    SELECT COALESCE(
        JSONB_AGG(
            CASE
                WHEN has_invalid_quantity THEN
                    JSONB_BUILD_OBJECT(
                        'code',
                        COALESCE(canonical_base_code, display_code, normalized_code),
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
                        COALESCE(canonical_base_code, display_code, normalized_code),
                        'requestedQuantity',
                        total_quantity,
                        'status',
                        CASE
                            WHEN has_stock IS TRUE
                             AND total_quantity > 0 AND total_quantity <= 10
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

REVOKE ALL ON FUNCTION public.check_laminea_stock_availability(JSONB, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.check_laminea_stock_availability(JSONB, UUID) TO authenticated, service_role;


-- =============================================================================
-- 8. HISTORICAL SNAPSHOTS ON ENQUIRIES, ENQUIRY ITEMS & ESTIMATE ITEMS
-- =============================================================================

ALTER TABLE public.code_finder_enquiries
    ADD COLUMN IF NOT EXISTS code_group_id_snapshot UUID
        REFERENCES public.laminea_code_groups(id)
        ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS code_group_name_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS customer_prefix_snapshot TEXT;

ALTER TABLE public.code_finder_enquiry_items
    ADD COLUMN IF NOT EXISTS mapping_id_snapshot UUID
        REFERENCES public.laminea_product_codes(id)
        ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS code_group_id_snapshot UUID
        REFERENCES public.laminea_code_groups(id)
        ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS customer_prefix_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS prefixed_code_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS live_stock_snapshot NUMERIC(12,2);

ALTER TABLE public.estimate_items
    ADD COLUMN IF NOT EXISTS mapping_id_snapshot UUID
        REFERENCES public.laminea_product_codes(id)
        ON DELETE SET NULL,
    ADD COLUMN IF NOT EXISTS code_group_id_snapshot UUID
        REFERENCES public.laminea_code_groups(id)
        ON DELETE RESTRICT,
    ADD COLUMN IF NOT EXISTS base_alternative_code_snapshot TEXT,
    ADD COLUMN IF NOT EXISTS customer_prefix_snapshot TEXT;

-- Link client_purchases directly to estimates(id) so monthly bill_number resets
-- or cross-month edits/deletes never affect another month's purchase records.
ALTER TABLE public.client_purchases
    ADD COLUMN IF NOT EXISTS estimate_id UUID
        REFERENCES public.estimates(id)
        ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS client_purchases_estimate_id_idx
    ON public.client_purchases(estimate_id);

-- Idempotent backfill for pre-migration enquiries, items, and client_purchases ONLY.
-- Re-running this migration will never alter snapshots created after deployment.
DO $$
DECLARE
    v_legacy_group_id UUID;
    v_legacy_group_name TEXT;
BEGIN
    SELECT id, name
    INTO v_legacy_group_id, v_legacy_group_name
    FROM public.laminea_code_groups
    WHERE normalized_name = 'LEGACYDEFAULTGROUP'
    ORDER BY created_at ASC
    LIMIT 1;

    IF v_legacy_group_id IS NOT NULL THEN
        -- Backfill legacy enquiry headers that predate group snapshots
        UPDATE public.code_finder_enquiries ce
        SET
            code_group_id_snapshot = v_legacy_group_id,
            code_group_name_snapshot = v_legacy_group_name
        WHERE ce.code_group_id_snapshot IS NULL
          AND ce.code_group_name_snapshot IS NULL
          AND ce.customer_prefix_snapshot IS NULL;

        -- Backfill legacy enquiry items that predate group/prefix snapshots
        UPDATE public.code_finder_enquiry_items cei
        SET
            code_group_id_snapshot = COALESCE(ce.code_group_id_snapshot, v_legacy_group_id),
            prefixed_code_snapshot = cei.alternative_code_snapshot,
            mapping_id_snapshot = COALESCE(
                cei.mapping_id_snapshot,
                (
                    SELECT lpc.id
                    FROM public.laminea_product_codes lpc
                    WHERE lpc.group_id = COALESCE(ce.code_group_id_snapshot, v_legacy_group_id)
                      AND public.normalize_alternative_code(lpc.alternative_code)
                          = public.normalize_alternative_code(cei.alternative_code_snapshot)
                    LIMIT 1
                )
            )
        FROM public.code_finder_enquiries ce
        WHERE ce.id = cei.enquiry_id
          AND cei.code_group_id_snapshot IS NULL
          AND cei.prefixed_code_snapshot IS NULL;
    END IF;

    -- Backfill base_alternative_code_snapshot on legacy estimate_items where missing
    UPDATE public.estimate_items
    SET base_alternative_code_snapshot = alternative_code_snapshot
    WHERE alternative_code_snapshot IS NOT NULL
      AND base_alternative_code_snapshot IS NULL;

    -- Backfill estimate_id on existing client_purchases where platform + bill_number + bill_date + client_id
    -- (or unambiguous platform + bill_number) identifies a single estimate.
    UPDATE public.client_purchases cp
    SET estimate_id = matched.id
    FROM (
        SELECT
            cp_inner.id AS purchase_id,
            (ARRAY_AGG(e.id ORDER BY e.created_at DESC))[1] AS id,
            COUNT(*) AS match_count
        FROM public.client_purchases cp_inner
        JOIN public.estimates e
          ON e.platform = cp_inner.platform
         AND e.bill_number::TEXT = cp_inner.bill_number
         AND (cp_inner.bill_date IS NULL OR e.bill_date = cp_inner.bill_date)
         AND (cp_inner.client_id IS NULL OR e.client_id IS NULL OR e.client_id = cp_inner.client_id)
        WHERE cp_inner.estimate_id IS NULL
        GROUP BY cp_inner.id
    ) AS matched
    WHERE cp.id = matched.purchase_id
      AND matched.match_count = 1;
END;
$$;


-- Update BEFORE INSERT trigger on code_finder_enquiry_items to resolve snapshots
-- strictly from the parent enquiry's snapshotted group and prefix.
-- Item-level columns never override the parent enquiry.
CREATE OR REPLACE FUNCTION public.cf8_capture_mapping()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_enquiry_group_id UUID;
    v_enquiry_prefix TEXT;
    v_canonical_base_code TEXT;
    v_prod_has_stock BOOLEAN;
    v_prod_stock NUMERIC(12,2);
BEGIN
    SELECT code_group_id_snapshot, customer_prefix_snapshot
    INTO v_enquiry_group_id, v_enquiry_prefix
    FROM public.code_finder_enquiries
    WHERE id = NEW.enquiry_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Parent enquiry not found for enquiry item.';
    END IF;

    -- Unconditionally inherit group and prefix from the parent enquiry
    NEW.code_group_id_snapshot := v_enquiry_group_id;
    NEW.customer_prefix_snapshot := v_enquiry_prefix;

    -- Normalize base code formatting
    NEW.alternative_code_snapshot := UPPER(
        REGEXP_REPLACE(BTRIM(COALESCE(NEW.alternative_code_snapshot, '')), '\s+', ' ', 'g')
    );

    NEW.mapping_id_snapshot := NULL;
    NEW.product_id_snapshot := NULL;
    NEW.product_code_snapshot := NULL;
    NEW.mapping_revision_at := NULL;
    NEW.live_stock_snapshot := NULL;

    IF NEW.code_group_id_snapshot IS NOT NULL THEN
        SELECT
            m.id,
            m.alternative_code,
            p.id,
            p.product_code,
            m.updated_at,
            p.has_stock,
            p.stock
        INTO
            NEW.mapping_id_snapshot,
            v_canonical_base_code,
            NEW.product_id_snapshot,
            NEW.product_code_snapshot,
            NEW.mapping_revision_at,
            v_prod_has_stock,
            v_prod_stock
        FROM public.laminea_product_codes m
        JOIN public.products p ON p.id = m.product_id
        WHERE m.group_id = NEW.code_group_id_snapshot
          AND public.normalize_alternative_code(m.alternative_code)
              = public.normalize_alternative_code(NEW.alternative_code_snapshot)
          AND m.is_active IS TRUE
          AND p.in_laminea IS TRUE
        LIMIT 1;

        IF v_canonical_base_code IS NOT NULL THEN
            NEW.alternative_code_snapshot := v_canonical_base_code;
        END IF;

        IF NEW.product_id_snapshot IS NOT NULL AND v_prod_has_stock IS TRUE THEN
            NEW.live_stock_snapshot := COALESCE(v_prod_stock, 0);
        END IF;
    END IF;

    -- Compute the immutable staff-visible prefixed code snapshot (e.g. NJ01SMT)
    IF NEW.customer_prefix_snapshot IS NOT NULL AND BTRIM(NEW.customer_prefix_snapshot) <> '' THEN
        NEW.prefixed_code_snapshot :=
            public.normalize_customer_prefix(NEW.customer_prefix_snapshot)
            || public.normalize_alternative_code(NEW.alternative_code_snapshot);
    ELSE
        NEW.prefixed_code_snapshot := NEW.alternative_code_snapshot;
    END IF;

    RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.cf8_capture_mapping() FROM PUBLIC, anon, authenticated;

DO $cf20$
DECLARE t record;
BEGIN
    FOR t IN SELECT tgname FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public.code_finder_enquiry_items'::regclass
          AND tgfoid = 'public.cf8_capture_mapping()'::regprocedure
          AND NOT tgisinternal
    LOOP
        EXECUTE format('DROP TRIGGER %I ON public.code_finder_enquiry_items', t.tgname);
    END LOOP;
END;
$cf20$;
CREATE TRIGGER cf8_capture_mapping BEFORE INSERT ON public.code_finder_enquiry_items
FOR EACH ROW EXECUTE FUNCTION public.cf8_capture_mapping();



-- =============================================================================
-- 9. ATOMIC ENQUIRY CREATION WITH SERVER-RESOLVED GROUP & PREFIX SNAPSHOTS
-- =============================================================================

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
    v_auth_uid UUID := auth.uid();
    v_jwt_role TEXT := COALESCE(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '');
    v_cf_user RECORD;
    v_group RECORD;
    v_enquiry_id UUID;
    v_enquiry_number BIGINT;
    v_existing RECORD;
    v_existing_items_sig JSONB;
    v_incoming_items_sig JSONB;
    v_item JSONB;
    v_code TEXT;
    v_quantity NUMERIC(12,2);
    v_checked_at TIMESTAMPTZ;
    v_idempotency_key TEXT;
    v_request JSONB;
BEGIN
    PERFORM public.cf20_take_mutation_lock();
    ---------------------------------------------------------------------------
    -- 1. Validate caller & resolve customer's trusted group and prefix
    --    - Never fall back to current_user inside SECURITY DEFINER.
    ---------------------------------------------------------------------------
    IF v_auth_uid IS NOT NULL THEN
        SELECT id, code_group_id, normalized_prefix
        INTO v_cf_user
        FROM public.code_finder_users
        WHERE auth_user_id = v_auth_uid
          AND is_active = TRUE
          AND must_change_password = FALSE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Code Finder user is inactive or does not exist.';
        END IF;

        IF p_user_id IS NOT NULL AND p_user_id <> v_cf_user.id THEN
            RAISE EXCEPTION 'Cannot override authenticated customer identity.';
        END IF;
    ELSIF v_jwt_role = 'service_role' THEN
        IF p_user_id IS NULL THEN
            RAISE EXCEPTION 'Code Finder user ID is required.';
        END IF;

        SELECT id, code_group_id, normalized_prefix
        INTO v_cf_user
        FROM public.code_finder_users
        WHERE id = p_user_id
          AND is_active = TRUE
          AND must_change_password = FALSE;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Code Finder user is inactive or does not exist.';
        END IF;
    ELSE
        RAISE EXCEPTION 'Authentication required.';
    END IF;

    ---------------------------------------------------------------------------
    -- 2. Validate idempotency key & enquiry metadata
    ---------------------------------------------------------------------------
    v_idempotency_key := NULLIF(BTRIM(p_idempotency_key), '');

    IF v_idempotency_key IS NULL THEN
        RAISE EXCEPTION 'Idempotency key is required.';
    END IF;

    IF LENGTH(v_idempotency_key) NOT BETWEEN 8 AND 100 THEN
        RAISE EXCEPTION 'Idempotency key must contain between 8 and 100 characters.';
    END IF;

    IF p_client_note IS NOT NULL AND LENGTH(p_client_note) > 2000 THEN
        RAISE EXCEPTION 'Client note cannot exceed 2000 characters.';
    END IF;

    IF p_ordered_by IS NOT NULL AND LENGTH(BTRIM(p_ordered_by)) > 100 THEN
        RAISE EXCEPTION 'Ordered by cannot exceed 100 characters.';
    END IF;

    IF p_items IS NULL OR jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
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
    -- 3. Validate every item
    ---------------------------------------------------------------------------
    FOR v_item IN
        SELECT value
        FROM jsonb_array_elements(p_items)
    LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Every enquiry item must be a JSON object.';
        END IF;

        v_code := NULLIF(
            BTRIM(COALESCE(v_item ->> 'alternative_code_snapshot', v_item ->> 'code')),
            ''
        );

        IF v_code IS NULL OR public.normalize_alternative_code(v_code) = '' THEN
            RAISE EXCEPTION 'Alternative code is required for every item.';
        END IF;

        IF LENGTH(v_code) > 100 THEN
            RAISE EXCEPTION 'Alternative code cannot exceed 100 characters.';
        END IF;

        BEGIN
            v_quantity := (COALESCE(v_item ->> 'requested_quantity', v_item ->> 'quantity'))::NUMERIC(12,2);
        EXCEPTION
            WHEN invalid_text_representation OR numeric_value_out_of_range THEN
                RAISE EXCEPTION 'Invalid requested quantity for alternative code %.', v_code;
        END;

        IF v_quantity IS NULL
           OR v_quantity IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
           OR v_quantity <= 0 THEN
            RAISE EXCEPTION 'Requested quantity must be greater than zero for alternative code %.', v_code;
        END IF;
    END LOOP;

    -- Prevent duplicate normalized codes inside the same enquiry payload
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS item(value)
        GROUP BY public.normalize_alternative_code(
            COALESCE(item.value ->> 'alternative_code_snapshot', item.value ->> 'code')
        )
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate alternative codes were found in the enquiry.';
    END IF;

    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'code', public.normalize_alternative_code(COALESCE(x.value->>'alternative_code_snapshot', x.value->>'code')),
        'qty', (COALESCE(x.value->>'requested_quantity', x.value->>'quantity'))::numeric(12,2)
    ) ORDER BY public.normalize_alternative_code(COALESCE(x.value->>'alternative_code_snapshot', x.value->>'code'))), '[]'::jsonb)
    INTO v_incoming_items_sig FROM jsonb_array_elements(p_items) AS x(value);
    v_request := jsonb_build_object('items', v_incoming_items_sig,
        'client_note', NULLIF(BTRIM(p_client_note), ''), 'ordered_by', NULLIF(BTRIM(p_ordered_by), ''));

    SELECT id, enquiry_number, client_note, ordered_by, cf20_request_payload
    INTO v_existing FROM public.code_finder_enquiries
    WHERE code_finder_user_id = v_cf_user.id AND idempotency_key = v_idempotency_key;
    IF FOUND THEN
        IF v_existing.cf20_request_payload IS NOT NULL THEN
            IF v_existing.cf20_request_payload IS DISTINCT FROM v_request THEN
                RAISE EXCEPTION 'Idempotency key has already been used with a different enquiry payload.';
            END IF;
        ELSE
            -- Legacy requests have no stored intent: compare original item quantities/codes.
            SELECT COALESCE(jsonb_agg(jsonb_build_object(
                'code', public.normalize_alternative_code(cei.alternative_code_snapshot),
                'qty', cei.requested_quantity::numeric(12,2)
            ) ORDER BY public.normalize_alternative_code(cei.alternative_code_snapshot)), '[]'::jsonb)
            INTO v_existing_items_sig FROM public.code_finder_enquiry_items cei WHERE cei.enquiry_id = v_existing.id;
            IF v_existing_items_sig IS DISTINCT FROM v_incoming_items_sig
               OR v_existing.client_note IS DISTINCT FROM NULLIF(BTRIM(p_client_note), '')
               OR v_existing.ordered_by IS DISTINCT FROM NULLIF(BTRIM(p_ordered_by), '') THEN
                RAISE EXCEPTION 'Idempotency key has already been used with a different enquiry payload.';
            END IF;
        END IF;
        RETURN jsonb_build_object('success',true,'enquiry_id',v_existing.id,
            'enquiry_number',v_existing.enquiry_number,'duplicate',true);
    END IF;

    IF v_cf_user.code_group_id IS NULL OR v_cf_user.normalized_prefix IS NULL THEN
        RAISE EXCEPTION 'Customer account is not assigned an alternative-code group and prefix.';
    END IF;

    SELECT id, name, is_active
    INTO v_group
    FROM public.laminea_code_groups
    WHERE id = v_cf_user.code_group_id;

    IF NOT FOUND OR v_group.is_active IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Assigned alternative-code group is unavailable or inactive.';
    END IF;

    ---------------------------------------------------------------------------
    -- 4. Insert enquiry header with server-resolved group & prefix snapshots
    ---------------------------------------------------------------------------
    INSERT INTO public.code_finder_enquiries (
        code_finder_user_id,
        status,
        client_note,
        checked_at,
        idempotency_key,
        ordered_by,
        code_group_id_snapshot,
        code_group_name_snapshot,
        customer_prefix_snapshot,
        cf20_request_payload
    )
    VALUES (
        v_cf_user.id,
        'NEW',
        NULLIF(BTRIM(p_client_note), ''),
        v_checked_at,
        v_idempotency_key,
        NULLIF(BTRIM(p_ordered_by), ''),
        v_group.id,
        v_group.name,
        v_cf_user.normalized_prefix,
        v_request
    )
    ON CONFLICT (code_finder_user_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL
    DO NOTHING
    RETURNING id, enquiry_number
    INTO v_enquiry_id, v_enquiry_number;

    IF v_enquiry_id IS NULL THEN
        SELECT id, enquiry_number, client_note, ordered_by
        INTO v_existing
        FROM public.code_finder_enquiries
        WHERE code_finder_user_id = v_cf_user.id
          AND idempotency_key = v_idempotency_key;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Unable to resolve the existing idempotent enquiry.';
        END IF;

        -- Verify that the existing enquiry payload matches the incoming request
        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'code', public.normalize_alternative_code(cei.alternative_code_snapshot),
                    'qty', cei.requested_quantity::NUMERIC(12,2)
                )
                ORDER BY public.normalize_alternative_code(cei.alternative_code_snapshot)
            ),
            '[]'::JSONB
        )
        INTO v_existing_items_sig
        FROM public.code_finder_enquiry_items cei
        WHERE cei.enquiry_id = v_existing.id;

        SELECT COALESCE(
            jsonb_agg(
                jsonb_build_object(
                    'code', public.normalize_alternative_code(COALESCE(item.value ->> 'alternative_code_snapshot', item.value ->> 'code')),
                    'qty', (COALESCE(item.value ->> 'requested_quantity', item.value ->> 'quantity'))::NUMERIC(12,2)
                )
                ORDER BY public.normalize_alternative_code(COALESCE(item.value ->> 'alternative_code_snapshot', item.value ->> 'code'))
            ),
            '[]'::JSONB
        )
        INTO v_incoming_items_sig
        FROM jsonb_array_elements(p_items) AS item(value);

        IF v_existing.client_note IS DISTINCT FROM NULLIF(BTRIM(p_client_note), '')
           OR v_existing.ordered_by IS DISTINCT FROM NULLIF(BTRIM(p_ordered_by), '')
           OR v_existing_items_sig IS DISTINCT FROM v_incoming_items_sig THEN
            RAISE EXCEPTION 'Idempotency key has already been used with a different enquiry payload.';
        END IF;

        RETURN jsonb_build_object(
            'success', TRUE,
            'enquiry_id', v_existing.id,
            'enquiry_number', v_existing.enquiry_number,
            'duplicate', TRUE
        );
    END IF;

    ---------------------------------------------------------------------------
    -- 5. Insert enquiry items, computing availability strictly against
    --    the customer's assigned group on the server (never trusting client status)
    ---------------------------------------------------------------------------
    INSERT INTO public.code_finder_enquiry_items (
        enquiry_id,
        alternative_code_snapshot,
        requested_quantity,
        availability_status,
        live_stock_snapshot,
        checked_at,
        code_group_id_snapshot,
        customer_prefix_snapshot
    )
    SELECT
        v_enquiry_id,
        COALESCE(
            mapping.alternative_code,
            UPPER(REGEXP_REPLACE(BTRIM(COALESCE(item.value ->> 'alternative_code_snapshot', item.value ->> 'code')), '\s+', ' ', 'g'))
        ),
        req.qty,
        CASE
            WHEN mapping.id IS NULL OR product.id IS NULL THEN 'CODE_NOT_FOUND'
            WHEN product.has_stock IS DISTINCT FROM TRUE THEN 'PLEASE_CONFIRM'
            WHEN req.qty > 10 THEN 'PLEASE_CONFIRM'
            WHEN COALESCE(product.stock, 0) >= req.qty THEN 'AVAILABLE'
            ELSE 'PLEASE_CONFIRM'
        END,
        CASE
            WHEN mapping.id IS NOT NULL AND product.id IS NOT NULL AND product.has_stock IS TRUE
                THEN COALESCE(product.stock, 0)
            ELSE NULL
        END,
        v_checked_at,
        v_group.id,
        v_cf_user.normalized_prefix
    FROM jsonb_array_elements(p_items) WITH ORDINALITY AS item(value, ord)
    CROSS JOIN LATERAL (
        SELECT
            (COALESCE(item.value ->> 'requested_quantity', item.value ->> 'quantity'))::NUMERIC(12,2) AS qty,
            public.normalize_alternative_code(
                COALESCE(item.value ->> 'alternative_code_snapshot', item.value ->> 'code')
            ) AS norm_code
    ) AS req
    LEFT JOIN public.laminea_product_codes AS mapping
      ON mapping.group_id = v_group.id
     AND mapping.is_active IS TRUE
     AND public.normalize_alternative_code(mapping.alternative_code) = req.norm_code
    LEFT JOIN public.products AS product
      ON product.id = mapping.product_id
     AND product.in_laminea IS TRUE
    ORDER BY item.ord;

    RETURN jsonb_build_object(
        'success', TRUE,
        'enquiry_id', v_enquiry_id,
        'enquiry_number', v_enquiry_number,
        'duplicate', FALSE
    );
END;
$$;

REVOKE ALL ON FUNCTION public.create_code_finder_enquiry(UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_code_finder_enquiry(UUID, JSONB, TEXT, TIMESTAMPTZ, TEXT, TEXT) TO service_role;


-- =============================================================================
-- 10. HISTORICAL-GROUP-AWARE recheck_enquiry_stock & resolve_enquiry_items
--     (Always uses the enquiry's snapshotted group & prefix, never current user settings)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.recheck_enquiry_stock(
    p_enquiry_id UUID
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_enquiry_group_id UUID;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT code_group_id_snapshot
    INTO v_enquiry_group_id
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    WITH resolved AS (
        SELECT
            cei.id AS enquiry_item_id,
            lpc.product_id,
            lpc.is_active,
            grp.is_active AS group_is_active,
            p.id AS eligible_product_id,
            p.has_stock,
            p.stock,
            COALESCE(
                accepted_item.proposed_quantity,
                cei.requested_quantity
            ) AS effective_quantity
        FROM public.code_finder_enquiry_items cei
        LEFT JOIN public.laminea_code_groups grp
          ON grp.id = COALESCE(cei.code_group_id_snapshot, v_enquiry_group_id)
        LEFT JOIN public.laminea_product_codes lpc
          ON lpc.group_id = COALESCE(cei.code_group_id_snapshot, v_enquiry_group_id)
         AND public.normalize_alternative_code(lpc.alternative_code)
             = public.normalize_alternative_code(cei.alternative_code_snapshot)
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
            WHEN resolved.product_id IS NULL
              OR resolved.is_active IS DISTINCT FROM TRUE
              OR resolved.group_is_active IS DISTINCT FROM TRUE
              OR resolved.eligible_product_id IS NULL
                THEN 'CODE_NOT_FOUND'
            WHEN resolved.has_stock IS DISTINCT FROM TRUE
                THEN 'PLEASE_CONFIRM'
            WHEN resolved.effective_quantity > 10
                THEN 'PLEASE_CONFIRM'
            WHEN COALESCE(resolved.stock, 0) >= resolved.effective_quantity
                THEN 'AVAILABLE'
            ELSE 'PLEASE_CONFIRM'
        END,
        live_stock_snapshot = CASE
            WHEN resolved.product_id IS NULL
              OR resolved.is_active IS DISTINCT FROM TRUE
              OR resolved.group_is_active IS DISTINCT FROM TRUE
              OR resolved.eligible_product_id IS NULL
              OR resolved.has_stock IS DISTINCT FROM TRUE
                THEN NULL
            ELSE COALESCE(resolved.stock, 0)
        END,
        checked_at = NOW()
    FROM resolved
    WHERE cei.id = resolved.enquiry_item_id;
END;
$$;

REVOKE ALL ON FUNCTION public.recheck_enquiry_stock(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.recheck_enquiry_stock(UUID) TO authenticated;


CREATE OR REPLACE FUNCTION public.resolve_enquiry_items(
    p_enquiry_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_enquiry RECORD;
    v_result JSONB;
BEGIN
    PERFORM public.cf8_require_staff();

    SELECT id, code_group_id_snapshot, code_group_name_snapshot, customer_prefix_snapshot
    INTO v_enquiry
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    SELECT COALESCE(
        jsonb_agg(
            jsonb_build_object(
                'enquiry_item_id',
                    cei.id,
                'mapping_id_snapshot',
                    cei.mapping_id_snapshot,
                'current_mapping_id',
                    lpc.id,
                'code_group_id_snapshot',
                    COALESCE(cei.code_group_id_snapshot, v_enquiry.code_group_id_snapshot),
                'code_group_name_snapshot',
                    v_enquiry.code_group_name_snapshot,
                'current_code_group_name',
                    grp.name,
                'customer_prefix_snapshot',
                    COALESCE(cei.customer_prefix_snapshot, v_enquiry.customer_prefix_snapshot),
                'base_alternative_code_snapshot',
                    cei.alternative_code_snapshot,
                'alternative_code_snapshot',
                    cei.alternative_code_snapshot,
                'prefixed_code_snapshot',
                    COALESCE(
                        cei.prefixed_code_snapshot,
                        CASE
                            WHEN COALESCE(cei.customer_prefix_snapshot, v_enquiry.customer_prefix_snapshot) IS NOT NULL
                                THEN COALESCE(cei.customer_prefix_snapshot, v_enquiry.customer_prefix_snapshot)
                                     || public.normalize_alternative_code(cei.alternative_code_snapshot)
                            ELSE cei.alternative_code_snapshot
                        END
                    ),
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
                        (lpc.id IS NOT NULL AND lpc.is_active IS FALSE)
                        OR (grp.id IS NOT NULL AND grp.is_active IS FALSE)
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
    LEFT JOIN public.laminea_code_groups grp
      ON grp.id = COALESCE(cei.code_group_id_snapshot, v_enquiry.code_group_id_snapshot)
    LEFT JOIN public.laminea_product_codes lpc
      ON lpc.group_id = COALESCE(cei.code_group_id_snapshot, v_enquiry.code_group_id_snapshot)
     AND public.normalize_alternative_code(lpc.alternative_code)
         = public.normalize_alternative_code(cei.alternative_code_snapshot)
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

REVOKE ALL ON FUNCTION public.resolve_enquiry_items(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.resolve_enquiry_items(UUID) TO authenticated;


-- =============================================================================
-- 11. Group & Prefix Aware process_estimate_atomic + create_estimate_from_enquiry
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
    v_item_id UUID;
    v_new_item JSONB;
    v_old_items JSONB := '[]'::JSONB;
    v_new_items JSONB := '[]'::JSONB;
    v_old_match JSONB;
    v_mapping_unchanged BOOLEAN;
    v_match_count INTEGER;
    v_idx INTEGER := 1;

    v_input_pid UUID;
    v_pid UUID;
    v_product_name TEXT;
    v_platform_enabled BOOLEAN;
    v_has_stock BOOLEAN;
    v_alt_code TEXT;
    v_base_alt_code TEXT;
    v_customer_prefix TEXT;
    v_mapping_id UUID;
    v_code_group_id UUID;
    v_lookup_norm_code TEXT;
    v_actual_code TEXT;
    v_calc_type TEXT;
    v_unit TEXT;
    v_remark TEXT;

    v_length NUMERIC;
    v_width NUMERIC;
    v_eff_l NUMERIC;
    v_eff_w NUMERIC;
    v_nos NUMERIC;
    v_quantity NUMERIC;
    v_rate NUMERIC;
    v_discount NUMERIC;
    v_amount NUMERIC;
    v_expected_quantity NUMERIC;
    v_expected_amount NUMERIC;
    v_qty NUMERIC;

    v_total_nos NUMERIC;
    v_total_quantity NUMERIC;
    v_sub_total NUMERIC;
    v_gst_percent NUMERIC;
    v_gst_amount NUMERIC;
    v_grand_total NUMERIC;

    v_calc_total_nos NUMERIC := 0;
    v_calc_total_qty NUMERIC := 0;
    v_calc_sub_total NUMERIC := 0;
    v_expected_gst_amount NUMERIC;
    v_expected_grand_total NUMERIC;

    v_old_effect NUMERIC;
    v_new_effect NUMERIC;
    v_delta NUMERIC;
    v_product_ids UUID[];
    v_history_type TEXT;
    v_rec RECORD;
    v_request JSONB;
    v_saved_request JSONB;
BEGIN
    IF public.is_active_staff() IS DISTINCT FROM TRUE THEN
        RAISE EXCEPTION 'Unauthorized: active staff session required.';
    END IF;
    PERFORM public.cf20_take_mutation_lock();

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

    IF p_action = 'SAVE' AND p_estimate_id IS NULL THEN
        IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
            RAISE EXCEPTION 'SAVE requires an items array';
        END IF;
        v_request := public.cf20_estimate_request(p_platform,p_doc_type,p_bill_date,p_client_id,
            p_client_name,p_client_mobile,p_prepared_by,p_order_by,p_site_name,p_totals,p_items,p_previous_balance);
        IF p_idempotency_key IS NULL THEN
            RAISE EXCEPTION 'Idempotency key is required when creating a document.';
        END IF;

        PERFORM pg_catalog.pg_advisory_xact_lock(
            pg_catalog.hashtextextended(p_idempotency_key::TEXT, 0)
        );

        SELECT e.id, e.bill_number, e.cf20_request_payload
        INTO v_est_id, v_bill_num, v_saved_request
        FROM public.estimates e
        WHERE e.idempotency_key = p_idempotency_key
          AND e.platform = p_platform
        LIMIT 1;

        IF FOUND THEN
            IF v_saved_request IS NULL THEN
                RAISE EXCEPTION 'Legacy document retry has no stored request; review the existing document instead of creating another';
            END IF;
            IF v_saved_request IS DISTINCT FROM v_request THEN
                RAISE EXCEPTION 'Idempotency key already belongs to a different document request';
            END IF;
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
        WHERE platform = p_platform
          AND estimate_id = p_estimate_id;

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
            WHERE platform = p_platform
              AND estimate_id = p_estimate_id;

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
        WHERE platform = p_platform
          AND estimate_id = p_estimate_id;

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

    -- Explicitly reject NaN / Infinity in header totals and previous balance
    IF v_total_nos IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
       OR v_total_quantity IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
       OR v_sub_total IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
       OR v_gst_percent IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
       OR v_gst_amount IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
       OR v_grand_total IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
       OR (p_previous_balance IS NOT NULL AND p_previous_balance IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)) THEN
        RAISE EXCEPTION 'Document totals and balances must be finite numbers.';
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

    -- Reject duplicate saved item IDs in p_items
    IF EXISTS (
        SELECT 1
        FROM jsonb_array_elements(p_items) AS item_el(val)
        WHERE NULLIF(BTRIM(COALESCE(item_el.val->>'id', item_el.val->>'estimate_item_id')), '') IS NOT NULL
        GROUP BY NULLIF(BTRIM(COALESCE(item_el.val->>'id', item_el.val->>'estimate_item_id')), '')::UUID
        HAVING COUNT(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate estimate item IDs in save payload.';
    END IF;

    -- Consistent locking strategy before mapping validation and stock mutation:
    -- 1. Lock referenced laminea_product_codes rows in deterministic order (FOR SHARE)
    -- 2. Lock referenced products rows in deterministic order (FOR NO KEY UPDATE)
    IF p_platform = 'laminea' THEN
        PERFORM lpc.id
        FROM public.laminea_product_codes lpc
        WHERE lpc.id IN (
            SELECT DISTINCT NULLIF(BTRIM(item_el.val->>'mapping_id_snapshot'), '')::UUID
            FROM jsonb_array_elements(p_items) AS item_el(val)
            WHERE NULLIF(BTRIM(item_el.val->>'mapping_id_snapshot'), '') IS NOT NULL
        )
        OR public.normalize_alternative_code(lpc.alternative_code) IN (
            SELECT DISTINCT public.normalize_alternative_code(
                COALESCE(NULLIF(BTRIM(item_el.val->>'base_alternative_code_snapshot'), ''), NULLIF(BTRIM(item_el.val->>'alternative_code_snapshot'), ''))
            )
            FROM jsonb_array_elements(p_items) AS item_el(val)
            WHERE COALESCE(NULLIF(BTRIM(item_el.val->>'base_alternative_code_snapshot'), ''), NULLIF(BTRIM(item_el.val->>'alternative_code_snapshot'), '')) IS NOT NULL
        )
        ORDER BY lpc.id
        FOR SHARE OF lpc;
    END IF;

    PERFORM p.id
    FROM public.products p
    WHERE p.id IN (
        SELECT DISTINCT ids.pid
        FROM (
            SELECT NULLIF(BTRIM(item_el.val->>'product_id'), '')::UUID AS pid
            FROM jsonb_array_elements(p_items) AS item_el(val)
            UNION
            SELECT NULLIF(BTRIM(old_el.val->>'product_id'), '')::UUID AS pid
            FROM jsonb_array_elements(v_old_items) AS old_el(val)
            UNION
            SELECT lpc.product_id AS pid
            FROM public.laminea_product_codes lpc
            WHERE p_platform = 'laminea'
              AND (
                  lpc.id IN (
                      SELECT DISTINCT NULLIF(BTRIM(item_el.val->>'mapping_id_snapshot'), '')::UUID
                      FROM jsonb_array_elements(p_items) AS item_el(val)
                      WHERE NULLIF(BTRIM(item_el.val->>'mapping_id_snapshot'), '') IS NOT NULL
                  )
                  OR public.normalize_alternative_code(lpc.alternative_code) IN (
                      SELECT DISTINCT public.normalize_alternative_code(
                          COALESCE(NULLIF(BTRIM(item_el.val->>'base_alternative_code_snapshot'), ''), NULLIF(BTRIM(item_el.val->>'alternative_code_snapshot'), ''))
                      )
                      FROM jsonb_array_elements(p_items) AS item_el(val)
                      WHERE COALESCE(NULLIF(BTRIM(item_el.val->>'base_alternative_code_snapshot'), ''), NULLIF(BTRIM(item_el.val->>'alternative_code_snapshot'), '')) IS NOT NULL
                  )
              )
        ) AS ids
        WHERE ids.pid IS NOT NULL
    )
    ORDER BY p.id
    FOR NO KEY UPDATE OF p;

    FOR v_item IN
        SELECT value FROM jsonb_array_elements(p_items)
    LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN
            RAISE EXCEPTION 'Every estimate item must be a JSON object.';
        END IF;

        v_item_id := NULLIF(BTRIM(COALESCE(v_item->>'id', v_item->>'estimate_item_id')), '')::UUID;
        v_input_pid := NULLIF(BTRIM(v_item->>'product_id'), '')::UUID;
        v_pid := v_input_pid;
        v_has_stock := NULL;
        v_alt_code := NULLIF(BTRIM(v_item->>'alternative_code_snapshot'), '');
        v_base_alt_code := NULLIF(BTRIM(v_item->>'base_alternative_code_snapshot'), '');
        v_customer_prefix := NULLIF(public.normalize_customer_prefix(v_item->>'customer_prefix_snapshot'), '');
        v_mapping_id := NULLIF(BTRIM(v_item->>'mapping_id_snapshot'), '')::UUID;
        v_code_group_id := NULLIF(BTRIM(v_item->>'code_group_id_snapshot'), '')::UUID;
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

        -- Explicitly reject NaN / Infinity in item numbers
        IF (v_length IS NOT NULL AND v_length IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC))
           OR (v_width IS NOT NULL AND v_width IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC))
           OR v_nos IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
           OR v_quantity IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
           OR v_rate IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
           OR v_discount IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC)
           OR v_amount IN ('NaN'::NUMERIC, 'Infinity'::NUMERIC, '-Infinity'::NUMERIC) THEN
            RAISE EXCEPTION 'Item % contains non-finite numeric values.', v_idx;
        END IF;

        IF v_length < 0 OR v_width < 0 OR v_nos < 0 OR v_quantity < 0
           OR v_rate < 0 OR v_amount < 0 OR v_discount < 0 OR v_discount > 100 THEN
            RAISE EXCEPTION 'Invalid negative value or discount for item %.', v_idx;
        END IF;

        -- Verify item quantity and amount against repository calculation & rounding rules
        -- rate is already NET of discount in CreateEstimate.jsx.
        IF v_calc_type = 'SQFT' THEN
            v_expected_quantity := ROUND(COALESCE(v_length, 0) * COALESCE(v_width, 0) * v_nos, 2);
            v_expected_amount := CEIL((COALESCE(v_length, 0) * COALESCE(v_width, 0) * v_nos) * v_rate);
            IF ABS(v_quantity - v_expected_quantity) > 0.01 THEN
                RAISE EXCEPTION 'Item % SQFT quantity (%) does not match length * width * nos (%).', v_idx, v_quantity, v_expected_quantity;
            END IF;
            IF v_amount <> v_expected_amount THEN
                RAISE EXCEPTION 'Item % SQFT amount (%) does not match calculated amount (%).', v_idx, v_amount, v_expected_amount;
            END IF;
        ELSIF v_calc_type IN ('INCH', 'FEET') THEN
            v_eff_l := CASE WHEN v_length IS NULL OR v_length <= 0 THEN 1 ELSE v_length END;
            v_eff_w := CASE WHEN v_width IS NULL OR v_width <= 0 THEN 1 ELSE v_width END;
            v_expected_amount := CEIL(v_eff_l * v_eff_w * v_nos * v_rate);
            IF v_amount <> v_expected_amount THEN
                RAISE EXCEPTION 'Item % % amount (%) does not match calculated amount (%).', v_idx, v_calc_type, v_amount, v_expected_amount;
            END IF;
        ELSE
            v_expected_amount := CEIL(v_quantity * v_rate);
            IF v_amount <> v_expected_amount THEN
                RAISE EXCEPTION 'Item % QUANTITY amount (%) does not match calculated amount (%).', v_idx, v_amount, v_expected_amount;
            END IF;
        END IF;

        v_calc_total_nos := v_calc_total_nos + CASE WHEN v_calc_type IN ('SQFT','INCH','FEET') THEN v_nos ELSE v_quantity END;
        v_calc_total_qty := v_calc_total_qty + v_quantity;
        v_calc_sub_total := v_calc_sub_total + v_amount;

        v_qty := CASE
            WHEN v_calc_type IN ('SQFT', 'INCH', 'FEET') THEN v_nos
            ELSE v_quantity
        END;

        -- Match existing saved item explicitly by its stable item ID when editing an estimate
        v_old_match := NULL;
        IF p_estimate_id IS NOT NULL AND v_item_id IS NOT NULL THEN
            SELECT x.val
            INTO v_old_match
            FROM jsonb_array_elements(v_old_items) AS x(val)
            WHERE NULLIF(x.val->>'id', '')::UUID = v_item_id;

            IF v_old_match IS NULL THEN
                RAISE EXCEPTION 'Saved estimate item % does not belong to this estimate.', v_item_id;
            END IF;
        END IF;

        IF p_platform = 'laminea' THEN
            IF v_alt_code IS NOT NULL OR v_base_alt_code IS NOT NULL OR v_mapping_id IS NOT NULL THEN
                v_mapping_unchanged := FALSE;

                -- If this item is an existing saved item on the estimate and staff did NOT deliberately
                -- change its mapping, product, or alternative code, preserve its exact historical context
                -- without reloading current mappings or allowing incoming group/prefix values to overwrite it.
                IF v_old_match IS NOT NULL
                   AND (
                       NULLIF(v_old_match->>'alternative_code_snapshot', '') IS NOT NULL
                       OR NULLIF(v_old_match->>'base_alternative_code_snapshot', '') IS NOT NULL
                       OR NULLIF(v_old_match->>'mapping_id_snapshot', '') IS NOT NULL
                   )
                   AND (v_input_pid IS NULL OR v_input_pid = NULLIF(v_old_match->>'product_id', '')::UUID)
                   AND (
                       v_mapping_id IS NULL
                       OR NULLIF(v_old_match->>'mapping_id_snapshot', '') IS NULL
                       OR v_mapping_id = NULLIF(v_old_match->>'mapping_id_snapshot', '')::UUID
                   )
                   AND (
                       v_code_group_id IS NULL
                       OR NULLIF(v_old_match->>'code_group_id_snapshot', '') IS NULL
                       OR v_code_group_id = NULLIF(v_old_match->>'code_group_id_snapshot', '')::UUID
                   )
                   AND (
                       v_alt_code IS NULL
                       OR public.normalize_alternative_code(v_alt_code)
                          = public.normalize_alternative_code(v_old_match->>'alternative_code_snapshot')
                       OR public.normalize_alternative_code(v_alt_code)
                          = public.normalize_alternative_code(COALESCE(NULLIF(v_old_match->>'base_alternative_code_snapshot', ''), v_old_match->>'alternative_code_snapshot'))
                   )
                   AND (
                       v_base_alt_code IS NULL
                       OR public.normalize_alternative_code(v_base_alt_code)
                          = public.normalize_alternative_code(COALESCE(NULLIF(v_old_match->>'base_alternative_code_snapshot', ''), v_old_match->>'alternative_code_snapshot'))
                   ) THEN
                    v_mapping_unchanged := TRUE;
                END IF;

                IF v_mapping_unchanged THEN
                    v_pid := NULLIF(v_old_match->>'product_id', '')::UUID;
                    v_mapping_id := NULLIF(v_old_match->>'mapping_id_snapshot', '')::UUID;
                    v_code_group_id := NULLIF(v_old_match->>'code_group_id_snapshot', '')::UUID;
                    v_base_alt_code := COALESCE(
                        NULLIF(v_old_match->>'base_alternative_code_snapshot', ''),
                        NULLIF(v_old_match->>'alternative_code_snapshot', '')
                    );
                    v_customer_prefix := NULLIF(public.normalize_customer_prefix(v_old_match->>'customer_prefix_snapshot'), '');
                    v_alt_code := NULLIF(v_old_match->>'alternative_code_snapshot', '');
                    v_actual_code := NULLIF(v_old_match->>'actual_code_snapshot', '');
                    v_product_name := COALESCE(NULLIF(v_old_match->>'product_name_snapshot', ''), v_product_name);

                    IF v_pid IS NOT NULL THEN
                        SELECT p.has_stock
                        INTO v_has_stock
                        FROM public.products p
                        WHERE p.id = v_pid;

                        IF NOT FOUND THEN
                            RAISE EXCEPTION 'Product for historical Laminea item % not found.', v_idx;
                        END IF;
                    END IF;
                ELSE
                    -- New item or staff deliberately changed the mapping/code
                    v_lookup_norm_code := public.normalize_alternative_code(COALESCE(v_base_alt_code, v_alt_code));
                    IF v_base_alt_code IS NULL
                       AND v_customer_prefix IS NOT NULL
                       AND v_lookup_norm_code LIKE (v_customer_prefix || '%')
                       AND LENGTH(v_lookup_norm_code) > LENGTH(v_customer_prefix) THEN
                        v_lookup_norm_code := SUBSTRING(v_lookup_norm_code FROM LENGTH(v_customer_prefix) + 1);
                    END IF;

                    IF v_mapping_id IS NOT NULL THEN
                        SELECT
                            lpc.id,
                            lpc.group_id,
                            lpc.product_id,
                            lpc.alternative_code,
                            p.product_code,
                            p.product_name,
                            p.has_stock
                        INTO
                            v_mapping_id,
                            v_code_group_id,
                            v_pid,
                            v_base_alt_code,
                            v_actual_code,
                            v_product_name,
                            v_has_stock
                        FROM public.laminea_product_codes lpc
                        JOIN public.products p ON p.id = lpc.product_id
                        JOIN public.laminea_code_groups lcg ON lcg.id = lpc.group_id
                        WHERE lpc.id = v_mapping_id
                          AND (v_code_group_id IS NULL OR lpc.group_id = v_code_group_id)
                          AND lpc.is_active = TRUE
                          AND lcg.is_active = TRUE
                          AND p.in_laminea = TRUE
                          AND p.has_stock = TRUE
                          AND p.product_code IS NOT NULL
                          AND BTRIM(p.product_code) <> ''
                        FOR SHARE OF lpc;

                        IF NOT FOUND THEN
                            RAISE EXCEPTION 'Selected Laminea mapping is unavailable or inactive for item %.', v_idx;
                        END IF;

                        IF v_lookup_norm_code IS NOT NULL
                           AND v_lookup_norm_code <> ''
                           AND public.normalize_alternative_code(v_base_alt_code) <> v_lookup_norm_code THEN
                            RAISE EXCEPTION 'Alternative code does not match the selected mapping for item %.', v_idx;
                        END IF;
                    ELSIF v_code_group_id IS NOT NULL THEN
                        SELECT
                            lpc.id,
                            lpc.group_id,
                            lpc.product_id,
                            lpc.alternative_code,
                            p.product_code,
                            p.product_name,
                            p.has_stock
                        INTO
                            v_mapping_id,
                            v_code_group_id,
                            v_pid,
                            v_base_alt_code,
                            v_actual_code,
                            v_product_name,
                            v_has_stock
                        FROM public.laminea_product_codes lpc
                        JOIN public.products p ON p.id = lpc.product_id
                        JOIN public.laminea_code_groups lcg ON lcg.id = lpc.group_id
                        WHERE lpc.group_id = v_code_group_id
                          AND public.normalize_alternative_code(lpc.alternative_code) = v_lookup_norm_code
                          AND lpc.is_active = TRUE
                          AND lcg.is_active = TRUE
                          AND p.in_laminea = TRUE
                          AND p.has_stock = TRUE
                          AND p.product_code IS NOT NULL
                          AND BTRIM(p.product_code) <> ''
                        FOR SHARE OF lpc;

                        IF NOT FOUND THEN
                            RAISE EXCEPTION 'No active Laminea mapping found in the selected group for alternative code % (item %).',
                                COALESCE(v_base_alt_code, v_alt_code), v_idx;
                        END IF;
                    ELSE
                        -- Neither mapping_id nor code_group_id was supplied:
                        -- Reject ambiguous codes that exist in multiple active groups; never silently pick one.
                        SELECT COUNT(*)
                        INTO v_match_count
                        FROM public.laminea_product_codes lpc
                        JOIN public.products p ON p.id = lpc.product_id
                        JOIN public.laminea_code_groups lcg ON lcg.id = lpc.group_id
                        WHERE public.normalize_alternative_code(lpc.alternative_code) = v_lookup_norm_code
                          AND lpc.is_active = TRUE
                          AND lcg.is_active = TRUE
                          AND p.in_laminea = TRUE
                          AND p.has_stock = TRUE
                          AND p.product_code IS NOT NULL
                          AND BTRIM(p.product_code) <> '';

                        IF v_match_count = 0 THEN
                            RAISE EXCEPTION 'No active Laminea mapping found for alternative code %.', COALESCE(v_base_alt_code, v_alt_code);
                        ELSIF v_match_count > 1 THEN
                            RAISE EXCEPTION 'Alternative code % exists in multiple groups; select a specific group or mapping for item %.',
                                COALESCE(v_base_alt_code, v_alt_code), v_idx;
                        END IF;

                        SELECT
                            lpc.id,
                            lpc.group_id,
                            lpc.product_id,
                            lpc.alternative_code,
                            p.product_code,
                            p.product_name,
                            p.has_stock
                        INTO
                            v_mapping_id,
                            v_code_group_id,
                            v_pid,
                            v_base_alt_code,
                            v_actual_code,
                            v_product_name,
                            v_has_stock
                        FROM public.laminea_product_codes lpc
                        JOIN public.products p ON p.id = lpc.product_id
                        JOIN public.laminea_code_groups lcg ON lcg.id = lpc.group_id
                        WHERE public.normalize_alternative_code(lpc.alternative_code) = v_lookup_norm_code
                          AND lpc.is_active = TRUE
                          AND lcg.is_active = TRUE
                          AND p.in_laminea = TRUE
                          AND p.has_stock = TRUE
                          AND p.product_code IS NOT NULL
                          AND BTRIM(p.product_code) <> ''
                        FOR SHARE OF lpc;
                    END IF;

                    IF v_input_pid IS NOT NULL AND v_input_pid <> v_pid THEN
                        RAISE EXCEPTION 'Alternative code does not match the submitted product for item %.', v_idx;
                    END IF;

                    IF v_customer_prefix IS NOT NULL THEN
                        v_alt_code := v_customer_prefix || public.normalize_alternative_code(v_base_alt_code);
                    ELSE
                        v_alt_code := v_base_alt_code;
                    END IF;
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
                v_base_alt_code := NULL;
                v_customer_prefix := NULL;
                v_mapping_id := NULL;
                v_code_group_id := NULL;
            ELSIF v_actual_code IS NOT NULL THEN
                RAISE EXCEPTION 'Actual code cannot be supplied for an unmapped manual Laminea item.';
            END IF;
        ELSE
            v_alt_code := NULL;
            v_base_alt_code := NULL;
            v_customer_prefix := NULL;
            v_mapping_id := NULL;
            v_code_group_id := NULL;
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
            'id', CASE WHEN p_estimate_id IS NULL THEN gen_random_uuid() ELSE COALESCE(v_item_id, gen_random_uuid()) END,
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
            'base_alternative_code_snapshot', v_base_alt_code,
            'customer_prefix_snapshot', v_customer_prefix,
            'code_group_id_snapshot', v_code_group_id,
            'mapping_id_snapshot', v_mapping_id,
            'new_effect', v_new_effect
        );

        v_new_items := v_new_items || jsonb_build_array(v_new_item);
        v_idx := v_idx + 1;
    END LOOP;

    -- Verify header totals against calculated item sums and GST rounding rules
    v_gst_percent := ROUND(v_gst_percent);
    v_expected_gst_amount := ROUND(v_calc_sub_total * (v_gst_percent / 100.0));
    v_expected_grand_total := v_calc_sub_total + v_expected_gst_amount;

    IF ABS(v_total_nos - v_calc_total_nos) > 0.01 THEN
        RAISE EXCEPTION 'Document total_nos (%) does not match sum of item nos (%).', v_total_nos, v_calc_total_nos;
    END IF;

    IF ABS(v_total_quantity - v_calc_total_qty) > 0.01 THEN
        RAISE EXCEPTION 'Document total_quantity (%) does not match sum of item quantities (%).', v_total_quantity, v_calc_total_qty;
    END IF;

    IF v_sub_total <> v_calc_sub_total THEN
        RAISE EXCEPTION 'Document sub_total (%) does not match sum of item amounts (%).', v_sub_total, v_calc_sub_total;
    END IF;

    IF v_gst_amount <> v_expected_gst_amount THEN
        RAISE EXCEPTION 'Document gst_amount (%) does not match calculated GST (%).', v_gst_amount, v_expected_gst_amount;
    END IF;

    IF v_grand_total <> v_expected_grand_total THEN
        RAISE EXCEPTION 'Document grand_total (%) does not match sub_total + gst_amount (%).', v_grand_total, v_expected_grand_total;
    END IF;

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
            total_nos = v_calc_total_nos,
            total_quantity = ROUND(v_calc_total_qty, 2),
            sub_total = v_calc_sub_total,
            gst_percent = v_gst_percent,
            gst_amount = v_expected_gst_amount,
            grand_total = v_expected_grand_total,
            previous_balance = COALESCE(p_previous_balance, 0),
            is_archived = FALSE,
            updated_at = NOW()
        WHERE id = v_est_id;
    ELSE
        v_bill_num := public.get_next_bill_number(p_platform)::INTEGER;

        INSERT INTO public.estimates (
            bill_number, platform, platform_estimate_number, bill_date,
            transport, client_name, client_mobile, order_by, client_id,
            prepared_by, site_name, type, idempotency_key,
            total_nos, total_quantity, sub_total, gst_percent, gst_amount,
            grand_total, previous_balance, is_archived, cf20_request_payload
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
            v_calc_total_nos,
            ROUND(v_calc_total_qty, 2),
            v_calc_sub_total,
            v_gst_percent,
            v_expected_gst_amount,
            v_expected_grand_total,
            COALESCE(p_previous_balance, 0),
            FALSE,
            v_request
        )
        RETURNING id INTO v_est_id;
    END IF;

    INSERT INTO public.estimate_items (
        id, estimate_id, serial_number, product_id, product_name_snapshot,
        length_snapshot, width_snapshot, nos, quantity, unit_snapshot,
        rate, discount_percent, calculation_type_snapshot, amount, remark,
        actual_code_snapshot, alternative_code_snapshot,
        base_alternative_code_snapshot, customer_prefix_snapshot,
        code_group_id_snapshot, mapping_id_snapshot
    )
    SELECT
        COALESCE(NULLIF(x.value->>'id', '')::UUID, gen_random_uuid()),
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
        x.value->>'alternative_code_snapshot',
        NULLIF(x.value->>'base_alternative_code_snapshot', ''),
        NULLIF(x.value->>'customer_prefix_snapshot', ''),
        NULLIF(x.value->>'code_group_id_snapshot', '')::UUID,
        NULLIF(x.value->>'mapping_id_snapshot', '')::UUID
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
            END IF;

            -- Record per-code stock history even when v_delta = 0 (e.g. when an item's
            -- alternative code changed while keeping the same product and quantity).
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
        END LOOP;
    END IF;

    DELETE FROM public.client_purchases
    WHERE platform = p_platform
      AND estimate_id = v_est_id;

    IF p_doc_type IN ('ESTIMATE', 'RETURN') AND p_client_id IS NOT NULL THEN
        INSERT INTO public.client_purchases (
            estimate_id, client_id, product_id, product_name, quantity, unit, rate, amount,
            bill_number, bill_date, platform, is_archived
        )
        SELECT
            v_est_id,
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
    v_existing_bill_num INTEGER;
    v_group_id UUID;
    v_base_code_lookup TEXT;
    v_mapping RECORD;
    v_prefix TEXT;
    v_display_code TEXT;
    v_normalized_items JSONB := '[]'::jsonb;
    v_request JSONB;
BEGIN
    PERFORM public.cf8_require_staff();

    p_platform := LOWER(BTRIM(COALESCE(p_platform, '')));
    p_doc_type := UPPER(BTRIM(COALESCE(p_doc_type, '')));

    SELECT * INTO v_enquiry
    FROM public.code_finder_enquiries
    WHERE id = p_enquiry_id FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Enquiry not found';
    END IF;

    PERFORM public.cf20_take_mutation_lock();

    IF v_enquiry.status <> 'ORDER_PLACED' THEN
        RAISE EXCEPTION 'The customer must place the order before an estimate can be created';
    END IF;

    IF p_platform IS DISTINCT FROM 'laminea' OR p_doc_type NOT IN ('ESTIMATE', 'QUOTATION') THEN
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

    IF jsonb_typeof(p_items) IS DISTINCT FROM 'array' THEN
        RAISE EXCEPTION 'Estimate items required';
    END IF;
    v_request := public.cf20_estimate_request(p_platform,p_doc_type,p_bill_date,p_client_id,
        p_client_name,p_client_mobile,p_prepared_by,p_order_by,p_site_name,p_totals,p_items,p_previous_balance);

    IF v_enquiry.converted_estimate_id IS NOT NULL THEN
        IF v_enquiry.cf20_conversion_key IS NULL OR v_enquiry.cf20_conversion_request IS NULL THEN
            RAISE EXCEPTION 'Legacy linked document exists; open it for review rather than creating another';
        END IF;
        IF v_enquiry.cf20_conversion_key IS DISTINCT FROM p_idempotency_key
           OR v_enquiry.cf20_conversion_request IS DISTINCT FROM v_request THEN
            RAISE EXCEPTION 'Conversion retry key or payload differs from the original request';
        END IF;
        SELECT type, bill_number
        INTO v_type, v_existing_bill_num
        FROM public.estimates
        WHERE id = v_enquiry.converted_estimate_id;

        IF v_type IN ('ESTIMATE', 'QUOTATION') AND v_type = p_doc_type THEN
            RETURN jsonb_build_object(
                'success', TRUE,
                'estimate_id', v_enquiry.converted_estimate_id,
                'bill_number', v_existing_bill_num,
                'duplicate', TRUE
            );
        END IF;

        RAISE EXCEPTION 'Existing linked document (%) requires internal review or differs from requested type (%); do not create another',
            COALESCE(v_type, 'MISSING'), p_doc_type;
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

    -- Require backfilled/snapshotted historical group context on every enquiry item;
    -- never fall back to a hardcoded UUID.
    IF EXISTS (
        SELECT 1
        FROM public.code_finder_enquiry_items item
        WHERE item.enquiry_id = p_enquiry_id
          AND COALESCE(item.code_group_id_snapshot, v_enquiry.code_group_id_snapshot) IS NULL
    ) THEN
        RAISE EXCEPTION 'Missing historical code group snapshot on enquiry; cannot convert enquiry';
    END IF;

    PERFORM mapping.id
    FROM public.laminea_product_codes mapping
    JOIN public.code_finder_enquiry_items item
      ON mapping.group_id = COALESCE(item.code_group_id_snapshot, v_enquiry.code_group_id_snapshot)
     AND public.normalize_alternative_code(item.alternative_code_snapshot)
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
          ON mapping.group_id = COALESCE(item.code_group_id_snapshot, v_enquiry.code_group_id_snapshot)
         AND public.normalize_alternative_code(item.alternative_code_snapshot)
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

        v_base_code_lookup := COALESCE(
            NULLIF(v_expected->>'base_alternative_code_snapshot', ''),
            v_expected->>'alternative_code_snapshot'
        );

        IF v_item->>'product_id' IS DISTINCT FROM v_expected->>'current_product_id'
           OR (
                public.normalize_alternative_code(COALESCE(NULLIF(v_item->>'base_alternative_code_snapshot', ''), v_item->>'alternative_code_snapshot'))
                   IS DISTINCT FROM public.normalize_alternative_code(v_base_code_lookup)
                AND public.normalize_alternative_code(v_item->>'alternative_code_snapshot')
                   IS DISTINCT FROM public.normalize_alternative_code(v_expected->>'prefixed_code_snapshot')
           )
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

        v_group_id := COALESCE(
            NULLIF(v_expected->>'code_group_id_snapshot', '')::UUID,
            v_enquiry.code_group_id_snapshot
        );

        IF v_group_id IS NULL THEN
            RAISE EXCEPTION 'Missing historical code group snapshot for enquiry item; cannot convert enquiry';
        END IF;

        -- Look up mapping strictly by base_alternative_code_snapshot (never prefixed_code_snapshot)
        SELECT mapping.id, mapping.group_id, mapping.alternative_code
        INTO v_mapping
        FROM public.laminea_product_codes mapping
        WHERE mapping.group_id = v_group_id
          AND public.normalize_alternative_code(mapping.alternative_code)
              = public.normalize_alternative_code(v_base_code_lookup)
          AND mapping.is_active
        LIMIT 1;

        IF NOT FOUND THEN
            RAISE EXCEPTION 'Mapping unavailable';
        END IF;

        v_prefix := NULLIF(public.normalize_customer_prefix(COALESCE(
            NULLIF(v_expected->>'customer_prefix_snapshot', ''),
            v_enquiry.customer_prefix_snapshot
        )), '');

        v_display_code := COALESCE(
            NULLIF(v_expected->>'prefixed_code_snapshot', ''),
            CASE
                WHEN v_prefix IS NOT NULL THEN v_prefix || public.normalize_alternative_code(v_mapping.alternative_code)
                ELSE v_mapping.alternative_code
            END
        );

        v_item := v_item || jsonb_build_object(
            'mapping_id_snapshot', v_mapping.id,
            'code_group_id_snapshot', v_mapping.group_id,
            'base_alternative_code_snapshot', v_mapping.alternative_code,
            'customer_prefix_snapshot', v_prefix,
            'alternative_code_snapshot', v_display_code
        );

        v_normalized_items := v_normalized_items || jsonb_build_array(v_item);
    END LOOP;

    -- An unlinked enquiry must never adopt a document created by another request,
    -- even if its customer/items happen to match. No partial save can exist from
    -- this conversion RPC: document creation and linkage share one transaction.
    IF EXISTS (SELECT 1 FROM public.estimates WHERE idempotency_key = p_idempotency_key) THEN
        RAISE EXCEPTION 'Idempotency key already belongs to another document; use a new conversion key';
    END IF;

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
    SET converted_estimate_id = v_est_id,
        cf20_conversion_key = p_idempotency_key,
        cf20_conversion_request = v_request
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
FROM PUBLIC, anon;

GRANT EXECUTE
ON FUNCTION public.create_estimate_from_enquiry(
    UUID, UUID, TEXT, TEXT, TEXT, UUID, TEXT, TEXT,
    TEXT, TEXT, TEXT, JSONB, JSONB, NUMERIC
)
TO authenticated;


DO $cf20$
DECLARE n bigint;
BEGIN
    SELECT count(*) INTO n FROM public.client_purchases WHERE estimate_id IS NULL;
    IF n > 0 THEN
        RAISE NOTICE '% legacy purchase rows remain unlinked and are preserved. Reconcile explicitly; do not match by bill number alone.', n;
    END IF;
END;
$cf20$;
REVOKE ALL ON FUNCTION public.process_estimate_atomic(TEXT,UUID,UUID,TEXT,TEXT,INTEGER,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,NUMERIC)
FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.process_estimate_atomic(TEXT,UUID,UUID,TEXT,TEXT,INTEGER,TEXT,UUID,TEXT,TEXT,TEXT,TEXT,TEXT,JSONB,JSONB,NUMERIC)
TO authenticated;

COMMIT;
