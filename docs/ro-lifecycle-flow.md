# Repair Order Lifecycle — End-to-End Flow

This document walks through the complete journey of a Repair Order (RO) from initial creation by the Sales team, through scheduling by the Supervisor, production floor execution by technicians, QC, job completion, and how all of that data surfaces in the reporting dashboards.

---

## Overview

```
Sales creates RO
    ↓
Drafter finalises drawings  (sets drafting_status = COMPLETED)
    ↓
Supervisor: approve customer drawing + allocate chassis
    ↓
Supervisor: schedule start week
    ↓
Station owners assign tasks to technicians
    ↓
Technicians clock in → work → clock out → mark complete
    ↓
Kanban advances through stations → FINAL_QC → COMPLETE
    ↓
Variance data flows into Reports
```

---

## Part 1 — RO Creation (Sales)

**Who:** Sales role  
**Screen:** `/sales/new-ro`

The sales representative selects a customer, job type, and one of the available job templates (e.g. `TP42N — Tautliner`). They enter vehicle details (rego, make, model, VIN), set a required delivery date, and assign a priority (1 = urgent, 5 = low).

Optionally, a source PDF (customer's own repair order) can be uploaded on the preceding screen (`/sales/pdf-review`). The system parses the PDF and pre-fills fields like customer, rego, and source RO number. The sales rep reviews and corrects the extracted values before proceeding.

**What happens on submit — `POST /api/repair-orders`:**

1. The API looks up the active template version for the selected template code.
2. A new RO number is drawn from the Postgres sequence (`ro_number_seq`) — e.g. `RO00058`.
3. A `repair_orders` row is created with:
   - `status = 'DRAFT'`
   - `drafting_status = 'NOT_STARTED'`
   - `scheduled_start_week = NULL`
   - All vehicle, customer, and date fields from the form
4. One `job_tasks` row is inserted per operation in the template, each with:
   - `status = 'PENDING'`
   - `assigned_to_user_id = NULL`
   - `estimated_hours` from the template
   - `station_id` from the operation's default station (or any station override set in the template)
5. A `RoCreated` domain event is recorded.
6. The RO is placed at kanban stage `10 — JOB_RECEIVED`.

**Response:** `{ roId, roNumber, tasksCreated }` — the UI shows a green toast and redirects to `/sales/ro/{roId}`.

**RO Detail page (`/sales/ro/{id}`):**  
Shows the three-column layout: customer and source RO info, vehicle details, and the full task list with sequence numbers, station names, estimated hours, and status (`PENDING` for all new tasks).

---

## Part 2 — Drafting Gate

**Who:** Drafter role  
**Purpose:** Confirm that drawings, BOMs, and layouts are finalised before production begins.

The drafter completes the drawings and marks the RO as drafted. This flips `repair_orders.drafting_status` from `NOT_STARTED` → `IN_PROGRESS` → `COMPLETED`. (In the current release there is no dedicated drafter UI — this is set directly via a DB update or a future drafter module.)

Until `drafting_status = 'COMPLETED'`, the **Draft gate** in the scheduling backlog shows grey (✗). Once complete it turns green (✓).

---

## Part 3 — Scheduling (Supervisor)

**Who:** Supervisor or Station Owner role  
**Screen:** `/dashboard` → **Scheduling** tab

### 3.1 — Scheduling Backlog (`GET /api/scheduling/backlog`)

The backlog table lists every active (non-completed, non-cancelled) RO with three readiness gates:

| Gate | Condition |
|---|---|
| Draft | `repair_orders.drafting_status = 'COMPLETED'` |
| Approval | At least one row in `customer_approvals` for this RO |
| Chassis | At least one row in `chassis_inventory` with `allocated_to_ro = roId` and `status = 'ALLOCATED'` |

Rows where all three gates are green sort to the top. Within that group, rows are sorted by priority (ascending) then required date (ascending).

### 3.2 — Customer Drawing Approval (`POST /api/scheduling/ros/{roId}/approve`)

The supervisor clicks the grey **✗ Approval** pill on a backlog row. A popover opens asking for a signer name and optional notes. On submit, a `customer_approvals` row is inserted with `signed_at = NOW()`. The pill turns green.

### 3.3 — Chassis Allocation (`POST /api/scheduling/chassis/{chassisId}/allocate`)

The supervisor clicks the grey **✗ Chassis** pill. A popover lists all chassis with `status = 'AVAILABLE'` (e.g. `CF-002 — Isuzu FRR 90-210`). Clicking one sets `chassis_inventory.status = 'ALLOCATED'` and `allocated_to_ro = roId`. The pill turns green. If a chassis is already allocated to another RO, a `409 Conflict` is returned.

### 3.4 — Schedule the Start Week (`PUT /api/scheduling/ros/{roId}/schedule`)

Once all three gates are green the **Schedule** button activates. Clicking it shows a week picker with the next 6 Mondays. The supervisor selects a week.

**Validation:**
- The date must be a Monday.
- The date cannot be in the past.
- The RO must not be COMPLETED or CANCELLED.

**On success:**
- `repair_orders.scheduled_start_week` is set to the chosen Monday.
- A `RoScheduled` domain event is recorded with `{ roId, roNumber, startWeek }`.
- The table row now shows the scheduled week. The button label changes to **Reschedule**.

Re-scheduling (clicking **Reschedule** and picking a new week) simply overwrites `scheduled_start_week` with the new date.

### 3.5 — Capacity Heatmap (`GET /api/scheduling/capacity?weeks=4`)

Below the backlog table, the **4-Week Station Capacity** heatmap shows total estimated hours per station per week for all scheduled (non-completed, non-cancelled) ROs. Capacity baseline is 40 h/week per station. Colour bands:

- **Green** (≤ 28 h, ≤ 70%): normal load
- **Amber** (28–38 h, 70–95%): nearing capacity
- **Red** (> 38 h, > 95%): over-committed

When an RO is scheduled into a week, the hours from all its tasks appear immediately in the relevant station cells. Re-scheduling moves the hours to the new week.

---

## Part 4 — Station Owner: Assigning Tasks to Technicians

**Who:** Station Owner or Supervisor  
**Screen:** `/kanban`

The kanban board shows all active ROs as cards organised into columns by kanban stage. Each station owner sees the tasks for their station.

**Kanban stages** (in order):

| Stage ID | Code | Meaning |
|---|---|---|
| 10 | JOB_RECEIVED | RO just created |
| 20 | IN_DRAFTING | Drafter working on layouts |
| 30 | MAT_PROCESSING | Material / CNC tasks |
| 40 | FABRICATION | Fabrication tasks |
| 50 | PAINTING | Paint station tasks |
| 60 | AFTER_PAINT_HY | Hydraulics / electrics after paint |
| 70 | FITOUT | Interior fitout tasks |
| 80 | BODY_MOUNTING | Body-to-chassis mounting |
| 85 | ACCESSORIES | Accessories and ancillaries |
| 90 | FINAL_QC | Final quality check |
| 99 | COMPLETE | All tasks done |
| 95 | HOSPITAL | Blocked / on-hold |

**Assigning a technician:**  
The station owner clicks a task card to open the task drawer. The drawer shows the operation name, RO details, estimated hours, and a list of available technicians rostered to that station. Clicking a technician name sets:
- `job_tasks.assigned_to_user_id = technicianId`
- `job_tasks.status = 'ASSIGNED'`
- `job_tasks.assigned_at = NOW()`

The technician now sees the task in their mobile task list.

---

## Part 5 — Technician: Executing Work

**Who:** Technician role  
**Screen:** `/tech`

### 5.1 — Task List (`GET /api/tech/tasks`)

The technician's mobile view shows all tasks assigned to them with statuses `ASSIGNED`, `IN_PROGRESS`, or `PAUSED`. Tasks sort by active first (IN_PROGRESS, then PAUSED, then ASSIGNED), then by priority, then by required date.

### 5.2 — Clock In (`POST /api/tech/tasks/{id}/clock-in`)

The technician taps **Clock In** on a task. This:
- Creates an open `time_entries` row (`clock_out = NULL`).
- Sets `job_tasks.status = 'IN_PROGRESS'`.
- Sets `job_tasks.started_at = NOW()` (only on first clock-in; not overwritten on resume).

A running timer is shown on screen. A technician can only have one open time entry at a time.

### 5.3 — Clock Out (`POST /api/tech/tasks/{id}/clock-out`)

Tapping **Clock Out**:
- Closes the `time_entries` row: `clock_out = NOW()`, `duration_minutes` calculated.
- Recalculates `job_tasks.actual_hours` as the sum of all closed time entries for this task (÷ 60).
- Sets `job_tasks.status = 'PAUSED'`.

The technician can resume (clock in again) or move on to mark the task complete.

### 5.4 — Upload Photos (`POST /api/tech/tasks/{id}/photos`)

At any point during work, the technician can upload progress photos (images up to 10 MB). Photos are stored on disk under the task ID and recorded in the `attachments` table (`category = 'PHOTO'`). Photos are viewable by supervisors on the kanban task detail.

### 5.5 — Report a Blocker (`POST /api/tech/tasks/{id}/block`)

If work cannot continue (e.g. parts not delivered), the technician taps **Report Blocker** and enters a reason (minimum 10 characters). This:
- Closes any open time entry.
- Sets `job_tasks.status = 'BLOCKED'`.
- Sets `repair_orders.status = 'ON_HOLD'`.
- Moves the RO to kanban stage `95 — HOSPITAL`.
- Records a `TaskBlocked` domain event.
- Sends a notification to the supervisor.

**Unblocking** (`POST /api/tech/tasks/{id}/unblock`) is done by a supervisor or station owner. It restores the task to `PAUSED` and the RO to its previous kanban stage.

### 5.6 — Mark Task Complete (`POST /api/tech/tasks/{id}/complete`)

Once work is done, the technician taps **Mark Complete**. If actual hours exceed estimated × 1.25, a **variance reason picker** is shown (mandatory). Otherwise the task completes with reason code `AS_ESTIMATED` or `AHEAD_OF_ESTIMATE`.

**On completion:**
1. Any open time entry is closed.
2. `actual_hours` is recalculated from all time entries.
3. A `variance_records` row is inserted:
   - `estimated_hours` / `actual_hours` / `delta_hours` / `delta_percent` / `reason_id` / `notes`
4. `job_tasks.status = 'COMPLETED'`, `completed_at = NOW()`.
5. A `TaskCompleted` domain event is recorded.
6. **Kanban auto-advance:** If all tasks at the current station for this RO are now `COMPLETED` or `CANCELLED`, the system finds the next station with pending tasks and advances `ro_kanban_state` to the corresponding stage.

**Variance reason codes:**

| Code | Type |
|---|---|
| MISSING_PARTS, REWORK, SCOPE_CHANGE, DRAWING_ISSUE, MACHINE_DOWN | Overrun |
| TRAINING, HOSPITAL_ZONE, SUPPLIER_NCR, CUSTOMER_REVISION, WEATHER, OTHER | Overrun |
| AS_ESTIMATED | No variance |
| AHEAD_OF_ESTIMATE | Underrun |

---

## Part 6 — QC and Job Completion

**Who:** Technician (QC station), then Supervisor  
**Kanban stage:** `90 — FINAL_QC`

When all production tasks are complete, the RO automatically advances to `FINAL_QC`. A QC technician is assigned the final QC task(s) via the kanban board. They clock in, perform the inspection, take sign-off photos, and mark the QC task(s) complete.

Once **all tasks** on the RO across all stations are `COMPLETED` or `CANCELLED`:
- The kanban stage advances to `99 — COMPLETE`.
- `repair_orders.status` is set to `'COMPLETED'`.

The RO is now removed from the active backlog and scheduling views but remains queryable in the reports.

---

## Part 7 — Reports

**Who:** Supervisor role  
**Screen:** `/dashboard` → **Reports** tab

### 7.1 — Throughput Report (`GET /api/dashboard/reports/throughput`)

Shows week-by-week counts for the past 12 weeks (84 days):
- **Completed** — ROs moved to COMPLETE that week
- **In Progress** — ROs active (status = IN_PROGRESS) at week end
- **Blocked** — ROs that were in HOSPITAL at any point that week

Displayed as a bar/line chart. Allows the supervisor to spot trends: improving throughput, recurring blockages, or seasonal slowdowns.

**CSV export:** `GET /api/dashboard/reports/throughput/csv`

### 7.2 — Calibration Report (`GET /api/dashboard/reports/calibration`)

Answers: *"Are our time estimates accurate?"*

For every completed task across all ROs (optionally filtered by template code), the report shows:
- **Template estimate** — the hours in the template at time of RO creation
- **Average actual** — mean actual hours across all completions of that operation
- **Average delta** — mean (actual − estimated), positive = overrun
- **Std deviation** — spread of actual hours (high stddev = inconsistent execution)
- **Sample size** — number of completions

The supervisor uses this to identify operations that are consistently under- or over-estimated and update the template versions accordingly.

**CSV export:** `GET /api/dashboard/reports/calibration/csv`

### 7.3 — Overview Dashboard KPIs (`GET /api/dashboard/overview`)

The **Overview** tab (default landing for supervisors) shows:
- **Active ROs** — count of ROs with status not COMPLETED/CANCELLED
- **Utilisation %** — total actual hours worked ÷ total scheduled capacity (stations × 40h/week)
- **In Hospital** — count of ROs currently in the HOSPITAL kanban stage
- **On Time %** — completed ROs where `completed_at ≤ required_date`
- **Overdue count** — ROs where `required_date < today` and status ≠ COMPLETED

### 7.4 — Station Load Panel

Shows for each station:
- **Open tasks** — tasks not yet started
- **Active tasks** — tasks currently IN_PROGRESS
- **Hours remaining** — sum of `estimated_hours` on non-completed tasks at this station
- **Hours done** — sum of `actual_hours` on completed tasks at this station

Colour-coded horizontal bars: green < 20 h remaining, amber 20–40 h, red > 40 h.

### 7.5 — Top Variance Panel

Lists the highest-delta tasks (actual far exceeds estimated) across all recent completions. Shows: RO number, operation, technician, delta hours, and the variance reason. Allows the supervisor to intervene quickly when a task is blowing out.

---

## Appendix A — RO Status Transitions

```
DRAFT
  └─→ APPROVED     (drafting complete + all scheduling gates green)
        └─→ IN_PROGRESS   (first task clocked in)
              ├─→ ON_HOLD       (task blocked)
              │     └─→ IN_PROGRESS  (task unblocked)
              └─→ COMPLETED    (all tasks done)

CANCELLED  (at any status, by admin)
```

## Appendix B — Task Status Transitions

```
PENDING → ASSIGNED → IN_PROGRESS ↔ PAUSED → COMPLETED
                  └─→ BLOCKED ─→ PAUSED (on unblock)
```

## Appendix C — Roles & Access Summary

| Role | Create RO | Schedule | Assign Tasks | Clock In/Out | Reports |
|---|---|---|---|---|---|
| SALES | ✓ | — | — | — | — |
| DRAFTER | — | — | — | — | — |
| SUPERVISOR | — | ✓ | ✓ | — | ✓ |
| STATION_OWNER | — | — | ✓ | — | — |
| TECHNICIAN | — | — | — | ✓ | — |
| QC | — | — | — | ✓ | — |
| ADMIN | ✓ | ✓ | ✓ | ✓ | ✓ |

## Appendix D — Key Domain Events

| Event | Trigger | Notifies |
|---|---|---|
| `RoCreated` | POST /api/repair-orders | Supervisor |
| `RoScheduled` | PUT /api/scheduling/ros/{id}/schedule | — |
| `TaskCompleted` | POST /api/tech/tasks/{id}/complete | Supervisor |
| `TaskBlocked` | POST /api/tech/tasks/{id}/block | Supervisor |

All events are persisted in the `domain_events` table with a JSONB payload for auditability.
