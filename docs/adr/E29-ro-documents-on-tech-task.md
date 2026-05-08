# E29 — RO Documents on Technician Task Detail

**Status:** Plan · not yet implemented  
**Requested:** 2026-05-08

---

## Problem

The drafter uploads layout drawings, BOM sheets, and drawing packs against an RO.
Technicians currently see **photos only** on the task detail screen — they have no way to
open the RO documents without leaving the app or asking someone else.

---

## Current System (as-is)

### How drafter files are stored

```
POST /api/drafter/ros/{roId}/artefacts?category={category}
```

Files are saved to disk at `uploads/drafter/{roId}/{uuid}_{filename}` and a row is
inserted into the polymorphic `attachments` table:

| Column         | Value for drafter uploads          |
|----------------|-------------------------------------|
| `entity_type`  | `"RepairOrder"`                     |
| `entity_id`    | RO `id`                             |
| `category`     | `DRAFT_LAYOUT` · `DRAFT_BOM` · `DRAFT_DRAWING_PACK` |
| `blob_path`    | `drafter/{roId}/{uuid}_{filename}`  |
| `content_type` | PDF / image                        |

Files are served directly by the static-file middleware already wired at
`/uploads/{blobPath}` (no auth check — internal network only).

### What the tech task detail currently shows

`GET /api/tech/tasks/{id}` returns task info + RO header (customer, rego, etc.)
but **no attachment list**. A separate `GET /api/tech/tasks/{id}/photos` call
returns technician-uploaded photos. No call exists for RO documents.

---

## Proposed Changes

### Scope

Show the drafter's uploaded files (DRAFT_LAYOUT, DRAFT_BOM, DRAFT_DRAWING_PACK)
as tappable buttons on the tech task detail — matching the **Drawing pack · Cutting list · BOM**
button row already visible in the pitch demo mockup.

Read-only. Technicians open / download files; they cannot upload or delete them here.

---

### 1 · API — new endpoint (1 route, no schema change)

**`GET /api/tech/tasks/{taskId}/ro-documents`**

```
Auth:  any authenticated user (technician, supervisor)
Role:  no additional role gate — existing task auth is sufficient

Response 200:
[
  {
    "attachmentId": "uuid",
    "category":     "DRAFT_DRAWING_PACK",   // DRAFT_LAYOUT | DRAFT_BOM | DRAFT_DRAWING_PACK
    "label":        "Drawing pack",          // display label — see mapping below
    "fileName":     "RO00001_layout_v2.pdf",
    "sizeBytes":    204800,
    "uploadedAt":   "2026-04-15T09:22:00Z",
    "url":          "/uploads/drafter/{roId}/{path}"
  }
]

Response 404: task not found
Response 200 []: task exists but RO has no drafter artefacts yet
```

**Category → label mapping (server-side)**

| Category              | Button label   |
|-----------------------|----------------|
| `DRAFT_DRAWING_PACK`  | Drawing pack   |
| `DRAFT_BOM`           | BOM            |
| `DRAFT_LAYOUT`        | Layout         |

**Implementation sketch** — inside `TechEndpoints.cs`, add:

```csharp
tech.MapGet("/tasks/{taskId:guid}/ro-documents", async (
    Guid taskId, NeeDbContext db, CancellationToken ct) =>
{
    // 1. Resolve the RO id from the task
    var roId = await db.JobTasks
        .Where(t => t.Id == taskId)
        .Select(t => t.RoId)
        .FirstOrDefaultAsync(ct);
    if (roId == default) return Results.NotFound();

    // 2. Fetch drafter artefacts for that RO
    var docs = await db.Attachments
        .Where(a => a.EntityType == "RepairOrder"
                 && a.EntityId  == roId
                 && (a.Category == "DRAFT_DRAWING_PACK"
                  || a.Category == "DRAFT_BOM"
                  || a.Category == "DRAFT_LAYOUT"))
        .OrderBy(a => a.UploadedAt)
        .Select(a => new {
            attachmentId = a.Id,
            category     = a.Category,
            label        = CategoryLabel(a.Category),
            fileName     = a.FileName,
            sizeBytes    = a.SizeBytes,
            uploadedAt   = a.UploadedAt,
            url          = $"/uploads/{a.BlobPath}",
        })
        .ToListAsync(ct);

    return Results.Ok(docs);
})
.RequireAuthorization()
.WithName("GetTaskRoDocuments");
```

No migration required — reads from the existing `attachments` table.

---

### 2 · Angular — task-detail.component.ts changes

#### New signal + load call

```typescript
roDocuments = signal<RoDocument[]>([]);

// Add to the existing load() method alongside getPhotos():
this.tech.getRoDocuments(this.taskId).subscribe(docs => this.roDocuments.set(docs));
```

#### New interface

```typescript
interface RoDocument {
  attachmentId: string;
  category: string;
  label: string;
  fileName: string;
  sizeBytes: number;
  uploadedAt: string;
  url: string;
}
```

#### Template insertion

Place immediately below the SPEC card and above the clock-in banner —
matching the mockup position of "Drawing pack · Cutting list · BOM":

```html
@if (roDocuments().length > 0) {
  <div class="doc-row">
    @for (doc of roDocuments(); track doc.attachmentId) {
      <a class="doc-btn" [href]="doc.url" target="_blank" rel="noopener">
        {{ doc.label }}
      </a>
    }
  </div>
}
```

If the RO has no drafter artefacts the section is hidden — no empty-state
needed since drafting is a gate before scheduling.

#### New CSS (mobile-first)

```css
.doc-row {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin: 0 0 4px;
}
.doc-btn {
  flex: 1;
  min-width: 100px;
  padding: 12px 10px;
  border: 0.5px solid var(--rule-strong);
  border-radius: 10px;
  background: white;
  color: var(--ink);
  font-size: 14px;
  font-family: var(--sans);
  text-align: center;
  text-decoration: none;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}
.doc-btn:active { background: var(--paper-2); }
```

This reproduces the exact pill-row appearance in the mockup screenshot.

#### TechService addition

```typescript
getRoDocuments(taskId: string): Observable<RoDocument[]> {
  return this.http.get<RoDocument[]>(`/api/tech/tasks/${taskId}/ro-documents`);
}
```

---

### 3 · No schema changes required

The `attachments` table already exists with the right columns and indices.
The static-file middleware at `/uploads/` already serves the files.
No new migration needed.

---

## Files to change

| File | Change |
|------|--------|
| `api/Endpoints/TechEndpoints.cs` | Add `GET /tasks/{taskId}/ro-documents` endpoint + `CategoryLabel` helper |
| `web/src/app/tech/task-detail.component.ts` | Add `roDocuments` signal, load call, `doc-row` template block, CSS, `RoDocument` interface |
| `web/src/app/tech/tech.service.ts` | Add `getRoDocuments(taskId)` method |

No new files, no migration, no model changes.

---

## Out of scope for this story

- Technician uploading RO-level documents (that stays with the drafter)
- Inline PDF viewer (browser native open is sufficient for mobile)
- Notifications when drafter uploads a new file mid-job
- File access audit logging

---

## Test plan

1. **Unit:** drafter uploads a DRAFT_DRAWING_PACK → endpoint returns it for any task on that RO
2. **Unit:** RO with no artefacts → endpoint returns `[]`; section hidden in UI
3. **Unit:** Only DRAFT_* categories returned — PHOTO artefacts on same RO must not appear
4. **Manual:** Tap "Drawing pack" on mobile → PDF opens in browser new tab
5. **Regression:** existing photo upload / clock-in flows unaffected
