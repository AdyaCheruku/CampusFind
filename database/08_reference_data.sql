-- =============================================================================
-- CampusFind — 08_reference_data.sql
-- Configuration, status-transition rules and lookup data.
-- Idempotent: safe to run repeatedly (ON CONFLICT DO NOTHING on natural keys).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Configuration
-- ---------------------------------------------------------------------------
INSERT INTO app_config (key, value, description) VALUES
    ('weight_category',          '20',   'Match weight: category'),
    ('weight_brand_model',       '20',   'Match weight: brand / model'),
    ('weight_colour',            '15',   'Match weight: colour'),
    ('weight_location',          '15',   'Match weight: location proximity'),
    ('weight_time',              '10',   'Match weight: time proximity'),
    ('weight_description',       '10',   'Match weight: description similarity (pg_trgm)'),
    ('weight_features',          '10',   'Match weight: unique features vs visible marks'),
    ('related_category_factor',  '0.25', 'Share of the category weight given when categories differ but are in the same group'),
    ('candidate_threshold',      '40',   'Minimum score for a pair to be shown to a student'),
    ('match_store_floor',        '20',   'Minimum score for a pair to be stored (admin can see near misses)'),
    ('top_n',                    '5',    'Maximum candidates shown per lost report'),
    ('max_active_reports',       '5',    'Maximum ACTIVE + MATCHED reports per student'),
    ('max_claims_per_day',       '3',    'Maximum claims (incl. appeals) per student per 24 hours'),
    ('time_half_life_hours',     '72',   'Time factor halves every N hours between loss and find'),
    ('time_tolerance_hours',     '12',   'Allowed slack when an item is found slightly before the reported loss time'),
    ('zone_default_proximity',   '0.4',  'Proximity for two places in the same zone with no explicit distance row'),
    ('unsure_location_proximity','0.3',  'Proximity used when the owner is unsure where it was lost'),
    ('archive_after_days',       '60',   'Items unclaimed this long can be archived by maintenance'),
    ('report_expiry_days',       '90',   'Active reports older than this are closed by maintenance'),
    ('report_max_age_days',      '60',   'A report''s loss date cannot be older than this'),
    ('allowed_email_domain',     '""',   'Required student email domain, e.g. "college.edu" (empty = any)')
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Allowed status transitions (enforced by trg_check_status_transition)
-- ---------------------------------------------------------------------------
INSERT INTO status_transitions (entity, from_status, to_status, description) VALUES
    ('FOUND_ITEM',  'DRAFT',         'IN_CUSTODY',    'Admin publishes the item; matching runs'),
    ('FOUND_ITEM',  'IN_CUSTODY',    'CLAIM_PENDING', 'First claim received; item reserved during review'),
    ('FOUND_ITEM',  'CLAIM_PENDING', 'IN_CUSTODY',    'Last open claim rejected; item available again'),
    ('FOUND_ITEM',  'CLAIM_PENDING', 'RETURNED',      'Physical handover recorded'),
    ('FOUND_ITEM',  'IN_CUSTODY',    'ARCHIVED',      'Unclaimed beyond the retention period'),
    ('FOUND_ITEM',  'ARCHIVED',      'IN_CUSTODY',    'Admin restores an archived item; matching re-runs'),
    ('LOST_REPORT', 'ACTIVE',        'MATCHED',       'Student submitted a claim'),
    ('LOST_REPORT', 'MATCHED',       'ACTIVE',        'Claim rejected; report searching again'),
    ('LOST_REPORT', 'MATCHED',       'RESOLVED',      'Item handed over to the student'),
    ('LOST_REPORT', 'ACTIVE',        'WITHDRAWN',     'Student withdrew the report (logged)'),
    ('LOST_REPORT', 'ACTIVE',        'CLOSED',        'Admin closed or report expired'),
    ('CLAIM',       'QUEUED',        'PENDING',       'Promoted from the queue (FIFO)'),
    ('CLAIM',       'QUEUED',        'REJECTED',      'Rejected while queued, or item returned to another owner'),
    ('CLAIM',       'PENDING',       'APPROVED',      'Admin verified ownership'),
    ('CLAIM',       'PENDING',       'REJECTED',      'Admin rejected with a reason'),
    ('CLAIM',       'APPROVED',      'COMPLETED',     'Physical handover recorded'),
    ('CLAIM',       'APPROVED',      'REJECTED',      'ID check failed at the desk or not collected by the deadline')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- Categories (grouped: students only see items from a compatible group)
-- ---------------------------------------------------------------------------
INSERT INTO categories (name, category_group) VALUES
    ('Phone',                 'Electronics'),
    ('Laptop / Tablet',       'Electronics'),
    ('Earbuds / Headphones',  'Electronics'),
    ('Charger / Cable',       'Electronics'),
    ('Calculator',            'Electronics'),
    ('Smartwatch',            'Electronics'),
    ('Wallet / Purse',        'Personal Items'),
    ('Keys',                  'Personal Items'),
    ('Spectacles',            'Personal Items'),
    ('ID / Cards',            'Personal Items'),
    ('Jewellery',             'Personal Items'),
    ('Backpack / Bag',        'Bags & Clothing'),
    ('Jacket / Hoodie',       'Bags & Clothing'),
    ('Umbrella',              'Bags & Clothing'),
    ('Books / Notebooks',     'Books & Stationery'),
    ('Stationery',            'Books & Stationery'),
    ('Water Bottle',          'Bottles & Containers'),
    ('Lunch Box',             'Bottles & Containers'),
    ('Sports Equipment',      'Sports & Other'),
    ('Other',                 'Sports & Other')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Colours (families give partial colour points)
-- ---------------------------------------------------------------------------
INSERT INTO colours (name, colour_family, hex) VALUES
    ('Black',       'Black',  '#1F2328'),
    ('Grey',        'Grey',   '#8A8F98'),
    ('Silver',      'Grey',   '#C0C4C8'),
    ('White',       'White',  '#F4F4F2'),
    ('Cream',       'White',  '#EFE6D2'),
    ('Brown',       'Brown',  '#7A4E2D'),
    ('Tan / Beige', 'Brown',  '#C8A97E'),
    ('Blue',        'Blue',   '#2F6FD0'),
    ('Navy',        'Blue',   '#1F2F5C'),
    ('Sky Blue',    'Blue',   '#7DB7E8'),
    ('Red',         'Red',    '#C8372D'),
    ('Maroon',      'Red',    '#6E1F2A'),
    ('Pink',        'Pink',   '#E58FB0'),
    ('Green',       'Green',  '#2E8B57'),
    ('Olive',       'Green',  '#6B7A3A'),
    ('Yellow',      'Yellow', '#E8C547'),
    ('Gold',        'Yellow', '#C9A227'),
    ('Orange',      'Orange', '#E07B2E'),
    ('Purple',      'Purple', '#7A4FA8'),
    ('Multicolour', 'Multi',  '#9B8CB8'),
    ('Transparent', 'Multi',  '#DDE6EA')
ON CONFLICT (name) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Campus locations (zone = coarse area; distances refine within/between zones)
-- ---------------------------------------------------------------------------
INSERT INTO locations (name, building, zone) VALUES
    ('Main Building',          'Admin Block',         'Academic'),
    ('Block A',                'Academic Block A',    'Academic'),
    ('Block B',                'Academic Block B',    'Academic'),
    ('Block C',                'Academic Block C',    'Academic'),
    ('Central Library',        'Library',             'Academic'),
    ('Computer Lab Complex',   'IT Block',            'Academic'),
    ('Seminar Hall',           'Main Building',       'Academic'),
    ('Central Canteen',        'Canteen',             'Amenities'),
    ('Food Court',             'Food Court',          'Amenities'),
    ('Student Activity Centre','SAC',                 'Amenities'),
    ('Auditorium',             'Auditorium',          'Amenities'),
    ('Sports Complex',         'Indoor Sports',       'Sports'),
    ('Cricket Ground',         'Grounds',             'Sports'),
    ('Gym',                    'Indoor Sports',       'Sports'),
    ('Boys Hostel',            'Hostel Block 1',      'Residential'),
    ('Girls Hostel',           'Hostel Block 2',      'Residential'),
    ('Main Gate',              'Gate',                'Entry'),
    ('Parking Area',           'Parking',             'Entry'),
    ('Bus Stop',               'Bus Bay',             'Entry')
ON CONFLICT (name) DO NOTHING;

-- Pairwise proximity (0..1). Each pair stored once with location_a < location_b
-- (LEAST/GREATEST applied here so the insert order of names does not matter).
INSERT INTO location_distance (location_a, location_b, proximity)
SELECT LEAST(a.location_id, b.location_id), GREATEST(a.location_id, b.location_id), d.proximity
FROM (VALUES
    ('Main Building',        'Seminar Hall',            0.95),
    ('Main Building',        'Block A',                 0.80),
    ('Main Building',        'Central Library',         0.70),
    ('Block A',              'Block B',                 0.90),
    ('Block B',              'Block C',                 0.90),
    ('Block A',              'Block C',                 0.70),
    ('Block A',              'Central Library',         0.75),
    ('Block B',              'Computer Lab Complex',    0.85),
    ('Block C',              'Computer Lab Complex',    0.80),
    ('Central Library',      'Computer Lab Complex',    0.65),
    ('Central Library',      'Central Canteen',         0.55),
    ('Block C',              'Central Canteen',         0.60),
    ('Central Canteen',      'Food Court',              0.85),
    ('Central Canteen',      'Student Activity Centre', 0.75),
    ('Food Court',           'Student Activity Centre', 0.80),
    ('Student Activity Centre','Auditorium',            0.85),
    ('Seminar Hall',         'Auditorium',              0.50),
    ('Sports Complex',       'Gym',                     0.95),
    ('Sports Complex',       'Cricket Ground',          0.75),
    ('Gym',                  'Cricket Ground',          0.65),
    ('Food Court',           'Sports Complex',          0.45),
    ('Boys Hostel',          'Girls Hostel',            0.50),
    ('Boys Hostel',          'Sports Complex',          0.55),
    ('Girls Hostel',         'Food Court',              0.50),
    ('Main Gate',            'Parking Area',            0.85),
    ('Main Gate',            'Bus Stop',                0.90),
    ('Parking Area',         'Bus Stop',                0.75),
    ('Main Gate',            'Main Building',           0.50)
) AS d(name_a, name_b, proximity)
JOIN locations a ON a.name = d.name_a
JOIN locations b ON b.name = d.name_b
ON CONFLICT (location_a, location_b) DO NOTHING;
