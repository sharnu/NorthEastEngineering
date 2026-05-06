-- Migration 019: backfill body_type and flow_track on existing data
-- Idempotent: only updates rows that still have NULL / default values.
--
-- Uses COALESCE(jct.base_code, jct.code) so customer-prefixed variants like
-- DFE-TT67F correctly resolve to the base code TT67F → TAUTLINER, without
-- relying on overly-broad LIKE patterns such as '%-TT%'.

-- 1. Derive body_type from the linked template's effective code prefix.
UPDATE repair_orders ro
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
FROM template_versions tv
JOIN job_code_templates jct ON jct.code = tv.template_code
WHERE ro.template_version_id = tv.id
  AND ro.body_type IS NULL;

-- Catch any ROs that have no template_version_id at all.
UPDATE repair_orders
SET body_type = 'BODY_SWAP'
WHERE body_type IS NULL;

-- 2. For split-track body types, mark chassis-station tasks as CHASSIS track.
--    Stations 50 and 60 are CHASSIS on all multi-track body types.
UPDATE job_tasks t
SET flow_track = 'CHASSIS'
FROM repair_orders ro
WHERE t.ro_id      = ro.id
  AND t.station_id IN (50, 60)
  AND t.flow_track  = 'BODY'
  AND ro.body_type IN (
      'TIPPER_CS', 'CHIPPER_TIPPER_TRAY_CRANE',
      'PANTECH_AL', 'TILT_SLIDER', 'TRAILER', 'BODY_SWAP'
  );

-- 3. BODY_SWAP is a chassis-only flow: its merge stations (70, 90) are also CHASSIS.
--    The general UPDATE above only covers stations 50/60; BODY_SWAP has no BODY
--    track at all, so tasks at 70 and 90 must also be CHASSIS or the gate
--    evaluator finds no flow_definitions row for (BODY_SWAP, BODY, station_id=90).
UPDATE job_tasks t
SET flow_track = 'CHASSIS'
FROM repair_orders ro
WHERE t.ro_id      = ro.id
  AND t.station_id IN (70, 90)
  AND t.flow_track  = 'BODY'
  AND ro.body_type  = 'BODY_SWAP';

-- 4. Print a spread so the operator can verify the distribution.
DO $$
DECLARE r RECORD;
BEGIN
    FOR r IN
        SELECT body_type, COUNT(*) AS n
        FROM repair_orders
        GROUP BY body_type
        ORDER BY body_type
    LOOP
        RAISE NOTICE 'body_type=% count=%', r.body_type, r.n;
    END LOOP;
END $$;
