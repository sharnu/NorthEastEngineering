# NEE Forge — Stakeholder Pitch Deck Plan (v2)

> 11-slide pitch for time-poor stakeholders. Every slide answers
> exactly one question. Where two are answered the slide is split.

---

## Product naming

- **Full name**: NEE Forge — Production Software
- **Short name** (in body, after first mention): NEE Forge, or just Forge
- **Tag-line**: "Where shop-floor work gets shaped."
- **Why "Forge"**: connects directly to metalwork and fabrication
  (one-syllable, sticky, distinct from anything Excel-y or ERP-y).

Alternative if "Forge" doesn't land with stakeholders: **NEE
Production Software** as the formal name throughout.

## Glossary alignment

Stakeholder-facing language (use throughout the deck):

| Internal term | Stakeholder term used in deck |
|---|---|
| RO / Repair Order | **Job Card** |
| `RO00007` | **Job Card 0007** |
| Source RO Number (from customer paperwork) | **Source RO Number** |
| `repair_orders` table | (never mentioned) |

Example translations:
- "Where's RO00007 right now?" → **"Where's Job Card 0007?"**
- "RO00001 in HOSPITAL" → **"Job Card 0001 is in the Hospital lane"**

---

## Audience & goal

**Audience**: workshop owners, ops director, CFO. Mixed technical
and non-technical. Time-poor.

**Goal**: in-principle adoption decision and a UAT commitment.

**Tone**: confident, specific, numerical (without using monetary
figures for NEE Forge). Every claim backed by a concrete example or
verifiable observation.

## Constraints

- **No monetary values for NEE Forge.** Costs for Excel and Epicor
  Kinetic are widely known and stay in. NEE Forge is described as
  "predictable hosting cost", "no per-user licence fees", or
  "single-line monthly invoice" — never a number.
- **No mention of developers / dev pair / our team.** Use
  institutional voice: "NEE Forge does X", "the system tracks Y".
  Treat it as an established product.
- **No promotional language** ("revolutionary", "AI-powered", etc.).
  Stakeholders see through it.

---

## Story arc — 11 slides

### Slide 1 — Title

- **Header**: NEE Forge
- **Sub**: Production Software for the Workshop
- **Tag-line**: "Where shop-floor work gets shaped."
- **Visual**: split image — left a clipboard with hand-annotated
  Excel printout (the present); right the kanban board screenshot
  (the proposed future). No text overlay.

### Slide 2 — The pain today

The most important slide. If they don't recognise the pain, nothing
else lands. **Speak to specific scenarios from their week.**

- **Bullet list** (each is a real recurring workshop frustration):
  - The Monday-morning printout is stale by 11 a.m. Monday.
  - "Where's the chassis for Job Card 0007?" → 3 phone calls + a
    walk to the floor.
  - Variance is reconciled in arrears — the supervisor learns next
    Friday why something ran late, not in time to act.
  - Every workshop has 3+ versions of "the master sheet" in
    different inboxes. None is current.
  - When a tech reports a blocker, it lives in his head until end of
    day. Sometimes longer.
- **Visual**: a deliberately messy Excel screenshot (any sample
  scheduling sheet works). Annotate two cells in red: "out of date"
  / "duplicate in sheet 3".

### Slide 3 — NEE Forge in one diagram

- **No bullets** — the diagram is the slide.
- **Visual**: horizontal flow showing five personas and what each
  does:

```
SALES        DRAFTER       SUPERVISOR        TECH         QC
PDF intake → Drawings  →  Schedule Job  →  Clock in  →  6-item
auto-builds  + BOM        Cards + 4-week   /out per     checklist
Job Card     upload       capacity heat    task         + customer
                          map                            email
```

- **Caption**: "One system, five personas, one source of truth."

### Slide 4 — Live production floor

The "wow" moment. Show it confidently and let the audience absorb.

- **Visual**: full-bleed screenshot of `/kanban` showing 6+ stations
  with cards. Annotate (8-pt callouts with arrows):
  - "**Hospital lane** — every blocked Job Card surfaces here"
  - "**W19 / W20 badges** — Job Cards carrying over from earlier
    weeks are obvious"
  - "**Force-advance** — supervisor moves a Job Card past a
    sticking station in 2 clicks"
- **Caption**: "Anyone with a browser sees the same shop floor.
  No phone-tree."

### Slide 5 — Mobile tech experience

- **Visual**: two phone screenshots side-by-side in phone frames:
  1. `/tech/tasks` — task list with one BLOCKED entry highlighted
  2. `/tech/tasks/{id}` — clock-in / complete / report blocker
- **Caption**: "One tap to clock in. No PC. No shared logins. The
  shop floor doesn't slow down for the system."
- **Stat (bottom right)**: "Median touchpoint: <30 seconds per task
  event."

### Slide 6 — Insights without a BI team

- **Visual**: stitched composite of three report screenshots —
  Variance Root Cause, Customer Concentration, Strategic Forecast.
- **One sentence under each**:
  - **Variance Root Cause**: "Drilling jig broken accounts for 38h
    of overrun this quarter. Shown automatically."
  - **Customer Concentration**: "Top-3 customers account for 67%
    of hours. DFE = 42% on its own."
  - **Strategic Forecast**: "Job Card 0007 is HIGH risk — Paint
    overcommitted W21 + 18% avg overrun on TP42N template."
- **Caption**: "The reports the supervisor would have asked for in
  three months — already there on day one."

### Slide 7 — Excel vs NEE Forge

Replace the high-level cost comparison with concrete workshop
scenarios. Stakeholders relate to scenarios, not feature lists.

- **Two-column scenario table:**

| Workshop scenario | Excel today | NEE Forge |
|---|---|---|
| "Where's Job Card 0007 right now?" | 5 phone calls + walk to floor | 2-second search; current station + assigned tech visible |
| "How many hours of overrun on the TP42N template last quarter?" | Pivot table + manual reconciliation, ~30 min if the data is even there | One click on the Variance Root Cause report |
| "Who clocked in on Job 0042 last Tuesday?" | Not tracked | Time entries audit log per task |
| "How many Job Cards did DFE bring us last quarter, and how does that compare to the year before?" | Master sheet has running total — if anyone remembered to update it | Customer Concentration tab; per-customer 8-quarter trend |
| "Tech reports the drilling jig is broken at 14:30" | End-of-day note in WhatsApp | Real-time blocker on the kanban; supervisor unblocks with resolution notes |
| "Five drafters working on different ROs simultaneously" | Each emails their progress; supervisor merges into the master sheet | All progress visible live; drafter handoff button flips the scheduling gate green automatically |

- **Bottom-line caption**: "Excel is free until you count the
  reconciliation hours."

### Slide 8 — NEE Forge vs Epicor Kinetic

The single most important comparison slide. Make the asymmetry
unambiguous.

- **Header**: "Both systems can do most things. Only one is built
  for *this* workshop."
- **Two-column scenario table:**

| Capability | Epicor Kinetic | NEE Forge |
|---|---|---|
| Kanban board | Generic ERP kanban — works, but stations and lanes are configured by an external implementer | Body-type tracks (BODY · CHASSIS · SUBFRAME) and Hospital lane built in. No configuration needed. |
| Tech clock-in | Full MES — multi-shift, indirect labor, badge readers | One tap on a phone. No badge reader, no shift configuration. |
| Variance tracking | Cost-variance categories with multi-level approval | 13 reason codes attached at task complete; supervisor sees the root cause aggregate the same day. |
| QC | Multi-step inspection plans with sample sizes, NCR workflow | 6-item checklist that triggers a customer-facing email automatically. |
| Drafter handoff | Engineering Change Order subsystem | Dedicated drafter persona — Layout / BOM / Drawing pack uploads + one-click "drafting complete" gate. |
| Chassis allocation | Generic inventory with lot/serial | Domain-specific match by tag, colour, proximity to required-by date. |
| Implementation effort | 6–18 months, off-shore implementation team | Days. Shipped as a finished product, not a kit. |
| Modules you'll never use | Multi-site · Multi-currency · MRP · EDI · HR · Payroll · Field Service | None — the system is exactly the size of the problem. |

- **Bottom-line caption**: "Kinetic is a kit. NEE Forge is the
  finished cabinet. For one site you don't need a kit."

### Slide 9 — Implementation timeline

The slide that converts skeptics. Visualises the elephant.

- **Visual**: horizontal Gantt with three rows on the same time
  axis (months 0–18):

```
                Month 0 ────────────────────────── 18
EXCEL today    ████████████████████████████████████  (no end date — never gets better)
KINETIC        ┌── design ─┬── build ─┬── test ─┬── train ─┬── go-live ──┐
               0          3          7          11         15            18
NEE FORGE      ┌─UAT─┬─eval─┬─live─┐
               0      1      2
```

- **Annotations**:
  - Excel row: "Today's reality. Indefinite ongoing reconciliation cost."
  - Kinetic row: "Industry-standard implementation timeline."
  - Forge row: "5-day UAT · 30-day evaluation · live in 2 months."
- **Caption**: "Three options. Three timelines. Same calendar."

### Slide 10 — The numbers that close the room

Big-typography slide. Four numbers, no chart, no monetary figures.

```
       5
  days to a public UAT URL
  with your supervisor + 2 techs

       30
  seconds — median tech
  touchpoint (clock-in / out
  / complete / blocker)

       24
  hours / month of supervisor's
  time saved versus reconciling
  three Excel sheets

       0
  per-user licence fees.
  Predictable monthly hosting.
  Single line on the invoice.
```

- **Caption**: "Every number above is verifiable. Ask for the
  evidence appendix."

### Slide 11 — Closing

The decision slide. Both outcomes laid out so the audience picks.

- **Header**: "Two outcomes — your call."
- **Two-column comparison:**

| Do nothing | Adopt NEE Forge |
|---|---|
| Spreadsheets remain the master sheet | UAT live in 5 days on a public URL |
| Variance reasons remain anecdotal | Every overrun has a reason code by month two |
| Phone calls remain the supervisor's day-job | Job Card location answered in 2 seconds |
| Kinetic remains an 18-month maybe | Decision in 30 days — roll-out or walk away |
| Cost is invisible but real | Cost is line-item visible and capped |

- **Final tag-line** (bottom centre, large): **"Pick a UAT start
  date this week."**
- **Contact details** in small type at the bottom corner.

---

## Speaker notes — the load-bearing sentence per slide

If only these eleven sentences are said and the eleven visuals are
shown, the deck still wins.

1. (Title) "From whiteboard to web in 14 days."
2. (Pain) "Show of hands — who's been on a phone call this week to
   find out where a job is?"
3. (Forge in one diagram) "One system, five personas, one source of truth."
4. (Kanban) "First question of the day, answered without a phone call."
5. (Mobile) "If a tech needs more than two taps to clock in, they
   won't."
6. (Reports) "The reports the supervisor would have asked for in
   three months — already there on day one."
7. (Excel vs Forge) "Excel is free until you count the
   reconciliation hours."
8. (Kinetic vs Forge) "Kinetic is a kit. NEE Forge is the finished
   cabinet."
9. (Timeline) "Three options. Three timelines. Same calendar."
10. (Numbers) "Five days. Thirty seconds. Twenty-four hours. Zero
    per-user fees."
11. (Close) "Pick a UAT start date this week."

---

## Visual / branding guidance

- **Aesthetic**: ink black on cream paper, accent burnt-orange
  (#c2410c) for emphasis. Match the app's design system so
  audiences feel they're seeing the same product on screen and in
  the deck.
- **Typography**: Fraunces (display, slide headers), Inter (body),
  JetBrains Mono (numbers + Job Card IDs).
- **Screenshots**: capture from the running app in the **light
  theme** — projector contrast is much better than the SaaS theme.
  Hide dev artefacts ("Updated HH:MM:SS" timestamps).
- **No clip-art, no stock photography of "team meetings", no emoji
  on slides**, no vendor logos beyond Epicor's on slide 8.
- **Density rule**: ≤ 6 lines of text on any slide. Tables on
  slides 7 / 8 are the exception.

---

## Image checklist before generating slides

| # | Image | Source | Notes |
|---|---|---|---|
| 1 | Clipboard with Excel printout | Stock photo or workshop-supplied | For slide 1 left-side |
| 2 | Kanban board (light theme) | `/kanban` as `supervisor` | All stations visible · ≥ 1 Hospital card · week filter on current Monday |
| 3 | Excel scheduling sheet | Stock | For slide 2; messy enough to make the point |
| 4 | Tech task list | `/tech/tasks` as `peter` | In phone frame; ≥ 1 BLOCKED entry |
| 5 | Tech task detail | `/tech/tasks/{id}` as `peter` | In phone frame; clock-in button visible |
| 6 | Variance Root Cause | Reports tab | groupBy = Reason · last 90 days |
| 7 | Customer Concentration | Reports tab | last_quarter · top-3 banner visible |
| 8 | Strategic Forecast | Reports tab | ≥ 1 HIGH-risk row with factors expanded |

---

## Variants

**90-second elevator pitch**: keep slides 1, 4 (kanban), 8 (Kinetic
asymmetry), 10 (numbers), 11 (close). Drop the rest.

**Technical buyer (CTO/CIO)**: insert between slides 9 and 10:
- "Stack: Angular 18 + .NET 10 minimal APIs + PostgreSQL 16. Source
  in your control. Hosted in Australian data centre. Test suite
  green on every change."

**Hostile audience (committed Kinetic shop)**: lead with slide 8;
acknowledge Kinetic is the better tool for *some* problems
explicitly; reposition NEE Forge as a complement, not a replacement.

---

## Final QA checklist

- [ ] No slide has more than 6 lines of text (excluding tables on slides 7 / 8)
- [ ] No monetary value for NEE Forge appears anywhere in the deck
- [ ] No mention of developers, dev pair, our team
- [ ] All "RO" / "RO0000X" replaced with Job Card / Job Card 000X
- [ ] Source RO Number used only when referring to customer's paperwork
- [ ] Every screenshot < 24 hours old at presentation time
- [ ] Live app at `localhost:4200` ready to demo if stakeholders want
- [ ] Numbers on slide 10 verified: 5 days, 30 seconds, 24 hours, 0 fees
- [ ] Workshop / customer names spelled correctly
- [ ] Run on the actual projector / TV the day before — cream
      backgrounds darken on cheap screens
