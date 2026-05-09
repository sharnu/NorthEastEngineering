-- 028_align_station_personnel_to_pdf.sql
-- Phase 3 of operational-flow alignment with NE Operation flow PDF.
--
-- Adds the six PDF-named station owners as new users (kai, danny, viral,
-- shanks, sammy, sid) and reassigns primary-tech responsibility per the
-- PDF. Existing mock techs not named in the PDF stay on their stations as
-- secondaries so demo data and Playwright fixtures keep working
-- (option (b) — additive — from Phase 0 sign-off).
--
-- Adam Miller and Scott Barker were already in the seed but on the wrong
-- stations (PDF: Adam → FAB_LINE/Production Line; Scott → PAINT_PANEL).
-- They're moved (not duplicated) per P-7, P-8.
--
-- Password hashes use the same placeholder as seed 002. Run `make hash-pw`
-- after applying to set every account to `nee2026`.

BEGIN;

-- ── New users (PDF-named station owners) ──
INSERT INTO users (id, username, email, full_name, short_code, password_hash, is_active) VALUES
    ('7a000025-7777-7777-7777-000000000002', 'kai',    'kai@nee.local',    'Kai Tan',         'KT', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7a000060-7777-7777-7777-000000000002', 'danny',  'danny@nee.local',  'Danny Galvin',    'DG', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7a000080-7777-7777-7777-000000000002', 'viral',  'viral@nee.local',  'Viral Patel',     'VP', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7a000040-7777-7777-7777-000000000002', 'shanks', 'shanks@nee.local', 'Shanks Williams', 'SH', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7a000090-7777-7777-7777-000000000002', 'sammy',  'sammy@nee.local',  'Sammy Reeves',    'SR', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE),
    ('7a000090-7777-7777-7777-000000000003', 'sid',    'sid@nee.local',    'Sid Patel',       'SP', 'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ── Roles for new users ──
-- 5=STATION_OWNER, 6=TECHNICIAN, 7=QC
INSERT INTO user_roles (user_id, role_id) VALUES
    ('7a000025-7777-7777-7777-000000000002', 5),  -- kai     STATION_OWNER
    ('7a000025-7777-7777-7777-000000000002', 6),  -- kai     TECHNICIAN
    ('7a000060-7777-7777-7777-000000000002', 5),  -- danny   STATION_OWNER
    ('7a000060-7777-7777-7777-000000000002', 6),  -- danny   TECHNICIAN
    ('7a000080-7777-7777-7777-000000000002', 5),  -- viral   STATION_OWNER
    ('7a000080-7777-7777-7777-000000000002', 6),  -- viral   TECHNICIAN
    ('7a000040-7777-7777-7777-000000000002', 5),  -- shanks  STATION_OWNER (multi: 40/50/70)
    ('7a000040-7777-7777-7777-000000000002', 6),  -- shanks  TECHNICIAN
    ('7a000090-7777-7777-7777-000000000002', 5),  -- sammy   STATION_OWNER
    ('7a000090-7777-7777-7777-000000000002', 7),  -- sammy   QC
    ('7a000090-7777-7777-7777-000000000003', 5),  -- sid     STATION_OWNER
    ('7a000090-7777-7777-7777-000000000003', 7)   -- sid     QC
ON CONFLICT (user_id, role_id) DO NOTHING;

-- ── Move Adam Miller from BODY_FITOUT (40) to FAB_LINE (20) ──
DELETE FROM station_technicians WHERE station_id = 40 AND user_id = (SELECT id FROM users WHERE username = 'adam');

-- ── Move Scott Barker from CHASSIS_PREP (50) to PAINT_PANEL (30) ──
DELETE FROM station_technicians WHERE station_id = 50 AND user_id = (SELECT id FROM users WHERE username = 'scott');

-- ── Demote existing primaries at stations the PDF reassigns ──
UPDATE station_technicians SET is_primary = FALSE
 WHERE (station_id = 20 AND user_id IN (SELECT id FROM users WHERE username IN ('dave','peter')))
    OR (station_id = 25 AND user_id IN (SELECT id FROM users WHERE username = 'wei'))
    OR (station_id = 30 AND user_id IN (SELECT id FROM users WHERE username IN ('liam','kane')))
    OR (station_id = 60 AND user_id IN (SELECT id FROM users WHERE username = 'garry'))
    OR (station_id = 70 AND user_id IN (SELECT id FROM users WHERE username = 'tony'))
    OR (station_id = 80 AND user_id IN (SELECT id FROM users WHERE username = 'ray'))
    OR (station_id = 90 AND user_id IN (SELECT id FROM users WHERE username = 'greg'));

-- ── Insert PDF-correct primaries ──
-- Existing users (adam, scott) are referenced by username so we don't
-- bake in their UUIDs. New users use the deterministic UUIDs above.
INSERT INTO station_technicians (station_id, user_id, is_primary, skill_level)
SELECT s.station_id, u.id, TRUE, 5
FROM (VALUES
    (20, 'adam'),      -- adam → FAB_LINE
    (30, 'scott'),     -- scott → PAINT_PANEL
    (25, 'kai'),       -- kai → ROBOTIC_FAB
    (40, 'shanks'),    -- shanks → BODY_FITOUT
    (50, 'shanks'),    -- shanks → CHASSIS_PREP
    (70, 'shanks'),    -- shanks → FINAL_FITMENT
    (60, 'danny'),     -- danny → HYVA
    (80, 'viral'),     -- viral → PANTECH
    (90, 'sammy'),     -- sammy → COMPLIANCE_QC
    (90, 'sid')        -- sid → COMPLIANCE_QC
) AS s(station_id, username)
JOIN users u ON u.username = s.username
ON CONFLICT (station_id, user_id) DO UPDATE SET is_primary = TRUE, skill_level = EXCLUDED.skill_level;

-- ── Update stations.owner_user_id to match the PDF station owners ──
-- This is a separate field from station_technicians.is_primary; both the
-- Admin Stations UI and NotificationService read stations.owner_user_id,
-- so it has to be kept in sync. Where the PDF lists multiple owners for
-- one station (e.g. Sammy + Sid for Compliance & QC), we pick the lead
-- name as the single FK; the others remain primary techs.
UPDATE stations s
SET    owner_user_id = u.id, updated_at = now()
FROM   users u, (VALUES
    (20, 'adam'),
    (25, 'kai'),
    (30, 'scott'),
    (40, 'shanks'),
    (50, 'shanks'),
    (60, 'danny'),
    (70, 'shanks'),
    (80, 'viral'),
    (90, 'sammy')
) AS owners(station_id, username)
WHERE s.id = owners.station_id AND u.username = owners.username;

COMMIT;
