# Chassis Suggestion Fields

When a supervisor opens the **Suggest →** panel on a repair order, the system scores every available chassis against that RO and returns the top three candidates. Each card displays the following fields.

---

## Chassis Number

The VIN or stock chassis number, e.g. `LZZ8EXXC7SC707465`. Sourced from the weekly stock sheet upload.

---

## Score Badge (top-right)

A single integer representing how well this chassis matches the RO. Colour indicates quality at a glance:

| Badge colour | Score range | Meaning |
|---|---|---|
| Green | ≥ 100 | Strong match — at least a tag hit |
| Amber | 50 – 99 | Partial match — colour or proximity only |
| Grey | 0 – 49 | No specific match — available but unrelated |

The maximum possible score is 180 (100 tag + 50 colour + 30 proximity).

---

## Meta Tags (pill badges)

| Badge | Source field | Description |
|---|---|---|
| Body type | `chassis_inventory.body_type` | e.g. `TIPPER_CS`, `TAUTLINER`, `CAB CHASSIS` |
| Colour | `chassis_inventory.colour` | Paint colour as recorded on the stock sheet |
| Tag | `chassis_inventory.tag_number` | Stock tag number, e.g. `Tag: 83G` |
| Arrived | `chassis_inventory.arrival_date` | Date the chassis arrived at the yard, e.g. `Arrived: 01 Oct 25` |

Any badge whose value is blank is hidden.

---

## Score Breakdown

`tag N · colour N · proximity N`

Shows the individual contribution of each scoring signal:

### Tag (0 or 100)
Scores **100** if the chassis `tag_number` exactly equals the RO's `chassis_tag` field.  
Scores **0** otherwise, including when the RO has no chassis tag set.

### Colour (0 or 50)
Scores **50** if the chassis `colour` matches the RO's `colour` field (case-insensitive).  
Scores **0** if either value is blank or the colours differ.

### Proximity (0 – 30)
Measures how close the chassis arrival date is to the RO's required date.

```
proximity = max(0, 30 − |arrival_date − required_date| in days)
```

- Scores **30** when arrival date equals required date exactly.
- Drops by 1 for every day of difference.
- Scores **0** when the gap is 30 or more days, or when either date is missing.

---

## Reason Text

A plain-English summary of the non-zero signals, e.g.:

| Example | What it means |
|---|---|
| `Exact tag match, colour match` | Tag scored 100 and colour scored 50 |
| `Colour match` | Only colour matched |
| `Arrives 5 days before required date` | Only proximity scored |
| `Available chassis, no specific match` | All three signals scored 0 — chassis passes the body-type filter but has no matching attributes |

---

## Allocate Button

Clicking **Allocate** posts to `POST /api/scheduling/chassis/{chassisId}/allocate`, setting the chassis status to `ALLOCATED` and linking it to the RO. The scheduling backlog gate `chassisAllocated` turns green immediately without a page reload.

---

## Body-Type Filter

Only chassis that pass the body-type filter appear as candidates:

- A chassis with a **null** body type is always included (compatible with any RO).
- A chassis with a **specific** body type (e.g. `TAUTLINER`) is only included when the RO body type matches exactly.
- Chassis with a non-matching body type are excluded entirely and never shown, regardless of score.

---

## Tiebreaker

When two candidates have the same score, the one with the **earlier arrival date** ranks first (FIFO — oldest stock out first). Chassis with no arrival date rank last within their score group.
