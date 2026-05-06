-- ============================================================================
-- NEE Production Platform - Development Seed Data (002)
-- ----------------------------------------------------------------------------
-- Adds users, user_roles, station_technicians, and two ready-to-use templates
-- (TP42N tipper and DFE-TT67F tautliner) on top of the schema's built-in seed
-- (roles, body_types, job_types, kanban_stages, customers, stations,
--  operation_catalog, operation_aliases, variance_reasons).
--
-- All dev users have the password `nee2026`.
-- The hash below is ASP.NET Core Identity v3 PasswordHasher format.
--
-- Idempotent: safe to run multiple times. Uses ON CONFLICT to skip existing rows.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Users (5 demo accounts, all password 'nee2026')
-- ----------------------------------------------------------------------------
-- Hash for 'nee2026' produced by Microsoft.AspNetCore.Identity.PasswordHasher v3
-- with default options (PBKDF2-HMAC-SHA256, 100k iterations, 128-bit salt).
INSERT INTO users (id, username, email, full_name, short_code, password_hash, is_active) VALUES
    ('11111111-1111-1111-1111-111111111111', 'sales',      'sales@nee.local',      'Brenton Coleby',  'BC', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('22222222-2222-2222-2222-222222222222', 'drafter',    'drafter@nee.local',    'Hai Nguyen',      'HN', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('33333333-3333-3333-3333-333333333333', 'supervisor', 'supervisor@nee.local', 'Dwayne Fender',   'DF', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('44444444-4444-4444-4444-444444444444', 'peter',      'peter@nee.local',      'Peter Rogers',    'Pr', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('55555555-5555-5555-5555-555555555555', 'kane',       'kane@nee.local',       'Kane Bromhead',   'KB', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE)
ON CONFLICT (username) DO NOTHING;

-- NOTE TO DEV: the hash above is a placeholder. On first boot, run this snippet
-- in the API project once to generate a real hash and update the rows:
--
--   var hasher = new PasswordHasher<object>();
--   var h = hasher.HashPassword(null!, "nee2026");
--   // UPDATE users SET password_hash = '<h>' WHERE username IN (...);
--
-- Or use the seed endpoint POST /api/dev/reseed-passwords (see API E1-S2 notes).

-- ----------------------------------------------------------------------------
-- 2. User-role assignments
-- ----------------------------------------------------------------------------
-- Roles already in DB from schema seed: 1=ADMIN, 2=SALES, 3=DRAFTER,
-- 4=SUPERVISOR, 5=STATION_OWNER, 6=TECHNICIAN, 7=QC, 8=COMPLIANCE
INSERT INTO user_roles (user_id, role_id) VALUES
    ('11111111-1111-1111-1111-111111111111', 2),  -- sales -> SALES
    ('22222222-2222-2222-2222-222222222222', 3),  -- drafter -> DRAFTER
    ('33333333-3333-3333-3333-333333333333', 4),  -- supervisor -> SUPERVISOR
    ('33333333-3333-3333-3333-333333333333', 5),  -- supervisor also STATION_OWNER
    ('44444444-4444-4444-4444-444444444444', 6),  -- peter -> TECHNICIAN
    ('55555555-5555-5555-5555-555555555555', 6)   -- kane -> TECHNICIAN
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Station-technician assignments
-- ----------------------------------------------------------------------------
-- Stations are seeded by the schema. Map our techs onto a few of them so the
-- kanban view has someone to assign tasks to.
-- (Run a SELECT to check station codes/ids first if needed.)
INSERT INTO station_technicians (station_id, user_id, is_primary) VALUES
    (20, '44444444-4444-4444-4444-444444444444', TRUE),  -- Peter -> Fab Line
    (30, '55555555-5555-5555-5555-555555555555', TRUE)   -- Kane -> Paint
ON CONFLICT (station_id, user_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 4. Seed templates: TP42N (Tipper 4.2m) and DFE-TT67F (Tautliner 6.7m DFE variant)
-- ----------------------------------------------------------------------------
-- Body types already seeded: 1=TR, 2=TP, 3=TT, 4=DP, 5=CH, 6=TS, 7=VP
-- Job types already seeded: 1=NEW_BUILD (default), 2=REPAIR, etc.
-- Customers already seeded: DFE = Direct Freight Express (look up id below)

-- 4a. TP42N - Tipper 4.2m, base template (no customer variant)
INSERT INTO job_code_templates (code, base_code, customer_id, body_type_id, job_type_id, name, description, body_size_mm, chassis_class, variant_suffix, is_active)
VALUES (
    'TP42N',
    NULL,
    NULL,
    2,                     -- TP body type
    1,                     -- NEW_BUILD job type
    'Tipper 4.2m NPR',
    '3-way tipper body with 650mm dropsides, fitted to NPR-class chassis. Base template.',
    4200,
    'N',
    NULL,
    TRUE
)
ON CONFLICT (code) DO NOTHING;

-- 4b. TT67F - Tautliner 6.7m base template (referenced by DFE-TT67F variant below)
INSERT INTO job_code_templates (code, base_code, customer_id, body_type_id, job_type_id, name, description, body_size_mm, chassis_class, variant_suffix, is_active)
VALUES (
    'TT67F',
    NULL,
    NULL,
    3,                     -- TT body type
    1,
    'Tautliner 6.7m FRR',
    'Standard tautliner 6.7m on FRR chassis. Base template.',
    6700,
    'F',
    NULL,
    TRUE
)
ON CONFLICT (code) DO NOTHING;

-- 4c. DFE-TT67F - Tautliner 6.7m, Direct Freight Express variant (inherits from TT67F)
INSERT INTO job_code_templates (code, base_code, customer_id, body_type_id, job_type_id, name, description, body_size_mm, chassis_class, variant_suffix, is_active)
SELECT
    'DFE-TT67F',
    'TT67F',
    c.id,
    3,                     -- TT body type
    1,
    'Tautliner 6.7m FRR - Direct Freight Express',
    'Tautliner 6.7m on FRR chassis with DFE-specific spec: 5mm chequer floor, side step, 2000kg tilt alloy tailgate, polyweld curtains.',
    6700,
    'F',
    NULL,
    TRUE
FROM customers c WHERE c.code = 'DFE'
ON CONFLICT (code) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 5. Template versions (v1 of each)
-- ----------------------------------------------------------------------------
-- We use deterministic UUIDs so the template_operations rows below can reference
-- them without a sub-query.
INSERT INTO template_versions (id, template_code, version_number, effective_from, total_estimated_hours, approved_by, approval_notes) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'TP42N',     1, now(), 53.50, '33333333-3333-3333-3333-333333333333', 'Initial seed version, calibrated from RO 58276.'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 'DFE-TT67F', 1, now(), 62.50, '33333333-3333-3333-3333-333333333333', 'Initial seed version, calibrated from RO 58734.')
ON CONFLICT (template_code, version_number) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6. Template operations
-- ----------------------------------------------------------------------------
-- Reference: actual operation_catalog ids from schema seed:
--   10 MAT_PROC_CNC         Material processing / CNC               (station 10)
--   20 MFR_BASE             Manufacture base                         (station 20)
--   21 MFR_FRONT_WALL       Manufacture front wall                   (station 20)
--   22 MFR_REAR_WALL        Manufacture rear wall                    (station 20)
--   23 MFR_ROOF             Manufacture roof                         (station 20)
--   24 MFR_HEADBOARD        Manufacture headboard                    (station 20)
--   25 MFR_DROPSIDES        Manufacture dropsides and tailgate       (station 20)
--   31 FAB_LINE_ASSY        Fabrication line assembly                (station 20)
--   40 BODY_FITOUT          Body fitout                              (station 40)
--   41 CHASSIS_PREP_FLITCH  Chassis prep, flitch and electrical      (station 50)
--   50 PAINT_PREP_RUB       Paint prep and rubbing                   (station 30)
--   51 PAINT_PRIME_SEAL     Prime, seal and rub                      (station 30)
--   52 PAINT_FINAL          Final paint                              (station 30)
--   54 PAINT_UNDERSIDE      Underside black and touch up             (station 30)
--   60 FITMENT_INSTALL      Fitment, install body and welddown       (station 70)
--   70 BLUE_PLATE_QC        Blue plate and final QC                  (station 90)

-- TP42N - 12 operations totalling 53.5h
INSERT INTO template_operations (template_version_id, sequence, operation_id, estimated_hours, station_id_override, notes) VALUES
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',  1, 10, 8.00, NULL, NULL),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',  2, 20, 4.00, NULL, '4300mm L x 2480mm W'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',  3, 24, 2.50, NULL, NULL),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',  4, 25, 5.00, NULL, '650mm dropsides + tailgate'),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',  5, 31, 8.00, NULL, NULL),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',  6, 50, 5.00, NULL, NULL),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',  7, 51, 5.00, NULL, NULL),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',  8, 52, 4.00, NULL, NULL),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',  9, 54, 1.50, NULL, NULL),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 10, 40, 1.50, NULL, NULL),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 11, 60, 8.00, NULL, NULL),
    ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 12, 70, 1.00, NULL, NULL)
ON CONFLICT (template_version_id, sequence) DO NOTHING;

-- DFE-TT67F - 13 operations totalling 62.5h
INSERT INTO template_operations (template_version_id, sequence, operation_id, estimated_hours, station_id_override, notes) VALUES
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',  1, 10, 8.00, NULL, NULL),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',  2, 20, 4.50, NULL, '6750mm L x 2480mm W'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',  3, 21, 4.00, NULL, NULL),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',  4, 22, 4.00, NULL, NULL),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',  5, 23, 4.00, NULL, NULL),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',  6, 31, 4.00, NULL, NULL),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',  7, 50, 4.50, NULL, NULL),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',  8, 51, 4.50, NULL, NULL),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',  9, 52, 4.50, NULL, NULL),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 10, 40, 4.00, NULL, NULL),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 11, 41, 4.50, NULL, 'Flitch plates + plastics; electrical prep'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 12, 60, 11.00, NULL, 'Install body and fit tailgate; 1h wiring'),
    ('bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', 13, 70, 1.00, NULL, NULL)
ON CONFLICT (template_version_id, sequence) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 7. Full technician and station-owner roster (one per station, two where needed)
-- ----------------------------------------------------------------------------
-- UUID pattern:
--   7a<station_id_decimal_6>-7777-7777-7777-000000000001  →  station owner / lead
--   7b<station_id_decimal_6>-7777-7777-7777-000000000002  →  second technician
--   7c<station_id_decimal_6>-7777-7777-7777-000000000002  →  third technician
--
-- Station 40 owner (adam, 66666666) is seeded in migration 004 — excluded here
-- to avoid duplicate-username conflicts on fresh installs that run both files.

INSERT INTO users (id, username, email, full_name, short_code, password_hash, is_active) VALUES

    -- Station 10 — Material processing / CNC
    ('7a000010-7777-7777-7777-000000000001', 'marcus', 'marcus@nee.local', 'Marcus Webb',   'MW', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000010-7777-7777-7777-000000000002', 'tom',    'tom@nee.local',    'Tom Sissons',   'TS', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 20 — Fabrication line  (peter already rostered above)
    ('7a000020-7777-7777-7777-000000000001', 'dave',   'dave@nee.local',   'Dave Norris',   'DN', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000020-7777-7777-7777-000000000002', 'ricky',  'ricky@nee.local',  'Ricky Santos',  'RS', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 25 — Robotic fabrication
    ('7a000025-7777-7777-7777-000000000001', 'wei',    'wei@nee.local',    'Wei Zhang',     'WZ', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000025-7777-7777-7777-000000000002', 'jack',   'jack@nee.local',   'Jack Brennan',  'JB', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 30 — Paint and panel  (kane already rostered above)
    ('7a000030-7777-7777-7777-000000000001', 'liam',   'liam@nee.local',   'Liam Cross',    'LC', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000030-7777-7777-7777-000000000002', 'shane',  'shane@nee.local',  'Shane Dooley',  'SD', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 40 — Body fitout B1  (adam seeded in 004; add 2 more techs)
    ('7b000040-7777-7777-7777-000000000001', 'nathan', 'nathan@nee.local', 'Nathan Foley',  'NF', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7c000040-7777-7777-7777-000000000002', 'mick',   'mick@nee.local',   'Mick Farrar',   'MF', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 50 — Chassis prep B3
    ('7a000050-7777-7777-7777-000000000001', 'scott',  'scott@nee.local',  'Scott Barker',  'SB', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000050-7777-7777-7777-000000000002', 'chris',  'chris@nee.local',  'Chris Payne',   'CP', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 60 — HYVA hydraulics
    ('7a000060-7777-7777-7777-000000000001', 'garry',  'garry@nee.local',  'Garry Sloane',  'GS', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000060-7777-7777-7777-000000000002', 'brad',   'brad@nee.local',   'Brad Hogan',    'BH', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 70 — Final fitment B2
    ('7a000070-7777-7777-7777-000000000001', 'tony',   'tony@nee.local',   'Tony Burlack',  'TB', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000070-7777-7777-7777-000000000002', 'jamie',  'jamie@nee.local',  'Jamie Hunt',    'JH', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 80 — Pantech assembly
    ('7a000080-7777-7777-7777-000000000001', 'ray',    'ray@nee.local',    'Ray Gould',     'RG', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000080-7777-7777-7777-000000000002', 'darren', 'darren@nee.local', 'Darren Marsh',  'DM', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 90 — Vehicle compliance and final QC
    ('7a000090-7777-7777-7777-000000000001', 'greg',   'greg@nee.local',   'Greg Sims',     'GS', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000090-7777-7777-7777-000000000002', 'lisa',   'lisa@nee.local',   'Lisa Norris',   'LN', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE)

ON CONFLICT (username) DO NOTHING;

-- 7a. User-role assignments for new accounts
-- 5 = STATION_OWNER  6 = TECHNICIAN  7 = QC
INSERT INTO user_roles (user_id, role_id) VALUES
    ('7a000010-7777-7777-7777-000000000001', 5),  -- marcus  STATION_OWNER
    ('7a000010-7777-7777-7777-000000000001', 6),  -- marcus  TECHNICIAN
    ('7b000010-7777-7777-7777-000000000002', 6),  -- tom     TECHNICIAN
    ('7a000020-7777-7777-7777-000000000001', 5),  -- dave    STATION_OWNER
    ('7a000020-7777-7777-7777-000000000001', 6),  -- dave    TECHNICIAN
    ('7b000020-7777-7777-7777-000000000002', 6),  -- ricky   TECHNICIAN
    ('7a000025-7777-7777-7777-000000000001', 5),  -- wei     STATION_OWNER
    ('7a000025-7777-7777-7777-000000000001', 6),  -- wei     TECHNICIAN
    ('7b000025-7777-7777-7777-000000000002', 6),  -- jack    TECHNICIAN
    ('7a000030-7777-7777-7777-000000000001', 5),  -- liam    STATION_OWNER
    ('7a000030-7777-7777-7777-000000000001', 6),  -- liam    TECHNICIAN
    ('7b000030-7777-7777-7777-000000000002', 6),  -- shane   TECHNICIAN
    ('7b000040-7777-7777-7777-000000000001', 6),  -- nathan  TECHNICIAN
    ('7c000040-7777-7777-7777-000000000002', 6),  -- mick    TECHNICIAN
    ('7a000050-7777-7777-7777-000000000001', 5),  -- scott   STATION_OWNER
    ('7a000050-7777-7777-7777-000000000001', 6),  -- scott   TECHNICIAN
    ('7b000050-7777-7777-7777-000000000002', 6),  -- chris   TECHNICIAN
    ('7a000060-7777-7777-7777-000000000001', 5),  -- garry   STATION_OWNER
    ('7a000060-7777-7777-7777-000000000001', 6),  -- garry   TECHNICIAN
    ('7b000060-7777-7777-7777-000000000002', 6),  -- brad    TECHNICIAN
    ('7a000070-7777-7777-7777-000000000001', 5),  -- tony    STATION_OWNER
    ('7a000070-7777-7777-7777-000000000001', 6),  -- tony    TECHNICIAN
    ('7b000070-7777-7777-7777-000000000002', 6),  -- jamie   TECHNICIAN
    ('7a000080-7777-7777-7777-000000000001', 5),  -- ray     STATION_OWNER
    ('7a000080-7777-7777-7777-000000000001', 6),  -- ray     TECHNICIAN
    ('7b000080-7777-7777-7777-000000000002', 6),  -- darren  TECHNICIAN
    ('7a000090-7777-7777-7777-000000000001', 5),  -- greg    STATION_OWNER
    ('7a000090-7777-7777-7777-000000000001', 7),  -- greg    QC
    ('7b000090-7777-7777-7777-000000000002', 7)   -- lisa    QC
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 7b. Set station owners
-- Station 40 is set in migration 004 — not duplicated here.
UPDATE stations SET owner_user_id = '7a000010-7777-7777-7777-000000000001' WHERE id = 10;
UPDATE stations SET owner_user_id = '7a000020-7777-7777-7777-000000000001' WHERE id = 20;
UPDATE stations SET owner_user_id = '7a000025-7777-7777-7777-000000000001' WHERE id = 25;
UPDATE stations SET owner_user_id = '7a000030-7777-7777-7777-000000000001' WHERE id = 30;
UPDATE stations SET owner_user_id = '7a000050-7777-7777-7777-000000000001' WHERE id = 50;
UPDATE stations SET owner_user_id = '7a000060-7777-7777-7777-000000000001' WHERE id = 60;
UPDATE stations SET owner_user_id = '7a000070-7777-7777-7777-000000000001' WHERE id = 70;
UPDATE stations SET owner_user_id = '7a000080-7777-7777-7777-000000000001' WHERE id = 80;
UPDATE stations SET owner_user_id = '7a000090-7777-7777-7777-000000000001' WHERE id = 90;

-- 7c. Station-technician roster
INSERT INTO station_technicians (station_id, user_id, is_primary) VALUES
    (10, '7a000010-7777-7777-7777-000000000001', TRUE),   -- marcus (lead)
    (10, '7b000010-7777-7777-7777-000000000002', FALSE),  -- tom
    (20, '7a000020-7777-7777-7777-000000000001', TRUE),   -- dave (lead)
    (20, '7b000020-7777-7777-7777-000000000002', FALSE),  -- ricky
    (25, '7a000025-7777-7777-7777-000000000001', TRUE),   -- wei (lead)
    (25, '7b000025-7777-7777-7777-000000000002', FALSE),  -- jack
    (30, '7a000030-7777-7777-7777-000000000001', TRUE),   -- liam (lead)
    (30, '7b000030-7777-7777-7777-000000000002', FALSE),  -- shane
    (40, '7b000040-7777-7777-7777-000000000001', FALSE),  -- nathan
    (40, '7c000040-7777-7777-7777-000000000002', FALSE),  -- mick
    (50, '7a000050-7777-7777-7777-000000000001', TRUE),   -- scott (lead)
    (50, '7b000050-7777-7777-7777-000000000002', FALSE),  -- chris
    (60, '7a000060-7777-7777-7777-000000000001', TRUE),   -- garry (lead)
    (60, '7b000060-7777-7777-7777-000000000002', FALSE),  -- brad
    (70, '7a000070-7777-7777-7777-000000000001', TRUE),   -- tony (lead)
    (70, '7b000070-7777-7777-7777-000000000002', FALSE),  -- jamie
    (80, '7a000080-7777-7777-7777-000000000001', TRUE),   -- ray (lead)
    (80, '7b000080-7777-7777-7777-000000000002', FALSE),  -- darren
    (90, '7a000090-7777-7777-7777-000000000001', TRUE),   -- greg (lead)
    (90, '7b000090-7777-7777-7777-000000000002', FALSE)   -- lisa
ON CONFLICT (station_id, user_id) DO NOTHING;

-- ============================================================================
-- Done. Verify with:
--   SELECT username, full_name, r.code AS role_code
--   FROM users u JOIN user_roles ur ON ur.user_id = u.id JOIN roles r ON r.id = ur.role_id;
--
--   SELECT t.code, tv.version_number, tv.total_estimated_hours,
--          (SELECT count(*) FROM template_operations WHERE template_version_id = tv.id) AS op_count
--   FROM job_code_templates t
--   JOIN template_versions tv ON tv.template_code = t.code
--   ORDER BY t.code;
-- ============================================================================
