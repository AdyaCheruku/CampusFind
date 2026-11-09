-- =============================================================================
-- CampusFind — 07_security.sql
-- Least-privilege database roles + row-level security.
--
--   campusfind_owner  NOLOGIN. Owns every object. SECURITY DEFINER functions
--                     and views run with its rights.
--   student_app       LOGIN. Used by Express for student requests.
--   admin_app         LOGIN. Used by Express for admin requests.
--
-- student_app can NOT read found_items, found_item_private, finder_statements,
-- verification_questions (expected answers), item_photos (original paths),
-- users, audit_log or any other student's rows. It reads through v_student_*
-- views and acts through SECURITY DEFINER functions only.
-- (Roles themselves are created by server/scripts/dbSetup.js because their
--  passwords come from .env.)
-- =============================================================================

-- Session-derived defaults: the acting admin is taken from the session, so the
-- column is not even grantable to the application.
ALTER TABLE item_photos            ALTER COLUMN uploaded_by SET DEFAULT app_user_id();
ALTER TABLE finder_statements      ALTER COLUMN recorded_by SET DEFAULT app_user_id();
ALTER TABLE verification_questions ALTER COLUMN created_by  SET DEFAULT app_user_id();

-- ---------------------------------------------------------------------------
-- Baseline: nothing for PUBLIC.
-- ---------------------------------------------------------------------------
REVOKE ALL ON SCHEMA campusfind FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA campusfind FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA campusfind FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA campusfind REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

GRANT USAGE ON SCHEMA campusfind TO student_app, admin_app;

-- Helpers used inside views are executed with the caller's rights, so both
-- roles need EXECUTE on them. cfg_* are SECURITY DEFINER (app_config is read
-- through them).
ALTER FUNCTION cfg_num(text)  SECURITY DEFINER SET search_path = campusfind, public, pg_temp;
ALTER FUNCTION cfg_text(text) SECURITY DEFINER SET search_path = campusfind, public, pg_temp;
GRANT EXECUTE ON FUNCTION app_user_id(), cfg_num(text), cfg_text(text) TO student_app, admin_app;

-- Shared auth functions.
GRANT EXECUTE ON FUNCTION
    register_student(text, text, text, text),
    auth_lookup(text),
    record_login(),
    session_user_info(),
    update_my_name(text)
TO student_app;
GRANT EXECUTE ON FUNCTION record_login(), session_user_info(), log_audit(text, text, bigint, jsonb)
TO admin_app;

-- ===========================================================================
-- student_app
-- ===========================================================================
GRANT SELECT ON categories, colours, locations TO student_app;

-- Filing a report: a direct INSERT limited to the identifying columns.
-- user_id, status, locked_at and created_at are NOT grantable — the trigger
-- fills them from the session. No UPDATE or DELETE grant at all.
GRANT SELECT ON lost_reports TO student_app;
GRANT INSERT (category_id, brand, model, colour_id, description, features, serial_hint,
              lost_location_id, lost_location_detail, lost_at, proof_photo_path)
    ON lost_reports TO student_app;

GRANT SELECT ON notifications TO student_app;
GRANT UPDATE (is_read, read_at) ON notifications TO student_app;

GRANT SELECT ON v_student_candidates, v_student_reports, v_student_report_history,
                v_student_claims, v_student_claim_responses, v_student_claim_evidence,
                v_student_claim_history, v_student_dashboard
TO student_app;

GRANT EXECUTE ON FUNCTION
    withdraw_report(bigint, text),
    dismiss_candidate(bigint, bigint),
    reject_all_candidates(bigint),
    get_candidate_questions(bigint, bigint),
    submit_claim(bigint, bigint, jsonb),
    appeal_claim(bigint, text),
    add_claim_evidence(bigint, text, text, text, text),
    authorize_blurred_photo(bigint),
    authorize_own_evidence(bigint)
TO student_app;

-- ===========================================================================
-- admin_app
-- ===========================================================================
-- Read everything EXCEPT users.password_hash (column-level SELECT).
GRANT SELECT ON ALL TABLES IN SCHEMA campusfind TO admin_app;   -- includes views
REVOKE SELECT ON users FROM admin_app;
GRANT SELECT (user_id, full_name, email, roll_no, role, is_active, created_at, last_login_at)
    ON users TO admin_app;

-- Intake. status / published_* / created_by_admin are NOT grantable:
-- status changes only through workflow functions (publish, approve, handover...).
GRANT INSERT (category_id, brand, model, colour_id, size_desc, contents, visible_marks,
              public_description, found_location_id, found_location_detail, found_at, storage_location)
    ON found_items TO admin_app;
GRANT UPDATE (category_id, brand, model, colour_id, size_desc, contents, visible_marks,
              public_description, found_location_id, found_location_detail, found_at, storage_location)
    ON found_items TO admin_app;

GRANT INSERT (item_id, serial_no, hidden_marks, private_notes) ON found_item_private TO admin_app;
GRANT UPDATE (serial_no, hidden_marks, private_notes)          ON found_item_private TO admin_app;

GRANT INSERT (item_id, original_path, blurred_path, mime_type, size_bytes, is_primary) ON item_photos TO admin_app;
GRANT UPDATE (is_primary) ON item_photos TO admin_app;
GRANT DELETE ON item_photos TO admin_app;                       -- guarded: drafts only

GRANT INSERT (item_id, finder_name, finder_contact, finder_roll_no, found_where, found_when, circumstances)
    ON finder_statements TO admin_app;

GRANT INSERT (item_id, question_text, expected_answer) ON verification_questions TO admin_app;
GRANT UPDATE (question_text, expected_answer)          ON verification_questions TO admin_app;
GRANT DELETE ON verification_questions TO admin_app;            -- guarded: before any claim

GRANT UPDATE (is_read, read_at) ON notifications TO admin_app;

-- No INSERT/UPDATE/DELETE on: lost_reports, potential_matches, ownership_claims,
-- claim_responses, claim_evidence, handovers, *_status_history, audit_log.
-- Those change only through the functions below.
GRANT EXECUTE ON FUNCTION
    publish_found_item(bigint, bigint),
    delete_draft_item(bigint, bigint),
    approve_claim(bigint, bigint, text, text, timestamptz),
    reject_claim(bigint, bigint, text),
    record_handover(bigint, bigint, text, boolean, text),
    close_report(bigint, bigint, text),
    archive_item(bigint, bigint, text),
    restore_item(bigint, bigint),
    archive_stale_records(bigint),
    set_user_active(bigint, bigint, boolean),
    admin_rematch_all(bigint),
    update_config(text, jsonb, bigint),
    compute_verification_indicator(bigint),
    compute_match_score(bigint, bigint),
    location_proximity(integer, integer),
    norm_text(text)
TO admin_app;

-- ===========================================================================
-- ROW-LEVEL SECURITY
-- Defence in depth: even if an Express route forgot "WHERE user_id = ...",
-- a student connection can only ever see/insert its own rows.
-- (campusfind_owner owns the tables and is not subject to these policies,
--  which is why SECURITY DEFINER functions and views still work.)
-- ===========================================================================
ALTER TABLE lost_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY lost_reports_student_select ON lost_reports
    FOR SELECT TO student_app USING (user_id = app_user_id());
CREATE POLICY lost_reports_student_insert ON lost_reports
    FOR INSERT TO student_app WITH CHECK (user_id = app_user_id());
CREATE POLICY lost_reports_admin_select ON lost_reports
    FOR SELECT TO admin_app USING (true);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY notifications_own_select ON notifications
    FOR SELECT TO student_app, admin_app USING (user_id = app_user_id());
CREATE POLICY notifications_own_update ON notifications
    FOR UPDATE TO student_app, admin_app
    USING (user_id = app_user_id()) WITH CHECK (user_id = app_user_id());
