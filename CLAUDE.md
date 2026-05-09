# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Prerequisites

Docker, .NET 10 SDK, Node.js 20+, GNU make (via Git Bash / WSL on Windows).

## Common Commands

```bash
make up          # Start Postgres + Mailpit in Docker
make dev         # Run API (:5000) + Angular (:4200) concurrently
make test        # dotnet test + npm test
make reset       # Destroy DB volume and recreate from all migrations
make seed        # Reload seed data into running Postgres (runs 002_seed_data.sql)
make hash-pw     # Re-hash all user passwords via /api/dev/reseed-passwords (needs API running)
make verify      # Smoke-check connectivity and seed state
```

**Single .NET test class:**
```bash
dotnet test api.tests/ --filter "FullyQualifiedName~SchedulingEndpointTests"
```

**Angular unit tests (no watch):**
```bash
cd web && npx ng test --watch=false
```

**Playwright E2E** (requires `make dev` running):
```bash
cd web && npx playwright test
```

`http://localhost:5000/swagger` — OpenAPI UI (dev only)  
`http://localhost:8025` — Mailpit email capture

## Architecture

Monorepo: `api/` (.NET 10) · `web/` (Angular 18) · `db/` (SQL migrations + Docker Compose).

### API

Minimal APIs only — no MVC controllers. All endpoints live in `api/Endpoints/` (one file per domain area: Auth, Kanban, Tech, Scheduling, Reports, etc.) and are registered in `Program.cs` via `Map*Endpoints()` extension methods.

- `api/Domain/` — POCO entities, no logic
- `api/Data/NeeDbContext.cs` — all EF mappings use Fluent API; snake_case naming convention via `UseSnakeCaseNamingConvention()`
- Auth: JWT Bearer HS256; login rate-limited at **5 req/min (fixed window)**
- Roles: `ADMIN SALES DRAFTER SUPERVISOR STATION_OWNER TECHNICIAN QC VIEWER`

### Web

Angular 18 standalone components (no NgModule). State is managed with `signal()` and `computed()` — no RxJS subjects or NgRx. `/api/*` proxied to `:5000` via `proxy.conf.json`.

Feature folders: `auth/` `dashboard/` `kanban/` `sales/` `tech/` `admin/` `core/`

**Theme system**: Two themes (`light` default, `saas`) toggled via `data-theme` on `<html>`. All colour values are CSS custom properties in `web/src/styles.css` — feature components must use `var(--paper)`, `var(--ink)`, `var(--topbar-*)` etc., never hardcoded hex/rgba. Theme state lives in `core/theme.service.ts` (signal + localStorage). `core/theme-switcher.component.ts` is a sun/moon toggle button that should be in every topbar's right-side actions.

**App shell**: Desktop routes are nested under `AppShellComponent` (`core/shell/`) via a parent route with `path: ''`. In SaaS theme it renders a 64px `SidebarComponent` + `<router-outlet>`; in light theme it falls through to a bare outlet so each feature renders its own topbar. The rule `[data-theme="saas"] .topbar { display: none; }` in styles.css hides feature topbars in SaaS mode without per-component changes. Mobile/standalone routes (`tech/*`, `_dev/*`, `login`) must be declared **before** the `path: ''` AppShell route in `app.routes.ts` — prefix matching on `''` swallows everything that comes after it.

### Database

PostgreSQL 16. Migrations are plain numbered `.sql` files in `db/migrations/` (currently `001`–`023`). **Never run `dotnet ef migrations add`** — EF Core is used only as a query layer. Add schema changes by creating a new numbered `.sql` file and applying it with `docker exec … psql`.

Docker Compose mounts the entire `db/migrations/` directory to `/docker-entrypoint-initdb.d`, so `make reset` automatically applies all files in order on a fresh volume.

Key tables: `repair_orders` → `job_tasks` (1:many) · `ro_kanban_state` · `time_entries` · `variance_records` · `chassis_inventory` · `customer_approvals` · `domain_events`

### Testing

`api.tests/` uses xUnit + Testcontainers: a real Postgres container is spun up per run, all migrations applied, and `WebApplicationFactory<Program>` handles in-process HTTP. Use `fixture.GenerateToken(userId, "ROLE")` to authenticate requests. No mocked database.

## Critical Constraints

**EF Core LINQ**: The C# index-from-end operator (`list[^1]`) is not supported in EF expression trees — extract to a local variable first.

**Npgsql 8.x + CITEXT**: The `email` column in `users` is `CITEXT`. In Npgsql 8.x, reading CITEXT columns via LINQ projections (`Select(u => new { u.Email })`) fails unless the app uses `NpgsqlDataSourceBuilder` instead of a raw connection string. `Program.cs` already does this; the test fixture's `CreateDbContext()` also uses a data source. Do not revert to `UseNpgsql(connectionString)` on either side.

**Angular popovers in scrollable tables**: `overflow-x: auto` on a container implicitly sets `overflow-y: auto` (CSS spec), clipping `position: absolute` children. Use `position: fixed` overlays anchored via `getBoundingClientRect()` stored in a `signal<DOMRect | null>`.

**Flexbox children that contain wide content**: Flex items default to `min-width: auto`, which lets a child grow as wide as its content. When a child contains horizontally scrolling regions (e.g. `min-width: max-content` kanban columns), the parent expands beyond the viewport unless the flex child has `min-width: 0`. `core/shell/app-shell.component.ts` sets this on `.shell-main` for that reason — keep it; removing it pushes feature page-headers off screen in SaaS mode.

**Theme-aware colours**: When editing component CSS, use the existing CSS variables (`var(--paper)`, `var(--paper-2)`, `var(--ink)`, `var(--ink-2)`, `var(--ink-3)`, `var(--accent)`, `var(--good/warn/bad/info)`, `var(--topbar-bg/text/muted/sub/border/hover)`, `var(--rule)`, `var(--rule-strong)`). Hardcoded `white`, `#f5f2ea`, `rgba(245,242,234,…)` etc. break the SaaS theme — see `card-drawer.component.ts` for the pattern of which colours stay solid (e.g. white task cards as cards-on-paper) versus which use tokens.

**After seeding**: Seed SQL uses a placeholder password hash. Always run `make hash-pw` after `make seed` or `make reset` before logging in.

## Seed Accounts

All passwords: `nee2026` (after `make hash-pw`). See `docs/seed-accounts.md` for the full 26-account roster.

| Username | Role |
|---|---|
| `supervisor` | Supervisor + Station Owner |
| `sales` | Sales |
| `drafter` | Drafter |
| `marcus` | Station Owner + Technician (station 10) |
| `peter` | Technician (station 20) |
| `greg` | Station Owner + QC (station 90) |

## Domain Language

- **RO** — Repair Order; top-level unit of work for one vehicle
- **Job Task** — One operation within an RO assigned to a technician at a station
- **Template / Template Version** — Reusable RO definition with operations and estimated hours
- **Kanban Stage** — RO lifecycle position (JOB_RECEIVED → … → FINAL_QC → COMPLETE; HOSPITAL for blocked)
- **Variance Record** — Estimated vs actual hours delta recorded on task completion
- **Gate** — Scheduling prerequisite (Draft complete · Customer approved · Chassis allocated)

See `docs/glossary.md` for full definitions · `docs/backlog.md` for the epic/story map · `docs/ro-lifecycle-flow.md` for the end-to-end RO flow.
