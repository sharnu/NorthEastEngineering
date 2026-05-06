# End-to-End Verification: RO Creation → Scheduling

This document walks through the complete flow from uploading a source PDF through to a scheduled RO appearing in the capacity heatmap. Follow each step in order and confirm the expected outcome before continuing.

**Prerequisites:** `make dev` is running (API on :5000, Angular on :4200). The DB has been seeded (`make seed`).

---

## Part 1 — Create a Repair Order (Sales)

### Step 1 — Log in as Sales

- URL: `http://localhost:4200`
- Username: `sales` · Password: `nee2026`

Expected: redirected to **Repair Orders** list at `/sales/ros`.

---

### Step 2 — Start a new RO

Click **+ New RO**.

Expected: a file-drop zone appears. You are now at `/sales/new-ro`.

---

### Step 3 — Upload a source PDF

Drag any of the sample PDFs from `docs/` onto the drop zone, e.g.:

```
docs/58734 - DFE - TAUTLINER.pdf
```

Expected:
- Upload bar progresses and disappears.
- You are redirected to `/sales/pdf-review/<uploadId>`.
- Left panel shows the PDF rendered in an iframe.
- Right panel shows **Review Extracted Fields** with the parsed values.

---

### Step 4 — Review extracted fields

Check each extracted field in the right panel:

| Field | Expected value from 58734 |
|---|---|
| Source RO No | `58734` |
| Source RO Date | `dd MMM yyyy` format |
| Customer | `Direct Freight Express` |
| Rego | should be populated |
| Make | `Isuzu` (or similar) |
| Model | populated |

If a field shows **NOT FOUND**, the regex did not match — acceptable for optional fields, not acceptable for Source RO No or Customer.

---

### Step 5 — Select a template and submit

1. In the **Job Template** section, click any template card (e.g. `TP42N — Tautliner`). The card highlights in dark ink with white text.
2. Confirm **Priority**, **Required Date**, and **Expected In** are set as needed.
3. Click **Create Repair Order**.

Expected:
- A green toast appears: `RO XXXXX created with N tasks`.
- You are redirected to `/sales/ro/<roId>?created=1`.

---

## Part 2 — Review the Created RO (Sales)

### Step 6 — Confirm the RO detail page

URL: `/sales/ro/<roId>`

Verify the three-column layout shows:

**Column 1 — Customer & Source RO**
- Customer name matches what was extracted
- Source RO No, Required Date, Priority badge all populated

**Column 2 — Vehicle**
- Rego, Make, Model, Chassis/Engine No (if extracted)

**Column 3 — Tasks**
- List of N operations with sequence numbers, station names, and estimated hours
- All tasks show status `PENDING`

Note the **RO number** (e.g. `RO00005`) — you will need it for Step 8.

---

## Part 3 — Set the Drafting Gate (DB — no UI yet)

The drafting gate has no UI in this release. Set it directly in the database:

```bash
docker exec -i $(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1) \
  psql -U nee -d nee -c \
  "UPDATE repair_orders SET drafting_status = 'COMPLETED' WHERE ro_number = 'RO00005';"
```

Replace `RO00005` with the actual RO number from Step 6.

Expected output: `UPDATE 1`

---

## Part 4 — Scheduling (Supervisor)

### Step 7 — Log in as Supervisor

Sign out from the Sales account (or open a new browser / private window).

- URL: `http://localhost:4200`
- Username: `supervisor` · Password: `nee2026`

Expected: redirected to the **Supervisor Dashboard** at `/dashboard`.

---

### Step 8 — Open the Scheduling tab

Click **Scheduling** in the tab bar (alongside Overview and Reports).

Expected: the **Scheduling Backlog** table loads with all active ROs. Find the RO from Step 6.

Verify the gate columns for that RO:

| Gate | Expected state |
|---|---|
| Draft | ✓ green (set in Step 8) |
| Approval | ✗ grey |
| Chassis | ✗ grey |

The **Schedule** button is disabled (grey, not clickable).

---

### Step 9 — Approve the customer drawing

Click the grey **✗ Approval** pill for the RO.

Expected: a popover opens with:
- A "Signed by" text input
- A "Notes (optional)" input
- A **Mark approved** button (disabled until name is entered)

1. Type a name in **Signed by** (e.g. `James Carter`).
2. Click **Mark approved**.

Expected:
- Popover closes.
- The **Approval** pill turns green: `✓ Approval`.

---

### Step 10 — Allocate a chassis

Click the grey **✗ Chassis** pill for the same RO.

Expected: a popover lists the three seeded chassis:

```
CN-001 — Isuzu NPR 75-190 FRR · Class N
CF-002 — Isuzu FRR 90-210 · Class F
CF-003 — Isuzu FRR 90-210 · Class F
```

Click **CF-002**.

Expected:
- Popover closes.
- The **Chassis** pill turns green: `✓ Chassis`.
- The row now has a **green left border** (all gates met).
- The **Schedule** button activates (dark accent colour, clickable).

Confirm via DB:
```bash
docker exec -i $(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1) \
  psql -U nee -d nee -c \
  "SELECT status, allocated_to_ro FROM chassis_inventory WHERE chassis_number = 'CF-002';"
```

Expected: `status = ALLOCATED`, `allocated_to_ro` = the RO's UUID.

---

## Part 5 — Schedule the RO

### Step 11 — Open the week picker

Click the **Schedule** button on the all-green row.

Expected: a popover appears with 6 upcoming Mondays, e.g.:

```
Mon 11 May
Mon 18 May
Mon 25 May
Mon 01 Jun
Mon 08 Jun
Mon 15 Jun
```

---

### Step 12 — Pick a start week

Click any week, e.g. **Mon 11 May**.

Expected:
- Popover closes.
- The **Scheduled week** column for the RO now shows `11 May`.
- The button label changes from **Schedule** to **Reschedule**.

Confirm via DB:
```bash
docker exec -i $(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1) \
  psql -U nee -d nee -c \
  "SELECT ro_number, scheduled_start_week FROM repair_orders WHERE scheduled_start_week IS NOT NULL;"
```

Expected: the RO row shows `scheduled_start_week = 2026-05-11` (or the date you selected).

Also confirm the domain event was recorded:
```bash
docker exec -i $(docker ps --filter "name=postgres" --format "{{.Names}}" | head -1) \
  psql -U nee -d nee -c \
  "SELECT event_type, payload FROM domain_events WHERE event_type = 'RoScheduled' ORDER BY occurred_at DESC LIMIT 1;"
```

Expected: one row with `event_type = RoScheduled` and a payload containing the RO ID and start week.

---

## Part 6 — Verify the Capacity Heatmap

### Step 13 — Read the heatmap

Scroll down below the backlog table. The **4-Week Station Capacity** heatmap is visible.

Find the station that owns the operations on the RO you scheduled (e.g. **Fabrication Line** or **Paint Shop**). The column for the week you chose (e.g. `11 May`) should now show a non-zero hour count.

Colour band:
- Green cell (≤ 70% of 40h = ≤ 28h): normal load
- Amber cell (70–95% = 28–38h): nearing capacity
- Red cell (> 95% = > 38h): over-committed

Stations that have no tasks scheduled for a week show `0h` in a plain (un-coloured) cell.

---

### Step 14 — Re-schedule (optional regression check)

Click **Reschedule** on the same RO and pick a different week.

Expected:
- Popover closes.
- The **Scheduled week** column updates to the new week.
- The heatmap refreshes: hours move from the old week's column to the new week's column.

---

## Part 7 — Negative / Validation Checks

### API validation (via curl or Swagger at `http://localhost:5000/swagger`)

**Wrong day of week → 400:**
```bash
curl -s -X PUT http://localhost:5000/api/scheduling/ros/<roId>/schedule \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"startWeek":"2026-05-06"}'
```
`2026-05-06` is a Wednesday. Expected response:
```json
{"message":"Start week must be a Monday."}
```

**Past date → 400:**
```bash
curl -s -X PUT http://localhost:5000/api/scheduling/ros/<roId>/schedule \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"startWeek":"2025-01-06"}'
```
Expected:
```json
{"message":"Start week cannot be in the past."}
```

**Chassis already allocated → 409:**
```bash
curl -s -X POST http://localhost:5000/api/scheduling/chassis/<cf002Id>/allocate \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"roId":"<any-other-ro-uuid>"}'
```
Expected: `409 Conflict {"message":"Chassis already allocated."}`

---

## Part 8 — Integration Tests (automated)

Run the automated integration tests that cover the same scenarios programmatically:

```bash
dotnet test api.tests/ --filter "FullyQualifiedName~SchedulingEndpointTests" \
  --logger "console;verbosity=normal"
```

Expected: **11 passed, 0 failed**.

To run the full test suite:
```bash
make test
```

---

## Summary Checklist

| # | Step | Verified |
|---|---|---|
| 1 | Login as `sales` | ☐ |
| 2 | Upload source PDF at `/sales/new-ro` | ☐ |
| 3 | Extracted fields match PDF content | ☐ |
| 4 | Select template and create RO | ☐ |
| 5 | RO detail shows all fields and tasks | ☐ |
| 6 | Set `drafting_status = COMPLETED` via DB | ☐ |
| 7 | Login as `supervisor`, open Scheduling tab | ☐ |
| 8 | Draft gate shows green for the RO | ☐ |
| 9 | Approve customer drawing via popover | ☐ |
| 10 | Allocate chassis CF-002 via popover | ☐ |
| 11 | All three gates green, row has green border | ☐ |
| 12 | Schedule button enabled, pick a week | ☐ |
| 13 | Scheduled week appears in table | ☐ |
| 14 | DB confirms `scheduled_start_week` and `RoScheduled` event | ☐ |
| 15 | Heatmap shows hours for the scheduled week | ☐ |
| 16 | Re-schedule moves hours to new week | ☐ |
| 17 | Validation errors for non-Monday / past dates | ☐ |
| 18 | `dotnet test` — 11 scheduling tests pass | ☐ |
