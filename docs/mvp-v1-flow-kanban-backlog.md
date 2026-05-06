# NEE Production Platform — MVP v1 · Flow-aware Grouped Kanban

> **Scope:** Re-shape the kanban around grouped per-RO-per-station cards, surface the source RO PDF on every card, and gate stage progression by the operational flow (Body / Chassis / Subframe tracks with merge points), per `docs/NE Operation flow.pdf` and the design at `design/pitch-demo-grouped-kanban.html`.
>
> **Builds on:** Phase 1 backlog (`docs/backlog.md`, E1–E10) and Phase 2 backlog (`docs/phase2-backlog.md`, E11–E20). All schema, endpoints, and components referenced below already exist and are cited with `file_path:line` so a developer can navigate directly.
>
> **Schema reference:** `db/migrations/001_initial_schema.sql` (24 tables) + 016 (override marker). New work begins at `017_flow_kanban.sql`.
>
> **For:** 2 developers, ~2 weeks, .NET 10 + Postgres + Angular 18. Local-only — no cloud rollout in this MVP.

---

## What changes vs today

| Today | After this MVP |
|---|---|
| One card per `job_task` in its station column (`web/src/app/kanban/task-card.component.ts`, `KanbanEndpoints.cs:14`) | One card per `(repair_order, station)` containing all that station's tasks for that RO |
| RO stage moves only via supervisor manual override (`KanbanEndpoints.cs:154`) | RO stage advances **automatically** when all blocking tasks at the current station complete; manual override stays as escape hatch |
| Source PDF URL only available on `/api/repair-orders/{id}` (`RepairOrderEndpoints.cs:209`) | Source PDF URL on every kanban card; inline preview in the drawer |
| All ROs follow one linear stage list — no parallelism | ROs follow a per-body-type flow with parallel `BODY` / `CHASSIS` / `SUBFRAME` tracks that converge at merge points (`FINAL_FITMENT` 70, `COMPLIANCE_QC` 90) |
| `kanban_stages` and `stations` already seeded — no station/stage rename needed | Same stages and stations; only new metadata is added |

The grouping change is breaking on the wire. Everything else is additive.

---

## How to use this document

Same conventions as Phase 1 (`docs/backlog.md`) and Phase 2 (`docs/phase2-backlog.md`). Each story carries:

- A user-story sentence (As / I want / So that)
- Acceptance criteria — what "works" means
- Technical context — files to touch, traps to avoid (CITEXT, snake_case, signal-based state, etc.)
- Done definition — what the developer demonstrates to their pair before merging
- A Claude Code prompt — copy-paste ready

**Story sizing:**
- **S** = Small, ~2 hours
- **M** = Medium, ~4 hours
- **L** = Large, ~6 hours (split if it grows)

**Priority:**
- **P0** = Must-ship for MVP v1
- **P1** = Stretch — drop without remorse if days 8–9 are tight

---

## The 6 epics, sequenced by dependency

| # | Epic | Priority | Owner | Days | Dependencies | Stories |
|---|---|---|---|---|---|---|
| E21 | Flow-aware schema foundation | **P0** | Both pair days 0–1 | 0–1 | E1, E2, E4 | 5 |
| E22 | Grouped kanban API + UI | **P0** | Dev A | 2–4 | E21 | 5 |
| E23 | PDF link & preview on every card | **P0** | Dev A | 4–5 | E22, E9 | 4 |
| E24 | Auto stage advance + gating | **P0** | Dev B | 3–6 | E21, E5 | 5 |
| E25 | Operational flow visualisation | **P1** | Dev A | 6–7 | E21, E22 | 3 |
| E26 | Rollout, parity, decommission | **P0** | Both | 7–9 | E22, E24 | 3 |

**Total: ~25 stories · ~80 hours · ~10 person-days.** Two devs × 10 days × ~2.5 stories/day each.

---

## Work split

**Dev A — board & visualisation:** Schema (paired day 0), grouped kanban API + UI, PDF preview drawer, flow ribbon, decommission cleanup.

**Dev B — gating & lifecycle:** Schema (paired day 0), backfill, template materialisation update, gate computation, auto-advance event handler, force-advance escape hatch.

Day 0–1 they pair on E21 because the migration shape determines the projection shape, the gate algorithm, and the seed of `flow_definitions`. After that they work in parallel and meet at three integration points:

1. **E22-S1 ↔ E24-S1**: Dev A's grouped DTO must include the `gateState` field that Dev B computes. Agree on field names and enum values before either codes. See E22-S1's "Wire contract" below.
2. **E24-S2 ↔ E22-S3**: Auto-advance must invalidate the kanban cache so the board refreshes within a SignalR push. Decide whether to push the whole grouped column or just the affected card.
3. **E24-S3 ↔ E25-S1**: Merge-point semantics need a shared helper `FlowGraph.IsReadyAt(roId, stationId)` that both the gate computation and the flow visualisation call.

---

## Daily rhythm

Morning: pull `main`, pick stories, write today's planning paragraph. Mid-day: execute, review every diff. End of day: merge with full test suite green, demo the new flow to your pair.

---

# Epic E21 — Flow-aware schema foundation

> **Priority:** P0 · **Owner:** Both (pair) · **Days:** 0–1 · **Total estimate:** 14 hours

The migration that lets every later story exist. Adds three columns and one table, seeds the flow definitions for the eight body types in the operations PDF, and backfills existing data without breaking the live kanban. Nothing user-visible changes after this epic — but every later story depends on these shapes being right.

## Story E21-S1 — Migration `017_flow_kanban.sql` — schema additions (M, 4h)

**As a developer**
**I want** new columns on `job_tasks`, `repair_orders`, and `kanban_stages` plus a `flow_definitions` table
**So that** the grouped kanban can compute gate state and show track lanes

### Acceptance criteria
- New file `db/migrations/017_flow_kanban.sql`, idempotent (uses `ADD COLUMN IF NOT EXISTS` and `ON CONFLICT`)
- `job_tasks` gets `flow_track TEXT NOT NULL DEFAULT 'BODY'` with `CHECK (flow_track IN ('BODY','CHASSIS','SUBFRAME','ANY'))`
- `repair_orders` gets `body_type TEXT NULL` with no FK (it references the seed list in story E21-S2)
- `kanban_stages` gets `is_merge_point BOOLEAN NOT NULL DEFAULT FALSE`
- After this migration runs:
  - `UPDATE kanban_stages SET is_merge_point = TRUE WHERE id IN (70, 90)` — Final fitment B2 and Compliance/Final QC are merges
- New table `flow_definitions`:
  ```sql
  CREATE TABLE flow_definitions (
      id          SERIAL PRIMARY KEY,
      body_type   TEXT NOT NULL,
      track       TEXT NOT NULL CHECK (track IN ('BODY','CHASSIS','SUBFRAME')),
      station_id  SMALLINT NOT NULL REFERENCES stations(id),
      sort_order  SMALLINT NOT NULL,
      is_optional BOOLEAN NOT NULL DEFAULT FALSE,
      UNIQUE (body_type, track, sort_order),
      UNIQUE (body_type, track, station_id)
  );
  CREATE INDEX ix_flow_definitions_body_type ON flow_definitions(body_type);
  ```
- Index on `job_tasks(ro_id, station_id)` to keep the grouped query cheap; the existing index on `ro_id` alone is not enough
- Migration is safely re-runnable in dev (`make reset` → 017 applies cleanly on a fresh volume)

### Technical context
- Snake_case via `UseSnakeCaseNamingConvention()` is already configured (`api/Data/NeeDbContext.cs`); domain entity property names will be PascalCase, EF will translate
- Add the migration **only as a `.sql` file**. Do NOT run `dotnet ef migrations add` — see CLAUDE.md "Critical Constraints"
- Docker Compose mounts `db/migrations/` to `/docker-entrypoint-initdb.d`, so a fresh volume picks this up automatically; in dev, apply manually with `docker exec nee-db psql -U postgres -d nee -f /docker-entrypoint-initdb.d/017_flow_kanban.sql`
- The `body_type` column on `repair_orders` is nullable for now; E21-S4 backfills it. We'll tighten to NOT NULL once backfill is verified

### Done definition
- `make reset` produces a DB that has all three new columns and the empty `flow_definitions` table
- `\d job_tasks` shows `flow_track` with the CHECK constraint
- `SELECT id, code, is_merge_point FROM kanban_stages WHERE is_merge_point;` returns `(70, FINAL_FITMENT, true)` and `(90, COMPLIANCE_QC, true)`
- Existing test suite (`dotnet test`) green — no entity reads/writes break

### Claude Code prompt
```
Create db/migrations/017_flow_kanban.sql, idempotent, doing all of:

1. ALTER TABLE job_tasks ADD COLUMN IF NOT EXISTS flow_track TEXT NOT NULL DEFAULT 'BODY'
   CHECK (flow_track IN ('BODY','CHASSIS','SUBFRAME','ANY'));

2. ALTER TABLE repair_orders ADD COLUMN IF NOT EXISTS body_type TEXT NULL;

3. ALTER TABLE kanban_stages ADD COLUMN IF NOT EXISTS is_merge_point BOOLEAN NOT NULL DEFAULT FALSE;
   UPDATE kanban_stages SET is_merge_point = TRUE WHERE id IN (70, 90);

4. CREATE TABLE IF NOT EXISTS flow_definitions (
       id          SERIAL PRIMARY KEY,
       body_type   TEXT NOT NULL,
       track       TEXT NOT NULL CHECK (track IN ('BODY','CHASSIS','SUBFRAME')),
       station_id  SMALLINT NOT NULL REFERENCES stations(id),
       sort_order  SMALLINT NOT NULL,
       is_optional BOOLEAN NOT NULL DEFAULT FALSE,
       UNIQUE (body_type, track, sort_order),
       UNIQUE (body_type, track, station_id)
   );
   CREATE INDEX IF NOT EXISTS ix_flow_definitions_body_type ON flow_definitions(body_type);

5. CREATE INDEX IF NOT EXISTS ix_job_tasks_ro_id_station_id ON job_tasks(ro_id, station_id);

Do NOT seed flow_definitions in this file — that's E21-S2's responsibility.

After authoring, run docker exec to apply, then \d job_tasks and \d kanban_stages to confirm.
```

---

## Story E21-S2 — Migration `018_flow_definitions_seed.sql` (M, 4h)

**As a developer**
**I want** the eight body types from the operations PDF seeded into `flow_definitions`
**So that** the gate computation in E24 has data to walk

### Acceptance criteria
- New file `db/migrations/018_flow_definitions_seed.sql`, idempotent via `ON CONFLICT (body_type, track, sort_order) DO NOTHING`
- Seeds exactly the eight body types from `docs/NE Operation flow.pdf`:
  - `TRAY`, `TAUTLINER`, `BEAVERTAIL` — single-track (BODY) flows that all share the same shape
  - `CHIPPER_TIPPER_TRAY_CRANE` — split BODY/CHASSIS/SUBFRAME with merge at FINAL_FITMENT then COMPLIANCE_QC
  - `TIPPER_CS` — same shape as above, used as the canonical Tipper C/S example
  - `PANTECH_STEEL` — single track BODY ending at COMPLIANCE_QC via the `PANTECH` station (id 80)
  - `PANTECH_AL` — split BODY/CHASSIS, robotic fab + PANTECH, no Body Fitout B1
  - `TILT_SLIDER` — split BODY/CHASSIS/SUBFRAME, ends at HYVA fitment then COMPLIANCE_QC
  - `TRAILER` — split BODY/CHASSIS, robotic fab + paint + HYVA, ends at COMPLIANCE_QC
  - `BODY_SWAP` — minimal flow; CHASSIS_PREP → HYVA → FINAL_FITMENT → COMPLIANCE_QC
- Each row maps `(body_type, track, station_id)` to the existing seeded stations (10, 20, 25, 30, 40, 50, 60, 70, 80, 90); `sort_order` reflects PDF flow direction
- A SQL view `v_flow_steps` (read-only) joins `flow_definitions → stations → kanban_stages` for use by E25 visualisation; columns: `(body_type, track, sort_order, station_id, station_code, station_name, stage_id, stage_code, is_merge_point, is_optional)`

### Technical context
- The exact mapping comes from interpreting the PDF; cross-check with the demo HTML (`design/pitch-demo-grouped-kanban.html:899-940`) which captures the canonical Tipper C/S flow
- For the BODY track of TIPPER_CS, the sequence per the PDF is: `MATERIAL_PROC(10) → ROBOTIC_FAB(25) → PAINT_PANEL(30) → BODY_FITOUT(40) → FINAL_FITMENT(70) → COMPLIANCE_QC(90)`
- For the CHASSIS track: `CHASSIS_PREP(50) → HYVA(60) → FINAL_FITMENT(70) → COMPLIANCE_QC(90)`
- For the SUBFRAME track: `MATERIAL_PROC(10, optional) → PAINT_PANEL(30) → HYVA(60) → FINAL_FITMENT(70)` — note SUBFRAME track terminates at the merge, doesn't have its own QC row
- `is_optional = TRUE` only for stations the PDF marks parenthetically (rare); default false everywhere else
- `MATERIAL_PROC` (station 10) appears on both BODY and SUBFRAME tracks of split flows. That's intentional — the same physical station serves both tracks, gate logic must treat them as separate dependency chains keyed by `track`

### Done definition
- `SELECT body_type, COUNT(*) FROM flow_definitions GROUP BY 1 ORDER BY 1;` returns 8 rows, totals roughly: TRAY=5, TAUTLINER=5, BEAVERTAIL=5, CHIPPER_TIPPER_TRAY_CRANE=14, TIPPER_CS=14, PANTECH_STEEL=4, PANTECH_AL=8, TILT_SLIDER=12, TRAILER=10, BODY_SWAP=4
- `SELECT * FROM v_flow_steps WHERE body_type='TIPPER_CS' AND track='BODY' ORDER BY sort_order;` produces the exact six stations above in that order
- Re-running the migration is a no-op (no INSERTs, no errors)

### Claude Code prompt
```
Create db/migrations/018_flow_definitions_seed.sql:

1. INSERT INTO flow_definitions (body_type, track, station_id, sort_order, is_optional) VALUES
   -- one block per body_type, ordered, with comments referencing the PDF area
   ('TIPPER_CS','BODY',10,1,FALSE),
   ('TIPPER_CS','BODY',25,2,FALSE),
   ... (etc — derive from the PDF flow at docs/NE Operation flow.pdf interpreted via design/pitch-demo-grouped-kanban.html flow ribbon)
   ON CONFLICT (body_type, track, sort_order) DO NOTHING;

2. CREATE OR REPLACE VIEW v_flow_steps AS
   SELECT fd.body_type, fd.track, fd.sort_order, fd.station_id,
          s.code AS station_code, s.name AS station_name,
          ks.id AS stage_id, ks.code AS stage_code, ks.is_merge_point,
          fd.is_optional
   FROM flow_definitions fd
   JOIN stations s ON s.id = fd.station_id
   LEFT JOIN kanban_stages ks ON ks.sort_order = s.sort_order;

After authoring, verify with the queries in the Done definition above.
```

---

## Story E21-S3 — EF entities + DbContext mappings (S, 2h)

**As a developer**
**I want** the new columns and table represented in the C# domain
**So that** every later API change can use strongly-typed access

### Acceptance criteria
- `api/Domain/RepairOrder.cs` (existing): add `public string? BodyType { get; set; }` to `RepairOrder`; add `public string FlowTrack { get; set; } = "BODY";` to `JobTask`
- `api/Domain/Production.cs` (existing): add `public bool IsMergePoint { get; set; }` to `KanbanStage`
- New file `api/Domain/FlowDefinition.cs` with the entity:
  ```csharp
  public class FlowDefinition
  {
      public int Id { get; set; }
      public string BodyType { get; set; } = "";
      public string Track { get; set; } = "";
      public short StationId { get; set; }
      public short SortOrder { get; set; }
      public bool IsOptional { get; set; }
      public Station Station { get; set; } = null!;
  }
  ```
- `api/Data/NeeDbContext.cs`: add `public DbSet<FlowDefinition> FlowDefinitions => Set<FlowDefinition>();` and a `modelBuilder.Entity<FlowDefinition>` block configuring the unique indexes and the `Station` relationship
- The entity uses snake_case automatically — verify `flow_track` and `body_type` map to `FlowTrack`/`BodyType` without manual `[Column]` attributes
- Existing tests (`dotnet test`) still pass — no read/write breaks

### Technical context
- The unique indexes set in SQL must also be configured in EF so InMemory testing or generated migrations match. Use `HasIndex(x => new { x.BodyType, x.Track, x.SortOrder }).IsUnique();`
- Don't add a navigation from `RepairOrder` to `FlowDefinition` — flow is looked up by body_type, not by FK. Keep the relationships minimal
- Don't introduce a `FlowTrack` enum yet — let it be a string for now; a typed enum becomes friction at ORM boundaries with Npgsql

### Done definition
- A new `api.tests/FlowDefinitionEntityTests.cs` (one test) loads the seeded TIPPER_CS BODY chain and asserts six steps in order
- `dotnet build` and `dotnet test` both clean

### Claude Code prompt
```
Update the EF domain to match migrations 017 and 018:

1. api/Domain/RepairOrder.cs — add `public string? BodyType { get; set; }` to RepairOrder; add `public string FlowTrack { get; set; } = "BODY";` to JobTask.

2. api/Domain/Production.cs — add `public bool IsMergePoint { get; set; }` to KanbanStage.

3. New file api/Domain/FlowDefinition.cs with the entity above and a navigation to Station.

4. api/Data/NeeDbContext.cs — add the DbSet and the Entity configuration with unique indexes.

5. api.tests/FlowDefinitionEntityTests.cs — one test:
   var steps = await db.FlowDefinitions
       .Where(x => x.BodyType == "TIPPER_CS" && x.Track == "BODY")
       .OrderBy(x => x.SortOrder)
       .ToListAsync();
   Assert.Collection(steps, ...) — six expected stations in order.

Run: dotnet test api.tests/ --filter "FullyQualifiedName~FlowDefinitionEntityTests"
```

---

## Story E21-S4 — Backfill body_type and flow_track on existing data (S, 2h)

**As a developer**
**I want** every existing RO and JobTask to have a sensible `body_type` / `flow_track` value
**So that** the grouped kanban renders something for legacy data without 500s

### Acceptance criteria
- Script lives at `db/migrations/019_backfill_flow.sql` (idempotent, runs only against null values)
- Backfill rule: each `repair_orders` row gets `body_type = TIPPER_CS` if the linked `template_versions.template_code` starts with `TP`, `TAUTLINER` if it starts with `TT`, etc. Default `BODY_SWAP` if no template match
- Backfill rule: every `job_tasks` row whose `station_id` is in `(50, 60)` and whose RO has a split body type gets `flow_track = 'CHASSIS'`. Stations `(80)` PANTECH stays BODY. Everything else stays the default `BODY` (no UPDATE needed since DEFAULT applied at column add)
- A small post-backfill verification query in the migration prints `SELECT body_type, COUNT(*) FROM repair_orders GROUP BY 1` as a `RAISE NOTICE` so the operator sees the spread
- Once backfill is verified, a follow-on migration tightens `repair_orders.body_type` to NOT NULL — that's `020_body_type_not_null.sql` (P1 stretch — only ship if every RO in dev has a non-null value)

### Technical context
- The body-type-from-template-code mapping should live as a CASE expression in the SQL, not in C#. We won't have many template prefixes
- The `template_versions` table is the canonical place to derive body type from existing data. An RO without a template (rare) gets `BODY_SWAP`
- Don't backfill `flow_track` on every row — the column default already gave every existing task `BODY`. We only need to UPDATE for the chassis-track stations of split body types

### Done definition
- `SELECT COUNT(*) FROM repair_orders WHERE body_type IS NULL;` returns 0 on dev DB
- `SELECT flow_track, COUNT(*) FROM job_tasks GROUP BY 1;` shows BODY > 0 and CHASSIS > 0 (assuming the dev seed has any TP* templates)
- Re-running the migration prints the same NOTICE without error and changes nothing

### Claude Code prompt
```
Create db/migrations/019_backfill_flow.sql:

1. UPDATE repair_orders ro
   SET body_type = CASE
       WHEN tv.template_code LIKE 'TP%' THEN 'TIPPER_CS'
       WHEN tv.template_code LIKE 'TT%' THEN 'TAUTLINER'
       WHEN tv.template_code LIKE 'BT%' THEN 'BEAVERTAIL'
       WHEN tv.template_code LIKE 'TR%' THEN 'TRAY'
       WHEN tv.template_code LIKE 'PN%' THEN 'PANTECH_STEEL'
       WHEN tv.template_code LIKE 'PNAL%' THEN 'PANTECH_AL'
       WHEN tv.template_code LIKE 'TS%' THEN 'TILT_SLIDER'
       WHEN tv.template_code LIKE 'TL%' THEN 'TRAILER'
       ELSE 'BODY_SWAP'
   END
   FROM template_versions tv
   WHERE ro.template_version_id = tv.id AND ro.body_type IS NULL;

2. UPDATE job_tasks t
   SET flow_track = 'CHASSIS'
   FROM repair_orders ro
   WHERE t.ro_id = ro.id
     AND t.station_id IN (50, 60)
     AND ro.body_type IN ('TIPPER_CS','PANTECH_AL','TILT_SLIDER','TRAILER','CHIPPER_TIPPER_TRAY_CRANE','BODY_SWAP');

3. DO $$
   DECLARE r RECORD;
   BEGIN
       FOR r IN SELECT body_type, COUNT(*) AS n FROM repair_orders GROUP BY body_type
       LOOP RAISE NOTICE 'body_type=% count=%', r.body_type, r.n;
       END LOOP;
   END $$;

Verify with the SELECTs in Done definition.
```

---

## Story E21-S5 — Template materialisation sets body_type and flow_track (M, 4h)

**As a developer**
**I want** newly created ROs to have body_type populated and tasks to have flow_track from the template
**So that** the manual backfill in S4 is one-shot and not load-bearing forever

### Acceptance criteria
- `template_versions` gets a new column `body_type TEXT NULL` via `db/migrations/021_template_body_type.sql`
- `template_operations` gets a new column `flow_track TEXT NOT NULL DEFAULT 'BODY' CHECK (flow_track IN ('BODY','CHASSIS','SUBFRAME','ANY'))`
- Seed update in `db/migrations/021_…sql` populates `body_type` for the existing TP42N (TIPPER_CS), DFE-TT67F (TAUTLINER) templates plus any others present in the dev seed
- The RO creation handler in `api/Endpoints/RepairOrderEndpoints.cs` (search for the existing `POST /api/repair-orders` materialisation logic) is updated to:
  - Copy `template_versions.body_type → repair_orders.body_type`
  - Copy `template_operations.flow_track → job_tasks.flow_track` for each materialised task
- Existing API tests for RO creation (`api.tests/SalesEndpointTests.cs` if present, or wherever `/api/repair-orders` POST is asserted) extended with one new assertion: created RO has `body_type` set, and tasks for chassis stations have `flow_track = 'CHASSIS'`
- The PDF-extraction creator in `api/Endpoints/SalesPdfEndpoints.cs:143` (the `link` endpoint that turns an extracted upload into an RO) gets the same treatment

### Technical context
- Don't try to *infer* track from station_id at materialisation time — store it explicitly. Template authors decide the track when they author the template (P2 work in a future epic)
- Backfill template_operations from station_id in the same migration (similar pattern to E21-S4 but on the template, not the RO)

### Done definition
- Create a new RO via `POST /api/repair-orders` with `templateVersionId` pointing at TP42N; assert the response has `bodyType: "TIPPER_CS"` and the chassis-prep task has `flowTrack: "CHASSIS"`
- All existing E2 tests (RO from template) still green

### Claude Code prompt
```
1. db/migrations/021_template_body_type.sql:
   - ALTER TABLE template_versions ADD COLUMN IF NOT EXISTS body_type TEXT NULL;
   - ALTER TABLE template_operations ADD COLUMN IF NOT EXISTS flow_track TEXT NOT NULL DEFAULT 'BODY' CHECK (flow_track IN ('BODY','CHASSIS','SUBFRAME','ANY'));
   - UPDATE template_versions SET body_type = '...' for known templates (mirror the mapping from 019_backfill_flow.sql).
   - UPDATE template_operations SET flow_track = 'CHASSIS' WHERE station_id_override IN (50, 60).

2. api/Domain/Template.cs (or wherever TemplateVersion / TemplateOperation live): add the new properties.

3. RepairOrderEndpoints.cs — locate the POST handler that materialises tasks from template; copy body_type to ro.BodyType and flow_track per operation.

4. SalesPdfEndpoints.cs — link endpoint at line ~143; same treatment after the extraction completes.

5. Add tests as described in the Done definition.

Run: make seed && make hash-pw && dotnet test
```

---

# Epic E22 — Grouped kanban API + UI

> **Priority:** P0 · **Owner:** Dev A · **Days:** 2–4 · **Total estimate:** 16 hours

The visible change. Reshape the kanban payload to one card per `(repair_order, station)`, replace the per-task component with a station-card component, regroup tasks under each card. The board still shows station columns; cards are now thicker because each one carries its full task checklist.

## Story E22-S1 — Reshape `GET /api/kanban` to grouped DTO (M, 4h)

**As Dev A**
**I want** the kanban endpoint to return cards grouped by RO and station with embedded tasks
**So that** the frontend can render the new card shape

### Acceptance criteria
- `api/Endpoints/KanbanEndpoints.cs:14` (the existing `GetBoard` handler): replace the response shape from `KanbanStationDto { tasks: KanbanTaskDto[] }` to `KanbanStationDto { cards: KanbanCardDto[] }`
- `KanbanCardDto`:
  ```csharp
  public record KanbanCardDto(
      Guid RoId,
      string RoNumber,
      string CustomerName,
      short Priority,
      DateTime? RequiredDate,
      string? BodyType,
      string Track,                // BODY | CHASSIS | SUBFRAME | MIXED (split shows MIXED)
      short StationId,
      string StationCode,
      string StationName,
      string GateState,            // READY | GATED | IN_PROGRESS | COMPLETE
      string? GateReason,          // human-readable when GATED
      decimal EstimatedHours,
      decimal ActualHours,
      int TotalTasks,
      int CompletedTasks,
      string? SourcePdfUrl,
      bool HasManualOverride,
      KanbanTaskDto[] Tasks);
  ```
- `KanbanTaskDto` keeps its existing fields (`web/src/app/kanban/kanban.service.ts:5`) plus a new `flowTrack: string`
- Cards are grouped server-side by `(ro_id, station_id)`. **All** tasks for that (RO, station) pair are returned, regardless of status (including completed) — the frontend chooses what to display
- A station with no tasks still appears in the response (existing behaviour preserved); its `cards` array is empty
- `gateState` and `gateReason` are populated by calling `IGateEvaluator.Evaluate(roId, stationId)` from E24-S1; for this story, return a stub that always emits `IN_PROGRESS` so Dev A is unblocked. Real implementation lands in E24-S1
- Card-level `track` field aggregates task tracks: if all tasks share one track → that track; if mixed → `"MIXED"`
- Sorting: cards within a column are ordered by `(priority ASC, required_date ASC, ro_number ASC)` — same as today, just per-card now

### Wire contract
Dev A and Dev B must agree these field names exactly, **before** writing the endpoint or the gate evaluator:

| Field | Type | Producer | Consumer |
|---|---|---|---|
| `gateState` | enum string `READY \| GATED \| IN_PROGRESS \| COMPLETE` | E24-S1 | E22-S2 (card class) |
| `gateReason` | string? | E24-S1 | E22-S2 (tooltip) |
| `track` | string `BODY \| CHASSIS \| SUBFRAME \| MIXED` | E22-S1 | E22-S2 (track stripe) |
| `bodyType` | string? | RO column | E22-S2 (chip) |

### Technical context
- The existing query at `KanbanEndpoints.cs:36-71` already joins all the needed tables. Restructure into a grouped `IQueryable` projection: `db.JobTasks.Where(...).GroupBy(t => new { t.RoId, t.StationId }).Select(...)` — but EF Core's groupings into projection have limitations; doing it as `Select` then a client-side `GroupBy` after `ToListAsync()` is acceptable for an MVP
- DO NOT use `[^1]` index-from-end inside the LINQ projection — extract to local variables (CLAUDE.md "Critical Constraints")
- The `sourcePdfUrl` join: add `.Join(db.Attachments.Where(a => a.EntityType == "RepairOrder" && a.Category == "SOURCE_PDF"), ro => ro.Id, a => a.EntityId, ...)`. Don't use a subquery per row
- Preserve the existing `?stationId=` query param semantics (filter to one column when set)
- The existing `last_override_*` fields stay on the card as `hasManualOverride` only — the actual override metadata (reason, by, at) moves to a separate `/api/kanban/ros/{id}/timeline` endpoint that's out of scope for this MVP

### Done definition
- `GET /api/kanban` response for the dev seed shows ~6 cards (one per (RO, station) pair where any open task exists), each card with its embedded tasks
- A card for a TIPPER_CS chassis station has `track: "CHASSIS"` and includes only chassis-track tasks at that station
- API integration test `api.tests/KanbanEndpointTests.cs::GetBoard_GroupsByRoAndStation` passes

### Claude Code prompt
```
Reshape api/Endpoints/KanbanEndpoints.cs GetBoard handler:

1. Define record KanbanCardDto and update KanbanStationDto to use it.

2. Rewrite the projection: fetch all open job_tasks (status not in 'COMPLETED' OR 'CANCELLED' for the same window — but include the *full* task list for cards where any task is still open, so completed tasks within a station group are still shown). Group client-side by (RoId, StationId).

3. Inject a stub IGateEvaluator that always returns ("IN_PROGRESS", null) for now; real wiring is in E24.

4. Add a single attachment join filtered to (entity_type='RepairOrder', category='SOURCE_PDF') keyed by ro_id; project sourcePdfUrl as $"/uploads/{a.BlobPath}".

5. Update api.tests/KanbanEndpointTests.cs:
   - Test GetBoard_GroupsByRoAndStation: seed 1 RO with 4 tasks across 2 stations, assert 2 cards.
   - Test GetBoard_IncludesPdfUrl: seed an Attachment for the RO, assert sourcePdfUrl is non-null.
   - Test GetBoard_TrackFieldReflectsTasks: 1 card with all-CHASSIS tasks → track == "CHASSIS"; mixed → "MIXED".

Don't touch the override endpoint at line 154 — it stays.
```

---

## Story E22-S2 — Angular `station-card.component.ts` (M, 4h)

**As Dev A**
**I want** a new standalone Angular component that renders a grouped station card
**So that** kanban-board can drop it in per card per column

### Acceptance criteria
- New file `web/src/app/kanban/station-card.component.ts` (standalone)
- Component is a pure render — takes a `card: KanbanCardDto` input signal and emits `cardClick` and `pdfClick` outputs
- Visual structure (matches `design/pitch-demo-grouped-kanban.html:952-995`):
  1. Track stripe (3px tall) at top — class `body | chassis | subframe | split` based on `card.track`
  2. Header row: RO number + customer/template subtitle on left, body-type chip on right
  3. Progress row: "n/m tasks · n/m h" plus track label
  4. Thin progress bar (3px) coloured by gate state
  5. Mini task list (max 4 visible, then "+ N more") with checkbox + name + per-task hours
  6. Footer with "View PDF" button on left, gate pill on right
- States via host class binding:
  - `gated` (dashed border, hatched background) when `card.gateState === 'GATED'`
  - `ready` (left bar accent) when `'READY'`
  - `complete` (green tint) when `'COMPLETE'`
- `pdfClick.emit()` does not propagate up to `cardClick` — call `event.stopPropagation()` in the handler
- Uses signals only (no RxJS) — `input.required<KanbanCardDto>('card')`, `output<void>('cardClick')`
- Companion spec `station-card.component.spec.ts` tests: track-stripe class binding, gate-class binding, pdf event isolation

### Technical context
- Copy CSS variables and class names from `design/pitch-demo-grouped-kanban.html:289-510` so the visual lands exactly. Do NOT reinvent — the demo HTML is the source of truth
- Replace inline SVG icons by importing `lucide-angular` if it's already in the project; otherwise inline the SVG from the demo
- Mini task list truncation rule: show first 4 by `sequence`, then a "+N more" line. Full list lives in the drawer (E23-S3)

### Done definition
- A storybook-style minimal route at `/_dev/station-card` (gated by env, only present in dev) renders three example cards: ready, gated, complete
- Spec passes: `npx ng test --watch=false`

### Claude Code prompt
```
Create web/src/app/kanban/station-card.component.ts as a standalone signal-based component.

Inputs: card: KanbanCardDto (typed from the updated kanban.service.ts).
Outputs: cardClick (void), pdfClick (void).

Template structure: copy from design/pitch-demo-grouped-kanban.html lines 952-995 (the first card example) but parameterise every value off the input. Bind host class to gateState ('gated' | 'ready' | 'complete' | '').

Styles: extract the .stn-card, .stn-card-track, .stn-card-head, .stn-card-progress, .stn-tasks-mini, .stn-card-foot, .stn-pdf-btn, .stn-gate-pill rules from the demo HTML into the component's styles array verbatim. Reference the global CSS variables from styles.css (add them if not present).

Add station-card.component.spec.ts:
  - it('shows green left bar when ready')
  - it('shows dashed hatched style when gated')
  - it('emits pdfClick without bubbling to cardClick')
  - it('truncates mini tasks at 4 with +N more')
```

---

## Story E22-S3 — Refactor `kanban-board.component.ts` to consume cards (M, 4h)

**As Dev A**
**I want** the existing kanban board to render station-card components instead of task-card components
**So that** the visual change ships and the old task-card path is dead code

### Acceptance criteria
- `web/src/app/kanban/kanban-board.component.ts` (existing): replace its per-task rendering with `<app-station-card *ngFor="let card of station.cards" [card]="card" (cardClick)="onCardClick(card)" (pdfClick)="onPdfClick(card)">`
- The board calls the existing service method whose return type is updated in E22-S1; remove any `KanbanTaskDto`-specific code
- `onCardClick` opens the existing task drawer (`task-drawer.component.ts`) but in a wider mode — drawer changes are E23-S3, just wire the click for now to a new method `openCardDrawer(card)` that holds a TODO
- `onPdfClick` opens the source PDF in a new tab via `window.open(card.sourcePdfUrl, '_blank')` — drawer preview is E23-S3
- `web/src/app/kanban/task-card.component.ts`: keep the file for now but remove its template usage from the board. Will be deleted in E26-S3
- Existing kanban specs (`kanban-board.component.spec.ts`) updated for the new shape; failing tests are rewritten, not deleted

### Technical context
- The kanban service method (`kanban.service.ts:52`) returns the new shape since E22-S1; just consume the new shape
- Watch out for the popover/overflow pitfall in CLAUDE.md "Critical Constraints" — the existing kanban uses scrollable columns; if you add any popover/menu inside the card, it must use `position: fixed` with a `getBoundingClientRect()`-derived anchor. The MVP cards don't have popovers, so this is a non-issue *unless* you add the override menu inline — keep that menu in the drawer (E24-S5)

### Done definition
- `make dev`, log in as `supervisor`, navigate to `/kanban` — all stations show grouped cards
- Click a card: drawer opens (still showing old content for now)
- Click View PDF: PDF opens in a new tab from the static `/uploads/` URL
- `npx ng test --watch=false` green; `dotnet test` green

### Claude Code prompt
```
Refactor web/src/app/kanban/kanban-board.component.ts to render station-cards.

1. Remove the *ngFor over task-card. Replace with *ngFor over station.cards binding to <app-station-card>.

2. Add openCardDrawer(card: KanbanCardDto) — wires up the existing drawer (no shape changes yet).

3. Add openPdfInTab(card) — calls window.open with card.sourcePdfUrl if non-null.

4. Update imports: remove TaskCardComponent, add StationCardComponent.

5. kanban-board.component.spec.ts:
   - Replace any TaskCardDto fixtures with KanbanCardDto fixtures.
   - Test: 'renders one station-card per card in station.cards'.
```

---

## Story E22-S4 — Update kanban service typings + cache invalidation (S, 2h)

**As Dev A**
**I want** the Angular service shape to match the new API exactly
**So that** the compiler catches any drift

### Acceptance criteria
- `web/src/app/kanban/kanban.service.ts:5`: replace `KanbanTaskDto` with the new `KanbanCardDto` (mirroring the C# DTO field-for-field, camelCased)
- The service exposes a `signal<KanbanBoardDto | null>` and a `refresh()` method; the existing SignalR `KanbanUpdated` event listener (search for it in `kanban-board.component.ts` or a `kanban-realtime.service.ts`) calls `refresh()`
- A unit spec exists for the service: it parses a fixture grouped-board response with two stations and asserts the cards array shape

### Technical context
- The signal-based store pattern is already used elsewhere — copy from `dashboard.service.ts` if present
- Don't introduce RxJS `BehaviorSubject` — see CLAUDE.md "Web → State is managed with signal()"

### Done definition
- TypeScript compiler shows zero errors after this change
- `npx ng test --watch=false` green

### Claude Code prompt
```
Update web/src/app/kanban/kanban.service.ts:

1. Define KanbanCardDto interface mirroring the C# record from E22-S1.
2. Update KanbanStationDto to have cards: KanbanCardDto[].
3. Adjust the http return type of the GET /api/kanban call.
4. Add kanban.service.spec.ts with one fixture-based test.
```

---

## Story E22-S5 — Track stripe styling + body-type chip palette (S, 2h)

**As Dev A**
**I want** the visual polish from the demo HTML applied to the live cards
**So that** users immediately see which track and which body type each card belongs to

### Acceptance criteria
- The CSS for `.stn-card-track.body|chassis|subframe|split` matches the demo at `design/pitch-demo-grouped-kanban.html:325-334`
- Body-type chip values render as short uppercase codes:
  - `TIPPER_CS` → `TPR-CS`
  - `TAUTLINER` → `TAUT`
  - `BEAVERTAIL` → `BVR`
  - `TRAY` → `TRAY`
  - `PANTECH_STEEL` → `PNT-ST`
  - `PANTECH_AL` → `PNT-AL`
  - `TILT_SLIDER` → `TILT`
  - `TRAILER` → `TRL`
  - `BODY_SWAP` → `SWAP`
- Mapping lives in a single helper `bodyTypeShortCode(s: string)` in `web/src/app/kanban/body-type.util.ts`
- Used in the `station-card.component.ts` template

### Done definition
- All eight body-type codes render correctly across the seeded data
- A small spec exists for `bodyTypeShortCode` covering all known values plus an unknown fallback (returns `'?'`)

### Claude Code prompt
```
Add web/src/app/kanban/body-type.util.ts with bodyTypeShortCode + spec.
Wire into station-card.component.ts.
```

---

# Epic E23 — PDF link & preview on every card

> **Priority:** P0 · **Owner:** Dev A · **Days:** 4–5 · **Total estimate:** 10 hours

E22-S1 already added `sourcePdfUrl` to the card. This epic makes that URL a first-class affordance — a "View PDF" button on the card that opens an inline preview alongside the grouped task list.

## Story E23-S1 — Side-by-side drawer layout (M, 4h)

**As a supervisor**
**I want** clicking any kanban card to open a wide drawer with the task list on the left and the source PDF on the right
**So that** I can verify the work against the spec without losing my place in the kanban

### Acceptance criteria
- `web/src/app/kanban/task-drawer.component.ts` (existing): widens its modal width from the current narrow drawer to a `min(96vw, 1080px)` split panel — see `design/pitch-demo-grouped-kanban.html:512-575`
- The grid uses the demo's exact areas: `head | head`, `tasks | pdf`, `foot | foot`
- The right pane embeds an `<iframe [src]="card.sourcePdfUrl | safeResource">` — a new `SafeResourceUrlPipe` is added at `web/src/app/core/safe-resource.pipe.ts` (or use Angular's existing `DomSanitizer` directly)
- If `sourcePdfUrl` is null, the right pane shows an "No source PDF on file — upload one" empty state with a link to `/sales/pdf-upload`
- The header row shows RO number + customer/body-type/required-date in the existing dark-bar style
- The drawer is keyboard-dismissible (`Escape`) and click-outside dismissible
- The existing E5-S* drawer behaviour (showing one task's actions) is **moved** to a separate task drawer at `task-drawer.component.ts` retains its single-task mode for the Tech phone scene; the new wide drawer is `card-drawer.component.ts`

### Technical context
- Don't load the PDF eagerly — defer the iframe `src` binding until after the open animation finishes (`afterNextRender`) to prevent jank
- The `<iframe>` `src` should not have `#toolbar=0` etc. — leave default Chrome PDF UI; the user can use it directly
- The drawer is fixed-height to viewport (`100vh`) with `tasks` and `pdf` panes scrolling independently — see demo CSS `.drawer-tasks` and `.drawer-pdf`

### Done definition
- Click an RO card whose RO has a SOURCE_PDF attachment: drawer opens, PDF visible on the right within ~500ms
- `Escape` closes; clicking outside closes
- The existing tech phone view in scene 4 still uses the narrow single-task drawer — no regression

### Claude Code prompt
```
Create web/src/app/kanban/card-drawer.component.ts (standalone), input: card: KanbanCardDto, output: closed.

Template + styles: copy from design/pitch-demo-grouped-kanban.html lines 1196-1306. Replace the static task list with *ngFor over card.tasks. Replace the static PDF body with an <iframe [src]="safePdfUrl"> (PDF loaded after afterNextRender).

Wire into kanban-board.component.ts: openCardDrawer(card) sets a signal that the drawer reads.

Tests: card-drawer.component.spec.ts with 1 RO + 4 tasks fixture.
```

---

## Story E23-S2 — Full task list in drawer with track chips (S, 2h)

**As a supervisor**
**I want** the drawer to show every task at this station for this RO with its track chip
**So that** I can see who is doing what and what hasn't started

### Acceptance criteria
- The left pane of the drawer shows all tasks (no truncation) sorted by `sequence`
- Each row shows: checkbox state (done/in-progress/pending), task name, technician name + sequence + estimated/clocked hours, track chip (BODY/CHASSIS/SUBFRAME), formatted hours
- The track chip uses the same colour palette as the card stripe
- Clicking a task row deep-links to `/tech/tasks/{id}` (the existing tech detail page) for non-supervisors, or shows a small inline action menu for supervisors

### Done definition
- Drawer for an RO with 4 tasks at the Paint station shows 4 rows, all sorted by sequence
- Track chips render in the correct colour for each task

### Claude Code prompt
```
Add the task list inside card-drawer.component.ts left pane, mirroring design/pitch-demo-grouped-kanban.html lines 1216-1254.

Iterate card.tasks ordered by sequence. Use the existing TaskStatusService (if present) to map status to row class.
```

---

## Story E23-S3 — Empty state for missing PDF + upload link (S, 2h)

**As a supervisor**
**I want** an explicit "no PDF attached" message with a one-click upload link when the RO has no source document
**So that** I'm not staring at a blank iframe

### Acceptance criteria
- When `card.sourcePdfUrl` is null, the right pane shows: an icon, the heading "No source PDF on file", a body line "Sales hasn't uploaded the original RO document yet.", and a button "Upload now →" that links to `/sales/pdf-upload?roId={card.roId}`
- Once the PDF is uploaded, the drawer auto-refreshes via the existing realtime channel (or a polling fallback if SignalR isn't wired for this event)

### Done definition
- For a fresh RO with no attachment: drawer shows the empty state
- After PDF upload through Sales (E9-S3), refreshing the kanban shows the PDF in the drawer

### Claude Code prompt
```
Add the empty state branch to card-drawer.component.ts right pane.
The "Upload now" button uses [routerLink]="['/sales/pdf-upload']" and [queryParams]="{ roId: card.roId }".
```

---

## Story E23-S4 — Drawer integration tests (S, 2h)

**As Dev A**
**I want** end-to-end Playwright coverage for the new drawer
**So that** the click-card → see-PDF flow can't regress silently

### Acceptance criteria
- New file `web/e2e/grouped-kanban.spec.ts` with three Playwright tests:
  - `opens drawer with task list and PDF when card is clicked`
  - `shows empty state when RO has no PDF attachment`
  - `escape key closes drawer`
- Tests run against the dev seed (assumes `make seed && make hash-pw` has run) and use the seeded supervisor account
- Tests live alongside existing E2E specs, run via `npx playwright test` (per CLAUDE.md)

### Done definition
- `npx playwright test web/e2e/grouped-kanban.spec.ts` green when API + web are running

### Claude Code prompt
```
Create web/e2e/grouped-kanban.spec.ts with three Playwright tests against the dev seed.
Use page.goto('/login'), authenticate as supervisor, navigate to /kanban, click the first card, assert drawer + iframe present.
```

---

# Epic E24 — Auto stage advance + gating

> **Priority:** P0 · **Owner:** Dev B · **Days:** 3–6 · **Total estimate:** 16 hours

The hardest epic. Implements the gate state computation and the auto-advance event handler. The visible payoff is small: cards just transition automatically. The invisible payoff is large: supervisors stop force-advancing ROs and the system reflects reality.

## Story E24-S1 — `IGateEvaluator` service + `gateState` computation (M, 4h)

**As Dev B**
**I want** a reusable service that, given `(roId, stationId)`, returns the gate state of that grouped card
**So that** the kanban endpoint, the auto-advance hook, and the flow visualisation all share one rule

### Acceptance criteria
- New file `api/Services/GateEvaluator.cs` defining:
  ```csharp
  public interface IGateEvaluator {
      Task<GateResult> Evaluate(Guid roId, short stationId, CancellationToken ct);
  }
  public record GateResult(string State, string? Reason);
  ```
- States returned:
  - `READY` — at least one task at this station has status `PENDING`/`ASSIGNED`, and **all upstream same-track tasks** for this RO are `COMPLETED`
  - `IN_PROGRESS` — any task at this station has status `IN_PROGRESS` or `PAUSED`
  - `COMPLETE` — every task at this station is `COMPLETED`
  - `GATED` — at least one upstream same-track task is not `COMPLETED`. `Reason` populated like `"Body track at Paint not complete (Underside black pending)"`
- "Upstream" means: rows in `flow_definitions` where `body_type = ro.body_type AND track = task.flow_track AND sort_order < this_station_sort_order`. The gate examines all tasks for this RO whose `station_id` is in that upstream set
- Merge-point semantics (when this station has `is_merge_point = TRUE`): READY requires that **every track defined for this body type** is complete to that depth. If chassis isn't done, body-side card at the merge is GATED with reason `"Chassis track not yet at Final fitment"`
- Service is registered as `services.AddScoped<IGateEvaluator, GateEvaluator>();` in `Program.cs`
- The existing E22-S1 stub is replaced — `KanbanEndpoints.GetBoard` now calls the real evaluator
- A unit test fixture in `api.tests/GateEvaluatorTests.cs` covers:
  - Single-track BODY: gated when upstream incomplete
  - Single-track BODY: ready when upstream complete
  - Split tracks: chassis card READY independent of body card progress
  - Merge point: GATED until all incoming tracks complete
  - All tasks completed: COMPLETE state

### Technical context
- Reads only — never writes. Writes happen in E24-S2's auto-advance hook
- The query should be cheap: one query for upstream stations from `flow_definitions`, one query for tasks for this RO at those stations. Don't N+1
- Cache `body_type → flow_definitions` lookup per request scope (use `IMemoryCache` with a short TTL or a request-scoped service); flow definitions change rarely
- Don't depend on `kanban_stages.sort_order` for ordering — use `flow_definitions.sort_order`. The two happen to align today but `flow_definitions` is the canonical flow ordering

### Done definition
- All five test cases above pass
- Manual test: in dev DB, mark all chassis-track tasks at HYVA as COMPLETED, hit `GET /api/kanban` — the chassis-track card at FINAL_FITMENT shows `gateState: "READY"` (assuming body track is also complete)
- Existing `KanbanEndpointTests` still green

### Claude Code prompt
```
Create api/Services/GateEvaluator.cs with the interface, record, and implementation as specified.

Algorithm (pseudocode):
   var ro = await db.RepairOrders.FindAsync(roId);
   var thisStation = await db.FlowDefinitions
       .Where(fd => fd.BodyType == ro.BodyType && fd.StationId == stationId)
       .OrderBy(fd => fd.SortOrder)
       .ToListAsync(); // 1..N rows, one per track that this station is on
   var upstreamStations = await db.FlowDefinitions
       .Where(fd => fd.BodyType == ro.BodyType
                    && thisStation.Select(t => t.Track).Contains(fd.Track)
                    && fd.SortOrder < thisStation.Min(t => t.SortOrder))
       .Select(fd => fd.StationId).ToListAsync();
   var upstreamTasks = await db.JobTasks
       .Where(t => t.RoId == roId && upstreamStations.Contains(t.StationId))
       .ToListAsync();
   if (any upstream task != COMPLETED) return GATED with reason;
   var hereTasks = await db.JobTasks
       .Where(t => t.RoId == roId && t.StationId == stationId).ToListAsync();
   if (all hereTasks == COMPLETED) return COMPLETE;
   if (any hereTasks IN_PROGRESS or PAUSED) return IN_PROGRESS;
   return READY;
   
   Merge-point branch (thisStation.Any(t => stage.is_merge_point)):
   walk every track in flow_definitions for this body_type up to (but not including)
   this station. If any track has incomplete tasks, return GATED.

Register in Program.cs. Wire into KanbanEndpoints.cs replacing the stub.
Write the 5 tests in api.tests/GateEvaluatorTests.cs using the existing Testcontainers fixture.
```

---

## Story E24-S2 — Auto-advance on task completion (M, 4h)

**As a technician**
**I want** marking my last task at a station to automatically advance the RO's stage
**So that** the supervisor doesn't have to manually click "next stage" all day

### Acceptance criteria
- Hook into the existing task-completion endpoint (`api/Endpoints/JobTaskEndpoints.cs` — search for the handler that sets `Status = "COMPLETED"` and writes to `domain_events`)
- After the task transitions to COMPLETED, evaluate `(roId, taskStationId)` via `IGateEvaluator`. If state is `COMPLETE`:
  - Look up the **next station on this same track** from `flow_definitions`
  - If the next station is a merge point, evaluate that station's gate; only advance the RO if it returns READY (i.e., all incoming tracks have reached the merge)
  - Update `ro_kanban_state.current_stage_id` to the kanban stage of the next station (`stations.sort_order` matches `kanban_stages.sort_order` by convention)
  - Write a `domain_events` row of type `RoStageAutoAdvanced` with payload `{ from: int, to: int, reason: "auto", triggeringTaskId: Guid }`
  - Push a SignalR `KanbanUpdated` event for this RO (existing channel; reuse the event name)
- If the next station for this track is null (track terminates at a merge), don't advance — wait for the merge gate to resolve via the **merge station's** completion event
- Force-advance (E24-S4) bypasses this and always sets the stage; auto-advance fires only when the gate is naturally satisfied
- Idempotency: if the RO is already at-or-past the target stage, don't re-emit the event (compare `current_stage_id` to target)

### Technical context
- The existing task-completion logic is in a single endpoint — locate it via `grep -n "COMPLETED" api/Endpoints/JobTaskEndpoints.cs`. Wrap the auto-advance call in the same `try` so a gate-evaluation failure rolls back the task transition
- Do the gate evaluation + RO update in the **same EF transaction** as the task completion. Don't have the task COMPLETED commit and the stage change separately fail — they must succeed together or both roll back
- The SignalR `KanbanUpdated` push is fire-and-forget; don't await it inside the transaction
- The `domain_events` row schema is in `db/migrations/001_initial_schema.sql` — reuse the existing pattern from `JobTaskEndpoints.cs:50` (which already writes a `JobTaskCompleted` event)

### Done definition
- Mark the last `IN_PROGRESS` task on a body-track Paint station as COMPLETED via `PUT /api/job-tasks/{id}/complete`. Observe `ro_kanban_state.current_stage_id` move from 50 (PAINTING) to 70 (FITOUT) for an RO whose flow has Body Fitout next
- A `domain_events` row with `event_type = 'RoStageAutoAdvanced'` is written
- The kanban grouped response now shows the next station's card as `READY`
- Test: `api.tests/JobTaskEndpointTests.cs::Complete_LastTaskAtStation_AutoAdvancesRo`

### Claude Code prompt
```
Update api/Endpoints/JobTaskEndpoints.cs.

After the existing task COMPLETED transition + domain event write, before the response is returned:

1. var gate = await gateEvaluator.Evaluate(task.RoId, task.StationId, ct);
2. if (gate.State != "COMPLETE") return as before.
3. Else look up next station on task.FlowTrack from flow_definitions.
4. If nextStation is null OR nextStage.is_merge_point && merge gate not READY → don't advance, return.
5. Else update ro_kanban_state.current_stage_id to next stage (look up via stations.sort_order match);
   write domain event RoStageAutoAdvanced with payload {from, to, reason: "auto", triggeringTaskId}.
6. Wrap steps 1-5 in the same SaveChangesAsync transaction as the task completion.

Test: api.tests/JobTaskEndpointTests.cs::Complete_LastTaskAtStation_AutoAdvancesRo —
   seed an RO with all paint tasks done except one, complete it, assert ro_kanban_state.current_stage_id == 70 and one RoStageAutoAdvanced event written.
```

---

## Story E24-S3 — Merge-point handler: advance only when all tracks arrive (M, 4h)

**As a technician**
**I want** a merge-point station to start work only when all incoming tracks have arrived
**So that** Final Fitment doesn't begin without both the painted body and the prepped chassis

### Acceptance criteria
- The auto-advance from E24-S2 already handles the simple case. This story adds the trickier inverse: when a NON-final track completes, but the merge gate isn't READY yet
- When task X completes and the next station on track X is a merge point:
  - Don't advance the RO's stage
  - Re-evaluate the merge station's gate. If it's READY now (all tracks arrived), advance the RO's stage to the merge station's stage AND emit a `RoMergeReached` domain event with payload `{ stationId, completedTracks: ["BODY","CHASSIS","SUBFRAME"] }`
  - If it's still GATED, emit a `RoTrackArrivedAtMerge` event so supervisors can see "body has arrived, chassis still pending"
- The "track arrived" state is implicit (no DB column) — derived from `flow_definitions` + completed tasks
- Tests cover: chassis arrives first, body second; both arrive same instant; one track completed, the other still has tasks pending

### Technical context
- The hardest gotcha: a `MIXED`-track grouped card at a merge station won't have a single "track" to advance from. Handle this by looking up which tracks the body type has, not by reading the card's track field
- For a PANTECH_AL whose flow has only BODY + CHASSIS (no SUBFRAME), the merge gate must accept "both tracks complete" — don't require SUBFRAME presence
- Keep this code in `GateEvaluator.Evaluate` — it already walks `flow_definitions`. Don't add a parallel implementation in JobTaskEndpoints

### Done definition
- Sequence the dev seed to have one chassis track and one body track active. Complete the chassis tasks first, then the body tasks. After the last body task completes, observe `ro_kanban_state` advance to FINAL_FITMENT (stage 70) and a `RoMergeReached` event written
- Repeat with body completing first, chassis last — same outcome
- Test: `api.tests/GateEvaluatorTests.cs::MergePoint_BothTracksRequired_ReadyOnlyWhenBoth`

### Claude Code prompt
```
Extend GateEvaluator and JobTaskEndpoints completion handler:

1. In GateEvaluator.Evaluate, when this station has is_merge_point=true:
   - Get all tracks defined for this body_type in flow_definitions.
   - For each track, find tasks at all stations with sort_order <= this station's track-specific sort_order.
   - If any track has incomplete tasks (excluding optional steps) → GATED with reason listing which tracks haven't arrived.

2. In JobTaskEndpoints completion handler, when next station is a merge point:
   - After the gate re-evaluation, write either RoMergeReached (advance) or RoTrackArrivedAtMerge (no advance) event.

Test:
   - MergePoint_BothTracksRequired_ReadyOnlyWhenBoth — seed body+chassis tracks, complete body first, expect GATED; complete chassis, expect READY.
   - MergePoint_BodyTypeWithoutSubframe_DoesNotRequireSubframe — PANTECH_AL never has subframe; merge ready with body+chassis only.
```

---

## Story E24-S4 — Force-advance endpoint (escape hatch) (S, 2h)

**As a supervisor**
**I want** an explicit "force advance to next stage" action with a required reason
**So that** I can unblock production when a gate is technically un-satisfiable (e.g., a task was logged at the wrong station)

### Acceptance criteria
- The existing `POST /api/kanban/ros/{id}/override-stage` endpoint at `api/Endpoints/KanbanEndpoints.cs:154` is **renamed** to `POST /api/kanban/ros/{id}/force-advance`. Old route stays as a compatibility alias for one release (E26 cleans this up)
- Request body unchanged: `{ stageId: short, reason: string }` (reason min 10 chars)
- The handler still writes to `ro_kanban_state.last_override_*` (existing columns from `db/migrations/016_kanban_override_marker.sql`)
- Emits `RoStageForceAdvanced` domain event (rename from existing `KanbanStageOverride` to clarify intent)
- Adds an `audit-trail` notification to the supervisor's "recent activity" feed (use existing Notifications endpoint pattern)
- Web: rename the existing override modal in the kanban board to "Force advance" with copy clarifying that this bypasses the gate

### Technical context
- The endpoint already validates: reason >= 10 chars, RO not COMPLETED/CANCELLED. Keep those guards
- The new event name `RoStageForceAdvanced` should NOT replace any existing event — the old `KanbanStageOverride` event in production data (none, since this is dev-only) doesn't need migration. Just go forward with the new name

### Done definition
- Old `POST /api/kanban/ros/{id}/override-stage` returns 308 redirect (or 200 with the same behaviour) to the new path
- New `POST /api/kanban/ros/{id}/force-advance` returns 200 + writes domain event with new type
- Frontend modal updated; existing E2E test (if any covers override) updated to use new wording

### Claude Code prompt
```
1. Rename POST /api/kanban/ros/{id}/override-stage to /force-advance in KanbanEndpoints.cs. Keep the old route mapping that proxies to the new handler for backward compat (will remove in E26-S3).

2. Rename event type from KanbanStageOverride to RoStageForceAdvanced in the domain_events insert.

3. Web: kanban-board.component.ts — rename modal title and CTA from "Override stage" to "Force advance". Update modal body to read: "This bypasses the auto-advance gate. Use only when a task was logged incorrectly or the gate is unrecoverable. A reason and audit trail are required."
```

---

## Story E24-S5 — Drawer "Advance" CTA + gate banner (S, 2h)

**As a supervisor**
**I want** a banner in the drawer that explains why the card is gated (or that it's ready to advance), plus an explicit "Advance" CTA when conditions are met
**So that** I understand the gate state without reading code

### Acceptance criteria
- The drawer footer (the bar at the bottom of `card-drawer.component.ts` from E23-S1) gets:
  - A status hint paragraph (left) — "Card advances to {nextStation} automatically when all body-track tasks complete." — reads `card.gateState` and `card.gateReason`
  - An "Advance →" button (right) — disabled with tooltip when `gateState !== 'COMPLETE'`; enabled and primary when COMPLETE; clicking calls `POST /api/kanban/ros/{id}/force-advance` with `reason: "Manually confirmed by supervisor"` (free-form reason input via a small inline modal)
- A gate banner above the task list — variants `gated | ready | complete` matching `design/pitch-demo-grouped-kanban.html:1211-1214`
- Banner content is server-driven via `card.gateReason` so the message stays consistent with the evaluator

### Done definition
- Open the drawer on a GATED card: banner shows the reason in red/amber, Advance button disabled
- Open the drawer on a COMPLETE card: banner is green, Advance button enabled
- Clicking Advance pushes the RO's stage on the server and the card disappears from this column on the next refresh

### Claude Code prompt
```
Extend card-drawer.component.ts with the gate banner and advance CTA, mirroring design/pitch-demo-grouped-kanban.html lines 1211-1214 and 1300-1304.

Hook the Advance button to KanbanService.forceAdvance(roId, reason) which posts to /api/kanban/ros/{id}/force-advance.
```

---

# Epic E25 — Operational flow visualisation

> **Priority:** P1 · **Owner:** Dev A · **Days:** 6–7 · **Total estimate:** 10 hours

The flow ribbon at the top of the demo HTML — showing the per-track flow path for the currently selected RO. Useful but not strictly required for the MVP to function. Drop if days 8–9 are tight.

## Story E25-S1 — `GET /api/repair-orders/{id}/flow` endpoint (M, 4h)

**As Dev A**
**I want** an endpoint that returns the per-track flow path for one RO with current progress per step
**So that** the flow ribbon component has data

### Acceptance criteria
- New endpoint `GET /api/repair-orders/{id:guid}/flow` in `api/Endpoints/RepairOrderEndpoints.cs`
- Returns a structure:
  ```jsonc
  {
    "roId": "...",
    "bodyType": "TIPPER_CS",
    "tracks": [
      { "track": "BODY", "steps": [
        { "stationId": 10, "stationName": "Material processing / CNC", "stepStatus": "DONE",  "isMergePoint": false },
        { "stationId": 25, "stationName": "Robotic fabrication",       "stepStatus": "DONE",  "isMergePoint": false },
        { "stationId": 30, "stationName": "Paint and panel",           "stepStatus": "ACTIVE", "isMergePoint": false },
        ...
      ]},
      { "track": "CHASSIS", "steps": [...] },
      { "track": "SUBFRAME", "steps": [...] }
    ]
  }
  ```
- `stepStatus` is one of `DONE | ACTIVE | PENDING | BLOCKED`. ACTIVE is the current stage on that track. BLOCKED is a downstream merge waiting on this track
- Joins `flow_definitions` + `job_tasks` aggregate status per (track, station) for this RO

### Done definition
- Hit `/api/repair-orders/{id}/flow` for a TIPPER_CS RO mid-flight, response shows three tracks with progress markers
- Test: `api.tests/RepairOrderEndpointTests.cs::GetFlow_TipperCs_ReturnsThreeTracks`

### Claude Code prompt
```
Add GET /api/repair-orders/{id:guid}/flow to RepairOrderEndpoints.cs.

Algorithm:
   var ro = await db.RepairOrders.FindAsync(id);
   var defs = await db.FlowDefinitions
       .Where(fd => fd.BodyType == ro.BodyType)
       .OrderBy(fd => fd.Track).ThenBy(fd => fd.SortOrder)
       .Include(fd => fd.Station)
       .ToListAsync();
   var tasks = await db.JobTasks.Where(t => t.RoId == id).ToListAsync();
   // group defs by track; for each step, classify DONE/ACTIVE/PENDING based on tasks at that station

Test the TIPPER_CS happy path.
```

---

## Story E25-S2 — Flow ribbon Angular component (M, 4h)

**As Dev A**
**I want** a flow ribbon component that renders the response from S1 in the same shape as the demo
**So that** supervisors get one-glance flow context

### Acceptance criteria
- New `web/src/app/kanban/flow-ribbon.component.ts` (standalone)
- Renders the response from S1 verbatim — three tracks for split flows, one track for linear flows
- Reuses CSS from `design/pitch-demo-grouped-kanban.html:144-248` (`.flow-ribbon`, `.flow-tracks`, `.flow-step`, `.flow-merge`)
- Step pill states: `done` (green), `active` (filled black), `blocked` (red), `pending` (paper/default)
- Mounted in two places:
  - On the kanban page above the board, showing the **most recently selected RO's** flow (or hidden when none selected)
  - Inside the drawer header, replacing the current static meta line, showing the drawer card's RO flow

### Done definition
- Open the kanban for a TIPPER_CS RO: ribbon shows three tracks with progress
- Open it for a TAUTLINER: ribbon shows one BODY track only

### Claude Code prompt
```
Create web/src/app/kanban/flow-ribbon.component.ts.
Input: roId: string. Effect: fetch /api/repair-orders/{roId}/flow on input change.
Template: copy from design/pitch-demo-grouped-kanban.html lines 898-940; iterate response.tracks.
```

---

## Story E25-S3 — Body-type filter pills on the kanban (S, 2h)

**As a supervisor**
**I want** body-type filter pills above the kanban board
**So that** I can hide cards I don't care about right now (e.g., focus only on Pantech this week)

### Acceptance criteria
- Pills row above the kanban: `All | TIPPER_CS | TAUTLINER | PANTECH | ...` rendered from the distinct body types in the current board
- Multi-select supported (toggle pills); clicking "All" clears
- Filter is client-side — no API change. Filters out cards whose `card.bodyType` is not in the selected set
- Selection persists in `localStorage` so a refresh doesn't reset it

### Done definition
- Toggle "TIPPER_CS" → only TIPPER_CS cards visible across columns
- Refresh page → filter still applied

### Claude Code prompt
```
Add a body-type filter row to kanban-board.component.ts. Use a signal for selectedBodyTypes; computed filteredBoard derived from board() and the signal. Persist via localStorage on toggle.
```

---

# Epic E26 — Rollout, parity, decommission

> **Priority:** P0 · **Owner:** Both · **Days:** 7–9 · **Total estimate:** 8 hours

Closes the loop. Verifies the new behaviour at parity with the old one for every existing RO, runs realtime push end-to-end, deletes the dead code from E22.

## Story E26-S1 — Parity test: every RO renders correctly under both shapes (M, 4h)

**As both devs**
**I want** an automated test that for every RO in the dev seed asserts the grouped board contains exactly the same job_tasks as the legacy flat board would have
**So that** we ship knowing nothing was lost in the reshape

### Acceptance criteria
- New test `api.tests/KanbanEndpointTests.cs::Parity_GroupedBoardCoversAllOpenTasks`:
  - Fetch the legacy flat board (via a temporary dev-only `?legacyShape=true` flag if needed; otherwise reconstruct from the current grouped response)
  - Fetch the grouped board
  - Assert: every `(roId, taskId)` present in legacy is present in exactly one grouped card; no orphans, no duplicates
- Runs in CI on every PR via the existing test suite

### Done definition
- Test green on the dev seed
- Test fails when manually corrupting the grouped projection (sanity check)

### Claude Code prompt
```
Add api.tests/KanbanEndpointTests.cs::Parity_GroupedBoardCoversAllOpenTasks.

Read all open tasks directly from the DB:
   var allOpen = await db.JobTasks.Where(t => t.Status != "COMPLETED" && t.Status != "CANCELLED").ToListAsync();

Fetch grouped board, flatten cards.SelectMany(c => c.Tasks).Select(t => t.id).ToHashSet().

Assert allOpen.Select(t => t.Id).All(id => grouped.Contains(id)) AND counts match.
```

---

## Story E26-S2 — SignalR push on grouped card changes (M, 4h)

**As Dev A**
**I want** the kanban board to update within ~1 second of a server-side state change
**So that** supervisors don't manually refresh

### Acceptance criteria
- Existing SignalR `KanbanHub` (search for it in `api/`) gains a method `KanbanCardUpdated` with payload `{ roId, stationId }`
- Triggers: task assignment, task completion, RO stage advance, force-advance
- Web: `kanban-board.component.ts` listens for this event and calls `kanbanService.refresh()` (debounced 250ms to coalesce bursts)
- Old per-task `KanbanUpdated` event continues to fire (used by other surfaces) — additive only

### Done definition
- Open `/kanban` in two browser windows. Complete a task in one. The other window's affected card transitions within 1.5 seconds without manual refresh

### Claude Code prompt
```
1. KanbanHub: add public Task NotifyCardUpdated(Guid roId, short stationId) => Clients.All.SendAsync("KanbanCardUpdated", new { roId, stationId });

2. Wire from JobTaskEndpoints (assignment, completion) and KanbanEndpoints (force-advance) — call hubContext.Clients.All.SendAsync after the response is queued.

3. Web: kanban-board.component.ts subscribes to KanbanCardUpdated and refreshes (debounced 250ms).
```

---

## Story E26-S3 — Decommission `task-card.component` and legacy DTO (S, 2h)

**As Dev A**
**I want** the dead per-task card component and any compat shims removed
**So that** the codebase doesn't drift back to the old shape

### Acceptance criteria
- Delete `web/src/app/kanban/task-card.component.ts` and `task-card.component.spec.ts`
- Delete the C# `KanbanTaskDto` shape if any code path still references it (other than as a sub-DTO inside `KanbanCardDto.Tasks` — that one stays)
- Remove the deprecated `POST /api/kanban/ros/{id}/override-stage` route alias from E24-S4
- Add a CHANGELOG entry at `docs/CHANGELOG.md` (create if missing) summarising the breaking API change

### Done definition
- `git grep TaskCardComponent` returns zero results
- `npx ng test --watch=false` and `dotnet test` both green
- One PR explicitly titled "BREAKING: remove legacy kanban shapes"

### Claude Code prompt
```
1. rm web/src/app/kanban/task-card.component.ts web/src/app/kanban/task-card.component.spec.ts
2. Update any stragglers in kanban-board.component.ts imports (if any).
3. Remove the /override-stage compat alias from KanbanEndpoints.cs.
4. Add docs/CHANGELOG.md if missing; add an entry "## MVP v1 · 2026-05-XX — Flow-aware grouped kanban (BREAKING)".
```

---

# Cut list (explicit non-goals for this MVP)

These are tempting but **out of scope**. They land in MVP v2 if the v1 demo lands well.

- **Per-track scheduling** — capacity planning per track per week. Today the scheduling view (E10) thinks in stations, not tracks. Leave it that way.
- **Drag-and-drop reordering of cards within a column** — already a phase 2 stretch (E16). Not blocked by anything here.
- **Bulk advance** — "advance all completed cards" supervisor action. The auto-advance from E24 mostly removes the need.
- **Track reassignment UI** — supervisor changes a task's `flow_track` after creation. Possible via direct DB edit; no UI needed for MVP.
- **Custom flow definitions per RO** — body-type-derived flow is good enough. Per-RO bespoke flows are a long-tail edge case.
- **Mobile redesign of the grouped board** — the technician view (E5, E19) keeps its existing per-task focus. The grouped kanban is supervisor-facing, desktop-only.
- **PDF annotations / inline comments** — view-only iframe is enough. Linking comments to a PDF region is a separate animal.

# Risk log

| Risk | Likelihood | Mitigation |
|---|---|---|
| `flow_definitions` seed wrong for one body type, gating breaks for that subset of ROs | Medium | E26-S1 parity test catches "tasks orphaned"; cross-check seed against the operations PDF on a printed copy in the office |
| Auto-advance fires twice for a single task completion (race condition) | Low | E24-S2 idempotency check on `current_stage_id`; transaction wraps both writes |
| The wide drawer + iframe is visually cramped on 13" laptops | Medium | The `min(96vw, 1080px)` width keeps it usable; supervisors mostly use larger screens; degrade to stacked layout below 1100px (P1 polish, in E25 if time) |
| Backfill (E21-S4) misclassifies a body type for an existing RO with an unusual template code | Low | The `BODY_SWAP` fallback is safe — single linear flow, no merge | 
| The CITEXT email column quirk (CLAUDE.md) bites the new `body_type` projection | Low | `body_type` is plain TEXT, not CITEXT; no risk | 

# Glossary additions for `docs/glossary.md`

- **Track** — a parallel chain of stations within a single RO's production. The PDF flow shows up to three: BODY, CHASSIS, SUBFRAME. Linear body types use BODY only.
- **Merge point** — a station where multiple tracks converge (Final fitment B2 station 70; Final QC station 90). A card at a merge point is GATED until all incoming tracks are complete.
- **Gate state** — the readiness of a grouped (RO, station) card: READY, IN_PROGRESS, COMPLETE, or GATED.
- **Force advance** — supervisor escape hatch that bypasses the gate, requires a written reason, audited via `domain_events`.
- **Flow definition** — the canonical per-(body_type, track) ordered sequence of stations, seeded once from the operations PDF and lookup-only at runtime.
