-- 025_normalize_template_metadata.sql
-- Aligns templates seeded by 024 with the conventions used by seed 002:
--   • job_code_templates.name → clean human-readable label (no code prefix
--     or trailing 'INC:' boilerplate).
--   • template_versions.body_type → long-form value matching
--     flow_definitions.body_type so kanban stage advancement works
--     (was 2-char codes like 'TT'/'TR'/'TP', which produced
--     'No flow definition found for this station and body type' errors).
--
-- A fresh `make reset` would already produce these values via the
-- regenerated 024; this migration patches DBs that already applied 024.
BEGIN;

-- ── job_code_templates.name ──
UPDATE job_code_templates SET name = '6 Pallet Aluminium Monopan Body' WHERE code = 'BGT-DP42N';
UPDATE job_code_templates SET name = '10 Pallet Monopanel Rental Spec Body As Per Specification Inc Extras' WHERE code = 'BGT-DP67F-SD';
UPDATE job_code_templates SET name = 'Chipper Body' WHERE code = 'CH29N';
UPDATE job_code_templates SET name = 'Chipper Body' WHERE code = 'CH38F';
UPDATE job_code_templates SET name = '6 Pallet Aluminium Pantech As Per Specification Inc Extras' WHERE code = 'DFE-DP42N';
UPDATE job_code_templates SET name = '1 X DFE-5 Tautliner Body As Per Specification' WHERE code = 'DFE-TT52N';
UPDATE job_code_templates SET name = '6 Pallet Pantech Body' WHERE code = 'DP43N';
UPDATE job_code_templates SET name = '10 Pallet Pantech Body' WHERE code = 'DP67F';
UPDATE job_code_templates SET name = '10 Pallet Pantech Body' WHERE code = 'DP67F-SD';
UPDATE job_code_templates SET name = '8 Pallet Tautliner Body' WHERE code = 'IAL-TT55N';
UPDATE job_code_templates SET name = '10 Pallet Tautliner Body' WHERE code = 'IAL-TT65FD';
UPDATE job_code_templates SET name = '10 Pallet Tautliner Body' WHERE code = 'IAL-TT65FR';
UPDATE job_code_templates SET name = '14 Pallet Tautliner Body' WHERE code = 'IAL-TT89F';
UPDATE job_code_templates SET name = '14 Pallet Tautliner Body' WHERE code = 'IAL-TT91F';
UPDATE job_code_templates SET name = 'Vanpack Body As Per Specification Inc Extras' WHERE code = 'IAL-VP42N';
UPDATE job_code_templates SET name = '2-4 Tonne Tipper Body' WHERE code = 'TP32N';
UPDATE job_code_templates SET name = '2-4 Tonne Tipper Body, (use Std. 600mm Toolbox)' WHERE code = 'TP32N-T600';
UPDATE job_code_templates SET name = '2-4 Tonne Tipper Body, (use Std. 600mm Toolbox, 300mm Signrack)' WHERE code = 'TP32N-T600S300';
UPDATE job_code_templates SET name = '2-4 Tonne Tipper Body, (use Std. 900mm Toolbox)' WHERE code = 'TP32N-T900';
UPDATE job_code_templates SET name = '2-4 Tonne Tipper Body' WHERE code = 'TP40N';
UPDATE job_code_templates SET name = '5-7 Tonne Tipper Body, (use Std. 300mm Signrack)' WHERE code = 'TP42F-S300';
UPDATE job_code_templates SET name = '5-7 Tonne Tipper Body, (use Std. 600mm Toolbox)' WHERE code = 'TP42F-T600';
UPDATE job_code_templates SET name = '5-7 Tonne Tipper Body, (use Std. 600mm Toolbox, 300mm Signrack)' WHERE code = 'TP42F-T600S300';
UPDATE job_code_templates SET name = '5-7 Tonne Tipper Body' WHERE code = 'TP46F';
UPDATE job_code_templates SET name = '5-7 Tonne Tipper Body, (use Std. 600mm Toolbox)' WHERE code = 'TP46F-T600';
UPDATE job_code_templates SET name = '5-7 Tonne Tipper Body, (use Std. 600mm Toolbox, 300mm Signrack)' WHERE code = 'TP46F-T600S300';
UPDATE job_code_templates SET name = 'C/s Tipper: 4800mm X 2480mm X 800mm (h) Fixed Sides' WHERE code = 'TP48F';
UPDATE job_code_templates SET name = 'C/s Tipper: 5100mm X 2480mm X 1000mm (h) Fixed Sides' WHERE code = 'TP51F';
UPDATE job_code_templates SET name = 'C/s Tipper: 5500mm X 2480mm X 1200mm (h) Fixed Sides' WHERE code = 'TP55F';
UPDATE job_code_templates SET name = 'C/s Tipper: 6600mm X 2480mm X 1200mm (h) Fixed Sides' WHERE code = 'TP66F';
UPDATE job_code_templates SET name = '6 Pallet Traytop Body' WHERE code = 'TR45F';
UPDATE job_code_templates SET name = '6 Pallet Traytop Body With Dropsides' WHERE code = 'TR45F-D';
UPDATE job_code_templates SET name = '6 Pallet Traytop Body' WHERE code = 'TR45N';
UPDATE job_code_templates SET name = '6 Pallet Traytop Body With Dropsides' WHERE code = 'TR45N-D';
UPDATE job_code_templates SET name = '8 Pallet Traytop Body' WHERE code = 'TR56N';
UPDATE job_code_templates SET name = '8 Pallet Traytop Body With Dropsides' WHERE code = 'TR56N-D';
UPDATE job_code_templates SET name = '10 Pallet Traytop Body' WHERE code = 'TR65F';
UPDATE job_code_templates SET name = '12 Pallet Traytop Body' WHERE code = 'TR75F';
UPDATE job_code_templates SET name = '14 Pallet Traytop Body' WHERE code = 'TR91F';
UPDATE job_code_templates SET name = '2-4 Tonne Tipper Body' WHERE code = 'TS71F';
UPDATE job_code_templates SET name = '6 Pallet Tautliner Body' WHERE code = 'TT43N';
UPDATE job_code_templates SET name = '8 Pallet Tautliner Body' WHERE code = 'TT56N';
UPDATE job_code_templates SET name = '12 Pallet Tautliner Body' WHERE code = 'TT80F';
UPDATE job_code_templates SET name = '14 Pallet Tautliner Body' WHERE code = 'TT87F';
UPDATE job_code_templates SET name = '14 Pallet Tautliner Body' WHERE code = 'TT91F';

-- ── template_versions.body_type ──
UPDATE template_versions SET body_type = 'PANTECH_AL' WHERE template_code = 'BGT-DP42N' AND version_number = 1;
UPDATE template_versions SET body_type = 'PANTECH_AL' WHERE template_code = 'BGT-DP67F-SD' AND version_number = 1;
UPDATE template_versions SET body_type = 'CHIPPER_TIPPER_TRAY_CRANE' WHERE template_code = 'CH29N' AND version_number = 1;
UPDATE template_versions SET body_type = 'CHIPPER_TIPPER_TRAY_CRANE' WHERE template_code = 'CH38F' AND version_number = 1;
UPDATE template_versions SET body_type = 'PANTECH_AL' WHERE template_code = 'DFE-DP42N' AND version_number = 1;
UPDATE template_versions SET body_type = 'TAUTLINER' WHERE template_code = 'DFE-TT52N' AND version_number = 1;
UPDATE template_versions SET body_type = 'PANTECH_AL' WHERE template_code = 'DP43N' AND version_number = 1;
UPDATE template_versions SET body_type = 'PANTECH_AL' WHERE template_code = 'DP67F' AND version_number = 1;
UPDATE template_versions SET body_type = 'PANTECH_AL' WHERE template_code = 'DP67F-SD' AND version_number = 1;
UPDATE template_versions SET body_type = 'TAUTLINER' WHERE template_code = 'IAL-TT55N' AND version_number = 1;
UPDATE template_versions SET body_type = 'TAUTLINER' WHERE template_code = 'IAL-TT65FD' AND version_number = 1;
UPDATE template_versions SET body_type = 'TAUTLINER' WHERE template_code = 'IAL-TT65FR' AND version_number = 1;
UPDATE template_versions SET body_type = 'TAUTLINER' WHERE template_code = 'IAL-TT89F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TAUTLINER' WHERE template_code = 'IAL-TT91F' AND version_number = 1;
UPDATE template_versions SET body_type = 'PANTECH_AL' WHERE template_code = 'IAL-VP42N' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP32N' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP32N-T600' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP32N-T600S300' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP32N-T900' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP40N' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP42F-S300' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP42F-T600' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP42F-T600S300' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP46F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP46F-T600' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP46F-T600S300' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP48F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP51F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP55F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TIPPER_CS' WHERE template_code = 'TP66F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TRAY' WHERE template_code = 'TR45F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TRAY' WHERE template_code = 'TR45F-D' AND version_number = 1;
UPDATE template_versions SET body_type = 'TRAY' WHERE template_code = 'TR45N' AND version_number = 1;
UPDATE template_versions SET body_type = 'TRAY' WHERE template_code = 'TR45N-D' AND version_number = 1;
UPDATE template_versions SET body_type = 'TRAY' WHERE template_code = 'TR56N' AND version_number = 1;
UPDATE template_versions SET body_type = 'TRAY' WHERE template_code = 'TR56N-D' AND version_number = 1;
UPDATE template_versions SET body_type = 'TRAY' WHERE template_code = 'TR65F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TRAY' WHERE template_code = 'TR75F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TRAY' WHERE template_code = 'TR91F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TILT_SLIDER' WHERE template_code = 'TS71F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TAUTLINER' WHERE template_code = 'TT43N' AND version_number = 1;
UPDATE template_versions SET body_type = 'TAUTLINER' WHERE template_code = 'TT56N' AND version_number = 1;
UPDATE template_versions SET body_type = 'TAUTLINER' WHERE template_code = 'TT67F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TAUTLINER' WHERE template_code = 'TT80F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TAUTLINER' WHERE template_code = 'TT87F' AND version_number = 1;
UPDATE template_versions SET body_type = 'TAUTLINER' WHERE template_code = 'TT91F' AND version_number = 1;

COMMIT;
