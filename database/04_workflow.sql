-- =============================================================================
-- CampusFind — 04_workflow.sql
-- Business operations as stored functions. Express only calls these; it never
-- decides statuses or ownership itself.
--
-- Every student/admin entry point is SECURITY DEFINER (runs as campusfind_owner)
-- with a pinned search_path, and derives the acting user from app_user_id()
-- (set by Express from the verified JWT) — never from a client-supplied value.
--
-- Transactions: a PL/pgSQL function always runs inside the caller's
-- transaction. Any RAISE rolls back EVERY change the function (and the
-- triggers it fired) made. That is what makes approve_claim / reject_claim /
-- record_handover atomic.
--
-- Custom SQLSTATEs (mapped to HTTP codes by Express):
--   CF001 report locked          (409)    CF005 invalid state       (409)
--   CF002 active report limit    (422)    CF006 forbidden           (403)
--   CF003 bad status transition  (409)    CF007 rate limit          (429)
--   CF004 not found / not yours  (404)    CF008 validation          (422)
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Guards
-- ---------------------------------------------------------------------------
CREATE FUNCTION assert_acting_admin(p_admin_id bigint) RETURNS void
LANGUAGE plpgsql STABLE AS $$
BEGIN
    IF p_admin_id IS NULL OR app_user_id() IS DISTINCT FROM p_admin_id THEN
        RAISE EXCEPTION 'Acting admin does not match the authenticated session' USING ERRCODE = 'CF006';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = p_admin_id AND role = 'admin' AND is_active) THEN
        RAISE EXCEPTION 'Only an active admin can perform this action' USING ERRCODE = 'CF006';
    END IF;
END $$;

CREATE FUNCTION current_student_id() RETURNS bigint
LANGUAGE plpgsql STABLE AS $$
DECLARE v_id bigint := app_user_id();
BEGIN
    IF v_id IS NULL OR NOT EXISTS (SELECT 1 FROM users WHERE user_id = v_id AND role = 'student' AND is_active) THEN
        RAISE EXCEPTION 'An active student session is required' USING ERRCODE = 'CF006';
    END IF;
    RETURN v_id;
END $$;

CREATE FUNCTION check_claim_rate_limit(p_user bigint) RETURNS void
LANGUAGE plpgsql STABLE AS $$
DECLARE v_n integer;
BEGIN
    SELECT count(*) INTO v_n
    FROM ownership_claims c JOIN lost_reports r ON r.report_id = c.report_id
    WHERE r.user_id = p_user AND c.created_at > now() - interval '24 hours';
    IF v_n >= cfg_num('max_claims_per_day') THEN
        RAISE EXCEPTION 'You can submit at most % claims in 24 hours', cfg_num('max_claims_per_day')
            USING ERRCODE = 'CF007';
    END IF;
END $$;

-- =============================================================================
-- AUTH (called through the student_app pool before a session exists)
-- =============================================================================
CREATE FUNCTION register_student(p_full_name text, p_email text, p_roll_no text, p_password_hash text)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE v_id bigint;
BEGIN
    -- Role is hard-coded: nobody can self-register as an admin.
    INSERT INTO users (full_name, email, roll_no, password_hash, role)
    VALUES (btrim(p_full_name), lower(btrim(p_email)), upper(btrim(p_roll_no)), p_password_hash, 'student')
    RETURNING user_id INTO v_id;
    RETURN v_id;
END $$;

CREATE FUNCTION auth_lookup(p_email text)
RETURNS TABLE (user_id bigint, full_name text, email text, roll_no text, role text,
               password_hash text, is_active boolean)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
    SELECT u.user_id, u.full_name, u.email, u.roll_no, u.role, u.password_hash, u.is_active
    FROM users u WHERE lower(u.email) = lower(btrim(p_email))
$$;

-- Called after the password has been verified and app.user_id set.
CREATE FUNCTION record_login() RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
BEGIN
    UPDATE users SET last_login_at = now() WHERE user_id = app_user_id();
    PERFORM log_audit('LOGIN', 'users', app_user_id());
END $$;

CREATE FUNCTION session_user_info()
RETURNS TABLE (user_id bigint, full_name text, email text, roll_no text, role text, is_active boolean,
               created_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
    SELECT u.user_id, u.full_name, u.email, u.roll_no, u.role, u.is_active, u.created_at
    FROM users u WHERE u.user_id = app_user_id()
$$;

CREATE FUNCTION update_my_name(p_full_name text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
BEGIN
    UPDATE users SET full_name = btrim(p_full_name) WHERE user_id = app_user_id();
END $$;

-- =============================================================================
-- STUDENT OPERATIONS
-- (Filing a report is a direct INSERT by student_app — column-level grants +
--  RLS + triggers enforce the rules; see 05_triggers.sql and 07_security.sql.)
-- =============================================================================

-- Withdraw a report (the only way to "fix" a mistake: withdraw and re-file).
CREATE FUNCTION withdraw_report(p_report_id bigint, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    v_user bigint := current_student_id();
    r lost_reports%ROWTYPE;
BEGIN
    SELECT * INTO r FROM lost_reports WHERE report_id = p_report_id FOR UPDATE;
    IF NOT FOUND OR r.user_id <> v_user THEN
        RAISE EXCEPTION 'Report not found' USING ERRCODE = 'CF004';
    END IF;
    IF r.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Only an active report without an open claim can be withdrawn' USING ERRCODE = 'CF005';
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'Please give a reason (at least 5 characters)' USING ERRCODE = 'CF008';
    END IF;

    PERFORM set_status_reason(p_reason);
    UPDATE lost_reports SET status = 'WITHDRAWN', withdrawn_reason = btrim(p_reason)
    WHERE report_id = p_report_id;
    PERFORM set_status_reason(NULL);
    PERFORM log_audit('REPORT_WITHDRAW', 'lost_reports', p_report_id, jsonb_build_object('reason', p_reason));
END $$;

-- Dismiss one candidate. Dismissed candidates still occupy their top-N slot
-- (see v_candidate_ranking) so dismissing cannot be used to browse more items.
CREATE FUNCTION dismiss_candidate(p_report_id bigint, p_item_id bigint) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE v_user bigint := current_student_id();
BEGIN
    IF NOT EXISTS (SELECT 1 FROM v_candidate_ranking
                   WHERE report_id = p_report_id AND item_id = p_item_id
                     AND user_id = v_user AND is_visible) THEN
        RAISE EXCEPTION 'Candidate not found' USING ERRCODE = 'CF004';
    END IF;
    UPDATE potential_matches SET dismissed = true, dismissed_at = now()
    WHERE report_id = p_report_id AND item_id = p_item_id;
    PERFORM log_audit('CANDIDATE_DISMISS', 'potential_matches', p_report_id, jsonb_build_object('item_id', p_item_id));
END $$;

-- "None of these are mine": dismiss every currently visible candidate.
-- The report stays ACTIVE and will be re-matched when new items are published.
CREATE FUNCTION reject_all_candidates(p_report_id bigint) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    v_user bigint := current_student_id();
    v_n integer;
BEGIN
    IF NOT EXISTS (SELECT 1 FROM lost_reports WHERE report_id = p_report_id AND user_id = v_user) THEN
        RAISE EXCEPTION 'Report not found' USING ERRCODE = 'CF004';
    END IF;
    WITH d AS (
        UPDATE potential_matches pm SET dismissed = true, dismissed_at = now()
        FROM v_candidate_ranking cr
        WHERE cr.report_id = p_report_id AND cr.user_id = v_user AND cr.is_visible
          AND pm.report_id = cr.report_id AND pm.item_id = cr.item_id
        RETURNING pm.item_id
    ) SELECT count(*) INTO v_n FROM d;
    PERFORM log_audit('CANDIDATES_NONE', 'lost_reports', p_report_id, jsonb_build_object('dismissed', v_n));
    RETURN v_n;
END $$;

-- Verification questions for a candidate (text only — never expected answers).
CREATE FUNCTION get_candidate_questions(p_report_id bigint, p_item_id bigint)
RETURNS TABLE (question_id bigint, question_text text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE v_user bigint := current_student_id();
BEGIN
    IF NOT EXISTS (SELECT 1 FROM v_candidate_ranking cr
                   WHERE cr.report_id = p_report_id AND cr.item_id = p_item_id
                     AND cr.user_id = v_user AND cr.is_visible) THEN
        RAISE EXCEPTION 'Candidate not found' USING ERRCODE = 'CF004';
    END IF;
    RETURN QUERY
        SELECT q.question_id, q.question_text FROM verification_questions q
        WHERE q.item_id = p_item_id ORDER BY q.question_id;
END $$;

-- ---------------------------------------------------------------------------
-- submit_claim: "This is mine".
-- Locks the found_items row FOR UPDATE so two simultaneous claims on the same
-- item serialise: the first becomes PENDING, the second sees it and becomes
-- QUEUED (FIFO). The partial unique index is the final safety net.
-- p_answers: {"<question_id>": "<answer>", ...}
-- ---------------------------------------------------------------------------
CREATE FUNCTION submit_claim(p_report_id bigint, p_item_id bigint, p_answers jsonb DEFAULT '{}'::jsonb)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    v_user   bigint := current_student_id();
    r        lost_reports%ROWTYPE;
    i        found_items%ROWTYPE;
    v_score  numeric;
    v_status text;
    v_claim  bigint;
    v_ref    text;
    q        record;
    v_answer text;
BEGIN
    SELECT * INTO r FROM lost_reports WHERE report_id = p_report_id FOR UPDATE;
    IF NOT FOUND OR r.user_id <> v_user THEN
        RAISE EXCEPTION 'Report not found' USING ERRCODE = 'CF004';
    END IF;
    IF r.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'This report already has an open claim or is no longer active' USING ERRCODE = 'CF005';
    END IF;

    PERFORM check_claim_rate_limit(v_user);

    SELECT * INTO i FROM found_items WHERE item_id = p_item_id FOR UPDATE;   -- row lock
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not found' USING ERRCODE = 'CF004';
    END IF;

    SELECT cr.score INTO v_score FROM v_candidate_ranking cr
    WHERE cr.report_id = p_report_id AND cr.item_id = p_item_id AND cr.is_visible;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'This item is not one of your current candidates' USING ERRCODE = 'CF005';
    END IF;

    -- Every admin-configured verification question must be answered.
    FOR q IN SELECT question_id FROM verification_questions WHERE item_id = p_item_id LOOP
        v_answer := btrim(coalesce(p_answers ->> q.question_id::text, ''));
        IF v_answer = '' THEN
            RAISE EXCEPTION 'Please answer every verification question' USING ERRCODE = 'CF008';
        END IF;
    END LOOP;

    IF EXISTS (SELECT 1 FROM ownership_claims
               WHERE item_id = p_item_id AND status IN ('PENDING', 'APPROVED')) THEN
        v_status := 'QUEUED';
    ELSE
        v_status := 'PENDING';
    END IF;

    INSERT INTO ownership_claims (report_id, item_id, status, match_score_at_claim)
    VALUES (p_report_id, p_item_id, v_status, v_score)
    RETURNING claim_id, reference_code INTO v_claim, v_ref;

    INSERT INTO claim_responses (claim_id, question_id, answer_text)
    SELECT v_claim, q2.question_id, btrim(p_answers ->> q2.question_id::text)
    FROM verification_questions q2 WHERE q2.item_id = p_item_id;

    PERFORM set_status_reason('Claim ' || v_ref || ' submitted');
    UPDATE lost_reports SET status = 'MATCHED' WHERE report_id = p_report_id;
    IF i.status = 'IN_CUSTODY' THEN
        UPDATE found_items SET status = 'CLAIM_PENDING' WHERE item_id = p_item_id;
    END IF;
    PERFORM set_status_reason(NULL);

    PERFORM notify_admins('CLAIM_SUBMITTED', 'New ownership claim ' || v_ref,
        format('Claim %s for item %s (report %s) is %s.', v_ref, i.reference_code, r.reference_code,
               lower(v_status)), v_claim);
    IF v_status = 'QUEUED' THEN
        PERFORM notify_user(v_user, 'CLAIM_QUEUED', 'Claim queued',
            format('Another claim on this item is being reviewed. Your claim %s is queued and will be reviewed next if that claim is rejected.', v_ref),
            p_report_id, v_claim);
    END IF;
    PERFORM log_audit('CLAIM_SUBMIT', 'ownership_claims', v_claim,
        jsonb_build_object('report_id', p_report_id, 'item_id', p_item_id, 'status', v_status, 'score', v_score));
    RETURN v_claim;
END $$;

-- One appeal per rejected claim: a new linked claim with the same locked
-- report and the same original answers (answers cannot be changed).
CREATE FUNCTION appeal_claim(p_claim_id bigint, p_statement text) RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    v_user   bigint := current_student_id();
    o        ownership_claims%ROWTYPE;
    r        lost_reports%ROWTYPE;
    i        found_items%ROWTYPE;
    v_score  numeric;
    v_status text;
    v_claim  bigint;
    v_ref    text;
BEGIN
    SELECT * INTO o FROM ownership_claims WHERE claim_id = p_claim_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim not found' USING ERRCODE = 'CF004';
    END IF;
    SELECT * INTO r FROM lost_reports WHERE report_id = o.report_id FOR UPDATE;
    IF r.user_id <> v_user THEN
        RAISE EXCEPTION 'Claim not found' USING ERRCODE = 'CF004';
    END IF;
    IF o.status <> 'REJECTED' OR o.appeal_of_claim_id IS NOT NULL THEN
        RAISE EXCEPTION 'Only a rejected original claim can be appealed' USING ERRCODE = 'CF005';
    END IF;
    IF EXISTS (SELECT 1 FROM ownership_claims WHERE appeal_of_claim_id = p_claim_id) THEN
        RAISE EXCEPTION 'This claim has already been appealed' USING ERRCODE = 'CF005';
    END IF;
    IF r.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'The report must be active (no other open claim) to appeal' USING ERRCODE = 'CF005';
    END IF;
    IF p_statement IS NULL OR char_length(btrim(p_statement)) < 10 THEN
        RAISE EXCEPTION 'Please explain your appeal (at least 10 characters)' USING ERRCODE = 'CF008';
    END IF;

    PERFORM check_claim_rate_limit(v_user);

    SELECT * INTO i FROM found_items WHERE item_id = o.item_id FOR UPDATE;
    IF i.status NOT IN ('IN_CUSTODY', 'CLAIM_PENDING') THEN
        RAISE EXCEPTION 'This item is no longer available' USING ERRCODE = 'CF005';
    END IF;

    SELECT score INTO v_score FROM potential_matches WHERE report_id = o.report_id AND item_id = o.item_id;
    v_status := CASE WHEN EXISTS (SELECT 1 FROM ownership_claims
                                  WHERE item_id = o.item_id AND status IN ('PENDING', 'APPROVED'))
                     THEN 'QUEUED' ELSE 'PENDING' END;

    INSERT INTO ownership_claims (report_id, item_id, status, match_score_at_claim,
                                  appeal_of_claim_id, appeal_statement)
    VALUES (o.report_id, o.item_id, v_status, coalesce(v_score, o.match_score_at_claim),
            p_claim_id, btrim(p_statement))
    RETURNING claim_id, reference_code INTO v_claim, v_ref;

    INSERT INTO claim_responses (claim_id, question_id, answer_text)
    SELECT v_claim, question_id, answer_text FROM claim_responses WHERE claim_id = p_claim_id;

    PERFORM set_status_reason('Appeal ' || v_ref || ' submitted');
    UPDATE lost_reports SET status = 'MATCHED' WHERE report_id = o.report_id;
    IF i.status = 'IN_CUSTODY' THEN
        UPDATE found_items SET status = 'CLAIM_PENDING' WHERE item_id = o.item_id;
    END IF;
    PERFORM set_status_reason(NULL);

    PERFORM notify_admins('APPEAL_SUBMITTED', 'Appeal ' || v_ref,
        format('Claim %s was appealed (new claim %s, %s).', o.reference_code, v_ref, lower(v_status)), v_claim);
    PERFORM log_audit('CLAIM_APPEAL', 'ownership_claims', v_claim, jsonb_build_object('appeal_of', p_claim_id));
    RETURN v_claim;
END $$;

CREATE FUNCTION add_claim_evidence(p_claim_id bigint, p_file_path text, p_mime text,
                                   p_type text, p_note text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    v_user bigint := current_student_id();
    v_status text;
    v_owner bigint;
    v_id bigint;
BEGIN
    SELECT c.status, r.user_id INTO v_status, v_owner
    FROM ownership_claims c JOIN lost_reports r ON r.report_id = c.report_id
    WHERE c.claim_id = p_claim_id;
    IF NOT FOUND OR v_owner <> v_user THEN
        RAISE EXCEPTION 'Claim not found' USING ERRCODE = 'CF004';
    END IF;
    IF v_status NOT IN ('QUEUED', 'PENDING') THEN
        RAISE EXCEPTION 'Evidence can only be added while the claim is awaiting review' USING ERRCODE = 'CF005';
    END IF;
    IF (SELECT count(*) FROM claim_evidence WHERE claim_id = p_claim_id) >= 5 THEN
        RAISE EXCEPTION 'At most 5 evidence files per claim' USING ERRCODE = 'CF008';
    END IF;
    INSERT INTO claim_evidence (claim_id, file_path, mime_type, evidence_type, note)
    VALUES (p_claim_id, p_file_path, p_mime, p_type, nullif(btrim(p_note), ''))
    RETURNING evidence_id INTO v_id;
    RETURN v_id;
END $$;

-- Returns the blurred file path if (and only if) the student may see it, and
-- writes the view to the audit log. Allowed when the photo's item is a
-- currently visible candidate for one of the student's reports, or the student
-- has a claim on that item.
CREATE FUNCTION authorize_blurred_photo(p_photo_id bigint) RETURNS text
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    v_user bigint := current_student_id();
    v_item bigint;
    v_path text;
BEGIN
    SELECT item_id, blurred_path INTO v_item, v_path FROM item_photos WHERE photo_id = p_photo_id;
    IF NOT FOUND THEN
        RETURN NULL;
    END IF;
    IF EXISTS (SELECT 1 FROM v_candidate_ranking cr
               WHERE cr.item_id = v_item AND cr.user_id = v_user AND cr.is_visible)
       OR EXISTS (SELECT 1 FROM ownership_claims c JOIN lost_reports r ON r.report_id = c.report_id
                  WHERE c.item_id = v_item AND r.user_id = v_user) THEN
        PERFORM log_audit('PHOTO_VIEW_BLURRED', 'item_photos', p_photo_id, jsonb_build_object('item_id', v_item));
        RETURN v_path;
    END IF;
    RETURN NULL;
END $$;

-- Student may view their own evidence file.
CREATE FUNCTION authorize_own_evidence(p_evidence_id bigint) RETURNS TABLE (file_path text, mime_type text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
    SELECT e.file_path, e.mime_type
    FROM claim_evidence e
    JOIN ownership_claims c ON c.claim_id = e.claim_id
    JOIN lost_reports r ON r.report_id = c.report_id
    WHERE e.evidence_id = p_evidence_id AND r.user_id = app_user_id()
$$;

-- =============================================================================
-- ADMIN OPERATIONS
-- =============================================================================

-- DRAFT -> IN_CUSTODY. The status change fires trg_found_item_matching, which
-- runs run_matching_for_item() against every ACTIVE report.
CREATE FUNCTION publish_found_item(p_item_id bigint, p_admin_id bigint) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    i found_items%ROWTYPE;
    v_candidates integer;
BEGIN
    PERFORM assert_acting_admin(p_admin_id);
    SELECT * INTO i FROM found_items WHERE item_id = p_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not found' USING ERRCODE = 'CF004';
    END IF;
    IF i.status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Only a draft can be published (current status %)', i.status USING ERRCODE = 'CF005';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM item_photos WHERE item_id = p_item_id) THEN
        RAISE EXCEPTION 'Upload at least one photo before publishing' USING ERRCODE = 'CF008';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM finder_statements WHERE item_id = p_item_id) THEN
        RAISE EXCEPTION 'Record the finder statement before publishing' USING ERRCODE = 'CF008';
    END IF;
    -- Ensure exactly one primary photo.
    IF NOT EXISTS (SELECT 1 FROM item_photos WHERE item_id = p_item_id AND is_primary) THEN
        UPDATE item_photos SET is_primary = true
        WHERE photo_id = (SELECT min(photo_id) FROM item_photos WHERE item_id = p_item_id);
    END IF;

    PERFORM set_status_reason('Published by admin');
    UPDATE found_items
       SET status = 'IN_CUSTODY', published_at = now(), published_by = p_admin_id
     WHERE item_id = p_item_id;
    PERFORM set_status_reason(NULL);

    SELECT count(*) INTO v_candidates FROM potential_matches
    WHERE item_id = p_item_id AND score >= cfg_num('candidate_threshold');
    PERFORM log_audit('ITEM_PUBLISH', 'found_items', p_item_id, jsonb_build_object('candidates', v_candidates));
    RETURN v_candidates;
END $$;

-- Delete a DRAFT (published items can never be deleted). Returns file paths
-- so Express can remove the image files after COMMIT.
CREATE FUNCTION delete_draft_item(p_item_id bigint, p_admin_id bigint)
RETURNS TABLE (original_path text, blurred_path text)
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE v_status text;
BEGIN
    PERFORM assert_acting_admin(p_admin_id);
    SELECT status INTO v_status FROM found_items WHERE item_id = p_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not found' USING ERRCODE = 'CF004';
    END IF;
    IF v_status <> 'DRAFT' THEN
        RAISE EXCEPTION 'Only drafts can be deleted' USING ERRCODE = 'CF005';
    END IF;
    RETURN QUERY SELECT p.original_path, p.blurred_path FROM item_photos p WHERE p.item_id = p_item_id;
    DELETE FROM found_items WHERE item_id = p_item_id;
    PERFORM log_audit('ITEM_DRAFT_DELETE', 'found_items', p_item_id);
END $$;

-- ---------------------------------------------------------------------------
-- approve_claim: atomic, row-locked approval.
--   * claim must be PENDING; item must be CLAIM_PENDING (or IN_CUSTODY);
--   * no other APPROVED/COMPLETED claim may exist for the item;
--   * a reason and pickup instructions are mandatory.
-- The item stays reserved (CLAIM_PENDING) — it is NOT returned until the
-- physical handover is recorded.
-- ---------------------------------------------------------------------------
CREATE FUNCTION approve_claim(p_claim_id bigint, p_admin_id bigint, p_reason text,
                              p_pickup_instructions text, p_pickup_deadline timestamptz)
RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    c ownership_claims%ROWTYPE;
    i found_items%ROWTYPE;
    v_owner bigint;
    q record;
BEGIN
    PERFORM assert_acting_admin(p_admin_id);

    SELECT * INTO c FROM ownership_claims WHERE claim_id = p_claim_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim not found' USING ERRCODE = 'CF004';
    END IF;
    IF c.status <> 'PENDING' THEN
        RAISE EXCEPTION 'Only a PENDING claim can be approved (current status %)', c.status USING ERRCODE = 'CF005';
    END IF;

    SELECT * INTO i FROM found_items WHERE item_id = c.item_id FOR UPDATE;
    IF i.status NOT IN ('IN_CUSTODY', 'CLAIM_PENDING') THEN
        RAISE EXCEPTION 'Item % is not available (status %)', i.reference_code, i.status USING ERRCODE = 'CF005';
    END IF;
    IF EXISTS (SELECT 1 FROM ownership_claims
               WHERE item_id = c.item_id AND claim_id <> c.claim_id AND status IN ('APPROVED', 'COMPLETED')) THEN
        RAISE EXCEPTION 'Another claim for this item is already approved' USING ERRCODE = 'CF005';
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'A decision reason is required' USING ERRCODE = 'CF008';
    END IF;
    IF p_pickup_instructions IS NULL OR char_length(btrim(p_pickup_instructions)) < 5 THEN
        RAISE EXCEPTION 'Pickup instructions are required' USING ERRCODE = 'CF008';
    END IF;
    IF p_pickup_deadline IS NULL OR p_pickup_deadline <= now() THEN
        RAISE EXCEPTION 'Pickup deadline must be in the future' USING ERRCODE = 'CF008';
    END IF;

    PERFORM set_status_reason(p_reason);
    UPDATE ownership_claims
       SET status = 'APPROVED', decided_by = p_admin_id, decision_reason = btrim(p_reason),
           decided_at = now(), pickup_instructions = btrim(p_pickup_instructions),
           pickup_deadline = p_pickup_deadline
     WHERE claim_id = p_claim_id;
    IF i.status = 'IN_CUSTODY' THEN
        UPDATE found_items SET status = 'CLAIM_PENDING' WHERE item_id = c.item_id;
    END IF;
    PERFORM set_status_reason(NULL);

    SELECT user_id INTO v_owner FROM lost_reports WHERE report_id = c.report_id;
    PERFORM notify_user(v_owner, 'CLAIM_APPROVED', 'Claim approved — collect your item',
        format('Your claim %s was approved. Pickup: %s. Please collect by %s and bring your college ID.',
               c.reference_code, btrim(p_pickup_instructions),
               to_char(p_pickup_deadline, 'DD Mon YYYY HH24:MI')),
        c.report_id, c.claim_id);

    -- Competing (queued) claimants are told; they stay queued until handover.
    FOR q IN SELECT oc.claim_id, oc.report_id, r.user_id
             FROM ownership_claims oc JOIN lost_reports r ON r.report_id = oc.report_id
             WHERE oc.item_id = c.item_id AND oc.status = 'QUEUED' LOOP
        PERFORM notify_user(q.user_id, 'QUEUE_UPDATE', 'Update on your queued claim',
            'Another claim on this item has been approved. If that owner does not collect it, your claim will be reviewed.',
            q.report_id, q.claim_id);
    END LOOP;

    PERFORM log_audit('CLAIM_APPROVE', 'ownership_claims', p_claim_id,
        jsonb_build_object('item_id', c.item_id, 'reason', p_reason));
END $$;

-- ---------------------------------------------------------------------------
-- reject_claim: QUEUED/PENDING/APPROVED -> REJECTED (APPROVED -> REJECTED
-- covers "ID check failed at the desk" or "not collected by deadline").
-- If the active claim is rejected, the earliest QUEUED claim is promoted to
-- PENDING (FIFO); otherwise the item goes back to IN_CUSTODY.
-- The claimant's report returns to ACTIVE and is re-matched.
-- ---------------------------------------------------------------------------
CREATE FUNCTION reject_claim(p_claim_id bigint, p_admin_id bigint, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    c ownership_claims%ROWTYPE;
    i found_items%ROWTYPE;
    v_owner bigint;
    v_next  record;
BEGIN
    PERFORM assert_acting_admin(p_admin_id);

    SELECT * INTO c FROM ownership_claims WHERE claim_id = p_claim_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim not found' USING ERRCODE = 'CF004';
    END IF;
    IF c.status NOT IN ('QUEUED', 'PENDING', 'APPROVED') THEN
        RAISE EXCEPTION 'Claim cannot be rejected in status %', c.status USING ERRCODE = 'CF005';
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) < 5 THEN
        RAISE EXCEPTION 'A rejection reason is required' USING ERRCODE = 'CF008';
    END IF;

    SELECT * INTO i FROM found_items WHERE item_id = c.item_id FOR UPDATE;

    PERFORM set_status_reason(p_reason);
    UPDATE ownership_claims
       SET status = 'REJECTED', decided_by = p_admin_id, decision_reason = btrim(p_reason), decided_at = now()
     WHERE claim_id = p_claim_id;
    UPDATE lost_reports SET status = 'ACTIVE' WHERE report_id = c.report_id AND status = 'MATCHED';

    IF c.status IN ('PENDING', 'APPROVED') THEN
        SELECT oc.claim_id, oc.report_id, oc.reference_code, r.user_id INTO v_next
        FROM ownership_claims oc JOIN lost_reports r ON r.report_id = oc.report_id
        WHERE oc.item_id = c.item_id AND oc.status = 'QUEUED'
        ORDER BY oc.created_at, oc.claim_id
        LIMIT 1
        FOR UPDATE OF oc;

        IF FOUND THEN
            PERFORM set_status_reason('Promoted from queue after claim ' || c.reference_code || ' was rejected');
            UPDATE ownership_claims SET status = 'PENDING' WHERE claim_id = v_next.claim_id;
            PERFORM notify_user(v_next.user_id, 'CLAIM_PROMOTED', 'Your claim is now under review',
                format('Your queued claim %s is now being reviewed by the admin.', v_next.reference_code),
                v_next.report_id, v_next.claim_id);
        ELSE
            PERFORM set_status_reason('Claim ' || c.reference_code || ' rejected; item available again');
            UPDATE found_items SET status = 'IN_CUSTODY' WHERE item_id = c.item_id AND status = 'CLAIM_PENDING';
        END IF;
    END IF;
    PERFORM set_status_reason(NULL);

    SELECT user_id INTO v_owner FROM lost_reports WHERE report_id = c.report_id;
    PERFORM notify_user(v_owner, 'CLAIM_REJECTED', 'Claim not approved',
        format('Your claim %s was not approved. Reason: %s%s', c.reference_code, btrim(p_reason),
               CASE WHEN c.appeal_of_claim_id IS NULL
                    THEN ' You may submit one appeal from the claim page.' ELSE '' END),
        c.report_id, c.claim_id);

    PERFORM run_matching_for_report(c.report_id);   -- report is ACTIVE again
    PERFORM log_audit('CLAIM_REJECT', 'ownership_claims', p_claim_id,
        jsonb_build_object('item_id', c.item_id, 'reason', p_reason, 'previous_status', c.status));
END $$;

-- ---------------------------------------------------------------------------
-- record_handover: the physical return, in ONE transaction.
--   handover row + claim COMPLETED + item RETURNED + report RESOLVED
--   + every still-QUEUED claim rejected (their reports back to ACTIVE)
--   + notifications + audit.
-- ---------------------------------------------------------------------------
CREATE FUNCTION record_handover(p_claim_id bigint, p_admin_id bigint, p_id_document text,
                                p_id_verified boolean, p_notes text DEFAULT NULL)
RETURNS bigint
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    c ownership_claims%ROWTYPE;
    i found_items%ROWTYPE;
    v_owner    bigint;
    v_handover bigint;
    q record;
BEGIN
    PERFORM assert_acting_admin(p_admin_id);

    SELECT * INTO c FROM ownership_claims WHERE claim_id = p_claim_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim not found' USING ERRCODE = 'CF004';
    END IF;
    IF c.status <> 'APPROVED' THEN
        RAISE EXCEPTION 'Only an APPROVED claim can be handed over (current status %)', c.status USING ERRCODE = 'CF005';
    END IF;
    SELECT * INTO i FROM found_items WHERE item_id = c.item_id FOR UPDATE;
    IF i.status <> 'CLAIM_PENDING' THEN
        RAISE EXCEPTION 'Item is not reserved for this claim (status %)', i.status USING ERRCODE = 'CF005';
    END IF;
    IF p_id_verified IS NOT TRUE THEN
        RAISE EXCEPTION 'The claimant''s identity must be verified before handover' USING ERRCODE = 'CF008';
    END IF;

    INSERT INTO handovers (claim_id, handed_over_by, id_document_checked, id_verified, notes)
    VALUES (p_claim_id, p_admin_id, btrim(p_id_document), p_id_verified, nullif(btrim(p_notes), ''))
    RETURNING handover_id INTO v_handover;

    PERFORM set_status_reason('Physical handover confirmed');
    UPDATE ownership_claims SET status = 'COMPLETED' WHERE claim_id = p_claim_id;
    UPDATE found_items      SET status = 'RETURNED'  WHERE item_id = c.item_id;
    UPDATE lost_reports     SET status = 'RESOLVED'  WHERE report_id = c.report_id;

    FOR q IN SELECT oc.claim_id, oc.report_id, oc.reference_code, r.user_id
             FROM ownership_claims oc JOIN lost_reports r ON r.report_id = oc.report_id
             WHERE oc.item_id = c.item_id AND oc.status = 'QUEUED'
             FOR UPDATE OF oc LOOP
        PERFORM set_status_reason('Item returned to its verified owner');
        UPDATE ownership_claims
           SET status = 'REJECTED', decided_by = p_admin_id,
               decision_reason = 'This item was returned to its verified owner.', decided_at = now()
         WHERE claim_id = q.claim_id;
        UPDATE lost_reports SET status = 'ACTIVE' WHERE report_id = q.report_id AND status = 'MATCHED';
        PERFORM notify_user(q.user_id, 'CLAIM_REJECTED', 'Queued claim closed',
            format('Claim %s was closed because the item was returned to its verified owner. Your report is active again.', q.reference_code),
            q.report_id, q.claim_id);
        PERFORM run_matching_for_report(q.report_id);
    END LOOP;
    PERFORM set_status_reason(NULL);

    SELECT user_id INTO v_owner FROM lost_reports WHERE report_id = c.report_id;
    PERFORM notify_user(v_owner, 'ITEM_RETURNED', 'Item returned',
        format('Item %s has been handed over to you. Your report is now resolved. Thank you for using CampusFind.', i.reference_code),
        c.report_id, c.claim_id);
    PERFORM log_audit('HANDOVER', 'ownership_claims', p_claim_id,
        jsonb_build_object('item_id', c.item_id, 'handover_id', v_handover));
    RETURN v_handover;
END $$;

CREATE FUNCTION close_report(p_report_id bigint, p_admin_id bigint, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE r lost_reports%ROWTYPE;
BEGIN
    PERFORM assert_acting_admin(p_admin_id);
    SELECT * INTO r FROM lost_reports WHERE report_id = p_report_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Report not found' USING ERRCODE = 'CF004';
    END IF;
    IF r.status <> 'ACTIVE' THEN
        RAISE EXCEPTION 'Only an ACTIVE report can be closed' USING ERRCODE = 'CF005';
    END IF;
    IF p_reason IS NULL OR char_length(btrim(p_reason)) < 3 THEN
        RAISE EXCEPTION 'A reason is required' USING ERRCODE = 'CF008';
    END IF;
    PERFORM set_status_reason(p_reason);
    UPDATE lost_reports SET status = 'CLOSED', closed_reason = btrim(p_reason) WHERE report_id = p_report_id;
    PERFORM set_status_reason(NULL);
    PERFORM notify_user(r.user_id, 'REPORT_CLOSED', 'Report closed',
        format('Your report %s was closed by the admin. Reason: %s', r.reference_code, btrim(p_reason)),
        p_report_id, NULL);
    PERFORM log_audit('REPORT_CLOSE', 'lost_reports', p_report_id, jsonb_build_object('reason', p_reason));
END $$;

CREATE FUNCTION archive_item(p_item_id bigint, p_admin_id bigint, p_reason text) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE v_status text;
BEGIN
    PERFORM assert_acting_admin(p_admin_id);
    SELECT status INTO v_status FROM found_items WHERE item_id = p_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not found' USING ERRCODE = 'CF004';
    END IF;
    IF v_status <> 'IN_CUSTODY' THEN
        RAISE EXCEPTION 'Only an item in custody with no open claim can be archived' USING ERRCODE = 'CF005';
    END IF;
    PERFORM set_status_reason(coalesce(p_reason, 'Archived by admin'));
    UPDATE found_items SET status = 'ARCHIVED' WHERE item_id = p_item_id;
    PERFORM set_status_reason(NULL);
    PERFORM log_audit('ITEM_ARCHIVE', 'found_items', p_item_id, jsonb_build_object('reason', p_reason));
END $$;

-- ARCHIVED -> IN_CUSTODY: the matching trigger re-runs matching.
CREATE FUNCTION restore_item(p_item_id bigint, p_admin_id bigint) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE v_status text;
BEGIN
    PERFORM assert_acting_admin(p_admin_id);
    SELECT status INTO v_status FROM found_items WHERE item_id = p_item_id FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Item not found' USING ERRCODE = 'CF004';
    END IF;
    IF v_status <> 'ARCHIVED' THEN
        RAISE EXCEPTION 'Only an archived item can be restored' USING ERRCODE = 'CF005';
    END IF;
    PERFORM set_status_reason('Restored from archive');
    UPDATE found_items SET status = 'IN_CUSTODY' WHERE item_id = p_item_id;
    PERFORM set_status_reason(NULL);
    PERFORM log_audit('ITEM_RESTORE', 'found_items', p_item_id);
END $$;

-- Maintenance: archive long-unclaimed items, close stale reports.
CREATE FUNCTION archive_stale_records(p_admin_id bigint) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE
    v_items integer := 0;
    v_reports integer := 0;
    rec record;
BEGIN
    PERFORM assert_acting_admin(p_admin_id);

    PERFORM set_status_reason(format('Unclaimed for more than %s days', cfg_num('archive_after_days')));
    WITH a AS (
        UPDATE found_items SET status = 'ARCHIVED'
        WHERE status = 'IN_CUSTODY'
          AND published_at < now() - make_interval(days => cfg_num('archive_after_days')::int)
        RETURNING item_id
    ) SELECT count(*) INTO v_items FROM a;

    FOR rec IN SELECT report_id, user_id, reference_code FROM lost_reports
               WHERE status = 'ACTIVE'
                 AND created_at < now() - make_interval(days => cfg_num('report_expiry_days')::int)
               FOR UPDATE LOOP
        PERFORM set_status_reason('Expired');
        UPDATE lost_reports SET status = 'CLOSED',
               closed_reason = format('Expired after %s days without a match', cfg_num('report_expiry_days'))
        WHERE report_id = rec.report_id;
        PERFORM notify_user(rec.user_id, 'REPORT_CLOSED', 'Report expired',
            format('Report %s was closed after %s days. You can file a new report if you are still looking.',
                   rec.reference_code, cfg_num('report_expiry_days')), rec.report_id, NULL);
        v_reports := v_reports + 1;
    END LOOP;
    PERFORM set_status_reason(NULL);

    PERFORM log_audit('MAINTENANCE', NULL, NULL,
        jsonb_build_object('items_archived', v_items, 'reports_closed', v_reports));
    RETURN jsonb_build_object('items_archived', v_items, 'reports_closed', v_reports);
END $$;

CREATE FUNCTION set_user_active(p_user_id bigint, p_admin_id bigint, p_active boolean) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
BEGIN
    PERFORM assert_acting_admin(p_admin_id);
    IF NOT EXISTS (SELECT 1 FROM users WHERE user_id = p_user_id AND role = 'student') THEN
        RAISE EXCEPTION 'Student not found' USING ERRCODE = 'CF004';
    END IF;
    UPDATE users SET is_active = p_active WHERE user_id = p_user_id;
    PERFORM log_audit('USER_STATUS_CHANGE', 'users', p_user_id, jsonb_build_object('is_active', p_active));
END $$;

CREATE FUNCTION admin_rematch_all(p_admin_id bigint) RETURNS integer
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
BEGIN
    PERFORM assert_acting_admin(p_admin_id);
    RETURN rematch_all();
END $$;

-- Change a configuration value (weights, threshold, limits). The deferred
-- constraint trigger on app_config guarantees the weights still sum to 100.
CREATE FUNCTION update_config(p_key text, p_value jsonb, p_admin_id bigint) RETURNS void
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = campusfind, public, pg_temp AS $$
DECLARE v_old jsonb;
BEGIN
    PERFORM assert_acting_admin(p_admin_id);
    SELECT value INTO v_old FROM app_config WHERE key = p_key FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Unknown config key %', p_key USING ERRCODE = 'CF004';
    END IF;
    IF jsonb_typeof(v_old) <> jsonb_typeof(p_value) THEN
        RAISE EXCEPTION 'Config % expects a % value', p_key, jsonb_typeof(v_old) USING ERRCODE = 'CF008';
    END IF;
    UPDATE app_config SET value = p_value, updated_at = now(), updated_by = p_admin_id WHERE key = p_key;
    PERFORM log_audit('CONFIG_CHANGE', 'app_config', NULL,
        jsonb_build_object('key', p_key, 'old', v_old, 'new', p_value));
END $$;

-- ---------------------------------------------------------------------------
-- compute_verification_indicator(claim) -> jsonb   (ADMIN ONLY)
--
-- Ownership verification is SEPARATE from matching. It asks: does the
-- claimant's PRE-PHOTO, LOCKED description agree with the item's SECRET details?
--   * serial:       report.serial_hint  vs found_item_private.serial_no
--   * hidden marks: report description+features vs found_item_private.hidden_marks
--   * questions:    each answer vs verification_questions.expected_answer
-- None of category/brand/colour/location/time/visible marks are reused here
-- (they are already in the match score — no double counting).
-- The result is guidance for the admin, never a decision.
-- ---------------------------------------------------------------------------
CREATE FUNCTION compute_verification_indicator(p_claim_id bigint) RETURNS jsonb
LANGUAGE plpgsql STABLE AS $$
DECLARE
    c ownership_claims%ROWTYPE;
    r lost_reports%ROWTYPE;
    p found_item_private%ROWTYPE;
    v_hint text; v_serial text;
    v_serial_result text;
    v_marks_sim numeric; v_marks_result text;
    v_questions jsonb := '[]'::jsonb;
    q record;
    v_ans text; v_exp text; v_sim numeric; v_verdict text;
    v_points numeric := 0; v_max numeric := 0;
    v_overall text;
BEGIN
    SELECT * INTO c FROM ownership_claims WHERE claim_id = p_claim_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Claim not found' USING ERRCODE = 'CF004';
    END IF;
    SELECT * INTO r FROM lost_reports WHERE report_id = c.report_id;
    SELECT * INTO p FROM found_item_private WHERE item_id = c.item_id;

    -- Serial number -----------------------------------------------------------
    v_hint := norm_text(r.serial_hint);
    v_serial := norm_text(p.serial_no);
    IF v_serial IS NULL THEN
        v_serial_result := 'NO_RECORD';
    ELSIF v_hint IS NULL THEN
        v_serial_result := 'NOT_PROVIDED';
    ELSIF v_hint = v_serial THEN
        v_serial_result := 'MATCH';   v_points := v_points + 3; v_max := v_max + 3;
    ELSIF char_length(v_hint) >= 4 AND position(v_hint IN v_serial) > 0 THEN
        v_serial_result := 'PARTIAL'; v_points := v_points + 2; v_max := v_max + 3;   -- e.g. last 4 digits
    ELSE
        v_serial_result := 'MISMATCH'; v_points := v_points - 3; v_max := v_max + 3;
    END IF;

    -- Hidden marks ------------------------------------------------------------
    IF p.hidden_marks IS NULL OR btrim(p.hidden_marks) = '' THEN
        v_marks_result := 'NO_RECORD';
    ELSE
        v_marks_sim := word_similarity(p.hidden_marks, coalesce(r.description, '') || ' ' || coalesce(r.features, ''));
        v_max := v_max + 2;
        IF v_marks_sim >= 0.6 THEN
            v_marks_result := 'STRONG'; v_points := v_points + 2;
        ELSIF v_marks_sim >= 0.35 THEN
            v_marks_result := 'SOME';   v_points := v_points + 1;
        ELSE
            v_marks_result := 'NONE';
        END IF;
    END IF;

    -- Verification questions --------------------------------------------------
    FOR q IN SELECT vq.question_text, vq.expected_answer, cr.answer_text
             FROM claim_responses cr JOIN verification_questions vq ON vq.question_id = cr.question_id
             WHERE cr.claim_id = p_claim_id ORDER BY vq.question_id LOOP
        v_ans := lower(btrim(q.answer_text));
        v_exp := lower(btrim(q.expected_answer));
        v_sim := greatest(similarity(v_ans, v_exp), word_similarity(v_exp, v_ans));
        IF v_ans = v_exp OR norm_text(v_ans) = norm_text(v_exp) THEN
            v_verdict := 'MATCH';    v_points := v_points + 2;
        ELSIF v_sim >= 0.5 THEN
            v_verdict := 'PARTIAL';  v_points := v_points + 1;
        ELSE
            v_verdict := 'NO_MATCH'; v_points := v_points - 1;
        END IF;
        v_max := v_max + 2;
        v_questions := v_questions || jsonb_build_object(
            'question', q.question_text, 'answer', q.answer_text, 'expected', q.expected_answer,
            'similarity', round(v_sim, 2), 'verdict', v_verdict);
    END LOOP;

    IF v_max = 0 THEN
        v_overall := 'INSUFFICIENT_DATA';
    ELSIF v_serial_result = 'MISMATCH' THEN
        v_overall := 'WEAK';
    ELSIF v_points / v_max >= 0.6 THEN
        v_overall := 'STRONG';
    ELSIF v_points / v_max >= 0.3 THEN
        v_overall := 'MODERATE';
    ELSE
        v_overall := 'WEAK';
    END IF;

    RETURN jsonb_build_object(
        'serial', jsonb_build_object('result', v_serial_result, 'claimant_hint', r.serial_hint, 'recorded', p.serial_no),
        'hidden_marks', jsonb_build_object('result', v_marks_result, 'similarity', round(v_marks_sim, 2),
                                           'recorded', p.hidden_marks),
        'questions', v_questions,
        'points', v_points, 'max_points', v_max,
        'overall', v_overall,
        'note', 'Guidance only. The match score and this indicator never approve a claim — an admin decides.'
    );
END $$;
