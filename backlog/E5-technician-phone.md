# Epic E5 — Technician Phone + Variance

> **Priority:** P0 · **Owner:** Dev B · **Days:** 5–7 · **Depends on:** E2 (tasks exist), E4 (assign endpoint) · **Total estimate:** 18 hours

The floor-level experience. A technician on their phone (or shop-floor tablet) sees their assigned tasks, clocks in, tracks time live, and marks tasks complete. If they went over estimate, they pick a variance reason before the task closes. If something is blocking them, they raise a blocker which flags the RO as in the hospital zone. Everything here is optimised for one-handed use on a phone screen.

---

## Story E5-S1 — Tech task list endpoint + list view (S, 2h)

**As a technician**
**I want** to open the app on my phone and see my assigned tasks for today
**So that** I know what to work on without asking the supervisor

### Acceptance criteria
- `GET /api/tech/tasks` returns tasks assigned to the current user where `status IN ('ASSIGNED','IN_PROGRESS','PAUSED')`:
  ```json
  [
    {
      "id": "...",
      "roId": "...",
      "roNumber": "RO00001",
      "sequence": 5,
      "operationName": "Fabrication line assembly",
      "stationName": "Fabrication line",
      "estimatedHours": 8.0,
      "actualHours": 1.5,
      "status": "IN_PROGRESS",
      "priority": 2,
      "customerName": "Direct Freight Express",
      "requiredDate": "2026-08-01T00:00:00Z",
      "clockedInSince": "2026-05-01T06:30:00Z"
    }
  ]
  ```
- `clockedInSince`: the `clock_in` timestamp of the latest open `time_entries` row (NULL if not currently clocked in)
- Results ordered: IN_PROGRESS first, then PAUSED, then ASSIGNED; within each group by `priority ASC`
- Route `/tech/tasks`, protected by `authGuard`
- Phone-optimised layout: single column, max-width 420px centred, large tap targets (min 48px height)
- Each task card shows: operation name (large text), RO number + customer, est hours, a status pill, and a "Clock in" or "Continue" CTA button
- No sidebar or desktop navigation — full-screen mobile layout with a bottom nav

### Technical context
- `assigned_to_user_id` comes from JWT `sub` claim
- `clockedInSince`: `time_entries WHERE task_id = ? AND clock_out IS NULL ORDER BY clock_in DESC LIMIT 1`
- Tasks where the technician is not clocked in but status = IN_PROGRESS are "paused" (no live entry)
- Bottom nav (Angular component shared across tech routes): Task List (active), Clock, Complete

### Done definition
- Log in as `peter@nee.local` (seeded technician), visit `/tech/tasks`, see any tasks assigned to Peter (none initially)
- Assign a task to Peter via the E4 assign endpoint, reload tech tasks, see it appear
- Task card shows correct status pill and CTA button matching the status

### Claude Code prompt
```
Create the technician task list:

1. API: GET /api/tech/tasks
   - Current user from JWT sub claim
   - Query job_tasks WHERE assigned_to_user_id = userId AND status IN ('ASSIGNED','IN_PROGRESS','PAUSED')
   - JOIN repair_orders (priority, required_date, customer_id), customers (name), stations (name)
   - LEFT JOIN time_entries WHERE clock_out IS NULL ORDER BY clock_in DESC for clockedInSince
   - Order: CASE WHEN status='IN_PROGRESS' THEN 1 WHEN status='PAUSED' THEN 2 ELSE 3 END, priority ASC
   - TechTaskDto: Id, RoId, RoNumber, Sequence, OperationName, StationName, EstimatedHours, ActualHours,
     Status, Priority, CustomerName, RequiredDate (DateTimeOffset?), ClockedInSince (DateTimeOffset?)
   - [Authorize] (any role with a valid JWT)
   - Add TechEndpoints.cs, register in Program.cs

2. Angular: TechTaskListComponent at /web/src/app/tech/task-list.component.ts
   Route: /tech/tasks, protected by authGuard
   Layout: centered column, max-width 420px
   - Header: "My Tasks" + current time (updated every second with interval(1000))
   - Task card per item:
     <div class="tech-task-card">
       <div class="op-name">{{ task.operationName }}</div>
       <div class="ro-ref">{{ task.roNumber }} · {{ task.customerName }}</div>
       <div class="task-meta">{{ task.estimatedHours }}h est. · <span class="pill">{{ task.status }}</span></div>
       <button class="btn-primary cta" (click)="openTask(task)">
         {{ task.status === 'IN_PROGRESS' ? 'Continue' : 'Clock In' }}
       </button>
     </div>
   - openTask(): navigate to /tech/tasks/:id
   - Empty state: "No tasks assigned. Ask your station owner."
   - Pull-to-refresh: a "Refresh" button that re-calls the API (no native pull-to-refresh in v1)

3. TechBottomNavComponent (shared): link tabs for "Tasks", "History" (future), "Profile" (future)
   Position: fixed at bottom, height 60px. Active tab = Tasks.

4. Tests: GET /api/tech/tasks returns 200 with empty array for unauthenticated user → actually 401.
   GET with valid JWT but no tasks assigned → 200 empty array.

Schema: job_tasks (assigned_to_user_id, status, sequence, estimated_hours, actual_hours),
time_entries (task_id, clock_in, clock_out), repair_orders, customers, stations.
```

---

## Story E5-S2 — Tech task detail view (S, 2h)

**As a technician**
**I want** to see the full task detail before I clock in
**So that** I understand what I'm about to work on and how long it should take

### Acceptance criteria
- Route `/tech/tasks/:id`, protected by `authGuard`
- `GET /api/tech/tasks/:id` returns full task detail:
  ```json
  {
    "id": "...",
    "roNumber": "RO00001",
    "sequence": 5,
    "jobCodeLine": "05TP42N-FAB_LINE_ASSY",
    "operationName": "Fabrication line assembly",
    "stationName": "Fabrication line",
    "estimatedHours": 8.0,
    "actualHours": 1.5,
    "status": "IN_PROGRESS",
    "notes": null,
    "ro": {
      "customerName": "Direct Freight Express",
      "rego": "1AJ-213",
      "make": "Isuzu",
      "model": "NPR 75-190",
      "paintColour": "White",
      "requiredDate": "2026-08-01T00:00:00Z"
    },
    "timeEntries": [
      {
        "id": "...",
        "clockIn": "2026-05-01T06:30:00Z",
        "clockOut": "2026-05-01T09:45:00Z",
        "durationMinutes": 195,
        "activityType": "WORK"
      }
    ],
    "clockedInSince": null
  }
  ```
- Returns `403` if the task is not assigned to the current user (technicians can only see their own)
- Angular view: phone layout with a back arrow ← to `/tech/tasks`
- Sections: Job header (RO number, operation name, job code), Vehicle info (make/model, rego, paint, due date), Hours tracker (estimated, actual, % used as a ring or bar), Previous sessions (time entries table)
- Large action buttons at the bottom: "Clock In" (if not clocked in) or "Clock Out" (if in progress)

### Technical context
- `403` check: `task.assigned_to_user_id != currentUserId` — do not return task data for other technicians
- `timeEntries`: all closed entries for this task ordered by `clock_in ASC`
- `clockedInSince`: open entry (clock_out IS NULL)
- Hours tracker: `actualHours / estimatedHours * 100%` — cap at 150% visually (over-run shown in red)

### Done definition
- Log in as Peter, visit `/tech/tasks/{id}` for a task assigned to Peter → 200 with full detail
- Log in as Kane (seeded as different station), visit same URL → 403
- Hours bar shows correct percentage; goes red if actualHours > estimatedHours
- Time entries section lists all completed sessions with duration

### Claude Code prompt
```
Add tech task detail endpoint and view:

1. API: GET /api/tech/tasks/{id}
   - Load job_tasks JOIN repair_orders, customers, stations
   - Check task.assigned_to_user_id == currentUserId (from JWT sub), else return 403
   - Load time_entries WHERE task_id = id ORDER BY clock_in ASC
   - TechTaskDetailDto: all fields from S1 TechTaskDto PLUS:
     Ro: { CustomerName, Rego, Make, Model, PaintColour, RequiredDate }
     TimeEntries: TechTimeEntryDto[] { Id, ClockIn, ClockOut, DurationMinutes?, ActivityType }
     ClockedInSince: DateTimeOffset? (open entry's clock_in, or null)

2. Angular: TechTaskDetailComponent at /web/src/app/tech/task-detail.component.ts
   Route: /tech/tasks/:id
   - Back button: routerLink to /tech/tasks
   - Section 1 — Job header: operation name (h2), job code line, station name, status pill
   - Section 2 — Vehicle: customer name, rego, make/model, paint colour, due date
   - Section 3 — Hours tracker:
     Ring or bar: actualHours / estimatedHours, capped at 150% for display
     Colour: green if < 90%, amber if 90–110%, red if > 110%
     Text: "{{ actualHours }}h used of {{ estimatedHours }}h estimated"
   - Section 4 — Sessions: table of time entries (date, start, end, duration)
     If clockedInSince: a live session row with a ticking timer signal
   - Action buttons (fixed at bottom):
     If clockedInSince: "Clock Out" button
     Else: "Clock In" button
     (Both navigate to the same component, actions handled in S3)

3. Tests:
   - GET /api/tech/tasks/{id} with correct user → 200 with full detail
   - With different user → 403
   - With non-existent id → 404

Schema: job_tasks, repair_orders, customers, stations, time_entries.
```

---

## Story E5-S3 — Clock in / clock out endpoints + UI (M, 4h)

**As a technician**
**I want** to start and stop timing my work on a task
**So that** actual hours are captured accurately and variance can be calculated

### Acceptance criteria
- `POST /api/tech/tasks/{id}/clock-in`:
  - Creates a `time_entries` row: `task_id`, `user_id` (from JWT), `clock_in = now()`, `activity_type = 'WORK'`
  - Sets `job_tasks.status = 'IN_PROGRESS'` and `started_at = now()` (if not already set)
  - Returns `201` with `{ entryId, clockIn }`
  - Returns `409 Conflict` if there is already an open entry for this task (`clock_out IS NULL`)
  - Returns `403` if task is not assigned to the current user
- `POST /api/tech/tasks/{id}/clock-out`:
  - Finds the open `time_entries` row (clock_out IS NULL), sets `clock_out = now()`
  - Recalculates `job_tasks.actual_hours = SUM(duration_minutes) / 60` from all entries
  - Sets `job_tasks.status = 'PAUSED'` (not COMPLETED — that comes from E5-S5)
  - Returns `200` with `{ entryId, clockIn, clockOut, durationMinutes }`
  - Returns `404` if no open entry exists
  - Returns `403` if task not assigned to current user
- Angular: "Clock In" / "Clock Out" button on the task detail page
  - Optimistic UI: button changes immediately, live timer starts/stops
  - Live timer: a signal updated every second (`interval(1000)`) showing `HH:MM:SS` elapsed since `clockedInSince`
  - On clock-in: timer starts, button switches to "Clock Out"
  - On clock-out: timer stops, actual hours section updates with the new value
  - Error: if API returns 409 (already clocked in), show "You are already clocked in" toast

### Technical context
- `duration_minutes` is a generated column on `time_entries` — it computes automatically from `clock_in` and `clock_out`
- Actual hours recalculation: `SUM(duration_minutes) / 60.0` rounded to 2dp
- Do not allow clocking into a COMPLETED or CANCELLED task (return 400)
- A technician can only have one open entry at a time across **all** tasks — check globally, not just per task (prevents clocking into two tasks simultaneously)

### Done definition
- Clock in: `POST /api/tech/tasks/{id}/clock-in` returns 201, DB has open time entry, task status = IN_PROGRESS
- Clock out: `POST /api/tech/tasks/{id}/clock-out` returns 200, entry is closed, `actual_hours` updated
- Second clock-in without clocking out: 409
- Live timer ticks every second in the UI
- Clocking out stops the timer and refreshes the sessions section
- Integration tests cover happy path, 409, 403

### Claude Code prompt
```
Implement clock in / clock out:

1. API: POST /api/tech/tasks/{id}/clock-in
   - Validate: task exists, assigned_to_user_id == currentUser, status NOT IN ('COMPLETED','CANCELLED')
   - Check no open entries exist for this user anywhere (time_entries WHERE user_id = currentUser AND clock_out IS NULL)
   - INSERT time_entries: task_id, user_id, clock_in = now(), activity_type = 'WORK'
   - UPDATE job_tasks: status = 'IN_PROGRESS', started_at = (started_at ?? now())
   - Return 201 with { EntryId, ClockIn }
   - [Authorize], add to TechEndpoints.cs

2. API: POST /api/tech/tasks/{id}/clock-out
   - Find open entry: time_entries WHERE task_id = id AND user_id = currentUser AND clock_out IS NULL
   - If none found: 404 "No active clock-in found for this task"
   - UPDATE time_entries: clock_out = now() (duration_minutes auto-computes)
   - UPDATE job_tasks: actual_hours = (SELECT SUM(duration_minutes)::numeric / 60 FROM time_entries WHERE task_id = id AND clock_out IS NOT NULL), status = 'PAUSED'
   - Return 200 with { EntryId, ClockIn, ClockOut, DurationMinutes }

3. Angular: update TechTaskDetailComponent
   - clockedInSince = signal<Date | null>(null) — set from initial API response
   - elapsedSeconds = signal(0)
   - On init: if clockedInSince, start interval(1000) ticking elapsedSeconds
   - elapsedDisplay = computed(() => formatElapsed(this.elapsedSeconds()))
     function formatElapsed(s): `${pad(h)}:${pad(m)}:${pad(s)}` format

   - Clock In button handler:
     a. POST /api/tech/tasks/{id}/clock-in
     b. On success: set clockedInSince to now(), start timer, update button to "Clock Out"
     c. On 409: show toast "Already clocked in"

   - Clock Out button handler:
     a. POST /api/tech/tasks/{id}/clock-out
     b. On success: clear clockedInSince, stop timer, reload task detail to refresh sessions + actual hours
     c. On error: show toast with error message

4. Tests:
   - clock-in returns 201, DB has open entry
   - double clock-in returns 409
   - clock-out closes entry, actual_hours updated
   - clock-out without clock-in returns 404

Schema: time_entries (task_id, user_id, clock_in, clock_out, duration_minutes GENERATED, activity_type),
job_tasks (status, started_at, actual_hours).
```

---

## Story E5-S4 — Photo upload (S, 2h)

**As a technician**
**I want** to attach a photo to my task from the task detail screen
**So that** supervisors and QC can see evidence of the work or any issues

### Acceptance criteria
- `POST /api/tech/tasks/{id}/photos` with `multipart/form-data` body containing `file` (image/jpeg or image/png):
  - Validates: file is an image (MIME check), max 10MB
  - Saves file to `{appDir}/uploads/{taskId}/{filename}` (configurable base path)
  - Inserts into `attachments` table: `entity_type='JobTask'`, `entity_id=taskId`, `category='PHOTO'`, `uploaded_by=currentUser`, `blob_container='local'`, `blob_path={relative path}`
  - Returns `201` with `{ attachmentId, fileName, uploadedAt }`
- `GET /api/tech/tasks/{id}/photos` returns list of photo attachments for the task
- Angular: "Add Photo" button in the task detail that opens the device camera or file picker
  - `<input type="file" accept="image/*" capture="environment">` for mobile
  - On file selected: POST immediately (no preview step), show loading spinner on the button
  - On success: a thumbnail grid below the sessions section shows uploaded photos
  - Thumbnail tapping opens the photo full-screen (simple `<a href="..." target="_blank">` for now)

### Technical context
- File serving: add a static file route `GET /uploads/{path}` served from the uploads folder
- `blob_container = 'local'`, `blob_path = "{taskId}/{fileName}"` for now (Phase 2 swaps to Azure Blob)
- Filename collision: prefix with `{Guid.NewGuid():N}_{originalFileName}` to avoid overwrites
- Max file size: configure in ASP.NET Core `builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 10_485_760)`
- Store the absolute disk path in an `IConfiguration` key `Storage:UploadsBasePath`

### Done definition
- POST a JPEG to the endpoint, confirm file exists on disk and DB row inserted
- GET photos returns the just-uploaded file
- Thumbnail visible in the task detail within 2 seconds of upload
- Attempting to upload a PDF returns 400

### Claude Code prompt
```
Add photo upload to the tech task flow:

1. API: POST /api/tech/tasks/{id}/photos (multipart/form-data)
   - IFormFile file parameter
   - Validate: file.ContentType starts with "image/" else 400; file.Length <= 10MB else 413
   - Resolve uploads folder: IConfiguration["Storage:UploadsBasePath"] ?? Path.Combine(AppContext.BaseDirectory, "uploads")
   - Save path: {uploadsBase}/{taskId}/{Guid.NewGuid():N}_{file.FileName}
   - Directory.CreateDirectory(taskFolder) if needed
   - await file.CopyToAsync(stream) to write file
   - INSERT attachments: entity_type='JobTask', entity_id=taskId, category='PHOTO',
     file_name=originalFileName, content_type=file.ContentType, size_bytes=file.Length,
     blob_container='local', blob_path="{taskId}/{storedFileName}", uploaded_by=currentUserId
   - Return 201 with { AttachmentId, FileName, UploadedAt }
   - [Authorize]

2. API: GET /api/tech/tasks/{id}/photos
   - Query attachments WHERE entity_type='JobTask' AND entity_id=taskId AND category='PHOTO'
   - Returns PhotoDto[]: { Id, FileName, ContentType, SizeBytes, UploadedAt, Url: "/uploads/{blob_path}" }

3. Static file serving in Program.cs:
   app.UseStaticFiles(new StaticFileOptions {
     FileProvider = new PhysicalFileProvider(uploadsBasePath),
     RequestPath = "/uploads"
   });

4. appsettings.Development.json: add "Storage": { "UploadsBasePath": "uploads" }

5. Angular: update TechTaskDetailComponent
   - Section 5 — Photos: a grid of thumbnails, empty = "No photos yet"
   - "Add Photo" button: <label class="btn-secondary"><input type="file" accept="image/*" capture="environment" hidden (change)="uploadPhoto($event)">Add Photo</label>
   - uploadPhoto(event): get file, POST to /api/tech/tasks/{id}/photos with FormData
   - isUploading = signal(false) — show spinner on the label while uploading
   - On success: append new photo to local photos array (don't reload full page)
   - Thumbnail: <a [href]="'/uploads/' + photo.blobPath" target="_blank"><img [src]="..."></a>

6. Test: POST a valid image → 201, file exists on disk. POST a PDF → 400.

Schema: attachments (entity_type, entity_id, category, file_name, content_type, size_bytes,
blob_container, blob_path, uploaded_by, uploaded_at).
```

---

## Story E5-S5 — Mark complete + variance modal (M, 4h)

**As a technician**
**I want** to mark my task complete and, if I went over estimate, explain why
**So that** the system captures the variance reason for reporting

### Acceptance criteria
- `POST /api/tech/tasks/{id}/complete` with body `{ varianceReasonId: 11, notes: "..." }`:
  - Validates: task is assigned to current user, status IN ('IN_PROGRESS','PAUSED')
  - Closes any open `time_entries` (auto clock-out if still clocked in)
  - Recalculates `actual_hours` from all time entries
  - Inserts `variance_records`: `task_id`, `estimated_hours`, `actual_hours`, `delta_hours` (auto-generated), `reason_id`, `recorded_by = currentUser`
  - Sets `job_tasks.status = 'COMPLETED'`, `completed_at = now()`
  - Emits `domain_events`: `event_type='TaskCompleted'`, payload: `{ taskId, roId, actualHours, deltaHours, reasonId }`
  - Advances `ro_kanban_state.current_stage_id` if all tasks in the current stage are now COMPLETED (see technical context)
  - Returns `200` with `{ taskId, actualHours, deltaHours, reasonName }`
- `GET /api/variance-reasons` returns all active variance reasons (needed to populate the picker)
- Variance rule: if `actualHours > estimatedHours * 1.1` (10% over), the modal is mandatory before completing; otherwise a reason is optional but pre-populated with `11 (AS_ESTIMATED)`
- Angular: "Complete Task" button (only shown if not currently clocked in)
  - If variance check passes (< 10% over): direct API call with reason 11, show success toast
  - If > 10% over: open a bottom sheet modal with reason picker (dropdown from `GET /api/variance-reasons`) and optional notes field, then submit

### Technical context
- Kanban stage advance: the kanban stages are associated with `stations.sort_order` — when all tasks at the current station group complete, find the next station with incomplete tasks and update `ro_kanban_state.current_stage_id` to the matching `kanban_stages` row. Use a simplified mapping: station 10 → stage MAT_PROCESSING (30), station 20 → FABRICATION (40), station 30 → PAINTING (50), etc. This is a best-effort advance for v1 — a more sophisticated state machine is Phase 2.
- If `ro_kanban_state` has no row for this RO (it might not have been created on RO materialisation), insert one with `current_stage_id = JOB_RECEIVED (10)` before advancing
- `variance_records.delta_hours` and `delta_percent` are generated columns — do not insert them

### Done definition
- Complete a task with actual hours < 110% of estimate → auto-complete with reason 11, no modal
- Complete with > 110% → modal opens, pick "Missing parts", submit → variance record created
- Task disappears from tech task list (`GET /api/tech/tasks` no longer returns COMPLETED)
- `GET /api/kanban` shows task as COMPLETED (it's filtered out of the board — correct)
- `ro_kanban_state` updated if all tasks in that station are done
- Integration tests: happy path under/over threshold, kanban stage advance

### Claude Code prompt
```
Implement mark complete and variance capture:

1. API: GET /api/variance-reasons
   - Returns VarianceReasonDto[]: { Id, Code, Name, IsOverrun }
   - Filter is_active = true, ordered by id
   - [Authorize]

2. API: POST /api/tech/tasks/{id}/complete
   Body: CompleteTaskRequest { VarianceReasonId: short, Notes: string? }
   Steps:
   a. Load task, validate assigned_to_user_id == currentUser, status IN ('IN_PROGRESS','PAUSED')
   b. If open time entry exists (clock_out IS NULL): set clock_out = now()
   c. Recalculate actual_hours: SUM(duration_minutes)::numeric/60 from all entries for this task
   d. INSERT variance_records: { task_id, estimated_hours=task.estimated_hours, actual_hours,
        reason_id=req.VarianceReasonId, notes=req.Notes, recorded_by=currentUser }
   e. UPDATE job_tasks: status='COMPLETED', completed_at=now(), actual_hours (recalc)
   f. INSERT domain_events: event_type='TaskCompleted', aggregate_type='JobTask'
   g. Kanban stage advance: check if all job_tasks for the same ro_id WHERE station_id = task.station_id
      are now COMPLETED. If yes, find the next station (lowest sort_order > current station sort_order)
      that has non-COMPLETED tasks. Update ro_kanban_state to the matching kanban stage.
      If ro_kanban_state row doesn't exist, insert with stage JOB_RECEIVED first.
   - Return 200 with CompleteTaskResponse { TaskId, ActualHours, DeltaHours (actual-estimated), ReasonName }
   - [Authorize]

3. Angular: update TechTaskDetailComponent
   - "Complete Task" button: only shown when clockedInSince() === null and status != 'COMPLETED'
   - On click: check if task.actualHours > task.estimatedHours * 1.1
     - If no: call complete directly with reasonId=11 (AS_ESTIMATED)
     - If yes: open variance modal bottom sheet
   - Variance modal (VarianceModalComponent, standalone):
     Bottom sheet overlay (slides up from bottom, 60vh height)
     Heading: "Over estimate by {delta}h — please select a reason"
     Dropdown: all variance reasons from GET /api/variance-reasons (load on modal open)
     Text area: optional notes
     "Submit" button: calls POST .../complete, on success closes modal + shows "Task complete!" toast
     "Cancel" button: closes modal without completing

4. Tests:
   - POST .../complete with reason 11 → 200, task COMPLETED, variance_record inserted
   - POST .../complete while clocked in → auto clock-out, then complete
   - POST .../complete for task assigned to different user → 403
   - Kanban stage advance: complete all FAB_LINE tasks for an RO → ro_kanban_state updated

Schema: variance_records, variance_reasons, job_tasks, time_entries, domain_events,
ro_kanban_state, kanban_stages, stations.
```

---

## Story E5-S6 — Blocker reporting (S, 2h)

**As a technician**
**I want** to raise a blocker on my task when I can't proceed
**So that** the supervisor is alerted and the RO is moved to the hospital zone

### Acceptance criteria
- `POST /api/tech/tasks/{id}/block` with body `{ reason: "Missing chassis plates. Waiting on workshop." }`:
  - Closes any open time entry (auto clock-out)
  - Sets `job_tasks.status = 'BLOCKED'`
  - Sets `repair_orders.delivery_block_reason = 'TBA'` and `status = 'ON_HOLD'` on the parent RO
  - Updates `ro_kanban_state.current_stage_id` to `HOSPITAL (95)` kanban stage
  - Emits `domain_events`: `event_type='TaskBlocked'`, payload: `{ taskId, roId, reason, blockedByUserId }`
  - Returns `200` with `{ taskId, roNumber, blockedAt }`
  - Returns `403` if task not assigned to current user
- `POST /api/tech/tasks/{id}/unblock` (for supervisor use):
  - Sets `job_tasks.status = 'PAUSED'` (returns task to paused, not in-progress — tech must clock in again)
  - Clears `repair_orders.delivery_block_reason`, sets status back to `IN_PROGRESS`
  - Restores `ro_kanban_state.current_stage_id` to the stage the RO was in before hospital (store the previous stage in the block event payload)
  - Requires `SUPERVISOR` or `STATION_OWNER` role
  - Returns `200`
- Angular: a "Report Blocker" button on the task detail page
  - Opens a simple bottom sheet with a text area ("Describe the blocker")
  - Submit: POST .../block, show "Blocker reported. Supervisor has been notified." toast, navigate back to `/tech/tasks`
  - The task card on the task list gets a red "BLOCKED" pill and disappears from the active list on next refresh

### Technical context
- `delivery_block_reason` is a VARCHAR(40) with check constraint `IN ('TBA','NO_CHASSIS','BOOK_IN','EXTERNAL_BB', NULL)` — use 'TBA' for all tech-initiated blockers; the specific reason lives in the domain event payload
- Store the previous kanban stage ID in the `TaskBlocked` domain event payload so `unblock` can restore it
- `unblock` is supervisor-only; no UI for it in v1 — it's done via API or through a future supervisor action (Phase 2 supervision screen)

### Done definition
- Report a blocker on a task: task status = BLOCKED, RO status = ON_HOLD, kanban state = HOSPITAL
- Kanban board shows the RO's stage as "Hospital zone"
- E3 dashboard KPI `inHospitalCount` increments by 1
- Unblock via PUT (supervisor): task back to PAUSED, RO back to IN_PROGRESS, kanban restored
- Integration tests: block → verify three tables updated; unblock → verify restoration

### Claude Code prompt
```
Implement blocker reporting:

1. API: POST /api/tech/tasks/{id}/block
   Body: BlockTaskRequest { Reason: string (required, min 10 chars) }
   Steps:
   a. Load task, validate assigned_to_user_id == currentUser, status NOT IN ('COMPLETED','CANCELLED','BLOCKED')
   b. If open time entry: set clock_out = now(), recalc actual_hours
   c. Load current ro_kanban_state.current_stage_id (call it previousStageId)
   d. UPDATE job_tasks: status = 'BLOCKED'
   e. UPDATE repair_orders: delivery_block_reason = 'TBA', status = 'ON_HOLD'
   f. UPSERT ro_kanban_state: current_stage_id = 95 (HOSPITAL stage)
   g. INSERT domain_events: event_type='TaskBlocked', aggregate_type='JobTask',
      payload = { taskId, roId, reason, blockedByUserId, previousStageId }
   - Return 200 with { TaskId, RoNumber, BlockedAt }
   - [Authorize]

2. API: POST /api/tech/tasks/{id}/unblock
   Steps:
   a. Load task, validate status = 'BLOCKED'
   b. Read previousStageId from the most recent TaskBlocked domain event for this task
      (SELECT payload->>'previousStageId' FROM domain_events WHERE aggregate_type='JobTask'
       AND aggregate_id=taskId AND event_type='TaskBlocked' ORDER BY occurred_at DESC LIMIT 1)
   c. UPDATE job_tasks: status = 'PAUSED'
   d. UPDATE repair_orders: delivery_block_reason = NULL, status = 'IN_PROGRESS'
   e. UPDATE ro_kanban_state: current_stage_id = previousStageId (or JOB_RECEIVED if null)
   - Return 200
   - RequireRole("SUPERVISOR", "STATION_OWNER")

3. Angular: add to TechTaskDetailComponent
   - "Report Blocker" button: only shown when status IN ('ASSIGNED','IN_PROGRESS','PAUSED')
   - Opens BlockerModalComponent (bottom sheet): text area "Describe the blocker (required)"
   - Min 10 chars validation on textarea
   - On submit: POST .../block, on success show toast + navigate to /tech/tasks

4. Tests:
   - POST .../block: task BLOCKED, RO ON_HOLD, kanban HOSPITAL, domain event written
   - POST .../unblock (supervisor JWT): task PAUSED, RO IN_PROGRESS, kanban stage restored
   - POST .../block for already-blocked task: 400
   - POST .../unblock for SUPERVISOR role: 200; for TECHNICIAN role: 403

Schema: job_tasks (status), repair_orders (status, delivery_block_reason),
ro_kanban_state (current_stage_id), domain_events (payload as jsonb).
```

---

## Integration points

- **E4 → E5:** The assign endpoint from E4-S4 (`PUT /api/job-tasks/{id}/assign`) must have been executed before any task appears in `GET /api/tech/tasks`. Tasks go from PENDING → ASSIGNED when a station owner assigns them. E5-S3 (clock-in) then moves them to IN_PROGRESS.
- **E5 → E3:** Once technicians are clocking time, `time_entries.duration_minutes` accumulates and `job_tasks.actual_hours` updates on each clock-out. This feeds the station load bar heights in the E3 dashboard. The variance panel in E3 becomes meaningful only after E5-S5 creates `variance_records`.
- **E5 → E6:** The QC task (E6) is a specific `job_task` with `operation_id = 70 (BLUE_PLATE_QC)`. The tech phone view (E5) is re-used for the QC technician to clock in to it. E6 adds the overlay compliance checklist on top of the standard task detail.
- **E5 → E3:** Blocker reporting (E5-S6) increments the `inHospitalCount` KPI visible on the E3 dashboard. The E3 dashboard supervisor can then use the drill-through to see which RO is blocked and why (via the domain events log in the future, or the RO detail page for now).
