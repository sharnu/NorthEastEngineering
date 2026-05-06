# NEE Production Platform — Backlog

> **For:** Local-only MVP, 2 developers, 2 weeks, .NET 10 + Postgres + Angular
> **Schema reference:** `/db/migrations/001_initial_schema.sql` (24 tables, 4 views)
> **This document:** Epic-level overview for all 9 capabilities, plus full story detail for the first two epics (E1, E2). Subsequent epics get full detail as we ship.

---

## How to use this document

Each story is structured to be **directly usable as a Claude Code prompt**. The schema is real, the columns are real, the patterns are consistent. Copy a story, paste it as your kickoff prompt to Claude Code, and it should produce something that compiles and tests cleanly.

**Story sizing convention:**
- **S** = Small, ~2 hours, tricky logic that needs review-then-iterate
- **M** = Medium, ~4 hours, mostly boilerplate Claude Code can lead on
- **L** = Large, ~6+ hours, split if it grows

**Priority convention:**
- **P0** = Must-ship for the demo, non-negotiable
- **P1** = Stretch, attempted only if P0 is on track by day 8

---

## The 9 capabilities, sequenced by dependency

Order matters because some capabilities depend on others. Build them in this order:

| # | Epic | Priority | Owner | Dependencies | Stories |
|---|---|---|---|---|---|
| E1 | Foundation: walking skeleton, auth, schema | **P0** | Both pair on day 0–1 | None | 6 |
| E2 | Sales — RO from template | **P0** | Dev B | E1 | 7 |
| E3 | Supervisor — overview dashboard | **P0** | Dev A | E2 | 5 |
| E4 | Kanban — station view | **P0** | Dev A | E3 | 5 |
| E5 | Technician phone + variance | **P0** | Dev B | E2, E4 | 6 |
| E6 | QC + email | **P0** | Dev B | E5 | 5 |
| E7 | Notifications — in-app toasts | **P0** | Dev A | E3 | 4 |
| E8 | Supervisor — reports | **P0** | Dev A | E3, E5 | 4 |
| E9 | Sales — PDF upload + extract | **P1 stretch** | Dev B | E2 | 5 |
| E10 | Supervisor — scheduling | **P1 stretch** | Dev A | E3 | 5 |

**Total: ~52 stories.** Realistic for 2 devs × 10 days × ~2.5 stories/day each. The stretch epics (E9, E10) are explicit insurance — drop them if days 8–9 are tight.

---

## Work split between two developers

The work splits cleanly into two streams that share the schema but rarely collide on code:

**Dev A — back-of-house:** Foundation, supervisor dashboard, kanban, notifications, reports, scheduling stretch.
**Dev B — floor-and-customer:** Sales template, technician phone, QC + email, PDF upload stretch.

Day 0 they pair on the foundation epic (E1). After that, they work independently and meet at integration points (when an RO created by Dev B's sales screen needs to appear on Dev A's dashboard, etc.). Use feature branches and merge to `main` at end of day.

---

## Daily rhythm

- **Morning (1h):** Pull latest, review backlog, pick stories for the day, write the planning paragraph.
- **Mid-day (5–6h):** Execute. Use Claude Code agentically for boilerplate stories, interactively for tricky logic. Review every diff.
- **End of day (1–2h):** Merge to `main`, run full test suite, demo the new flow to yourself or your pair, write tomorrow's planning notes.

---

# Epic E1 — Foundation

> **Priority:** P0 · **Owner:** Both (pair) · **Days:** 0–1 · **Total estimate:** 12 hours

The walking skeleton. By the end of this epic the team can clone the repo, run `make dev`, log in as a seeded user, and see a "hello world" data fetch from a real Postgres database. Nothing is impressive, everything works.

## Story E1-S1 — Repo bootstrap and folder structure (M, 3h)

**As a developer**
**I want** a clean monorepo skeleton with `/api`, `/web`, `/db`, `/docs` folders
**So that** both developers can clone and start working consistently

### Acceptance criteria
- Monorepo at the project root with subfolders `/api` (.NET 10 minimal API project), `/web` (Angular 18+ standalone), `/db` (migrations + docker-compose), `/docs` (this backlog, glossary, ADRs)
- A `Makefile` at the root with targets: `dev`, `test`, `seed`, `reset`, `lint`
- A `README.md` with a 5-step "clone, install, run" sequence
- `.gitignore` correctly excludes `bin`, `obj`, `node_modules`, `*.user`, `.env`
- `.editorconfig` for consistent formatting between devs

### Technical context
- .NET 10 / C# 14 / EF Core 10 / ASP.NET Core 10
- Angular 18 with standalone components (no NgModule)
- Use `dotnet new webapi -minimal` as the API starting point
- Use `ng new web --standalone --routing --style=css` for the frontend

### Done definition
- `git clone` + `make dev` results in API running on :5000 and web on :4200
- Both devs have cloned, run, and confirmed working before story closes

### Claude Code prompt
```
Initialize a monorepo at the current directory with this structure:
- /api: .NET 10 minimal API ("dotnet new webapi -minimal -f net10.0")
- /web: Angular 18 standalone components ("ng new web --standalone --routing --style=css --skip-git")
- /db: empty for now, will hold docker-compose and migrations
- /docs: empty for now
- /Makefile: targets `dev` (runs api+web concurrently), `test` (runs both test suites), `seed`, `reset`
- /.gitignore for .NET + Node + IDE files
- /.editorconfig
- /README.md with 5-step quickstart
The Makefile should use `concurrently` or `tmux` style splits — pick whichever is more cross-platform.
Do NOT add any controllers or components beyond the templates. Just the skeleton.
```

---

## Story E1-S2 — Postgres in Docker with schema + seed (M, 3h)

**As a developer**
**I want** a one-command Postgres instance with the existing schema and seed data loaded
**So that** I can develop against real data immediately

### Acceptance criteria
- `docker-compose.yml` in `/db` running Postgres 16 on port 5432
- The existing `001_initial_schema.sql` runs automatically on first startup
- A new `002_seed_data.sql` that inserts:
  - 5 demo users (1 sales, 1 drafter, 1 supervisor, 2 technicians) with bcrypt password hashes for password `nee2026`
  - The 8 stations and 5 kanban stages from the schema
  - The 28 operations from the operation catalog
  - 2 templates ready for use: `TP42N` and `DFE-TT67F` with all their `template_operations`
  - 3 customers: Direct Freight Express, Modern Truck Repairs, Wagga Motors
  - 3 body types and 5 job types
  - 6 variance reasons
- `make seed` re-runs the seed without dropping schema
- `make reset` drops and recreates the database fresh

### Technical context
- Schema file already exists at `/db/migrations/001_initial_schema.sql` — copy it from `/mnt/user-data/outputs/001_initial_schema.sql`
- Use Postgres 16 image
- Use `/docker-entrypoint-initdb.d/` mount to auto-run SQL files on first boot
- For password hashing in seed, use bcrypt cost 10 — or pre-compute the hashes and embed as literal strings (since this is dev seed only)

### Done definition
- `cd db && docker compose up -d && sleep 5 && make seed` results in a populated database
- `psql` query shows all seed data present
- Both developers run it and confirm

### Claude Code prompt
```
In the /db folder, create:
1. docker-compose.yml running postgres:16 on port 5432, with volume mount, env vars POSTGRES_DB=nee, POSTGRES_USER=nee, POSTGRES_PASSWORD=nee_dev
2. /db/migrations/001_initial_schema.sql — I will paste this in separately
3. /db/migrations/002_seed_data.sql — generate this with realistic NEE data:
   - 5 users: sales@nee.local, drafter@nee.local, supervisor@nee.local, tech1@nee.local, tech2@nee.local
     all with bcrypt hash of "nee2026" (use the actual hash, cost 10: $2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy)
   - 8 stations: Material Processing, Fab Line, Paint Prep, Paint Booth, Body Fitout, HYVA Hydraulics, Final Fitment, Final QC
   - 5 kanban stages: Pending, In Progress, Hospital, Complete, On Hold
   - 28 operations from the operation catalog (see schema)
   - 2 templates: TP42N (Tipper 4.2m, 12 operations totaling ~53.5h), DFE-TT67F (Tautliner 6.7m DFE variant, 13 operations totaling ~62.5h)
   - 3 customers, 3 body types, 5 job types, 6 variance reasons
4. Update Makefile: `seed` runs the SQL file, `reset` does docker compose down -v then up -d.
Refer to the schema in /db/migrations/001_initial_schema.sql for exact column names. Use UUIDs for primary keys (gen_random_uuid()).
```

---

## Story E1-S3 — API skeleton with health endpoint and Postgres connection (S, 2h)

**As a developer**
**I want** the API to connect to Postgres and expose a health endpoint
**So that** I know the data layer works before building features

### Acceptance criteria
- `GET /api/health` returns `{ "status": "ok", "db": "connected", "version": "0.1.0" }`
- DB connection uses `Npgsql` directly OR EF Core 10 — team picks one (recommend EF Core for the velocity boost)
- Connection string from `appsettings.Development.json`, never hardcoded
- Startup logs the DB version on successful connection
- If DB is unreachable, the endpoint returns 503 with a clear message

### Technical context
- For EF Core: use `Npgsql.EntityFrameworkCore.PostgreSQL` package
- DbContext should be registered as scoped
- For health check, ASP.NET Core has `Microsoft.Extensions.Diagnostics.HealthChecks` — use the Postgres health check package

### Done definition
- `curl localhost:5000/api/health` returns 200 with the expected JSON
- Stop the database container, hit the endpoint, verify 503 response
- Test passes in CI (when CI exists)

### Claude Code prompt
```
In /api, set up a .NET 10 minimal API with:
1. EF Core 10 with Npgsql provider
2. A NeeDbContext class with DbSet for Users only (we'll add others as we need them)
3. Connection string in appsettings.Development.json: "Host=localhost;Port=5432;Database=nee;Username=nee;Password=nee_dev"
4. GET /api/health endpoint returning { status, db, version } — uses Microsoft.Extensions.Diagnostics.HealthChecks
5. Startup that logs "Connected to Postgres <version>" on boot
6. Add the User entity matching the schema's users table (id uuid PK, email text unique, password_hash text, full_name text, created_at, updated_at)
7. Register DbContext as scoped, add health check for the DB connection.
Verify by running and curling /api/health.
```

---

## Story E1-S4 — Auth: login endpoint with JWT (M, 3h)

**As a user**
**I want** to log in with email and password and receive a JWT
**So that** I can access protected endpoints

### Acceptance criteria
- `POST /api/auth/login` accepts `{ email, password }`, returns `{ token, user: { id, email, fullName, roles } }` on success
- Password verified with `BCrypt.Net-Next` against `users.password_hash`
- JWT signed with HS256, contains: `sub` (user id), `email`, `roles` (array from `user_roles` join), `exp` (1 hour)
- JWT secret from `appsettings.Development.json` (insecure default fine for dev)
- 401 returned for bad credentials with the message `"Invalid email or password"` (deliberately doesn't distinguish)
- Endpoint is rate-limited to 5 attempts/minute per IP using `Microsoft.AspNetCore.RateLimiting`
- A `[Authorize]` attribute on a test endpoint returns 401 without a token, 200 with one

### Technical context
- Schema tables: `users`, `roles`, `user_roles`
- Use `BCrypt.Net-Next` NuGet package
- Use `Microsoft.AspNetCore.Authentication.JwtBearer`
- JWT validation parameters: ValidateIssuerSigningKey=true, ValidateLifetime=true, others=false (it's local-only dev)

### Done definition
- `curl -X POST /api/auth/login -d '{"email":"sales@nee.local","password":"nee2026"}'` returns a token
- Hitting any `[Authorize]` endpoint without a token returns 401
- Hitting it with the token returns 200
- Unit test for password verification, integration test for the login flow

### Claude Code prompt
```
Add JWT auth to the API:
1. NuGet packages: BCrypt.Net-Next, Microsoft.AspNetCore.Authentication.JwtBearer
2. POST /api/auth/login endpoint:
   - Accepts { email: string, password: string }
   - Looks up user by email, verifies password with BCrypt
   - On success: builds JWT with sub=user_id, email, roles (from user_roles join), 1h expiry
   - On failure: 401 with message "Invalid email or password"
   - Rate limit: 5/minute per IP using AddRateLimiter
3. Add JWT bearer auth middleware
4. JWT signing key in appsettings.Development.json under "Jwt:Secret" — make it a 64-char random string
5. Add a test endpoint GET /api/auth/me that requires [Authorize] and returns the current user's claims
6. Write unit test for password verification (pass and fail cases)
7. Write integration test using WebApplicationFactory for the login flow

Schema reference: users table has columns id, email, password_hash, full_name, created_at, updated_at.
roles table: id, name, description.
user_roles table: user_id, role_id (composite PK).
```

---

## Story E1-S5 — Angular shell with login page and protected route (M, 3h)

**As a user**
**I want** to see a login screen on first visit and be routed to a home page after auth
**So that** the app has a working entry point

### Acceptance criteria
- Angular routes: `/login` (public), `/` (protected, redirects to `/dashboard` after auth)
- Login page is a simple form with email + password + "Sign in" button, NEE branding minimal
- On submit, calls `POST /api/auth/login` via an `AuthService`
- JWT stored in `sessionStorage` (not localStorage — local-only dev, less risk)
- Protected route guard reads the token, redirects to `/login` if missing/expired
- Auth service has `login()`, `logout()`, `getCurrentUser()`, `isAuthenticated()` methods
- A simple home page at `/dashboard` that says "Welcome, {fullName}" and has a logout button
- The home page calls `GET /api/auth/me` to verify the token works end-to-end

### Technical context
- Use `HttpClient` with an interceptor that adds `Authorization: Bearer <token>` to all `/api/*` requests
- Use Angular's `inject()` instead of constructor injection (Angular 18 idiom)
- Angular proxy config to send `/api/*` to `localhost:5000`

### Done definition
- Visit `localhost:4200`, see login page, log in with `sales@nee.local` / `nee2026`, land on dashboard with name displayed
- Click logout, return to login
- Refresh after login: still authenticated (token in sessionStorage)
- Refresh after logout: redirected to login

### Claude Code prompt
```
In /web (Angular 18 standalone), add:
1. Angular proxy config (proxy.conf.json) routing /api/* to http://localhost:5000
2. AuthService (Injectable, providedIn root) with:
   - login(email, password): Promise<User>
   - logout(): void
   - getCurrentUser(): User | null
   - isAuthenticated(): boolean
   - getToken(): string | null
   Stores JWT in sessionStorage as "nee.token", user info as "nee.user".
3. AuthInterceptor (HttpInterceptorFn) adding Authorization: Bearer header to /api/* calls
4. authGuard (CanActivateFn) that redirects to /login if not authenticated
5. LoginComponent at /login: standalone, reactive form, NEE branding minimal (just text "NEE Production Platform"), email + password + Sign in button. On submit, call AuthService.login, on success navigate to /dashboard.
6. DashboardComponent at /dashboard: protected by authGuard. Shows "Welcome, {{user.fullName}}" and a logout button. On init, calls GET /api/auth/me to verify token.
7. Routes config: /login (LoginComponent), /dashboard (DashboardComponent + authGuard), / redirects to /dashboard.
Verify: visit localhost:4200, get redirected to /login, log in, see welcome message.
```

---

## Story E1-S6 — Repo docs: ADR + glossary + this backlog (S, 2h)

**As a developer joining the project**
**I want** an ADR explaining the stack choice and a glossary of domain terms
**So that** I can ramp up without asking the same questions everyone else asked

### Acceptance criteria
- `/docs/adr/0001-stack-choice.md` — one-page Markdown ADR with: context, decision, alternatives considered, consequences. Covers .NET 10, Postgres, Angular, in-app auth, no Azure.
- `/docs/glossary.md` — 20+ domain terms keyed to schema tables. Each term gets: name, definition, schema reference, example.
- `/docs/backlog.md` — this file
- All three committed to `main` before any feature work starts

### Glossary terms (minimum)
RO, Job task, Operation, Operation catalog, Operation alias, Template, Template version, Customer variant, Body type, Job type, Station, Technician, Kanban stage, Hospital zone, Time entry, Variance, Variance reason, Drafting status, Domain event, Attachment.

### Done definition
- All three docs in `/docs/`, committed
- Both devs have read them

### Claude Code prompt
```
Create three documentation files:

1. /docs/adr/0001-stack-choice.md — single-page ADR using the standard ADR template (Status, Context, Decision, Alternatives Considered, Consequences). The decisions:
   - .NET 10 + C# 14 (LTS until Nov 2028; alternatives: .NET 9 STS, Node.js)
   - PostgreSQL 16 (alternatives: SQL Server, MySQL)
   - Angular 18 standalone (alternatives: React, Vue)
   - In-app JWT auth, NOT Azure AD/Entra (local-only MVP scope)
   - Local Docker only, no cloud deploy in MVP scope (deferred to post-MVP)
   For each, write 2-3 sentences of context and the rejected alternatives with one-line reasons.

2. /docs/glossary.md — definitions of NEE domain terms. Each entry has: term name (h3), one-paragraph definition, schema reference (table.column), example. Cover at minimum these 20 terms: RO, Job task, Operation, Operation catalog, Operation alias, Template, Template version, Customer variant, Body type, Job type, Station, Technician, Kanban stage, Hospital zone, Time entry, Variance, Variance reason, Drafting status, Domain event, Attachment.

3. /docs/README.md — index of the docs folder.

Write in plain prose, not bullet-heavy. The audience is a senior developer joining the project for 2 weeks of work.
```

---

# Epic E2 — Sales: RO from template

> **Priority:** P0 · **Owner:** Dev B · **Days:** 2–4 · **Total estimate:** 22 hours

This is the entry point of the entire system. Sales picks a template, fills in customer/vehicle, hits Create, and the system materialises a full RO with 12+ task records ready for the floor. This epic exercises the most domain logic of any epic. Get it right and the rest of the system follows.

## Story E2-S1 — Domain layer: template materialisation logic (M, 4h)

**As the system**
**I want** a service that, given a template code and RO header data, produces an RO record plus all task records
**So that** sales can create a complete RO in one transaction

### Acceptance criteria
- `RoMaterialisationService` with method `Task<RoMaterialisationResult> MaterialiseAsync(MaterialiseRoCommand cmd, CancellationToken ct)`
- `MaterialiseRoCommand` includes: customerId, jobTypeId, bodyTypeId, vin, rego, makeModel, paint, requiredDate, priority, templateCode (or null for manual), createdByUserId
- For a known templateCode (`TP42N` or `DFE-TT67F`):
  - Look up the latest active `template_versions` row
  - Read all `template_operations` for that version, ordered by sequence
  - For each, create a `job_tasks` row with: stationId from operation_catalog.default_station_id, estimatedHours from template_operations, sequenceNumber, status='pending'
  - Create the `repair_orders` row with auto-generated ro_number ('RO' + 5-digit sequence), status='draft', drafting_status='NDR'
  - Wrap everything in a single transaction
- Returns `RoMaterialisationResult` with the new RO id, ro_number, and count of tasks created
- Throws `TemplateNotFoundException` if templateCode doesn't match an active template
- Throws `ValidationException` with a list of validation errors if customer/vehicle data is invalid
- Writes a `domain_events` row with event_type='RoCreated' and event_data as JSONB

### Technical context
- Schema tables: `repair_orders`, `job_tasks`, `template_versions`, `template_operations`, `operation_catalog`, `customers`, `body_types`, `job_types`, `domain_events`
- Use EF Core's `IDbContextTransaction` for atomicity
- Use `Guid.NewGuid()` for IDs
- ro_number generation: query MAX(ro_number) and increment, OR use a Postgres sequence — recommend a sequence for race safety
- Validation rules: VIN must be 17 chars, rego required, customerId must exist, requiredDate must be in the future

### Done definition
- Unit test with mocked DbContext (use InMemory provider) covers happy path
- Integration test using TestContainers + real Postgres covers: create RO from TP42N template → verify 12 task records exist with correct station assignments
- Test for TemplateNotFoundException
- Test for ValidationException with invalid VIN

### Claude Code prompt
```
Create the RO materialisation domain service in the API project:

1. Add a new project folder /api/Domain/Sales/
2. Create RoMaterialisationService.cs with a single method:
   public async Task<RoMaterialisationResult> MaterialiseAsync(MaterialiseRoCommand cmd, CancellationToken ct)

3. MaterialiseRoCommand has fields: CustomerId, JobTypeId, BodyTypeId, Vin, Rego, MakeModel, Paint, RequiredDate, Priority (1-3), TemplateCode (string?), CreatedByUserId

4. RoMaterialisationResult has: RoId (Guid), RoNumber (string), TasksCreated (int)

5. Logic:
   - Validate inputs (VIN 17 chars, rego required, customerId exists, requiredDate > today). Throw ValidationException with field errors.
   - If TemplateCode provided: query template_versions WHERE template_code = ? AND is_active = true ORDER BY version_number DESC LIMIT 1. If not found, throw TemplateNotFoundException.
   - Generate ro_number: use a Postgres sequence "ro_number_seq" — call CreateSequenceIfNotExists in a migration first
   - Within a transaction:
     a. INSERT into repair_orders (id, ro_number, customer_id, ..., status='draft', drafting_status='NDR')
     b. For each template_operations row (ordered by sequence_number):
        INSERT into job_tasks (id, ro_id, sequence_number, operation_id, station_id (from operation_catalog.default_station_id), estimated_hours, status='pending')
     c. INSERT into domain_events (event_type='RoCreated', event_data=jsonb_build_object(roId, roNumber, customerId, templateCode, taskCount))
   - Return result.

6. Add custom exceptions: TemplateNotFoundException, ValidationException (with FieldErrors property).

7. Write tests:
   - /api.Tests/Domain/Sales/RoMaterialisationServiceTests.cs
   - Use WebApplicationFactory for integration tests + Testcontainers.PostgreSql package
   - Tests: HappyPath_TP42N_Creates12Tasks, HappyPath_DFETT67F_Creates13Tasks, InvalidTemplate_Throws, InvalidVin_Throws, NoTemplate_CreatesEmptyRo

Schema reference for the tables involved: repair_orders, job_tasks, template_versions, template_operations, operation_catalog, customers, body_types, job_types, domain_events. Read /db/migrations/001_initial_schema.sql for exact columns.
```

---

## Story E2-S2 — API endpoint: POST /api/repair-orders (S, 2h)

**As sales**
**I want** an endpoint that creates an RO from the request payload
**So that** the Angular form has something to call

### Acceptance criteria
- `POST /api/repair-orders` accepts the same fields as `MaterialiseRoCommand` (camelCase JSON)
- Requires `[Authorize]` with role check (Sales or Admin)
- Returns 201 Created with `Location` header pointing to `/api/repair-orders/{id}` and body `{ id, roNumber, tasksCreated }`
- Returns 400 with field errors on validation failure
- Returns 404 if templateCode unknown
- Returns 422 with `{ message, fieldErrors }` on domain validation errors
- Logs the creation with structured logging including roNumber and userId

### Technical context
- Use Minimal API endpoint with `MapPost`
- Use `IValidator<CreateRoRequest>` (FluentValidation) for request shape validation; `RoMaterialisationService` handles domain validation
- Get current user id from JWT claims (`sub`)

### Done definition
- Integration test: POST creates RO, returns 201, GET by id (next story) returns it
- Integration test: missing required field returns 400
- Integration test: unknown templateCode returns 404

### Claude Code prompt
```
Add POST /api/repair-orders endpoint:

1. Create CreateRoRequest DTO matching MaterialiseRoCommand fields (use camelCase via JSON property naming)
2. Create CreateRoResponse: { id, roNumber, tasksCreated }
3. FluentValidation: install package, create CreateRoRequestValidator with rules (required fields, VIN format, etc.)
4. Endpoint:
   app.MapPost("/api/repair-orders", async (CreateRoRequest req, RoMaterialisationService svc, IValidator<CreateRoRequest> validator, ClaimsPrincipal user, CancellationToken ct) => {
     // validate request shape
     // map to MaterialiseRoCommand, set CreatedByUserId from user claims
     // call svc.MaterialiseAsync
     // return Results.Created($"/api/repair-orders/{result.RoId}", new CreateRoResponse(...))
   })
   .RequireAuthorization(p => p.RequireRole("Sales", "Admin"))
   .WithName("CreateRepairOrder")
5. Exception handling middleware that maps ValidationException → 422 with field errors, TemplateNotFoundException → 404
6. Write integration test using WebApplicationFactory: HappyPath, InvalidPayload_Returns400, UnknownTemplate_Returns404, NoAuth_Returns401, WrongRole_Returns403
```

---

## Story E2-S3 — API endpoint: GET /api/templates (S, 2h)

**As sales**
**I want** to fetch the list of available templates with operations preview
**So that** the template picker UI can render them

### Acceptance criteria
- `GET /api/templates` returns array of template summaries: `{ code, displayName, bodyType, customerVariant, totalHours, operationCount, latestVersion }`
- `GET /api/templates/{code}` returns full detail including all operations with sequence, name, hours, station name
- Both require `[Authorize]`
- Templates filtered to only `is_active = true`
- Search query param `?q=tautliner` does ILIKE match on `code`, `display_name`, and `body_type` name

### Technical context
- Schema: `template_versions` joined to `template_operations` and `operation_catalog`
- Use a SQL view or hand-written query — recommend just project EF Core for the list, raw SQL for the detail

### Done definition
- `curl /api/templates` returns the 2 seeded templates
- `curl /api/templates/TP42N` returns full detail with 12 operations

### Claude Code prompt
```
Add template query endpoints:

1. GET /api/templates: returns TemplateSummary[] with { code, displayName, bodyType, customerVariant (nullable), totalHours, operationCount, latestVersion }
   - Joins template_versions to body_types and customers (for variant)
   - Filters is_active = true, latest version per code
   - Optional ?q=string param does ILIKE on code/displayName/bodyType.name

2. GET /api/templates/{code}: returns TemplateDetail with summary fields PLUS operations[] array of { sequence, operationCode, operationName, estimatedHours, defaultStation, defaultStationCode }
   - 404 if code not found

3. Use EF Core projections (Select) to keep these efficient. Don't over-fetch.

4. Both endpoints [Authorize].

5. Tests: returns seeded templates, q filter works, detail returns 404 for unknown.

Schema: template_versions, template_operations, operation_catalog, body_types, customers, stations.
```

---

## Story E2-S4 — Sales screen: Angular component skeleton + customer/vehicle form (M, 4h)

**As sales**
**I want** a "New repair order" page with the customer and vehicle fields
**So that** I can capture the basic RO header

### Acceptance criteria
- Route `/sales/new-ro`, protected by `authGuard` and a new `roleGuard(['sales','admin'])`
- Page layout matches the demo's Sales scene: scene header + two-column grid
- Left panel: customer dropdown (populated from `GET /api/customers`), job type, VIN, rego, required date, priority, make/model, paint
- Reactive form with validation: VIN required and 17 chars, rego required, customer required, required date in future
- Submit button at the bottom right ("Create RO"), disabled until form valid
- Form posts to `/api/repair-orders` and on success navigates to `/sales/ro/{id}` (the next story creates this page)
- Validation errors display inline under each field
- API errors display in a top-of-form alert

### Technical context
- Use Angular Reactive Forms (`FormBuilder`)
- Create a `CustomerService` for `GET /api/customers` (this requires a tiny `customers` controller — add as part of this story)
- Use `inject(Router)` for navigation
- Style: copy the relevant CSS from the existing `nee_demo.html` Sales scene

### Done definition
- Visiting `/sales/new-ro` after logging in as `sales@nee.local` shows the form
- Sales role required: logging in as `tech1@nee.local` and visiting redirects to `/dashboard` with a flash message
- Filling all fields validly enables Submit
- Submitting calls the API and navigates to `/sales/ro/{id}` (404 page is fine for now if E2-S6 not done)

### Claude Code prompt
```
Create the Angular Sales / New RO page:

1. Route /sales/new-ro, protected by authGuard and a new roleGuard(['sales','admin'])
   - roleGuard: CanActivateFn that reads roles from AuthService and redirects to /dashboard if not allowed
2. NewRoComponent (standalone) with two-column layout:
   - Left panel: customer dropdown, job type dropdown, VIN, rego, required date (date input), priority (1-3 dropdown), make/model, paint
   - Right panel: empty for now (template picker comes in next story)
3. Reactive form (FormBuilder.group) with validators:
   - customer: required
   - jobType: required
   - vin: required, exactLength(17), pattern(/^[A-HJ-NPR-Z0-9]+$/)
   - rego: required
   - requiredDate: required, must be future
   - priority: required (1, 2, or 3)
4. CustomerService at /web/src/app/services/customer.service.ts: getAll() returns Observable<Customer[]>
5. Add API endpoint GET /api/customers (just SELECT id, name, code FROM customers, [Authorize])
6. Submit button at bottom: disabled when invalid, calls a service method that POSTs to /api/repair-orders, on success navigates to /sales/ro/{id}, on error shows alert at top
7. Style by copying the .panel, .form-row, .form-field, .btn-primary classes from the existing demo HTML's CSS into a shared /web/src/styles/_sales.scss

Test: form renders, validation works, submit POSTs and navigates.
```

---

## Story E2-S5 — Sales screen: template picker integration (M, 4h)

**As sales**
**I want** the right panel to show the template catalog and update operations preview when I pick one
**So that** I can pick the right template and see what's in it

### Acceptance criteria
- Right panel renders the search box and list of templates from `GET /api/templates`
- Search filters live as user types (debounced 200ms)
- Clicking a template selects it (visual highlight, dark card style) and fetches `GET /api/templates/{code}` for the operations preview
- Operations preview below shows: `[N more operations] · X stations · Y hrs total` plus first 3 and last 1 operation rows
- Selected template code is bound to the form's `templateCode` field
- "Create RO" button only enabled when form valid AND template selected (or explicitly skipped via a "create without template" link below)

### Technical context
- Create `TemplateService` with `getAll(query?)` and `getDetail(code)` methods
- Style: replicate `.template-card`, `.template-list`, `.ops-preview`, `.op-row` from the demo

### Done definition
- Pick TP42N → preview shows 12 operations totaling 53.5h
- Pick DFE-TT67F → preview shows 13 operations totaling 62.5h
- Search "tautliner" filters to DFE-TT67F only
- "Create RO" submits with templateCode, materialises full RO (verify task count in database)

### Claude Code prompt
```
Add template picker to the Sales / New RO page:

1. TemplateService at /web/src/app/services/template.service.ts:
   - getAll(query?: string): Observable<TemplateSummary[]>
   - getDetail(code: string): Observable<TemplateDetail>

2. In NewRoComponent's right panel:
   - Search input with debounce 200ms (use takeUntilDestroyed and switchMap)
   - List of TemplateSummary cards (.template-card class), clickable, selected card gets .selected class
   - On select: call getDetail(code), bind templateCode to form, show operations preview
   - Operations preview (.ops-preview): show first 3 ops, then "[N more operations]", then last 1 op. Total hours and station count in header.

3. Form gains templateCode field (optional). "Create RO" enables when form valid (templateCode optional but encouraged — show a hint "Pick a template or create empty RO" below).

4. Below the template list, a small link "Skip template — create empty RO" that clears the selection.

5. Style: copy .template-card, .template-list, .template-search, .ops-preview, .op-row classes from existing demo HTML.

Test: template list loads from API, search filters, picking shows preview, submit creates RO with right task count.
```

---

## Story E2-S6 — RO detail page (read-only) (M, 4h)

**As sales**
**I want** to land on a page after RO creation showing what was created
**So that** I have visual confirmation and a permalink

### Acceptance criteria
- Route `/sales/ro/{id}`, protected
- `GET /api/repair-orders/{id}` returns full RO with header, customer name, body type, total est. hours, all tasks (sequence, operation name, station, estimated hours, status)
- Page layout: scene header showing `RO {ro_number} · {customer_name}` and a status pill, then two-column: left = vehicle details, right = ordered list of tasks
- Each task row shows: sequence number, name, station, estimated hours, status pill
- A success toast appears on first load if URL has `?created=1` query param: "RO {ro_number} created with {n} tasks"
- "Back to list" link in top left

### Technical context
- Toast: borrow the toast CSS/JS from existing demo (we built this for the QC notification)
- For read-only pages, can use signal-based state (`signal()`, `computed()`) — Angular 18 idiom

### Done definition
- After creating an RO from E2-S5, redirected to this page with success toast
- Page shows all fields and all tasks correctly
- Refresh: data still loads, toast doesn't show again (only on `?created=1`)
- Direct link to `/sales/ro/{id}` works for any RO

### Claude Code prompt
```
Create the RO detail page:

1. Add API endpoint GET /api/repair-orders/{id}:
   - Returns RoDetailResponse: { id, roNumber, customer: {id, name}, jobType, bodyType, vin, rego, requiredDate, priority, status, draftingStatus, totalEstimatedHours (sum of tasks), createdAt, tasks: [{ id, sequenceNumber, operationCode, operationName, stationId, stationName, estimatedHours, actualHours, status }] }
   - 404 if not found
   - [Authorize]

2. Angular RoDetailComponent at /web/src/app/sales/ro-detail.component.ts:
   - Standalone, reads route param :id
   - Calls GET /api/repair-orders/{id} on init
   - Layout: scene header "RO {roNumber} · {customer.name}" + status pill, two-column:
     - Left: vehicle/customer info (VIN, rego, make/model, required date, paint)
     - Right: tasks list, each row showing sequence, operation name, station name, est hours, status pill
   - Reads ?created=1 query param: show success toast "RO {roNumber} created with {n} tasks" using a ToastService

3. ToastService: simple service that emits toast events. Implement a ToastContainerComponent placed in app.component that subscribes and renders toasts. Use existing demo's toast CSS classes.

4. Route /sales/ro/:id with authGuard.

5. Update E2-S5 success handler: navigate to `/sales/ro/${result.id}?created=1`.

6. Test: create RO end-to-end, land on detail page with toast, see all tasks with correct hours and stations.
```

---

## Story E2-S7 — End-to-end Playwright test for Slice 1 (S, 2h)

**As the team**
**I want** an automated test that walks the full Sales → Create → Detail flow
**So that** we know the slice works after every commit

### Acceptance criteria
- Playwright test in `/web/e2e/sales-create-ro.spec.ts`
- Logs in as `sales@nee.local`, navigates to `/sales/new-ro`
- Fills in customer/vehicle/template fields with realistic data
- Picks the TP42N template
- Submits, asserts URL changes to `/sales/ro/{id}?created=1`
- Asserts toast visible with "RO RO00001 created with 12 tasks" (exact ro_number depends on seed)
- Asserts task list has 12 rows
- Test runs in CI on every PR (when CI exists) and locally with `npm run e2e`

### Technical context
- Playwright config: webServer auto-starts API + web before tests
- Reset DB between tests using `make reset && make seed` in a `globalSetup`

### Done definition
- `npm run e2e` passes locally
- Both devs verify

### Claude Code prompt
```
Add Playwright E2E test for the Sales flow:

1. Install: cd /web && npm init playwright@latest (TypeScript, /e2e folder, no examples)
2. playwright.config.ts: webServer entries for API (cd ../api && dotnet run) and Angular (npm start), with sequential startup. globalSetup that runs `make reset && make seed` from project root.
3. /web/e2e/sales-create-ro.spec.ts:
   - test('sales creates RO from TP42N template', async ({ page }) => { ... })
   - Steps:
     a. Visit /login, fill email "sales@nee.local" + password "nee2026", click Sign in
     b. Wait for /dashboard, navigate to /sales/new-ro
     c. Select customer "Direct Freight Express", job type "New Build", body type "Tipper"
     d. Fill VIN "JALFRR90NN7004213", rego "TEST01"
     e. Set required date 30 days in future
     f. Set priority "3 — normal"
     g. Make/model "Isuzu FRR", paint "White"
     h. In template picker, search "tipper", click TP42N card
     i. Verify operations preview shows "12 operations · 53.5 hrs total"
     j. Click Create RO
     k. Wait for URL /sales/ro/<uuid>?created=1
     l. Assert toast text contains "12 tasks"
     m. Assert task list has 12 rows
     n. Assert first task's operation name contains "Material" (Material Processing)
4. Add npm script "e2e": "playwright test"
5. README update: instructions to run e2e locally.

Verify all 14 steps pass on a clean seed.
```

---

# Epics E3–E10 — overview only

Detailed stories for E3 onwards will be produced **at the start of each epic's day**, shaped to actual velocity learned from E1 and E2. This is deliberate — story specs written 10 days ahead are usually wrong because we haven't yet learned the project's quirks.

What follows is the **scope and acceptance criteria at the epic level** — enough to plan against, not so much that we lock ourselves into details prematurely.

## Epic E3 — Supervisor overview dashboard

**Priority:** P0 · **Owner:** Dev A · **Days:** 4–6 · **Stories:** 5 (~16h)

**Scope:** A live read-only dashboard showing all in-progress ROs, KPIs, station load, and a top-variance panel. Drill-through from any RO row goes to the Kanban view (E4).

**Capabilities to deliver:**
- KPI row: active ROs, hours scheduled vs utilised, in-hospital count, on-time %
- Station load panel: hours/week per station with visual bar (green/amber/red)
- Top variance panel: 5 operations with biggest +/- variance this week
- Active jobs table: RO list with customer, template, stage pill, hours, due date
- Auto-refresh every 30 seconds (polling, not WebSocket — defer to E7)

**Stories:** S1 dashboard layout + KPI calc API, S2 station load API + viz, S3 variance panel API + viz, S4 ROs table component, S5 polling refresh + integration test.

**Schema reference:** `repair_orders`, `job_tasks`, `time_entries`, `v_ro_summary`, `v_station_load`.

## Epic E4 — Kanban station view

**Priority:** P0 · **Owner:** Dev A · **Days:** 6–7 · **Stories:** 5 (~14h)

**Scope:** Each station gets a column; tasks for that station are cards, grouped by `kanban_stage`. Click-to-assign tech (no drag-and-drop in v1).

**Capabilities to deliver:**
- `GET /api/kanban` returns tasks grouped by station and stage
- Five-column board: Pending / In Progress / Hospital / On Hold / Complete
- Each task card shows: RO number, operation name, assigned tech, hours, status
- Click a task → drawer/modal with detail + "Assign technician" dropdown
- Assigning a tech updates `job_tasks.assigned_to_user_id` and refreshes
- Real-time refresh every 30s (same polling as E3)

**Stories:** S1 kanban API endpoint, S2 board layout component, S3 task card component + drawer, S4 assign-tech endpoint + UI, S5 polling integration test.

**Schema reference:** `job_tasks`, `ro_kanban_state`, `kanban_stages`, `station_technicians`.

## Epic E5 — Technician phone + variance

**Priority:** P0 · **Owner:** Dev B · **Days:** 5–7 · **Stories:** 6 (~18h)

**Scope:** Mobile-responsive task screen for a technician. Clock in, clock out, mark complete with variance auto-captured.

**Capabilities to deliver:**
- Route `/tech/tasks/{id}` (and `/tech` listing all assigned)
- Phone-styled layout (320px-ish max width even on desktop)
- Task header, spec, drawing pack/cutting list/BOM stub buttons
- Big Clock In button → creates `time_entries` row
- Live timer showing elapsed
- Clock Out → closes the time entry, accumulates actual hours
- Pause / Add photo (uploads to `attachments` table) / Blocker buttons
- Mark Complete → opens variance reason picker if actual > 1.25 × estimate, else just closes
- Selecting reason creates `variance_records` row, task status → 'completed', triggers `kanban_stages` advance

**Stories:** S1 tech task list endpoint + view, S2 task detail view, S3 clock in/out endpoints + UI, S4 photo upload (multipart, store on disk for v1), S5 mark complete + variance modal, S6 blocker reporting (sets `repair_orders.is_in_hospital = true`).

**Schema reference:** `job_tasks`, `time_entries`, `variance_records`, `variance_reasons`, `attachments`, `repair_orders`.

## Epic E6 — QC + email

**Priority:** P0 · **Owner:** Dev B · **Days:** 8–9 · **Stories:** 5 (~14h)

**Scope:** Final QC checklist with photo grid; on submit, sends an email to the customer DL via local SMTP (Mailpit or similar).

**Capabilities to deliver:**
- Route `/tech/qc/{roId}` for a special "Final QC" task
- 6-item compliance checklist with checkboxes
- Photo grid (uses `attachments` from E5-S4)
- Email preview pane showing To, Cc, Subject, body, attachments
- "Pass & send" button: status → completed, sends email via local SMTP, captures email-sent record in `domain_events`

**Local SMTP:** Use Mailpit container (port 1025 SMTP, 8025 web UI for inspecting sent mail). Devs view sent emails in Mailpit's web UI.

**Stories:** S1 QC checklist data model + API, S2 QC component layout + checklist, S3 photo grid integration, S4 email preview + composer, S5 SMTP integration + Mailpit setup.

**Schema reference:** `repair_orders` (status, blue_plate fields), `attachments`, `domain_events`.

## Epic E7 — Notifications (in-app toasts)

**Priority:** P0 · **Owner:** Dev A · **Days:** 9–10 · **Stories:** 4 (~10h)

**Scope:** In-app toasts plus a bell icon with unread count. Trigger on RO creation, task completion, blocker reported, QC passed.

**Capabilities to deliver:**
- Notification model in DB (we may need to add a `notifications` table — extend the schema)
- `GET /api/notifications` for current user, unread first
- `POST /api/notifications/{id}/read` to mark read
- Bell icon in header with badge counter (poll every 15s)
- Toast component that pops on new notifications since last poll
- Domain event handlers fan out to notifications based on event type and recipient roles

**Stories:** S1 notifications schema migration + service, S2 fan-out from domain events, S3 bell + dropdown + badge, S4 toast component + polling integration.

**Schema reference:** Add new `notifications` table; read `domain_events`, `users`, `roles`.

## Epic E8 — Supervisor reports

**Priority:** P0 · **Owner:** Dev A · **Days:** 9–10 · **Stories:** 4 (~10h)

**Scope:** Two real reports — Throughput and Estimate Calibration — backed by the existing views. The other 3 report families show as "coming soon" cards in the demo (deferred to Phase 2).

**Capabilities to deliver:**
- Sub-tab "Reports" within Supervisor (E3 needs the tab structure first)
- Throughput report: ROs completed/in-progress/blocked by week, last 12 weeks (chart)
- Calibration report: per-template, per-operation actual vs estimate (table + bars)
- Three placeholder cards (Variance Root Cause / Customer Concentration / Strategic Forecasting) with "Phase 2" tags

**Stories:** S1 reports tab structure + placeholders, S2 throughput report API + chart, S3 calibration report API + visualization, S4 export-to-CSV for both.

**Schema reference:** `v_template_calibration`, `v_ro_summary`, `repair_orders`, `job_tasks`, `time_entries`, `variance_records`.

## Epic E9 — Sales PDF upload + extract (P1 STRETCH)

**Priority:** P1 stretch · **Owner:** Dev B · **Days:** 8–10 only if E2–E5 all green · **Stories:** 5 (~16h)

**Scope:** Upload an existing RO PDF, extract structured data, present for review and confirm. Without Document Intelligence (which is cloud), use a **deterministic regex-based parser** for the NEE PDF format we have (4 examples uploaded).

**Why P1:** The pure-OCR/AI-extraction path is the dream, but the regex parser path is achievable in 16h because all four sample PDFs share a consistent header layout and code/hours/description column structure. It demonstrates the capability convincingly without depending on Document Intelligence.

**Capabilities to deliver:**
- Drop-zone for PDF upload
- Server-side regex parser using `iText7` for PDF text extraction
- Review screen showing parsed fields with confidence pills (deterministic match = 100%, fuzzy match = 80%, no match = "needs review")
- "Confirm & create" submits as a regular RO via E2's materialisation service

**Stories:** S1 file upload endpoint + storage, S2 PDF parser service for the NEE format, S3 confidence scoring rules, S4 review pane component (re-style E2's create page), S5 confirm flow integrating with materialisation.

**Schema reference:** `attachments`, `repair_orders`, plus existing E2 services.

## Epic E10 — Supervisor scheduling (P1 STRETCH)

**Priority:** P1 stretch · **Owner:** Dev A · **Days:** 8–10 only if E3–E4 done by day 7 · **Stories:** 5 (~14h)

**Scope:** A scheduling sub-tab showing the backlog with three readiness gates per RO, plus a 4-week capacity heatmap.

**Why P1:** Requires a `chassis_inventory` table addition we haven't designed yet, plus a `customer_approvals` table for tracking signed layouts. The model design is the risk.

**Capabilities to deliver:**
- Chassis inventory table + CRUD for it (data entry only, no integrations)
- Readiness gate logic: `repair_orders.drafting_status = 'COMPLETED'` AND `customer_approvals.signed_at IS NOT NULL` AND `chassis_inventory.allocated_to_ro_id = ro.id`
- Backlog table with three traffic-light gates per row
- Capacity heatmap: planned hours per station per week for next 4 weeks
- "Schedule" button enabled when all 3 gates green; updates `repair_orders.scheduled_start_week`

**Stories:** S1 chassis_inventory + customer_approvals migration, S2 readiness gate computed view, S3 backlog table component + gates, S4 capacity heatmap query + viz, S5 schedule action.

**Schema reference:** Adds `chassis_inventory`, `customer_approvals`. Reads `repair_orders`, `job_tasks`, `template_operations`, `stations`.

---

# Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Domain logic in E2-S1 takes longer than 4h due to edge cases | High | Medium | Pair on it day 2; have Claude Code write extensive tests first |
| Postgres on Docker has connection issues in dev | Medium | Low | Test in E1-S2; document fallback to local Postgres |
| Angular 18 standalone-component patterns slow down a dev unfamiliar with them | Medium | Medium | Pair on E1-S5; don't try to use NgModule in places |
| E5 photo upload introduces filesystem storage assumptions that break on Windows | Low | Medium | Use `IFormFile` to a configured base path; test on both devs' machines |
| E9 PDF parser regex too brittle for one of the 4 sample PDFs | Medium | Low | Test against all 4 in CI; if 1 fails, mark as known limitation |
| E10 chassis model design takes more than allotted time | High | Low | Stretch goal anyway; cut without remorse if E10-S1 takes >3h |
| Mailpit container conflicts with existing local services | Low | Low | Use ports 1025/8025 (defaults); document overrides |
| Auth not being Entra/AD blocks "production-quality" perception in demo | Low | High | ADR explicitly calls out the deferral with the timeline; mention in demo if asked |

---

# What's not in this backlog (Phase 2 candidates)

These would be the next 2-week sprint after MVP demo, in priority order:

1. Azure deployment (App Service + Postgres Flexible Server + Bicep IaC + GitHub Actions deploy)
2. Drag-and-drop on the kanban (replacing click-to-assign)
3. Real Azure Document Intelligence integration for PDF extraction (replacing regex)
4. Notifications via Web Push API (real OS-level notifications on phones)
5. Email attachments served from blob storage instead of local disk
6. Multi-environment (dev / staging / prod)
7. Audit log UI on top of `domain_events`
8. The remaining 3 report families (Variance Root Cause, Customer Concentration, Strategic Forecasting)
9. Mobile PWA wrapper for the technician phone view (offline support, install-to-home-screen)
10. Variance reason hierarchy expansion + supplier scorecards
