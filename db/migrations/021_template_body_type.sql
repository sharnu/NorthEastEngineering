-- Migration 021: add body_type / flow_track to template definitions
-- Ensures newly created ROs automatically inherit the correct body_type and
-- flow_track from the template rather than relying on the one-shot backfill.
-- Idempotent: uses ADD COLUMN IF NOT EXISTS and WHERE … IS NULL guards.
--
-- Uses COALESCE(jct.base_code, jct.code) so customer-prefixed variants like
-- DFE-TT67F resolve to base code TT67F → TAUTLINER without overly-broad LIKE
-- patterns. NOTE: PNAL% must precede PN% so the more-specific prefix wins.

-- 1. template_versions: which body type this template produces
ALTER TABLE template_versions
    ADD COLUMN IF NOT EXISTS body_type TEXT NULL;

-- 2. template_operations: which track each operation belongs to
ALTER TABLE template_operations
    ADD COLUMN IF NOT EXISTS flow_track TEXT NOT NULL DEFAULT 'BODY'
        CHECK (flow_track IN ('BODY','CHASSIS','SUBFRAME','ANY'));

-- 3. Populate body_type on existing template_versions from the effective code prefix.
UPDATE template_versions tv
SET body_type = CASE
    WHEN COALESCE(jct.base_code, jct.code) LIKE 'PNAL%' THEN 'PANTECH_AL'
    WHEN COALESCE(jct.base_code, jct.code) LIKE 'PN%'   THEN 'PANTECH_STEEL'
    WHEN COALESCE(jct.base_code, jct.code) LIKE 'TP%'   THEN 'TIPPER_CS'
    WHEN COALESCE(jct.base_code, jct.code) LIKE 'TT%'   THEN 'TAUTLINER'
    WHEN COALESCE(jct.base_code, jct.code) LIKE 'BT%'   THEN 'BEAVERTAIL'
    WHEN COALESCE(jct.base_code, jct.code) LIKE 'TR%'   THEN 'TRAY'
    WHEN COALESCE(jct.base_code, jct.code) LIKE 'TS%'   THEN 'TILT_SLIDER'
    WHEN COALESCE(jct.base_code, jct.code) LIKE 'TL%'   THEN 'TRAILER'
    WHEN COALESCE(jct.base_code, jct.code) LIKE 'CH%'   THEN 'CHIPPER_TIPPER_TRAY_CRANE'
    WHEN COALESCE(jct.base_code, jct.code) LIKE 'BS%'   THEN 'BODY_SWAP'
    ELSE 'BODY_SWAP'
END
FROM job_code_templates jct
WHERE tv.template_code = jct.code
  AND tv.body_type IS NULL;

-- 4. Backfill flow_track on template_operations for chassis stations (50, 60).
UPDATE template_operations to_
SET flow_track = 'CHASSIS'
FROM operation_catalog oc
WHERE to_.operation_id = oc.id
  AND COALESCE(to_.station_id_override, oc.default_station_id) IN (50, 60)
  AND to_.flow_track = 'BODY';

-- 5. BODY_SWAP templates have no BODY track: merge stations 70 and 90 are also CHASSIS.
--    Scope to BODY_SWAP versions only to avoid marking non-BODY_SWAP merge tasks.
UPDATE template_operations to_
SET flow_track = 'CHASSIS'
FROM template_versions tv, operation_catalog oc
WHERE to_.template_version_id = tv.id
  AND to_.operation_id         = oc.id
  AND tv.body_type              = 'BODY_SWAP'
  AND COALESCE(to_.station_id_override, oc.default_station_id) IN (70, 90)
  AND to_.flow_track            = 'BODY';
