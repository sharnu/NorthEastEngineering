# Changelog

## MVP v1 · 2026-05-08 — Flow-aware grouped kanban (BREAKING)

### Breaking changes

- **Removed** `POST /api/kanban/ros/{id}/override-stage` — use `POST /api/kanban/ros/{id}/force-advance` instead.
  The new endpoint accepts `{ reason, stageId? }` or `{ reason, stationId? }` and is the canonical way to force-advance an RO stage.

### New features

- **Grouped kanban board** — `GET /api/kanban` now returns cards grouped by `(roId, stationId)` instead of one card per task.
  Each card contains all tasks for that RO at that station with full progress, gate state, and hours.
- **Operational flow ribbon** (`GET /api/repair-orders/{id}/flow`) — per-track flow path with step status
  (`DONE | ACTIVE | PENDING | BLOCKED`) for body-type-aware multi-track ROs.
- **Flow ribbon UI** — Angular `FlowRibbonComponent` shown above the kanban board (for the selected RO)
  and inside the card drawer (compact mode). Refreshes automatically on board polling and task completion.
- **Body-type filter pills** — multi-select filter above the kanban board; persisted to `localStorage`.
- **SignalR `KanbanCardUpdated`** — server now broadcasts `{ roId, stationId }` on task assignment,
  task completion, and force-advance. Angular board debounces at 250 ms and refreshes automatically.

### Removed

- `web/src/app/kanban/task-card.component.ts` — legacy per-task card component deleted.
- `POST /api/kanban/ros/{id}/override-stage` — compat alias removed (see breaking changes).
