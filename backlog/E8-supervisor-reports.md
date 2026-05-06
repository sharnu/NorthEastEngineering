# Epic E8 — Supervisor Reports

> **Priority:** P0 · **Owner:** Dev A · **Days:** 9–10 · **Depends on:** E3 (dashboard shell), E5 (time entries + variance records exist) · **Total estimate:** 10 hours

Two real, data-backed reports that make the demo feel like production software rather than a prototype. The supervisor sees how many jobs they're completing per week (Throughput) and whether their time estimates are accurate (Calibration). Three additional report families are shown as "coming soon" cards — they fill the screen and signal Phase 2 depth without requiring implementation. Both live reports include a CSV export button that downloads the raw data.

---

## Story E8-S1 — Reports tab structure + placeholder cards (S, 2h)

**As a supervisor**
**I want** a "Reports" tab inside the supervisor view with the full report catalog visible
**So that** I can see what reporting is available, even if most are Phase 2

### Acceptance criteria
- New sub-route `/dashboard/reports` under the existing supervisor dashboard layout
- Top nav or dashboard tab bar adds a "Reports" link alongside "Overview" and "Kanban" (if tabs exist)
- Page header: "Reports" (Fraunces display font, same page-header pattern as the dashboard)
- Two live report cards ("Throughput" and "Calibration") rendered as clickable cards that navigate to their sub-routes (`/dashboard/reports/throughput`, `/dashboard/reports/calibration`)
- Three placeholder cards for Phase 2: "Variance Root Cause", "Customer Concentration", "Strategic Forecasting" — each with a grey "Phase 2" badge and `cursor: not-allowed`
- Card design: title, 1-line description, a small chart-type icon (e.g. 📊 📈 🥧), and for live reports an arrow → indicating they're clickable
- Route protected by `authGuard` and a `SUPERVISOR` or `STATION_OWNER` role check

### Technical context
- The dashboard already has routing established in E3; add child routes under `/dashboard`
- The tab bar (if not already present from E3) should be a shared `DashboardTabsComponent` placed inside the dashboard layout, not re-created per page
- Angular router `routerLinkActive` for active tab highlighting

### Done definition
- Visiting `/dashboard/reports` shows 5 cards: 2 live, 3 Phase 2
- Clicking "Throughput" navigates to `/dashboard/reports/throughput` (stub page acceptable for this story, real content in S2)
- Visiting as a TECHNICIAN user redirects (role guard active)

### Claude Code prompt
```
Add a Reports tab to the supervisor dashboard:

1. Add child routes to the dashboard:
   { path: 'dashboard/reports', component: ReportsIndexComponent, canActivate: [authGuard, roleGuard(['SUPERVISOR','STATION_OWNER'])] }
   { path: 'dashboard/reports/throughput', component: ThroughputReportComponent, canActivate: [authGuard] }
   { path: 'dashboard/reports/calibration', component: CalibrationReportComponent, canActivate: [authGuard] }

2. Add "Reports" link to the dashboard navigation alongside existing tabs.
   Use routerLinkActive="active-tab" for highlighting.

3. ReportsIndexComponent (web/src/app/dashboard/reports-index.component.ts):
   Standalone. Template: page header "Reports" + grid of 5 cards.
   Live cards (clickable, routerLink):
   - { icon: '📊', title: 'Throughput', desc: 'Jobs completed vs in-progress by week, last 12 weeks' }
   - { icon: '📐', title: 'Estimate Calibration', desc: 'Actual vs estimated hours per operation and template' }
   Phase 2 cards (not clickable, has phase2 badge):
   - { icon: '🔍', title: 'Variance Root Cause', desc: 'Top variance reasons and which templates are most affected' }
   - { icon: '🏢', title: 'Customer Concentration', desc: 'Revenue and volume split by customer and body type' }
   - { icon: '📈', title: 'Strategic Forecasting', desc: 'Forward capacity load based on scheduled jobs' }

4. Styles:
   .reports-grid (display grid, grid-template-columns repeat(auto-fill, minmax(280px, 1fr)), gap 16px, padding 20px)
   .report-card (background white, border 0.5px solid var(--rule), border-radius 10px, padding 20px 22px,
     cursor pointer, transition border-color 0.15s)
   .report-card:hover (border-color var(--accent))
   .report-card.phase2 (cursor not-allowed, opacity 0.6)
   .report-card.phase2:hover (border-color var(--rule))
   .card-icon (font-size 28px, margin-bottom 10px, display block)
   .card-title (font-size 15px, font-weight 600, color var(--ink), margin 0 0 6px)
   .card-desc (font-size 13px, color var(--ink-3), margin 0)
   .phase2-badge (display inline-block, font-family var(--mono), font-size 10px, font-weight 500,
     padding 2px 8px, border-radius 3px, background var(--paper-3), color var(--ink-3), margin-top 10px)
```

---

## Story E8-S2 — Throughput report API + chart (M, 4h)

**As a supervisor**
**I want** to see how many jobs we're completing and how many are in progress per week over the last 12 weeks
**So that** I can identify production pace trends and spot slow weeks

### Acceptance criteria
- `GET /api/reports/throughput?weeks=12` returns:
  ```json
  {
    "weeks": [
      {
        "weekStart": "2026-04-13",
        "completed": 3,
        "inProgress": 5,
        "blocked": 1,
        "onTime": 2,
        "late": 1
      }
    ],
    "totals": {
      "completed": 18,
      "onTime": 14,
      "onTimePct": 77.8
    }
  }
  ```
- `weekStart`: Monday of each week (ISO 8601 date string)
- `completed`: ROs where `status = 'COMPLETED'` and `updated_at` falls in that week
- `inProgress`: snapshot of ROs `IN_PROGRESS` at end of that week (approximated as created before week end and completed after — or still open)
- `onTime`: completed ROs where `required_date >= completed_at`
- `late`: completed ROs where `required_date < completed_at`
- Angular chart: vertical bar chart using `chart.js` via `ng2-charts` — one grouped bar per week (completed + in-progress), with an orange line overlay for on-time %
- Fallback when no data: empty state "No completed jobs in this period"

### Technical context
- Week bucketing: use Postgres `date_trunc('week', updated_at)` for completed ROs
- For simplicity, `inProgress` = ROs with `status IN ('APPROVED','IN_PROGRESS','ON_HOLD')` at the time of the query (current snapshot, not historical), displayed flat on every week bar — acceptable for v1
- NuGet: none required (use Postgres date functions via `FromSqlRaw`)
- Angular: `npm install chart.js ng2-charts` — use `BaseChartDirective` from `ng2-charts`
- Chart colours: completed = `var(--good)` (#166534), in-progress = `var(--info)` (#1d4ed8), on-time line = `var(--warn)` (#b45309)

### Done definition
- Seed 3 completed ROs (using the existing create/complete flow in integration tests), call `GET /api/reports/throughput?weeks=4`
- Response includes the correct week buckets with completed counts
- Angular chart renders bars (may be all zero with fresh seed — that's fine; ensure no render errors)
- CSV export button downloads the data (wired in S4)

### Claude Code prompt
```
Implement the throughput report:

1. API: GET /api/reports/throughput
   File: api/Endpoints/ReportEndpoints.cs (new file, register via app.MapReportEndpoints())
   Query param: weeks (int, default 12, max 52)
   - Generate a series of week-start dates: today's Monday going back `weeks` weeks
   - For each week: COUNT repair_orders WHERE status='COMPLETED' AND date_trunc('week', completed_at) = weekStart
   - onTime: status='COMPLETED' AND completed_at <= required_date AND same week bucket
   - late: status='COMPLETED' AND completed_at > required_date AND same week bucket
   - inProgress snapshot: COUNT WHERE status IN ('APPROVED','IN_PROGRESS','ON_HOLD') — same value for all weeks
   - blocked: COUNT WHERE status='ON_HOLD' — same value for all weeks (snapshot)
   - Build ThroughputResponse: Weeks[], Totals { Completed, OnTime, OnTimePct }
   - [Authorize]
   Register: app.MapGroup("/api/reports").RequireAuthorization().WithTags("Reports")

2. Angular: ThroughputReportComponent (web/src/app/dashboard/throughput-report.component.ts)
   - Install: npm install chart.js ng2-charts
   - On init: call GET /api/reports/throughput?weeks=12
   - Bar chart using BaseChartDirective:
     datasets: [
       { label: 'Completed', data: weeks.map(w => w.completed), backgroundColor: '#166534' },
       { label: 'In Progress', data: weeks.map(w => w.inProgress), backgroundColor: '#1d4ed8' }
     ]
     On secondary Y-axis (right), a line dataset for onTime%:
     { label: 'On Time %', data: weeks.map(w => w.onTime / (w.completed || 1) * 100), type: 'line', yAxisID: 'y1', borderColor: '#b45309' }
   - Labels: weeks.map(w => format week start as 'dd MMM')
   - Summary stat row above chart: "18 completed · 77.8% on time" using totals

3. Page layout: page header "Throughput Report", summary stats row, chart (height 300px),
   a "Export CSV" button (wired in S4, for now just placeholder)

4. Empty state: if all weeks have 0 completed, show "No completed jobs in this period" instead of chart.

Schema: repair_orders (status, completed_at, required_date, created_at).
```

---

## Story E8-S3 — Calibration report API + visualization (M, 2h)

**As a supervisor**
**I want** to see how accurate our time estimates are per operation and per template
**So that** I can adjust future templates and target the operations with worst variance

### Acceptance criteria
- `GET /api/reports/calibration` returns:
  ```json
  {
    "byOperation": [
      {
        "operationCode": "FAB_LINE_ASSY",
        "operationName": "Fabrication line assembly",
        "jobCount": 12,
        "avgEstimatedHours": 8.0,
        "avgActualHours": 9.4,
        "avgVariancePct": 17.5,
        "worstVariancePct": 45.0
      }
    ],
    "byTemplate": [
      {
        "templateCode": "TP42N",
        "templateName": "Tipper 4.2m NPR",
        "jobCount": 8,
        "totalEstimatedHours": 53.5,
        "avgActualHours": 58.2,
        "avgVariancePct": 8.8
      }
    ]
  }
  ```
- Only includes operations/templates where at least one `COMPLETED` task exists
- `avgVariancePct`: `(actualHours - estimatedHours) / estimatedHours * 100`, averaged across jobs
- Angular visualization:
  - **By operation table**: columns Operation, Jobs, Avg Est, Avg Actual, Avg Variance %, sortable by column
  - Variance % cell: green if ≤ 10%, amber if 10–25%, red if > 25% (pill background, same as status pills)
  - **By template table**: same pattern, simpler columns
  - Tab switcher between "By Operation" and "By Template"

### Technical context
- Source tables: `job_tasks` (status='COMPLETED', estimated_hours, actual_hours) JOIN `operation_catalog` JOIN `job_code_templates` (via `repair_orders.template_code`)
- `v_template_calibration` view already exists in the schema — use it as the basis for `byOperation`; for `byTemplate` aggregate `v_template_calibration` further or write a separate query
- Sorting is done client-side (no server-side sort param in v1)

### Done definition
- With at least 2 completed tasks (from integration test seed), `GET /api/reports/calibration` returns non-empty `byOperation`
- Variance cells render in the correct colour
- Clicking a column header sorts the table
- CSV export (S4) works for both tabs

### Claude Code prompt
```
Implement the calibration report:

1. API: GET /api/reports/calibration
   Add to ReportEndpoints.cs:
   - byOperation: query job_tasks JOIN operation_catalog WHERE status='COMPLETED'
     Group by operation_catalog.id, code, name
     SELECT AVG(estimated_hours), AVG(actual_hours),
            AVG((actual_hours - estimated_hours) / NULLIF(estimated_hours,0) * 100) AS avg_variance_pct,
            MAX(ABS((actual_hours - estimated_hours) / NULLIF(estimated_hours,0) * 100)) AS worst_variance_pct,
            COUNT(*) AS job_count
   - byTemplate: join repair_orders to get template_code, group by template_code
     AVG of total actual_hours per RO vs total estimated_hours per RO
   - Return CalibrationResponse { ByOperation: OperationCalibrationDto[], ByTemplate: TemplateCalibrationDto[] }

2. Angular: CalibrationReportComponent (web/src/app/dashboard/calibration-report.component.ts)
   - activeTab = signal<'operation' | 'template'>('operation')
   - sortColumn = signal<string>('avgVariancePct'), sortDir = signal<'asc'|'desc'>('desc')
   - sortedRows = computed(() => sort the active tab's data by sortColumn/sortDir)
   - Tab buttons: "By Operation" | "By Template"
   - Table: thead with sortable column headers (click to toggle sort)
     Variance % cell: <span class="pill" [class]="varianceClass(row.avgVariancePct)">{{ row.avgVariancePct | number:'1.1-1' }}%</span>
   - varianceClass(pct): pct <= 10 → 'pill-inrange', pct <= 25 → 'pill-warning', else 'pill-over'
   - Styles: .pill-inrange (bg #dcfce7, color #166534), .pill-warning (bg #fef9c3, color var(--warn)), .pill-over (bg #fee2e2, color var(--bad))
   - "Export CSV" button (wired in S4)

Schema: job_tasks, operation_catalog, repair_orders, job_code_templates (via v_template_calibration view if available).
```

---

## Story E8-S4 — CSV export for both reports (S, 2h)

**As a supervisor**
**I want** to download the report data as a CSV file
**So that** I can open it in Excel for further analysis or send it to management

### Acceptance criteria
- `GET /api/reports/throughput/csv` returns a `text/csv` response with the same data as the JSON endpoint, formatted as CSV with headers
- `GET /api/reports/calibration/csv?view=operation` (or `?view=template`) returns the relevant table as CSV
- CSV column headers match the table column labels in the UI (human-readable, not camelCase)
- Filename in `Content-Disposition` header: `throughput-report-2026-05-01.csv` (date = today)
- Angular "Export CSV" button: calls the CSV endpoint and triggers a browser download via `window.URL.createObjectURL`
- No third-party CSV library — build the CSV string in C# using `StringBuilder`

### Technical context
- CSV generation: re-use the same query logic from S2/S3 endpoints; extract the data-fetching part into a private method so both JSON and CSV endpoints share it
- HTTP response: `Results.Text(csvContent, "text/csv")` with `Content-Disposition: attachment; filename="..."`
- Angular download pattern: `this.http.get('/api/reports/throughput/csv', { responseType: 'blob' }).subscribe(blob => { ... })`

### Done definition
- Click "Export CSV" on the throughput report → browser downloads a `.csv` file
- Open in Excel (or preview in a text editor): headers present, data rows correct, no encoding issues
- Same for the calibration report (both operation and template views)
- `Content-Disposition` header sets the filename correctly

### Claude Code prompt
```
Add CSV export endpoints and Angular download buttons:

1. API: extract data-fetch logic into private static methods shared by JSON + CSV endpoints.

   GET /api/reports/throughput/csv
   - Call same data logic as S2 JSON endpoint
   - Build CSV string with StringBuilder:
     Headers: "Week Start,Completed,In Progress,Blocked,On Time,Late"
     Rows: one per week
   - Return Results.Text(csv, "text/csv") with header
     context.Response.Headers.Append("Content-Disposition", $"attachment; filename=\"throughput-report-{DateTime.UtcNow:yyyy-MM-dd}.csv\"")

   GET /api/reports/calibration/csv?view=operation  (default)  OR  ?view=template
   - Build CSV from byOperation or byTemplate based on view param
   - Headers for operation: "Operation Code,Operation Name,Jobs,Avg Estimated Hours,Avg Actual Hours,Avg Variance %,Worst Variance %"
   - Headers for template: "Template Code,Template Name,Jobs,Estimated Hours,Avg Actual Hours,Avg Variance %"

2. Angular: ReportDownloadService or inline in each component:
   downloadCsv(url: string, filename: string): void {
     this.http.get(url, { responseType: 'blob' }).subscribe(blob => {
       const a = document.createElement('a');
       a.href = URL.createObjectURL(blob);
       a.download = filename;
       a.click();
       URL.revokeObjectURL(a.href);
     });
   }

3. Wire the "Export CSV" button in ThroughputReportComponent:
   (click)="downloadCsv('/api/reports/throughput/csv', 'throughput-report.csv')"

4. Wire in CalibrationReportComponent:
   (click)="downloadCsv('/api/reports/calibration/csv?view=' + activeTab(), 'calibration-' + activeTab() + '.csv')"

5. Tests: GET /api/reports/throughput/csv returns 200 with Content-Type text/csv and Content-Disposition header.
```
