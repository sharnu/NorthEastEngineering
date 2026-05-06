# Epic E6 — QC + Email

> **Priority:** P0 · **Owner:** Dev B · **Days:** 8–9 · **Depends on:** E5 (tasks exist, photos upload, time entries) · **Total estimate:** 14 hours

The final gate before a job leaves the floor. A QC technician opens the special blue-plate task on their phone, works through a 6-item compliance checklist, reviews the photo evidence uploaded during fabrication and fitment, then hits "Pass & Send". The system marks the RO complete, sends a plain-text confirmation email to the customer's contact address via local SMTP (Mailpit in dev, swappable for real SMTP in production), and records the send as a domain event. Everything is the same phone layout as E5 — the QC task is a `job_tasks` row with `operation_id = 70 (BLUE_PLATE_QC)` that the E5 tech view already renders; this epic overlays the QC-specific checklist on top of that standard detail view.

---

## Story E6-S1 — QC checklist data model + API (S, 2h)

**As the system**
**I want** a way to record which compliance checklist items have been ticked for a QC task
**So that** the QC result is traceable and auditable

### Acceptance criteria
- New table `qc_checklist_items` seeded with the 6 standard NEE blue-plate items:
  ```
  1  DIMENSIONS_VERIFIED       Dimensions verified against drawing
  2  WELD_QUALITY_CHECKED      Weld quality inspected (no porosity, undercut, cracking)
  3  PAINT_FINISH_ACCEPTED     Paint finish — colour match, gloss, coverage
  4  ELECTRICAL_TESTED         Electrical systems tested (lights, hydraulics, ABS)
  5  PLACARDS_FITTED           Compliance placards fitted and legible
  6  PHOTOS_COMPLETE           Photo evidence complete and uploaded
  ```
- New table `qc_results` with columns: `id (uuid PK)`, `task_id (uuid FK job_tasks)`, `checklist_item_id (int FK)`, `passed (bool)`, `notes (text nullable)`, `recorded_by (uuid FK users)`, `recorded_at (timestamptz)`. Unique constraint on `(task_id, checklist_item_id)`.
- `GET /api/tech/tasks/{id}/qc` returns:
  ```json
  {
    "taskId": "...",
    "isQcTask": true,
    "items": [
      { "id": 1, "code": "DIMENSIONS_VERIFIED", "label": "Dimensions verified against drawing", "passed": null, "notes": null }
    ],
    "allPassed": false
  }
  ```
- `PUT /api/tech/tasks/{id}/qc/{itemId}` body `{ "passed": true, "notes": "..." }` upserts the result row. Returns 200 with the updated item.
- `isQcTask`: true when `job_tasks.operation_id = 70`
- Both endpoints require `[Authorize]` and 403 if task not assigned to current user

### Technical context
- Add `QcChecklistItem` and `QcResult` to `NeeDbContext` and `Production.cs`
- `qc_checklist_items`: static reference data, seed via a new migration `005_qc_checklist.sql`
- `allPassed`: true when all 6 items have `passed = true`
- The PUT uses `ExecuteSqlRawAsync` with `ON CONFLICT (task_id, checklist_item_id) DO UPDATE` for idempotency

### Done definition
- `GET /api/tech/tasks/{qcTaskId}/qc` returns 6 items, all `passed: null` initially
- `PUT .../qc/1` with `{ "passed": true }` → 200, subsequent GET shows `passed: true` for item 1
- Calling PUT twice with different values takes the latest (upsert works)
- 403 if called for a task assigned to a different user
- Integration test covers: initial state, single item update, all-passed state

### Claude Code prompt
```
Add QC checklist endpoints to the tech API:

1. Migration 005_qc_checklist.sql:
   CREATE TABLE qc_checklist_items (
     id SMALLINT PRIMARY KEY,
     code TEXT NOT NULL UNIQUE,
     label TEXT NOT NULL,
     sort_order SMALLINT NOT NULL DEFAULT 0
   );
   INSERT 6 rows (see acceptance criteria above).

   CREATE TABLE qc_results (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     task_id UUID NOT NULL REFERENCES job_tasks(id),
     checklist_item_id SMALLINT NOT NULL REFERENCES qc_checklist_items(id),
     passed BOOLEAN NOT NULL,
     notes TEXT,
     recorded_by UUID NOT NULL REFERENCES users(id),
     recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     UNIQUE (task_id, checklist_item_id)
   );

2. Domain/Production.cs: add QcChecklistItem and QcResult entity classes.
   NeeDbContext: add DbSet<QcChecklistItem> and DbSet<QcResult>.

3. TechEndpoints.cs — add to the tech group:

   GET /{id:guid}/qc
   - Load task, validate assigned_to_user_id == currentUser
   - Load all qc_checklist_items ordered by sort_order
   - Left-join qc_results for this task
   - Return { TaskId, IsQcTask (operation_id == 70), Items[], AllPassed }

   PUT /{id:guid}/qc/{itemId:int}
   Body: QcItemRequest { Passed: bool, Notes: string? }
   - Validate task ownership
   - UPSERT qc_results ON CONFLICT (task_id, checklist_item_id) DO UPDATE
   - Return the updated item

4. Tests (QcEndpointTests.cs or add to TechEndpointTests.cs):
   - GET returns 6 items all null
   - PUT item 1 → 200, GET confirms passed=true
   - PUT with new value updates (idempotent)
   - Wrong user → 403

Schema: qc_checklist_items, qc_results, job_tasks.
```

---

## Story E6-S2 — QC task detail component (M, 4h)

**As a QC technician**
**I want** the task detail view to show the compliance checklist when I open a blue-plate task
**So that** I can tick off each item before passing the job

### Acceptance criteria
- Route `/tech/tasks/:id` (same as E5-S2) — QC tasks use the identical route; the component detects `isQcTask` and renders the checklist section
- Below the Sessions section (E5-S2 section 4), a new **"Compliance Checklist"** section appears only when `isQcTask === true`
- Each checklist item renders as a row with: item label, a toggle (passed = green tick / failed = red cross / unticked = grey circle), and an optional notes text input
- Tapping the toggle calls `PUT .../qc/{itemId}` immediately (no save button — auto-saves per item)
- A progress bar shows `N of 6 items passed` — fills green as items are ticked
- The "Complete Task" button is replaced by a **"Pass & Send"** button when `isQcTask === true`
- "Pass & Send" is disabled until `allPassed === true`
- Tapping "Pass & Send" opens the E6-S4 email preview modal before submitting

### Technical context
- On component init, if `task.operationId === 70` (or detect via the `/qc` endpoint response), call `GET .../qc` and store results in a `qcItems` signal
- On toggle change: call `PUT .../qc/{itemId}`, update the `qcItems` signal optimistically, revert on error
- Progress bar: `checkedCount / totalCount * 100%`, same CSS bar component as the hours tracker

### Done definition
- Log in as Peter, open a BLUE_PLATE_QC task — checklist section visible with 6 unchecked items
- Tap each toggle: green tick appears, progress bar increments
- After all 6 ticked, "Pass & Send" button enables
- Opening a non-QC task: no checklist section visible, "Complete Task" button as normal

### Claude Code prompt
```
Update TechTaskDetailComponent to show QC checklist:

1. In TechService: add
   getQcChecklist(taskId: string): Observable<QcState>
   updateQcItem(taskId: string, itemId: number, passed: boolean, notes?: string): Observable<QcItemResult>

   Interfaces:
   QcItem { id: number; code: string; label: string; passed: boolean | null; notes: string | null }
   QcState { taskId: string; isQcTask: boolean; items: QcItem[]; allPassed: boolean }

2. TechTaskDetailComponent additions:
   - qcState = signal<QcState | null>(null)
   - In loadTask(): if task.operationId/stationName indicates QC, call getQcChecklist() and set qcState
   - Toggle handler: toggleQcItem(item: QcItem) — optimistic update, then PUT, revert on error

3. Template — insert after sessions section:
   @if (qcState()?.isQcTask) {
     <section class="card">
       <h3 class="section-title">Compliance Checklist</h3>
       <div class="qc-progress">
         <div class="progress-bar-bg">
           <div class="progress-bar-fill bar-green" [style.width]="qcProgressWidth()"></div>
         </div>
         <span class="qc-progress-label">{{ qcPassedCount() }} of {{ qcState()!.items.length }} passed</span>
       </div>
       @for (item of qcState()!.items; track item.id) {
         <div class="qc-item">
           <button class="qc-toggle" [class]="item.passed === true ? 'toggle-pass' : item.passed === false ? 'toggle-fail' : 'toggle-none'"
             (click)="toggleQcItem(item)">
             {{ item.passed === true ? '✓' : item.passed === false ? '✗' : '○' }}
           </button>
           <span class="qc-label">{{ item.label }}</span>
         </div>
       }
     </section>
   }

4. Action bar: replace "Complete Task" with "Pass & Send" when qcState()?.isQcTask:
   @if (qcState()?.isQcTask) {
     <button class="btn btn-complete" [disabled]="!qcState()?.allPassed" (click)="openEmailPreview()">Pass & Send</button>
   }

5. Styles: .qc-item (flex, gap 12px, border-bottom 0.5px var(--rule), padding 10px 0)
   .qc-toggle (32px circle, border-radius 50%, border none, font-size 16px, cursor pointer)
   .toggle-pass (background var(--good), color white)
   .toggle-fail (background var(--bad), color white)
   .toggle-none (background var(--paper-3), color var(--ink-3))
   .qc-label (font-size 13px, color var(--ink), flex 1)
   .qc-progress (display flex, align-items center, gap 10px, margin-bottom 12px)
   .qc-progress-label (font-family var(--mono), font-size 11px, color var(--ink-3), white-space nowrap)
```

---

## Story E6-S3 — Photo grid in QC view (S, 2h)

**As a QC technician**
**I want** to see all the photos uploaded during fabrication and fitment directly in the QC task view
**So that** I can review the evidence without leaving the app

### Acceptance criteria
- The Photos section (already in E5-S2) shows **all photos for the RO** when `isQcTask === true`, not just photos for this task
- For non-QC tasks: shows only photos for that task (existing E5 behaviour unchanged)
- For QC tasks: calls `GET /api/repair-orders/{roId}/photos` which returns photos across all tasks for the RO, grouped by task (task name as group header)
- `GET /api/repair-orders/{roId}/photos` returns:
  ```json
  [
    {
      "taskId": "...",
      "operationName": "Fabrication line assembly",
      "photos": [
        { "id": "...", "url": "/uploads/...", "fileName": "...", "uploadedAt": "..." }
      ]
    }
  ]
  ```
- Thumbnail grid: same 3-column grid as E5, with a small task-name label above each group
- Empty group: groups with 0 photos are omitted
- "BLUE PLATE QC" item 6 (`PHOTOS_COMPLETE`) auto-ticks when at least 1 photo exists for the RO

### Technical context
- New endpoint on `RepairOrderEndpoints.cs` (or a new `QcEndpoints.cs`): `GET /api/repair-orders/{roId}/photos`
- Query: `attachments WHERE entity_type='JobTask' AND entity_id IN (SELECT id FROM job_tasks WHERE ro_id = roId) AND category='PHOTO'` — join to `job_tasks` for the operation name
- The auto-tick for item 6: after loading photos in QC mode, if `photos.length > 0` and item 6 is not yet passed, call `PUT .../qc/6` with `{ passed: true, notes: "Auto-verified: photos present" }`

### Done definition
- Upload a photo to a fab task, then open the QC task for the same RO — photo appears in the QC view grouped under the fab task name
- Item 6 auto-ticks when photos are present
- Non-QC task detail shows only that task's own photos (regression check)

### Claude Code prompt
```
Add RO-level photo endpoint and wire it into the QC view:

1. API: GET /api/repair-orders/{id}/photos
   Add to RepairOrderEndpoints.cs (or new QcEndpoints.cs):
   - Query attachments JOIN job_tasks ON entity_id = job_tasks.id
   - WHERE entity_type = 'JobTask' AND job_tasks.ro_id = roId AND category = 'PHOTO'
   - Group by task_id, return RoPhotoGroup[]: { TaskId, OperationName, Photos: PhotoDto[] }
   - [Authorize]

2. TechService: add
   getRoPhotos(roId: string): Observable<RoPhotoGroup[]>
   interface RoPhotoGroup { taskId: string; operationName: string; photos: PhotoItem[] }

3. TechTaskDetailComponent:
   - roPhotos = signal<RoPhotoGroup[]>([])
   - In loadTask(): if qcState()?.isQcTask, call getRoPhotos(task.roId) and set roPhotos
   - Replace photo section when isQcTask:
     @if (qcState()?.isQcTask) {
       @for (group of roPhotos(); track group.taskId) {
         @if (group.photos.length > 0) {
           <h4 class="photo-group-label">{{ group.operationName }}</h4>
           <div class="photo-grid">
             @for (p of group.photos; track p.id) {
               <a [href]="p.url" target="_blank"><img [src]="p.url" class="photo-thumb" /></a>
             }
           </div>
         }
       }
     }
   - Auto-tick logic: after setting roPhotos, if total photos > 0, find qcItem id=6, if not passed call updateQcItem(taskId, 6, true, 'Auto-verified: photos present')

4. Style: .photo-group-label (font-family var(--mono), font-size 10px, text-transform uppercase,
   letter-spacing 0.08em, color var(--ink-3), margin: 10px 0 6px)

Schema: attachments, job_tasks, repair_orders.
```

---

## Story E6-S4 — Email preview modal + composer (M, 4h)

**As a QC technician**
**I want** to preview the customer email before sending
**So that** I can verify the content is correct before it goes out

### Acceptance criteria
- `GET /api/repair-orders/{roId}/email-preview` returns the pre-composed email:
  ```json
  {
    "to": "ops@directfreight.com.au",
    "cc": [],
    "subject": "RO00001 — Tipper 4.2m NPR complete for Direct Freight Express",
    "body": "Dear Direct Freight Express,\n\nYour Isuzu NPR 75-190 (1AJ-213) has completed final QC and is ready for collection.\n\nRepair Order: RO00001\nRequired Date: 01 Aug 2026\nTotal Hours: 53.5h\n\nPlease contact us to arrange pickup.\n\nRegards,\nNEE Production\n"
  }
  ```
- Email preview modal: bottom sheet (same pattern as variance/blocker modals in E5) slides up when "Pass & Send" is tapped
- Modal shows: To, Subject, scrollable body text in a read-only `<pre>` block
- Two buttons: "Cancel" (close modal, task not completed) and "Send & Complete" (calls E6-S5)
- "Send & Complete" shows a spinner while the API call is in flight

### Technical context
- `to` address: `customers.contact_email` — add this column to customers if not present (check schema: the `001_initial_schema.sql` includes `contact_email TEXT`)
- Subject template: `"{roNumber} — {templateName} complete for {customerName}"`
- Body template: hard-coded in C# using string interpolation from the RO fields; no templating engine needed for v1
- The modal is a new `EmailPreviewModalComponent` (standalone), same structure as `VarianceModalComponent`

### Done definition
- Tap "Pass & Send" on a QC task with all items ticked → email preview modal opens
- Modal shows correct To address (from customer seed data), correct subject, body with RO details
- Cancel closes without sending
- "Send & Complete" triggers the API (E6-S5 wires the actual send)

### Claude Code prompt
```
Add email preview endpoint and modal:

1. API: GET /api/repair-orders/{id}/email-preview
   Add to RepairOrderEndpoints.cs:
   - Load RO with customer, template (job_code_template via template_version via job_tasks)
   - Compose email fields:
     To: ro.Customer.ContactEmail ?? "noreply@nee.local"
     Subject: $"{ro.RoNumber} — {templateName} complete for {ro.Customer.Name}"
     Body: multi-line string with RO number, rego, make/model, required date, total hours, collection message
   - Return EmailPreviewDto { To, Cc (empty list), Subject, Body }
   - [Authorize]

2. Angular: EmailPreviewModalComponent
   File: web/src/app/tech/email-preview-modal.component.ts
   Inputs: @Input() roId: string; @Input() taskId: string
   Outputs: @Output() confirmed = new EventEmitter<void>(); @Output() cancel = new EventEmitter<void>()
   - On init: call GET /api/repair-orders/{roId}/email-preview, store in emailPreview signal
   - Template: bottom sheet overlay (same .overlay + .sheet CSS as variance-modal)
     Heading: "Email Preview"
     Fields: To (read-only input), Subject (read-only input), Body (<pre class="email-body">)
     Buttons: Cancel (secondary), Send & Complete (accent, shows spinner while sending)
   - On "Send & Complete": emit confirmed event (parent calls the send+complete API)

3. TechTaskDetailComponent:
   - Add showEmailModal = signal(false)
   - openEmailPreview(): set showEmailModal(true)
   - In template: @if (showEmailModal()) { <app-email-preview-modal [roId]="..." [taskId]="..." (confirmed)="submitQcComplete()" (cancel)="showEmailModal.set(false)" /> }

4. Style .email-body: font-family var(--mono), font-size 12px, background var(--paper),
   border: 0.5px solid var(--rule), border-radius 6px, padding 12px, white-space pre-wrap,
   overflow-y auto, max-height 200px, color var(--ink)

Schema: repair_orders, customers (contact_email), job_code_templates.
```

---

## Story E6-S5 — SMTP send + Mailpit + complete RO (M, 2h)

**As the system**
**I want** to send the customer email and mark the RO complete when QC passes
**So that** the job is officially closed and the customer is notified automatically

### Acceptance criteria
- `POST /api/repair-orders/{roId}/qc-complete` with body `{ taskId }`:
  - Validates: task is a QC task (operation_id = 70), assigned to current user, all 6 checklist items passed
  - Calls `POST /api/tech/tasks/{taskId}/complete` logic internally (or inline) with `varianceReasonId = 11`
  - Composes the email (same as the preview) and sends via SMTP to `localhost:1025` (Mailpit)
  - If SMTP send fails, logs the error but still completes the task (email failure is non-blocking)
  - Sets `repair_orders.status = 'COMPLETED'`
  - Inserts `domain_events` row: `event_type='RoCompleted'`, payload: `{ roId, roNumber, customerEmail, sentAt }`
  - Returns 200 with `{ roId, roNumber, emailSent: true/false }`
- `docker-compose.yml` updated to add Mailpit service (port 1025 SMTP, 8025 web UI)
- `appsettings.Development.json` updated with `"Smtp": { "Host": "localhost", "Port": 1025, "From": "production@nee.local" }`
- Sent emails visible in Mailpit at `http://localhost:8025`

### Technical context
- SMTP via `System.Net.Mail.SmtpClient` (built-in, no extra package) or `MailKit` (more robust — prefer MailKit for v1)
- NuGet: `MailKit` + `MimeKit`
- Register `IEmailService` (interface) with `SmtpEmailService` (implementation) in `Program.cs` as a singleton
- The `SmtpClient` in MailKit: `new SmtpClient(); await client.ConnectAsync(host, port, SecureSocketOptions.None)`
- Mailpit container: `axllent/mailpit:latest`, ports `1025:1025` and `8025:8025`

### Done definition
- Tick all 6 checklist items, tap "Pass & Send", tap "Send & Complete" in the modal
- `GET /api/repair-orders/{roId}` returns status `COMPLETED`
- `http://localhost:8025` shows the sent email with correct To, Subject, and body
- If Mailpit is stopped, the API still returns 200 (email failure is non-blocking)
- Integration test: POST qc-complete → 200, RO status COMPLETED, domain event written

### Claude Code prompt
```
Implement SMTP email send and QC-complete flow:

1. docker-compose.yml: add Mailpit service
   mailpit:
     image: axllent/mailpit:latest
     ports:
       - "1025:1025"
       - "8025:8025"

2. appsettings.Development.json: add "Smtp": { "Host": "localhost", "Port": 1025, "From": "production@nee.local" }

3. IEmailService interface + SmtpEmailService implementation:
   - IEmailService: Task SendAsync(string to, string subject, string body, CancellationToken ct)
   - SmtpEmailService: uses MailKit SmtpClient, reads config from IConfiguration
   - Register as singleton in Program.cs: builder.Services.AddSingleton<IEmailService, SmtpEmailService>()

4. API: POST /api/repair-orders/{id}/qc-complete
   Body: QcCompleteRequest { TaskId: Guid }
   Steps:
   a. Load task, validate operation_id == 70, assigned_to_user_id == currentUser
   b. Check all 6 qc_results for this task have passed = true; if not, return 400 "Not all checklist items passed"
   c. Close any open time entry (same pattern as E5 complete endpoint)
   d. Recalculate actual_hours from time entries
   e. INSERT variance_records (reasonId=11, AS_ESTIMATED)
   f. UPDATE job_tasks: status='COMPLETED', completed_at=now()
   g. UPDATE repair_orders: status='COMPLETED'
   h. INSERT domain_events: event_type='RoCompleted', payload={roId, roNumber, sentAt}
   i. Compose email (same logic as email-preview), call emailService.SendAsync — catch exception, log, continue
   j. Return 200 { RoId, RoNumber, EmailSent: true/false }
   [Authorize]

5. Angular: in TechTaskDetailComponent.submitQcComplete():
   Call POST /api/repair-orders/{roId}/qc-complete, on success show "Job complete — email sent" toast, navigate to /tech/tasks

6. Integration test (QcEndpointTests.cs):
   - Create RO, get QC task, assign to Peter
   - PUT all 6 checklist items passed=true
   - POST qc-complete → 200
   - Verify job_tasks status COMPLETED, repair_orders status COMPLETED
   - domain_events contains RoCompleted event

NuGet: MailKit, MimeKit
Schema: qc_results, qc_checklist_items, job_tasks, repair_orders, variance_records, domain_events.
```
