# Operational Flow — PDF vs Current Seed (Phase 0 Diff)

**Source PDF:** `NE Operation flow (1).pdf` (received 2026-05-09)
**Goal:** decide, per row, whether the PDF or the current DB seed is authoritative, then drive the migration plan from those decisions.

For each row below, my best-judgement default is marked **[default: …]**. To override, edit the row and replace `default` with `PDF` / `DB` / `merge` / `skip`. Anything you don't touch will be taken at the default.

---

## 1. Body types

The PDF mentions ten body-type lanes. Current `body_types` table has 11 rows but doesn't cover everything.

| PDF body type | In `body_types`? | Current row | Decision |
|---|---|---|---|
| TRAY | yes | id=1, code=TR | — |
| TAUTLINER | yes | id=3, code=TT | — |
| BEAVERTAIL | **no** | (missing) | **[default: ADD]** as code=BV, body_type string=BEAVERTAIL (already used in flow_definitions) |
| CHIPPER | yes | id=5, code=CH | — |
| TIPPER | yes | id=2, code=TP | — |
| TRAY CRANE | shared with TR or own? | (no separate row) | **[default: skip]** treat as TR variant; PDF lumps it with Chipper/Tipper for flow purposes only |
| TIPPER C/S | yes (logical) | TP with subtype | — (no schema change; flow is `TIPPER_CS`) |
| PANTECH STEEL | yes | id=4 (DP) | — |
| PANTECH ALUMINIUM | yes | id=4 or id=7 | **[default: clarify]** — id=4 (DP) seems steel/general; id=7 (VP) may be vacuum pantech, not aluminium pantech |
| TRAILER | no row | (missing) | **[default: ADD]** as code=TL, body_type=TRAILER |
| TILT SLIDER | yes | id=6, code=TS | — |
| BODY SWAP | yes | id=8, code=BS | — |
| **VAC UNIT** | maybe (id=7 VP?) | name="Vac pantech" | **[default: clarify]** — VP="vac pantech" is a body type for vacuum pantech bodies; "VAC UNIT" in the PDF is a different vehicle category. May need a separate code. |
| **WATER CART** | no | — | **[default: ADD]** as code=WT, body_type=WATER_CART (only if flows are wanted; otherwise skip) |
| **HOOK LIFT** | no | — | **[default: ADD]** as code=HK, body_type=HOOK_LIFT (only if flows are wanted) |

**Open questions for you:**
- `body_types.id=7 (VP, "Vac pantech")` — is this for vacuum-pantech *bodies* or *vacuum-unit* trucks (the latter being PDF's "VAC UNIT")? The two names suggest different things.
- For VAC / WATER CART / HOOK LIFT, do these get authored production flows, or are they just registry entries with no kanban journey?

---

## 2. Production flows (the meat)

### 2a. TRAY

| Sort | PDF | Current DB | Diff |
|---|---|---|---|
| 1 | (Production Line) | MATERIAL_PROC | (PDF's Production Line ≈ Mat Proc + Fab Line; DB splits) |
| 2 | (Production Line) | FAB_LINE | |
| 3 | PAINT & PANEL | PAINT_PANEL | match |
| 4 | BODY FITOUT (B1) | BODY_FITOUT | match |
| 5 | **FINAL FITMENT (B2)** | (missing — DB jumps to QC) | **PDF adds a step** |
| 6 | FINAL QC | COMPLIANCE_QC | match |

**[default: PDF wins]** — add `FINAL_FITMENT` between `BODY_FITOUT` and `COMPLIANCE_QC`.

### 2b. TAUTLINER

Same shape as TRAY. **[default: PDF wins]** — add `FINAL_FITMENT`.

### 2c. BEAVERTAIL

Same shape as TRAY. **[default: PDF wins]** — add `FINAL_FITMENT`.

### 2d. CHIPPER / TIPPER / TRAY CRANE (`flow_definitions.body_type = 'CHIPPER_TIPPER_TRAY_CRANE'`)

PDF and DB align on all three tracks (BODY 6 stations, CHASSIS 4, SUBFRAME 4). **[default: keep DB as-is, no change]**

### 2e. TIPPER C/S (`TIPPER_CS`)

PDF and DB align (BODY uses ROBOTIC_FAB instead of FAB_LINE; rest matches). **[default: keep DB]**

### 2f. PANTECH (STEEL BASE) (`PANTECH_STEEL`)

| Sort | PDF | Current DB | Diff |
|---|---|---|---|
| 1 | PRODUCTION LINE | FAB_LINE | match (Fab line = Production line) |
| 2 | PAINT & PANEL | PAINT_PANEL | match |
| 3 | PANTECH (Viral) | PANTECH | match |
| 4 | FINAL QC | COMPLIANCE_QC | match |

**[default: keep DB as-is]**

### 2g. PANTECH (ALUMINIUM BASE) (`PANTECH_AL`) ⚠️

| Sort | PDF | Current DB BODY track | Diff |
|---|---|---|---|
| 1 | (no production-line step) | ROBOTIC_FAB | DB has step PDF doesn't |
| 2 | (no paint step shown) | PAINT_PANEL | DB has step PDF doesn't |
| 3 | PANTECH (Viral) | PANTECH | match |
| — | FINAL QC | COMPLIANCE_QC | match |

DB also has a CHASSIS track (CHASSIS_PREP → HYVA → FINAL_FITMENT → QC) that the PDF doesn't show.

**[default: PDF wins for body track, keep DB CHASSIS]** — replace BODY track with just `PANTECH → COMPLIANCE_QC`. Keep CHASSIS track (the PDF likely abstracts it as "this body lands on a prepped chassis like the others", so the chassis track is implied but not drawn).

> ⚠️ **Strong override candidate** — if the DB's longer body track reflects how the line actually runs (frame manufacture before pantech assembly), keep DB.

### 2h. TRAILER ⚠️

| Sort | PDF | Current DB BODY track | Diff |
|---|---|---|---|
| 1 | (no Mat Proc shown) | MATERIAL_PROC | DB extra |
| 2 | ROBOTIC FABRICATION | ROBOTIC_FAB | match |
| 3 | PAINT & PANEL | PAINT_PANEL | match |
| 4 | (no Body Fitout shown) | BODY_FITOUT | DB extra |
| 5 | (no Final Fitment shown) | FINAL_FITMENT | DB extra |
| 6 | (PDF shows HYVA on a separate "TEBS Hyd" lane) | — | TEBS branch missing from DB |
| 7 | FINAL QC | COMPLIANCE_QC | match |

DB also has CHASSIS track (CHASSIS_PREP → HYVA → FINAL_FITMENT → QC).

**[default: merge]** — keep DB's BODY track but consider whether `BODY_FITOUT` + `FINAL_FITMENT` are really used for trailers (a trailer has no chassis-mounted fitment). PDF's "Body & Chassis: Robotic Fab → Paint" + "TEBS Hyd: HYVA → QC" suggests a simpler 3-station flow.

> ⚠️ **Strong override candidate** — trailer ops are nothing like body-on-truck ops. The DB's flow may be wrong.

### 2i. TILT SLIDER ⚠️

| Sort | PDF | Current DB BODY track | Diff |
|---|---|---|---|
| 1 | PRODUCTION LINE | ROBOTIC_FAB | mismatch — PDF says Prod Line, DB says Robotic Fab |
| 2 | PAINT & PANEL | PAINT_PANEL | match |
| 3 | (no Body Fitout) | BODY_FITOUT | DB extra |
| 4 | **HYVA FITMENT (Danny)** | FINAL_FITMENT | mismatch — PDF says HYVA, DB says Final Fitment |
| 5 | FINAL QC | COMPLIANCE_QC | match |

PDF Subframe & Chassis combined: HYVA → PAINT → fits to chassis.
DB has separate CHASSIS (CHASSIS_PREP → HYVA → FINAL_FITMENT → QC) and SUBFRAME (PAINT → HYVA → FINAL_FITMENT) tracks.

**[default: PDF wins for body track]** — replace BODY with `FAB_LINE → PAINT_PANEL → HYVA → COMPLIANCE_QC`. Subframe & Chassis: keep DB but flag for review.

### 2j. BODY SWAP

PDF has a box only (no internal flow). DB has CHASSIS track (CHASSIS_PREP → HYVA → FINAL_FITMENT → QC).

**[default: keep DB]** — PDF doesn't elaborate, DB has a sensible flow.

### 2k. VAC UNIT / WATER CART / HOOK LIFT

PDF has boxes only, no internal flow. None in DB.

**[default: skip]** — without a flow specified, there's nothing to seed. If you want them tracked on the kanban, we'd need to author a flow (likely similar to TRAY: prod line → paint → fitout → final fitment → QC).

---

## 3. Station personnel

PDF has named staff per station (in the "by Adam Miller / Scott / Shanks / Danny" annotations). Current `station_technicians` has placeholder/mock names.

| Station | PDF person | Current primary tech | Suggested action |
|---|---|---|---|
| MATERIAL_PROC (10) | (not labelled in PDF) | Marcus Webb | keep |
| FAB_LINE (20) — "Production Line" | Adam Miller | Dave Norris, Peter Rogers | **[default: replace primary with Adam]** — PDF identifies Adam as Production Line owner. Move Adam from BODY_FITOUT to here. |
| ROBOTIC_FAB (25) | Kai | Wei Zhang | **[default: replace with Kai]** — would need to add user `kai` (no surname in PDF) |
| PAINT_PANEL (30) | Scott | Liam Cross | **[default: replace primary with Scott Barker]** — Scott already exists but on CHASSIS_PREP. Move him here. |
| BODY_FITOUT (40) | Shanks | Adam Miller | **[default: replace with Shanks]** — would need new user. Shanks also owns Final Fitment + Chassis Prep per PDF. |
| CHASSIS_PREP (50) | Shanks | Scott Barker | **[default: replace with Shanks]** |
| HYVA (60) | Danny (Galvin) | Garry Sloane | **[default: replace with Danny Galvin]** — new user `danny` |
| FINAL_FITMENT (70) | Shanks | Tony Burlack | **[default: replace with Shanks]** |
| PANTECH (80) | Viral (Patel) | Ray Gould | **[default: replace with Viral Patel]** — new user `viral` |
| COMPLIANCE_QC (90) | Sammy & Sid | Greg Sims | **[default: replace with Sammy + Sid]** — two new users; Greg drops to secondary |

**Open question:** PDF's mock seed ("Tony Burlack", "Garry Sloane", "Wei Zhang", etc.) was useful for a 26-account demo. Replacing means losing those test accounts, which could affect Playwright specs that hard-code those names. Two paths:

- **(a) Hard replace** — drop mocks, install PDF names. Tests using "Tony Burlack" etc. will need updates.
- **(b) Add alongside** — add PDF names as new users with PDF-correct station assignments, leave mocks as secondary techs. Larger user list but no test breakage.

**[default: option (b)]** — additive, less risky.

---

## 4. Pre-production roles (PDF left column)

The PDF annotates each pre-production stage with responsible people:

| Stage | PDF roles |
|---|---|
| RFQ → Quote | BC (Brenton Coleby), MG (Montanah G), AR (Akshay Raikar), reviewers BW + DF |
| Job Card Creation & Review | BC + MG (new builds), MG + LK (accessories), AR (repair/warranty), DF + BW (review) |
| Enter in MPS | Ella, LK (notes), Sid (chassis report), BW (drafting priority) |
| Drafting assignment | BW |
| Customer Approval Layout | (drafter + DF) |
| Job Pack release | Ella → Majid |
| Final QC | Sammy + Sid |

The system has the *stages* but no per-stage role-ownership data. Two paths:

- **(a) Documentation-only** — extend `docs/ro-lifecycle-flow.md` with this annotation table. Zero schema/code changes. **[default]**
- **(b) Schema-backed** — add a `kanban_stage_responsibilities` table. ~1 day's work; only worthwhile if the kanban UI needs to surface "who owns this stage".

---

## 5. Summary of decisions to confirm

For convenience, here's everything compressed. Mark each line with your call.

```
B-1   ADD body_type BEAVERTAIL                    [default: ADD]
B-2   ADD body_type TRAILER                       [default: ADD]
B-3   ADD body_type WATER_CART (only if flow)     [default: SKIP]
B-4   ADD body_type HOOK_LIFT (only if flow)      [default: SKIP]
B-5   Clarify: VP "Vac pantech" vs PDF "VAC UNIT" [default: SKIP]

F-1   TRAY: insert FINAL_FITMENT before QC        [default: PDF wins]
F-2   TAUTLINER: insert FINAL_FITMENT before QC   [default: PDF wins]
F-3   BEAVERTAIL: insert FINAL_FITMENT before QC  [default: PDF wins]
F-4   PANTECH_AL BODY: shorten to PANTECH→QC       [default: PDF wins]
F-5   PANTECH_AL CHASSIS: keep                    [default: keep DB]
F-6   TRAILER: shorten BODY to ROBOTIC_FAB→PAINT->HYVA  [PDF wins ]
F-7   TILT_SLIDER BODY: replace ROBOTIC_FAB→FAB_LINE, FINAL_FITMENT→HYVA_FITMENT  [default: PDF wins]
F-8   BODY_SWAP: keep DB                          [default: keep DB]
F-9   VAC/WATER/HOOK flows: skip unless authored  [default: SKIP]

P-1   Add user `kai` for Robotic Fab              [default: ADD]
P-2   Add user `danny` (Danny Galvin) for HYVA   [default: ADD]
P-3   Add user `viral` (Viral Patel) for Pantech [default: ADD]
P-4   Add user `shanks` for Body/Final/Chassis   [default: ADD]
P-5   Add user `sammy` for Compliance QC         [default: ADD]
P-6   Add user `sid` for Compliance QC + chassis [default: ADD]
P-7   Move Scott Barker → PAINT_PANEL primary    [default: ADD]
P-8   Move Adam Miller → FAB_LINE primary        [default: ADD]
P-9   Keep mocks as secondary techs              [default: option (b) additive]

R-1   Pre-prod role annotations: docs-only       [default: docs-only]
```

---

## Next step

When you've reviewed (no need to mark anything if you're happy with defaults — just say "go"), I'll:

1. Generate `026_align_body_types_to_pdf.sql` for the B-* changes
2. Generate `027_align_flow_definitions_to_pdf.sql` for the F-* changes
3. Generate `028_align_station_personnel_to_pdf.sql` for the P-* changes
4. Update `docs/ro-lifecycle-flow.md` with the pre-production role annotations (R-1)
5. Run the standard verification (smoke-test materialise an RO per body type, confirm `dotnet test` + `ng build` clean)
