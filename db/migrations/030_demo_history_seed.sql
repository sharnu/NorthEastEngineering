-- ============================================================================
-- Migration 030 — Demo history seed (past 2 weeks + forward backlog)
-- ----------------------------------------------------------------------------
-- Anchors the dataset to demo day 2026-05-11 (Mon, ISO Wk 20). Populates enough
-- repair-order history to fill every screen and report on the dashboard.
--
-- 18 repair orders across 4 cohorts:
--
--   A  R900001–R900005   Sched 2026-04-20 (Wk 18)  COMPLETED
--   B  R900006–R900010   Sched 2026-05-04 (Wk 19)  IN_PROGRESS (R900010 = HOSPITAL/ON_HOLD)
--   C  R900011–R900014   Sched 2026-05-11 (Wk 20)  APPROVED / IN_PROGRESS (today's intake)
--   D  R900015–R900018   Wk 21/22 (or unscheduled) APPROVED (scheduling backlog)
--
-- Determinism: every UUID is derived from RO seq (90000NNN-…), every timestamp
-- is an offset from a literal date — nothing depends on now(). Idempotent via
-- ON CONFLICT / WHERE NOT EXISTS, so re-running the migration is safe.
-- ============================================================================

-- ── 1. Demo chassis inventory ───────────────────────────────────────────────
-- Adds 18 chassis: 9 N-class (tipper) + 9 F-class (tautliner). Allocations to
-- ROs are applied in section 5b after the ROs exist.

INSERT INTO chassis_inventory
    (id, chassis_number, description, chassis_class, status, received_at, body_type, arrival_date)
VALUES
    ('99c00001-0000-0000-0000-000000000001'::uuid, 'CN-100', 'Isuzu NPR 75-190', 'N', 'AVAILABLE', '2026-04-05'::timestamptz, 'TIPPER_CS', '2026-04-05'::date),
    ('99c00002-0000-0000-0000-000000000002'::uuid, 'CN-101', 'Isuzu NPR 75-190', 'N', 'AVAILABLE', '2026-04-06'::timestamptz, 'TIPPER_CS', '2026-04-06'::date),
    ('99c00003-0000-0000-0000-000000000003'::uuid, 'CN-102', 'Isuzu NPR 75-190', 'N', 'AVAILABLE', '2026-04-10'::timestamptz, 'TIPPER_CS', '2026-04-10'::date),
    ('99c00004-0000-0000-0000-000000000004'::uuid, 'CN-103', 'Isuzu NLR 45-150', 'N', 'AVAILABLE', '2026-04-12'::timestamptz, 'TIPPER_CS', '2026-04-12'::date),
    ('99c00005-0000-0000-0000-000000000005'::uuid, 'CN-104', 'Isuzu NPR 75-190', 'N', 'AVAILABLE', '2026-04-18'::timestamptz, 'TIPPER_CS', '2026-04-18'::date),
    ('99c00006-0000-0000-0000-000000000006'::uuid, 'CN-105', 'Isuzu NPR 75-190', 'N', 'AVAILABLE', '2026-04-25'::timestamptz, 'TIPPER_CS', '2026-04-25'::date),
    ('99c00007-0000-0000-0000-000000000007'::uuid, 'CN-106', 'Isuzu NLR 45-150', 'N', 'AVAILABLE', '2026-04-28'::timestamptz, 'TIPPER_CS', '2026-04-28'::date),
    ('99c00008-0000-0000-0000-000000000008'::uuid, 'CN-107', 'Isuzu NPR 75-190', 'N', 'AVAILABLE', '2026-05-02'::timestamptz, 'TIPPER_CS', '2026-05-02'::date),
    ('99c00009-0000-0000-0000-000000000009'::uuid, 'CN-108', 'Isuzu NPR 75-190', 'N', 'AVAILABLE', '2026-05-06'::timestamptz, 'TIPPER_CS', '2026-05-06'::date),
    ('99c00010-0000-0000-0000-000000000010'::uuid, 'CF-200', 'Isuzu FRR 90-210', 'F', 'AVAILABLE', '2026-04-04'::timestamptz, 'TAUTLINER', '2026-04-04'::date),
    ('99c00011-0000-0000-0000-000000000011'::uuid, 'CF-201', 'Isuzu FRR 90-210', 'F', 'AVAILABLE', '2026-04-06'::timestamptz, 'TAUTLINER', '2026-04-06'::date),
    ('99c00012-0000-0000-0000-000000000012'::uuid, 'CF-202', 'Isuzu FRR 90-210', 'F', 'AVAILABLE', '2026-04-08'::timestamptz, 'TAUTLINER', '2026-04-08'::date),
    ('99c00013-0000-0000-0000-000000000013'::uuid, 'CF-203', 'Isuzu FRR 110-260', 'F', 'AVAILABLE', '2026-04-14'::timestamptz, 'TAUTLINER', '2026-04-14'::date),
    ('99c00014-0000-0000-0000-000000000014'::uuid, 'CF-204', 'Isuzu FRR 90-210', 'F', 'AVAILABLE', '2026-04-17'::timestamptz, 'TAUTLINER', '2026-04-17'::date),
    ('99c00015-0000-0000-0000-000000000015'::uuid, 'CF-205', 'Isuzu FRR 110-260', 'F', 'AVAILABLE', '2026-04-22'::timestamptz, 'TAUTLINER', '2026-04-22'::date),
    ('99c00016-0000-0000-0000-000000000016'::uuid, 'CF-206', 'Isuzu FRR 90-210', 'F', 'AVAILABLE', '2026-04-29'::timestamptz, 'TAUTLINER', '2026-04-29'::date),
    ('99c00017-0000-0000-0000-000000000017'::uuid, 'CF-207', 'Isuzu FRR 90-210', 'F', 'AVAILABLE', '2026-05-04'::timestamptz, 'TAUTLINER', '2026-05-04'::date),
    ('99c00018-0000-0000-0000-000000000018'::uuid, 'CF-208', 'Isuzu FRR 110-260', 'F', 'AVAILABLE', '2026-05-08'::timestamptz, 'TAUTLINER', '2026-05-08'::date)
ON CONFLICT (chassis_number) DO NOTHING;


-- ── 2. Repair orders ────────────────────────────────────────────────────────
-- Notes column carries the cohort tag for debugging; remove if it bothers anyone.
-- All ROs use the existing seeded template_versions:
--   TP42N     v1 → aaaaaaaa-…  (53.5h estimate)
--   DFE-TT67F v1 → bbbbbbbb-…  (62.5h estimate)
-- Customer IDs are looked up via the seeded codes (DFE, IAL, BGT).

INSERT INTO repair_orders (
    id, ro_number, source_ro_number, customer_id,
    template_code, template_version_id, job_type_id,
    vin, rego, chassis_number, make, model, paint_colour, colour, body_type,
    ro_date, expected_in_date, required_date, scheduled_start_week, actual_completion_at,
    status, drafting_status, priority, notes,
    created_by, drafted_by, drafted_at,
    created_at, updated_at
)
SELECT
    src.id::uuid,
    src.ro_number,
    src.source_ro_number,
    c.id,
    src.template_code,
    src.template_version_id::uuid,
    1,                                       -- NEW_BUILD
    src.vin, src.rego, src.chassis_number, 'Isuzu', src.model, src.paint_colour, src.paint_colour, src.body_type,
    src.ro_date::date,
    src.ro_date::timestamptz,
    src.required_date::timestamptz,
    src.scheduled_start_week::date,
    src.actual_completion_at::timestamptz,
    src.status,
    'COMPLETED',                             -- drafting done for all seeded ROs
    src.priority::smallint,
    src.notes,
    '11111111-1111-1111-1111-111111111111',  -- sales as creator
    '22222222-2222-2222-2222-222222222222',  -- drafter
    (src.ro_date::date + 3)::timestamptz,    -- drafted 3 days after RO date
    src.ro_date::timestamptz,
    src.ro_date::timestamptz
FROM (VALUES
    -- ── Cohort A — completed in the last 1–3 weeks ──────────────────────────
    ('90000001-0000-0000-0000-000000000001', 'R900001', '58801', 'DFE', 'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '6PVAU3JM200001', 'C04001', 'CF-200', 'FRR 90-210', 'White',  'TAUTLINER', '2026-04-06', '2026-04-20', '2026-04-30', '2026-04-30 16:00+00', 'COMPLETED', 3, 'cohort A · completed Wk 18'),
    ('90000002-0000-0000-0000-000000000002', 'R900002', '58802', 'IAL', 'TP42N',     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JAANPR75A02002', 'C04002', 'CN-100', 'NPR 75-190', 'Blue',   'TIPPER_CS', '2026-04-07', '2026-04-20', '2026-04-29', '2026-04-29 15:00+00', 'COMPLETED', 2, 'cohort A · completed Wk 18'),
    ('90000003-0000-0000-0000-000000000003', 'R900003', '58803', 'DFE', 'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '6PVAU3JM200003', 'C04003', 'CF-201', 'FRR 90-210', 'White',  'TAUTLINER', '2026-04-08', '2026-04-20', '2026-05-01', '2026-05-01 14:00+00', 'COMPLETED', 3, 'cohort A · completed Wk 18'),
    ('90000004-0000-0000-0000-000000000004', 'R900004', '58804', 'BGT', 'TP42N',     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JAANPR75A02004', 'C04004', 'CN-101', 'NPR 75-190', 'Red',    'TIPPER_CS', '2026-04-09', '2026-04-20', '2026-05-04', '2026-05-04 12:00+00', 'COMPLETED', 4, 'cohort A · completed Wk 18'),
    ('90000005-0000-0000-0000-000000000005', 'R900005', '58805', 'DFE', 'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '6PVAU3JM200005', 'C04005', 'CF-202', 'FRR 90-210', 'White',  'TAUTLINER', '2026-04-10', '2026-04-20', '2026-05-06', '2026-05-06 17:00+00', 'COMPLETED', 3, 'cohort A · completed Wk 18'),
    -- ── Cohort B — mid-build, scheduled Wk 19 (one in Hospital) ─────────────
    ('90000006-0000-0000-0000-000000000006', 'R900006', '58806', 'DFE', 'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '6PVAU3JM200006', 'C04006', 'CF-203', 'FRR 110-260','White',  'TAUTLINER', '2026-04-20', '2026-05-04', '2026-05-15', NULL, 'IN_PROGRESS', 2, 'cohort B · at Fabrication'),
    ('90000007-0000-0000-0000-000000000007', 'R900007', '58807', 'IAL', 'TP42N',     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JAANPR75A02007', 'C04007', 'CN-102', 'NPR 75-190', 'Yellow', 'TIPPER_CS', '2026-04-21', '2026-05-04', '2026-05-15', NULL, 'IN_PROGRESS', 3, 'cohort B · at Fabrication'),
    ('90000008-0000-0000-0000-000000000008', 'R900008', '58808', 'DFE', 'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '6PVAU3JM200008', 'C04008', 'CF-204', 'FRR 90-210', 'White',  'TAUTLINER', '2026-04-21', '2026-05-04', '2026-05-18', NULL, 'IN_PROGRESS', 3, 'cohort B · at Painting'),
    ('90000009-0000-0000-0000-000000000009', 'R900009', '58809', 'BGT', 'TP42N',     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JAANPR75A02009', 'C04009', 'CN-103', 'NLR 45-150', 'Green',  'TIPPER_CS', '2026-04-22', '2026-05-04', '2026-05-18', NULL, 'IN_PROGRESS', 4, 'cohort B · at Fitout'),
    ('90000010-0000-0000-0000-000000000010', 'R900010', '58810', 'DFE', 'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '6PVAU3JM200010', 'C04010', 'CF-205', 'FRR 110-260','White',  'TAUTLINER', '2026-04-22', '2026-05-04', '2026-05-22', NULL, 'ON_HOLD',     2, 'cohort B · Hospital zone'),
    -- ── Cohort C — this week's intake ───────────────────────────────────────
    ('90000011-0000-0000-0000-000000000011', 'R900011', '58811', 'IAL', 'TP42N',     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JAANPR75A02011', 'C04011', 'CN-104', 'NPR 75-190', 'White',  'TIPPER_CS', '2026-05-04', '2026-05-11', '2026-05-29', NULL, 'APPROVED',    3, 'cohort C · awaiting kick-off'),
    ('90000012-0000-0000-0000-000000000012', 'R900012', '58812', 'DFE', 'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '6PVAU3JM200012', 'C04012', 'CF-206', 'FRR 90-210', 'White',  'TAUTLINER', '2026-05-04', '2026-05-11', '2026-05-29', NULL, 'APPROVED',    3, 'cohort C · awaiting kick-off'),
    ('90000013-0000-0000-0000-000000000013', 'R900013', '58813', 'BGT', 'TP42N',     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JAANPR75A02013', 'C04013', 'CN-105', 'NPR 75-190', 'Orange', 'TIPPER_CS', '2026-05-05', '2026-05-11', '2026-05-29', NULL, 'IN_PROGRESS', 2, 'cohort C · at CNC'),
    ('90000014-0000-0000-0000-000000000014', 'R900014', '58814', 'DFE', 'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '6PVAU3JM200014', 'C04014', 'CF-207', 'FRR 90-210', 'White',  'TAUTLINER', '2026-05-05', '2026-05-11', '2026-05-29', NULL, 'IN_PROGRESS', 3, 'cohort C · at CNC'),
    -- ── Cohort D — scheduling backlog (future weeks / unscheduled) ──────────
    ('90000015-0000-0000-0000-000000000015', 'R900015', '58815', 'DFE', 'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '6PVAU3JM200015', 'C04015', 'CF-208', 'FRR 90-210', 'White',  'TAUTLINER', '2026-05-06', '2026-05-18', '2026-06-05', NULL, 'APPROVED',    3, 'cohort D · scheduled Wk 21'),
    ('90000016-0000-0000-0000-000000000016', 'R900016', '58816', 'IAL', 'TP42N',     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JAANPR75A02016', 'C04016', 'CN-106', 'NLR 45-150', 'White',  'TIPPER_CS', '2026-05-07', NULL,         '2026-06-08', NULL, 'APPROVED',    3, 'cohort D · unscheduled (gates green)'),
    ('90000017-0000-0000-0000-000000000017', 'R900017', '58817', 'BGT', 'DFE-TT67F', 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb', '6PVAU3JM200017', 'C04017', 'CF-NEW', 'FRR 90-210', 'Silver', 'TAUTLINER', '2026-05-08', NULL,         '2026-06-12', NULL, 'APPROVED',    3, 'cohort D · unscheduled (approval missing)'),
    ('90000018-0000-0000-0000-000000000018', 'R900018', '58818', 'DFE', 'TP42N',     'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', 'JAANPR75A02018', 'C04018', NULL,     'NPR 75-190', 'White',  'TIPPER_CS', '2026-05-08', NULL,         '2026-06-12', NULL, 'APPROVED',    3, 'cohort D · unscheduled (chassis missing)')
) AS src(
    id, ro_number, source_ro_number, customer_code,
    template_code, template_version_id,
    vin, rego, chassis_number, model, paint_colour, body_type,
    ro_date, scheduled_start_week, required_date, actual_completion_at,
    status, priority, notes
)
JOIN customers c ON c.code = src.customer_code
ON CONFLICT (ro_number) DO NOTHING;


-- ── 3. Customer approvals ───────────────────────────────────────────────────
-- All ROs except R900017 (cohort D — demo of missing-approval gate) get a
-- LAYOUT approval signed by the customer ~7 days before scheduled start.

INSERT INTO customer_approvals (id, ro_id, document_type, signed_at, signed_by_name, notes)
SELECT
    (replace(r.id::text, '90000', '90A00'))::uuid,
    r.id,
    'LAYOUT',
    COALESCE(r.scheduled_start_week::timestamptz, r.ro_date::timestamptz) - interval '4 days',
    'Customer Authoriser',
    'Layout sign-off (seed)'
FROM repair_orders r
WHERE r.ro_number LIKE 'R900%'
  AND r.ro_number <> 'R900017'
  AND NOT EXISTS (SELECT 1 FROM customer_approvals a WHERE a.ro_id = r.id);


-- ── 4. Kanban state ─────────────────────────────────────────────────────────
-- One row per RO in cohorts A/B/C. Cohort D stays off the board (still in
-- scheduling backlog). Stage IDs:
--   10 JOB_RECEIVED · 30 MAT_PROCESSING · 40 FABRICATION · 50 PAINTING
--   70 FITOUT · 95 HOSPITAL · 99 COMPLETE

INSERT INTO ro_kanban_state (ro_id, current_stage_id, entered_stage_at)
VALUES
    ('90000001-0000-0000-0000-000000000001'::uuid, 99, '2026-04-30 16:00+00'::timestamptz),
    ('90000002-0000-0000-0000-000000000002'::uuid, 99, '2026-04-29 15:00+00'::timestamptz),
    ('90000003-0000-0000-0000-000000000003'::uuid, 99, '2026-05-01 14:00+00'::timestamptz),
    ('90000004-0000-0000-0000-000000000004'::uuid, 99, '2026-05-04 12:00+00'::timestamptz),
    ('90000005-0000-0000-0000-000000000005'::uuid, 99, '2026-05-06 17:00+00'::timestamptz),
    ('90000006-0000-0000-0000-000000000006'::uuid, 40, '2026-05-06 09:00+00'::timestamptz),
    ('90000007-0000-0000-0000-000000000007'::uuid, 40, '2026-05-06 10:00+00'::timestamptz),
    ('90000008-0000-0000-0000-000000000008'::uuid, 50, '2026-05-07 14:00+00'::timestamptz),
    ('90000009-0000-0000-0000-000000000009'::uuid, 70, '2026-05-08 11:00+00'::timestamptz),
    ('90000010-0000-0000-0000-000000000010'::uuid, 95, '2026-05-07 16:00+00'::timestamptz),
    ('90000011-0000-0000-0000-000000000011'::uuid, 10, '2026-05-11 08:00+00'::timestamptz),
    ('90000012-0000-0000-0000-000000000012'::uuid, 10, '2026-05-11 08:30+00'::timestamptz),
    ('90000013-0000-0000-0000-000000000013'::uuid, 30, '2026-05-11 09:00+00'::timestamptz),
    ('90000014-0000-0000-0000-000000000014'::uuid, 30, '2026-05-11 09:30+00'::timestamptz)
ON CONFLICT (ro_id) DO NOTHING;


-- ── 5. Job tasks ────────────────────────────────────────────────────────────
-- 5a. Insert one task per template_operation per RO, with cohort-aware status,
-- actual_hours, and station-tech assignment.
--
-- Cohort logic uses an "in-progress station" per RO. Tasks at earlier stations
-- are COMPLETED, tasks at that station are IN_PROGRESS, later tasks are PENDING.
-- Cohort A → in_progress_station = 999 (all complete). Cohort D → -1 (all pending).
--
-- Variance multiplier per task is deterministic:
--   bucket = (ro_seq * 13 + sequence * 7) mod 5
--   0 → 1.30 (big overrun)   1 → 1.15 (mod)   2 → 1.05 (slight)
--   3 → 0.95 (under)         4 → 1.00 (on est)
-- For pending tasks the multiplier is ignored (actual_hours = 0).
-- For in-progress tasks: actual_hours = est * 0.55 (≈ 55% complete).

WITH cohorts AS (
    SELECT * FROM (VALUES
        -- ro_uuid, ro_seq, cohort, in_progress_station, sched_start_ts
        ('90000001-0000-0000-0000-000000000001'::uuid,  1, 'A', 999, '2026-04-20 08:00+00'::timestamptz),
        ('90000002-0000-0000-0000-000000000002'::uuid,  2, 'A', 999, '2026-04-20 08:00+00'::timestamptz),
        ('90000003-0000-0000-0000-000000000003'::uuid,  3, 'A', 999, '2026-04-20 08:00+00'::timestamptz),
        ('90000004-0000-0000-0000-000000000004'::uuid,  4, 'A', 999, '2026-04-20 08:00+00'::timestamptz),
        ('90000005-0000-0000-0000-000000000005'::uuid,  5, 'A', 999, '2026-04-20 08:00+00'::timestamptz),
        ('90000006-0000-0000-0000-000000000006'::uuid,  6, 'B',  20, '2026-05-04 08:00+00'::timestamptz),
        ('90000007-0000-0000-0000-000000000007'::uuid,  7, 'B',  20, '2026-05-04 08:00+00'::timestamptz),
        ('90000008-0000-0000-0000-000000000008'::uuid,  8, 'B',  30, '2026-05-04 08:00+00'::timestamptz),
        ('90000009-0000-0000-0000-000000000009'::uuid,  9, 'B',  40, '2026-05-04 08:00+00'::timestamptz),
        ('90000010-0000-0000-0000-000000000010'::uuid, 10, 'B',  -1, '2026-05-04 08:00+00'::timestamptz), -- hospital: stations <=30 complete, 40+ pending
        ('90000011-0000-0000-0000-000000000011'::uuid, 11, 'C',  -1, '2026-05-11 08:00+00'::timestamptz), -- not started
        ('90000012-0000-0000-0000-000000000012'::uuid, 12, 'C',  -1, '2026-05-11 08:00+00'::timestamptz),
        ('90000013-0000-0000-0000-000000000013'::uuid, 13, 'C',  10, '2026-05-11 08:00+00'::timestamptz),
        ('90000014-0000-0000-0000-000000000014'::uuid, 14, 'C',  10, '2026-05-11 08:00+00'::timestamptz),
        ('90000015-0000-0000-0000-000000000015'::uuid, 15, 'D',  -1, '2026-05-18 08:00+00'::timestamptz),
        ('90000016-0000-0000-0000-000000000016'::uuid, 16, 'D',  -1, '2026-05-18 08:00+00'::timestamptz),
        ('90000017-0000-0000-0000-000000000017'::uuid, 17, 'D',  -1, '2026-05-25 08:00+00'::timestamptz),
        ('90000018-0000-0000-0000-000000000018'::uuid, 18, 'D',  -1, '2026-05-25 08:00+00'::timestamptz)
    ) AS t(ro_id, ro_seq, cohort, in_progress_station, sched_start_ts)
),
src AS (
    SELECT
        c.ro_id,
        c.ro_seq,
        c.cohort,
        c.in_progress_station,
        c.sched_start_ts,
        to_.sequence,
        to_.operation_id,
        oc.canonical_name AS operation_name,
        COALESCE(to_.station_id_override, oc.default_station_id) AS station_id,
        to_.estimated_hours,
        -- Compute the task status given cohort + station vs in_progress_station.
        -- Hospital special-case (R900010): stations <= 30 COMPLETED, station 40 IN_PROGRESS-but-BLOCKED, station >40 PENDING.
        CASE
            WHEN c.cohort = 'A' THEN 'COMPLETED'
            WHEN c.cohort = 'D' THEN 'PENDING'
            WHEN c.ro_seq = 10 AND COALESCE(to_.station_id_override, oc.default_station_id) <= 30 THEN 'COMPLETED'
            WHEN c.ro_seq = 10 AND COALESCE(to_.station_id_override, oc.default_station_id)  = 40 THEN 'BLOCKED'
            WHEN c.ro_seq = 10                                                                    THEN 'PENDING'
            WHEN c.in_progress_station = -1 THEN 'PENDING'
            WHEN COALESCE(to_.station_id_override, oc.default_station_id) < c.in_progress_station THEN 'COMPLETED'
            WHEN COALESCE(to_.station_id_override, oc.default_station_id) = c.in_progress_station THEN 'IN_PROGRESS'
            ELSE 'PENDING'
        END AS status,
        -- Variance multiplier (only meaningful for COMPLETED tasks)
        CASE ((c.ro_seq * 13 + to_.sequence * 7) % 5)
            WHEN 0 THEN 1.30
            WHEN 1 THEN 1.15
            WHEN 2 THEN 1.05
            WHEN 3 THEN 0.95
            ELSE 1.00
        END AS mult,
        -- Job code line: e.g. "01DFE-TT67F-CNC"
        lpad(to_.sequence::text, 2, '0') || ro.template_code || '-' || substring(oc.code, 1, 8) AS job_code_line
    FROM cohorts c
    JOIN repair_orders ro ON ro.id = c.ro_id
    JOIN template_operations to_ ON to_.template_version_id = ro.template_version_id
    JOIN operation_catalog oc ON oc.id = to_.operation_id
)
INSERT INTO job_tasks (
    id, ro_id, sequence, job_code_line,
    operation_id, operation_name, station_id,
    assigned_to_user_id, assigned_by_user_id, assigned_at,
    estimated_hours, actual_hours,
    status, started_at, completed_at,
    flow_track, created_at, updated_at
)
SELECT
    -- Task UUID: 9000000R-T000-0000-0000-000000000000 where R = ro_seq, T = sequence
    -- Built from text so the seed remains readable; PG parses it.
    (lpad((90000000 + ro_seq)::text, 8, '0') || '-' || lpad(sequence::text, 4, '0') || '-0000-0000-000000000000')::uuid,
    ro_id,
    sequence::smallint,
    job_code_line,
    operation_id,
    operation_name,
    station_id::smallint,
    -- Assign to the primary tech at this station, or whichever tech is rostered
    (SELECT user_id FROM station_technicians WHERE station_id = src.station_id ORDER BY is_primary DESC NULLS LAST, user_id LIMIT 1),
    '33333333-3333-3333-3333-333333333333'::uuid,    -- supervisor as assigner
    sched_start_ts,
    estimated_hours,
    -- actual_hours: 0 for pending; estimated * 0.55 for in-progress/blocked;
    -- estimated * mult for completed
    CASE status
        WHEN 'COMPLETED'   THEN round((estimated_hours * mult)::numeric, 2)
        WHEN 'IN_PROGRESS' THEN round((estimated_hours * 0.55)::numeric, 2)
        WHEN 'BLOCKED'     THEN round((estimated_hours * 0.40)::numeric, 2)
        ELSE 0
    END,
    status,
    -- started_at: NULL for pending; sched_start + sequence*6h for active/completed
    CASE WHEN status = 'PENDING' THEN NULL
         ELSE sched_start_ts + (sequence::int * interval '6 hours')
    END,
    -- completed_at only for COMPLETED
    CASE WHEN status = 'COMPLETED'
         THEN sched_start_ts + (sequence::int * interval '6 hours') + (round((estimated_hours * mult)::numeric, 2) * interval '1 hour')
         ELSE NULL
    END,
    CASE WHEN operation_id = 41 THEN 'CHASSIS' ELSE 'BODY' END,
    sched_start_ts,
    sched_start_ts
FROM src
ON CONFLICT (ro_id, sequence) DO NOTHING;


-- 5b. Allocate chassis to the 15 ROs that should have them.
-- R900017 keeps its placeholder 'CF-NEW' chassis_number on the RO row but no
-- allocated chassis_inventory row (demo of the chassis gate).
-- R900018 has no chassis allocated AND null chassis_number (also demo).

WITH allocations(ro_id, chassis_number) AS (VALUES
    ('90000001-0000-0000-0000-000000000001'::uuid, 'CF-200'),
    ('90000002-0000-0000-0000-000000000002'::uuid, 'CN-100'),
    ('90000003-0000-0000-0000-000000000003'::uuid, 'CF-201'),
    ('90000004-0000-0000-0000-000000000004'::uuid, 'CN-101'),
    ('90000005-0000-0000-0000-000000000005'::uuid, 'CF-202'),
    ('90000006-0000-0000-0000-000000000006'::uuid, 'CF-203'),
    ('90000007-0000-0000-0000-000000000007'::uuid, 'CN-102'),
    ('90000008-0000-0000-0000-000000000008'::uuid, 'CF-204'),
    ('90000009-0000-0000-0000-000000000009'::uuid, 'CN-103'),
    ('90000010-0000-0000-0000-000000000010'::uuid, 'CF-205'),
    ('90000011-0000-0000-0000-000000000011'::uuid, 'CN-104'),
    ('90000012-0000-0000-0000-000000000012'::uuid, 'CF-206'),
    ('90000013-0000-0000-0000-000000000013'::uuid, 'CN-105'),
    ('90000014-0000-0000-0000-000000000014'::uuid, 'CF-207'),
    ('90000015-0000-0000-0000-000000000015'::uuid, 'CF-208')
)
UPDATE chassis_inventory ci
SET status = 'ALLOCATED',
    allocated_to_ro = a.ro_id,
    allocated_at = (SELECT ro_date::timestamptz FROM repair_orders WHERE id = a.ro_id)
FROM allocations a
WHERE ci.chassis_number = a.chassis_number
  AND ci.status = 'AVAILABLE';


-- ── 6. Time entries ─────────────────────────────────────────────────────────
-- One closed entry per task that has logged hours. A unique partial index
-- (idx_one_open_time_entry_per_user) prevents multiple open clock-ins per user,
-- and the same primary tech covers several tasks at one station — so every
-- seeded entry is closed. The IN_PROGRESS task status is what conveys "still
-- being worked on", not an open clock-in.

INSERT INTO time_entries (id, task_id, user_id, clock_in, clock_out, activity_type, notes)
SELECT
    -- Time-entry UUID = task UUID with the last hex of the 4th group set to '1'.
    -- Task UUIDs all have 4th group = '0000', so overlay produces a distinct,
    -- still-deterministic UUID that won't collide with any task UUID.
    overlay(t.id::text placing '1' from 23 for 1)::uuid,
    t.id,
    COALESCE(t.assigned_to_user_id, '44444444-4444-4444-4444-444444444444'::uuid),
    t.started_at,
    CASE
        WHEN t.status = 'COMPLETED' THEN t.completed_at
        ELSE t.started_at + (t.actual_hours * interval '1 hour')   -- IN_PROGRESS / BLOCKED
    END,
    'WORK',
    CASE t.status
        WHEN 'BLOCKED' THEN 'Sent to hospital zone; awaiting parts'
        ELSE NULL
    END
FROM job_tasks t
WHERE t.ro_id IN (SELECT id FROM repair_orders WHERE ro_number LIKE 'R900%')
  AND t.status IN ('COMPLETED', 'IN_PROGRESS', 'BLOCKED')
  AND t.actual_hours > 0
  AND NOT EXISTS (SELECT 1 FROM time_entries te WHERE te.task_id = t.id);


-- ── 7. Variance records ────────────────────────────────────────────────────
-- One per COMPLETED task. Reason weighted toward MISSING_PARTS (id=1) +
-- REWORK (id=2) for a clean Pareto on the variance-root-cause chart.
--   delta% >= +20%  → MISSING_PARTS (50%) | REWORK (30%) | DRAWING_ISSUE (20%)
--   delta% +5..+20% → MISSING_PARTS (40%) | REWORK (30%) | SCOPE_CHANGE (15%) | TRAINING (15%)
--   delta% <  -3%   → AHEAD_OF_ESTIMATE (id=12)
--   else            → AS_ESTIMATED      (id=11)

INSERT INTO variance_records (id, task_id, estimated_hours, actual_hours, reason_id, notes, recorded_by, recorded_at)
SELECT
    -- Variance UUID = task UUID with the 4th group's last hex set to '2'.
    overlay(t.id::text placing '2' from 23 for 1)::uuid,
    t.id,
    t.estimated_hours,
    t.actual_hours,
    CASE
        WHEN t.actual_hours / NULLIF(t.estimated_hours, 0) >= 1.20 THEN
            CASE ((extract(epoch from t.created_at)::bigint + t.sequence) % 10)
                WHEN 0 THEN 1 WHEN 1 THEN 1 WHEN 2 THEN 1 WHEN 3 THEN 1 WHEN 4 THEN 1
                WHEN 5 THEN 2 WHEN 6 THEN 2 WHEN 7 THEN 2
                ELSE 4
            END
        WHEN t.actual_hours / NULLIF(t.estimated_hours, 0) >= 1.05 THEN
            CASE ((extract(epoch from t.created_at)::bigint + t.sequence) % 10)
                WHEN 0 THEN 1 WHEN 1 THEN 1 WHEN 2 THEN 1 WHEN 3 THEN 1
                WHEN 4 THEN 2 WHEN 5 THEN 2 WHEN 6 THEN 2
                WHEN 7 THEN 3 WHEN 8 THEN 3
                ELSE 6
            END
        WHEN t.actual_hours / NULLIF(t.estimated_hours, 0) <= 0.97 THEN 12   -- AHEAD_OF_ESTIMATE
        ELSE 11                                                              -- AS_ESTIMATED
    END,
    NULL,
    '33333333-3333-3333-3333-333333333333'::uuid,
    t.completed_at
FROM job_tasks t
WHERE t.ro_id IN (SELECT id FROM repair_orders WHERE ro_number LIKE 'R900%')
  AND t.status = 'COMPLETED'
  AND NOT EXISTS (SELECT 1 FROM variance_records vr WHERE vr.task_id = t.id);


-- ============================================================================
-- Verification queries (run after make reset && make hash-pw):
-- ----------------------------------------------------------------------------
-- -- ROs by cohort/status:
-- SELECT substring(ro_number,1,4) AS prefix, status, count(*)
-- FROM repair_orders WHERE ro_number LIKE 'R900%' GROUP BY 1,2 ORDER BY 1,2;
--
-- -- Kanban stage distribution (live board):
-- SELECT ks.code, count(*) FROM ro_kanban_state s
-- JOIN kanban_stages ks ON ks.id = s.current_stage_id
-- JOIN repair_orders r ON r.id = s.ro_id WHERE r.ro_number LIKE 'R900%'
-- GROUP BY ks.code ORDER BY ks.code;
--
-- -- Variance reason Pareto:
-- SELECT vr_r.code, count(*) FROM variance_records v
-- JOIN job_tasks t ON t.id = v.task_id
-- JOIN repair_orders r ON r.id = t.ro_id
-- JOIN variance_reasons vr_r ON vr_r.id = v.reason_id
-- WHERE r.ro_number LIKE 'R900%' GROUP BY vr_r.code ORDER BY 2 DESC;
--
-- -- Scheduling backlog (matches the supervisor screen):
-- SELECT ro_number, status, scheduled_start_week FROM repair_orders
-- WHERE status NOT IN ('COMPLETED','CANCELLED') AND ro_number LIKE 'R900%'
-- ORDER BY ro_number;
-- ============================================================================
