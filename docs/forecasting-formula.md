# Strategic Forecasting — Risk Score Formula

> Used by `GET /api/dashboard/reports/forecast` (E20). Produces a 0–100 risk
> score per active scheduled RO. Constants live at the top of
> `api/Endpoints/ReportsEndpoints.cs` so they're easy to recalibrate.

## Score breakdown

```
risk_score = capacity_overcommit + recent_variance + blocker_frequency + days_late
```

| Factor | Cap | Formula |
|---|---:|---|
| `capacity_overcommit` | 30 | `min(30, 30 × overcommit_weeks_count / 4)` — number of weeks (in the next 4) any station on this RO's path is > 100% utilised |
| `recent_variance` | 30 | `min(30, max(0, avg_delta_percent))` — average `variance_records.delta_percent` across all completed tasks for the same template in the last 60 days, clamped to non-negative |
| `blocker_frequency` | 25 | `min(25, 5 × blocker_count)` — count of `TaskBlocked` domain events on tasks belonging to ROs of the same template in the last 60 days |
| `days_late` | 15 | `min(15, max(0, projected − required))` — positive days the projected completion exceeds the required date |

Total is clamped to `[0, 100]`.

## Tiers

| `risk_score` | Tier | UI cue |
|---|---|---|
| `< 30` | LOW | grey badge |
| `30–59` | MED | amber badge |
| `≥ 60` | HIGH | red badge |

## Projected completion

```
weeks_needed   = total_estimated_hours / 40            # 40 h/week capacity
overrun_factor = 1 + max(0, avg_delta_percent) / 100   # template's recent overrun
projected_date = scheduled_start_week + weeks_needed × overrun_factor × 7 days
```

Assumptions:
- 40 hours/week per station — matches the existing capacity heatmap.
- Single-template overrun is applied flat (no station-level differentiation).
- Sequencing of stations is ignored (treats them as parallel) — acceptable for
  a first-pass score.

## Bottleneck station

The single station with the highest count of overcommitted weeks among the
RO's stations. `null` if no station on the path is overcommitted.

## Worked example

Sample RO: TP42N tipper, scheduled W20, required `2026-06-15`,
total estimated 80 h, paint and panel overcommitted in 2 weeks,
TP42N avg overrun last 60 d = 18 %, 3 `TaskBlocked` events on TP42N.

```
capacity_overcommit = min(30, 30 × 2 / 4)  = 15
recent_variance     = min(30, 18)          = 18
blocker_frequency   = min(25, 5 × 3)       = 15
projected_date      = May 11 + (80/40 × 1.18 × 7d) = May 11 + 17 d = May 28
days_late           = max(0, May 28 − Jun 15) = 0
                                           total = 48  →  MED
```

## Calibration notes

If the system flags too many false positives:
- Lower the `_VARIANCE` cap from 30 to 20.
- Increase the threshold for HIGH tier from 60 to 70.

If the system misses real risk:
- Drop the `min` cap on `blocker_frequency` (let it grow with count).
- Add a fifth factor for "chassis not yet allocated" (currently not counted).

## Future work

- Per-station overrun factors (the current model treats all stations as if
  they all overrun by the same percentage as the template average).
- Sequencing-aware projection (use `flow_definitions` to walk the critical path).
- ML model calibrated against actual completion dates of past ROs.
