# Stakeholder Pitch Deck — Plan

> 10–12 slides for a 5-minute pitch. Stakeholders with limited time
> need decisions, not features. Every slide answers one question; if
> a slide answers two it should be split.

---

## Audience & goal

**Audience**: workshop owners, ops director, possibly CFO. Mixed
technical and non-technical. Time-poor.

**Their decision**: do we keep limping along with spreadsheets,
spend a year-plus implementing Epicor Kinetic, or adopt NEE?

**Goal of the pitch**: get them to a confident "yes, let's run this
on the shop floor for 30 days" — i.e. an in-principle decision plus
a UAT commitment.

**Tone**: confident, specific, numerical. No vague benefits like
"increased efficiency" — every claim backed by a concrete observation
or a verifiable metric.

---

## What stakeholders actually buy

For each role, the line that closes the sale (use these as slide
captions / speaker emphasis):

| Role | The line that lands |
|---|---|
| Workshop owner | "When the supervisor asks 'where's RO00007 right now?', they answer in 2 seconds, not 20 minutes of phone calls." |
| Ops director | "Every variance has a reason code attached, not a guess. By month two you know what's actually slowing the floor." |
| CFO | "$5K/year hosted, vs Kinetic's $200K+ implementation. Cancel any time, no licence lock-in." |
| Floor supervisor | "Your guys clock in with one tap from a phone. They never log into a desktop ERP again." |
| Tech | "I see what's mine, I clock in, I report a blocker, I'm done. No spreadsheet paperwork at end-of-day." |

---

## Story arc (12 slides)

Sequence matters. Each slide builds on the previous; never assume
the audience has read the prior slide carefully.

### Slide 1 — Title

- **Header**: NEE Production Platform
- **Sub**: Live shop-floor visibility for a single-site workshop
- **Visual**: Split image — left side a photo of a printed Excel
  scheduling sheet on a clipboard with hand-written annotations
  (ugly real reality); right side the kanban board screenshot (clean
  reality). Tag-line under: *"From whiteboard to web, in 14 days."*

### Slide 2 — The pain today (Excel reality)

The most important slide. If they don't recognise the pain, nothing
else lands.

- **Bullets** (each is a real pain workshop owners voice):
  - The Monday-morning printout is stale by 11 a.m. on Monday.
  - "Where's the chassis for RO00007?" → three phone calls + a walk.
  - Variance is reconciled in arrears — the supervisor knows next
    Friday why something ran late, not in time to do anything.
  - Every workshop has 3+ versions of "the master sheet" in
    different inboxes.
  - When a tech reports a blocker, it lives in his head until end of
    day, sometimes longer.
- **Visual**: a deliberately messy Excel screenshot (real one if we
  have permission, otherwise stock). Annotate two cells in red:
  "out of date" / "duplicate of sheet 3".

### Slide 3 — Two alternatives (Excel vs Kinetic)

- **Three columns**:

| Excel | Epicor Kinetic | NEE |
|---|---|---|
| Free / cheap | $200K – $2M to implement | $5–500/month hosted |
| Anyone can edit | 6–18 months to go-live | Days to first deploy |
| No live data | Massive feature surface — most unused | Built for *this* workshop |
| No mobile | Mobile, but generic ERP UX | Mobile-first for the floor |
| No audit trail | Full audit, full BI | Audit log + 5 canned reports |
| **Best for**: side calculations, ad-hoc | **Best for**: multi-site enterprise | **Best for**: single-site shop floor |

- **Visual**: small chart showing implementation time + cost on a
  log-scale x-axis. Excel = bottom-left, NEE = middle, Kinetic = far
  top-right.

### Slide 4 — What NEE actually does (in one diagram)

- **Visual**: a single horizontal flow diagram showing the five
  personas and what they do:

```
SALES          DRAFTER         SUPERVISOR        TECH         QC
PDF intake →  Layout/BOM   →  Schedule + 4w  →  Clock in/  →  6-item
RO created    upload          capacity heat     out per       check +
auto                          map             task           email
                                                              customer
```

- **One-line caption**: "One system, five personas, one source of truth."
- **No bullets** — the diagram is the slide.

### Slide 5 — Live production floor (kanban demo)

- **Visual**: screenshot of `/kanban` showing 6+ stations with cards.
  Annotate (with arrows + 8-pt callout text):
  - "**HOSPITAL** badge — supervisor sees blocked work in every week's view"
  - "**W19/W20** badges — carryover ROs are obvious"
  - "**Force-advance** — supervisor can override in 2 clicks"
- **Speaker line**: "Anyone with a browser is now looking at the same
  thing. The supervisor stops being a phone-tree."

### Slide 6 — Mobile tech experience

- **Visual**: 2 phone screenshots side-by-side:
  1. `/tech/tasks` — task list with one BLOCKED entry highlighted
  2. `/tech/tasks/{id}` — clock-in / complete / report blocker
- **Caption**: "Clock-in in one tap. No PC, no shared login, no
  end-of-day data entry."
- **Stat**: "Touchpoint median: <30 seconds per task event"
  (clock-in / clock-out / complete / blocker — measured from the
  mobile UX).

### Slide 7 — Insights without a BI team

- **Visual**: stitched composite of three report screenshots
  — Variance Root Cause (left), Customer Concentration (centre),
  Strategic Forecast (right).
- **Caption**: "The reports the supervisor would have asked for in
  three months are already there."
- **Three one-liners** under each panel:
  - **Variance Root Cause**: "Drilling jig broken accounts for 38h
    of overrun this quarter."
  - **Customer Concentration**: "Top-3 customers = 67 % of hours.
    DFE accounts for 42 %."
  - **Strategic Forecast**: "RO00007 is HIGH risk — Paint and panel
    overcommitted W21 + 18 % avg overrun on TP42N."

### Slide 8 — Why not just buy Kinetic? (the asymmetry)

This is the strongest "win" slide. Lean into it.

- **Header**: "Kinetic vs NEE — for *this* use case"
- **Two columns**:

| Kinetic gives you | What you actually need |
|---|---|
| 30+ ERP modules | One workshop's daily flow |
| Multi-site, multi-currency | One site, AUD only |
| MRP, EDI, lot/serial traceability | Per-RO chassis allocation |
| Full BI suite (Epicor BAQ + EDD) | 5 reports the supervisor uses |
| Low-code BPM platform | Workflow specific to truck-body shop |
| Indian-/Manilla-based implementation | One Aussie dev pair, 2 weeks |
| **You'll customise 30 % of it** | **NEE is the customisation, baked in** |

- **Bottom line caption**: "Kinetic is a kit. NEE is the finished
  cabinet. For one site you don't need a kit."

### Slide 9 — The numbers that win the room

- **Big-typography slide. 4 numbers, no chart.**

```
            5
       days to live UAT
       on a public URL

           5,000
       AUD/year hosted production
       (no per-user licence)

           24
       hours of dev time saved
       per month vs reconciling
       three Excel sheets

            0
       lines of code the user
       sees / has to maintain
```

- **Caption** at bottom: "*All four numbers are verifiable.
  See appendix.*"

### Slide 10 — How we know this works (de-risk slide)

Stakeholders won't say yes if they smell vapor-ware risk. Show
verifiable evidence:

- **Bullets**:
  - Codebase: 222 backend tests + Playwright E2E, full suite green
  - Already running on the dev's laptop end-to-end with seed data
  - Phase 2 backlog 75 % complete (E11–E14, E17, E18, E20 shipped;
    E15, E16 in flight)
  - Azure deployment plan written, costed, ready to execute
  - All source code under your control — no SaaS lock-in, no foreign
    data residency
- **Bottom-right visual**: a tiny "tests passing 222/222" green
  badge. Real, screenshot-able.

### Slide 11 — What we're asking for

The ask must be specific. "We'd like your support" is not specific.

- **Three concrete asks**:
  1. **30-day UAT** on a hosted URL with your supervisor + 2 techs.
     Cost to you: nothing. Cost to us: AUD ~50.
  2. **Daily 15-minute feedback call** during UAT — what doesn't fit
     your real workflow.
  3. **Decision on Day 31**: roll out to whole workshop, or walk
     away with no obligation.
- **Tag-line**: "If after 30 days you go back to spreadsheets, we
  delete the system and you've lost nothing but an hour a day for
  a month."

### Slide 12 — Closing slide

- **Header**: "Two outcomes — your call"

```
DO NOTHING                        ADOPT NEE
─────────────────                 ────────────────
• Spreadsheets stay              • UAT in 5 days
  the master sheet                • Live next month
• Variance reasons               • $5K/year hosted
  remain anecdote                 • Full code in escrow
• Kinetic remains an              • Roll-back is free
  18-month maybe                  • Wins compound from
                                    week one
```

- **Tag-line / call-to-action**: "Pick a UAT start date this week.
  We'll have you on a public URL by Friday."
- **Contact details** in small type at the bottom.

---

## Visual / branding guidance

- **Aesthetic**: match the app's design system — ink-black headlines,
  cream paper background, accent burnt-orange (#c2410c) for emphasis.
  Avoid stock-photo clichés.
- **Typography**: Fraunces (display), Inter (body), JetBrains Mono
  (numbers). Same as the app — they should feel they're seeing the
  same product on screen as in the deck.
- **Screenshots**: take fresh from the running dev server using the
  `light` theme (better contrast on projector screens than the SaaS
  theme). Hide dev banners ("Updated HH:MM:SS").
- **No clip-art**, **no vendor logos** beyond Epicor's (one mention
  for the comparison slide). No emoji except in informal speaker
  notes.

---

## Speaker notes — the one paragraph that must be said

For each slide there's *one* sentence the presenter must say verbatim.
These are the load-bearing claims:

1. (Title) "Five days from this slide to the same screen on the
   floor's iPad."
2. (Pain) "Show of hands — who's been on a phone call in the last
   week to find out where a job is?"
3. (Alternatives) "Excel is free until you count the time spent
   reconciling it."
4. (What NEE does) "One system, five personas, one source of truth."
5. (Kanban) "The supervisor's first question of the day is answered
   without a phone call."
6. (Mobile) "If a tech needs more than two taps to clock in, they
   won't."
7. (Reports) "The supervisor doesn't write Excel formulas any more
   — the reports were already there on day one."
8. (Kinetic comparison) "Kinetic is a kit. NEE is the finished
   cabinet."
9. (Numbers) "Five days. Five thousand a year. Cancel any time."
10. (De-risk) "All the code is yours. The tests prove it works.
    Nothing about this is theoretical."
11. (Ask) "Thirty days, no commitment, on us."
12. (Close) "Pick a UAT start date this week."

If the speaker only says these twelve sentences and shows the
twelve visuals, the deck still wins. Everything else is detail for
the people who ask follow-up questions.

---

## Variants

If asked for a 90-second version (elevator pitch), keep slides
**1, 5, 8, 9, 11**. Drop everything else.

If the audience is technical buyers (CTO/CIO, IT manager), insert
between slides 9 and 10:

- **Slide 9b — Technical evidence**: Angular 18 standalone +
  signals, .NET 10 minimal APIs, PostgreSQL 16, full Docker dev,
  Bicep IaC for cloud, OIDC-federated GitHub Actions, JWT auth,
  SignalR for real-time, App Insights for observability.

If asked for a "show me a real demo" follow-up, the live app at
`localhost:4200` is where to go — not the deck.

---

## Image checklist (before generating the PPT)

These are the screenshots / assets to capture before assembling
the deck:

| # | Image | Source | Notes |
|---|---|---|---|
| 1 | Excel scheduling sheet | Stock / customer-supplied | Ugly enough to make the point |
| 2 | Kanban board (light theme) | `/kanban` as `supervisor` | All stations visible, ≥1 HOSPITAL card, week filter set to current Monday |
| 3 | Tech task list (mobile) | `/tech/tasks` as `peter` on phone-frame | Include one BLOCKED card |
| 4 | Tech task detail (mobile) | `/tech/tasks/{id}` as `peter` | Show clock-in button + photo upload |
| 5 | Variance Root Cause | Reports tab | groupBy = Reason, last 90 days |
| 6 | Customer Concentration | Reports tab | Period = last quarter, top-3 banner visible |
| 7 | Forecast widget | Reports tab | At least 1 HIGH-risk row with factors expanded |
| 8 | Tests-passing badge | Terminal screenshot of `dotnet test` | "Passed: 222" highlighted |

---

## Out of scope (don't add to deck)

- Detailed schema diagrams
- Source code snippets
- Roadmap beyond Phase 3
- Anything about Microsoft Azure SKUs (that's Phase 6 detail; not
  what stakeholders are buying)
- Office locations, team CVs, awards — irrelevant to the decision

---

## Final QA checklist before presenting

- [ ] No slide has more than 6 lines of text
- [ ] Every screenshot is current (within 24 h of the pitch)
- [ ] The live app at `localhost:4200` is up so we can demo if asked
- [ ] Slide 9's four numbers are still correct (re-verify costs,
      dev-time saving)
- [ ] Names of stakeholders' workshop / customers spelled correctly
      throughout
- [ ] Test the deck on the projector / TV the day before — the
      cream background renders much darker on cheap screens
- [ ] Print 4 copies on A3 — some attendees will want to hold paper
