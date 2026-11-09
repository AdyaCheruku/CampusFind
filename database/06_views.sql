-- =============================================================================
-- CampusFind — 06_views.sql
-- Views are the ONLY way student_app reads item/match/claim data. They are
-- owned by campusfind_owner, filter by app_user_id(), never select private
-- columns, and are security_barrier so user-supplied predicates cannot be
-- pushed below the row filter to leak rows.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Internal ranking (no grant to student_app). Defines "visible candidate":
--   report ACTIVE, item IN_CUSTODY/CLAIM_PENDING, score >= threshold,
--   rank <= top_n, not dismissed.
-- The rank is computed BEFORE dismissed rows are hidden, so dismissing does
-- not reveal the next item (prevents browsing for items you never lost).
-- Window function: ROW_NUMBER() OVER (PARTITION BY report ...).
-- ---------------------------------------------------------------------------
CREATE VIEW v_candidate_ranking AS
SELECT ranked.*,
       (ranked.rank <= cfg_num('top_n') AND NOT ranked.dismissed) AS is_visible
FROM (
    SELECT pm.report_id, pm.item_id, r.user_id, pm.score, pm.dismissed, pm.notified_at,
           i.found_at, i.status AS item_status,
           ROW_NUMBER() OVER (PARTITION BY pm.report_id
                              ORDER BY pm.score DESC, i.found_at DESC, i.item_id DESC) AS rank
    FROM potential_matches pm
    JOIN lost_reports r ON r.report_id = pm.report_id AND r.status = 'ACTIVE'
    JOIN found_items  i ON i.item_id = pm.item_id AND i.status IN ('IN_CUSTODY', 'CLAIM_PENDING')
    WHERE pm.score >= cfg_num('candidate_threshold')
) ranked;

-- ===========================================================================
-- STUDENT VIEWS
-- ===========================================================================

-- Candidates for the logged-in student. No storage location, visible marks,
-- brand/model, finder data, private details or original photo paths.
CREATE VIEW v_student_candidates WITH (security_barrier = true) AS
SELECT cr.report_id,
       r.reference_code                         AS report_ref,
       cr.item_id,
       i.reference_code                         AS item_ref,
       c.name                                   AS category,
       col.name                                 AS colour,
       i.public_description,
       l.name                                   AS found_location,
       i.found_at::date                         AS found_date,
       cr.score,
       cr.rank,
       (i.status = 'CLAIM_PENDING')             AS under_review,
       ARRAY(SELECT p.photo_id::int FROM item_photos p WHERE p.item_id = i.item_id
             ORDER BY p.is_primary DESC, p.photo_id)  AS photo_ids,
       EXISTS (SELECT 1 FROM ownership_claims oc
               WHERE oc.report_id = cr.report_id AND oc.item_id = cr.item_id) AS already_claimed,
       (SELECT oc.claim_id FROM ownership_claims oc
        WHERE oc.report_id = cr.report_id AND oc.item_id = cr.item_id
          AND oc.status = 'REJECTED' AND oc.appeal_of_claim_id IS NULL
          AND NOT EXISTS (SELECT 1 FROM ownership_claims a WHERE a.appeal_of_claim_id = oc.claim_id)
        LIMIT 1)                                AS appealable_claim_id,
       (SELECT count(*) FROM verification_questions q WHERE q.item_id = i.item_id)::int AS question_count
FROM v_candidate_ranking cr
JOIN lost_reports r  ON r.report_id = cr.report_id
JOIN found_items  i  ON i.item_id = cr.item_id
JOIN categories   c  ON c.category_id = i.category_id
JOIN colours      col ON col.colour_id = i.colour_id
JOIN locations    l  ON l.location_id = i.found_location_id
WHERE cr.user_id = app_user_id() AND cr.is_visible;

CREATE VIEW v_student_reports WITH (security_barrier = true) AS
SELECT r.report_id, r.reference_code, r.category_id, c.name AS category, c.category_group,
       r.brand, r.model, r.colour_id, col.name AS colour, r.description, r.features, r.serial_hint,
       r.lost_location_id, l.name AS lost_location, r.lost_location_detail, r.lost_at,
       (r.proof_photo_path IS NOT NULL) AS has_proof_photo,
       r.locked_at, r.status, r.withdrawn_reason, r.closed_reason, r.created_at, r.status_changed_at,
       (SELECT count(*) FROM v_candidate_ranking cr
         WHERE cr.report_id = r.report_id AND cr.is_visible)::int AS candidate_count,
       oc.claim_id      AS open_claim_id,
       oc.reference_code AS open_claim_ref,
       oc.status        AS open_claim_status
FROM lost_reports r
JOIN categories c ON c.category_id = r.category_id
LEFT JOIN colours col ON col.colour_id = r.colour_id
LEFT JOIN locations l ON l.location_id = r.lost_location_id
LEFT JOIN ownership_claims oc ON oc.report_id = r.report_id AND oc.status IN ('QUEUED', 'PENDING', 'APPROVED')
WHERE r.user_id = app_user_id();

CREATE VIEW v_student_report_history WITH (security_barrier = true) AS
SELECT h.report_id, h.old_status, h.new_status, h.reason, h.changed_at
FROM report_status_history h
JOIN lost_reports r ON r.report_id = h.report_id
WHERE r.user_id = app_user_id();

CREATE VIEW v_student_claims WITH (security_barrier = true) AS
SELECT oc.claim_id, oc.reference_code, oc.report_id, r.reference_code AS report_ref,
       oc.item_id, i.reference_code AS item_ref, c.name AS category, col.name AS colour,
       i.public_description, l.name AS found_location, i.found_at::date AS found_date,
       (SELECT p.photo_id FROM item_photos p WHERE p.item_id = i.item_id
         ORDER BY p.is_primary DESC, p.photo_id LIMIT 1) AS primary_photo_id,
       oc.status, oc.match_score_at_claim, oc.appeal_of_claim_id, oc.appeal_statement,
       EXISTS (SELECT 1 FROM ownership_claims a WHERE a.appeal_of_claim_id = oc.claim_id) AS has_been_appealed,
       (oc.status = 'REJECTED' AND oc.appeal_of_claim_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM ownership_claims a WHERE a.appeal_of_claim_id = oc.claim_id)) AS can_appeal,
       oc.decision_reason, oc.decided_at, oc.pickup_instructions, oc.pickup_deadline,
       oc.created_at, oc.status_changed_at,
       CASE WHEN oc.status = 'QUEUED' THEN
           (SELECT count(*) FROM ownership_claims q
             WHERE q.item_id = oc.item_id AND q.status = 'QUEUED'
               AND (q.created_at, q.claim_id) < (oc.created_at, oc.claim_id))::int + 1
       END AS queue_position,
       h.handed_at
FROM ownership_claims oc
JOIN lost_reports r ON r.report_id = oc.report_id
JOIN found_items i  ON i.item_id = oc.item_id
JOIN categories c   ON c.category_id = i.category_id
JOIN colours col    ON col.colour_id = i.colour_id
JOIN locations l    ON l.location_id = i.found_location_id
LEFT JOIN handovers h ON h.claim_id = oc.claim_id
WHERE r.user_id = app_user_id();

CREATE VIEW v_student_claim_responses WITH (security_barrier = true) AS
SELECT cr.claim_id, q.question_id, q.question_text, cr.answer_text, cr.answered_at
FROM claim_responses cr
JOIN verification_questions q ON q.question_id = cr.question_id
JOIN ownership_claims oc ON oc.claim_id = cr.claim_id
JOIN lost_reports r ON r.report_id = oc.report_id
WHERE r.user_id = app_user_id();

CREATE VIEW v_student_claim_evidence WITH (security_barrier = true) AS
SELECT e.evidence_id, e.claim_id, e.evidence_type, e.mime_type, e.note, e.uploaded_at
FROM claim_evidence e
JOIN ownership_claims oc ON oc.claim_id = e.claim_id
JOIN lost_reports r ON r.report_id = oc.report_id
WHERE r.user_id = app_user_id();

CREATE VIEW v_student_claim_history WITH (security_barrier = true) AS
SELECT h.claim_id, h.old_status, h.new_status, h.reason, h.changed_at
FROM claim_status_history h
JOIN ownership_claims oc ON oc.claim_id = h.claim_id
JOIN lost_reports r ON r.report_id = oc.report_id
WHERE r.user_id = app_user_id();

CREATE VIEW v_student_dashboard WITH (security_barrier = true) AS
SELECT
    (SELECT count(*) FROM lost_reports r WHERE r.user_id = app_user_id()
       AND r.status IN ('ACTIVE', 'MATCHED'))::int                                   AS active_reports,
    (SELECT count(*) FROM v_candidate_ranking cr
      WHERE cr.user_id = app_user_id() AND cr.is_visible)::int                       AS candidates,
    (SELECT count(*) FROM ownership_claims oc JOIN lost_reports r ON r.report_id = oc.report_id
      WHERE r.user_id = app_user_id() AND oc.status IN ('QUEUED', 'PENDING', 'APPROVED'))::int AS open_claims,
    (SELECT count(*) FROM ownership_claims oc JOIN lost_reports r ON r.report_id = oc.report_id
      WHERE r.user_id = app_user_id() AND oc.status = 'COMPLETED')::int             AS returned,
    (SELECT count(*) FROM notifications n
      WHERE n.user_id = app_user_id() AND NOT n.is_read)::int                       AS unread_notifications;

-- ===========================================================================
-- ADMIN VIEWS
-- ===========================================================================

CREATE VIEW v_admin_inventory AS
SELECT i.item_id, i.reference_code, i.status, i.category_id, c.name AS category, c.category_group,
       i.brand, i.model, i.colour_id, col.name AS colour, i.size_desc, i.contents, i.visible_marks,
       i.public_description, i.found_location_id, l.name AS found_location, l.zone AS found_zone,
       i.found_location_detail, i.found_at, i.storage_location,
       i.created_by_admin, ua.full_name AS created_by_name, i.created_at,
       i.published_at, i.updated_at, i.status_changed_at,
       (SELECT p.photo_id FROM item_photos p WHERE p.item_id = i.item_id
         ORDER BY p.is_primary DESC, p.photo_id LIMIT 1)                          AS primary_photo_id,
       (SELECT count(*) FROM item_photos p WHERE p.item_id = i.item_id)::int        AS photo_count,
       (SELECT count(*) FROM verification_questions q WHERE q.item_id = i.item_id)::int AS question_count,
       (SELECT count(*) FROM potential_matches pm WHERE pm.item_id = i.item_id
          AND pm.score >= cfg_num('candidate_threshold'))::int                    AS candidate_count,
       (SELECT count(*) FROM ownership_claims oc WHERE oc.item_id = i.item_id
          AND oc.status IN ('QUEUED', 'PENDING', 'APPROVED'))::int                AS open_claims
FROM found_items i
JOIN categories c ON c.category_id = i.category_id
JOIN colours col ON col.colour_id = i.colour_id
JOIN locations l ON l.location_id = i.found_location_id
JOIN users ua ON ua.user_id = i.created_by_admin;

CREATE VIEW v_admin_lost_reports AS
SELECT r.report_id, r.reference_code, r.status, r.user_id, u.full_name AS student_name,
       u.email AS student_email, u.roll_no AS student_roll_no,
       r.category_id, c.name AS category, r.brand, r.model, r.colour_id, col.name AS colour,
       r.description, r.features, r.serial_hint, r.lost_location_id, l.name AS lost_location,
       r.lost_location_detail, r.lost_at, r.proof_photo_path IS NOT NULL AS has_proof_photo,
       r.locked_at, r.created_at, r.status_changed_at, r.withdrawn_reason, r.closed_reason,
       (SELECT count(*) FROM potential_matches pm WHERE pm.report_id = r.report_id
          AND pm.score >= cfg_num('candidate_threshold'))::int AS candidate_count,
       (SELECT max(pm.score) FROM potential_matches pm WHERE pm.report_id = r.report_id) AS best_score
FROM lost_reports r
JOIN users u ON u.user_id = r.user_id
JOIN categories c ON c.category_id = r.category_id
LEFT JOIN colours col ON col.colour_id = r.colour_id
LEFT JOIN locations l ON l.location_id = r.lost_location_id;

-- Every stored pair, including those below the student threshold (greyed in UI).
CREATE VIEW v_admin_matches AS
SELECT pm.report_id, r.reference_code AS report_ref, r.status AS report_status,
       u.full_name AS student_name,
       pm.item_id, i.reference_code AS item_ref, i.status AS item_status,
       c.name AS category, i.public_description,
       pm.score, pm.breakdown, pm.dismissed, pm.notified_at, pm.computed_at,
       (pm.score >= cfg_num('candidate_threshold')) AS above_threshold,
       coalesce(cr.is_visible, false) AS visible_to_student,
       cr.rank
FROM potential_matches pm
JOIN lost_reports r ON r.report_id = pm.report_id
JOIN users u ON u.user_id = r.user_id
JOIN found_items i ON i.item_id = pm.item_id
JOIN categories c ON c.category_id = i.category_id
LEFT JOIN v_candidate_ranking cr ON cr.report_id = pm.report_id AND cr.item_id = pm.item_id;

CREATE VIEW v_admin_claims AS
SELECT oc.claim_id, oc.reference_code, oc.status, oc.created_at, oc.status_changed_at,
       oc.match_score_at_claim, oc.appeal_of_claim_id,
       oc.report_id, r.reference_code AS report_ref,
       oc.item_id, i.reference_code AS item_ref, i.status AS item_status, c.name AS category,
       u.user_id AS student_id, u.full_name AS student_name, u.roll_no AS student_roll_no,
       oc.decided_by, ad.full_name AS decided_by_name, oc.decision_reason, oc.decided_at,
       oc.pickup_deadline,
       CASE WHEN oc.status = 'QUEUED' THEN
           (SELECT count(*) FROM ownership_claims q
             WHERE q.item_id = oc.item_id AND q.status = 'QUEUED'
               AND (q.created_at, q.claim_id) < (oc.created_at, oc.claim_id))::int + 1
       END AS queue_position
FROM ownership_claims oc
JOIN lost_reports r ON r.report_id = oc.report_id
JOIN users u ON u.user_id = r.user_id
JOIN found_items i ON i.item_id = oc.item_id
JOIN categories c ON c.category_id = i.category_id
LEFT JOIN users ad ON ad.user_id = oc.decided_by;

-- Side-by-side review: the claimant's LOCKED description next to the item's
-- real public AND private details, with score breakdown, answers, evidence,
-- finder statements and competing claims. (JOIN across 10+ tables.)
CREATE VIEW v_admin_claim_review AS
SELECT oc.claim_id, oc.reference_code, oc.status, oc.created_at, oc.match_score_at_claim,
       oc.appeal_of_claim_id, oc.appeal_statement, oc.decision_reason, oc.decided_at,
       ad.full_name AS decided_by_name, oc.pickup_instructions, oc.pickup_deadline,
       -- claimant
       u.user_id AS student_id, u.full_name AS student_name, u.email AS student_email, u.roll_no AS student_roll_no,
       -- locked report (left side)
       r.report_id, r.reference_code AS report_ref, r.status AS report_status, r.locked_at,
       rc.name AS report_category, r.brand AS report_brand, r.model AS report_model,
       rcol.name AS report_colour, r.description AS report_description, r.features AS report_features,
       r.serial_hint AS report_serial_hint, rl.name AS report_location, r.lost_location_detail AS report_location_detail,
       r.lost_at AS report_lost_at, (r.proof_photo_path IS NOT NULL) AS report_has_proof,
       -- found item (right side)
       i.item_id, i.reference_code AS item_ref, i.status AS item_status,
       ic.name AS item_category, i.brand AS item_brand, i.model AS item_model, icol.name AS item_colour,
       i.size_desc AS item_size, i.contents AS item_contents, i.visible_marks AS item_visible_marks,
       i.public_description AS item_public_description, il.name AS item_location,
       i.found_location_detail AS item_location_detail, i.found_at AS item_found_at,
       i.storage_location,
       -- private (admin-only)
       fp.serial_no AS private_serial_no, fp.hidden_marks AS private_hidden_marks, fp.private_notes,
       -- match
       pm.score AS current_score, pm.breakdown AS score_breakdown,
       -- aggregates
       (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'question_id', q.question_id, 'question', q.question_text,
                  'expected', q.expected_answer, 'answer', cr.answer_text) ORDER BY q.question_id), '[]')
          FROM claim_responses cr JOIN verification_questions q ON q.question_id = cr.question_id
         WHERE cr.claim_id = oc.claim_id) AS responses,
       (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'evidence_id', e.evidence_id, 'type', e.evidence_type, 'mime', e.mime_type,
                  'note', e.note, 'uploaded_at', e.uploaded_at) ORDER BY e.evidence_id), '[]')
          FROM claim_evidence e WHERE e.claim_id = oc.claim_id) AS evidence,
       (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'finder_name', fs.finder_name, 'contact', fs.finder_contact, 'roll_no', fs.finder_roll_no,
                  'found_where', fs.found_where, 'found_when', fs.found_when,
                  'circumstances', fs.circumstances, 'recorded_at', fs.recorded_at) ORDER BY fs.statement_id), '[]')
          FROM finder_statements fs WHERE fs.item_id = i.item_id) AS finder_statements,
       (SELECT coalesce(jsonb_agg(jsonb_build_object(
                  'claim_id', o2.claim_id, 'reference_code', o2.reference_code, 'status', o2.status,
                  'student_name', u2.full_name, 'created_at', o2.created_at) ORDER BY o2.created_at), '[]')
          FROM ownership_claims o2
          JOIN lost_reports r2 ON r2.report_id = o2.report_id
          JOIN users u2 ON u2.user_id = r2.user_id
         WHERE o2.item_id = oc.item_id AND o2.claim_id <> oc.claim_id) AS other_claims,
       (SELECT coalesce(jsonb_agg(jsonb_build_object('photo_id', p.photo_id, 'is_primary', p.is_primary)
                  ORDER BY p.is_primary DESC, p.photo_id), '[]')
          FROM item_photos p WHERE p.item_id = i.item_id) AS photos
FROM ownership_claims oc
JOIN lost_reports r       ON r.report_id = oc.report_id
JOIN users u              ON u.user_id = r.user_id
JOIN categories rc        ON rc.category_id = r.category_id
LEFT JOIN colours rcol    ON rcol.colour_id = r.colour_id
LEFT JOIN locations rl    ON rl.location_id = r.lost_location_id
JOIN found_items i        ON i.item_id = oc.item_id
JOIN categories ic        ON ic.category_id = i.category_id
JOIN colours icol         ON icol.colour_id = i.colour_id
JOIN locations il         ON il.location_id = i.found_location_id
LEFT JOIN found_item_private fp ON fp.item_id = i.item_id
LEFT JOIN potential_matches pm  ON pm.report_id = oc.report_id AND pm.item_id = oc.item_id
LEFT JOIN users ad        ON ad.user_id = oc.decided_by;

CREATE VIEW v_admin_pending_handovers AS
SELECT oc.claim_id, oc.reference_code, oc.decided_at AS approved_at, oc.pickup_instructions,
       oc.pickup_deadline, (oc.pickup_deadline < now()) AS overdue,
       u.full_name AS student_name, u.roll_no AS student_roll_no, u.email AS student_email,
       i.item_id, i.reference_code AS item_ref, c.name AS category, i.public_description,
       i.storage_location, ad.full_name AS approved_by_name
FROM ownership_claims oc
JOIN lost_reports r ON r.report_id = oc.report_id
JOIN users u ON u.user_id = r.user_id
JOIN found_items i ON i.item_id = oc.item_id
JOIN categories c ON c.category_id = i.category_id
LEFT JOIN users ad ON ad.user_id = oc.decided_by
WHERE oc.status = 'APPROVED';

CREATE VIEW v_admin_handovers AS
SELECT h.handover_id, h.handed_at, h.id_document_checked, h.id_verified, h.notes,
       ha.full_name AS handed_over_by_name,
       oc.claim_id, oc.reference_code AS claim_ref,
       u.full_name AS student_name, u.roll_no AS student_roll_no,
       i.item_id, i.reference_code AS item_ref, c.name AS category, i.public_description
FROM handovers h
JOIN users ha ON ha.user_id = h.handed_over_by
JOIN ownership_claims oc ON oc.claim_id = h.claim_id
JOIN lost_reports r ON r.report_id = oc.report_id
JOIN users u ON u.user_id = r.user_id
JOIN found_items i ON i.item_id = oc.item_id
JOIN categories c ON c.category_id = i.category_id;

-- Aggregate dashboard figures (single row).
CREATE VIEW v_dashboard_stats AS
SELECT
    (SELECT count(*) FROM lost_reports)::int                                              AS total_lost_reports,
    (SELECT count(*) FROM lost_reports WHERE status IN ('ACTIVE', 'MATCHED'))::int        AS open_lost_reports,
    (SELECT count(*) FROM found_items WHERE status IN ('IN_CUSTODY', 'CLAIM_PENDING'))::int AS items_in_custody,
    (SELECT count(*) FROM found_items WHERE status = 'DRAFT')::int                        AS draft_items,
    (SELECT count(*) FROM ownership_claims WHERE status IN ('PENDING', 'QUEUED'))::int     AS pending_claims,
    (SELECT count(*) FROM ownership_claims WHERE status = 'APPROVED')::int                 AS awaiting_pickup,
    (SELECT count(*) FROM found_items WHERE status = 'RETURNED')::int                     AS returned_items,
    (SELECT count(*) FROM found_items WHERE status = 'ARCHIVED')::int                     AS archived_items,
    (SELECT count(*) FROM users WHERE role = 'student')::int                              AS students;

-- GROUP BY / HAVING: items per category and status.
CREATE VIEW v_admin_category_stats AS
SELECT c.name AS category, c.category_group, i.status, count(*)::int AS items
FROM found_items i JOIN categories c ON c.category_id = i.category_id
GROUP BY c.name, c.category_group, i.status
HAVING count(*) > 0;

CREATE VIEW v_admin_audit AS
SELECT a.log_id, a.at, a.action, a.target_table, a.target_id, a.details,
       a.actor_id, u.full_name AS actor_name, u.role AS actor_role
FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_id;

CREATE VIEW v_admin_students AS
SELECT u.user_id, u.full_name, u.email, u.roll_no, u.is_active, u.created_at, u.last_login_at,
       (SELECT count(*) FROM lost_reports r WHERE r.user_id = u.user_id)::int AS reports,
       (SELECT count(*) FROM ownership_claims oc JOIN lost_reports r ON r.report_id = oc.report_id
         WHERE r.user_id = u.user_id)::int AS claims
FROM users u WHERE u.role = 'student';

-- Combined status history for one item's timeline (admin).
CREATE VIEW v_admin_item_history AS
SELECT h.item_id, h.old_status, h.new_status, h.reason, h.changed_at, u.full_name AS changed_by_name
FROM item_status_history h LEFT JOIN users u ON u.user_id = h.changed_by;

CREATE VIEW v_admin_claim_history AS
SELECT h.claim_id, h.old_status, h.new_status, h.reason, h.changed_at, u.full_name AS changed_by_name
FROM claim_status_history h LEFT JOIN users u ON u.user_id = h.changed_by;

CREATE VIEW v_admin_report_history AS
SELECT h.report_id, h.old_status, h.new_status, h.reason, h.changed_at, u.full_name AS changed_by_name
FROM report_status_history h LEFT JOIN users u ON u.user_id = h.changed_by;
