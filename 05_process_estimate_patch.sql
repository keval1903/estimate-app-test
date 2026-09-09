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
