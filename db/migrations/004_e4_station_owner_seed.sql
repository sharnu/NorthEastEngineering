-- Migration 004: Add Adam Miller as a dedicated STATION_OWNER for UI testing
-- He owns station 40 (BODY_FITOUT) and is rostered there as a technician.
-- Run POST /api/dev/reseed-passwords after applying this migration.

-- 1. Add Adam Miller
INSERT INTO users (id, username, email, full_name, short_code, password_hash, is_active)
VALUES (
    '66666666-6666-6666-6666-666666666666',
    'adam',
    'adam@nee.local',
    'Adam Miller',
    'AM',
    'AQAAAAIAAYagAAAAEC5L6tH/IjMJZjZxcLCEPlGRkqDEH5W2J9zKXkPzKrDiZ8u1QZBiX/EXAMPLE000=',
    TRUE
)
ON CONFLICT (username) DO NOTHING;

-- 2. Grant STATION_OWNER role (role_id = 5)
INSERT INTO user_roles (user_id, role_id)
VALUES ('66666666-6666-6666-6666-666666666666', 5)
ON CONFLICT (user_id, role_id) DO NOTHING;

-- 3. Set Adam as owner of station 40 (BODY_FITOUT)
UPDATE stations
SET owner_user_id = '66666666-6666-6666-6666-666666666666'
WHERE id = 40;

-- 4. Roster Adam as primary technician at station 40 so he can assign tasks there
INSERT INTO station_technicians (station_id, user_id, is_primary)
VALUES (40, '66666666-6666-6666-6666-666666666666', TRUE)
ON CONFLICT (station_id, user_id) DO NOTHING;
