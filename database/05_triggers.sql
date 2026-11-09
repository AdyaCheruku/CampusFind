-- =============================================================================
-- CampusFind — 05_triggers.sql
-- Trigger functions run as SECURITY DEFINER where they must read tables the
-- invoking application role has no privileges on (e.g. a student's INSERT into
-- lost_reports fires matching, which reads found_items).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- USERS: students must use the configured college email domain (if set).
-- ---------------------------------------------------------------------------
CREATE FUNCTION trg_users_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE v_domain text := lower(btrim(coalesce(cfg_text('allowed_email_domain'), '')));
BEGIN
    NEW.email := lower(btrim(NEW.email));
    IF NEW.role = 'student' AND v_domain <> '' AND NEW.email NOT LIKE '%@' || v_domain THEN
        RAISE EXCEPTION 'Please register with your college email (@%)', v_domain USING ERRCODE = 'CF008';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_users_before_insert
    BEFORE INSERT ON users
    FOR EACH ROW EXECUTE FUNCTION trg_users_before_insert();

-- ---------------------------------------------------------------------------
-- LOST REPORTS — BEFORE INSERT
--   * user_id comes from the session (never from the client);
--   * status is forced to ACTIVE and locked_at to the submission time;
--   * lost_at cannot be in the future or unreasonably old;
--   * enforce the maximum number of open reports per student. The user's row
--     is locked FOR UPDATE first so two concurrent submissions cannot both
--     slip past the limit (race-condition safe).
-- ---------------------------------------------------------------------------
CREATE FUNCTION trg_lost_reports_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    v_role   text;
    v_active boolean;
    v_open   integer;
BEGIN
    NEW.user_id := coalesce(NEW.user_id, app_user_id());
    IF NEW.user_id IS NULL THEN
        RAISE EXCEPTION 'A lost report needs an authenticated student' USING ERRCODE = 'CF006';
    END IF;

    SELECT role, is_active INTO v_role, v_active FROM users WHERE user_id = NEW.user_id FOR UPDATE;
    IF v_role IS DISTINCT FROM 'student' OR NOT v_active THEN
        RAISE EXCEPTION 'Only active students can file lost reports' USING ERRCODE = 'CF006';
    END IF;

    NEW.status := 'ACTIVE';
    NEW.withdrawn_reason := NULL;
    NEW.closed_reason := NULL;
    IF NEW.created_at IS NULL OR NEW.created_at > now() THEN
        NEW.created_at := now();
    END IF;
    NEW.locked_at := NEW.created_at;               -- LOCKED AT THE MOMENT OF SUBMISSION
    NEW.status_changed_at := NEW.created_at;

    IF NEW.lost_at > NEW.created_at + interval '5 minutes' THEN
        RAISE EXCEPTION 'The time you lost the item cannot be in the future' USING ERRCODE = 'CF008';
    END IF;
    IF NEW.lost_at < NEW.created_at - make_interval(days => cfg_num('report_max_age_days')::int) THEN
        RAISE EXCEPTION 'Items lost more than % days ago cannot be reported', cfg_num('report_max_age_days')
            USING ERRCODE = 'CF008';
    END IF;

    SELECT count(*) INTO v_open FROM lost_reports
    WHERE user_id = NEW.user_id AND status IN ('ACTIVE', 'MATCHED');
    IF v_open >= cfg_num('max_active_reports') THEN
        RAISE EXCEPTION 'You already have % open reports (the limit is %). Withdraw one before filing another.',
            v_open, cfg_num('max_active_reports') USING ERRCODE = 'CF002';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_lost_reports_before_insert
    BEFORE INSERT ON lost_reports
    FOR EACH ROW EXECUTE FUNCTION trg_lost_reports_before_insert();

-- ---------------------------------------------------------------------------
-- LOST REPORTS — LOCK. Rejects any change to anything except the status
-- bookkeeping columns. Comparing whole rows as jsonb (minus the allowed keys)
-- means any column added in future is protected automatically.
-- ---------------------------------------------------------------------------
CREATE FUNCTION trg_lost_reports_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
    v_allowed text[] := ARRAY['status', 'status_changed_at', 'withdrawn_reason', 'closed_reason', 'reference_code'];
BEGIN
    IF (to_jsonb(NEW) - v_allowed) IS DISTINCT FROM (to_jsonb(OLD) - v_allowed) THEN
        RAISE EXCEPTION 'Lost report % is locked: its details cannot be changed after submission. Withdraw it and file a new report instead.',
            OLD.reference_code USING ERRCODE = 'CF001';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_lost_reports_lock
    BEFORE UPDATE ON lost_reports
    FOR EACH ROW EXECUTE FUNCTION trg_lost_reports_lock();

CREATE FUNCTION trg_forbid_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% rows can never be deleted (audit trail)', TG_TABLE_NAME USING ERRCODE = 'CF005';
END $$;

CREATE TRIGGER trg_lost_reports_no_delete
    BEFORE DELETE ON lost_reports
    FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();

-- AFTER INSERT: match the new report against every item in custody.
CREATE FUNCTION trg_lost_reports_after_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
BEGIN
    PERFORM run_matching_for_report(NEW.report_id);
    PERFORM log_audit('REPORT_SUBMIT', 'lost_reports', NEW.report_id,
                      jsonb_build_object('reference', NEW.reference_code));
    RETURN NULL;
END $$;

CREATE TRIGGER trg_lost_reports_after_insert
    AFTER INSERT ON lost_reports
    FOR EACH ROW EXECUTE FUNCTION trg_lost_reports_after_insert();

-- ---------------------------------------------------------------------------
-- FOUND ITEMS
-- ---------------------------------------------------------------------------
-- Every new item starts as a DRAFT created by the acting admin.
CREATE FUNCTION trg_found_items_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
BEGIN
    NEW.status := 'DRAFT';
    NEW.published_at := NULL;
    NEW.published_by := NULL;
    NEW.created_by_admin := coalesce(app_user_id(), NEW.created_by_admin);
    IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = NEW.created_by_admin AND role = 'admin' AND is_active) THEN
        RAISE EXCEPTION 'Only an admin can register found items' USING ERRCODE = 'CF006';
    END IF;
    IF NEW.found_at > now() + interval '5 minutes' THEN
        RAISE EXCEPTION 'Found time cannot be in the future' USING ERRCODE = 'CF008';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_found_items_before_insert
    BEFORE INSERT ON found_items
    FOR EACH ROW EXECUTE FUNCTION trg_found_items_before_insert();

CREATE FUNCTION trg_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    RETURN NEW;
END $$;

CREATE TRIGGER trg_found_items_touch
    BEFORE UPDATE ON found_items
    FOR EACH ROW EXECUTE FUNCTION trg_touch_updated_at();

CREATE FUNCTION trg_found_item_private_touch() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at := now();
    NEW.updated_by := coalesce(app_user_id(), NEW.updated_by);
    RETURN NEW;
END $$;

CREATE TRIGGER trg_found_item_private_touch
    BEFORE INSERT OR UPDATE ON found_item_private
    FOR EACH ROW EXECUTE FUNCTION trg_found_item_private_touch();

-- Publishing (DRAFT -> IN_CUSTODY) or restoring (ARCHIVED -> IN_CUSTODY)
-- runs matching against every ACTIVE report and notifies likely owners.
CREATE FUNCTION trg_found_items_matching() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
BEGIN
    PERFORM run_matching_for_item(NEW.item_id);
    RETURN NULL;
END $$;

CREATE TRIGGER trg_found_items_matching
    AFTER UPDATE OF status ON found_items
    FOR EACH ROW
    WHEN (NEW.status = 'IN_CUSTODY' AND OLD.status IN ('DRAFT', 'ARCHIVED'))
    EXECUTE FUNCTION trg_found_items_matching();

-- An admin correcting a matching field on a published item refreshes scores.
CREATE TRIGGER trg_found_items_rematch_on_edit
    AFTER UPDATE OF category_id, brand, model, colour_id, visible_marks,
                    public_description, found_location_id, found_at ON found_items
    FOR EACH ROW
    WHEN (NEW.status IN ('IN_CUSTODY', 'CLAIM_PENDING') AND OLD.status = NEW.status)
    EXECUTE FUNCTION trg_found_items_matching();

-- Published items are permanent records.
CREATE FUNCTION trg_found_items_delete_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Item % has been published and cannot be deleted', OLD.reference_code USING ERRCODE = 'CF005';
    END IF;
    RETURN OLD;
END $$;

CREATE TRIGGER trg_found_items_delete_guard
    BEFORE DELETE ON found_items
    FOR EACH ROW EXECUTE FUNCTION trg_found_items_delete_guard();

-- Photos of a published item cannot be removed (only added).
CREATE FUNCTION trg_item_photos_delete_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE v_status text;
BEGIN
    SELECT status INTO v_status FROM found_items WHERE item_id = OLD.item_id;
    IF v_status IS NOT NULL AND v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Photos of a published item cannot be deleted' USING ERRCODE = 'CF005';
    END IF;
    RETURN OLD;
END $$;

CREATE TRIGGER trg_item_photos_delete_guard
    BEFORE DELETE ON item_photos
    FOR EACH ROW EXECUTE FUNCTION trg_item_photos_delete_guard();

-- Verification questions are frozen once anyone has claimed the item, so every
-- claimant answers exactly the same questions.
CREATE FUNCTION trg_questions_freeze() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE v_item bigint := CASE WHEN TG_OP = 'INSERT' THEN NEW.item_id ELSE OLD.item_id END;
BEGIN
    IF EXISTS (SELECT 1 FROM ownership_claims WHERE item_id = v_item) THEN
        RAISE EXCEPTION 'Verification questions cannot change once the item has been claimed' USING ERRCODE = 'CF005';
    END IF;
    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_questions_freeze
    BEFORE INSERT OR UPDATE OR DELETE ON verification_questions
    FOR EACH ROW EXECUTE FUNCTION trg_questions_freeze();

-- ---------------------------------------------------------------------------
-- STATUS TRANSITIONS (generic). TG_ARGV[0] names the entity in
-- status_transitions. Any move not listed there is rejected.
-- ---------------------------------------------------------------------------
CREATE FUNCTION trg_check_status_transition() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
BEGIN
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        IF NOT EXISTS (SELECT 1 FROM status_transitions
                       WHERE entity = TG_ARGV[0] AND from_status = OLD.status AND to_status = NEW.status) THEN
            RAISE EXCEPTION 'Invalid % status change: % -> %', lower(TG_ARGV[0]), OLD.status, NEW.status
                USING ERRCODE = 'CF003';
        END IF;
        NEW.status_changed_at := now();
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_found_items_transition
    BEFORE UPDATE OF status ON found_items
    FOR EACH ROW EXECUTE FUNCTION trg_check_status_transition('FOUND_ITEM');
CREATE TRIGGER trg_lost_reports_transition
    BEFORE UPDATE OF status ON lost_reports
    FOR EACH ROW EXECUTE FUNCTION trg_check_status_transition('LOST_REPORT');
CREATE TRIGGER trg_claims_transition
    BEFORE UPDATE OF status ON ownership_claims
    FOR EACH ROW EXECUTE FUNCTION trg_check_status_transition('CLAIM');

-- ---------------------------------------------------------------------------
-- STATUS HISTORY (generic). Writes to the history table for TG_TABLE_NAME on
-- insert and on every status change. changed_by comes from the session;
-- the reason comes from set_status_reason() called by the workflow function.
-- ---------------------------------------------------------------------------
CREATE FUNCTION trg_status_history() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    v_old    text;
    v_reason text := nullif(current_setting('app.status_reason', true), '');
    v_actor  bigint := app_user_id();
BEGIN
    IF TG_OP = 'UPDATE' THEN
        IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
            RETURN NULL;
        END IF;
        v_old := OLD.status;
    END IF;

    CASE TG_TABLE_NAME
        WHEN 'ownership_claims' THEN
            INSERT INTO claim_status_history (claim_id, old_status, new_status, changed_by, reason)
            VALUES (NEW.claim_id, v_old, NEW.status, v_actor, v_reason);
        WHEN 'found_items' THEN
            INSERT INTO item_status_history (item_id, old_status, new_status, changed_by, reason)
            VALUES (NEW.item_id, v_old, NEW.status, v_actor, v_reason);
        WHEN 'lost_reports' THEN
            INSERT INTO report_status_history (report_id, old_status, new_status, changed_by, reason)
            VALUES (NEW.report_id, v_old, NEW.status, v_actor,
                    coalesce(v_reason, CASE WHEN TG_OP = 'INSERT' THEN 'Report submitted and locked' END));
    END CASE;
    RETURN NULL;
END $$;

CREATE TRIGGER trg_claims_history
    AFTER INSERT OR UPDATE OF status ON ownership_claims
    FOR EACH ROW EXECUTE FUNCTION trg_status_history();
CREATE TRIGGER trg_found_items_history
    AFTER INSERT OR UPDATE OF status ON found_items
    FOR EACH ROW EXECUTE FUNCTION trg_status_history();
CREATE TRIGGER trg_lost_reports_history
    AFTER INSERT OR UPDATE OF status ON lost_reports
    FOR EACH ROW EXECUTE FUNCTION trg_status_history();

-- ---------------------------------------------------------------------------
-- CLAIMS — BEFORE INSERT guard
--   * new claims start PENDING or QUEUED only;
--   * the same report cannot claim the same item twice — except one appeal of
--     a rejected ORIGINAL claim (appeals cannot themselves be appealed).
-- ---------------------------------------------------------------------------
CREATE FUNCTION trg_claims_before_insert() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE o ownership_claims%ROWTYPE;
BEGIN
    IF NEW.status NOT IN ('PENDING', 'QUEUED') THEN
        RAISE EXCEPTION 'A new claim must start as PENDING or QUEUED' USING ERRCODE = 'CF003';
    END IF;
    NEW.decided_by := NULL; NEW.decision_reason := NULL; NEW.decided_at := NULL;

    IF NEW.appeal_of_claim_id IS NULL THEN
        IF EXISTS (SELECT 1 FROM ownership_claims
                   WHERE report_id = NEW.report_id AND item_id = NEW.item_id) THEN
            RAISE EXCEPTION 'You have already claimed this item for this report. A rejected claim can be appealed once from the claim page.'
                USING ERRCODE = 'CF005';
        END IF;
    ELSE
        SELECT * INTO o FROM ownership_claims WHERE claim_id = NEW.appeal_of_claim_id;
        IF NOT FOUND OR o.report_id <> NEW.report_id OR o.item_id <> NEW.item_id
           OR o.status <> 'REJECTED' OR o.appeal_of_claim_id IS NOT NULL THEN
            RAISE EXCEPTION 'Only a rejected original claim can be appealed, and only once' USING ERRCODE = 'CF005';
        END IF;
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_claims_before_insert
    BEFORE INSERT ON ownership_claims
    FOR EACH ROW EXECUTE FUNCTION trg_claims_before_insert();

CREATE TRIGGER trg_claims_no_delete
    BEFORE DELETE ON ownership_claims
    FOR EACH ROW EXECUTE FUNCTION trg_forbid_delete();

-- A response must answer a question that belongs to the claimed item.
CREATE FUNCTION trg_claim_responses_check() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM ownership_claims c
                   JOIN verification_questions q ON q.item_id = c.item_id
                   WHERE c.claim_id = NEW.claim_id AND q.question_id = NEW.question_id) THEN
        RAISE EXCEPTION 'Question % does not belong to the claimed item', NEW.question_id USING ERRCODE = 'CF008';
    END IF;
    RETURN NEW;
END $$;

CREATE TRIGGER trg_claim_responses_check
    BEFORE INSERT OR UPDATE ON claim_responses
    FOR EACH ROW EXECUTE FUNCTION trg_claim_responses_check();

-- ---------------------------------------------------------------------------
-- CONFIG: the seven matching weights must always sum to 100. A DEFERRED
-- constraint trigger checks at COMMIT, so several weights can be changed in one
-- transaction (e.g. 20->25 and 15->10) without failing half-way.
-- ---------------------------------------------------------------------------
CREATE FUNCTION trg_app_config_weights_check() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_sum numeric;
BEGIN
    SELECT sum((value #>> '{}')::numeric) INTO v_sum FROM app_config WHERE key LIKE 'weight\_%';
    IF v_sum IS NOT NULL AND v_sum <> 100 THEN
        RAISE EXCEPTION 'Matching weights must sum to 100 (currently %)', v_sum USING ERRCODE = 'CF008';
    END IF;
    RETURN NULL;
END $$;

CREATE CONSTRAINT TRIGGER trg_app_config_weights_check
    AFTER INSERT OR UPDATE ON app_config
    DEFERRABLE INITIALLY DEFERRED
    FOR EACH ROW EXECUTE FUNCTION trg_app_config_weights_check();

-- ---------------------------------------------------------------------------
-- APPEND-ONLY audit and history tables.
-- (item_status_history allows DELETE only through the ON DELETE CASCADE of a
--  deleted DRAFT item; no role has a DELETE grant on it.)
-- ---------------------------------------------------------------------------
CREATE FUNCTION trg_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'CF005';
END $$;

CREATE TRIGGER trg_audit_log_append_only
    BEFORE UPDATE OR DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER trg_claim_history_append_only
    BEFORE UPDATE OR DELETE ON claim_status_history
    FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER trg_report_history_append_only
    BEFORE UPDATE OR DELETE ON report_status_history
    FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER trg_item_history_append_only
    BEFORE UPDATE ON item_status_history
    FOR EACH ROW EXECUTE FUNCTION trg_append_only();
CREATE TRIGGER trg_handovers_append_only
    BEFORE UPDATE OR DELETE ON handovers
    FOR EACH ROW EXECUTE FUNCTION trg_append_only();
