-- =============================================================================
-- CampusFind — 03_matching.sql
-- Helper functions and the rule-based weighted matching engine.
--
-- Matching answers ONE question: "do this lost report and this found item
-- probably describe the same object?" The score only RANKS candidates. It never
-- proves ownership and never approves anything (see compute_verification_indicator
-- in 04_workflow.sql for the separate, admin-only ownership check).
--
-- Privacy rule: matching reads ONLY public/admin-visible columns of found_items.
-- found_item_private is never read here, so a score can never leak a secret.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Session context. Express runs, inside every transaction:
--     SELECT set_config('app.user_id', '<id from verified JWT>', true);
-- 'true' = transaction-local, so the value can never leak to the next request
-- that reuses the pooled connection.
-- ---------------------------------------------------------------------------
CREATE FUNCTION app_user_id() RETURNS bigint
LANGUAGE sql STABLE AS $$
    SELECT nullif(current_setting('app.user_id', true), '')::bigint
$$;

-- Reason attached to the next status change (picked up by the history trigger).
CREATE FUNCTION set_status_reason(p_reason text) RETURNS void
LANGUAGE sql VOLATILE AS $$
    SELECT set_config('app.status_reason', coalesce(p_reason, ''), true);
$$;

-- Configuration readers.
CREATE FUNCTION cfg_num(p_key text) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE v numeric;
BEGIN
    SELECT (value #>> '{}')::numeric INTO v FROM app_config WHERE key = p_key;
    IF v IS NULL THEN
        RAISE EXCEPTION 'Missing numeric config key %', p_key USING ERRCODE = 'CF999';
    END IF;
    RETURN v;
END $$;

CREATE FUNCTION cfg_text(p_key text) RETURNS text
LANGUAGE sql STABLE AS $$
    SELECT value #>> '{}' FROM app_config WHERE key = p_key
$$;

-- Normalise brand/model text: lower-case, alphanumerics only.
-- "Apple iPhone-13 " and "apple iphone13" both become "appleiphone13".
CREATE FUNCTION norm_text(p text) RETURNS text
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
    SELECT nullif(regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]', '', 'g'), '')
$$;

-- Audit helper used by functions and by Express (for view events).
CREATE FUNCTION log_audit(p_action text, p_table text, p_target bigint, p_details jsonb DEFAULT '{}'::jsonb)
RETURNS void
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
    INSERT INTO audit_log (actor_id, action, target_table, target_id, details)
    VALUES (app_user_id(), p_action, p_table, p_target, coalesce(p_details, '{}'::jsonb));
$$;

-- Notification helper.
CREATE FUNCTION notify_user(p_user bigint, p_type text, p_title text, p_message text,
                            p_report bigint DEFAULT NULL, p_claim bigint DEFAULT NULL)
RETURNS void
LANGUAGE sql VOLATILE AS $$
    INSERT INTO notifications (user_id, type, title, message, report_id, claim_id)
    VALUES (p_user, p_type, p_title, p_message, p_report, p_claim);
$$;

-- Notify every active admin (claims arriving, appeals).
CREATE FUNCTION notify_admins(p_type text, p_title text, p_message text, p_claim bigint DEFAULT NULL)
RETURNS void
LANGUAGE sql VOLATILE AS $$
    INSERT INTO notifications (user_id, type, title, message, claim_id)
    SELECT user_id, p_type, p_title, p_message, p_claim
    FROM users WHERE role = 'admin' AND is_active;
$$;

-- ---------------------------------------------------------------------------
-- location_proximity(a, b) -> 0..1
--   same place                    1.0
--   pair in location_distance     stored proximity (LEAST/GREATEST lookup)
--   same zone, pair not listed    app_config.zone_default_proximity
--   owner was unsure (NULL)       app_config.unsure_location_proximity
--   otherwise                     0
-- ---------------------------------------------------------------------------
CREATE FUNCTION location_proximity(p_a integer, p_b integer) RETURNS numeric
LANGUAGE plpgsql STABLE AS $$
DECLARE
    v_prox   numeric;
    v_zone_a text;
    v_zone_b text;
BEGIN
    IF p_a IS NULL OR p_b IS NULL THEN
        RETURN cfg_num('unsure_location_proximity');
    END IF;
    IF p_a = p_b THEN
        RETURN 1;
    END IF;

    SELECT proximity INTO v_prox
    FROM location_distance
    WHERE location_a = LEAST(p_a, p_b) AND location_b = GREATEST(p_a, p_b);
    IF FOUND THEN
        RETURN v_prox;
    END IF;

    SELECT zone INTO v_zone_a FROM locations WHERE location_id = p_a;
    SELECT zone INTO v_zone_b FROM locations WHERE location_id = p_b;
    IF v_zone_a = v_zone_b THEN
        RETURN cfg_num('zone_default_proximity');
    END IF;
    RETURN 0;
END $$;

-- ---------------------------------------------------------------------------
-- compute_match_score(report_id, item_id) -> (score 0..100, breakdown jsonb)
--
--   score = SUM(weight_i * factor_i), factor_i in [0,1], weights from app_config.
--
--   Factor          Default weight   Rule
--   category        20   same category 1.0; same category_group
--                        app_config.related_category_factor (0.25); else 0
--   brand_model     20   0.6*brand + 0.4*model on normalised text
--                        (exact 1; trigram similarity above a floor counts
--                         partially; both blank = 0.5 neutral; owner blank = 0)
--   colour          15   same colour 1.0; same colour_family 0.6; unsure 0
--   location        15   location_proximity() (adjacency table + zone decay)
--   time            10   0.5 ^ (hours_between / half_life); found >tolerance
--                        hours BEFORE the loss = 0 (impossible)
--   description     10   pg_trgm similarity(description, public_description),
--                        scaled: least(1, sim / 0.5)
--   features        10   pg_trgm word_similarity(features, visible_marks)
--                        (mean of both directions), scaled: least(1, sim / 0.6)
-- ---------------------------------------------------------------------------
CREATE FUNCTION compute_match_score(p_report_id bigint, p_item_id bigint,
                                    OUT score numeric, OUT breakdown jsonb)
LANGUAGE plpgsql STABLE AS $$
DECLARE
    r   lost_reports%ROWTYPE;
    i   found_items%ROWTYPE;
    v_r_group  text;  v_i_group  text;
    v_r_family text;  v_i_family text;

    w_cat  numeric := cfg_num('weight_category');
    w_bm   numeric := cfg_num('weight_brand_model');
    w_col  numeric := cfg_num('weight_colour');
    w_loc  numeric := cfg_num('weight_location');
    w_time numeric := cfg_num('weight_time');
    w_desc numeric := cfg_num('weight_description');
    w_feat numeric := cfg_num('weight_features');

    f_cat numeric; f_brand numeric; f_model numeric; f_bm numeric;
    f_col numeric; f_loc numeric; f_time numeric; f_desc numeric; f_feat numeric;
    n_cat text; n_bm text; n_col text; n_loc text; n_time text; n_desc text; n_feat text;

    rb text; ib text; rm text; im text;
    v_hours numeric;
    v_sim   numeric;
BEGIN
    SELECT * INTO r FROM lost_reports WHERE report_id = p_report_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Lost report % not found', p_report_id USING ERRCODE = 'CF004';
    END IF;
    SELECT * INTO i FROM found_items WHERE item_id = p_item_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Found item % not found', p_item_id USING ERRCODE = 'CF004';
    END IF;

    -- 1. Category ------------------------------------------------------------
    SELECT category_group INTO v_r_group FROM categories WHERE category_id = r.category_id;
    SELECT category_group INTO v_i_group FROM categories WHERE category_id = i.category_id;
    IF r.category_id = i.category_id THEN
        f_cat := 1;   n_cat := 'Same category';
    ELSIF v_r_group = v_i_group THEN
        f_cat := cfg_num('related_category_factor');
        n_cat := 'Related category (' || v_r_group || ')';
    ELSE
        f_cat := 0;   n_cat := 'Different category group';
    END IF;

    -- 2. Brand / model ---------------------------------------------------------
    rb := norm_text(r.brand); ib := norm_text(i.brand);
    rm := norm_text(r.model); im := norm_text(i.model);

    IF rb IS NULL AND ib IS NULL THEN
        f_brand := 0.5;                             -- both unbranded: neutral
    ELSIF rb IS NULL OR ib IS NULL THEN
        f_brand := 0;
    ELSIF rb = ib THEN
        f_brand := 1;
    ELSE
        v_sim := similarity(rb, ib);
        f_brand := CASE WHEN v_sim >= 0.6 THEN v_sim ELSE 0 END;
    END IF;

    IF rm IS NULL AND im IS NULL THEN
        f_model := f_brand;                         -- no model on either side: follow the brand result
    ELSIF rm IS NULL OR im IS NULL THEN
        f_model := 0;
    ELSIF rm = im THEN
        f_model := 1;
    ELSIF position(rm IN im) > 0 OR position(im IN rm) > 0 THEN
        f_model := 0.8;                             -- "iphone13" vs "iphone13pro"
    ELSE
        v_sim := similarity(rm, im);
        f_model := CASE WHEN v_sim >= 0.4 THEN v_sim ELSE 0 END;
    END IF;

    f_bm := 0.6 * f_brand + 0.4 * f_model;
    n_bm := format('Brand %s, model %s',
                   CASE WHEN f_brand = 1 THEN 'exact' WHEN f_brand = 0.5 AND rb IS NULL THEN 'both blank'
                        WHEN f_brand > 0 THEN 'similar' WHEN rb IS NULL THEN 'not given by owner'
                        ELSE 'different' END,
                   CASE WHEN f_model = 1 THEN 'exact' WHEN f_model = 0.5 AND rm IS NULL THEN 'both blank'
                        WHEN f_model > 0 THEN 'similar' WHEN rm IS NULL THEN 'not given by owner'
                        ELSE 'different' END);

    -- 3. Colour ---------------------------------------------------------------
    IF r.colour_id IS NULL THEN
        f_col := 0; n_col := 'Owner unsure of colour';
    ELSIF r.colour_id = i.colour_id THEN
        f_col := 1; n_col := 'Same colour';
    ELSE
        SELECT colour_family INTO v_r_family FROM colours WHERE colour_id = r.colour_id;
        SELECT colour_family INTO v_i_family FROM colours WHERE colour_id = i.colour_id;
        IF v_r_family = v_i_family THEN
            f_col := 0.6; n_col := 'Same colour family (' || v_r_family || ')';
        ELSE
            f_col := 0;   n_col := 'Different colour';
        END IF;
    END IF;

    -- 4. Location proximity ---------------------------------------------------
    f_loc := location_proximity(r.lost_location_id, i.found_location_id);
    n_loc := CASE WHEN r.lost_location_id IS NULL THEN 'Owner unsure of location'
                  WHEN r.lost_location_id = i.found_location_id THEN 'Same location'
                  WHEN f_loc > 0 THEN 'Nearby location'
                  ELSE 'Far apart' END;

    -- 5. Time proximity (exponential decay) -----------------------------------
    v_hours := extract(epoch FROM (i.found_at - r.lost_at)) / 3600.0;
    IF v_hours < -cfg_num('time_tolerance_hours') THEN
        f_time := 0; n_time := 'Found before the reported loss time';
    ELSE
        f_time := power(0.5::numeric, greatest(v_hours, 0) / cfg_num('time_half_life_hours'));
        n_time := format('Found %s hours after loss', round(greatest(v_hours, 0)));
    END IF;

    -- 6. Description similarity (pg_trgm) ---------------------------------------
    v_sim  := similarity(r.description, i.public_description);
    f_desc := least(1, v_sim / 0.5);
    n_desc := format('Trigram similarity %s', round(v_sim, 2));

    -- 7. Unique features vs admin-recorded VISIBLE marks (never private marks) --
    IF r.features IS NULL OR i.visible_marks IS NULL
       OR btrim(r.features) = '' OR btrim(i.visible_marks) = '' THEN
        f_feat := 0; n_feat := 'No features to compare';
    ELSE
        -- Average of both directions: a short phrase sharing one word with a
        -- long description ("no case" vs "dent on the case hinge") must not score fully.
        v_sim  := (word_similarity(r.features, i.visible_marks)
                 + word_similarity(i.visible_marks, r.features)) / 2;
        f_feat := least(1, v_sim / 0.6);
        n_feat := format('Word similarity %s', round(v_sim, 2));
    END IF;

    score := round(least(100,
                 w_cat * f_cat + w_bm * f_bm + w_col * f_col + w_loc * f_loc
               + w_time * f_time + w_desc * f_desc + w_feat * f_feat), 2);

    breakdown := jsonb_build_object(
        'category',    jsonb_build_object('weight', w_cat,  'factor', round(f_cat, 3),  'points', round(w_cat * f_cat, 2),  'note', n_cat),
        'brand_model', jsonb_build_object('weight', w_bm,   'factor', round(f_bm, 3),   'points', round(w_bm * f_bm, 2),    'note', n_bm),
        'colour',      jsonb_build_object('weight', w_col,  'factor', round(f_col, 3),  'points', round(w_col * f_col, 2),  'note', n_col),
        'location',    jsonb_build_object('weight', w_loc,  'factor', round(f_loc, 3),  'points', round(w_loc * f_loc, 2),  'note', n_loc),
        'time',        jsonb_build_object('weight', w_time, 'factor', round(f_time, 3), 'points', round(w_time * f_time, 2), 'note', n_time),
        'description', jsonb_build_object('weight', w_desc, 'factor', round(f_desc, 3), 'points', round(w_desc * f_desc, 2), 'note', n_desc),
        'features',    jsonb_build_object('weight', w_feat, 'factor', round(f_feat, 3), 'points', round(w_feat * f_feat, 2), 'note', n_feat),
        'total', score
    );
END $$;

-- ---------------------------------------------------------------------------
-- refresh_match_pair: compute one pair and upsert it (score >= store floor) or
-- remove it (below floor AND never claimed). INSERT ... ON CONFLICT prevents
-- duplicate pairs and keeps the student's 'dismissed' flag and notified_at.
-- ---------------------------------------------------------------------------
CREATE FUNCTION refresh_match_pair(p_report_id bigint, p_item_id bigint) RETURNS numeric
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    m record;
BEGIN
    SELECT * INTO m FROM compute_match_score(p_report_id, p_item_id);

    IF m.score >= cfg_num('match_store_floor') THEN
        INSERT INTO potential_matches (report_id, item_id, score, breakdown)
        VALUES (p_report_id, p_item_id, m.score, m.breakdown)
        ON CONFLICT (report_id, item_id) DO UPDATE
            SET score = EXCLUDED.score,
                breakdown = EXCLUDED.breakdown,
                computed_at = now();
    ELSE
        DELETE FROM potential_matches pm
        WHERE pm.report_id = p_report_id AND pm.item_id = p_item_id
          AND NOT EXISTS (SELECT 1 FROM ownership_claims c
                          WHERE c.report_id = pm.report_id AND c.item_id = pm.item_id);
    END IF;
    RETURN m.score;
END $$;

-- ---------------------------------------------------------------------------
-- notify_new_candidates(report): one notification per run for candidates that
-- have just become visible to the student (>= threshold, inside top-N, not
-- dismissed, not yet notified). Visibility is defined by v_candidate_ranking.
-- ---------------------------------------------------------------------------
CREATE FUNCTION notify_new_candidates(p_report_id bigint) RETURNS integer
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_user  bigint;
    v_ref   text;
    v_count integer;
BEGIN
    WITH fresh AS (
        UPDATE potential_matches pm
           SET notified_at = now()
          FROM v_candidate_ranking cr
         WHERE cr.report_id = p_report_id
           AND cr.item_id = pm.item_id AND cr.report_id = pm.report_id
           AND cr.is_visible
           AND pm.notified_at IS NULL
        RETURNING pm.item_id
    )
    SELECT count(*) INTO v_count FROM fresh;

    IF v_count > 0 THEN
        SELECT user_id, reference_code INTO v_user, v_ref FROM lost_reports WHERE report_id = p_report_id;
        PERFORM notify_user(v_user, 'NEW_MATCH',
            CASE WHEN v_count = 1 THEN 'New potential match' ELSE v_count || ' new potential matches' END,
            format('We found %s item(s) at the admin desk that may match your report %s. Review them and tell us if one is yours.',
                   v_count, v_ref),
            p_report_id, NULL);
    END IF;
    RETURN v_count;
END $$;

-- ---------------------------------------------------------------------------
-- run_matching_for_report: new lost report -> all matchable items.
-- Only items in the same category_group are compared (privacy gate: students
-- may only see photos of compatible categories) — this also keeps it cheap via
-- found_items_matchable_idx.
-- ---------------------------------------------------------------------------
CREATE FUNCTION run_matching_for_report(p_report_id bigint) RETURNS integer
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_status text;
    v_group  text;
    v_item   bigint;
BEGIN
    SELECT r.status, c.category_group INTO v_status, v_group
    FROM lost_reports r JOIN categories c ON c.category_id = r.category_id
    WHERE r.report_id = p_report_id;

    IF v_status IS DISTINCT FROM 'ACTIVE' THEN
        RETURN 0;                                   -- only ACTIVE reports are matched
    END IF;

    FOR v_item IN
        SELECT i.item_id
        FROM found_items i JOIN categories c ON c.category_id = i.category_id
        WHERE i.status IN ('IN_CUSTODY', 'CLAIM_PENDING')
          AND c.category_group = v_group
    LOOP
        PERFORM refresh_match_pair(p_report_id, v_item);
    END LOOP;

    RETURN notify_new_candidates(p_report_id);
END $$;

-- ---------------------------------------------------------------------------
-- run_matching_for_item: newly published item -> all ACTIVE reports.
-- ---------------------------------------------------------------------------
CREATE FUNCTION run_matching_for_item(p_item_id bigint) RETURNS integer
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_status text;
    v_group  text;
    v_report bigint;
    v_total  integer := 0;
BEGIN
    SELECT i.status, c.category_group INTO v_status, v_group
    FROM found_items i JOIN categories c ON c.category_id = i.category_id
    WHERE i.item_id = p_item_id;

    IF v_status NOT IN ('IN_CUSTODY', 'CLAIM_PENDING') THEN
        RETURN 0;                                   -- DRAFT / RETURNED / ARCHIVED never matched
    END IF;

    FOR v_report IN
        SELECT r.report_id
        FROM lost_reports r JOIN categories c ON c.category_id = r.category_id
        WHERE r.status = 'ACTIVE' AND c.category_group = v_group
    LOOP
        PERFORM refresh_match_pair(v_report, p_item_id);
        v_total := v_total + notify_new_candidates(v_report);
    END LOOP;

    RETURN v_total;
END $$;

-- Recompute everything (after an admin changes weights in app_config).
CREATE FUNCTION rematch_all() RETURNS integer
LANGUAGE plpgsql VOLATILE AS $$
DECLARE
    v_report bigint;
    v_n integer := 0;
BEGIN
    FOR v_report IN SELECT report_id FROM lost_reports WHERE status = 'ACTIVE' LOOP
        PERFORM run_matching_for_report(v_report);
        v_n := v_n + 1;
    END LOOP;
    PERFORM log_audit('REMATCH_ALL', 'lost_reports', NULL, jsonb_build_object('reports', v_n));
    RETURN v_n;
END $$;
