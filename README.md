# NEE Production Platform

Local-only MVP. .NET 10 API + Angular 18 + PostgreSQL 16, all running in Docker on your machine. No cloud accounts, no deploy pipeline — just clone, run, log in, build features.

## Quickstart (5 steps, ~10 minutes the first time)

### 1. Prerequisites

You need:
- **Docker** (or Docker Desktop) — for Postgres + Mailpit
- **.NET 10 SDK** — for the API. Download from https://dotnet.microsoft.com/download
- **Node.js 20+** — for the Angular dev server. Download from https://nodejs.org
- **GNU make** — for the convenience targets (Linux/macOS have it natively; Windows: install via WSL or Chocolatey)

Verify:
```bash
docker --version          # Docker version 24+ ideally
dotnet --version          # 10.0.x
node --version            # v20+
make --version            # GNU Make 4.x
```

### 2. Clone and install

```bash
git clone <your-repo-url> nee-platform
cd nee-platform
make install              # restores .NET packages and runs npm install
```

### 3. Start the database

```bash
make up                   # starts Postgres + Mailpit in background
```

The `001_initial_schema.sql` runs automatically on first boot via Docker's init mechanism. Postgres listens on `localhost:5432`, Mailpit's web UI is at `http://localhost:8025`.

### 4. Load seed data and start the services

```bash
make seed                 # loads 002_seed_data.sql (users, templates, etc.)
make dev                  # starts API + Angular together
```

This runs the API on `http://localhost:5000` and the Angular dev server on `http://localhost:4200`.

### 5. Hash the seed passwords and log in

The seed file uses placeholder password hashes (real password hashing has to happen in C#, not SQL). With the API running, in another terminal:

```bash
make hash-pw              # POSTs to /api/dev/reseed-passwords
```

Now visit `http://localhost:4200` and sign in:

| Username | Role | Password |
|---|---|---|
| `sales` | Sales (Brenton Coleby) | `nee2026` |
| `drafter` | Drafter (Hai Nguyen) | `nee2026` |
| `supervisor` | Supervisor + Station Owner (Dwayne Fender) | `nee2026` |
| `peter` | Technician (Peter Rogers) | `nee2026` |
| `kane` | Technician (Kane Bromhead) | `nee2026` |

You should land on the dashboard with a "Welcome, Brenton Coleby" message.

## What's in this repo

```
nee-platform/
├── api/                  .NET 10 minimal API project
│   ├── Domain/           Domain entities (User, Role, etc.)
│   ├── Data/             EF Core DbContext
│   ├── Endpoints/        Endpoint groups (Auth, Health, Dev)
│   └── Program.cs        Startup
├── web/                  Angular 18 standalone-component app
│   └── src/app/
│       ├── core/         AuthService, guards, interceptor
│       ├── auth/         Login screen
│       └── dashboard/    Post-login welcome screen
├── db/
│   ├── docker-compose.yml
│   └── migrations/
│       ├── 001_initial_schema.sql   (24 tables, 4 views — runs auto on first boot)
│       └── 002_seed_data.sql        (users, 3 templates, etc.)
├── docs/
│   ├── adr/0001-stack-choice.md     Architecture decision record
│   ├── glossary.md                  Domain term definitions
│   └── backlog.md                   Epics + user stories (the work plan)
└── Makefile              Convenience targets
```

## Common workflows

```bash
# Day-to-day development
make dev                  # starts everything you need

# Reset to a known clean state
make reset                # destroys all data, recreates schema, reloads seed
make hash-pw              # (after API is running) re-hash passwords

# Inspect outbound emails (E6 capability)
open http://localhost:8025  # Mailpit web UI

# Run all tests
make test
```

## Viewing the local database

Connect to the running Postgres container with psql:

```bash
docker exec -it nee-postgres psql -U nee -d nee
```

### Useful queries

```sql
-- All tables
\dt

-- Users and their roles
SELECT u.username, u.full_name, r.code AS role
FROM users u
JOIN user_roles ur ON ur.user_id = u.id
JOIN roles r ON r.id = ur.role_id
ORDER BY u.username, r.code;

-- Station roster (who is assigned to which station)
SELECT s.name AS station, u.full_name, st.is_primary
FROM station_technicians st
JOIN stations s ON s.id = st.station_id
JOIN users u ON u.id = st.user_id
ORDER BY s.sort_order;

-- Templates and their operation counts / total hours
SELECT t.code, tv.version_number, tv.total_estimated_hours,
       count(to2.id) AS operations
FROM job_code_templates t
JOIN template_versions tv ON tv.template_code = t.code
JOIN template_operations to2 ON to2.template_version_id = tv.id
GROUP BY t.code, tv.version_number, tv.total_estimated_hours
ORDER BY t.code;

-- All repair orders with status and task progress
SELECT ro.ro_number, c.name AS customer, ro.status,
       count(jt.id) AS tasks,
       count(jt.id) FILTER (WHERE jt.status = 'COMPLETED') AS done
FROM repair_orders ro
JOIN customers c ON c.id = ro.customer_id
LEFT JOIN job_tasks jt ON jt.ro_id = ro.id
GROUP BY ro.ro_number, c.name, ro.status
ORDER BY ro.ro_number;

-- Open time entries (who is currently clocked in)
SELECT u.full_name, jt.operation_name, te.clock_in
FROM time_entries te
JOIN users u ON u.id = te.user_id
JOIN job_tasks jt ON jt.id = te.task_id
WHERE te.clock_out IS NULL;

-- Kanban state for all ROs
SELECT ro.ro_number, ks.name AS current_stage
FROM ro_kanban_state rks
JOIN repair_orders ro ON ro.id = rks.ro_id
JOIN kanban_stages ks ON ks.id = rks.current_stage_id
ORDER BY ro.ro_number;
```

## What the seed data creates

The seed runs across four migration files applied in order:

### `002_seed_data.sql` — users, roles, station roster, templates

**Users** (all login with password `nee2026` after `make hash-pw`):

| Username | Full Name | Role(s) |
|---|---|---|
| `sales` | Brenton Coleby | SALES |
| `drafter` | Hai Nguyen | DRAFTER |
| `supervisor` | Dwayne Fender | SUPERVISOR, STATION_OWNER |
| `peter` | Peter Rogers | TECHNICIAN |
| `kane` | Kane Bromhead | TECHNICIAN |

**Station roster:**
- Peter Rogers → Station 20 (Fabrication Line), primary technician
- Kane Bromhead → Station 30 (Paint), primary technician

**Job code templates** (used when Sales creates a new RO):

| Code | Name | Operations | Total Hours |
|---|---|---|---|
| `TP42N` | Tipper 4.2m NPR | 12 | 53.5h |
| `TT67F` | Tautliner 6.7m FRR | — | base template only |
| `DFE-TT67F` | Tautliner 6.7m FRR — Direct Freight Express | 13 | 62.5h |

A `TP42N` RO generates tasks spanning stations 10 (CNC), 20 (Fab Line), 30 (Paint), 40 (Body Fitout), 70 (Fitment), and 90 (QC). A `DFE-TT67F` RO adds stations 40 and 50 (Chassis Prep).

### `003_ro_number_seq.sql` — RO number sequence

Creates the `ro_number_seq` Postgres sequence that generates human-readable RO numbers (`RO00001`, `RO00002`, …). Safe under concurrent inserts.

### `004_e4_station_owner_seed.sql` — Adam Miller

Adds a dedicated STATION_OWNER account for testing the kanban assign workflow:

| Username | Full Name | Role | Station |
|---|---|---|---|
| `adam` | Adam Miller | STATION_OWNER | Station 40 (Body Fitout) |

Adam is also rostered as a primary technician at station 40 so he can be assigned tasks there.

## API surface today

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/health` | Liveness check |
| `GET` | `/api/health/ready` | Readiness incl. DB connection |
| `POST` | `/api/auth/login` | Returns JWT + user info (rate-limited 5/min) |
| `GET` | `/api/auth/me` | Returns the authenticated user (verifies token) |
| `POST` | `/api/dev/reseed-passwords` | Dev only — hash the seed passwords |

OpenAPI docs at `http://localhost:5000/swagger` when the API is running.

## What's next

This is the walking skeleton (Epic E1 from `docs/backlog.md`). Feature epics start at E2 — Sales creates an RO from a template. See `docs/backlog.md` for the full plan and `docs/adr/0001-stack-choice.md` for the architecture rationale.

## Troubleshooting

**`make seed` fails with "database does not exist".**
Run `make up` first; the database needs ~3 seconds to initialise on first boot.

**`make hash-pw` returns connection refused.**
The API isn't running yet. Run `make api` (or `make dev`) in another terminal first.

**Port 5432 / 5000 / 4200 / 8025 already in use.**
Stop the conflicting service or change the port in `db/docker-compose.yml` (Postgres/Mailpit) or `api/Properties/launchSettings.json` (API) or `web/package.json` start script (Angular).

**EF Core migration errors.**
This project doesn't use EF Core migrations — the schema is hand-rolled SQL. Run `make reset` to wipe and reapply.

**`The framework 'Microsoft.AspNetCore.App', version '10.0.0' was not found.`**
Install the .NET 10 SDK from https://dotnet.microsoft.com/download. The `global.json` (if present) pins a specific SDK; remove it if you want to use a different patch version.
