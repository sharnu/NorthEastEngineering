# E30 — SaaS Dashboard Layout Redesign

**Status:** Plan · not yet implemented  
**Requested:** 2026-05-08

---

## Inspiration

Screenshot of a SaaS admin dashboard featuring:
- Narrow icon-only left sidebar (white, ~60 px)
- Persistent white topbar with command-search bar
- Light blue-gray app background
- White shadow-only cards (no borders)
- Data-dense grid: KPI cards · charts · tables
- Compact right-column KPI strip with delta badges
- Coloured status pills on tables

---

## Problem

The current NEE dashboard is a flat, text-heavy list of active ROs on a warm paper background. It gives supervisors and station owners no at-a-glance sense of production health and does not match the visual quality expected of a modern production platform.

---

## Proposed Design System

### Colour tokens (new palette)

| Token | Value | Replaces |
|---|---|---|
| `--paper` | `#f0f4f8` | `#f5f2ea` warm parchment |
| `--paper-2` | `#e4ecf4` | `#ebe7dc` |
| `--paper-3` | `#d2dfe9` | `#ddd7c8` |
| `--ink` | `#0d1b2e` | `#0a0e0f` |
| `--ink-2` | `#2d4059` | `#1a1f21` |
| `--ink-3` | `#6b88a4` | `#4a5258` |
| `--topbar-bg` | `#ffffff` | `#0a0e0f` dark |
| `--topbar-text` | `#0d1b2e` | `#f5f2ea` |
| `--topbar-border` | `rgba(13,27,46,0.08)` | dark variant |
| `--sidebar-bg` | `#ffffff` | (new — was part of topbar) |
| `--sidebar-active` | `#3b6fd4` | (new) |
| `--accent` | `#3b6fd4` | `#c2410c` burnt orange |
| `--accent-dim` | `rgba(59,111,212,0.10)` | orange-dim |
| `--card-bg` | `#ffffff` | `#ffffff` unchanged |
| `--shadow` | `0 2px 12px rgba(13,27,46,0.07)` | heavier current shadow |
| `--rule` | `rgba(13,27,46,0.08)` | warm-tinted |
| `--rule-strong` | `rgba(13,27,46,0.15)` | |
| `--good / --bad / --warn / --info` | unchanged | semantic colours kept |

Typography stack unchanged — Fraunces (display) · Inter (sans) · JetBrains Mono.

---

## Layout Changes

### Current layout
```
┌─────────────────────────────────────────────────────────┐
│  TOPBAR (dark, full-width, logo + nav tabs + user)      │
├─────────────────────────────────────────────────────────┤
│                                                         │
│                 MAIN CONTENT                            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

### Proposed layout
```
┌──────┬──────────────────────────────────────────────────┐
│      │  TOPBAR (white, search + icons + avatar)         │
│ SIDE ├──────────────────────────────────────────────────┤
│ BAR  │                                                  │
│ 60px │           MAIN CONTENT                           │
│ icon │                                                  │
│ only │                                                  │
└──────┴──────────────────────────────────────────────────┘
```

---

## New Components

### 1 · Shell layout (`app-shell.component.ts`)

A new wrapper component used by all authenticated routes:

```
AppShellComponent
  <div class="shell">
    <app-sidebar />          ← new icon sidebar
    <div class="shell-main">
      <app-topbar />         ← new white topbar
      <div class="shell-content">
        <router-outlet />
      </div>
    </div>
  </div>
```

### 2 · Icon Sidebar (`sidebar.component.ts`)

```
Width:   60 px (desktop) · hidden on mobile
BG:      --sidebar-bg (#ffffff)
Shadow:  1px 0 0 var(--rule)

Nav items (icon + tooltip on hover):
  Dashboard     /dashboard
  Kanban        /kanban
  Sales         /sales/ros
  Scheduling    /scheduling
  Reports       /reports
  Admin         /admin         (ADMIN / SUPERVISOR only)

Pinned bottom:
  Settings
  Logout

Active item:
  background: --sidebar-active (#3b6fd4)
  border-radius: 10px
  icon: white
  width/height: 40px centred in 60px column
```

### 3 · White Topbar (`topbar.component.ts`)

```
Height:    52 px
BG:        white
Border:    0.5px bottom var(--rule)

Left:      Page title (font-family: var(--display), 18px)
Centre:    Search / command bar
             - pill input, 320px wide, placeholder "Search ROs, customers…"
             - keyboard shortcut hint ⌘K
Right:     Notification bell (badge count)
           User avatar → dropdown (profile / logout)
```

### 4 · Dashboard grid

Replace current flat list with a responsive grid:

```
Row 1 — 4 KPI cards (equal width)
Row 2 — 3 columns: Activity chart | Stage donut | Right KPI strip
Row 3 — 2 columns: Recent ROs table (60%) | Active tasks (40%)
```

#### KPI cards (row 1)

| Card | Value | Delta source |
|---|---|---|
| Active ROs | count of IN_PROGRESS + PAUSED ROs | vs 7 days ago |
| Completed this week | count of COMPLETED tasks in last 7 days | vs prior week |
| Overdue | ROs past `required_date` not yet COMPLETE | vs yesterday |
| Avg variance | mean `delta_hours` across last 30 completed tasks | vs prior 30 |

Card anatomy:
```
┌────────────────────────────────┐
│ LABEL (mono 10px uppercase)    │
│                                │
│ VALUE (display 32px)           │
│ ▲ +2 vs last week (good/bad)   │
│ ─────── thin progress bar ──── │
└────────────────────────────────┘
```

#### Activity chart (row 2, col 1)

- Line/area chart: ROs completed per day, last 30 days
- Gradient fill below the line (blue, fade to transparent)
- X-axis: dates · Y-axis: count
- Library: **Chart.js via ng2-charts** (`npm install ng2-charts chart.js`)

#### Stage donut (row 2, col 2)

- Donut chart: RO count by kanban stage
- Segments: Received · Drafting · Fabrication · Painting · Fitout · QC · Complete
- Centre label: total active ROs
- Legend below

#### Right KPI strip (row 2, col 3)

Compact stacked cards matching the screenshot right column:

| Label | Value | Icon colour |
|---|---|---|
| Tasks clocked in now | count | blue |
| Blocked ROs | count | red |
| Gates pending | count | amber |
| Chassis allocated today | count | green |

Each mini-card:
```
Label            ▲ +8.23%
Large number
View more →                 [coloured icon box]
```

#### Recent ROs table (row 3, col 1)

Columns: RO# · Customer · Stage · Due · Priority · Status pill  
Table header row: `background: var(--accent)`, white text  
Max 8 rows · "View all" link footer

#### Active tasks (row 3, col 2)

Live technician tasks currently clocked in:

Columns: Technician · Operation · Station · Clock-in time · elapsed  
Auto-refreshes via existing SignalR `KanbanUpdated` event  
No new endpoint needed — query `time_entries` where `clock_out IS NULL`

---

## API Changes

### New endpoint: `GET /api/dashboard/summary`

Returns all KPI values in one call (avoids 6 sequential requests):

```json
{
  "activeRos":          14,
  "activeRosDelta":     2,
  "completedThisWeek":  6,
  "completedDelta":     2,
  "overdueRos":         3,
  "overdueDelta":       1,
  "avgVarianceDelta":   0.4,
  "clockedInNow":       5,
  "blockedRos":         1,
  "gatesPending":       3,
  "chassisAllocatedToday": 2,
  "completionSeries":   [
    { "date": "2026-04-08", "count": 2 },
    ...30 entries
  ],
  "stageBreakdown": [
    { "stage": "FABRICATION", "label": "Fabrication", "count": 4 },
    ...
  ]
}
```

Auth: ADMIN · SUPERVISOR · STATION_OWNER  
No schema changes required — all computable from existing tables.

### New endpoint: `GET /api/dashboard/active-tasks`

```json
[
  {
    "userId":        "uuid",
    "userName":      "Marcus Webb",
    "operationName": "Chassis Fabrication",
    "stationName":   "Station 10",
    "roNumber":      "RO-00041",
    "clockIn":       "2026-05-08T07:30:00Z",
    "elapsedMinutes": 94
  }
]
```

---

## Angular Changes

### New files

| File | Purpose |
|---|---|
| `web/src/app/core/shell/app-shell.component.ts` | Layout wrapper |
| `web/src/app/core/shell/sidebar.component.ts` | Icon sidebar |
| `web/src/app/core/shell/topbar.component.ts` | White search topbar |
| `web/src/app/dashboard/dashboard-summary.service.ts` | HTTP service for new endpoints |
| `web/src/app/dashboard/kpi-card.component.ts` | Reusable KPI card |
| `web/src/app/dashboard/activity-chart.component.ts` | ng2-charts area chart |
| `web/src/app/dashboard/stage-donut.component.ts` | ng2-charts donut |
| `web/src/app/dashboard/active-tasks.component.ts` | Live clocked-in table |

### Modified files

| File | Change |
|---|---|
| `web/src/styles.css` | Update CSS token values to new palette |
| `web/src/app/app.routes.ts` | Wrap authenticated routes in AppShell |
| `web/src/app/dashboard/dashboard.component.ts` | Full rewrite to grid layout |
| All topbar components (10 files) | Remove inline topbar — shell handles it |

### Remove

All inline `.topbar` / `.brand` / `.nav-pills` CSS and HTML from individual feature components (dashboard, kanban, sales, admin, drafter) once AppShell is in place.

---

## Mobile behaviour

- Sidebar collapses to hidden on viewport < 768px
- Topbar shows hamburger → slide-in drawer with nav items (labelled, not icon-only)
- Tech task detail and tech views remain unchanged (already mobile-first)
- Dashboard grid collapses to single column on mobile

---

## Chart library

```bash
npm install ng2-charts chart.js
```

Register `provideCharts(withDefaultRegisterables())` in `app.config.ts`.  
Use `BaseChartDirective` in standalone components — no NgModule needed.

---

## Files to change (summary)

| File | Change |
|---|---|
| `web/src/styles.css` | New token palette |
| `web/src/app/app.routes.ts` | AppShell wrapper |
| `web/src/app/core/shell/` | 3 new components |
| `web/src/app/dashboard/` | Full rewrite + new service + 4 new components |
| `api/Endpoints/DashboardEndpoints.cs` | 2 new endpoints |
| All 10 feature-shell components | Remove inline topbar markup and CSS |

---

## Out of scope

- Real-time chart updates (polling or WebSocket push to chart)
- Export / CSV download from dashboard
- Per-station drill-down views
- Mobile push notifications

---

## Implementation order

1. New CSS tokens in `styles.css`  
2. `AppShell` + `Sidebar` + `Topbar` components, wired into router  
3. Remove topbar duplication from feature shells  
4. `GET /api/dashboard/summary` + `GET /api/dashboard/active-tasks` endpoints  
5. KPI cards + dashboard grid  
6. Charts (activity area + stage donut)  
7. Recent ROs table + active tasks table  
8. Mobile responsive pass  
