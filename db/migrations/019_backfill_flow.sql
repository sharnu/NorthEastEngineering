-- Migration 019: backfill body_type and flow_track on existing data
-- Idempotent: only updates rows that still have NULL / default values.
-- NOTE: PANTECH_AL pattern checked before PN% so more-specific prefix wins.

-- 1. Derive body_type from the linked template_version's template_code prefix.
--    ROs without a template match (no template_version_id or unknown prefix)
--    fall back to BODY_SWAP.
UPDATE repair_orders ro
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
    ELSE 'BODY_SWAP'
END
FROM template_versions tv
WHERE ro.template_version_id = tv.id
  AND ro.body_type IS NULL;

-- Catch any ROs that have no template_version_id at all.
UPDATE repair_orders
SET body_type = 'BODY_SWAP'
WHERE body_type IS NULL;

-- 2. For split-track body types, mark chassis-station tasks as CHASSIS track.
--    All other tasks already carry the DEFAULT 'BODY' applied at column creation.
UPDATE job_tasks t
SET flow_track = 'CHASSIS'
FROM repair_orders ro
WHERE t.ro_id     = ro.id
  AND t.station_id IN (50, 60)
  AND t.flow_track = 'BODY'
  AND ro.body_type IN (
      'TIPPER_CS', 'CHIPPER_TIPPER_TRAY_CRANE',
      'PANTECH_AL', 'TILT_SLIDER', 'TRAILER', 'BODY_SWAP'
  );

-- 3. Print a spread so the operator can verify the distribution.
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
