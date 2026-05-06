# Epic E10 — Supervisor Scheduling (P1 Stretch)

> **Priority:** P1 stretch · **Owner:** Dev A · **Days:** 8–10 only if E3–E4 done by day 7 · **Depends on:** E3 (dashboard shell), E4 (kanban, station model exists) · **Total estimate:** 14 hours

Before a job hits the floor it needs three things to be ready: the drawing package signed off by the customer, a chassis allocated from inventory, and the drafting complete. Today a supervisor tracks these on a whiteboard. This epic replaces that whiteboard with a "Scheduling" tab showing the backlog queue with three traffic-light gates per RO, plus a 4-week capacity heatmap that shows which stations are over-committed. When all three gates are green, the "Schedule" button unlocks and the supervisor picks the start week. The model design is the primary risk (see E10-S1) — cut this epic without remorse if it takes more than the allotted time.

---

## Story E10-S1 — Schema migration: chassis inventory + customer approvals (S, 2h)

**As the system**
**I want** tables for chassis inventory and customer drawing approvals
**So that** the readiness gate logic has data to read from

### Acceptance criteria
- New migration `007_scheduling.sql` creating:
  ```sql
  CREATE TABLE chassis_inventory (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chassis_number   TEXT NOT NULL UNIQUE,       -- VIN or serial
    description      TEXT NOT NULL,              -- e.g. "Isuzu NPR 75-190 FRR"
    chassis_class    TEXT NOT NULL,              -- N, F, etc.
    status           TEXT NOT NULL DEFAULT 'AVAILABLE',  -- AVAILABLE, ALLOCATED, DELIVERED
    allocated_to_ro  UUID REFERENCES repair_orders(id),
    received_at      TIMESTAMPTZ,
    allocated_at     TIMESTAMPTZ,
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE TABLE customer_approvals (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    ro_id            UUID NOT NULL REFERENCES repair_orders(id),
    document_type    TEXT NOT NULL,              -- LAYOUT, SPEC, COMPLIANCE
    signed_at        TIMESTAMPTZ,
    signed_by_name   TEXT,                       -- customer contact name (free text for v1)
    notes            TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  ```
- Seed 3 chassis records in the migration for demo use:
  - `CN-001 · Isuzu NPR 75-190 · class N · AVAILABLE`
  - `CF-002 · Isuzu FRR 90-210 · class F · AVAILABLE`
  - `CF-003 · Isuzu FRR 90-210 · class F · AVAILABLE`
- `repair_orders` extended: add column `scheduled_start_week DATE` (nullable, Monday of the planned week) and `drafting_status` is already present from E1 schema — verify it's there, do not re-add
- Add `ChassisInventory` and `CustomerApproval` entity classes to `Domain/Production.cs`
- Add `DbSet<ChassisInventory>` and `DbSet<CustomerApproval>` to `NeeDbContext`

### Technical context
- `status` constraint: `CHECK (status IN ('AVAILABLE','ALLOCATED','DELIVERED'))`
- `document_type` constraint: `CHECK (document_type IN ('LAYOUT','SPEC','COMPLIANCE'))`
- `allocated_to_ro`: when set, `status` should be `ALLOCATED` — enforced at the application layer, not DB constraint
- `scheduled_start_week`: always store as the Monday of the week (use `date_trunc('week', ...)` when computing)

### Done definition
- `make reset && make seed` completes without error after adding the migration
- `SELECT * FROM chassis_inventory;` shows 3 seed rows
- `SELECT * FROM customer_approvals;` returns empty (no seed data needed)
- Application builds without errors with the new entity classes

### Claude Code prompt
```
Add scheduling schema tables:

1. db/migrations/007_scheduling.sql:
   - CREATE TABLE chassis_inventory (as specified above)
   - CREATE TABLE customer_approvals (as specified above)
   - Add CHECK constraints for status and document_type
   - ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS scheduled_start_week DATE
   - INSERT 3 chassis seed rows (see acceptance criteria)

2. Domain/Production.cs: add entity classes:
   public class ChassisInventory {
     public Guid Id { get; set; }
     public string ChassisNumber { get; set; } = string.Empty;
     public string Description { get; set; } = string.Empty;
     public string ChassisClass { get; set; } = string.Empty;
     public string Status { get; set; } = "AVAILABLE";
     public Guid? AllocatedToRo { get; set; }
     public DateTimeOffset? ReceivedAt { get; set; }
     public DateTimeOffset? AllocatedAt { get; set; }
     public string? Notes { get; set; }
     public DateTimeOffset CreatedAt { get; set; }
     public DateTimeOffset UpdatedAt { get; set; }
   }

   public class CustomerApproval {
     public Guid Id { get; set; }
     public Guid RoId { get; set; }
     public string DocumentType { get; set; } = string.Empty;
     public DateTimeOffset? SignedAt { get; set; }
     public string? SignedByName { get; set; }
     public string? Notes { get; set; }
     public DateTimeOffset CreatedAt { get; set; }
   }

3. NeeDbContext.cs: add DbSet<ChassisInventory> ChassisInventory and DbSet<CustomerApproval> CustomerApprovals.
   Configure table names using snake_case conventions (UseSnakeCaseNamingConvention already active).

4. Verify repair_orders entity has ScheduledStartWeek (DateOnly?) property — add if missing.

Schema: chassis_inventory, customer_approvals, repair_orders.
```

---

## Story E10-S2 — Readiness gate computed view + API (M, 3h)

**As a supervisor**
**I want** to see whether each pending RO has its drawing approved, chassis allocated, and drafting complete
**So that** I know which jobs are actually ready to schedule

### Acceptance criteria
- `GET /api/scheduling/backlog` returns all active ROs (status NOT IN `COMPLETED`, `CANCELLED`) with their gate status:
  ```json
  [
    {
      "roId": "...",
      "roNumber": "RO00001",
      "customerName": "Direct Freight Express",
      "templateCode": "TP42N",
      "priority": 2,
      "requiredDate": "2026-08-01",
      "scheduledStartWeek": null,
      "totalEstimatedHours": 53.5,
      "gates": {
        "draftingComplete": true,
        "customerApproved": false,
        "chassisAllocated": false,
        "allGreen": false
      }
    }
  ]
  ```
- Gate logic:
  - `draftingComplete`: `repair_orders.drafting_status = 'COMPLETED'`
  - `customerApproved`: at least one `customer_approvals` row for this RO where `signed_at IS NOT NULL`
  - `chassisAllocated`: `chassis_inventory` has a row with `allocated_to_ro = ro.id` AND `status = 'ALLOCATED'`
  - `allGreen`: all three are true
- Ordered by: `allGreen DESC, priority ASC, required_date ASC NULLS LAST`
- Requires `[Authorize]` with SUPERVISOR or STATION_OWNER role

### Technical context
- This is a read-only query endpoint — no mutation
- Use a single EF Core query with `GroupJoin` / `Any` for each gate; avoid N+1
- The response DTO does not need the full RO detail — just the fields shown above

### Done definition
- With a seeded RO that has drafting_status='COMPLETED' and a chassis allocated: `draftingComplete: true`, `chassisAllocated: true`, `customerApproved: false`, `allGreen: false`
- With all three gates true: `allGreen: true` and the row sorts to the top
- Integration test: create RO, set gates individually, assert each gate flips

### Claude Code prompt
```
Add the scheduling backlog endpoint:

1. api/Endpoints/SchedulingEndpoints.cs (new file):
   var sched = app.MapGroup("/api/scheduling").RequireAuthorization().WithTags("Scheduling");
   Register via app.MapSchedulingEndpoints() in Program.cs.

   GET /backlog
   - Query repair_orders WHERE status NOT IN ('COMPLETED','CANCELLED')
   - Left-join chassis_inventory ON allocated_to_ro = ro.id AND status = 'ALLOCATED'
   - Left-join customer_approvals ON ro_id = ro.id AND signed_at IS NOT NULL
   - Select gate booleans:
     DraftingComplete = ro.DraftingStatus == "COMPLETED"
     CustomerApproved = customerApprovals.Any() (from the left join)
     ChassisAllocated = chassis != null
     AllGreen = all three true
   - Order by AllGreen DESC, Priority ASC, RequiredDate ASC NULLS LAST
   - Return SchedulingBacklogItem[]
   .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "STATION_OWNER"))

2. Integration test (SchedulingEndpointTests.cs):
   - Create RO → all gates false
   - Set drafting_status='COMPLETED' directly in DB → draftingComplete=true
   - INSERT customer_approvals with signed_at=now() → customerApproved=true
   - UPDATE chassis_inventory to allocated_to_ro=roId, status='ALLOCATED' → chassisAllocated=true
   - GET backlog → allGreen=true, row sorts first

Schema: repair_orders, chassis_inventory, customer_approvals.
```

---

## Story E10-S3 — Backlog table component + gate management UI (M, 4h)

**As a supervisor**
**I want** to see the scheduling backlog table and manage the three readiness gates directly from the UI
**So that** I can mark a drawing as approved or allocate a chassis without leaving the scheduling screen

### Acceptance criteria
- Route `/dashboard/scheduling`, added to the dashboard tabs alongside "Overview", "Reports"
- Table columns: RO number, Customer, Template, Priority pill, Required date, Est. hours, three gate pills (✓/✗), Scheduled week, Actions
- Gate pills: green ✓ (gate met) or grey ✗ (gate not met), clicking opens a small inline action:
  - **Drafting** (read-only in this view — drafting is managed elsewhere): clicking shows a tooltip "Update drafting status via the RO detail page"
  - **Customer Approved**: clicking opens a small popover with "Mark as approved" button, a "Signed by" text input, and optional notes → calls `POST /api/scheduling/ros/{roId}/approve`
  - **Chassis**: clicking opens a small popover listing available chassis (from `GET /api/scheduling/chassis?available=true`) → clicking a chassis allocates it → calls `POST /api/scheduling/chassis/{chassisId}/allocate` with `{ roId }`
- Rows where `allGreen: true` are highlighted with a subtle green left-border
- Rows with `allGreen: false` show the "Schedule" button as disabled; rows with `allGreen: true` show it as active (E10-S5)

### Technical context
- `POST /api/scheduling/ros/{roId}/approve` body: `{ signedByName: string, notes?: string }` — inserts a `customer_approvals` row
- `GET /api/scheduling/chassis?available=true` returns chassis where `status = 'AVAILABLE'`
- `POST /api/scheduling/chassis/{chassisId}/allocate` body: `{ roId }` — sets `chassis_inventory.allocated_to_ro = roId`, `status = 'ALLOCATED'`, `allocated_at = now()`
- Popover: a simple `position: absolute` div toggled on gate pill click, closed on outside click (same pattern as the notification bell from E7)

### Done definition
- Scheduling tab shows the backlog table with all gate columns
- Click the customer-approved gate for an RO → popover opens, enter a name and click "Mark approved" → gate turns green
- Click the chassis gate → popover shows available chassis → click CF-002 → gate turns green
- When all three gates green: row gets green border, Schedule button enables

### Claude Code prompt
```
Build the scheduling backlog UI and gate management endpoints:

1. New API endpoints in SchedulingEndpoints.cs:

   GET /chassis?available=true
   - Query chassis_inventory WHERE status='AVAILABLE' (if available=true param)
   - Return ChassisDto[] { Id, ChassisNumber, Description, ChassisClass }

   POST /ros/{roId}/approve
   Body: ApproveRoRequest { SignedByName: string, Notes: string? }
   - INSERT customer_approvals (ro_id, document_type='LAYOUT', signed_at=now(), signed_by_name, notes)
   - Return 201
   [Authorize with SUPERVISOR, STATION_OWNER]

   POST /chassis/{chassisId}/allocate
   Body: AllocateChassisRequest { RoId: Guid }
   - Validate chassis status='AVAILABLE', else 409 "Chassis already allocated"
   - UPDATE chassis_inventory: status='ALLOCATED', allocated_to_ro=RoId, allocated_at=now()
   - Return 200
   [Authorize with SUPERVISOR, STATION_OWNER]

2. Angular: SchedulingComponent (web/src/app/dashboard/scheduling.component.ts)
   - On init: call GET /api/scheduling/backlog
   - backlog = signal<SchedulingRow[]>([])
   - activePopover = signal<{ roId: string; type: 'approve'|'chassis' } | null>(null)
   - availableChassis = signal<ChassisDto[]>([])

3. Template — table with columns:
   <table class="sched-table">
     <thead>...</thead>
     <tbody>
       @for (row of backlog(); track row.roId) {
         <tr [class.all-green]="row.gates.allGreen">
           <td class="mono">{{ row.roNumber }}</td>
           <td>{{ row.customerName }}</td>
           <td class="mono">{{ row.templateCode }}</td>
           <td><span class="pill" [class]="priorityClass(row.priority)">{{ priorityLabel(row.priority) }}</span></td>
           <td>{{ row.requiredDate | date:'dd MMM' }}</td>
           <td class="mono">{{ row.totalEstimatedHours }}h</td>
           <td class="gate-cell">
             <button class="gate-pill" [class.gate-met]="row.gates.draftingComplete"
               title="Drafting complete">
               {{ row.gates.draftingComplete ? '✓' : '✗' }} Draft
             </button>
           </td>
           <td class="gate-cell" style="position:relative">
             <button class="gate-pill" [class.gate-met]="row.gates.customerApproved"
               (click)="togglePopover(row.roId, 'approve')">
               {{ row.gates.customerApproved ? '✓' : '✗' }} Approval
             </button>
             @if (activePopover()?.roId === row.roId && activePopover()?.type === 'approve') {
               <div class="gate-popover">
                 <input [(ngModel)]="approveSignedBy" placeholder="Signed by" />
                 <button (click)="approveRo(row.roId)">Mark approved</button>
               </div>
             }
           </td>
           <td class="gate-cell" style="position:relative">
             <button class="gate-pill" [class.gate-met]="row.gates.chassisAllocated"
               (click)="togglePopover(row.roId, 'chassis')">
               {{ row.gates.chassisAllocated ? '✓' : '✗' }} Chassis
             </button>
             @if (activePopover()?.roId === row.roId && activePopover()?.type === 'chassis') {
               <div class="gate-popover">
                 @for (ch of availableChassis(); track ch.id) {
                   <div class="chassis-option" (click)="allocateChassis(ch.id, row.roId)">
                     {{ ch.chassisNumber }} — {{ ch.description }}
                   </div>
                 }
               </div>
             }
           </td>
         </tr>
       }
     </tbody>
   </table>

4. Styles:
   .sched-table (width 100%, border-collapse collapse, font-size 13px)
   .sched-table th (font-family var(--mono), font-size 10px, text-transform uppercase, letter-spacing 0.08em,
     color var(--ink-3), border-bottom 0.5px solid var(--rule), padding 8px 12px, text-align left)
   .sched-table td (padding 10px 12px, border-bottom 0.5px solid var(--rule), color var(--ink))
   .all-green td:first-child (border-left 3px solid var(--good))
   .gate-pill (background none, border 0.5px solid var(--rule-strong), border-radius 4px,
     padding 3px 8px, font-size 11px, cursor pointer, color var(--ink-3))
   .gate-pill.gate-met (border-color var(--good), color var(--good), background #dcfce7)
   .gate-popover (position absolute, top 100%, left 0, z-index 100, background white,
     border 0.5px solid var(--rule-strong), border-radius 8px, padding 12px, min-width 220px,
     box-shadow 0 4px 16px rgba(10,14,15,0.12))
   .chassis-option (padding 8px; cursor pointer; border-bottom 0.5px solid var(--rule); font-size 12px)
   .chassis-option:hover (background var(--paper))
```

---

## Story E10-S4 — Capacity heatmap query + visualization (M, 3h)

**As a supervisor**
**I want** to see how many hours are planned per station per week for the next 4 weeks
**So that** I can spot over-committed stations before scheduling new jobs

### Acceptance criteria
- `GET /api/scheduling/capacity?weeks=4` returns:
  ```json
  {
    "weeks": ["2026-05-05", "2026-05-12", "2026-05-19", "2026-05-26"],
    "stations": [
      {
        "stationId": 20,
        "stationName": "Fabrication Line",
        "weeklyHours": [24.0, 32.0, 16.0, 0.0],
        "weeklyCapacityPct": [60.0, 80.0, 40.0, 0.0]
      }
    ]
  }
  ```
- `weeklyHours`: sum of `estimated_hours` for tasks at that station where the RO's `scheduled_start_week` falls within the given week (approximation: all tasks for an RO are assumed to spread across the start week for v1)
- `weeklyCapacityPct`: `weeklyHours / stationCapacityHours * 100` where `stationCapacityHours = 40` (hard-coded for v1 — 5 techs × 8h/day × 1 day; configurable in Phase 2)
- Colour bands: green ≤ 70%, amber 70–95%, red > 95%
- Angular heatmap: a grid table where rows = stations, columns = weeks. Each cell is coloured by capacity percentage and shows the hour count.
- Clicking a cell drills into the list of ROs contributing hours to that station/week

### Technical context
- `scheduled_start_week` is set by E10-S5 (the schedule action) — for the demo, manually set a few ROs to a scheduled week to make the heatmap non-empty
- The weekly hours calculation: `job_tasks.estimated_hours` summed for tasks belonging to ROs where `repair_orders.scheduled_start_week = weekStart AND job_tasks.station_id = stationId`
- Station capacity of 40h/week is a constant for v1; a `station_capacity_hours` column on the `stations` table is a Phase 2 addition

### Done definition
- Manually set `scheduled_start_week` on 2 seeded ROs, then call `GET /api/scheduling/capacity`
- Cells for stations with planned hours show non-zero values and correct colours
- Heatmap renders in the UI with readable values
- Empty weeks (no scheduled ROs) show 0h in grey

### Claude Code prompt
```
Add the capacity heatmap endpoint and visualization:

1. API: GET /api/scheduling/capacity?weeks=4
   Add to SchedulingEndpoints.cs:
   - Generate week-start dates: next 4 Mondays from today
   - For each station × week combination: SUM job_tasks.estimated_hours
     WHERE job_tasks.station_id = station.id
     AND repair_orders.scheduled_start_week = weekStart
     AND repair_orders.status NOT IN ('COMPLETED','CANCELLED')
   - Hard-coded capacity: 40h per station per week
   - Return CapacityResponse { Weeks: DateOnly[], Stations: StationCapacityDto[] }
   - StationCapacityDto { StationId, StationName, WeeklyHours: decimal[], WeeklyCapacityPct: decimal[] }

2. Angular: add a heatmap section below the backlog table in SchedulingComponent
   - heatmap = signal<CapacityResponse | null>(null)
   - Load on init alongside backlog

   Template:
   <section class="heatmap-section">
     <h3 class="section-title">4-Week Station Capacity</h3>
     <table class="heatmap-table">
       <thead>
         <tr>
           <th>Station</th>
           @for (w of heatmap()!.weeks; track w) { <th>{{ w | date:'dd MMM' }}</th> }
         </tr>
       </thead>
       <tbody>
         @for (s of heatmap()!.stations; track s.stationId) {
           <tr>
             <td class="station-label">{{ s.stationName }}</td>
             @for (pct of s.weeklyCapacityPct; track $index) {
               <td class="heat-cell" [class]="heatClass(pct)" [title]="s.weeklyHours[$index] + 'h planned'">
                 {{ s.weeklyHours[$index] | number:'1.0-0' }}h
               </td>
             }
           </tr>
         }
       </tbody>
     </table>
   </section>

3. heatClass(pct): pct <= 70 → 'heat-green', pct <= 95 → 'heat-amber', else 'heat-red'

4. Styles:
   .heatmap-table (width 100%, border-collapse collapse, font-size 13px, margin-top 20px)
   .heatmap-table th (font-family var(--mono), font-size 10px, color var(--ink-3), padding 6px 12px,
     border-bottom 0.5px solid var(--rule), text-align center)
   .station-label (font-weight 500, color var(--ink), padding 8px 12px, border-bottom 0.5px solid var(--rule))
   .heat-cell (text-align center, padding 8px 12px, border-bottom 0.5px solid var(--rule), font-family var(--mono),
     font-size 12px, cursor pointer)
   .heat-green (background #dcfce7, color #166534)
   .heat-amber (background #fef9c3, color var(--warn))
   .heat-red (background #fee2e2, color var(--bad))
   .heatmap-section (margin-top 28px)

Schema: job_tasks, repair_orders (scheduled_start_week), stations.
```

---

## Story E10-S5 — Schedule action: set start week (S, 2h)

**As a supervisor**
**I want** to click "Schedule" on an all-green RO and pick a start week
**So that** the RO appears in the capacity heatmap and the floor knows when to expect it

### Acceptance criteria
- The "Schedule" button in the backlog table (only enabled when `allGreen: true`) opens a compact week-picker popover:
  - Shows the next 6 Mondays as selectable options (e.g. "05 May", "12 May", …)
  - Current `scheduled_start_week` is pre-selected if already set
  - Clicking a week calls `PUT /api/scheduling/ros/{roId}/schedule` with `{ startWeek: "2026-05-05" }`
  - On success: updates the row's "Scheduled week" column in the table and refreshes the heatmap
- `PUT /api/scheduling/ros/{roId}/schedule` body `{ startWeek: string (yyyy-MM-dd, must be a Monday) }`:
  - Validates: date must be a Monday (`DayOfWeek.Monday`), must not be in the past, RO must not be COMPLETED or CANCELLED
  - Updates `repair_orders.scheduled_start_week = startWeek`
  - Inserts `domain_events` row: `event_type='RoScheduled'`, payload `{ roId, roNumber, startWeek }`
  - Returns 200 with `{ roId, scheduledStartWeek }`
- After scheduling, the row in the backlog table shows the chosen week in the "Scheduled week" column
- A supervisor can re-schedule by clicking "Schedule" again on an already-scheduled RO

### Technical context
- Week validation: `DateOnly.Parse(startWeek).DayOfWeek == DayOfWeek.Monday` — if not, return 400 "Start week must be a Monday"
- The 6 Mondays: computed in Angular as `nextMonday(today)` + 5 more by adding 7 days each
- Re-scheduling is allowed without restriction in v1 — overwrite the existing value

### Done definition
- Click "Schedule" on an all-green RO → week picker opens with 6 options
- Select "12 May" → `repair_orders.scheduled_start_week = '2026-05-12'`, table column updates, heatmap refreshes
- `PUT` with a Tuesday date → 400 "Start week must be a Monday"
- `PUT` with a date in the past → 400 "Start week cannot be in the past"
- Integration test: schedule, verify DB value, re-schedule to different week, verify updated

### Claude Code prompt
```
Add the schedule action endpoint and week-picker UI:

1. API: PUT /api/scheduling/ros/{roId}/schedule
   Add to SchedulingEndpoints.cs:
   Body: ScheduleRoRequest { StartWeek: string }
   Steps:
   a. Parse: DateOnly.Parse(req.StartWeek)
   b. Validate: parsedDate.DayOfWeek == DayOfWeek.Monday else 400
   c. Validate: parsedDate >= DateOnly.FromDateTime(DateTime.UtcNow.Date) else 400
   d. Load RO, validate status not in ('COMPLETED','CANCELLED')
   e. UPDATE repair_orders SET scheduled_start_week = parsedDate
   f. INSERT domain_events: event_type='RoScheduled', payload={roId, roNumber, startWeek}
   g. Return 200 { RoId, ScheduledStartWeek }
   .RequireAuthorization(p => p.RequireRole("SUPERVISOR","STATION_OWNER"))

2. Angular: add schedule popover to SchedulingComponent:
   - weekOptions = computed(() => { generate next 6 Mondays as DateString[] })
   - schedulePopoverRoId = signal<string | null>(null)

   In table row, after gate columns:
   <td>
     {{ row.scheduledStartWeek ? (row.scheduledStartWeek | date:'dd MMM') : '—' }}
   </td>
   <td>
     <button class="btn-schedule" [disabled]="!row.gates.allGreen" (click)="openSchedule(row.roId)">
       {{ row.scheduledStartWeek ? 'Reschedule' : 'Schedule' }}
     </button>
     @if (schedulePopoverRoId() === row.roId) {
       <div class="gate-popover week-picker">
         @for (w of weekOptions(); track w) {
           <div class="week-option" [class.selected]="w === row.scheduledStartWeek" (click)="scheduleRo(row.roId, w)">
             {{ w | date:'EEE dd MMM' }}
           </div>
         }
       </div>
     }
   </td>

3. scheduleRo(roId, week):
   PUT /api/scheduling/ros/{roId}/schedule { startWeek: week }
   On success: update the backlog signal row's scheduledStartWeek, close popover, refresh heatmap

4. weekOptions helper:
   private getNextMondays(count: number): string[] {
     const dates: string[] = [];
     let d = new Date();
     d.setDate(d.getDate() + ((1 + 7 - d.getDay()) % 7 || 7)); // next Monday
     for (let i = 0; i < count; i++) {
       dates.push(d.toISOString().slice(0, 10));
       d.setDate(d.getDate() + 7);
     }
     return dates;
   }

5. Styles:
   .btn-schedule (padding 6px 14px, border-radius 6px, border none, font-size 12px,
     font-weight 500, cursor pointer, background var(--accent), color white)
   .btn-schedule:disabled (background var(--paper-3), color var(--ink-3), cursor not-allowed)
   .week-picker (min-width 180px)
   .week-option (padding 8px 12px, cursor pointer, font-size 12px, color var(--ink),
     border-bottom 0.5px solid var(--rule))
   .week-option:hover (background var(--paper))
   .week-option.selected (background #e0e7ff, color #3730a3, font-weight 500)

6. Integration tests:
   - PUT with valid Monday → 200, DB updated
   - PUT with Tuesday → 400
   - PUT with past Monday → 400
   - Re-schedule to different week → 200, DB updated to new value

Schema: repair_orders (scheduled_start_week), domain_events.
```
