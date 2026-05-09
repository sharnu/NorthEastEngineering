-- 027_align_flow_definitions_to_pdf.sql
-- Phase 2 of operational-flow alignment with NE Operation flow PDF.
--
-- Sign-off decisions (see docs/operational-flow-vs-seed-diff.md):
--   F-1  TRAY        : insert FINAL_FITMENT before COMPLIANCE_QC
--   F-2  TAUTLINER   : insert FINAL_FITMENT before COMPLIANCE_QC
--   F-3  BEAVERTAIL  : insert FINAL_FITMENT before COMPLIANCE_QC
--   F-4  PANTECH_AL  : BODY shrinks to PANTECH → COMPLIANCE_QC
--   F-5  PANTECH_AL  : CHASSIS unchanged
--   F-6  TRAILER     : BODY → ROBOTIC_FAB → PAINT_PANEL → HYVA → COMPLIANCE_QC
--   F-7  TILT_SLIDER : BODY → FAB_LINE → PAINT_PANEL → HYVA → COMPLIANCE_QC
--                      (HYVA station serves the "HYVA Fitment" role here, vs
--                       its subframe/chassis role in chipper/tipper flows.)
--   F-8  BODY_SWAP   : keep
--   F-9  VAC/WATER/HOOK : skip (no flows authored)
--
-- Implementation note: every change deletes the affected
-- (body_type, track) rows and re-inserts them in clean sort order. This
-- side-steps the unique constraint on (body_type, track, sort_order) that
-- would otherwise make incremental UPDATE-by-row painful.

BEGIN;

-- ── F-1, F-2, F-3: TRAY / TAUTLINER / BEAVERTAIL — add FINAL_FITMENT ──
DELETE FROM flow_definitions WHERE body_type IN ('TRAY','TAUTLINER','BEAVERTAIL') AND track = 'BODY';
INSERT INTO flow_definitions (body_type, track, station_id, sort_order, is_optional) VALUES
    -- TRAY
    ('TRAY',       'BODY', 10, 1, FALSE),  -- Material processing / CNC
    ('TRAY',       'BODY', 20, 2, FALSE),  -- Fabrication line
    ('TRAY',       'BODY', 30, 3, FALSE),  -- Paint and panel
    ('TRAY',       'BODY', 40, 4, FALSE),  -- Body fitout (B1)
    ('TRAY',       'BODY', 70, 5, FALSE),  -- Final fitment (B2)  ← inserted
    ('TRAY',       'BODY', 90, 6, FALSE),  -- Compliance & QC
    -- TAUTLINER
    ('TAUTLINER',  'BODY', 10, 1, FALSE),
    ('TAUTLINER',  'BODY', 20, 2, FALSE),
    ('TAUTLINER',  'BODY', 30, 3, FALSE),
    ('TAUTLINER',  'BODY', 40, 4, FALSE),
    ('TAUTLINER',  'BODY', 70, 5, FALSE),  -- ← inserted
    ('TAUTLINER',  'BODY', 90, 6, FALSE),
    -- BEAVERTAIL
    ('BEAVERTAIL', 'BODY', 10, 1, FALSE),
    ('BEAVERTAIL', 'BODY', 20, 2, FALSE),
    ('BEAVERTAIL', 'BODY', 30, 3, FALSE),
    ('BEAVERTAIL', 'BODY', 40, 4, FALSE),
    ('BEAVERTAIL', 'BODY', 70, 5, FALSE),  -- ← inserted
    ('BEAVERTAIL', 'BODY', 90, 6, FALSE);

-- ── F-4: PANTECH_AL BODY shrinks to PANTECH → QC (PDF shows just two steps) ──
DELETE FROM flow_definitions WHERE body_type = 'PANTECH_AL' AND track = 'BODY';
INSERT INTO flow_definitions (body_type, track, station_id, sort_order, is_optional) VALUES
    ('PANTECH_AL', 'BODY', 80, 1, FALSE),  -- Pantech assembly
    ('PANTECH_AL', 'BODY', 90, 2, FALSE);  -- Compliance & QC
-- F-5: CHASSIS track for PANTECH_AL unchanged.

-- ── F-6: TRAILER BODY → ROBOTIC_FAB → PAINT → HYVA → QC ──
-- PDF shows a single integrated Body & Chassis lane (Robotic fab → Paint)
-- joining a TEBS Hyd lane (HYVA) at Final QC. We model this as one BODY
-- track that includes HYVA inline. The pre-existing TRAILER CHASSIS track
-- (Chassis prep → HYVA → Final fitment → QC) remains for now; flagged for
-- review since trailers don't have a truck chassis to prep, but PDF doesn't
-- give an explicit replacement.
DELETE FROM flow_definitions WHERE body_type = 'TRAILER' AND track = 'BODY';
INSERT INTO flow_definitions (body_type, track, station_id, sort_order, is_optional) VALUES
    ('TRAILER',    'BODY', 25, 1, FALSE),  -- Robotic fabrication
    ('TRAILER',    'BODY', 30, 2, FALSE),  -- Paint and panel
    ('TRAILER',    'BODY', 60, 3, FALSE),  -- HYVA hydraulics  (TEBS hyd in PDF)
    ('TRAILER',    'BODY', 90, 4, FALSE);  -- Compliance & QC

-- ── F-7: TILT_SLIDER BODY → FAB_LINE → PAINT → HYVA → QC ──
-- Replaces the prior ROBOTIC_FAB→PAINT→BODY_FITOUT→FINAL_FITMENT→QC.
-- PDF labels station HYVA as "HYVA Fitment" for tilt sliders (it does
-- fitment work here, distinct from its subframe/chassis role for tippers).
DELETE FROM flow_definitions WHERE body_type = 'TILT_SLIDER' AND track = 'BODY';
INSERT INTO flow_definitions (body_type, track, station_id, sort_order, is_optional) VALUES
    ('TILT_SLIDER', 'BODY', 20, 1, FALSE),  -- Fabrication line (PDF: Production Line)
    ('TILT_SLIDER', 'BODY', 30, 2, FALSE),  -- Paint and panel
    ('TILT_SLIDER', 'BODY', 60, 3, FALSE),  -- HYVA hydraulics  (PDF: HYVA Fitment)
    ('TILT_SLIDER', 'BODY', 90, 4, FALSE);  -- Compliance & QC
-- TILT_SLIDER CHASSIS and SUBFRAME tracks unchanged.

COMMIT;
