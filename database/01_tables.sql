-- =============================================================================
-- CampusFind — 01_tables.sql
-- Tables, keys and declarative constraints (PK, FK, UNIQUE, NOT NULL, CHECK).
--
-- Conventions
--   * Surrogate keys: bigint GENERATED ALWAYS AS IDENTITY (SQL-standard; the
--     application can never supply its own id). Lookup tables use integer.
--   * All times are timestamptz.
--   * Status columns are text + CHECK; legal *transitions* live in the
--     status_transitions table and are enforced by a trigger (03_triggers.sql).
--   * ON DELETE RESTRICT is the default for auditable records; CASCADE is used
--     only for data that is meaningless without its parent AND whose parent can
--     only be deleted while it is still a DRAFT.
-- Runs as role campusfind_owner with search_path = campusfind, public.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- USERS: one table for both roles. Role is a CHECK (only two fixed roles, a
-- separate roles table would add a join without adding information).
-- ---------------------------------------------------------------------------
CREATE TABLE users (
    user_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    full_name      text        NOT NULL CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 100),
    email          text        NOT NULL CHECK (char_length(email) <= 254
                                               AND email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
    roll_no        text        CHECK (roll_no IS NULL OR char_length(btrim(roll_no)) BETWEEN 3 AND 30),
    password_hash  text        NOT NULL,
    role           text        NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'admin')),
    is_active      boolean     NOT NULL DEFAULT true,
    created_at     timestamptz NOT NULL DEFAULT now(),
    last_login_at  timestamptz,
    -- Students must give a roll number: the admin checks it against the
    -- college ID card at handover.
    CONSTRAINT users_student_roll_no_chk CHECK (role = 'admin' OR roll_no IS NOT NULL)
);
-- Case-insensitive uniqueness (expression indexes act as UNIQUE constraints).
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));
CREATE UNIQUE INDEX users_roll_no_upper_uq ON users (upper(roll_no)) WHERE roll_no IS NOT NULL;

-- ---------------------------------------------------------------------------
-- LOOKUP TABLES (3NF: names/groups/zones stored once, referenced by id)
-- ---------------------------------------------------------------------------
CREATE TABLE categories (
    category_id     integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name            text    NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 50),
    -- "Compatible category" rule: students only ever see items in the same group.
    category_group  text    NOT NULL CHECK (char_length(category_group) BETWEEN 2 AND 50),
    is_active       boolean NOT NULL DEFAULT true
);

CREATE TABLE colours (
    colour_id      integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           text NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 30),
    -- Navy and Sky Blue are both family "Blue" -> partial colour points.
    colour_family  text NOT NULL CHECK (char_length(colour_family) BETWEEN 2 AND 30),
    hex            text NOT NULL DEFAULT '#888888' CHECK (hex ~ '^#[0-9A-Fa-f]{6}$')
);

CREATE TABLE locations (
    location_id  integer GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name         text    NOT NULL UNIQUE CHECK (char_length(name) BETWEEN 2 AND 80),
    building     text,
    zone         text    NOT NULL CHECK (char_length(zone) BETWEEN 2 AND 40),
    is_active    boolean NOT NULL DEFAULT true
);

-- Self N:M on locations. Each unordered pair stored exactly once (a < b);
-- lookups use LEAST/GREATEST so A-B and B-A give the same proximity.
CREATE TABLE location_distance (
    location_a  integer      NOT NULL REFERENCES locations (location_id) ON DELETE CASCADE,
    location_b  integer      NOT NULL REFERENCES locations (location_id) ON DELETE CASCADE,
    proximity   numeric(3,2) NOT NULL CHECK (proximity BETWEEN 0 AND 1),
    PRIMARY KEY (location_a, location_b),
    CONSTRAINT location_distance_order_chk CHECK (location_a < location_b)
);

-- ---------------------------------------------------------------------------
-- CONFIGURATION (weights, thresholds, limits) and STATUS TRANSITION RULES
-- ---------------------------------------------------------------------------
CREATE TABLE app_config (
    key          text        PRIMARY KEY CHECK (key ~ '^[a-z_]+$'),
    value        jsonb       NOT NULL,
    description  text        NOT NULL,
    updated_at   timestamptz NOT NULL DEFAULT now(),
    updated_by   bigint      REFERENCES users (user_id)
);

-- Allowed status transitions are DATA, not code. One generic trigger checks
-- every status change against this table.
CREATE TABLE status_transitions (
    entity       text NOT NULL CHECK (entity IN ('FOUND_ITEM', 'LOST_REPORT', 'CLAIM')),
    from_status  text NOT NULL,
    to_status    text NOT NULL,
    description  text NOT NULL,
    PRIMARY KEY (entity, from_status, to_status),
    CHECK (from_status <> to_status)
);

-- ---------------------------------------------------------------------------
-- FOUND ITEMS (admin custody)
-- ---------------------------------------------------------------------------
CREATE TABLE found_items (
    item_id                bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reference_code         text GENERATED ALWAYS AS ('FI-' || lpad(item_id::text, 5, '0')) STORED UNIQUE,
    category_id            integer     NOT NULL REFERENCES categories (category_id),
    brand                  text        CHECK (brand IS NULL OR char_length(brand) <= 60),
    model                  text        CHECK (model IS NULL OR char_length(model) <= 80),
    colour_id              integer     NOT NULL REFERENCES colours (colour_id),
    size_desc              text        CHECK (size_desc IS NULL OR char_length(size_desc) <= 60),
    contents               text        CHECK (contents IS NULL OR char_length(contents) <= 500),
    -- Admin-written visible marks: used by matching, NOT shown to students.
    visible_marks          text        CHECK (visible_marks IS NULL OR char_length(visible_marks) <= 500),
    -- The only free text students ever see; admin keeps it deliberately general.
    public_description     text        NOT NULL CHECK (char_length(btrim(public_description)) BETWEEN 10 AND 500),
    found_location_id      integer     NOT NULL REFERENCES locations (location_id),
    found_location_detail  text        CHECK (found_location_detail IS NULL OR char_length(found_location_detail) <= 120),
    found_at               timestamptz NOT NULL,
    storage_location       text        NOT NULL CHECK (char_length(btrim(storage_location)) BETWEEN 1 AND 80),
    status                 text        NOT NULL DEFAULT 'DRAFT'
                           CHECK (status IN ('DRAFT', 'IN_CUSTODY', 'CLAIM_PENDING', 'RETURNED', 'ARCHIVED')),
    created_by_admin       bigint      NOT NULL REFERENCES users (user_id),
    published_at           timestamptz,
    published_by           bigint      REFERENCES users (user_id),
    created_at             timestamptz NOT NULL DEFAULT now(),
    updated_at             timestamptz NOT NULL DEFAULT now(),
    status_changed_at      timestamptz NOT NULL DEFAULT now(),
    -- A DRAFT has never been published; anything else has.
    CONSTRAINT found_items_published_chk CHECK ((status = 'DRAFT') = (published_at IS NULL)),
    CONSTRAINT found_items_publisher_chk CHECK (published_at IS NULL OR published_by IS NOT NULL),
    CONSTRAINT found_items_found_before_created_chk CHECK (found_at <= created_at + interval '5 minutes')
);

-- 1:1 vertical split: admin-only identifying details. student_app has NO grant
-- on this table at all, so the privacy boundary is physical.
CREATE TABLE found_item_private (
    item_id        bigint PRIMARY KEY REFERENCES found_items (item_id) ON DELETE CASCADE,
    serial_no      text   CHECK (serial_no IS NULL OR char_length(serial_no) <= 80),
    hidden_marks   text   CHECK (hidden_marks IS NULL OR char_length(hidden_marks) <= 500),
    private_notes  text   CHECK (private_notes IS NULL OR char_length(private_notes) <= 1000),
    updated_at     timestamptz NOT NULL DEFAULT now(),
    updated_by     bigint REFERENCES users (user_id)
);

CREATE TABLE item_photos (
    photo_id       bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id        bigint      NOT NULL REFERENCES found_items (item_id) ON DELETE CASCADE,
    original_path  text        NOT NULL UNIQUE,   -- admin-only
    blurred_path   text        NOT NULL UNIQUE,   -- what students receive
    mime_type      text        NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
    size_bytes     integer     NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
    is_primary     boolean     NOT NULL DEFAULT false,
    uploaded_by    bigint      NOT NULL REFERENCES users (user_id),
    uploaded_at    timestamptz NOT NULL DEFAULT now()
);
-- At most one primary photo per item (partial unique index).
CREATE UNIQUE INDEX item_photos_one_primary_uq ON item_photos (item_id) WHERE is_primary;

CREATE TABLE finder_statements (
    statement_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id         bigint      NOT NULL REFERENCES found_items (item_id) ON DELETE CASCADE,
    finder_name     text        NOT NULL CHECK (char_length(btrim(finder_name)) BETWEEN 2 AND 100),
    finder_contact  text        CHECK (finder_contact IS NULL OR char_length(finder_contact) <= 100),
    finder_roll_no  text        CHECK (finder_roll_no IS NULL OR char_length(finder_roll_no) <= 30),
    found_where     text        NOT NULL CHECK (char_length(btrim(found_where)) BETWEEN 2 AND 200),
    found_when      timestamptz,
    circumstances   text        CHECK (circumstances IS NULL OR char_length(circumstances) <= 1000),
    recorded_by     bigint      NOT NULL REFERENCES users (user_id),
    recorded_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE verification_questions (
    question_id      bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    item_id          bigint      NOT NULL REFERENCES found_items (item_id) ON DELETE CASCADE,
    question_text    text        NOT NULL CHECK (char_length(btrim(question_text)) BETWEEN 5 AND 200),
    expected_answer  text        NOT NULL CHECK (char_length(btrim(expected_answer)) BETWEEN 1 AND 200),
    created_by       bigint      NOT NULL REFERENCES users (user_id),
    created_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (item_id, question_text)
);

-- ---------------------------------------------------------------------------
-- LOST REPORTS (student). Locked at insert: locked_at = created_at, and a
-- trigger rejects any later change to identifying columns.
-- ---------------------------------------------------------------------------
CREATE TABLE lost_reports (
    report_id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reference_code        text GENERATED ALWAYS AS ('LR-' || lpad(report_id::text, 5, '0')) STORED UNIQUE,
    user_id               bigint      NOT NULL REFERENCES users (user_id),
    category_id           integer     NOT NULL REFERENCES categories (category_id),
    brand                 text        CHECK (brand IS NULL OR char_length(brand) <= 60),
    model                 text        CHECK (model IS NULL OR char_length(model) <= 80),
    colour_id             integer     REFERENCES colours (colour_id),       -- NULL = "not sure"
    description           text        NOT NULL CHECK (char_length(btrim(description)) BETWEEN 20 AND 1000),
    features              text        CHECK (features IS NULL OR char_length(features) <= 500),
    -- Used ONLY for admin ownership verification, never for matching.
    serial_hint           text        CHECK (serial_hint IS NULL OR char_length(serial_hint) <= 80),
    lost_location_id      integer     REFERENCES locations (location_id),   -- NULL = "not sure"
    lost_location_detail  text        CHECK (lost_location_detail IS NULL OR char_length(lost_location_detail) <= 120),
    lost_at               timestamptz NOT NULL,
    proof_photo_path      text        UNIQUE,
    locked_at             timestamptz NOT NULL DEFAULT now(),
    status                text        NOT NULL DEFAULT 'ACTIVE'
                          CHECK (status IN ('ACTIVE', 'MATCHED', 'RESOLVED', 'CLOSED', 'WITHDRAWN')),
    withdrawn_reason      text        CHECK (withdrawn_reason IS NULL OR char_length(btrim(withdrawn_reason)) BETWEEN 5 AND 300),
    closed_reason         text        CHECK (closed_reason IS NULL OR char_length(btrim(closed_reason)) BETWEEN 3 AND 300),
    created_at            timestamptz NOT NULL DEFAULT now(),
    status_changed_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT lost_reports_withdraw_reason_chk CHECK (status <> 'WITHDRAWN' OR withdrawn_reason IS NOT NULL),
    CONSTRAINT lost_reports_close_reason_chk    CHECK (status <> 'CLOSED' OR closed_reason IS NOT NULL),
    CONSTRAINT lost_reports_locked_chk          CHECK (locked_at = created_at),
    CONSTRAINT lost_reports_lost_before_report_chk CHECK (lost_at <= created_at + interval '5 minutes')
);

-- ---------------------------------------------------------------------------
-- POTENTIAL MATCHES: resolves the N:M between lost_reports and found_items.
-- score/breakdown are a deliberate, documented cache of compute_match_score().
-- ---------------------------------------------------------------------------
CREATE TABLE potential_matches (
    report_id          bigint       NOT NULL REFERENCES lost_reports (report_id),
    item_id            bigint       NOT NULL REFERENCES found_items (item_id),
    score              numeric(5,2) NOT NULL CHECK (score BETWEEN 0 AND 100),
    breakdown          jsonb        NOT NULL,
    dismissed          boolean      NOT NULL DEFAULT false,
    dismissed_at       timestamptz,
    notified_at        timestamptz,
    first_computed_at  timestamptz  NOT NULL DEFAULT now(),
    computed_at        timestamptz  NOT NULL DEFAULT now(),
    PRIMARY KEY (report_id, item_id),
    CONSTRAINT potential_matches_dismiss_chk CHECK (dismissed = (dismissed_at IS NOT NULL))
);

-- ---------------------------------------------------------------------------
-- OWNERSHIP CLAIMS. The composite FK to potential_matches means a student can
-- only ever claim an item that was actually matched to their report.
-- The claimant is NOT stored (it is claim -> report -> user: storing it would
-- be a transitive dependency, violating 3NF).
-- ---------------------------------------------------------------------------
CREATE TABLE ownership_claims (
    claim_id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    reference_code        text GENERATED ALWAYS AS ('CL-' || lpad(claim_id::text, 5, '0')) STORED UNIQUE,
    report_id             bigint       NOT NULL,
    item_id               bigint       NOT NULL,
    status                text         NOT NULL DEFAULT 'PENDING'
                          CHECK (status IN ('QUEUED', 'PENDING', 'APPROVED', 'REJECTED', 'COMPLETED')),
    -- Historical snapshot: the score the claim was made on (live score may be recomputed).
    match_score_at_claim  numeric(5,2) NOT NULL CHECK (match_score_at_claim BETWEEN 0 AND 100),
    appeal_of_claim_id    bigint       UNIQUE REFERENCES ownership_claims (claim_id),
    appeal_statement      text         CHECK (appeal_statement IS NULL OR char_length(btrim(appeal_statement)) BETWEEN 10 AND 1000),
    decided_by            bigint       REFERENCES users (user_id),
    decision_reason       text         CHECK (decision_reason IS NULL OR char_length(btrim(decision_reason)) BETWEEN 5 AND 1000),
    decided_at            timestamptz,
    pickup_instructions   text         CHECK (pickup_instructions IS NULL OR char_length(btrim(pickup_instructions)) BETWEEN 5 AND 500),
    pickup_deadline       timestamptz,
    created_at            timestamptz  NOT NULL DEFAULT now(),
    status_changed_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT ownership_claims_match_fk FOREIGN KEY (report_id, item_id)
        REFERENCES potential_matches (report_id, item_id) ON DELETE RESTRICT,
    CONSTRAINT ownership_claims_appeal_chk CHECK ((appeal_of_claim_id IS NULL) = (appeal_statement IS NULL)),
    CONSTRAINT ownership_claims_not_self_appeal_chk CHECK (appeal_of_claim_id IS NULL OR appeal_of_claim_id <> claim_id),
    CONSTRAINT ownership_claims_decision_chk CHECK (
        status IN ('QUEUED', 'PENDING')
        OR (decided_by IS NOT NULL AND decision_reason IS NOT NULL AND decided_at IS NOT NULL)),
    CONSTRAINT ownership_claims_pickup_chk CHECK (
        status NOT IN ('APPROVED', 'COMPLETED')
        OR (pickup_instructions IS NOT NULL AND pickup_deadline IS NOT NULL))
);
-- One ACTIVE (pending/approved) claim per found item; later claimants are QUEUED.
CREATE UNIQUE INDEX ownership_claims_one_active_per_item_uq
    ON ownership_claims (item_id) WHERE status IN ('PENDING', 'APPROVED');
-- One OPEN claim per lost report.
CREATE UNIQUE INDEX ownership_claims_one_open_per_report_uq
    ON ownership_claims (report_id) WHERE status IN ('QUEUED', 'PENDING', 'APPROVED');

CREATE TABLE claim_responses (
    response_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    claim_id     bigint      NOT NULL REFERENCES ownership_claims (claim_id),
    question_id  bigint      NOT NULL REFERENCES verification_questions (question_id),
    answer_text  text        NOT NULL CHECK (char_length(btrim(answer_text)) BETWEEN 1 AND 300),
    answered_at  timestamptz NOT NULL DEFAULT now(),
    UNIQUE (claim_id, question_id)
);

CREATE TABLE claim_evidence (
    evidence_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    claim_id       bigint      NOT NULL REFERENCES ownership_claims (claim_id),
    file_path      text        NOT NULL UNIQUE,
    mime_type      text        NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
    evidence_type  text        NOT NULL CHECK (evidence_type IN ('PHOTO', 'RECEIPT', 'OTHER')),
    note           text        CHECK (note IS NULL OR char_length(note) <= 300),
    uploaded_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- HANDOVERS: 1:0..1 with a claim. The row exists only once the physical
-- handover is confirmed. item_id is NOT stored (derivable via the claim, 3NF).
-- ---------------------------------------------------------------------------
CREATE TABLE handovers (
    handover_id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    claim_id             bigint      NOT NULL UNIQUE REFERENCES ownership_claims (claim_id),
    handed_over_by       bigint      NOT NULL REFERENCES users (user_id),
    id_document_checked  text        NOT NULL CHECK (char_length(btrim(id_document_checked)) BETWEEN 2 AND 80),
    id_verified          boolean     NOT NULL CHECK (id_verified),   -- cannot hand over without ID check
    handed_at            timestamptz NOT NULL DEFAULT now(),
    notes                text        CHECK (notes IS NULL OR char_length(notes) <= 1000)
);

-- ---------------------------------------------------------------------------
-- STATUS HISTORY (one per entity, so each keeps a real FK), written by trigger.
-- ---------------------------------------------------------------------------
CREATE TABLE claim_status_history (
    history_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    claim_id    bigint      NOT NULL REFERENCES ownership_claims (claim_id),
    old_status  text,
    new_status  text        NOT NULL,
    changed_by  bigint      REFERENCES users (user_id),   -- NULL = system
    reason      text,
    changed_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE item_status_history (
    history_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    -- CASCADE only matters for DRAFT items, the only ones that may be deleted.
    item_id     bigint      NOT NULL REFERENCES found_items (item_id) ON DELETE CASCADE,
    old_status  text,
    new_status  text        NOT NULL,
    changed_by  bigint      REFERENCES users (user_id),
    reason      text,
    changed_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE report_status_history (
    history_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    report_id   bigint      NOT NULL REFERENCES lost_reports (report_id),
    old_status  text,
    new_status  text        NOT NULL,
    changed_by  bigint      REFERENCES users (user_id),
    reason      text,
    changed_at  timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- ---------------------------------------------------------------------------
-- NOTIFICATIONS and AUDIT LOG
-- ---------------------------------------------------------------------------
CREATE TABLE notifications (
    notif_id    bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id     bigint      NOT NULL REFERENCES users (user_id),
    type        text        NOT NULL CHECK (type IN (
                    'NEW_MATCH', 'CLAIM_SUBMITTED', 'CLAIM_QUEUED', 'CLAIM_APPROVED',
                    'CLAIM_REJECTED', 'CLAIM_PROMOTED', 'QUEUE_UPDATE', 'ITEM_RETURNED',
                    'REPORT_CLOSED', 'APPEAL_SUBMITTED')),
    title       text        NOT NULL CHECK (char_length(title) BETWEEN 2 AND 120),
    message     text        NOT NULL CHECK (char_length(message) BETWEEN 2 AND 1000),
    report_id   bigint      REFERENCES lost_reports (report_id),
    claim_id    bigint      REFERENCES ownership_claims (claim_id),
    is_read     boolean     NOT NULL DEFAULT false,
    read_at     timestamptz,
    created_at  timestamptz NOT NULL DEFAULT clock_timestamp(),
    CONSTRAINT notifications_read_chk CHECK (is_read = (read_at IS NOT NULL))
);

CREATE TABLE audit_log (
    log_id        bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id      bigint      REFERENCES users (user_id),   -- NULL = system
    action        text        NOT NULL CHECK (action IN (
                      'LOGIN', 'PHOTO_VIEW_BLURRED', 'PHOTO_VIEW_ORIGINAL', 'EVIDENCE_VIEW',
                      'PRIVATE_VIEW', 'ITEM_CREATE', 'ITEM_UPDATE', 'ITEM_PUBLISH', 'ITEM_DRAFT_DELETE',
                      'ITEM_ARCHIVE', 'ITEM_RESTORE', 'REPORT_SUBMIT', 'REPORT_WITHDRAW', 'REPORT_CLOSE',
                      'CANDIDATE_DISMISS', 'CANDIDATES_NONE', 'CLAIM_SUBMIT', 'CLAIM_APPEAL',
                      'CLAIM_APPROVE', 'CLAIM_REJECT', 'HANDOVER', 'USER_STATUS_CHANGE',
                      'CONFIG_CHANGE', 'REMATCH_ALL', 'MAINTENANCE')),
    target_table  text,
    target_id     bigint,
    details       jsonb       NOT NULL DEFAULT '{}'::jsonb,
    at            timestamptz NOT NULL DEFAULT clock_timestamp()
);
