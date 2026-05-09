-- 029_align_trailer_chassis_to_pdf.sql
-- Follow-up to 027 after PDF clarification.
--
-- The PDF shows TRAILER as a single combined "Body & Chassis" lane joining
-- a separate TEBS Hyd lane (HYVA) at QC. We model both tracks with the
-- same station sequence so a job task with either flow_track follows the
-- correct path:
--
--   Body & Chassis: ROBOTIC_FAB → PAINT_PANEL → HYVA → COMPLIANCE_QC
--
-- 027 already replaced the BODY track. This migration replaces the
-- CHASSIS track (was CHASSIS_PREP → HYVA → FINAL_FITMENT → QC, which
-- assumed a truck chassis — trailers don't have one).

BEGIN;

DELETE FROM flow_definitions WHERE body_type = 'TRAILER' AND track = 'CHASSIS';
INSERT INTO flow_definitions (body_type, track, station_id, sort_order, is_optional) VALUES
    ('TRAILER', 'CHASSIS', 25, 1, FALSE),  -- Robotic fabrication
    ('TRAILER', 'CHASSIS', 30, 2, FALSE),  -- Paint and panel
    ('TRAILER', 'CHASSIS', 60, 3, FALSE),  -- HYVA hydraulics
    ('TRAILER', 'CHASSIS', 90, 4, FALSE);  -- Compliance & QC

COMMIT;
