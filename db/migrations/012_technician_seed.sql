-- ============================================================================
-- 012_technician_seed.sql
-- Full technician and station-owner roster for all production stations.
--
-- Adds 20 accounts (2 per station), assigns roles, sets station owners,
-- and registers everyone in station_technicians.
--
-- UUID pattern:
--   7a<station_id_decimal_6>-7777-7777-7777-000000000001  →  station owner
--   7b<station_id_decimal_6>-7777-7777-7777-000000000002  →  second technician
--   7c<station_id_decimal_6>-7777-7777-7777-000000000002  →  third technician
--
-- Idempotent: all INSERTs use ON CONFLICT DO NOTHING; UPDATEs are safe to re-run.
-- Passwords: placeholder hash — run `make hash-pw` after applying.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Users
-- ----------------------------------------------------------------------------
INSERT INTO users (id, username, email, full_name, short_code, password_hash, is_active) VALUES

    -- Station 10 — Material processing / CNC
    ('7a000010-7777-7777-7777-000000000001', 'marcus', 'marcus@nee.local', 'Marcus Webb',   'MW', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000010-7777-7777-7777-000000000002', 'tom',    'tom@nee.local',    'Tom Sissons',   'TS', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 20 — Fabrication line  (peter 44444444 already rostered)
    ('7a000020-7777-7777-7777-000000000001', 'dave',   'dave@nee.local',   'Dave Norris',   'DN', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000020-7777-7777-7777-000000000002', 'ricky',  'ricky@nee.local',  'Ricky Santos',  'RS', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 25 — Robotic fabrication
    ('7a000025-7777-7777-7777-000000000001', 'wei',    'wei@nee.local',    'Wei Zhang',     'WZ', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000025-7777-7777-7777-000000000002', 'jack',   'jack@nee.local',   'Jack Brennan',  'JB', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 30 — Paint and panel  (kane 55555555 already rostered)
    ('7a000030-7777-7777-7777-000000000001', 'liam',   'liam@nee.local',   'Liam Cross',    'LC', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7b000030-7777-7777-7777-000000000002', 'shane',  'shane@nee.local',  'Shane Dooley',  'SD', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),

    -- Station 40 — Body fitout B1  (adam 66666666 already owner + rostered; add 2 more techs)
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

-- ----------------------------------------------------------------------------
-- 2. User-role assignments
-- ----------------------------------------------------------------------------
-- 5 = STATION_OWNER  6 = TECHNICIAN  7 = QC
INSERT INTO user_roles (user_id, role_id) VALUES

    -- Station 10
    ('7a000010-7777-7777-7777-000000000001', 5),  -- marcus  STATION_OWNER
    ('7a000010-7777-7777-7777-000000000001', 6),  -- marcus  TECHNICIAN (works on floor)
    ('7b000010-7777-7777-7777-000000000002', 6),  -- tom     TECHNICIAN

    -- Station 20
    ('7a000020-7777-7777-7777-000000000001', 5),  -- dave    STATION_OWNER
    ('7a000020-7777-7777-7777-000000000001', 6),  -- dave    TECHNICIAN
    ('7b000020-7777-7777-7777-000000000002', 6),  -- ricky   TECHNICIAN

    -- Station 25
    ('7a000025-7777-7777-7777-000000000001', 5),  -- wei     STATION_OWNER
    ('7a000025-7777-7777-7777-000000000001', 6),  -- wei     TECHNICIAN
    ('7b000025-7777-7777-7777-000000000002', 6),  -- jack    TECHNICIAN

    -- Station 30
    ('7a000030-7777-7777-7777-000000000001', 5),  -- liam    STATION_OWNER
    ('7a000030-7777-7777-7777-000000000001', 6),  -- liam    TECHNICIAN
    ('7b000030-7777-7777-7777-000000000002', 6),  -- shane   TECHNICIAN

    -- Station 40 (adam is already owner; new techs only)
    ('7b000040-7777-7777-7777-000000000001', 6),  -- nathan  TECHNICIAN
    ('7c000040-7777-7777-7777-000000000002', 6),  -- mick    TECHNICIAN

    -- Station 50
    ('7a000050-7777-7777-7777-000000000001', 5),  -- scott   STATION_OWNER
    ('7a000050-7777-7777-7777-000000000001', 6),  -- scott   TECHNICIAN
    ('7b000050-7777-7777-7777-000000000002', 6),  -- chris   TECHNICIAN

    -- Station 60
    ('7a000060-7777-7777-7777-000000000001', 5),  -- garry   STATION_OWNER
    ('7a000060-7777-7777-7777-000000000001', 6),  -- garry   TECHNICIAN
    ('7b000060-7777-7777-7777-000000000002', 6),  -- brad    TECHNICIAN

    -- Station 70
    ('7a000070-7777-7777-7777-000000000001', 5),  -- tony    STATION_OWNER
    ('7a000070-7777-7777-7777-000000000001', 6),  -- tony    TECHNICIAN
    ('7b000070-7777-7777-7777-000000000002', 6),  -- jamie   TECHNICIAN

    -- Station 80
    ('7a000080-7777-7777-7777-000000000001', 5),  -- ray     STATION_OWNER
    ('7a000080-7777-7777-7777-000000000001', 6),  -- ray     TECHNICIAN
    ('7b000080-7777-7777-7777-000000000002', 6),  -- darren  TECHNICIAN

    -- Station 90
    ('7a000090-7777-7777-7777-000000000001', 5),  -- greg    STATION_OWNER
    ('7a000090-7777-7777-7777-000000000001', 7),  -- greg    QC
    ('7b000090-7777-7777-7777-000000000002', 7)   -- lisa    QC

ON CONFLICT (user_id, role_id) DO NOTHING;

-- ----------------------------------------------------------------------------
-- 3. Set station owners
-- ----------------------------------------------------------------------------
-- Station 40 owner (adam) was set in migration 004 — leave untouched.
UPDATE stations SET owner_user_id = '7a000010-7777-7777-7777-000000000001' WHERE id = 10;
UPDATE stations SET owner_user_id = '7a000020-7777-7777-7777-000000000001' WHERE id = 20;
UPDATE stations SET owner_user_id = '7a000025-7777-7777-7777-000000000001' WHERE id = 25;
UPDATE stations SET owner_user_id = '7a000030-7777-7777-7777-000000000001' WHERE id = 30;
UPDATE stations SET owner_user_id = '7a000050-7777-7777-7777-000000000001' WHERE id = 50;
UPDATE stations SET owner_user_id = '7a000060-7777-7777-7777-000000000001' WHERE id = 60;
UPDATE stations SET owner_user_id = '7a000070-7777-7777-7777-000000000001' WHERE id = 70;
UPDATE stations SET owner_user_id = '7a000080-7777-7777-7777-000000000001' WHERE id = 80;
UPDATE stations SET owner_user_id = '7a000090-7777-7777-7777-000000000001' WHERE id = 90;

-- ----------------------------------------------------------------------------
-- 4. Station-technician roster
-- ----------------------------------------------------------------------------
INSERT INTO station_technicians (station_id, user_id, is_primary) VALUES

    -- Station 10 — Material processing / CNC
    (10, '7a000010-7777-7777-7777-000000000001', TRUE),   -- marcus (owner + lead tech)
    (10, '7b000010-7777-7777-7777-000000000002', FALSE),  -- tom

    -- Station 20 — Fabrication line  (peter already rostered via 002)
    (20, '7a000020-7777-7777-7777-000000000001', TRUE),   -- dave (owner + lead tech)
    (20, '7b000020-7777-7777-7777-000000000002', FALSE),  -- ricky

    -- Station 25 — Robotic fabrication
    (25, '7a000025-7777-7777-7777-000000000001', TRUE),   -- wei (owner + lead tech)
    (25, '7b000025-7777-7777-7777-000000000002', FALSE),  -- jack

    -- Station 30 — Paint and panel  (kane already rostered via 002)
    (30, '7a000030-7777-7777-7777-000000000001', TRUE),   -- liam (owner + lead tech)
    (30, '7b000030-7777-7777-7777-000000000002', FALSE),  -- shane

    -- Station 40 — Body fitout B1  (adam already primary via 004)
    (40, '7b000040-7777-7777-7777-000000000001', FALSE),  -- nathan
    (40, '7c000040-7777-7777-7777-000000000002', FALSE),  -- mick

    -- Station 50 — Chassis prep B3
    (50, '7a000050-7777-7777-7777-000000000001', TRUE),   -- scott (owner + lead tech)
    (50, '7b000050-7777-7777-7777-000000000002', FALSE),  -- chris

    -- Station 60 — HYVA hydraulics
    (60, '7a000060-7777-7777-7777-000000000001', TRUE),   -- garry (owner + lead tech)
    (60, '7b000060-7777-7777-7777-000000000002', FALSE),  -- brad

    -- Station 70 — Final fitment B2
    (70, '7a000070-7777-7777-7777-000000000001', TRUE),   -- tony (owner + lead tech)
    (70, '7b000070-7777-7777-7777-000000000002', FALSE),  -- jamie

    -- Station 80 — Pantech assembly
    (80, '7a000080-7777-7777-7777-000000000001', TRUE),   -- ray (owner + lead tech)
    (80, '7b000080-7777-7777-7777-000000000002', FALSE),  -- darren

    -- Station 90 — Vehicle compliance and final QC
    (90, '7a000090-7777-7777-7777-000000000001', TRUE),   -- greg (owner + QC lead)
    (90, '7b000090-7777-7777-7777-000000000002', FALSE)   -- lisa

ON CONFLICT (station_id, user_id) DO NOTHING;

-- ============================================================================
-- Verify with:
--   SELECT s.name, u.username AS owner,
--          array_agg(tu.username ORDER BY tu.username) AS technicians
--   FROM stations s
--   LEFT JOIN users u ON u.id = s.owner_user_id
--   LEFT JOIN station_technicians st ON st.station_id = s.id
--   LEFT JOIN users tu ON tu.id = st.user_id
--   WHERE s.id != 95
--   GROUP BY s.name, u.username
--   ORDER BY s.sort_order;
-- ============================================================================
