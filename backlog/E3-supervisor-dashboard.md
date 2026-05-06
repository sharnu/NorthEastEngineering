# Epic E3 — Supervisor Overview Dashboard

> **Priority:** P0 · **Owner:** Dev A · **Days:** 4–6 · **Depends on:** E2 (repair orders + tasks exist) · **Total estimate:** 16 hours

The supervisor's home screen. At a glance they see how many jobs are active, which stations are overloaded, where the biggest time variances are coming from, and the full active-RO table. Nothing is editable here — it's read-only with drill-through. The data is drawn from `v_ro_summary` and `v_station_load` (schema views already defined) plus live queries for the KPI row and variance panel. Polling replaces WebSockets for this sprint (real-time push is E7).

---

## Story E3-S1 — KPI row API + dashboard shell (M, 4h)

**As a supervisor**
**I want** to land on a dashboard that shows today's headline numbers
**So that** I know the state of production without hunting through individual jobs

### Acceptance criteria
- Route `/dashboard` (replaces the "welcome" stub from E1-S5), protected by `authGuard`
- `GET /api/dashboard/kpis` returns:
  ```json
  {
    "activeRos": 12,
    "hoursScheduled": 420.5,
    "hoursUtilised": 198.0,
    "utilisationPct": 47.1,
    "inHospitalCount": 2,
    "onTimePct": 83.3,
    "overdueCount": 3
  }
  ```
- `activeRos`: `repair_orders` where `status IN ('APPROVED','IN_PROGRESS','ON_HOLD')`
- `hoursScheduled` / `hoursUtilised`: sum across all tasks on active ROs (from `job_tasks`)
- `inHospitalCount`: `ro_kanban_state` joined to `kanban_stages` where `code = 'HOSPITAL'`
- `onTimePct` / `overdueCount`: active ROs where `required_date < now()` = overdue
- Angular page layout: top nav (already exists from E1), then a 4-card KPI row below a "Supervisor" page title
- Each KPI card: icon, value, label. Cards: Active ROs / Utilisation % / In Hospital / On-Time %
- Requires `[Authorize]` (any authenticated role can view; a `SUPERVISOR` role check is added in E3-S4 for the table)

### Technical context
- Query against `repair_orders`, `job_tasks`, `ro_kanban_state`, `kanban_stages`
- Do **not** use `v_ro_summary` for KPIs — the view includes completed/cancelled; filter manually
- `utilisationPct` = `SUM(actual_hours) / SUM(estimated_hours) * 100` for `IN_PROGRESS` tasks only
- `onTimePct` = `COUNT(required_date >= now()) / COUNT(*) * 100` where `required_date IS NOT NULL`

### Done definition
- `GET /api/dashboard/kpis` returns valid JSON against the seeded database (values are low since few seeded ROs)
- Dashboard page renders the KPI row without errors when no data (zeroes, not null crashes)
- Angular dev tools show one API call, no console errors

### Claude Code prompt
```
Create the supervisor dashboard foundation:

1. API: GET /api/dashboard/kpis
   - Uses NeeDbContext to query repair_orders, job_tasks, ro_kanban_state, kanban_stages
   - Returns KpiResponse record with fields: ActiveRos (int), HoursScheduled (decimal),
     HoursUtilised (decimal), UtilisationPct (decimal), InHospitalCount (int),
     OnTimePct (decimal), OverdueCount (int)
   - Active ROs: status IN ('APPROVED','IN_PROGRESS','ON_HOLD')
   - HoursScheduled/Utilised: SUM over job_tasks for active ROs
   - InHospitalCount: ro_kanban_state JOIN kanban_stages WHERE code = 'HOSPITAL'
   - OverdueCount: active ROs WHERE required_date < now() AND required_date IS NOT NULL
   - OnTimePct: (activeRos - overdueCount) / activeRos * 100, or 100 if activeRos = 0
   - [Authorize], endpoint registered in Program.cs under a new DashboardEndpoints class

2. Angular: replace /dashboard stub component from E1-S5
   - DashboardComponent at /dashboard (keep route, replace template)
   - On init: call GET /api/dashboard/kpis via a new DashboardService
   - Show a loading skeleton while data loads (4 grey card placeholders)
   - KPI row: 4 cards side-by-side (flex row, wrap on mobile)
     Card template: icon (use a simple SVG or Unicode), large number, label underneath
     Cards: Active ROs, Utilisation %, In Hospital, On-Time %
   - If API returns error, show an alert "Could not load dashboard data" (don't crash)
   - CSS: .kpi-row { display: flex; gap: 16px; }, .kpi-card { flex: 1; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px; }

3. Tests:
   - API integration test: GET /api/dashboard/kpis returns 200 with correct shape (no data = all zeros)
   - Angular: simple component test checking KPI cards render

Schema: repair_orders (status, required_date), job_tasks (estimated_hours, actual_hours, status, ro_id),
ro_kanban_state (ro_id, current_stage_id), kanban_stages (id, code).
```

---

## Story E3-S2 — Station load panel (S, 2h)

**As a supervisor**
**I want** to see a visual bar for each station showing its current hours load
**So that** I can spot bottlenecks at a glance and reassign work proactively

### Acceptance criteria
- `GET /api/dashboard/station-load` returns array from `v_station_load` view:
  ```json
  [
    {
      "stationId": 20,
      "stationCode": "FAB_LINE",
      "stationName": "Fabrication line",
      "ownerName": "Dwayne Fender",
      "openTasks": 5,
      "activeTasks": 2,
      "hoursRemaining": 28.5
    }
  ]
  ```
- Returns **all active stations** ordered by `sort_order`, even those with zero tasks
- Angular: station load panel below the KPI row
- Each station row: name, owner, bar (width = `hoursRemaining / maxHoursRemaining * 100%`), hours number, open task count
- Bar colour: green < 20h, amber 20–40h, red > 40h (or customise thresholds to what looks good with seed data)
- Stations with zero open tasks still render (greyed out / zero-width bar)
- Endpoint requires `[Authorize]`

### Technical context
- `v_station_load` is defined in `001_initial_schema.sql` — query it directly with EF Core's `FromSqlRaw`
- Map the view result to a simple DTO; don't attempt EF Core entity mapping for the view
- Null-safe: `owner_name` can be NULL for unassigned stations; `hours_remaining` can be NULL if no tasks

### Done definition
- `GET /api/dashboard/station-load` returns all 11 stations (from schema seed), with null owner where unassigned
- Bars render with correct colours; bars don't overflow or crash when `hoursRemaining` is NULL/0
- Tested: seeded data shows correct station counts

### Claude Code prompt
```
Add station load panel to the supervisor dashboard:

1. API: GET /api/dashboard/station-load
   - Query v_station_load view using db.Database.SqlQueryRaw<StationLoadDto>("SELECT * FROM v_station_load")
   - StationLoadDto: StationId (short), StationCode (string), StationName (string), OwnerName (string?),
     OpenTasks (int), ActiveTasks (int), HoursRemaining (decimal?)
   - [Authorize], add to DashboardEndpoints

2. Angular: station load panel in DashboardComponent
   - Section below KPI row: heading "Station Load"
   - For each station: one row with station name, owner (or "Unassigned"), a bar div, and hours remaining
   - Bar: width% = Math.min((hours / maxHours) * 100, 100) where maxHours = Math.max of all hoursRemaining
   - Bar colour class: 'load-low' (green) if hours < 20, 'load-mid' (amber) if 20-40, 'load-high' (red) if >40
   - hoursRemaining null → treat as 0 (no bar)
   - CSS: .station-row { display: flex; align-items: center; gap: 12px; margin-bottom: 8px; }
          .bar-track { flex: 1; height: 8px; background: #e2e8f0; border-radius: 4px; }
          .bar-fill { height: 100%; border-radius: 4px; transition: width 0.3s; }
          .load-low { background: #48bb78; } .load-mid { background: #ed8936; } .load-high { background: #e53e3e; }

3. Tests: GET /api/dashboard/station-load returns 200 with all active stations.

Schema: v_station_load view (defined in 001_initial_schema.sql).
```

---

## Story E3-S3 — Top variance panel (S, 2h)

**As a supervisor**
**I want** to see the 5 operations with the highest actual-vs-estimate variance this week
**So that** I can identify systematic estimation problems before they repeat

### Acceptance criteria
- `GET /api/dashboard/top-variance` returns the top 5 variance records from the last 7 days, ordered by `delta_hours DESC`:
  ```json
  [
    {
      "taskId": "...",
      "roNumber": "RO00001",
      "operationName": "Fabrication line assembly",
      "stationName": "Fabrication line",
      "estimatedHours": 8.0,
      "actualHours": 12.5,
      "deltaHours": 4.5,
      "deltaPct": 56.25,
      "reasonName": "Missing or delayed parts",
      "technicianName": "Peter Rogers"
    }
  ]
  ```
- Returns empty array (not 404) when no variance records exist
- Angular: "Top Variance" panel on the right side of the dashboard (two-column layout: station load left, variance right)
- Each row: operation name, RO number, delta hours (red if positive, green if negative), reason chip, technician name
- `[Authorize]`

### Technical context
- Tables: `variance_records` JOIN `job_tasks` JOIN `repair_orders` JOIN `operation_catalog` JOIN `variance_reasons` JOIN `users` (assigned_to_user_id) JOIN `stations`
- `variance_records.recorded_at >= now() - INTERVAL '7 days'`
- `delta_hours` is a generated column — no need to calculate it
- Limit 5; order by `delta_hours DESC`

### Done definition
- Endpoint returns empty array when no variance records seeded
- Integration test seeds one variance record and confirms it appears in the response
- Panel renders without errors on empty data (shows "No variance data this week")

### Claude Code prompt
```
Add top variance panel to supervisor dashboard:

1. API: GET /api/dashboard/top-variance
   - Join variance_records → job_tasks → repair_orders, operation_catalog, variance_reasons, users, stations
   - Filter: recorded_at >= DateTimeOffset.UtcNow.AddDays(-7)
   - Order by delta_hours DESC, limit 5
   - TopVarianceDto: TaskId (Guid), RoNumber (string), OperationName (string), StationName (string),
     EstimatedHours (decimal), ActualHours (decimal), DeltaHours (decimal), DeltaPct (decimal?),
     ReasonName (string), TechnicianName (string?)
   - [Authorize], add to DashboardEndpoints

2. Angular: add variance panel to DashboardComponent
   - Two-column row below station load: left = station load panel, right = top variance panel
   - Heading "Top Variance (7 days)"
   - If array empty: show "No variance data this week" in muted text
   - Each row: operation name (bold), below it "RO {roNumber} · {technicianName}", right side: delta badge
   - Delta badge: "+4.5h" in red background if deltaHours > 0, "-1.0h" in green if negative
   - Reason chip: small grey pill below the delta badge

3. Tests: GET /api/dashboard/top-variance returns 200 with empty array (no seed data).

Schema: variance_records (task_id, delta_hours, delta_percent, reason_id, recorded_at),
job_tasks (id, ro_id, operation_name, station_id, assigned_to_user_id, estimated_hours, actual_hours),
repair_orders (ro_number), variance_reasons (name), stations (name), users (full_name).
```

---

## Story E3-S4 — Active ROs table (M, 4h)

**As a supervisor**
**I want** a sortable, filterable table of all active repair orders
**So that** I can find any specific job and understand its current state

### Acceptance criteria
- `GET /api/dashboard/active-ros` returns all ROs where `status NOT IN ('COMPLETED','CANCELLED')`, ordered by `priority ASC, required_date ASC NULLS LAST`:
  ```json
  [
    {
      "id": "...",
      "roNumber": "RO00001",
      "customerName": "Direct Freight Express",
      "templateCode": "TP42N",
      "bodyType": "Tipper",
      "currentStage": "Fabrication",
      "status": "IN_PROGRESS",
      "priority": 2,
      "requiredDate": "2026-08-01T00:00:00Z",
      "hoursScheduled": 53.5,
      "hoursUtilised": 18.0,
      "taskCount": 12,
      "tasksCompleted": 3,
      "completionPct": 25.0
    }
  ]
  ```
- Supports optional query params: `?status=IN_PROGRESS`, `?customerId={uuid}`
- Angular: full-width table below the two-column panels
- Columns: RO#, Customer, Template, Stage, Status pill, Priority, Due Date, Progress bar (`tasksCompleted/taskCount`), Hours remaining
- Clicking any row navigates to `/sales/ro/{id}` (read-only view from E2-S6)
- Requires role `SUPERVISOR` or `ADMIN` (add `RequireRole` to this endpoint only)
- Sort: click column header to sort client-side (no server-side sort needed for MVP)

### Technical context
- Use `v_ro_summary` view for `hours_scheduled`, `hours_utilised`, `current_stage`
- Join to `repair_orders`, `customers`, `job_code_templates`, `body_types`, `job_tasks` (for task count)
- `completionPct` = `tasksCompleted / taskCount * 100`
- Priority pills: 1 = "Urgent" (red), 2 = "High" (orange), 3 = "Normal" (blue), 4/5 = "Low" (grey)
- Status pills: IN_PROGRESS = green, ON_HOLD = amber, APPROVED = blue, DRAFT = grey

### Done definition
- `GET /api/dashboard/active-ros` returns seeded ROs (any created during E2 testing appear here)
- `?status=DRAFT` filter returns only DRAFT ROs
- Table renders with sort on Priority and Due Date columns
- Row click navigates to `/sales/ro/{id}`
- Integration test: returns 200, shape validated

### Claude Code prompt
```
Add the active ROs table to the supervisor dashboard:

1. API: GET /api/dashboard/active-ros
   - Optional query params: status (string), customerId (Guid?)
   - Query repair_orders JOIN customers, job_code_templates, body_types
   - LEFT JOIN v_ro_summary for hours_scheduled, hours_utilised, current_stage
   - LEFT JOIN job_tasks aggregation for task_count, tasks_completed
   - Filter: status NOT IN ('COMPLETED','CANCELLED'), apply optional params
   - Order: priority ASC, required_date ASC NULLS LAST
   - ActiveRoDto: Id, RoNumber, CustomerName, TemplateCode, BodyType, CurrentStage (nullable),
     Status, Priority, RequiredDate (nullable), HoursScheduled, HoursUtilised,
     TaskCount, TasksCompleted, CompletionPct (decimal)
   - RequireRole("SUPERVISOR", "ADMIN")

2. Angular: ActiveRosTableComponent (standalone, used inside DashboardComponent)
   - Input: rows: ActiveRoDto[]
   - Table with columns: RO#, Customer, Template / Body type, Stage, Status, Priority, Due Date, Progress, Hours
   - Status pill: colour-coded span (.pill-green, .pill-amber, .pill-blue, .pill-grey)
   - Priority badge: 1=Urgent/red, 2=High/orange, 3=Normal/blue, 4+=Low/grey
   - Progress: small progress bar (completed/total tasks) + "3/12" text
   - Click row: router.navigate(['/sales/ro', row.id])
   - Client-side sort: clicking column header flips a sortField/sortDir signal, pipe sorts the array
   - Filter row above the table: text input for customer name, dropdown for status

3. Tests:
   - API: GET /api/dashboard/active-ros returns 200; ?status=DRAFT filters correctly
   - Angular: renders 0 rows with "No active repair orders" message when data is empty

Schema: v_ro_summary (ro_id, ro_number, customer_name, body_type, current_stage, hours_scheduled,
hours_utilised), repair_orders (id, status, priority, required_date), job_tasks (status, ro_id).
```

---

## Story E3-S5 — Polling refresh + integration test (S, 2h)

**As a supervisor**
**I want** the dashboard to stay current as production progresses during my shift
**So that** I don't have to manually refresh the browser every time something changes

### Acceptance criteria
- Dashboard auto-refreshes all three panels (KPIs, station load, variance) every 30 seconds
- A subtle "Last updated: 14:32:05" timestamp in the top-right of the dashboard updates on each poll
- The ROs table refreshes every 60 seconds (separate interval — less volatile than KPIs)
- Polling stops when the component is destroyed (no memory leaks on navigation away)
- Visual indicator: a small spinner or pulsing dot appears during each refresh cycle; disappears on completion
- No full-page flicker: data updates in-place, not by destroying/recreating the component

### Technical context
- Use `interval()` from RxJS combined with `switchMap` and `takeUntilDestroyed()` (Angular 18 idiom)
- Three separate intervals: 30s for KPI + load + variance; 60s for RO table
- Error handling: if a poll fails, log to console but keep polling (don't stop the interval)
- `takeUntilDestroyed` requires injection context — pass `DestroyRef` explicitly if calling from a non-constructor context

### Done definition
- Navigate to `/dashboard`, wait 31s, observe network tab shows new API calls fired
- Navigate away, confirm no further API calls (polling stopped)
- Playwright test (or Cypress): stubs the API, advances fake timers by 31s, confirms component called the API twice

### Claude Code prompt
```
Add auto-refresh polling to the supervisor dashboard:

1. In DashboardComponent:
   - Inject DestroyRef
   - On init: set up two RxJS intervals:
     a. interval(30_000).pipe(startWith(0), switchMap(() => forkJoin([loadKpis(), loadStationLoad(), loadVariance()])), takeUntilDestroyed(this.destroyRef))
     b. interval(60_000).pipe(startWith(0), switchMap(() => loadActiveRos()), takeUntilDestroyed(this.destroyRef))
   - Use a `lastUpdated = signal<Date | null>(null)` updated after each successful poll
   - isRefreshing = signal(false); set true before fetch, false after (even on error)

2. Template additions:
   - Top-right of dashboard: "Last updated: {{ lastUpdated() | date:'HH:mm:ss' }}" (hide if null)
   - A small pulsing dot or spinner shown while isRefreshing() is true:
     <span class="refresh-dot" [class.active]="isRefreshing()"></span>
   - CSS: .refresh-dot { width: 8px; height: 8px; border-radius: 50%; background: #48bb78; }
           .refresh-dot.active { animation: pulse 1s infinite; }
           @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }

3. Error handling: catchError in switchMap returns the previous data (or empty state) so the UI doesn't blank out

4. Integration test (xUnit/Testcontainers):
   - Seed one RO, call GET /api/dashboard/kpis, assert activeRos = 1
   - Seed another RO, call again, assert activeRos = 2
   - Verifies that KPI data is live (not cached) and polling would show fresh data

Note: The 30s/60s actual timer test belongs in an Angular unit test (use jasmine fakeAsync or Jest's fake timers).
Use the integration test to confirm the underlying API endpoints return fresh data on each call.
```

---

## Integration points

- **E2 → E3:** The `v_ro_summary` view joins against `repair_orders` created by the RO materialisation service. Any RO created in E2 appears on the E3 dashboard automatically.
- **E4 → E3:** The `ro_kanban_state` table is populated when Kanban moves tasks (E4). The `current_stage` column in `v_ro_summary` (and the hospital count KPI) only shows meaningful data once E4 is wiring stage transitions.
- **E5 → E3:** `time_entries` drive `actual_hours` on `job_tasks`, which feeds `v_station_load.hours_utilised` and the variance panel. The station load bars will be mostly zero until technicians start clocking time (E5).
