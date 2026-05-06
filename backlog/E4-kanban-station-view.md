# Epic E4 — Kanban Station View

> **Priority:** P0 · **Owner:** Dev A · **Days:** 6–7 · **Depends on:** E3 (dashboard shell, routing) · **Total estimate:** 14 hours

The production floor view. Each station gets a column; open tasks are cards inside the column, grouped by kanban stage. A station owner or supervisor can click a task card to see its detail and assign a technician. No drag-and-drop in v1 — click to promote a task to the next stage. The board refreshes on the same 30-second polling cadence as the dashboard.

---

## Story E4-S1 — Kanban API endpoint (M, 4h)

**As any authenticated user**
**I want** a single API call that returns the entire board state
**So that** the Angular board component can render without multiple round-trips

### Acceptance criteria
- `GET /api/kanban` returns:
  ```json
  {
    "stations": [
      {
        "stationId": 20,
        "stationCode": "FAB_LINE",
        "stationName": "Fabrication line",
        "ownerName": "Dwayne Fender",
        "tasks": [
          {
            "id": "...",
            "roId": "...",
            "roNumber": "RO00001",
            "sequence": 5,
            "jobCodeLine": "05TP42N-FAB_LINE_ASSY",
            "operationName": "Fabrication line assembly",
            "assignedToUserId": null,
            "assignedToName": null,
            "estimatedHours": 8.0,
            "actualHours": 1.5,
            "status": "IN_PROGRESS",
            "priority": 2,
            "customerName": "Direct Freight Express",
            "requiredDate": "2026-08-01T00:00:00Z"
          }
        ]
      }
    ]
  }
  ```
- Includes **all active stations** ordered by `stations.sort_order`, even if they have zero tasks
- Tasks filtered to `status NOT IN ('COMPLETED','CANCELLED')`
- Tasks within each station ordered by: `priority ASC, required_date ASC NULLS LAST, sequence ASC`
- `GET /api/kanban?stationId=20` returns only that station (for per-station polling optimisation)
- Requires `[Authorize]`

### Technical context
- Tables: `stations` LEFT JOIN `job_tasks` ON `station_id` JOIN `repair_orders` JOIN `customers`
- LEFT JOIN `users` ON `job_tasks.assigned_to_user_id` for `assignedToName`
- LEFT JOIN `users` ON `stations.owner_user_id` for `ownerName`
- `priority` comes from `repair_orders.priority`, not from the task
- Avoid N+1: load all tasks in one query, group in memory using LINQ `GroupBy`

### Done definition
- `GET /api/kanban` returns all 11 stations with empty task arrays (seeded data has no tasks in progress)
- After creating an RO in E2, re-calling the endpoint shows tasks at the correct station
- `?stationId=20` filter returns only the Fabrication Line station
- Integration test: create RO, GET /api/kanban, assert FAB_LINE station has 2 tasks (sequences 5, 6 in TP42N)

### Claude Code prompt
```
Create the Kanban board API:

1. Add KanbanEndpoints.cs to /api/Endpoints/:
   GET /api/kanban with optional ?stationId=20 query param

2. Response model:
   KanbanBoardDto { Stations: KanbanStationDto[] }
   KanbanStationDto { StationId, StationCode, StationName, OwnerName?, Tasks: KanbanTaskDto[] }
   KanbanTaskDto {
     Id, RoId, RoNumber, Sequence, JobCodeLine, OperationName,
     AssignedToUserId (Guid?), AssignedToName (string?),
     EstimatedHours, ActualHours, Status,
     Priority, CustomerName, RequiredDate (DateTimeOffset?)
   }

3. Query: load all stations (is_active = true, ordered by sort_order)
   For each station LEFT JOIN job_tasks WHERE status NOT IN ('COMPLETED','CANCELLED')
   JOIN repair_orders (for priority, required_date, ro_number) JOIN customers (for customer_name)
   LEFT JOIN users (for assigned_to_name)
   Apply stationId filter if provided
   Group by station in memory (LINQ GroupBy after ToListAsync)

4. Registration: app.MapKanbanEndpoints() in Program.cs. [Authorize].

5. Tests:
   - GET /api/kanban returns 200 with all active stations
   - ?stationId=20 returns only 1 station
   - After seeding an RO (use ApiFixture), tasks appear at the correct stations

Schema: stations (id, code, name, owner_user_id, sort_order), job_tasks (station_id, status, sequence,
assigned_to_user_id), repair_orders (priority, required_date, customer_id), customers (name).
```

---

## Story E4-S2 — Board layout component (M, 3h)

**As a supervisor or station owner**
**I want** to see the kanban board as a horizontal column layout in the browser
**So that** I can visually understand the load across all stations at once

### Acceptance criteria
- Route `/kanban`, protected by `authGuard`
- Horizontal scroll layout: one column per station, columns are fixed-width (280px), the row scrolls horizontally if it overflows
- Each column header: station name, owner name or "Unassigned", task count badge
- Columns with zero tasks render with a muted "No open tasks" message
- Tasks render as cards inside their station column, ordered by priority then required date
- Priority badge on each card: 1 = "Urgent" (red border-left), 2 = "High" (orange), 3 = "Normal" (blue)
- A "Filter by station" dropdown at the top lets the user narrow to a single station (triggers `?stationId=N` param)
- Page title: "Kanban Board" with a "Refresh" button that manually re-triggers the API call

### Technical context
- Use Angular signal-based state: `stations = signal<KanbanStationDto[]>([])`
- `selectedStation = signal<number | null>(null)` drives the `?stationId=N` query param
- Computed: `visibleStations = computed(() => selectedStation() ? stations().filter(...) : stations())`
- No virtual scrolling needed — 11 stations max

### Done definition
- Visit `/kanban`, see all 11 station columns (most empty with seed data)
- Create an RO via E2, reload `/kanban`, see tasks appear in the correct station column at the correct priority
- Filter to FAB_LINE, see only Fabrication column; clear filter, all columns return
- No horizontal scroll clipping of cards (min-height on column)

### Claude Code prompt
```
Create the Kanban board Angular component:

1. KanbanBoardComponent at /web/src/app/kanban/kanban-board.component.ts (standalone)
   Route: /kanban, add to app routes with authGuard

2. State (signals):
   stations = signal<KanbanStationDto[]>([])
   selectedStationId = signal<number | null>(null)
   isLoading = signal(false)
   visibleStations = computed(() =>
     this.selectedStationId() ? this.stations().filter(s => s.stationId === this.selectedStationId()) : this.stations()
   )

3. KanbanService at /web/src/app/services/kanban.service.ts:
   getBoard(stationId?: number): Observable<KanbanBoardDto>

4. Template layout:
   - Top bar: "Kanban Board" h1, station filter dropdown (value from selectedStationId signal),
     "Refresh" button (calls loadBoard()), last-refreshed timestamp
   - Board: <div class="board"> with overflow-x: auto
     Inside: <div class="board-columns"> with display: flex, gap: 12px
     Each station: <div class="board-col"> width: 280px, flex-shrink: 0
   - Column header: station name (bold), owner name in muted text, badge with task count
   - Column body: task cards (see E4-S3), or <p class="no-tasks">No open tasks</p>

5. CSS (inline in component or shared _kanban.scss):
   .board { overflow-x: auto; }
   .board-columns { display: flex; gap: 12px; padding: 16px; min-width: max-content; }
   .board-col { width: 280px; flex-shrink: 0; background: #f7fafc; border-radius: 8px; padding: 12px; }
   .col-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
   .task-count-badge { background: #e2e8f0; border-radius: 12px; padding: 2px 8px; font-size: 0.75rem; }

6. Tests: component renders columns from mock data; filter hides/shows columns correctly.
```

---

## Story E4-S3 — Task card component + detail drawer (M, 3h)

**As a supervisor or station owner**
**I want** to click a task card and see its full detail in a side drawer
**So that** I can understand what the task involves before assigning or acting on it

### Acceptance criteria
- `TaskCardComponent`: standalone, takes `task: KanbanTaskDto` as input
- Card shows: operation name, RO number + customer name, estimated hours, status pill, priority badge, assigned tech (or "Unassigned")
- Clicking a card opens a side drawer (not a modal) that slides in from the right (300ms transition)
- Drawer shows: all task card fields PLUS `GET /api/repair-orders/{roId}` data to show the full RO context
- Drawer sections: Task header, RO details (customer, rego, required date, make/model), Progress (estimated vs actual hours, status), Notes
- Drawer close: X button or clicking the backdrop
- Drawer is rendered inside the board, not the router outlet (overlay pattern)
- No navigation — the drawer is supplementary info only

### Technical context
- Implement drawer as an overlay `div` with `position: fixed; right: 0; top: 0; height: 100vh; width: 380px; z-index: 100`
- `isDrawerOpen = signal(false)`, `selectedTask = signal<KanbanTaskDto | null>(null)`
- On card click: set selectedTask, set isDrawerOpen to true
- Reuse the `GET /api/repair-orders/{id}` endpoint already built in E2-S6 for RO context
- Status pill colours: PENDING = grey, ASSIGNED = blue, IN_PROGRESS = green, PAUSED = amber, BLOCKED = red

### Done definition
- Click any task card, drawer opens with task name visible
- Drawer shows RO number, customer name, required date loaded from `/api/repair-orders/{roId}`
- Click backdrop, drawer closes
- Keyboard: pressing Escape closes the drawer
- No layout shift on drawer open (use `overflow: hidden` on body while drawer is open)

### Claude Code prompt
```
Create the task card component and detail drawer:

1. TaskCardComponent at /web/src/app/kanban/task-card.component.ts (standalone):
   Input: task (KanbanTaskDto), Output: cardClicked (EventEmitter<KanbanTaskDto>)
   Template:
     <div class="task-card" [class]="priorityClass()" (click)="cardClicked.emit(task)">
       <div class="task-card-body">
         <span class="op-name">{{ task.operationName }}</span>
         <span class="ro-ref">{{ task.roNumber }} · {{ task.customerName }}</span>
         <div class="task-card-footer">
           <span class="hours">{{ task.estimatedHours }}h est.</span>
           <span class="pill" [class]="statusClass()">{{ task.status }}</span>
           <span class="assignee">{{ task.assignedToName ?? 'Unassigned' }}</span>
         </div>
       </div>
     </div>
   priorityClass(): returns 'priority-urgent' | 'priority-high' | 'priority-normal' | 'priority-low'
   CSS: .task-card { border-radius: 6px; background: white; padding: 12px; margin-bottom: 8px; cursor: pointer;
          border-left: 4px solid #cbd5e0; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }
        .priority-urgent { border-left-color: #e53e3e; }
        .priority-high   { border-left-color: #ed8936; }
        .priority-normal { border-left-color: #4299e1; }

2. TaskDrawerComponent at /web/src/app/kanban/task-drawer.component.ts (standalone):
   Inputs: task (KanbanTaskDto | null), isOpen (boolean)
   Output: closed (EventEmitter<void>)
   On init when task changes: call RoService.getById(task.roId) to fetch RO detail
   Template: fixed overlay, right-side panel, sections as described above
   Close on Escape: @HostListener('document:keydown.escape') closeDrawer()
   Backdrop: semi-transparent div behind the panel that emits closed on click

3. Wire up in KanbanBoardComponent:
   selectedTask = signal<KanbanTaskDto | null>(null)
   isDrawerOpen = signal(false)
   Add <app-task-drawer [task]="selectedTask()" [isOpen]="isDrawerOpen()" (closed)="isDrawerOpen.set(false)">
   In each column: <app-task-card [task]="t" (cardClicked)="openDrawer($event)">

4. Tests: task card emits event on click; drawer renders task name in title.
```

---

## Story E4-S4 — Assign technician endpoint + UI (S, 2h)

**As a station owner**
**I want** to assign a technician to a task directly from the task drawer
**So that** the floor knows who is responsible without switching to another screen

### Acceptance criteria
- `PUT /api/job-tasks/{id}/assign` with body `{ userId: "..." }`:
  - Sets `job_tasks.assigned_to_user_id`, `assigned_by_user_id` (current user), `assigned_at` (now)
  - Changes task status from `PENDING` → `ASSIGNED` (if currently PENDING; no-op if already ASSIGNED/IN_PROGRESS)
  - Emits `domain_events` row: `event_type = 'TaskAssigned'`, `aggregate_type = 'JobTask'`, `payload = { taskId, roId, assignedToUserId, assignedByUserId }`
  - Returns `204 No Content` on success
  - Returns `404` if task not found
  - Returns `400` if userId is not an active technician at the task's station
- Requires `SUPERVISOR` or `STATION_OWNER` role
- `PUT /api/job-tasks/{id}/assign` with `{ userId: null }` unassigns the technician (sets to NULL, status back to PENDING)
- Drawer UI: "Assign technician" dropdown populated from `GET /api/stations/{id}/technicians`
  - `GET /api/stations/{id}/technicians` returns `[{ userId, fullName, isPrimary, skillLevel }]`
  - "Unassign" option at the top of the dropdown
  - On select: call PUT, show success inline, close dropdown (drawer stays open, task card updates)

### Technical context
- `station_technicians` table maps which users are rostered to a station
- Validation: `userId` must exist in `station_technicians WHERE station_id = task.station_id`
- After assign, the board should reflect the change on next poll — do not manually patch the board state (let the 30s refresh pick it up); optionally, trigger an immediate board refresh after assign
- `assigned_by_user_id` comes from `ClaimsPrincipal.Sub` (same pattern as RO creation)

### Done definition
- Assign Peter Rogers (seed technician, rostered to station 20) to a FAB_LINE task; drawer shows "Peter Rogers"
- After 30s (or manual refresh), kanban card shows "Peter Rogers" as assignee
- Attempting to assign a user not rostered to that station returns 400
- Unassign: set back to null, card shows "Unassigned"
- Integration test covers happy path and 400 for wrong-station user

### Claude Code prompt
```
Add task assignment to the kanban:

1. API: GET /api/stations/{id}/technicians
   - Query station_technicians WHERE station_id = id JOIN users WHERE is_active = true
   - Returns StationTechnicianDto[]: { UserId, FullName, IsPrimary, SkillLevel }
   - [Authorize], add to a new StationEndpoints.cs

2. API: PUT /api/job-tasks/{id}/assign
   - Body: AssignTaskRequest { UserId: Guid? }
   - Validate: if UserId not null, must exist in station_technicians for task's station_id
   - Update job_tasks: assigned_to_user_id, assigned_by_user_id (from claims sub), assigned_at = now()
   - If task.status == 'PENDING' and UserId != null: set status = 'ASSIGNED'
   - If UserId == null: set status = 'PENDING', clear assigned_at, assigned_by
   - Write domain_events row (event_type='TaskAssigned', aggregate_type='JobTask')
   - Return 204 No Content
   - RequireRole("SUPERVISOR", "STATION_OWNER")
   - Add to new JobTaskEndpoints.cs, register in Program.cs

3. Angular: add assign UI to TaskDrawerComponent
   - New section in drawer: "Assign Technician"
   - On drawer open: call GET /api/stations/{task.stationId}/technicians
   - Dropdown: "Unassign" at top, then each technician (mark primary with a star)
   - current selection = task.assignedToUserId (or null)
   - On change: call PUT /api/job-tasks/{id}/assign, on success update local task signal,
     show inline "Assigned to {name}" confirmation for 2 seconds
   - If API returns 400: show inline error below dropdown

4. Tests:
   - PUT /api/job-tasks/{id}/assign with valid userId returns 204, DB reflects change
   - With userId not in station_technicians returns 400
   - With userId null unassigns and sets status PENDING

Schema: job_tasks (assigned_to_user_id, assigned_by_user_id, assigned_at, status),
station_technicians (station_id, user_id, is_primary), domain_events.
```

---

## Story E4-S5 — Polling refresh integration test (S, 2h)

**As the development team**
**I want** automated coverage of the kanban board's live-data behaviour
**So that** a future change to a task query doesn't silently break the board

### Acceptance criteria
- xUnit integration test (Testcontainers): seeds one RO, calls `GET /api/kanban`, verifies tasks appear at correct stations with correct field values
- A second test: assigns a technician, re-calls GET /api/kanban, verifies the task shows the new assignee
- A third test: calls `GET /api/kanban?stationId=20`, verifies only station 20 is returned
- Angular polling test: using `fakeAsync` and `tick(30_000)`, verifies the service was called a second time after 30 seconds without manual intervention
- Board renders with zero tasks in all columns when the database is empty (no crash)

### Technical context
- For Angular tests, use `TestBed` with `provideHttpClientTesting()` and `jasmine.clock().tick()` (or `fakeAsync/tick`)
- API tests reuse the `ApiFixture` Testcontainers fixture from E2

### Done definition
- All three API integration tests pass against a real Postgres container
- Angular polling test passes in the component spec
- `dotnet test` passes with 0 failures after this story

### Claude Code prompt
```
Write integration and component tests for the kanban board:

1. /api.tests/KanbanEndpointTests.cs (uses ApiFixture):
   - GetKanbanBoard_ReturnsAllStations: GET /api/kanban → 200, stations array has 11 items (all active stations)
   - GetKanbanBoard_AfterRoCreation_TasksAtCorrectStation:
     a. Create RO (POST /api/repair-orders with TP42N template)
     b. GET /api/kanban
     c. Assert FAB_LINE station (id=20) has tasks where operation sequence matches TP42N operations for that station
   - GetKanbanBoard_StationFilter: GET /api/kanban?stationId=20 returns exactly 1 station
   - AssignTechnician_UpdatesAssignee:
     a. Create RO, get a task id from FAB_LINE station
     b. PUT /api/job-tasks/{taskId}/assign with valid userId (seed user 44444444... Peter Rogers)
     c. GET /api/kanban, assert that task.assignedToName = "Peter Rogers"
   Helper: generate SUPERVISOR-role JWT using fixture.GenerateToken(userId, "SUPERVISOR") for the assign endpoint

2. /web/src/app/kanban/kanban-board.component.spec.ts:
   - Uses TestBed with KanbanService mocked via HttpClientTestingModule or spyOn
   - Test: initial load calls getBoard() once
   - Test: after fakeAsync tick(30_000), getBoard() was called a second time
   - Test: renders one column per station from mock data
   - Test: setting selectedStationId filters visibleStations computed signal

Verify: dotnet test passes, ng test kanban passes.
```

---

## Integration points

- **E2 → E4:** Tasks created by `RoMaterialisationService` in E2 are the cards on this board. No additional setup needed — create an RO and it appears immediately.
- **E3 → E4:** The E3 dashboard shell provides the Angular routing scaffold and the `authGuard`. The `/kanban` route should be added to the same app routes file.
- **E4 → E5:** When a technician clicks "Clock In" on the tech phone view (E5), the task status changes from `ASSIGNED` → `IN_PROGRESS`. This status change is visible on the kanban board on the next poll. The assign endpoint built here is also the entry point for the station-owner flow in E5.
- **E4 → E3:** Kanban stage transitions (e.g., moving an RO from FABRICATION to PAINTING by completing all tasks in that stage) update `ro_kanban_state.current_stage_id`, which feeds the `current_stage` column in the E3 active-ROs table.
