-- Migration 021: add body_type / flow_track to template definitions
-- Ensures newly created ROs automatically inherit the correct body_type and
-- flow_track from the template rather than relying on the one-shot backfill.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS and WHERE … IS NULL guards.

-- 1. template_versions: which body type this template produces
ALTER TABLE template_versions
    ADD COLUMN IF NOT EXISTS body_type TEXT NULL;

-- 2. template_operations: which track each operation belongs to
ALTER TABLE template_operations
    ADD COLUMN IF NOT EXISTS flow_track TEXT NOT NULL DEFAULT 'BODY'
        CHECK (flow_track IN ('BODY','CHASSIS','SUBFRAME','ANY'));

-- 3. Populate body_type on existing template_versions from the template_code prefix.
--    NOTE: PNAL% must precede PN% so the more-specific prefix wins.
UPDATE template_versions tv
SET body_type = CASE
    WHEN tv.template_code LIKE 'PNAL%' THEN 'PANTECH_AL'
    WHEN tv.template_code LIKE 'PN%'   THEN 'PANTECH_STEEL'
    WHEN tv.template_code LIKE 'TP%'   THEN 'TIPPER_CS'
    WHEN tv.template_code LIKE 'TT%'   THEN 'TAUTLINER'
    WHEN tv.template_code LIKE 'BT%'   THEN 'BEAVERTAIL'
    WHEN tv.template_code LIKE 'TR%'   THEN 'TRAY'
    WHEN tv.template_code LIKE 'TS%'   THEN 'TILT_SLIDER'
    WHEN tv.template_code LIKE 'TL%'   THEN 'TRAILER'
    WHEN tv.template_code LIKE 'CH%'   THEN 'CHIPPER_TIPPER_TRAY_CRANE'
    WHEN tv.template_code LIKE 'BS%'   THEN 'BODY_SWAP'
    -- Customer-prefixed variants (e.g. DFE-TT67F) — strip prefix and re-evaluate
    WHEN tv.template_code LIKE '%-TT%' THEN 'TAUTLINER'
    WHEN tv.template_code LIKE '%-TP%' THEN 'TIPPER_CS'
    WHEN tv.template_code LIKE '%-TR%' THEN 'TRAY'
    ELSE 'BODY_SWAP'
END
WHERE tv.body_type IS NULL;

-- 4. Backfill flow_track on template_operations.
--    Determine the effective station: use station_id_override when set,
--    otherwise fall back to the operation's default_station_id.
UPDATE template_operations to_
SET flow_track = 'CHASSIS'
FROM operation_catalog oc
WHERE to_.operation_id = oc.id
  AND COALESCE(to_.station_id_override, oc.default_station_id) IN (50, 60)
  AND to_.flow_track = 'BODY';
