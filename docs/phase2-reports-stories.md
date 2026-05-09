# Phase 2 Reports — Elaborated Stories (E17 · E18 · E20)

> Companion to `docs/phase2-backlog.md`. Brings the three reporting epics
> from overview-only to E11/E14-level detail. Same conventions as that
> doc (priority tags, sizing, prompt blocks).

---

# Epic E17 — Reports: Variance Root Cause

> **Priority:** P1 · **Owner:** Dev A · **Days:** 8–9 · **Total estimate:** 8 hours

This was a "Phase 2" placeholder card on the existing Reports tab. Drills into
the *why* behind variance — by reason code, by station, by template, by
technician. Builds on the existing `variance_records` + `variance_reasons`
schema (already populated by the technician complete-task flow) and the
existing reports UI's raw-CSS bar style — **no new chart library**.

## Story E17-S1 — Variance root cause endpoint + drill-through (M, 4h)

**As a supervisor**
**I want** the API to slice variance hours by reason / station / template / technician
**So that** the UI can render a stacked bar chart and a per-row drill-through

### Acceptance criteria

- New route group on the existing `/api/dashboard/reports` group:
  - `GET /api/dashboard/reports/variance-root-cause?from=&to=&groupBy=reason|station|template|technician&minSampleSize=`
- Response shape:
  ```json
  {
    "groupBy": "reason",
    "from": "2026-01-01",
    "to": "2026-05-09",
    "totalSampleSize": 142,
    "totalDeltaHours": 84.5,
    "rows": [
      {
        "groupKey": "DESIGN_NCR",
        "groupLabel": "Drawing pack — design NCR",
        "totalDeltaHours": 38.2,
        "sampleSize": 47,
        "byReason": [
          { "reasonCode": "DESIGN_NCR", "reasonName": "Design NCR", "isOverrun": true, "deltaHours": 38.2, "count": 47 }
        ]
      }
    ]
  }
  ```
- `groupKey` is the stable identifier (reason code, station id, template code, user id);
  `groupLabel` is human-readable. When `groupBy = reason`, `byReason` collapses to a
  single entry; for the other group-bys, each row breaks down by reason so the chart
  can stack.
- `from` / `to` default to last 90 days if omitted. ISO date format (`yyyy-MM-dd`).
- `minSampleSize` (default 1) filters out groups with fewer variance records.
- Sort: `totalDeltaHours` desc.
- Drill-through endpoint:
  - `GET /api/dashboard/reports/variance-root-cause/records?groupBy=&groupKey=&from=&to=&page=1&pageSize=50`
  - Returns paginated `{ items: VarianceRecordDto[], totalCount, page, pageSize }`
  - `VarianceRecordDto` shape:
    ```json
    {
      "recordId": "uuid",
      "recordedAt": "...",
      "roId": "uuid", "roNumber": "RO00001",
      "operationName": "Manufacture base",
      "stationName": "Fabrication line",
      "templateCode": "TP42N",
      "technicianName": "Peter Rogers",
      "estimatedHours": 4.0,
      "actualHours": 6.5,
      "deltaHours": 2.5,
      "deltaPercent": 62.5,
      "reasonCode": "DESIGN_NCR",
      "reasonName": "Design NCR",
      "notes": "Bracket bolt-pattern wrong on drawing"
    }
    ```
- CSV export:
  - `GET /api/dashboard/reports/variance-root-cause/csv?groupBy=&from=&to=&minSampleSize=`
  - Header row: `Group, Sample Size, Delta Hours, Reason Code, Reason Name, Reason Delta Hours, Reason Count`
  - One row per (group × reason) tuple so the CSV is pivot-table friendly.
- All three endpoints require role `SUPERVISOR` or `ADMIN` (consistent with
  existing reports endpoints).

### Done definition
- Calling with `groupBy=reason` returns at least one row when seed data has variance records.
- Calling with `groupBy=technician` returns one row per distinct `recorded_by`.
- Drill-through with a real `groupKey` returns matching records; with garbage
  returns empty list and 200.
- CSV downloads with sensible filename `variance-root-cause-2026-01-01_2026-05-09.csv`.
- `dotnet test` green.

### Claude Code prompt
```
Implement E17-S1: variance root cause endpoints.

1. api/Endpoints/ReportsEndpoints.cs (extend existing file):
   - Add VarianceRootCauseDto, VarianceReasonBreakdownDto, VarianceRecordDto records.
   - GET /variance-root-cause:
     - Build base query: VarianceRecords joined to JobTasks, RepairOrders, Customers,
       Stations, KanbanStages (for templateCode via repair_orders.template_code),
       VarianceReasons.
     - Filter by RecordedAt between from and to.
     - Filter sampleSize after grouping.
     - Group by switch on the groupBy enum:
       reason     -> group by ReasonCode/Name (single-row byReason)
       station    -> group by Task.StationId, then split by reason
       template   -> group by RepairOrder.TemplateCode, then split by reason
       technician -> group by RecordedBy, then split by reason
     - Materialize, project to DTO, sort by totalDeltaHours desc.
   - GET /variance-root-cause/records: same base query, filter on the groupKey
     for the chosen groupBy, paginate.
   - GET /variance-root-cause/csv: same data as the main endpoint, render via
     StringBuilder, return Results.File(bytes, "text/csv", filename).
   - Group-level RequireAuthorization with SUPERVISOR or ADMIN already covers it.

2. Tests in api.tests/ReportsEndpointTests.cs (or new file ReportsVarianceTests.cs):
   - VarianceRootCause_GroupByReason_AggregatesCorrectly
   - VarianceRootCause_DateRangeFilter_ExcludesOlder
   - VarianceRootCause_MinSampleSize_FiltersSparseGroups
   - VarianceRootCauseRecords_DrillThrough_ReturnsMatching
   - VarianceRootCauseCsv_HasOneRowPerGroupReason
```

---

## Story E17-S2 — Variance Root Cause UI (M, 3h)

**As a supervisor**
**I want** to see the variance bar chart with a group-by toggle and a date range
**So that** I can quickly spot the dominant reason / station / template / tech

### Acceptance criteria
- New section in `web/src/app/dashboard/reports.component.ts` titled "Variance Root Cause".
- Filter bar at the top:
  - Group-by toggle: pill buttons `Reason · Station · Template · Technician`
  - Date range: `From` and `To` date inputs (default last 90 days, max today)
  - Min sample size input (default 1)
  - Refresh button
- Stacked horizontal bar chart, similar style to existing throughput chart but
  rotated 90°: each row is a group, bar segments coloured by reason
  (use existing `--bad` for overruns, `--good` for under-runs based on
  `isOverrun`). Width proportional to `totalDeltaHours`.
- To the right of each bar: `+12.5h · 47 records`.
- Click a row → drill-through table appears below: paginated variance records
  with the columns from `VarianceRecordDto` (RO, Operation, Station, Template,
  Technician, Estimate, Actual, Δ h, Δ %, Reason, Notes).
- Empty state when zero rows match the filter: "No variance records in this
  range. Try widening the date range."
- "Download CSV" button at the section header → calls the CSV endpoint with the
  current filters.
- All filters drive an `effect()` that re-fetches.

### Done definition
- Switching groupBy updates the chart in < 200ms (cached HTTP).
- Drill-through opens for the clicked group and closes when another group is
  clicked.
- CSV download opens with the current filters in the filename.
- Visually consistent with existing Throughput / Calibration sections.

### Claude Code prompt
```
Implement E17-S2: variance root cause UI section.

1. web/src/app/dashboard/dashboard.service.ts: add VarianceRootCauseRow,
   VarianceReasonBreakdown, VarianceRecordRow interfaces matching the API.
   Add getVarianceRootCause(filters), getVarianceRootCauseRecords(args), and
   downloadVarianceRootCauseCsv(filters) methods.

2. web/src/app/dashboard/reports.component.ts: extend with a new
   <section class="report-section"> for Variance Root Cause.
   - Filter bar (groupBy pills, from/to inputs, minSampleSize, refresh).
   - Bar chart: render rows as flex containers with width-percent segments
     keyed by reason code; colour from a fixed map (overrun = bad, under = good,
     fallback = ink-3).
   - Drill-through: signal<string | null> selectedGroupKey; clicking a row
     toggles selection; below the chart, a table (paginated) of records.
   - CSV: button calls service.downloadVarianceRootCauseCsv() which fetches
     the file and triggers a blob download.

3. Wire up effect() that recomputes filters → data signal.

4. Optional: add a small variance-root-cause Playwright spec exercising the
   group-by toggle.
```

---

## Story E17-S3 — Tests + polish (S, 1h)

**As the team**
**I want** the new endpoints fully tested and the UI polished against the existing reports
**So that** the section feels native to the app

### Acceptance criteria
- API integration tests as listed in S1 — all green.
- Unit/component tests on the new `VarianceRootCauseSection` if extracted as a
  child component, otherwise rely on E2E.
- Visual: bar segment heights/widths consistent with existing throughput
  chart's spacing.
- Manual smoke test: open in `make dev`, switch group-by, drill into a row,
  download CSV, check the file opens cleanly in spreadsheet.

### Done definition
- All five new tests pass; full suite stays green.
- CSV opens in Excel/LibreOffice without warnings.

---

# Epic E18 — Reports: Customer Concentration

> **Priority:** P1 · **Owner:** Dev A · **Days:** 8–9 · **Total estimate:** 8 hours

Another stub on the Reports tab. Answers "which customers are we doing the
most work for, and is that healthy or single-customer-risk?". Pareto
distribution with a cumulative-percentage line; top-3 call-out.

## Story E18-S1 — Concentration endpoint + per-customer trend (M, 3h)

### Acceptance criteria
- `GET /api/dashboard/reports/customer-concentration?period=last_quarter|last_year|ytd`
  - Period mapping: `last_quarter` = last 90 days; `last_year` = last 365 days;
    `ytd` = Jan 1 of current year through today.
  - Response:
    ```json
    {
      "period": "last_quarter",
      "from": "2026-02-09", "to": "2026-05-09",
      "totalRoCount": 42, "totalHours": 1450.5,
      "rows": [
        {
          "customerId": "uuid", "customerCode": "DFE", "customerName": "Direct Freight Express",
          "roCount": 12, "totalHours": 380.0,
          "percentOfTotal": 26.2, "cumulativePercent": 26.2,
          "topRanked": true
        }
      ]
    }
    ```
  - `topRanked` is true for customers contributing to the top-3 cumulative
    (Pareto signal). Sort: `totalHours` desc.
- Per-customer trend:
  - `GET /api/dashboard/reports/customer-concentration/trend?customerId=`
  - Returns the last 8 quarters of `{ quarterLabel, quarterStart, roCount, totalHours }`.
- CSV export at `/customer-concentration/csv?period=`.
- All endpoints SUPERVISOR/ADMIN.

### Done definition
- For seed data, `last_quarter` returns at least one customer.
- The cumulative percent monotonically increases through 100%.
- Trend returns 8 entries even when a customer has no work in some quarters
  (zeros for those quarters).

### Claude Code prompt
```
Implement E18-S1: customer concentration endpoints.

1. ReportsEndpoints.cs:
   - Add CustomerConcentrationDto, CustomerConcentrationRow, CustomerTrendDto.
   - Map periodKey (last_quarter | last_year | ytd) to a (from, to) tuple.
   - Hours per customer = SUM(JobTasks.ActualHours) joined to repair_orders
     completed within the period (use ro.completed_at if present, else
     repair_orders.created_at as a fallback). Document the choice in code.
   - Compute cumulativePercent in the .Select after sorting.
   - Trend: for each of the last 8 quarters, sum hours where
     completed_at falls in the quarter; pad missing quarters with zeros.
   - CSV mirrors the existing pattern.

2. Tests in api.tests/ReportsCustomerConcentrationTests.cs:
   - Concentration_TopCustomerHighlighted
   - Concentration_CumulativePercentMonotonic
   - Trend_PadsMissingQuartersWithZeros
   - ConcentrationCsv_HasExpectedHeaders
```

---

## Story E18-S2 — Pareto chart + trend panel UI (M, 3h)

### Acceptance criteria
- New "Customer Concentration" section in `reports.component.ts`.
- Period toggle pills: `Last quarter · Last year · YTD`.
- Pareto chart:
  - Horizontal bars per customer, descending by total hours (uses existing
    bar styling).
  - Red call-out badge on top-3 contributors when their cumulative > 60%
    ("⚠ 67% from top 3 customers").
  - Cumulative percent line drawn over the bars (simple inline SVG polyline
    on top of the bar container).
- Right side panel: "Trend" — when a customer is selected (clicked from the
  Pareto), the panel renders an 8-quarter line chart of hours/quarter and
  a sparkline-style RO count.
- "Download CSV" button.
- Empty state: "No completed work in this period."

### Done definition
- Period toggle re-fetches and refreshes both Pareto and (if open) trend.
- Clicking a customer bar opens the trend panel; clicking again or pressing
  Escape closes it.

### Claude Code prompt
```
Implement E18-S2: Customer concentration UI.

1. dashboard.service.ts: add CustomerConcentrationRow + CustomerTrendPoint
   interfaces and getCustomerConcentration(period), getCustomerTrend(id),
   downloadCustomerConcentrationCsv(period) methods.

2. reports.component.ts: new <section class="report-section"> with:
   - Period pills + a state signal('last_quarter' | 'last_year' | 'ytd').
   - Pareto: bars + an inline <svg> overlay computing the cumulative line
     (one polyline + per-point dots).
   - Trend panel: rendered conditionally; SVG line chart for hours,
     small horizontal stripe for ro counts.
   - Top-3 banner if cumulativePercent[2] > 60.
```

---

## Story E18-S3 — Tests + polish (S, 2h)

### Acceptance criteria
- All API tests from S1 green.
- Pareto bar widths sum proportionally; cumulative line endpoint hits 100%.
- Manual smoke + CSV check.

---

# Epic E20 — Reports: Strategic Forecasting

> **Priority:** P2 · **Owner:** Dev A · **Days:** 9–10 · **Total estimate:** 14 hours

The "ROs at risk this month" dashboard widget. Predicts which scheduled ROs
are at risk of being late based on station capacity, recent variance trends,
and blocker frequency. Two-tier deliverable: an MVP forecast formula + endpoint
in S1–S2, then refinement and drill-through in S3–S4.

## Story E20-S1 — Risk score formula + forecast endpoint (M, 4h)

### Acceptance criteria
- `GET /api/dashboard/reports/forecast` returns:
  ```json
  {
    "computedAt": "...",
    "rows": [
      {
        "roId": "uuid", "roNumber": "RO00007",
        "customerName": "Direct Freight Express",
        "scheduledStartWeek": "2026-05-11",
        "requiredDate": "2026-06-15",
        "projectedCompletionDate": "2026-06-20",
        "daysAtRisk": 5,
        "riskScore": 72,
        "riskTier": "HIGH",
        "bottleneckStationId": 50,
        "bottleneckStationName": "Paint and panel",
        "factors": [
          { "key": "capacity_overcommit", "weight": 30, "description": "Paint at 112% capacity W21" },
          { "key": "recent_variance",     "weight": 25, "description": "Template TP42N avg overrun 18% (last 60d)" },
          { "key": "blocker_frequency",   "weight": 17, "description": "3 TaskBlocked events on similar ROs" }
        ]
      }
    ]
  }
  ```
- Risk score formula (0–100; documented in `docs/forecasting-formula.md`):
  - **Capacity overcommit (max 30):** sum of upstream-stage weeks where
    capacity > 100% in the next 4 weeks; `min(30, 30 * overcommit_weeks / 4)`.
  - **Recent variance (max 30):** average `delta_percent` of completed tasks
    on the same template in last 60 days; `min(30, max(0, avg_overrun_pct))`
    (clamps to 0 if templates run under estimate).
  - **Blocker frequency (max 25):** count of `TaskBlocked` events on ROs of
    the same template in last 60 days; `min(25, 5 * count)`.
  - **Days-late projection (max 15):** if `projectedCompletionDate > requiredDate`,
    `min(15, days_at_risk)`. (Days at risk capped at 15 days for scoring.)
- `riskTier`: LOW (< 30), MED (30–59), HIGH (>= 60).
- `projectedCompletionDate`: `scheduledStartWeek + (totalEstimatedHours / 40)
  weeks * (1 + recent_overrun_pct/100)`. Document the assumptions.
- `bottleneckStationId`: the station with highest capacity utilization on this
  RO's path. Null if no overcommit anywhere.
- Endpoint excludes ROs in `COMPLETED` or `CANCELLED` status.
- `factors` only includes contributing entries (weight > 0).
- SUPERVISOR or ADMIN.

### Done definition
- For seed data, returns one row per active RO with `scheduledStartWeek` set.
- Risk score is in [0, 100].
- Formula doc explains every constant.

### Claude Code prompt
```
Implement E20-S1: forecast endpoint and formula.

1. New file api/Endpoints/ForecastEndpoints.cs (or extend ReportsEndpoints).
2. New file docs/forecasting-formula.md describing the four factors.
3. GET /api/dashboard/reports/forecast:
   - Pull active scheduled ROs (ScheduledStartWeek != null, status not
     COMPLETED/CANCELLED).
   - For each: compute the four factor values, sum, clamp, classify tier.
   - Reuse the capacity heatmap query in SchedulingEndpoints.cs — extract
     into a helper if needed.
   - Return rows sorted by riskScore desc.
4. Tests: ForecastEndpointTests.cs:
   - Forecast_ScoreInRange_0_100
   - Forecast_HighRiskTier_OnLateProjection
   - Forecast_FactorsOnlyIncludeContributing
```

---

## Story E20-S2 — Endpoint caching + at-risk widget (M, 4h)

### Acceptance criteria
- Response cached in-memory for 1 hour (key: empty string — global).
  Cache is invalidated when any RO is rescheduled (`PUT /scheduling/ros/{id}/schedule`),
  cancelled, or completed. Use `IMemoryCache`.
- New widget on supervisor dashboard "ROs at risk this month" — top 5 rows
  sorted by riskScore desc, only showing `riskTier != LOW`.
- Each row: RO #, customer, risk badge (colour by tier), bottleneck, "+5d late".
- Click row → routes to `/sales/ro/{id}` (existing detail page).
- Empty state: "No at-risk ROs in the next 30 days. Nice."

### Done definition
- Widget loads in <100ms when cached.
- Rescheduling an RO via UI clears the cache; reload shows updated risk.

### Claude Code prompt
```
Implement E20-S2: caching + at-risk widget.

1. ForecastEndpoints.cs: inject IMemoryCache; key "forecast:v1"; ttl 1h.
2. SchedulingEndpoints.cs (PUT schedule), RepairOrderEndpoints.cs (cancel),
   TechEndpoints.cs (complete final task) — call IMemoryCache.Remove("forecast:v1").
3. New AtRiskWidgetComponent under web/src/app/dashboard/.
4. dashboard.component.ts overview tab: include the widget below KPIs.
5. Test: rescheduling invalidates cache.
```

---

## Story E20-S3 — Drill-through detail + factor breakdown (S, 4h)

### Acceptance criteria
- Clicking a row in the at-risk widget OR a row in a (future) full forecast
  page opens an inline expander showing all factor entries with descriptions.
- Each factor entry has a `?` icon → tooltip explains the calculation in plain
  English (sourced from `docs/forecasting-formula.md`).
- Optional: link from the RO detail page to "Why is this at risk?" that opens
  the same panel in a modal.

### Done definition
- Expander toggles; tooltip readable; explanations match the doc.

---

## Story E20-S4 — Formula documentation + tests (S, 2h)

### Acceptance criteria
- `docs/forecasting-formula.md` complete with: formula constants, examples,
  worked walkthrough on a sample RO, threshold tier table, calibration
  notes ("if false positives are too high, lower X").
- ForecastEndpointTests achieves coverage on the four factors (each tested in
  isolation), plus end-to-end tests as listed in S1.
- Sanity test: a brand-new draft RO scheduled 6 months out has riskScore 0.

---

# Notes for the implementer

- **No new chart libraries.** All three reports use the existing raw HTML/CSS
  pattern (`<div>` stacks for bars, inline `<svg>` polylines for cumulative
  lines). This keeps bundle size flat and matches the in-house aesthetic.
- **CSV pattern is set.** Backend returns `Results.File(bytes, "text/csv", filename)`;
  frontend triggers download via blob + `<a>`.
- **Auth is set.** All `/api/dashboard/reports` endpoints require SUPERVISOR or
  ADMIN. New routes inherit the group authorization automatically.
- **Test fixture is sparse.** Variance data is light in seed; tests should
  create their own variance records to avoid coupling. Use `fixture.CreateDbContext()`
  to seed scenarios per test.
- **Forecast formula is calibration-friendly.** Constants live at the top of
  the endpoint file. Document any constant change in CHANGELOG.
