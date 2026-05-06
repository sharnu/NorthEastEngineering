-- ============================================================================
-- Demo production-line data (idempotent, re-runnable)
-- Today  = 2026-05-05
-- Weeks  = May 4 (started), May 11 (next), May 18 (following)
--
-- Six ROs spanning the full lifecycle:
--   RO99001  COMPLETED       — full flow, QC done 2026-05-04
--   RO99002  IN_PROGRESS     — at FINAL_QC stage, awaiting QC submission
--   RO99003  IN_PROGRESS     — mid-build (fabrication), active clock-in
--   RO99004  APPROVED        — drafted, customer-approved, chassis allocated
--                              (scheduled to start week of May 11)
--   RO99005  DRAFT           — drafter working now (week of May 11)
--   RO99006  DRAFT           — just created (scheduled week of May 18)
--
-- Apply with `make demo` (after `make up`).
-- ============================================================================

BEGIN;

-- ─── 1. Demo ROs ────────────────────────────────────────────────────────────
-- We pull customer_id and template_version_id from already-seeded rows.

INSERT INTO repair_orders (
  id, ro_number, customer_id, template_code, template_version_id, job_type_id,
  vin, rego, chassis_number, engine_number, make, model, paint_colour,
  ro_date, expected_in_date, required_date, delivery_date,
  status, priority, notes,
  created_by, drafting_status, scheduled_start_week,
  drafted_by, drafted_at,
  cancelled_at, cancellation_reason, cancelled_by, reopened_at, reopened_by,
  actual_completion_at, created_at, updated_at
)
SELECT * FROM (VALUES
  -- ── RO99001 — COMPLETED on 2026-05-04 ────────────────────────────────────
  ('99000001-9999-0000-0000-000000000001'::uuid, 'RO99001',
    (SELECT id FROM customers WHERE code='DFE'),
    'TP42N', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 1::smallint,
    'JALC4B16007900001', 'DFE-001', 'JALC4B16007900001', 'ENG-NPR-001',
    'Isuzu', 'NPR75-190', 'White',
    DATE '2026-04-13', '2026-04-13 09:00+00'::timestamptz, '2026-05-04 16:00+00'::timestamptz, '2026-05-04 16:00+00'::timestamptz,
    'COMPLETED', 3::smallint, 'Standard 4.2m tipper for DFE Sydney depot.',
    '11111111-1111-1111-1111-111111111111'::uuid, 'COMPLETED', DATE '2026-04-20',
    '22222222-2222-2222-2222-222222222222'::uuid, '2026-04-15 16:00+00'::timestamptz,
    NULL::timestamptz, NULL::text, NULL::uuid, NULL::timestamptz, NULL::uuid,
    '2026-05-04 15:30+00'::timestamptz, '2026-04-13 10:00+00'::timestamptz, '2026-05-04 15:30+00'::timestamptz),

  -- ── RO99002 — At FINAL_QC, awaiting QC submission ────────────────────────
  ('99000002-9999-0000-0000-000000000002'::uuid, 'RO99002',
    (SELECT id FROM customers WHERE code='DFE'),
    'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 1::smallint,
    'JALC5C18807900002', 'DFE-002', 'JALC5C18807900002', 'ENG-FRR-002',
    'Isuzu', 'FRR110-260', 'White',
    DATE '2026-04-20', '2026-04-20 09:00+00'::timestamptz, '2026-05-08 16:00+00'::timestamptz, '2026-05-08 16:00+00'::timestamptz,
    'IN_PROGRESS', 3::smallint, 'DFE Tautliner — at final QC, ready for blue plate.',
    '11111111-1111-1111-1111-111111111111'::uuid, 'COMPLETED', DATE '2026-04-27',
    '22222222-2222-2222-2222-222222222222'::uuid, '2026-04-22 14:00+00'::timestamptz,
    NULL::timestamptz, NULL::text, NULL::uuid, NULL::timestamptz, NULL::uuid,
    NULL::timestamptz, '2026-04-20 10:00+00'::timestamptz, '2026-05-05 09:00+00'::timestamptz),

  -- ── RO99003 — In Fabrication, active clock-in today ──────────────────────
  ('99000003-9999-0000-0000-000000000003'::uuid, 'RO99003',
    (SELECT id FROM customers WHERE code='DFE'),
    'TP42N', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 1::smallint,
    'JALC4B16007900003', 'DFE-003', 'JALC4B16007900003', 'ENG-NPR-003',
    'Isuzu', 'NPR75-190', 'Blue',
    DATE '2026-04-27', '2026-04-27 09:00+00'::timestamptz, '2026-05-15 16:00+00'::timestamptz, NULL::timestamptz,
    'IN_PROGRESS', 2::smallint, 'High priority — DFE Brisbane delivery.',
    '11111111-1111-1111-1111-111111111111'::uuid, 'COMPLETED', DATE '2026-05-04',
    '22222222-2222-2222-2222-222222222222'::uuid, '2026-04-29 16:00+00'::timestamptz,
    NULL::timestamptz, NULL::text, NULL::uuid, NULL::timestamptz, NULL::uuid,
    NULL::timestamptz, '2026-04-27 10:00+00'::timestamptz, '2026-05-05 09:30+00'::timestamptz),

  -- ── RO99004 — APPROVED, JOB_RECEIVED, scheduled May 11 ──────────────────
  ('99000004-9999-0000-0000-000000000004'::uuid, 'RO99004',
    (SELECT id FROM customers WHERE code='DFE'),
    'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 1::smallint,
    'JALC5C18807900004', 'DFE-004', 'JALC5C18807900004', 'ENG-FRR-004',
    'Isuzu', 'FRR110-260', 'White',
    DATE '2026-05-01', '2026-05-11 09:00+00'::timestamptz, '2026-05-29 16:00+00'::timestamptz, NULL::timestamptz,
    'APPROVED', 3::smallint, 'Drafted and approved — kicks off Mon 2026-05-11.',
    '11111111-1111-1111-1111-111111111111'::uuid, 'COMPLETED', DATE '2026-05-11',
    '22222222-2222-2222-2222-222222222222'::uuid, '2026-05-04 12:00+00'::timestamptz,
    NULL::timestamptz, NULL::text, NULL::uuid, NULL::timestamptz, NULL::uuid,
    NULL::timestamptz, '2026-05-01 10:00+00'::timestamptz, '2026-05-04 14:00+00'::timestamptz),

  -- ── RO99005 — DRAFT, IN_DRAFTING ────────────────────────────────────────
  ('99000005-9999-0000-0000-000000000005'::uuid, 'RO99005',
    (SELECT id FROM customers WHERE code='DFE'),
    'TP42N', 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, 1::smallint,
    NULL, 'DFE-005', NULL, NULL,
    'Isuzu', 'NPR75-190', 'White',
    DATE '2026-05-04', '2026-05-11 09:00+00'::timestamptz, '2026-06-01 16:00+00'::timestamptz, NULL::timestamptz,
    'DRAFT', 3::smallint, 'Drafter working on layout — chassis to be sourced.',
    '11111111-1111-1111-1111-111111111111'::uuid, 'IN_PROGRESS', DATE '2026-05-11',
    NULL::uuid, NULL::timestamptz,
    NULL::timestamptz, NULL::text, NULL::uuid, NULL::timestamptz, NULL::uuid,
    NULL::timestamptz, '2026-05-04 11:00+00'::timestamptz, '2026-05-05 08:00+00'::timestamptz),

  -- ── RO99006 — DRAFT, just created today ─────────────────────────────────
  ('99000006-9999-0000-0000-000000000006'::uuid, 'RO99006',
    (SELECT id FROM customers WHERE code='DFE'),
    'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, 1::smallint,
    NULL, 'DFE-006', NULL, NULL,
    'Isuzu', 'FRR110-260', NULL,
    DATE '2026-05-05', NULL::timestamptz, '2026-06-08 16:00+00'::timestamptz, NULL::timestamptz,
    'DRAFT', 3::smallint, 'Just received — awaiting drafter handoff.',
    '11111111-1111-1111-1111-111111111111'::uuid, 'NOT_STARTED', DATE '2026-05-18',
    NULL::uuid, NULL::timestamptz,
    NULL::timestamptz, NULL::text, NULL::uuid, NULL::timestamptz, NULL::uuid,
    NULL::timestamptz, '2026-05-05 09:00+00'::timestamptz, '2026-05-05 09:00+00'::timestamptz)
) AS v(
  id, ro_number, customer_id, template_code, template_version_id, job_type_id,
  vin, rego, chassis_number, engine_number, make, model, paint_colour,
  ro_date, expected_in_date, required_date, delivery_date,
  status, priority, notes,
  created_by, drafting_status, scheduled_start_week,
  drafted_by, drafted_at,
  cancelled_at, cancellation_reason, cancelled_by, reopened_at, reopened_by,
  actual_completion_at, created_at, updated_at
)
ON CONFLICT (id) DO NOTHING;

-- ─── 2. Demo chassis (must come AFTER ROs because of FK on allocated_to_ro) ─
INSERT INTO chassis_inventory (id, chassis_number, description, chassis_class, status, allocated_to_ro, received_at, allocated_at, created_at, updated_at) VALUES
  ('c1000001-cccc-0000-0000-000000000001', 'JALC4B16007900001', 'Isuzu NPR75-190 Auto', 'N', 'DELIVERED',  '99000001-9999-0000-0000-000000000001', '2026-04-01 09:00+00', '2026-04-13 10:00+00', '2026-04-01 09:00+00', '2026-05-04 16:00+00'),
  ('c1000002-cccc-0000-0000-000000000002', 'JALC5C18807900002', 'Isuzu FRR110-260 Auto', 'F', 'ALLOCATED', '99000002-9999-0000-0000-000000000002', '2026-04-08 09:00+00', '2026-04-20 10:00+00', '2026-04-08 09:00+00', '2026-04-20 10:00+00'),
  ('c1000003-cccc-0000-0000-000000000003', 'JALC4B16007900003', 'Isuzu NPR75-190 Manual', 'N', 'ALLOCATED', '99000003-9999-0000-0000-000000000003', '2026-04-15 09:00+00', '2026-04-27 10:00+00', '2026-04-15 09:00+00', '2026-04-27 10:00+00'),
  ('c1000004-cccc-0000-0000-000000000004', 'JALC5C18807900004', 'Isuzu FRR110-260 Auto', 'F', 'ALLOCATED', '99000004-9999-0000-0000-000000000004', '2026-04-22 09:00+00', '2026-05-01 10:00+00', '2026-04-22 09:00+00', '2026-05-01 10:00+00')
ON CONFLICT (chassis_number) DO NOTHING;

-- ─── 3. Materialise job_tasks from template_operations ──────────────────────
-- One block per RO. Uses the seeded operation_catalog.canonical_name for the
-- snapshot, mirroring the API's RO-creation behaviour.

INSERT INTO job_tasks (id, ro_id, sequence, job_code_line, operation_id, operation_name, station_id, estimated_hours, status, created_at, updated_at)
SELECT gen_random_uuid(), v.ro_id, tops.sequence,
       LPAD(tops.sequence::TEXT, 2, '0') || v.template_code || '-' || oc.code,
       tops.operation_id, oc.canonical_name,
       COALESCE(tops.station_id_override, oc.default_station_id),
       tops.estimated_hours, 'PENDING',
       v.created_at, v.created_at
FROM (VALUES
  ('99000001-9999-0000-0000-000000000001'::uuid, 'TP42N',     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '2026-04-13 10:00+00'::timestamptz),
  ('99000002-9999-0000-0000-000000000002'::uuid, 'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, '2026-04-20 10:00+00'::timestamptz),
  ('99000003-9999-0000-0000-000000000003'::uuid, 'TP42N',     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid, '2026-04-27 10:00+00'::timestamptz),
  ('99000004-9999-0000-0000-000000000004'::uuid, 'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb'::uuid, '2026-05-01 10:00+00'::timestamptz)
) AS v(ro_id, template_code, tv_id, created_at)
JOIN template_operations tops ON tops.template_version_id = v.tv_id
JOIN operation_catalog oc      ON oc.id = tops.operation_id
WHERE NOT EXISTS (SELECT 1 FROM job_tasks jt WHERE jt.ro_id = v.ro_id);

-- RO99005 + RO99006 stay task-less (still in DRAFT).

-- ─── 4. RO99001 — COMPLETED: every task done with realistic time entries ────
-- NOTE: actual_hours is computed by trigger trg_time_entry_recompute from
--       time_entries. So we set status/assignments here, then let the trigger
--       set actual_hours when we INSERT each time_entry below.
UPDATE job_tasks SET
  status                = 'COMPLETED',
  assigned_to_user_id   = CASE station_id
                              WHEN 10 THEN '7a000010-7777-7777-7777-000000000001'::uuid  -- marcus
                              WHEN 20 THEN '44444444-4444-4444-4444-444444444444'::uuid  -- peter
                              WHEN 25 THEN '7a000020-7777-7777-7777-000000000001'::uuid  -- dave
                              WHEN 30 THEN '55555555-5555-5555-5555-555555555555'::uuid  -- kane
                              WHEN 40 THEN '66666666-6666-6666-6666-666666666666'::uuid  -- adam
                              WHEN 50 THEN '7a000050-7777-7777-7777-000000000001'::uuid  -- scott
                              WHEN 60 THEN '7a000060-7777-7777-7777-000000000001'::uuid  -- garry
                              WHEN 70 THEN '7a000070-7777-7777-7777-000000000001'::uuid  -- tony
                              WHEN 80 THEN '7a000080-7777-7777-7777-000000000001'::uuid  -- ray
                              WHEN 90 THEN '7a000090-7777-7777-7777-000000000001'::uuid  -- greg
                              ELSE NULL
                          END,
  assigned_by_user_id   = '33333333-3333-3333-3333-333333333333'::uuid,
  assigned_at           = '2026-04-20 08:00+00'::timestamptz,
  started_at            = '2026-04-20 08:30+00'::timestamptz,
  completed_at          = '2026-05-04 15:30+00'::timestamptz,
  updated_at            = '2026-05-04 15:30+00'::timestamptz
WHERE ro_id = '99000001-9999-0000-0000-000000000001';

-- One closed time entry per task. Span = estimated_hours * 1.05 hours, ending
-- at completed_at, so the recompute trigger lands actual_hours within ~5% of estimate.
INSERT INTO time_entries (id, task_id, user_id, clock_in, clock_out, activity_type, notes)
SELECT gen_random_uuid(), jt.id, jt.assigned_to_user_id,
       jt.completed_at - (ROUND(jt.estimated_hours * 1.05, 2) * INTERVAL '1 hour'),
       jt.completed_at, 'WORK', 'Demo completed work'
FROM job_tasks jt
WHERE jt.ro_id = '99000001-9999-0000-0000-000000000001'
  AND jt.assigned_to_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.task_id = jt.id);

-- Variance records — most AS_ESTIMATED, one OTHER (overrun) for realism
INSERT INTO variance_records (id, task_id, estimated_hours, actual_hours, reason_id, notes, recorded_by, recorded_at)
SELECT gen_random_uuid(), jt.id, jt.estimated_hours, jt.actual_hours,
       CASE WHEN jt.sequence = 4 THEN 1 ELSE 11 END,  -- task 4 = MISSING_PARTS (demo); rest AS_ESTIMATED
       CASE WHEN jt.sequence = 4 THEN 'Welder gas bottle ran out — 30min downtime' ELSE NULL END,
       jt.assigned_to_user_id, jt.completed_at
FROM job_tasks jt
WHERE jt.ro_id = '99000001-9999-0000-0000-000000000001'
  AND jt.assigned_to_user_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM variance_records vr WHERE vr.task_id = jt.id);

-- QC results — all 6 items passed
INSERT INTO qc_results (id, ro_id, item_code, passed, recorded_by, recorded_at)
SELECT gen_random_uuid(), '99000001-9999-0000-0000-000000000001'::uuid, ic.code, TRUE,
       '7a000090-7777-7777-7777-000000000001'::uuid,  -- greg (QC)
       '2026-05-04 15:00+00'::timestamptz
FROM qc_checklist_items ic
WHERE NOT EXISTS (SELECT 1 FROM qc_results r WHERE r.ro_id = '99000001-9999-0000-0000-000000000001' AND r.item_code = ic.code);

-- QC submission
INSERT INTO qc_submissions (id, ro_id, task_id, submitted_by, submitted_at, item_responses, notes, email_sent, email_sent_at, email_to)
SELECT 'aa000001-aaaa-0000-0000-000000000001'::uuid,
       '99000001-9999-0000-0000-000000000001'::uuid,
       jt.id,
       '7a000090-7777-7777-7777-000000000001'::uuid,
       '2026-05-04 15:30+00'::timestamptz,
       jsonb_build_array(
         jsonb_build_object('itemCode','DIMENSIONS_VERIFIED',  'label','Dimensions verified against drawing',           'checked',TRUE),
         jsonb_build_object('itemCode','WELD_QUALITY_CHECKED', 'label','Weld quality — all welds, seams and mounts inspected','checked',TRUE),
         jsonb_build_object('itemCode','PAINT_FINISH_ACCEPTED','label','Paint finish — colour match, gloss, coverage',  'checked',TRUE),
         jsonb_build_object('itemCode','ELECTRICAL_TESTED',    'label','Electrical systems tested',                     'checked',TRUE),
         jsonb_build_object('itemCode','PLACARDS_FITTED',      'label','Compliance placards fitted',                    'checked',TRUE),
         jsonb_build_object('itemCode','PHOTOS_COMPLETE',      'label','Photo evidence complete',                       'checked',TRUE)
       ),
       'Blue plate issued. All checks passed.', TRUE, '2026-05-04 15:31+00'::timestamptz, 'qc@dfe.com.au'
FROM job_tasks jt
WHERE jt.ro_id = '99000001-9999-0000-0000-000000000001' AND jt.station_id = 90
LIMIT 1
ON CONFLICT (ro_id) DO NOTHING;

-- ─── 5. RO99002 — at FINAL_QC: all work tasks done, QC task PENDING ────────
UPDATE job_tasks SET
  status                = 'COMPLETED',
  assigned_to_user_id   = CASE station_id
                              WHEN 10 THEN '7a000010-7777-7777-7777-000000000001'::uuid
                              WHEN 20 THEN '44444444-4444-4444-4444-444444444444'::uuid
                              WHEN 25 THEN '7a000020-7777-7777-7777-000000000001'::uuid
                              WHEN 30 THEN '55555555-5555-5555-5555-555555555555'::uuid
                              WHEN 40 THEN '66666666-6666-6666-6666-666666666666'::uuid
                              WHEN 50 THEN '7a000050-7777-7777-7777-000000000001'::uuid
                              WHEN 60 THEN '7a000060-7777-7777-7777-000000000001'::uuid
                              WHEN 70 THEN '7a000070-7777-7777-7777-000000000001'::uuid
                              WHEN 80 THEN '7a000080-7777-7777-7777-000000000001'::uuid
                              ELSE NULL
                          END,
  assigned_by_user_id   = '33333333-3333-3333-3333-333333333333'::uuid,
  assigned_at           = '2026-04-27 08:00+00'::timestamptz,
  started_at            = '2026-04-27 08:30+00'::timestamptz,
  completed_at          = '2026-05-04 16:00+00'::timestamptz,
  updated_at            = '2026-05-04 16:00+00'::timestamptz
WHERE ro_id = '99000002-9999-0000-0000-000000000002' AND station_id <> 90;

-- QC task assigned to greg, PENDING
UPDATE job_tasks SET
  assigned_to_user_id   = '7a000090-7777-7777-7777-000000000001'::uuid,
  assigned_by_user_id   = '33333333-3333-3333-3333-333333333333'::uuid,
  assigned_at           = '2026-05-05 08:00+00'::timestamptz,
  status                = 'ASSIGNED'
WHERE ro_id = '99000002-9999-0000-0000-000000000002' AND station_id = 90;

INSERT INTO time_entries (id, task_id, user_id, clock_in, clock_out, activity_type)
SELECT gen_random_uuid(), jt.id, jt.assigned_to_user_id,
       jt.completed_at - (ROUND(jt.estimated_hours * 0.98, 2) * INTERVAL '1 hour'),
       jt.completed_at, 'WORK'
FROM job_tasks jt
WHERE jt.ro_id = '99000002-9999-0000-0000-000000000002'
  AND jt.status = 'COMPLETED'
  AND NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.task_id = jt.id);

-- ─── 6. RO99003 — mid-build: through fab, currently in fitout ───────────────
-- Tasks at stations 10, 20, 25, 30 are COMPLETED; station 40 task is IN_PROGRESS (open clock-in); rest PENDING.
UPDATE job_tasks SET
  status                = 'COMPLETED',
  assigned_to_user_id   = CASE station_id
                              WHEN 10 THEN '7a000010-7777-7777-7777-000000000001'::uuid
                              WHEN 20 THEN '44444444-4444-4444-4444-444444444444'::uuid
                              WHEN 25 THEN '7a000020-7777-7777-7777-000000000001'::uuid
                              WHEN 30 THEN '55555555-5555-5555-5555-555555555555'::uuid
                              ELSE assigned_to_user_id
                          END,
  assigned_by_user_id   = '33333333-3333-3333-3333-333333333333'::uuid,
  assigned_at           = '2026-05-04 08:00+00'::timestamptz,
  started_at            = '2026-05-04 08:30+00'::timestamptz,
  completed_at          = '2026-05-04 16:00+00'::timestamptz,
  updated_at            = '2026-05-04 16:00+00'::timestamptz
WHERE ro_id = '99000003-9999-0000-0000-000000000003'
  AND station_id IN (10, 20, 25, 30);

-- One IN_PROGRESS task at station 40 (chosen as the lowest sequence for that station)
UPDATE job_tasks SET
  status                = 'IN_PROGRESS',
  assigned_to_user_id   = '66666666-6666-6666-6666-666666666666'::uuid,
  assigned_by_user_id   = '33333333-3333-3333-3333-333333333333'::uuid,
  assigned_at           = '2026-05-05 08:00+00'::timestamptz,
  started_at            = '2026-05-05 08:30+00'::timestamptz,
  updated_at            = '2026-05-05 09:30+00'::timestamptz
WHERE ro_id = '99000003-9999-0000-0000-000000000003'
  AND id = (SELECT id FROM job_tasks WHERE ro_id = '99000003-9999-0000-0000-000000000003' AND station_id = 40 ORDER BY sequence LIMIT 1);

-- Closed time entries for completed tasks (span = estimated_hours, on-time)
INSERT INTO time_entries (id, task_id, user_id, clock_in, clock_out, activity_type)
SELECT gen_random_uuid(), jt.id, jt.assigned_to_user_id,
       jt.completed_at - (jt.estimated_hours * INTERVAL '1 hour'),
       jt.completed_at, 'WORK'
FROM job_tasks jt
WHERE jt.ro_id = '99000003-9999-0000-0000-000000000003'
  AND jt.status = 'COMPLETED'
  AND NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.task_id = jt.id);

-- Open clock-in on the IN_PROGRESS task
INSERT INTO time_entries (id, task_id, user_id, clock_in, clock_out, activity_type, notes)
SELECT gen_random_uuid(), jt.id, jt.assigned_to_user_id, jt.started_at, NULL, 'WORK', 'In progress'
FROM job_tasks jt
WHERE jt.ro_id = '99000003-9999-0000-0000-000000000003'
  AND jt.status = 'IN_PROGRESS'
  AND NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.task_id = jt.id);

-- ─── 7. RO99004 — APPROVED, ready to start, all tasks PENDING ───────────────
-- Tasks remain PENDING (default). No further updates needed.

-- ─── 8. ro_kanban_state ─────────────────────────────────────────────────────
INSERT INTO ro_kanban_state (ro_id, current_stage_id, entered_stage_at, updated_at) VALUES
  ('99000001-9999-0000-0000-000000000001', 99, '2026-05-04 15:30+00', '2026-05-04 15:30+00'),  -- COMPLETE
  ('99000002-9999-0000-0000-000000000002', 90, '2026-05-04 16:00+00', '2026-05-05 08:00+00'),  -- FINAL_QC
  ('99000003-9999-0000-0000-000000000003', 40, '2026-05-05 08:00+00', '2026-05-05 09:30+00'),  -- FABRICATION
  ('99000004-9999-0000-0000-000000000004', 10, '2026-05-04 14:00+00', '2026-05-04 14:00+00'),  -- JOB_RECEIVED
  ('99000005-9999-0000-0000-000000000005', 20, '2026-05-04 11:30+00', '2026-05-05 08:00+00'),  -- IN_DRAFTING
  ('99000006-9999-0000-0000-000000000006', 10, '2026-05-05 09:00+00', '2026-05-05 09:00+00')   -- JOB_RECEIVED
ON CONFLICT (ro_id) DO NOTHING;

-- ─── 9. customer_approvals (LAYOUT signed for ROs 1-4) ──────────────────────
INSERT INTO customer_approvals (id, ro_id, document_type, signed_at, signed_by_name, notes) VALUES
  ('a0000001-aaaa-0000-0000-000000000001', '99000001-9999-0000-0000-000000000001', 'LAYOUT', '2026-04-15 10:00+00', 'Sam Patel (DFE)',  'Approved via email reply.'),
  ('a0000002-aaaa-0000-0000-000000000002', '99000002-9999-0000-0000-000000000002', 'LAYOUT', '2026-04-22 14:30+00', 'Sam Patel (DFE)',  'Approved with no changes.'),
  ('a0000003-aaaa-0000-0000-000000000003', '99000003-9999-0000-0000-000000000003', 'LAYOUT', '2026-04-30 09:00+00', 'Mark Hines (DFE)', 'Approved.'),
  ('a0000004-aaaa-0000-0000-000000000004', '99000004-9999-0000-0000-000000000004', 'LAYOUT', '2026-05-04 12:30+00', 'Sam Patel (DFE)',  'Approved — start week of 2026-05-11.')
ON CONFLICT (id) DO NOTHING;

-- ─── 10. domain_events audit trail ──────────────────────────────────────────
INSERT INTO domain_events (event_type, aggregate_type, aggregate_id, payload, user_id, occurred_at) VALUES
  ('RoCreated',  'RepairOrder', '99000001-9999-0000-0000-000000000001', jsonb_build_object('roNumber','RO99001','templateCode','TP42N'),    '11111111-1111-1111-1111-111111111111', '2026-04-13 10:00+00'),
  ('QcPassed',   'RepairOrder', '99000001-9999-0000-0000-000000000001', jsonb_build_object('roNumber','RO99001','submittedBy','greg','emailTo','qc@dfe.com.au'), '7a000090-7777-7777-7777-000000000001', '2026-05-04 15:30+00'),
  ('RoCreated',  'RepairOrder', '99000002-9999-0000-0000-000000000002', jsonb_build_object('roNumber','RO99002','templateCode','DFE-TT67F'), '11111111-1111-1111-1111-111111111111', '2026-04-20 10:00+00'),
  ('RoCreated',  'RepairOrder', '99000003-9999-0000-0000-000000000003', jsonb_build_object('roNumber','RO99003','templateCode','TP42N'),     '11111111-1111-1111-1111-111111111111', '2026-04-27 10:00+00'),
  ('RoCreated',  'RepairOrder', '99000004-9999-0000-0000-000000000004', jsonb_build_object('roNumber','RO99004','templateCode','DFE-TT67F'), '11111111-1111-1111-1111-111111111111', '2026-05-01 10:00+00'),
  ('RoCreated',  'RepairOrder', '99000005-9999-0000-0000-000000000005', jsonb_build_object('roNumber','RO99005','templateCode','TP42N'),     '11111111-1111-1111-1111-111111111111', '2026-05-04 11:00+00'),
  ('RoCreated',  'RepairOrder', '99000006-9999-0000-0000-000000000006', jsonb_build_object('roNumber','RO99006','templateCode','DFE-TT67F'), '11111111-1111-1111-1111-111111111111', '2026-05-05 09:00+00');

COMMIT;

-- ─── Sanity report ──────────────────────────────────────────────────────────
SELECT ro_number, status,
       (SELECT current_stage_id FROM ro_kanban_state s WHERE s.ro_id = r.id) AS stage,
       (SELECT COUNT(*) FROM job_tasks jt WHERE jt.ro_id = r.id) AS tasks,
       (SELECT COUNT(*) FROM job_tasks jt WHERE jt.ro_id = r.id AND jt.status = 'COMPLETED') AS done,
       (SELECT COUNT(*) FROM time_entries te JOIN job_tasks jt ON jt.id = te.task_id WHERE jt.ro_id = r.id) AS time_entries
FROM repair_orders r
WHERE r.ro_number LIKE 'RO99%'
ORDER BY r.ro_number;
