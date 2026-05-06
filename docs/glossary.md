# Domain glossary

NEE-specific terminology used throughout the codebase. When sales says "job," the database says `repair_orders`, and the floor calls it an "RO." This file is the canonical mapping.

If you find yourself uncertain about a term, add it here rather than guessing at the column name. Updates welcome — the glossary is a living document.

---

### RO (Repair Order)

The top-level unit of work. A truck arriving at the workshop with a defined scope: "build a tipper body," "swap the body," "modify the chassis." Has a unique RO number (e.g. `58734`), a customer, a vehicle (VIN/rego/make/model), required date, and a chosen template. Goes through stages: drafting → approved → scheduled → in-progress → QC → complete.

**Schema:** `repair_orders` table. Identified by `ro_number` (human-readable) or `id` (UUID).

**Example:** RO 58734 is the DFE Tautliner build for VIN JALFRR90NN7004213.

---

### Job task

One row of work that happens at one station, by one technician, in one sitting (modulo pause/resume). An RO has many job tasks — typically 12–14 of them, materialised from the chosen template at the moment the RO is created.

**Schema:** `job_tasks` table.

**Example:** "RO 58734, sequence 06: Fabrication line assembly, 4 hours, station Fab Line."

---

### Operation

A canonical kind of work the workshop performs. Operations exist independently of any RO — they're the vocabulary the templates draw from. There are 28 operations in the catalog covering everything from material processing through final QC.

**Schema:** `operation_catalog` table.

**Example:** `MAT_PROC_CNC` is the operation; a job task on RO 58734 references it.

---

### Operation catalog

The full list of operations the platform knows about. Adding a new operation is a master-data change, not a code change. The catalog is what lets us normalise "Material proc / CNC" and "MATERIAL PROCESSING/CNC" and "CNC" into one canonical entry.

**Schema:** `operation_catalog` table, with `operation_aliases` for the variant spellings.

---

### Operation alias

A non-canonical name that maps to a canonical operation. Used by the PDF parser (E9) to normalise the variants seen on existing ROs without forcing humans to retype them.

**Schema:** `operation_aliases` table.

**Example:** `MATERIAL PROC` and `Material processing/CNC` both alias to `MAT_PROC_CNC`.

---

### Template

A reusable definition of a body type build, encoded as a sequence of operations with estimated hours and target stations. NEE has 46 templates in the full catalog — TP42N, DFE-TT67F, etc. The name encodes the body type, size, and chassis class. Customer-prefixed variants (e.g. `DFE-TT67F`) inherit from a base template (`TT67F`) with customer-specific spec overrides.

**Schema:** `job_code_templates` table (the catalog), referenced by `repair_orders.template_code`.

**Example:** Picking template `TP42N` materialises 12 job tasks totalling 53.5 hours.

---

### Template version

A specific revision of a template. Templates evolve as we calibrate hours from actual data — `TP42N v1` might have paint prep at 4.5h, `TP42N v2` at 5.8h once we learn the truth. ROs are linked to a specific version so historical data stays comparable.

**Schema:** `template_versions` (header), `template_operations` (the lines).

---

### Customer variant

A template that prefixes a customer code onto a base template, with that customer's specific spec overrides. Lets DFE's tautliners be priced and built differently from the generic version without having to re-create the full template.

**Schema:** `job_code_templates` rows where `customer_id` is non-null.

**Example:** `DFE-TT67F` is a customer variant of base template `TT67F`.

---

### Body type

The physical kind of body NEE builds. Tray (TR), Tipper (TP), Tautliner (TT), Drop-side / Pantech (DP), Chipper (CH), Tilt slider (TS), Vac pantech (VP). Each has a 2-letter code that templates use as the second component of their name.

**Schema:** `body_types` table.

---

### Job type

The nature of the work, independent of body. New build, body swap, repair, warranty, accessories fitment, chassis modification.

**Schema:** `job_types` table.

---

### Station

A physical area of the workshop with a team and a kanban board. Material Processing, Fab Line, Paint and Panel, Body Fitout, Chassis Prep, HYVA Hydraulics, Final Fitment, Compliance and Final QC, plus the Hospital zone for blocked work.

**Schema:** `stations` table. Each station has an `owner_user_id` (the team lead) and `reports_to_user_id` (the supervisor).

---

### Technician

A user who actually does the floor work. Maps to a station via `station_technicians`. Logs time entries against tasks. Has a `short_code` (e.g. `Pr` for Peter Rogers) used on legacy paper run sheets and now in the system for compactness.

**Schema:** `users` table (with `TECHNICIAN` role), linked to stations via `station_technicians`.

---

### Kanban stage

The current state of a task on its station's board: Pending, In Progress, Hospital, On Hold, Complete. Distinct from `job_tasks.status` because a task can be "in progress" on the floor but the kanban card has been moved to "hospital" for material-blocking reasons that don't pause the timer.

**Schema:** `kanban_stages` (the catalog) and `ro_kanban_state` (the per-RO current stage).

---

### Hospital zone

The dedicated area (and kanban column) where blocked work goes — missing parts, customer revision needed, drafting issue, etc. Surfaced separately from in-progress work in supervisor dashboards because hospital-zone time has different cost characteristics and different escalation paths.

**Schema:** `repair_orders.is_in_hospital` flag plus `kanban_stages.code = 'HOSPITAL'`.

---

### Time entry

One uninterrupted period of one technician working on one task. Created by clock-in, closed by clock-out or pause. The platform enforces "one open time entry per user" via a partial unique index — you can't accidentally clock in to two tasks at once.

**Schema:** `time_entries` table, with the unique index `idx_one_open_time_entry_per_user`.

---

### Variance

The difference between estimated and actual hours on a task. Captured automatically when a task closes. Variance over a configurable threshold (default 25% or 2 hours) prompts the technician to pick a reason code.

**Schema:** `variance_records` table, with reason from `variance_reasons`.

**Example:** Estimate 4.0h, actual 5.5h → variance +1.5h, reason "missing parts."

---

### Variance reason

A reason code for why a task ran over (or under) its estimate. Six standard reasons: missing parts, drawing or BOM issue, rework after QC fail, customer revision mid-build, trainee on task, other. Used for root-cause analysis and supplier scorecards.

**Schema:** `variance_reasons` table.

---

### Drafting status

The state of the technical drawing pack for an RO: NDR (no drawing requested yet), AWAITING_CUSTOMER (customer hasn't approved the layout), UNDER_REVIEW (drafter is working on it), COMPLETED (drawings released to the floor). Drafting being incomplete is the platform's primary bottleneck — 78 of 109 in-progress ROs at the start of this project were blocked here.

**Schema:** `repair_orders.drafting_status` column.

---

### Domain event

An immutable record of something that happened in the system: RO created, task completed, QC passed, blocker reported. Stored in append-only fashion with a JSONB payload. Used for audit, analytics, and as the trigger source for notifications and projections.

**Schema:** `domain_events` table. Append-only by convention; never UPDATE'd or DELETE'd.

**Example:** `{ event_type: 'RoCreated', event_data: { roId: '...', roNumber: '99019', templateCode: 'DFE-TT67F', taskCount: 13 } }`

---

### Attachment

A file (PDF, photo, drawing) associated with an RO or task. Used for drawing packs, build photos, customer-supplied specs, QC evidence. Stored on the local filesystem in the MVP; will move to blob storage in Phase 2.

**Schema:** `attachments` table, polymorphic via `entity_type` + `entity_id`.

---

### Job code

A naming convention for templates and operations. Format: `[CUSTOMER-]BODYTYPE+SIZE+CHASSISCLASS[-VARIANT]`.
- `TP42N` = Tipper, 4.2m, NPR class
- `DFE-TT67F` = DFE customer variant of Tautliner, 6.7m, FRR class
- `DFE-TT67F-SD` = DFE TT67F with the SD variant suffix

Used in the schema as the primary key of `job_code_templates` and as a prefix on operation codes within a template.

---

### Materialisation

The act of turning a template into concrete `job_tasks` rows on a specific RO. Done once at RO creation in a single transaction. The materialisation service is the most domain-heavy code in the platform; it's E2-S1 in the backlog.
