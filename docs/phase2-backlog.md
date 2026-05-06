# NEE Production Platform — Phase 2 Backlog

> **For:** Local-only Phase 2 build on top of the shipped MVP (E1–E10), 2 developers, 2 weeks
> **Schema reference:** `/db/migrations/` (12 migrations · ~25 tables)
> **This document:** Epic-level overview for the 10 Phase 2 capabilities, plus full story detail for the first two epics (E11, E12). Subsequent epics get full detail at the start of their day.

---

## Where Phase 1 left off

The MVP is functionally complete:

- **Sales** can upload a PDF, the parser pulls customer / rego / chassis / source RO fields, and a template materialises a full RO with 12+ tasks in one click.
- **Supervisors** schedule ROs once three readiness gates clear (drafting · customer approval · chassis allocation) and watch a 4-week capacity heatmap.
- **Technicians** clock in/out from a mobile-styled task list, attach photos, report blockers, mark tasks complete and pick a variance reason.
- **QC** runs a 6-item checklist and sends a customer email through Mailpit.
- **Supervisors** see a live dashboard with KPIs, station load, top-variance and an active-ROs table; the Reports tab has Throughput and Template Calibration.
- **26 seeded accounts** cover all 10 production stations with owners, leads and second technicians.

Phase 2 closes the gaps that prevent moving the system from "compelling demo" to "real workshop floor": admin tools, the drafter workflow (currently DB-only), the ability to correct mistakes on an existing RO, the audit trail, and three reports that were stubbed as "coming soon" in the demo. **Cloud / Azure deployment remains out of scope** — that's a Phase 3 problem.

---

## How to use this document

Same conventions as Phase 1 (`docs/backlog.md`). Each story is structured to be directly usable as a Claude Code kickoff prompt — schema is real, columns are real, patterns are consistent with the shipped code.

**Story sizing:**
- **S** = Small, ~2 hours, tricky logic that needs review-then-iterate
- **M** = Medium, ~4 hours, mostly boilerplate Claude Code can lead on
- **L** = Large, ~6+ hours, split if it grows

**Priority:**
- **P0** = Must-ship to cover the workshop's day-1 production needs
- **P1** = Stretch, attempted only if P0 is on track by day 7
- **P2** = Polish, drop without remorse if days 9–10 are tight

---

## The 10 Phase 2 capabilities, sequenced by dependency

| # | Epic | Priority | Owner | Dependencies | Stories |
|---|---|---|---|---|---|
| E11 | Admin: User & role management UI | **P0** | Both pair day 0–1 | E1 | 5 |
| E12 | Drafter workflow UI | **P0** | Dev B | E2, E10 | 5 |
| E13 | Customer & vehicle management UI | **P0** | Dev B | E2 | 4 |
| E14 | RO editing & lifecycle controls | **P0** | Dev B | E2, E4, E5 | 5 |
| E15 | Audit log + RO timeline view | **P0** | Dev A | E1 (domain_events) | 4 |
| E16 | Drag-and-drop kanban | **P1** | Dev A | E4 | 3 |
| E17 | Reports: Variance Root Cause | **P1** | Dev A | E8 | 3 |
| E18 | Reports: Customer Concentration | **P1** | Dev A | E8 | 3 |
| E19 | Mobile PWA for technicians | **P1 stretch** | Dev B | E5 | 4 |
| E20 | Reports: Strategic Forecasting | **P2** | Dev A | E8, E10 | 4 |

**Total: ~40 stories.** Two devs × 10 days × ~2 stories/day each, leaving slack for the inevitable "this is harder than it looked" days. The stretch epics (E19, E20) are explicit insurance — drop them if days 8–9 are tight.

---

## Work split between two developers

**Dev A — back-office & analytics:** Admin UI (paired day 0), audit log, drag-drop kanban, the three new reports.
**Dev B — floor & customer-facing:** Drafter workflow, customer/vehicle management, RO editing, mobile PWA.

Day 0 they pair on **E11** because user management touches auth and role guards used by every screen. After that they work independently with two integration points worth flagging up front:

- **E12 ↔ E10:** The drafter UI sets `repair_orders.drafting_status = 'COMPLETED'`, which immediately turns the supervisor's Draft gate green. Verify with a manual end-to-end after E12-S4.
- **E14 ↔ E15:** Every RO edit must emit a `domain_events` row so the audit log shows who changed what. Define the event payload shapes in the morning of day 4 before either dev codes against them.

---

## Daily rhythm

Same as Phase 1: morning planning paragraph, mid-day execution, end-of-day merge to `main` and demo to your pair.

---

# Epic E11 — Admin: User & role management

> **Priority:** P0 · **Owner:** Both (pair day 0) → Dev A · **Days:** 0–2 · **Total estimate:** 14 hours

The system has 26 seeded accounts but no UI for adding the 27th. Currently onboarding a new technician requires running SQL via `docker exec`. This epic delivers the admin screens needed for routine onboarding, offboarding, role changes and station-roster edits — the bare minimum to hand the system to a workshop manager and not get a phone call on day 2.

## Story E11-S1 — Admin endpoints scaffold + role guard (S, 2h)

**As an admin**
**I want** authenticated admin-only endpoints for managing users
**So that** the admin UI has a backend to call

### Acceptance criteria
- New endpoint group `/api/admin` in a new file `api/Endpoints/AdminEndpoints.cs`, registered in `Program.cs` via `app.MapAdminEndpoints()`
- All endpoints under `/api/admin/*` require role `ADMIN`
- An `adminGuard` Angular `CanActivateFn` redirects to `/dashboard` with a flash message if the user is not an ADMIN
- A new admin tab appears in the dashboard tab bar (alongside Overview / Reports / Scheduling) and is hidden for non-admins
- Seed migration `013_admin_role.sql` grants the ADMIN role to the existing `supervisor` user (Dwayne Fender) so there is at least one admin in dev

### Done definition
- `GET /api/admin/ping` returns 200 for ADMIN, 403 for SUPERVISOR or TECHNICIAN
- The Admin tab is visible to `supervisor` and hidden to `peter`
- `dotnet test` and `npx ng test --watch=false` both green

### Claude Code prompt
```
Create the admin endpoint scaffold and Angular guard:

1. Migration db/migrations/013_admin_role.sql:
   - INSERT INTO user_roles (user_id, role_id) VALUES ('33333333-3333-3333-3333-333333333333', 1) ON CONFLICT DO NOTHING.
   - Idempotent.

2. api/Endpoints/AdminEndpoints.cs with MapAdminEndpoints extension:
   - var admin = app.MapGroup("/api/admin")
       .RequireAuthorization(p => p.RequireRole("ADMIN"))
       .WithTags("Admin");
   - GET /ping → Results.Ok(new { ok = true });

3. Register in Program.cs alongside the other Map*Endpoints calls.

4. Web: web/src/app/core/admin.guard.ts (CanActivateFn) — read AuthService.currentUser, return true if roles includes 'ADMIN', else router.createUrlTree(['/dashboard']).

5. dashboard.component.ts: add 'admin' to the activeTab signal type, add an Admin tab button shown only when isAdmin = computed(() => auth.currentUser()?.roles.includes('ADMIN')).

6. Tests:
   - api.tests/AdminEndpointTests.cs: Ping_AdminRole_Returns200, Ping_SupervisorRole_Returns403, Ping_NoAuth_Returns401.
   - web/src/app/core/admin.guard.spec.ts: returns true for admin, false for non-admin.
```

---

## Story E11-S2 — List & search users (M, 4h)

**As an admin**
**I want** to see a paginated list of all users with their roles and station rosters
**So that** I have an at-a-glance picture of the workshop population

### Acceptance criteria
- `GET /api/admin/users?q=&role=&active=` returns paginated `UserSummary[]` with `{ id, username, fullName, email, shortCode, isActive, roles, stations }` where `stations` is an array of `{ id, name, isPrimary }` from `station_technicians`
- `q` does ILIKE on `username`, `full_name`, and `email`
- `role` filters by role code (e.g. `TECHNICIAN`)
- `active` filters by `is_active`
- Default page size 50, sortable by `fullName` or `lastLoginAt`
- Angular admin page at `/admin/users`:
  - Search input (debounced 200ms) and three filter dropdowns (Role · Active/Inactive/All · Station)
  - Table with columns: Full name (linked), Username, Roles (pill list), Stations (pill list), Last login, Status
  - Empty-state message when filters return zero rows
  - Auto-refreshes after edits in subsequent stories (use a `refreshTrigger` signal)

### Done definition
- Loading `/admin/users` shows all 26 seeded users
- Searching "tech" filters to users whose role or name matches
- Filtering by station 90 shows greg + lisa
- Inactive filter shows zero rows (none seeded inactive)

### Claude Code prompt
```
Implement the admin user list:

1. AdminEndpoints.cs: GET /api/admin/users with query params q (string?), role (string?), active (bool?), page (int? default 1), pageSize (int? default 50). Return shape:
   { items: UserSummary[], totalCount: int, page: int, pageSize: int }
   UserSummary projection joins users → user_roles → roles, plus station_technicians → stations. Use EF Core Select projections — no over-fetch.

2. web/src/app/admin/users-list.component.ts (standalone):
   - signal-based state: users(), loading(), error()
   - Filters: searchQuery (signal), roleFilter, activeFilter, stationFilter
   - effect() that re-fetches when any filter changes
   - Table layout matching dashboard's existing table classes (.kanban-row, .pill, etc. — copy from supervisor dashboard)
   - Each row's Full name links to /admin/users/{id} (E11-S3)

3. Route /admin (children: /admin/users) protected by authGuard + adminGuard.

4. Tests: api.tests/AdminEndpointTests.cs::ListUsers_Search_FiltersByName, ListUsers_RoleFilter, ListUsers_StationFilter.
```

---

## Story E11-S3 — Create / edit user form + password reset (M, 4h)

**As an admin**
**I want** to create new users and edit existing ones, including password resets
**So that** routine onboarding/offboarding doesn't require dev help

### Acceptance criteria
- `POST /api/admin/users` creates a new user with `{ username, email, fullName, shortCode, roles: string[], password }`
- `PUT /api/admin/users/{id}` edits everything except username (immutable after creation)
- `POST /api/admin/users/{id}/reset-password` sets a new password (uses `IPasswordHasher<User>` from existing dev endpoint)
- `POST /api/admin/users/{id}/deactivate` and `/activate` toggle `is_active`
- The API rejects deactivating the last ADMIN (returns 422)
- Angular `/admin/users/new` and `/admin/users/{id}` use a single shared form component:
  - Required fields: username (alphanumeric + underscores, 3–32 chars, unique), email, fullName, shortCode (2–4 chars), at least one role
  - Optional: stations (multi-select with primary toggle)
  - Password field shown on create only; on edit there's a separate "Reset password" button
- All admin actions emit a `domain_events` row (`UserCreated`, `UserUpdated`, `UserDeactivated`, `PasswordReset`)

### Done definition
- Create a new technician via UI, log in as them with the new password
- Edit their full name, see the change reflected in the Active ROs dashboard
- Deactivate them, attempting to log in returns 401
- Try to deactivate the last admin — server returns 422 with a clear message

### Claude Code prompt
```
Build the admin user create/edit form:

1. AdminEndpoints.cs:
   - POST /api/admin/users → CreateUser(CreateUserRequest req). Validate username regex/length, email format, roles exist. Hash password with IPasswordHasher<User>. Insert user + user_roles + station_technicians in a transaction. Emit UserCreated domain event.
   - PUT /api/admin/users/{id} → similar, but skip password and username updates.
   - POST /api/admin/users/{id}/reset-password → { password: string }; rehash; emit PasswordReset event.
   - POST /api/admin/users/{id}/deactivate → if user is the only ADMIN, return Results.UnprocessableEntity(new { message = "Cannot deactivate the last admin." }). Else SET is_active = false.
   - POST /api/admin/users/{id}/activate → SET is_active = true.

2. web/src/app/admin/user-form.component.ts:
   - Reactive form with all fields
   - Used by both /admin/users/new (create mode) and /admin/users/:id (edit mode, prefilled)
   - Reset Password is a small button next to the password field on edit; opens a modal with one input + confirm

3. Tests:
   - api.tests/AdminEndpointTests.cs::CreateUser_HappyPath, DeactivateLastAdmin_Returns422, ResetPassword_AllowsLogin
   - DomainEventsTests.cs::UserCreated_EventEmitted_WithCorrectPayload
```

---

## Story E11-S4 — Station roster management (S, 2h)

**As an admin**
**I want** to add/remove technicians from stations and toggle the primary lead flag
**So that** roster changes don't require touching the DB

### Acceptance criteria
- `POST /api/admin/stations/{stationId}/technicians` with `{ userId, isPrimary }` upserts into `station_technicians`
- `DELETE /api/admin/stations/{stationId}/technicians/{userId}` removes the row
- `PUT /api/admin/stations/{stationId}/owner` with `{ userId | null }` sets `stations.owner_user_id`
- Angular `/admin/stations` lists all stations with their owner and roster; clicking a station opens an inline editor with: owner dropdown, technician multi-select, primary toggles
- Station 95 (HOSPITAL) is hidden from this UI — it has no roster

### Done definition
- Move `kane` from station 30 to station 25 via UI; see the change reflected in the kanban "Assign tech" dropdown
- Add a brand-new technician (created in E11-S3) to station 60; verify they can clock in to a station-60 task

### Claude Code prompt
```
Add station roster management:

1. AdminEndpoints.cs: three endpoints as specified above. All require ADMIN. All emit station-roster domain events (StationOwnerChanged, TechnicianRostered, TechnicianUnrostered).

2. /admin/stations component:
   - Card list of stations (station 95 filtered out)
   - Each card shows: station name, owner badge, technician chips with X buttons
   - Click "Edit" → expand inline form with owner dropdown + tech multi-select. Save commits all three endpoint calls in sequence.

3. Tests: AdminStationEndpointTests::AddTechnician, RemoveTechnician, ChangeOwner.
```

---

## Story E11-S5 — User detail timeline + Playwright E2E (S, 2h)

**As an admin**
**I want** to see a user's recent activity (logins, completed tasks, RO authorships) on their detail page
**So that** I can audit "what was Peter doing last Tuesday?" without SQL

### Acceptance criteria
- `GET /api/admin/users/{id}/activity?days=30` returns the last N days of `domain_events` where `user_id = userId`, plus aggregate counts: `tasksCompleted`, `rosCreated`, `lastLoginAt`
- `/admin/users/{id}` shows the form (E11-S3) plus a right column with a vertical timeline of events
- Playwright E2E `web/e2e/admin-user-flow.spec.ts` walks: log in as `supervisor`, visit `/admin/users`, create a new user `playwright_tech`, log out, log in as `playwright_tech`, observe empty task list

### Done definition
- User detail page renders timeline with at least one event for any user who has clocked in
- Playwright spec passes from a clean seed

### Claude Code prompt
```
Final E11 polish:

1. GET /api/admin/users/{id}/activity?days=30:
   - SELECT * FROM domain_events WHERE user_id = ? AND occurred_at > NOW() - days::interval ORDER BY occurred_at DESC LIMIT 200
   - Aggregate counts via separate count queries (or one query with grouping by event_type)
   - Return { events: [{ id, eventType, occurredAt, payload }], counts: { tasksCompleted, rosCreated, lastLoginAt } }

2. Add right column to user-form.component.ts (only shown in edit mode): vertical timeline using the existing toast/notification CSS as inspiration. Each event row: icon by type, time relative ("3h ago"), one-line summary built from event_type + payload.

3. web/e2e/admin-user-flow.spec.ts: full E2E as described.

4. Verify make test still passes 100%.
```

---

# Epic E12 — Drafter workflow UI

> **Priority:** P0 · **Owner:** Dev B · **Days:** 1–4 · **Total estimate:** 16 hours

The drafter role exists in `roles` and one user (`drafter` / Hai Nguyen) has it, but there is currently no drafter UI at all. Drafting status is set via raw SQL — which means in the demo a supervisor can't truly say "drafting is done" without dev help. This epic builds the drafter's home: a list of ROs awaiting drawing, a per-RO upload area for layouts/BOMs, and a "Mark drafting complete" button that opens up the scheduling gate.

## Story E12-S1 — Schema additions + drafter API endpoints (M, 4h)

**As the system**
**I want** a clean data model for drafter artefacts (layouts, BOMs, drawings)
**So that** the drafter UI has structure to render

### Acceptance criteria
- Migration `014_drafter_artefacts.sql`:
  - Reuses existing `attachments` table; defines new categories: `DRAFT_LAYOUT`, `DRAFT_BOM`, `DRAFT_DRAWING_PACK`
  - Adds optional column `repair_orders.drafted_by` (FK to users) and `drafted_at` (timestamptz)
  - Adds CHECK constraint that `drafting_status` is one of `NOT_STARTED · IN_PROGRESS · COMPLETED · ON_HOLD` (already partially in 011; reconcile)
- New endpoint group `api/Endpoints/DrafterEndpoints.cs`:
  - `GET /api/drafter/queue` — ROs where `drafting_status IN ('NOT_STARTED','IN_PROGRESS')`, ordered by priority then required_date
  - `GET /api/drafter/ros/{roId}` — full RO + drafting artefacts grouped by category
  - `PUT /api/drafter/ros/{roId}/status` — `{ status, notes? }`; validates state transitions; emits `DraftingStatusChanged` event
  - `POST /api/drafter/ros/{roId}/artefacts` — multipart upload, accepts category + file; reuses existing photo upload pattern
- All endpoints require role `DRAFTER` (or `ADMIN`)

### Done definition
- All 4 endpoints work via Swagger
- Status transition rules: `NOT_STARTED → IN_PROGRESS → COMPLETED` allowed; backwards transitions blocked except `IN_PROGRESS → ON_HOLD → IN_PROGRESS`
- Integration tests cover happy path + invalid transition

---

## Story E12-S2 — Drafter dashboard with queue + filters (M, 4h)

**As a drafter**
**I want** to land on a queue of my pending work
**So that** I can pick the next RO to start

### Acceptance criteria
- Route `/drafter` (and `/drafter/queue`) protected by `roleGuard(['DRAFTER','ADMIN'])`
- Header shows the drafter's name + a counter "X ROs awaiting drafting"
- Queue table columns: RO number (linked), Customer, Template, Status, Priority, Required date, Days until required (red if < 7)
- Filter chips: All · Not started · In progress · On hold
- Status pill colours match the existing supervisor dashboard
- Clicking an RO navigates to `/drafter/ros/{id}`

---

## Story E12-S3 — RO drafting page: artefact upload + layout review (M, 4h)

**As a drafter**
**I want** to upload layouts/BOMs/drawings and see what's already been uploaded
**So that** the customer drawing approval gate has all the right files

### Acceptance criteria
- `/drafter/ros/{id}` shows three sections:
  1. **RO summary** — read-only from the existing `GET /api/repair-orders/{id}` (vehicle, customer, source RO, tasks list)
  2. **Drafting artefacts** — three category panels (Layout · BOM · Drawing pack), each with a drop-zone and a list of uploaded files with thumbnail/icon, uploader name, timestamp, and delete button
  3. **Status panel** — current drafting status pill, transition buttons (Start drafting / Mark complete / Put on hold)
- Drop-zone reuses the same UX as the existing PDF upload (E9) — drag & drop or click to browse
- File preview: PDFs render inline (iframe), other files show as icon + filename
- Deleting an artefact requires confirmation and emits `DraftingArtefactDeleted` event

---

## Story E12-S4 — Mark drafting complete + supervisor handoff (S, 2h)

**As a drafter**
**I want** a single button that marks drafting complete and notifies the supervisor
**So that** the scheduling gate flips green immediately

### Acceptance criteria
- "Mark drafting complete" button is disabled if zero artefacts uploaded (configurable rule)
- On click: opens a modal asking for handoff notes (optional) + confirmation
- API call sets `drafting_status = 'COMPLETED'`, `drafted_by`, `drafted_at`, emits `DraftingStatusChanged` event
- A notification fires to all SUPERVISORs with the message "Drafting complete on RO {roNumber} — ready to schedule"
- The Supervisor's scheduling backlog (E10) shows the Draft gate green within 30s (existing polling refresh)

---

## Story E12-S5 — Drafter Playwright E2E + tests (S, 2h)

**As the team**
**I want** an automated test that walks log-in-as-drafter → upload layout → mark complete → verify supervisor sees it
**So that** regressions are caught immediately

### Acceptance criteria
- Playwright spec in `web/e2e/drafter-handoff.spec.ts`
- Walks: login as `drafter`, pick the first NOT_STARTED RO, upload a sample PDF (use a fixture file in `web/e2e/fixtures/`), mark complete, log out, log in as `supervisor`, navigate to Scheduling, verify Draft gate is green for that RO
- API integration test for the full state machine (NOT_STARTED → IN_PROGRESS → COMPLETED)

---

# Epic E13 — Customer & vehicle management UI

> **Priority:** P0 · **Owner:** Dev B · **Days:** 4–5 · **Total estimate:** 12 hours

A workshop adds new customers and registers new vehicles every week. Currently the only way is via SQL or as a side-effect of uploading a sales PDF (which auto-creates a `customers` row from the parsed prefix). This epic delivers proper CRUD: a searchable customer list, a create/edit form with email distribution lists, a per-customer detail page with RO history, and a derived vehicle catalogue scraped from past ROs.

## Story E13-S1 — Customer admin endpoints + list UI (M, 4h)

**As an admin or sales user**
**I want** a paginated, searchable list of all customers with their RO activity
**So that** I can find any customer in two clicks instead of running SQL

### Acceptance criteria
- `GET /api/admin/customers?q=&active=&page=&pageSize=` returns `{ items: CustomerSummary[], totalCount, page, pageSize }`
- `CustomerSummary` shape: `{ id, code, name, customerNo, abn, contactEmail, contactPhone, isActive, activeRoCount, lastRoDate }` — `activeRoCount` counts `repair_orders` where `status NOT IN ('COMPLETED','CANCELLED')`, `lastRoDate` is `MAX(ro_date)`
- `q` does ILIKE on `name`, `code`, `customer_no`, `contact_email`; `active` filters `is_active`
- The existing `GET /api/customers` (used by the sales RO-creation dropdown) is preserved unchanged so other callers don't regress
- Default page size 50, sortable by `name` or `lastRoDate`
- Endpoint requires `ADMIN` or `SALES`
- Angular admin page at `/admin/customers` (sibling to `/admin/users` and `/admin/stations`):
  - Search input (debounced 200ms), Active/Inactive/All filter chip
  - Table columns: Code, Name (linked), Customer No, Contact, Active ROs, Last RO, Status pill
  - Empty-state message when filters return zero rows
  - "Add customer" button top-right routes to `/admin/customers/new`
  - Auto-refreshes after edits in subsequent stories (use a `refreshTrigger` signal — same pattern as E11-S2)

### Done definition
- Loading `/admin/customers` shows DFE, IAL, BGT plus any customers auto-created from PDF uploads
- Searching "DFE" filters to one row; searching by partial customer_no works
- `Active ROs` and `Last RO` columns match values visible on the supervisor dashboard
- `dotnet test` and `npx ng test --watch=false` both green

### Claude Code prompt
```
Implement the admin customer list:

1. api/Endpoints/CustomerEndpoints.cs: add a second MapGroup for /api/admin/customers
   requiring role ADMIN or SALES.
   - GET /api/admin/customers with query params q, active, page, pageSize (default 1, 50).
   - Project to CustomerSummary using a single EF Select that LEFT JOINs repair_orders
     for activeRoCount and lastRoDate. Use conditional aggregates — avoid N+1.
   - Return { items, totalCount, page, pageSize }.

2. web/src/app/admin/customers-list.component.ts (standalone):
   - signal-based state mirroring users-list.component.ts (search, filter, refresh trigger).
   - effect() refetches on filter change.
   - Reuse table classes (.kanban-row, .pill, .pill-success, .pill-danger).
   - "Add customer" button + per-row link to /admin/customers/{id}.

3. Routing: add children under /admin in app.routes.ts — customers, customers/new,
   customers/:id — all guarded by authGuard + adminGuard. (Sales-only access can come
   later; default to ADMIN-only routes for now.)

4. Tests:
   - api.tests/AdminCustomerEndpointTests.cs::ListCustomers_Search_FiltersByName,
     ListCustomers_ActiveCounts_MatchRepairOrders,
     ListCustomers_RequiresAdminOrSales.
```

---

## Story E13-S2 — Create/edit customer form + email distribution list (M, 4h)

**As an admin**
**I want** to create new customers, edit existing ones, and manage their email distribution list
**So that** routine customer admin doesn't require SQL and the QC email blast hits the right inboxes

### Acceptance criteria
- `POST /api/admin/customers` creates with `{ code?, name, customerNo?, abn?, billToName?, billToAddress?, contactEmail?, contactPhone?, emailDl? }`. `code` and `customerNo` are unique when supplied (return 422 on conflict with a clear message)
- `PUT /api/admin/customers/{id}` patches the same fields. `code` is mutable (the auto-create-from-PDF path sometimes assigns a placeholder)
- `POST /api/admin/customers/{id}/deactivate` and `/activate` toggle `is_active`. Deactivation is allowed even with active ROs (existing ROs continue working) — but the response includes `activeRoCount` so the UI can warn
- `email_dl` is the existing CITEXT column from migration 008; it stores a comma-separated address list. Validate each entry as an email; reject with 422 on bad input
- Angular `/admin/customers/new` and `/admin/customers/{id}` use a single shared form component:
  - Required: `name` only. All others optional
  - `code` is alphanumeric uppercase 2–20 chars (auto-uppercased); `customerNo` numeric 1–20 chars
  - `emailDl` shown as a chip-style multi-input — paste comma-separated addresses, each renders as a removable chip
  - Deactivate button on edit mode opens a confirmation modal that surfaces `activeRoCount`
- All admin actions emit `domain_events`: `CustomerCreated`, `CustomerUpdated`, `CustomerDeactivated`, `CustomerActivated`, `CustomerEmailDlChanged`

### Done definition
- Create a new customer "Test Logistics" via UI; it appears in `/admin/customers` and in the sales RO creation dropdown immediately
- Edit DFE's `emailDl` to add `ops@dfe.com.au`; trigger a QC complete email and verify the address is in the To: list (Mailpit)
- Try to create a customer with `code = 'DFE'` → form shows "Code already in use"
- Deactivate a customer with an active RO → modal warns "1 active RO will continue but no new ROs can be created"

### Claude Code prompt
```
Build the customer create/edit form:

1. CustomerEndpoints.cs:
   - POST /api/admin/customers → CreateCustomer(CreateCustomerRequest req).
     Validate code uniqueness, customerNo uniqueness, email format, emailDl entries.
     Insert + emit CustomerCreated. Return 201 with the new resource.
   - PUT /api/admin/customers/{id} → UpdateCustomer. Skip null fields (PATCH-like)
     so the form can submit only changed values. Emit CustomerUpdated; if emailDl
     changed, also emit CustomerEmailDlChanged with before/after.
   - POST /api/admin/customers/{id}/deactivate / activate → toggle is_active, emit event.
   - Wrap multi-row updates in a transaction.

2. web/src/app/admin/customer-form.component.ts:
   - Reactive form with all fields from the spec.
   - emailDl chip input: split on comma/enter, validate each address with a basic regex,
     show invalid entries in red.
   - Used by both /admin/customers/new (create mode) and /admin/customers/:id (edit, prefilled).
   - On edit, sticky footer with "Deactivate customer" → confirmation modal showing
     activeRoCount fetched from the customer detail endpoint.

3. Tests:
   - api.tests/AdminCustomerEndpointTests.cs::CreateCustomer_HappyPath,
     CreateCustomer_DuplicateCode_Returns422,
     UpdateCustomer_EmailDl_ParsesList,
     EmailDl_InvalidAddress_Returns422.
   - DomainEventsTests.cs::CustomerEmailDlChanged_PayloadHasBeforeAndAfter.
```

---

## Story E13-S3 — Customer detail page + RO history tabs (S, 2h)

**As an admin or sales user**
**I want** to see a customer's full RO history grouped by status
**So that** I can answer "what's outstanding for DFE?" without leaving the customer page

### Acceptance criteria
- `GET /api/admin/customers/{id}` returns the full customer row plus three counts: `activeRoCount`, `completedRoCount`, `cancelledRoCount`
- `GET /api/admin/customers/{id}/repair-orders?status=active|completed|cancelled&page=&pageSize=` returns paginated `RoSummary[]` filtered by status group:
  - `active` = `status IN ('DRAFT','QUOTED','APPROVED','IN_PROGRESS','ON_HOLD')`
  - `completed` = `status = 'COMPLETED'`
  - `cancelled` = `status = 'CANCELLED'`
- `RoSummary` shape: `{ id, roNumber, templateCode, rego, chassisNumber, status, kanbanStage, requiredDate, createdAt }`
- Angular `/admin/customers/{id}`:
  - Read-only summary card at the top mirroring the customer-form fields
  - "Edit" button toggles in-place into the form (E13-S2)
  - Three tabs (Active · Completed · Cancelled) with the count in each label, e.g. "Active (3)"
  - Tab content is the RO table; each row links to `/sales/ro/{id}` (existing detail page from E2)

### Done definition
- DFE detail page renders all three tabs with counts matching dashboard values
- Switching tabs is instant (no full page reload); pagination works on each tab independently
- Clicking an RO opens the existing RO detail page

### Claude Code prompt
```
Customer detail page:

1. CustomerEndpoints.cs:
   - GET /api/admin/customers/{id} → full customer + the three status-grouped counts
     (one query with CASE WHEN bucketing).
   - GET /api/admin/customers/{id}/repair-orders?status=active|completed|cancelled
     with pagination.

2. web/src/app/admin/customer-detail.component.ts:
   - Two-mode page: view (default) and edit (renders <app-customer-form>).
   - Tabs implemented as a signal<'active' | 'completed' | 'cancelled'> driving an
     effect() that fetches the matching status group on change.
   - Reuse the dashboard's existing RO table styling.

3. Tests:
   - api.tests/AdminCustomerEndpointTests.cs::GetCustomer_RoCounts_BucketCorrectly,
     GetCustomerRos_StatusFilter_ReturnsRightGroup.
```

---

## Story E13-S4 — Per-customer vehicle catalogue (S, 2h)

**As a sales user**
**I want** to see every vehicle this customer has had through us
**So that** when they ring asking "what was the chassis we did the Kuda fit-out on last year?" I can answer in seconds

### Acceptance criteria
- `GET /api/admin/customers/{id}/vehicles` returns distinct combinations from `repair_orders` for that customer: `{ rego, vin, chassisNumber, make, model, paintColour, firstSeenAt, lastSeenAt, roCount }`
  - Distinct on `(rego, vin, chassis_number)`; drop tuples where all three are null
  - `firstSeenAt` = `MIN(ro_date)`, `lastSeenAt` = `MAX(ro_date)`, `roCount` = count of ROs sharing that tuple
  - Order by `lastSeenAt` DESC
- New "Vehicles" tab on `/admin/customers/{id}` (alongside Active/Completed/Cancelled) showing the catalogue as a table
- Each row expandable inline to show the matching RO numbers (filter client-side from the customer-RO cache, or call back to the customer-RO endpoint with a rego/VIN match)

### Done definition
- DFE's Vehicles tab lists every distinct rego from past ROs
- A vehicle that has been through twice shows `roCount = 2` and an expandable list of both RO numbers
- Vehicles with all null identifiers are not rendered

### Claude Code prompt
```
Per-customer vehicle catalogue:

1. CustomerEndpoints.cs: GET /api/admin/customers/{id}/vehicles
   SELECT rego, vin, chassis_number, make, model, paint_colour,
          MIN(ro_date) AS first_seen_at, MAX(ro_date) AS last_seen_at,
          COUNT(*) AS ro_count
   FROM repair_orders
   WHERE customer_id = @id
     AND (rego IS NOT NULL OR vin IS NOT NULL OR chassis_number IS NOT NULL)
   GROUP BY rego, vin, chassis_number, make, model, paint_colour
   ORDER BY last_seen_at DESC

   Use the equivalent EF Core LINQ query — GROUP BY shapes are well-supported.

2. customer-detail.component.ts: add a fourth tab "Vehicles". Render the table; each row
   has an expand chevron that shows matching RO numbers (filter from the in-memory active
   /completed/cancelled cache if cheap; otherwise a small follow-up fetch).

3. Tests:
   - api.tests/AdminCustomerEndpointTests.cs::GetVehicles_DistinctOnIdentifiers,
     GetVehicles_AllNullIdentifiers_Filtered,
     GetVehicles_OrdersByLastSeenDesc.
```

---

# Epic E14 — RO editing & lifecycle controls

> **Priority:** P0 · **Owner:** Dev B · **Days:** 5–7 · **Total estimate:** 14 hours

Once an RO is created, the only way to fix typos in the rego, swap the chassis, add a forgotten task or cancel the whole job is via SQL. The demo feedback consistently flagged this as the #1 missing capability. Every edit emits a `domain_events` row so E15's audit log gets an RO change history for free.

> **Sync point with E15:** the event payload shapes for `RoFieldChanged`, `RoTaskAdded`, `RoTaskRemoved`, `RoTaskReordered`, `RoCancelled`, `RoReopened`, `KanbanStageOverride` must be agreed with Dev A on the morning of day 4 — see the integration note at the top of this doc.

## Story E14-S1 — Edit RO header fields (M, 4h)

**As a sales user**
**I want** to fix typos and tweak metadata on an RO that's already in the system
**So that** I don't have to delete and recreate the whole thing for a one-character rego change

### Acceptance criteria
- Migration `015_ro_lifecycle.sql`:
  - Adds `cancelled_at TIMESTAMPTZ`, `cancellation_reason TEXT`, `cancelled_by UUID REFERENCES users(id)` to `repair_orders`
  - Adds `reopened_at TIMESTAMPTZ`, `reopened_by UUID REFERENCES users(id)` to `repair_orders`
  - Idempotent (`ADD COLUMN IF NOT EXISTS`)
- `PUT /api/repair-orders/{id}` accepts a partial update with: `{ rego?, vin?, make?, model?, paintColour?, chassisNumber?, engineNumber?, customerId?, jobTypeId?, expectedInDate?, requiredDate?, deliveryDate?, priority?, notes? }`
- Reject with 409 if `status = 'COMPLETED'` or `'CANCELLED'`. Allowed on every other status
- Reject `customerId` change with 422 if any task on this RO has `time_entries` (history would become inconsistent). Message: "Cannot reassign customer once work has been logged."
- Each changed field emits one `RoFieldChanged` event with payload `{ field, before, after }`. A single transaction wraps the row update + all events
- Endpoint requires `SALES`, `SUPERVISOR`, or `ADMIN`
- Angular `/sales/ro/{id}` gains an "Edit" button at the top of the header card. Clicking inlines the existing read-only fields as editable inputs with Save / Cancel
- Reuse the customer dropdown (`GET /api/customers`) and job-type dropdown (`GET /api/job-types`)

### Done definition
- Edit a draft RO's rego from "ABC123" to "ABC124"; field updates without losing tasks or kanban state
- Try to edit a completed RO via Swagger → 409 with clear message; UI's Edit button is hidden in that state
- `domain_events` shows one event per changed field with the correct before/after values

### Claude Code prompt
```
Implement RO header editing:

1. db/migrations/015_ro_lifecycle.sql with cancelled_at, cancellation_reason, cancelled_by,
   reopened_at, reopened_by columns. Idempotent.

2. RepairOrderEndpoints.cs: PUT /api/repair-orders/{id}
   - Bind UpdateRoRequest with all nullable fields above.
   - Load the RO; if status in ('COMPLETED','CANCELLED'), return Conflict.
   - If req.CustomerId present and any time_entries exist on this RO's tasks, return 422.
   - For each non-null field that differs from the current value, mutate the entity AND
     queue a RoFieldChanged event in the same DbContext SaveChanges call.
   - Wrap in a transaction.

3. web/src/app/sales/ro-detail.component.ts (or wherever the existing RO detail lives):
   - Add an editMode signal and an editForm (Reactive) populated from the loaded RO.
   - Save calls PUT and on 200 swaps the signal back to false and refreshes the data.
   - Hide the Edit button if status is COMPLETED or CANCELLED.

4. Tests:
   - api.tests/RepairOrderEditTests.cs::UpdateHeader_SingleField_EmitsOneEvent,
     UpdateCompletedRo_Returns409,
     UpdateCustomerWithTimeEntries_Returns422,
     UpdateMultipleFields_EmitsOneEventPerField.
```

---

## Story E14-S2 — Add / remove / reorder RO tasks (M, 4h)

**As a sales user**
**I want** to add a forgotten operation or remove one that turned out to be unnecessary
**So that** the RO matches what we're actually doing on the shop floor

### Acceptance criteria
- `POST /api/repair-orders/{id}/tasks` creates one task with `{ operationId, stationId, estimatedHours, sequence?, notes? }`
  - `operation_name` is snapshotted from `operation_catalog` at insert time (matches how the template materialiser does it)
  - If `sequence` is null, append (max+1)
- `DELETE /api/repair-orders/{id}/tasks/{taskId}` removes a task ONLY if `time_entries.count = 0` AND `status = 'PENDING'`. Otherwise return 422 "Task cannot be removed: work has already started"
- `PUT /api/repair-orders/{id}/tasks/reorder` with `{ taskIds: [] }` — array of all task IDs in the desired order; validates the set matches current tasks 1:1, then updates `sequence` on each in a transaction
- Each operation emits a domain event: `RoTaskAdded { taskId, operationId, stationId, sequence }`, `RoTaskRemoved { taskId, operationId }`, `RoTaskReordered { before: [taskId...], after: [taskId...] }`
- All three endpoints reject with 409 if the parent RO `status = 'COMPLETED'` or `'CANCELLED'`
- UI on `/sales/ro/{id}` Tasks section:
  - "+ Add task" button opens a modal with operation dropdown (from `operation_catalog`), station dropdown, estimated hours input, notes textarea
  - Each task row gains a drag handle (Angular CDK `cdkDrag`) and a delete icon (disabled with tooltip if work has started)
  - Drag-drop reorder is optimistic; on API failure, snapback + toast

### Done definition
- Add a new "Final inspection" task to a draft RO; it appears immediately on the kanban
- Try to delete a task that has time_entries → API 422, UI disables button with tooltip "Cannot delete: work logged"
- Drag a task from sequence 3 to sequence 1; reload confirms persisted order
- `domain_events` shows three events for a 3-step session (add, remove, reorder)

### Claude Code prompt
```
Implement RO task add/remove/reorder:

1. RepairOrderEndpoints.cs (or new TaskEndpoints under repair-orders group):
   - POST /api/repair-orders/{id}/tasks: validate parent RO not COMPLETED/CANCELLED.
     Look up operation_catalog by operationId; snapshot name. Insert job_tasks row.
     Emit RoTaskAdded.
   - DELETE /api/repair-orders/{id}/tasks/{taskId}: load task; verify status='PENDING'
     and no time_entries. Delete; emit RoTaskRemoved.
   - PUT /api/repair-orders/{id}/tasks/reorder: load all task IDs for RO; validate
     request set matches; update sequence in a single round-trip via CASE WHEN bulk
     update. Emit RoTaskReordered with before/after arrays.

2. web/src/app/sales/ro-detail.component.ts (Tasks section):
   - Add task modal: <app-add-task-modal> with operation/station/hours form.
   - Task rows: cdkDrag handle + delete icon. Use cdkDropList on the container.
   - On drop, call reorder endpoint with the new IDs; on failure, restore prior order
     from a snapshot taken before the drop.

3. Operation/station catalog endpoints already exist (used by template editor); reuse.

4. Tests:
   - api.tests/RepairOrderTaskTests.cs::AddTask_Append_AssignsNextSequence,
     DeleteTask_WithTimeEntries_Returns422,
     ReorderTasks_PartialSet_Returns400,
     AddTask_OnCompletedRo_Returns409.
```

---

## Story E14-S3 — Cancel + reopen flow (S, 2h)

**As a supervisor**
**I want** to cancel an RO that's been killed by the customer, with a reason
**So that** the chassis is freed up and the workshop floor doesn't waste capacity on it

### Acceptance criteria
- `POST /api/repair-orders/{id}/cancel` with `{ reason: string, releaseChassis?: boolean = true }`
  - Sets `status = 'CANCELLED'`, `cancelled_at = now()`, `cancellation_reason`, `cancelled_by`
  - If the RO has an allocated chassis and `releaseChassis = true`: sets the chassis row's `status = 'AVAILABLE'`, `allocated_to_ro = null`, `allocated_at = null`
  - All `PENDING` tasks transition to `status = 'CANCELLED'` (in-progress tasks keep their state — the time already spent is real)
  - Emits one `RoCancelled` event with payload `{ reason, releasedChassisId? }`
  - Requires `SUPERVISOR` or `ADMIN`
  - Reject with 409 if `status = 'COMPLETED'` or already `'CANCELLED'`
- `POST /api/repair-orders/{id}/reopen` (admin-only)
  - Only allowed if `status = 'CANCELLED'`; otherwise 409
  - Sets `status` back to its prior value (read from the most recent `RoFieldChanged` event for `field='status'` or default to `'APPROVED'` if not found)
  - Sets `reopened_at`, `reopened_by`; clears `cancelled_at`, `cancellation_reason`, `cancelled_by`
  - Does NOT auto-reallocate chassis (manual step)
  - Emits `RoReopened`
- UI:
  - `/sales/ro/{id}` shows a red "Cancel RO" button in the header for SUPERVISOR/ADMIN; opens a modal with required reason textarea (minlength 10) + "Release chassis allocation" checkbox (default checked, hidden if no chassis)
  - When `status = 'CANCELLED'`, the page renders a banner with reason + cancelled-by + cancelled-at; admins see a "Reopen" button next to the banner

### Done definition
- Cancel an RO with an allocated chassis → chassis becomes AVAILABLE; supervisor heatmap drops the hours
- Try to cancel a COMPLETED RO → 409
- Reopen a cancelled RO as admin → status returns; banner clears; chassis is NOT auto-reallocated
- Cancel emits exactly one `RoCancelled` event regardless of how many tasks transitioned

### Claude Code prompt
```
Cancel and reopen flow:

1. RepairOrderEndpoints.cs:
   - POST /api/repair-orders/{id}/cancel: validate status not COMPLETED/CANCELLED.
     In a transaction: update RO, update chassis if allocated and releaseChassis,
     bulk update PENDING tasks. Emit one RoCancelled event with releasedChassisId in payload.
   - POST /api/repair-orders/{id}/reopen: ADMIN only. Validate current status is CANCELLED.
     Read prior status from the last RoFieldChanged event where field='status', else 'APPROVED'.
     Clear cancellation columns; set reopened columns; emit RoReopened.

2. web/src/app/sales/ro-detail.component.ts:
   - <app-cancel-ro-modal> with reason textarea (required, minlength 10) and release-chassis checkbox.
   - Banner component shown when status === 'CANCELLED' with cancelledAt, reason, and
     (for admin) Reopen button.

3. Tests:
   - api.tests/RepairOrderLifecycleTests.cs::CancelRo_ReleasesChassis,
     CancelRo_PendingTasksTransition,
     ReopenRo_NonAdmin_Returns403,
     ReopenRo_NotCancelled_Returns409,
     CancelCompletedRo_Returns409.
```

---

## Story E14-S4 — Manual kanban stage override (S, 2h)

**As a supervisor**
**I want** to manually push an RO forward or back a kanban stage
**So that** I can fix the rare case where auto-advance got it wrong (e.g. partial work, mis-clocked task)

### Acceptance criteria
- `POST /api/kanban/ros/{id}/override-stage` with `{ stageId: int, reason: string }`
  - Sets `ro_kanban_state.current_stage_id`, `entered_stage_at = now()`
  - Emits `KanbanStageOverride` event with `{ fromStageId, toStageId, reason }`
  - Allowed transitions: any-to-any (this is the manual escape hatch; auto-advance rules don't apply)
  - Reject with 409 if RO is `CANCELLED` or `COMPLETED`
  - Requires `SUPERVISOR` or `ADMIN`
- UI on the kanban dashboard, each RO card gets a "⋯" menu in the corner with an "Override stage…" item that opens a modal:
  - Stage dropdown (all stages from `kanban_stages`, current one preselected)
  - Reason textarea (required, minlength 10)
  - Save calls the endpoint and refreshes the kanban
- The override is visually marked on the RO card (small ⚠ icon + tooltip "Stage manually set by {user} on {date}: {reason}") until the next auto-advance overwrites it

### Done definition
- Move an RO from "In Progress" to "Final QC" via override; it appears in the QC column immediately
- The ⚠ marker disappears when the next auto-advance fires (e.g. tasks get clocked)
- `domain_events` shows one `KanbanStageOverride` row per move

### Claude Code prompt
```
Manual kanban stage override:

1. KanbanEndpoints.cs: POST /api/kanban/ros/{id}/override-stage
   - SUPERVISOR or ADMIN only.
   - Validate target stageId exists; validate RO not COMPLETED/CANCELLED.
   - Update ro_kanban_state in a transaction; emit KanbanStageOverride with fromStageId
     captured BEFORE the update.

2. web/src/app/kanban/kanban.component.ts:
   - Add a ⋯ menu on each card. Use the same fixed-overlay pattern as the assign-tech
     popover (anchored via getBoundingClientRect stored in a signal<DOMRect | null>) to
     dodge the overflow-clipping issue noted in CLAUDE.md.
   - <app-override-stage-modal> with stage dropdown + reason textarea.
   - Surface the most recent override per RO from the latest KanbanStageOverride event
     (or a small dedicated read-model column on ro_kanban_state — pick whichever path
     matches existing patterns).

3. Tests:
   - api.tests/KanbanOverrideTests.cs::OverrideStage_AnyToAny_Allowed,
     OverrideStage_NonSupervisor_Returns403,
     OverrideStage_CompletedRo_Returns409,
     OverrideStage_EmitsEventWithFromAndTo.
```

---

## Story E14-S5 — Audit hooks + Playwright regression (S, 2h)

**As the team**
**I want** every E14 path covered by an end-to-end test that exercises the full edit cycle
**So that** future refactors don't silently lose audit events or break the lifecycle

### Acceptance criteria
- A shared helper `api/Domain/Events/RoLifecycleEvents.cs` provides typed builders for the seven new event types from E14. All E14 endpoints route their event emission through it so payload shapes stay consistent across S1–S4
- Playwright spec `web/e2e/ro-lifecycle.spec.ts` walks the full happy path:
  1. Login as `sales`, create an RO from a template
  2. Edit the rego (E14-S1) — verify the change persists
  3. Add a task (E14-S2) — verify it appears
  4. Reorder tasks via drag-drop — verify new order on reload
  5. Login as `supervisor`; override the kanban stage (E14-S4) — verify card moves
  6. Cancel the RO (E14-S3) — verify status banner and chassis release
  7. Login as `admin`; reopen the RO — verify banner clears
- Verification step: an api integration test reads `domain_events` directly and asserts ≥ 6 events of the expected types are emitted with the correct payload shapes
- `make test` stays green; full Playwright suite under 90 s

### Done definition
- Spec passes from a clean `make reset && make seed && make hash-pw`
- All seven event types emit with the correct payload shape (verified by direct `domain_events` query)
- No flake on three consecutive runs

### Claude Code prompt
```
E14 wrap-up:

1. api/Domain/Events/RoLifecycleEvents.cs: a static class with helper methods like
   EmitRoFieldChanged(NeeDbContext db, Guid roId, Guid userId, string field, string? before, string? after)
   for each of the seven event types. Each builds the JSONB payload, sets aggregate_type='RepairOrder',
   user_id, occurred_at, and adds to db.DomainEvents. Refactor S1–S4 endpoints to call
   these helpers (single source of truth for payload shapes).

2. web/e2e/ro-lifecycle.spec.ts: walk the seven-step flow described above. Use existing
   fixtures from web/e2e/fixtures/. Cap to 90s — use page.waitForResponse on the API calls
   instead of arbitrary sleeps.

3. api.tests/RoLifecycleEventsTests.cs::FullLifecycle_EmitsAllSevenEventTypes — drives
   the same flow via the test fixture's HTTP client and asserts on domain_events rows.

4. Run the full Playwright suite three times to check for flakes.
```

---

# Epics E15–E20 — overview only

Detailed stories for E15 onwards will be produced **at the start of each epic's day**, shaped to the actual velocity learned from E11–E14. Story specs written 6+ days ahead are usually wrong.

## Epic E15 — Audit log + RO timeline view

**Priority:** P0 · **Owner:** Dev A · **Days:** 4–5 · **Stories:** 4 (~10h)

**Scope:** `domain_events` is fully populated by every existing endpoint but there is no UI to see it. This epic delivers two views: a global audit search (admin-only) and a per-RO timeline that sales/supervisor can read.

**Capabilities:**
- `GET /api/admin/audit?eventType=&aggregateType=&userId=&from=&to=&q=` paginated, ordered by `occurred_at` DESC
- `/admin/audit` page with filter bar + table; clicking a row expands the JSON payload
- `GET /api/repair-orders/{id}/timeline` returns events filtered to `aggregate_id = roId` plus events for child entities (tasks, approvals, chassis allocations, scheduling) by joining on the JSONB payload's `roId` field
- RO detail page (`/sales/ro/{id}`) gains a Timeline tab beside the existing Tasks tab
- Each event renders with a human-readable summary (event-type → template) instead of raw JSON
- Performance: index on `domain_events(aggregate_type, aggregate_id, occurred_at DESC)` if not already present

**Stories:** S1 audit endpoint + index migration, S2 admin audit search UI, S3 RO timeline endpoint + tab UI, S4 event-summary rendering library + tests.

**Schema:** `domain_events` (read-only), index migration in `015_audit_indexes.sql`.

## Epic E16 — Drag-and-drop kanban

**Priority:** P1 · **Owner:** Dev A · **Days:** 7–8 · **Stories:** 3 (~8h)

**Scope:** The kanban currently uses click-to-assign. Workshops universally expect drag-and-drop. Listed in the original backlog's Phase 2 candidates.

**Capabilities:**
- Drag a task card from one technician chip to another within the same station → calls existing assign endpoint
- Drag a task card across kanban columns (Pending → In Progress → Hospital) → triggers stage change endpoint with optimistic UI
- Visual feedback during drag (opacity, drop-zone highlight)
- Mobile / touch-friendly: drag-and-drop works with touch events too
- Falls back to click-to-assign if drag fails

**Stories:** S1 install Angular CDK DragDropModule + reposition, S2 cross-column drops + stage change wiring, S3 touch support + regression tests.

**Schema:** No changes; reads `job_tasks`, `ro_kanban_state`.

## Epic E17 — Reports: Variance Root Cause

**Priority:** P1 · **Owner:** Dev A · **Days:** 8–9 · **Stories:** 3 (~8h)

**Scope:** This was a "Phase 2" placeholder card on the existing Reports tab. Drills into the *why* behind variance — by reason code, by station, by template, by technician.

**Capabilities:**
- `GET /api/reports/variance-root-cause?from=&to=&groupBy=reason|station|template|technician`
- Stacked bar chart: x-axis = group, y-axis = total delta hours, segments coloured by reason code
- Drill-through: clicking a bar shows the underlying variance records
- Filters: date range, reason, minimum sample size
- CSV export

**Stories:** S1 query + endpoint, S2 chart + filter UI, S3 drill-through table + CSV export.

**Schema:** `variance_records`, `variance_reasons`, `job_tasks`, `repair_orders` (read-only).

## Epic E18 — Reports: Customer Concentration

**Priority:** P1 · **Owner:** Dev A · **Days:** 8–9 · **Stories:** 3 (~8h)

**Scope:** Another stub card on the Reports tab. Answers "Which customers are we doing the most work for, and is that healthy or a single-customer risk?".

**Capabilities:**
- `GET /api/reports/customer-concentration?period=last_quarter|last_year|ytd`
- Pareto chart: customer name × total RO hours, with a cumulative-percentage line; visual call-out for top-3 customers > 60% of revenue
- Side panel: per-customer trend (ROs/quarter, hours/quarter) over the last 8 quarters
- CSV export

**Stories:** S1 endpoint + Pareto query, S2 chart + trend panel, S3 CSV export + tests.

**Schema:** `customers`, `repair_orders`, `job_tasks`, `time_entries`.

## Epic E19 — Mobile PWA for technicians

**Priority:** P1 stretch · **Owner:** Dev B · **Days:** 9–10 · **Stories:** 4 (~12h)

**Scope:** Convert `/tech/*` into an installable PWA with offline cache and home-screen install. Listed in the original backlog's Phase 2 candidates.

**Capabilities:**
- `manifest.webmanifest` + service worker (Angular PWA `@angular/pwa` schematic)
- Cache strategy: network-first for `/api/tech/tasks` (always fresh when online), stale-while-revalidate for static assets
- Install-to-home-screen prompt on supported browsers
- Offline indicator at top of the screen when network is down
- Optimistic clock-in: if offline, the request is queued and replayed on reconnect
- Photo upload retries on reconnect

**Stories:** S1 add Angular service worker + manifest, S2 cache strategies + offline indicator, S3 offline queue for clock-in/out, S4 retry logic for photo uploads.

**Schema:** No changes; client-side IndexedDB for the request queue.

## Epic E20 — Reports: Strategic Forecasting

**Priority:** P2 · **Owner:** Dev A · **Days:** 9–10 · **Stories:** 4 (~14h)

**Scope:** The third "Phase 2" placeholder card. Predicts which scheduled ROs are at risk of being late based on station capacity, current variance trends and downstream task dependencies.

**Capabilities:**
- `GET /api/reports/forecast` returns per-RO forecast: `{ roId, projectedCompletionDate, daysAtRisk, riskScore (0–100), bottleneckStation }`
- Risk score = weighted blend of: capacity overcommit at upstream stations, recent variance percentile of operations on this RO's template, blocker frequency on similar ROs in last 60 days
- Forecast uses the existing capacity heatmap data (`scheduled_start_week` + per-station hours) and runs forward through the kanban stage map
- Dashboard widget: "ROs at risk this month" with top 5 sorted by risk score

**Stories:** S1 forecast query + risk score formula doc, S2 endpoint + caching layer (results cached for 1h), S3 forecast widget + drill-through detail, S4 model documentation + tests.

**Schema:** No changes; reads `repair_orders`, `job_tasks`, `variance_records`, `ro_kanban_state`, `time_entries`.

---

# Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| E11 admin endpoints expose secrets if misconfigured | Low | High | All admin endpoints require ADMIN role; integration test for unauthorised access on every endpoint; pair-review every PR |
| E12 file-upload categories drift from the existing `attachments` schema | Medium | Low | Add the new categories to the `category` CHECK constraint in migration 014; reject unknown categories at the endpoint |
| E14 RO editing introduces inconsistent state (e.g. tasks pointing to a deleted operation) | High | High | Wrap every multi-step edit in a transaction; emit a single compound domain event; integration tests for concurrent edits |
| E15 timeline endpoint becomes slow on long-running ROs | Medium | Medium | Add the index in 015_audit_indexes; cap the response to last 200 events; paginate older history |
| E16 Angular CDK DnD has subtle bugs on Safari iPadOS | Medium | Low | Test on the actual touch device used on the floor before declaring done |
| E17/E18/E20 reports diverge from existing report styling | Low | Low | Extract a shared `ReportLayoutComponent` from E8 in the first hour of E17 |
| E19 service worker caches stale auth tokens after logout | Medium | Medium | Logout clears the SW cache via `caches.delete()`; add a Playwright test for the logout-then-relogin flow |
| Phase 2 demo coincides with a marketing event (date TBC) | Low | Medium | Freeze main on the morning of demo day; cherry-pick fixes only |
| One dev calls in sick for > 2 days | Medium | High | P1 epics are cuttable without remorse; P0 epics are independent enough that the remaining dev can ship a smaller subset |

---

# What's not in this backlog (Phase 3 candidates)

These are deferred until after Phase 2 ships, in priority order:

1. **Azure deployment** — App Service, Postgres Flexible Server, Bicep IaC, GitHub Actions deploy pipeline, environment promotion (dev → staging → prod)
2. **Real Document Intelligence integration** — replace the regex parser with Azure Document Intelligence custom models; keep regex as fallback
3. **Web Push API for notifications** — real OS-level notifications on phones (currently we only have in-app toasts)
4. **Email attachments served from blob storage** — Azure Blob Storage with SAS URLs replacing local-disk uploads
5. **Multi-tenancy** — multiple workshops on a single deployment, with row-level security on every table
6. **Native mobile apps** — replace the PWA with native iOS/Android wrappers if PWA limitations bite (camera quality, background sync)
7. **ERP / accounting integration** — push completed ROs as invoices to MYOB / Xero
8. **Parts & supplier tracking** — `parts` table, supplier scorecards from `variance_reasons` (SUPPLIER_NCR), low-stock alerts
9. **Cost tracking & invoicing** — labor cost, parts cost, customer invoice generation as PDF
10. **ML-based variance prediction** — train a model on completed RO history; surface a "this RO will overrun by X hours" prediction at scheduling time
11. **Time-off / capacity calendar** — technician availability affects the 4-week heatmap (currently assumes 40h/week always)
12. **Bulk operations** — mass-schedule, mass-assign, mass-cancel from the supervisor dashboard
13. **Variance reason hierarchy** — sub-reasons (e.g. SUPPLIER_NCR → which supplier), supplier scorecards
14. **Customer portal** — read-only public share link for a customer to track their RO progress without logging in
