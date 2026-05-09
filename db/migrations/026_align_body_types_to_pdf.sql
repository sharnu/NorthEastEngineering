-- 026_align_body_types_to_pdf.sql
-- Phase 1 of operational-flow alignment with NE Operation flow PDF.
-- Adds BEAVERTAIL (B-1) and TRAILER (B-2) as body_types so future templates
-- can reference them. Both already appear as body_type strings in
-- flow_definitions (TRAILER from seed 002, BEAVERTAIL from seed 018), but
-- had no body_types row, blocking template authoring.
--
-- Skipped per Phase 0 sign-off: WATER_CART (B-3), HOOK_LIFT (B-4),
-- VAC UNIT clarification (B-5).
BEGIN;

INSERT INTO body_types (id, code, name, description, sort_order) VALUES
    (12, 'BV', 'Beavertail',  'Beavertail load deck (recovery / equipment haul)', 35),
    (13, 'TL', 'Trailer',     'Trailer (semi or rigid trailer build, no truck chassis)', 25)
ON CONFLICT (id) DO NOTHING;

COMMIT;
