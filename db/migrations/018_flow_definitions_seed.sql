-- Migration 018: seed flow_definitions for all body types
-- Idempotent via ON CONFLICT (body_type, track, sort_order) DO NOTHING.
-- Station IDs: 10=MATERIAL_PROC, 20=FAB_LINE, 25=ROBOTIC_FAB, 30=PAINT_PANEL,
--              40=BODY_FITOUT, 50=CHASSIS_PREP, 60=HYVA, 70=FINAL_FITMENT,
--              80=PANTECH, 90=COMPLIANCE_QC

INSERT INTO flow_definitions (body_type, track, station_id, sort_order, is_optional) VALUES

-- -------------------------------------------------------------------------
-- TIPPER_CS: canonical split-track tipper (C/S)
-- BODY:     MAT_PROC → ROBOTIC_FAB → PAINT → BODY_FITOUT → FINAL_FITMENT → COMPLIANCE_QC
-- CHASSIS:  CHASSIS_PREP → HYVA → FINAL_FITMENT → COMPLIANCE_QC
-- SUBFRAME: MAT_PROC(opt) → PAINT → HYVA → FINAL_FITMENT
-- -------------------------------------------------------------------------
('TIPPER_CS','BODY',   10, 1, FALSE),
('TIPPER_CS','BODY',   25, 2, FALSE),
('TIPPER_CS','BODY',   30, 3, FALSE),
('TIPPER_CS','BODY',   40, 4, FALSE),
('TIPPER_CS','BODY',   70, 5, FALSE),
('TIPPER_CS','BODY',   90, 6, FALSE),

('TIPPER_CS','CHASSIS',50, 1, FALSE),
('TIPPER_CS','CHASSIS',60, 2, FALSE),
('TIPPER_CS','CHASSIS',70, 3, FALSE),
('TIPPER_CS','CHASSIS',90, 4, FALSE),

('TIPPER_CS','SUBFRAME',10, 1, TRUE ),
('TIPPER_CS','SUBFRAME',30, 2, FALSE),
('TIPPER_CS','SUBFRAME',60, 3, FALSE),
('TIPPER_CS','SUBFRAME',70, 4, FALSE),

-- -------------------------------------------------------------------------
-- CHIPPER_TIPPER_TRAY_CRANE: same three-track shape as TIPPER_CS
-- -------------------------------------------------------------------------
('CHIPPER_TIPPER_TRAY_CRANE','BODY',   10, 1, FALSE),
('CHIPPER_TIPPER_TRAY_CRANE','BODY',   25, 2, FALSE),
('CHIPPER_TIPPER_TRAY_CRANE','BODY',   30, 3, FALSE),
('CHIPPER_TIPPER_TRAY_CRANE','BODY',   40, 4, FALSE),
('CHIPPER_TIPPER_TRAY_CRANE','BODY',   70, 5, FALSE),
('CHIPPER_TIPPER_TRAY_CRANE','BODY',   90, 6, FALSE),

('CHIPPER_TIPPER_TRAY_CRANE','CHASSIS',50, 1, FALSE),
('CHIPPER_TIPPER_TRAY_CRANE','CHASSIS',60, 2, FALSE),
('CHIPPER_TIPPER_TRAY_CRANE','CHASSIS',70, 3, FALSE),
('CHIPPER_TIPPER_TRAY_CRANE','CHASSIS',90, 4, FALSE),

('CHIPPER_TIPPER_TRAY_CRANE','SUBFRAME',10, 1, TRUE ),
('CHIPPER_TIPPER_TRAY_CRANE','SUBFRAME',30, 2, FALSE),
('CHIPPER_TIPPER_TRAY_CRANE','SUBFRAME',60, 3, FALSE),
('CHIPPER_TIPPER_TRAY_CRANE','SUBFRAME',70, 4, FALSE),

-- -------------------------------------------------------------------------
-- TRAY: single BODY track, no chassis fitment
-- MAT_PROC → FAB_LINE → PAINT → BODY_FITOUT → COMPLIANCE_QC
-- -------------------------------------------------------------------------
('TRAY','BODY',10, 1, FALSE),
('TRAY','BODY',20, 2, FALSE),
('TRAY','BODY',30, 3, FALSE),
('TRAY','BODY',40, 4, FALSE),
('TRAY','BODY',90, 5, FALSE),

-- -------------------------------------------------------------------------
-- TAUTLINER: single BODY track (curtain-side)
-- MAT_PROC → FAB_LINE → PAINT → BODY_FITOUT → COMPLIANCE_QC
-- -------------------------------------------------------------------------
('TAUTLINER','BODY',10, 1, FALSE),
('TAUTLINER','BODY',20, 2, FALSE),
('TAUTLINER','BODY',30, 3, FALSE),
('TAUTLINER','BODY',40, 4, FALSE),
('TAUTLINER','BODY',90, 5, FALSE),

-- -------------------------------------------------------------------------
-- BEAVERTAIL: single BODY track (flat deck with ramps)
-- MAT_PROC → FAB_LINE → PAINT → BODY_FITOUT → COMPLIANCE_QC
-- -------------------------------------------------------------------------
('BEAVERTAIL','BODY',10, 1, FALSE),
('BEAVERTAIL','BODY',20, 2, FALSE),
('BEAVERTAIL','BODY',30, 3, FALSE),
('BEAVERTAIL','BODY',40, 4, FALSE),
('BEAVERTAIL','BODY',90, 5, FALSE),

-- -------------------------------------------------------------------------
-- PANTECH_STEEL: single BODY track through Pantech assembly
-- FAB_LINE → PAINT → PANTECH → COMPLIANCE_QC
-- -------------------------------------------------------------------------
('PANTECH_STEEL','BODY',20, 1, FALSE),
('PANTECH_STEEL','BODY',30, 2, FALSE),
('PANTECH_STEEL','BODY',80, 3, FALSE),
('PANTECH_STEEL','BODY',90, 4, FALSE),

-- -------------------------------------------------------------------------
-- PANTECH_AL: split BODY/CHASSIS, aluminium pantech with robotic fab
-- BODY:    ROBOTIC_FAB → PAINT → PANTECH → COMPLIANCE_QC
-- CHASSIS: CHASSIS_PREP → HYVA → FINAL_FITMENT → COMPLIANCE_QC
-- -------------------------------------------------------------------------
('PANTECH_AL','BODY',   25, 1, FALSE),
('PANTECH_AL','BODY',   30, 2, FALSE),
('PANTECH_AL','BODY',   80, 3, FALSE),
('PANTECH_AL','BODY',   90, 4, FALSE),

('PANTECH_AL','CHASSIS',50, 1, FALSE),
('PANTECH_AL','CHASSIS',60, 2, FALSE),
('PANTECH_AL','CHASSIS',70, 3, FALSE),
('PANTECH_AL','CHASSIS',90, 4, FALSE),

-- -------------------------------------------------------------------------
-- TILT_SLIDER: split BODY/CHASSIS/SUBFRAME
-- BODY:     ROBOTIC_FAB → PAINT → BODY_FITOUT → FINAL_FITMENT → COMPLIANCE_QC
-- CHASSIS:  CHASSIS_PREP → HYVA → FINAL_FITMENT → COMPLIANCE_QC
-- SUBFRAME: PAINT → HYVA → FINAL_FITMENT
-- -------------------------------------------------------------------------
('TILT_SLIDER','BODY',   25, 1, FALSE),
('TILT_SLIDER','BODY',   30, 2, FALSE),
('TILT_SLIDER','BODY',   40, 3, FALSE),
('TILT_SLIDER','BODY',   70, 4, FALSE),
('TILT_SLIDER','BODY',   90, 5, FALSE),

('TILT_SLIDER','CHASSIS',50, 1, FALSE),
('TILT_SLIDER','CHASSIS',60, 2, FALSE),
('TILT_SLIDER','CHASSIS',70, 3, FALSE),
('TILT_SLIDER','CHASSIS',90, 4, FALSE),

('TILT_SLIDER','SUBFRAME',30, 1, FALSE),
('TILT_SLIDER','SUBFRAME',60, 2, FALSE),
('TILT_SLIDER','SUBFRAME',70, 3, FALSE),

-- -------------------------------------------------------------------------
-- TRAILER: split BODY/CHASSIS, robotic fab, ends at COMPLIANCE_QC
-- BODY:    MAT_PROC → ROBOTIC_FAB → PAINT → BODY_FITOUT → FINAL_FITMENT → COMPLIANCE_QC
-- CHASSIS: CHASSIS_PREP → HYVA → FINAL_FITMENT → COMPLIANCE_QC
-- -------------------------------------------------------------------------
('TRAILER','BODY',   10, 1, FALSE),
('TRAILER','BODY',   25, 2, FALSE),
('TRAILER','BODY',   30, 3, FALSE),
('TRAILER','BODY',   40, 4, FALSE),
('TRAILER','BODY',   70, 5, FALSE),
('TRAILER','BODY',   90, 6, FALSE),

('TRAILER','CHASSIS',50, 1, FALSE),
('TRAILER','CHASSIS',60, 2, FALSE),
('TRAILER','CHASSIS',70, 3, FALSE),
('TRAILER','CHASSIS',90, 4, FALSE),

-- -------------------------------------------------------------------------
-- BODY_SWAP: chassis-only minimal flow
-- CHASSIS: CHASSIS_PREP → HYVA → FINAL_FITMENT → COMPLIANCE_QC
-- -------------------------------------------------------------------------
('BODY_SWAP','CHASSIS',50, 1, FALSE),
('BODY_SWAP','CHASSIS',60, 2, FALSE),
('BODY_SWAP','CHASSIS',70, 3, FALSE),
('BODY_SWAP','CHASSIS',90, 4, FALSE)

ON CONFLICT (body_type, track, sort_order) DO NOTHING;

-- -------------------------------------------------------------------------
-- View for flow visualisation (E25). Joins flow_definitions → stations → kanban_stages.
-- Stations 70 and 90 share the same id as stages 70/90 (FITOUT / FINAL_QC)
-- which carry is_merge_point; all other stations get is_merge_point = FALSE.
-- -------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_flow_steps AS
SELECT
    fd.body_type,
    fd.track,
    fd.sort_order,
    fd.station_id,
    s.code          AS station_code,
    s.name          AS station_name,
    ks.id           AS stage_id,
    ks.code         AS stage_code,
    COALESCE(ks.is_merge_point, FALSE) AS is_merge_point,
    fd.is_optional
FROM flow_definitions fd
JOIN stations         s  ON s.id  = fd.station_id
LEFT JOIN kanban_stages ks ON ks.id = s.id;
