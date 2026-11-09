-- =============================================================================
-- CampusFind — 02_indexes.sql
-- PostgreSQL does NOT index foreign-key columns automatically. Every FK used in
-- joins or ON DELETE checks gets a B-tree here. Partial indexes target the
-- exact predicates the matching engine and dashboards use.
-- (Unique / partial-unique indexes that act as constraints live in 01_tables.sql.)
-- =============================================================================

-- found_items ---------------------------------------------------------------
CREATE INDEX found_items_category_idx        ON found_items (category_id);
CREATE INDEX found_items_colour_idx          ON found_items (colour_id);
CREATE INDEX found_items_location_idx        ON found_items (found_location_id);
CREATE INDEX found_items_created_by_idx      ON found_items (created_by_admin);
CREATE INDEX found_items_status_category_idx ON found_items (status, category_id);
CREATE INDEX found_items_found_at_idx        ON found_items (found_at DESC);
-- The matching engine only ever scans items that are in custody:
CREATE INDEX found_items_matchable_idx       ON found_items (category_id)
    WHERE status IN ('IN_CUSTODY', 'CLAIM_PENDING');
-- Trigram GIN indexes for fuzzy text search / similarity filters.
CREATE INDEX found_items_desc_trgm_idx       ON found_items USING gin (public_description gin_trgm_ops);
CREATE INDEX found_items_marks_trgm_idx      ON found_items USING gin (visible_marks gin_trgm_ops);

CREATE INDEX item_photos_item_idx            ON item_photos (item_id);
CREATE INDEX finder_statements_item_idx      ON finder_statements (item_id);
CREATE INDEX verification_questions_item_idx ON verification_questions (item_id);

-- lost_reports --------------------------------------------------------------
CREATE INDEX lost_reports_user_status_idx    ON lost_reports (user_id, status);
CREATE INDEX lost_reports_category_idx       ON lost_reports (category_id);
CREATE INDEX lost_reports_colour_idx         ON lost_reports (colour_id);
CREATE INDEX lost_reports_location_idx       ON lost_reports (lost_location_id);
CREATE INDEX lost_reports_status_idx         ON lost_reports (status);
CREATE INDEX lost_reports_lost_at_idx        ON lost_reports (lost_at DESC);
CREATE INDEX lost_reports_active_cat_idx     ON lost_reports (category_id) WHERE status = 'ACTIVE';
CREATE INDEX lost_reports_desc_trgm_idx      ON lost_reports USING gin (description gin_trgm_ops);

-- matches / claims ----------------------------------------------------------
CREATE INDEX potential_matches_item_idx        ON potential_matches (item_id);
CREATE INDEX potential_matches_report_score_idx ON potential_matches (report_id, score DESC);

CREATE INDEX ownership_claims_report_idx     ON ownership_claims (report_id);
CREATE INDEX ownership_claims_item_status_idx ON ownership_claims (item_id, status);
CREATE INDEX ownership_claims_status_idx     ON ownership_claims (status, created_at);
CREATE INDEX ownership_claims_decided_by_idx ON ownership_claims (decided_by);

CREATE INDEX claim_responses_question_idx    ON claim_responses (question_id);
CREATE INDEX claim_evidence_claim_idx        ON claim_evidence (claim_id);
CREATE INDEX handovers_admin_idx             ON handovers (handed_over_by);

-- history / notifications / audit ---------------------------------------------
CREATE INDEX claim_status_history_claim_idx   ON claim_status_history (claim_id, changed_at);
CREATE INDEX item_status_history_item_idx     ON item_status_history (item_id, changed_at);
CREATE INDEX report_status_history_report_idx ON report_status_history (report_id, changed_at);

CREATE INDEX notifications_user_unread_idx   ON notifications (user_id, is_read, created_at DESC);
CREATE INDEX notifications_report_idx        ON notifications (report_id);
CREATE INDEX notifications_claim_idx         ON notifications (claim_id);

CREATE INDEX audit_log_actor_idx             ON audit_log (actor_id, at DESC);
CREATE INDEX audit_log_target_idx            ON audit_log (target_table, target_id);
CREATE INDEX audit_log_action_idx            ON audit_log (action, at DESC);

CREATE INDEX location_distance_b_idx         ON location_distance (location_b);
