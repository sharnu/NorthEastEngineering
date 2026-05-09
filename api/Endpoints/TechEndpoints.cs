using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.SignalR;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain;
using Nee.Api.Domain.Events;
using Nee.Api.Hubs;
using Nee.Api.Services;

namespace Nee.Api.Endpoints;

public static class TechEndpoints
{
    public static void MapTechEndpoints(this WebApplication app)
    {
        var tech = app.MapGroup("/api/tech/tasks").RequireAuthorization().WithTags("Tech");
        var variance = app.MapGroup("/api").RequireAuthorization().WithTags("Tech");

        // ── GET /api/tech/tasks ───────────────────────────────────────────────
        tech.MapGet("/", async (ClaimsPrincipal principal, NeeDbContext db, CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);

            // Active statuses include BLOCKED so the technician can see what's
            // pending supervisor unblock — rendered read-only in the UI.
            var activeStatuses = new[] { "ASSIGNED", "IN_PROGRESS", "PAUSED", "BLOCKED" };

            var tasks = await db.JobTasks
                .Where(t => t.AssignedToUserId == currentUserId && activeStatuses.Contains(t.Status))
                .Select(t => new
                {
                    t.Id,
                    t.RoId,
                    RoNumber        = t.RepairOrder.RoNumber,
                    t.Sequence,
                    t.OperationName,
                    StationName     = t.Station.Name,
                    t.EstimatedHours,
                    t.ActualHours,
                    t.Status,
                    Priority        = (int)t.RepairOrder.Priority,
                    CustomerName    = t.RepairOrder.Customer.Name,
                    RequiredDate    = t.RepairOrder.RequiredDate,
                    ClockedInSince  = db.TimeEntries
                        .Where(te => te.TaskId == t.Id && te.UserId == currentUserId && te.ClockOut == null)
                        .Select(te => (DateTimeOffset?)te.ClockIn)
                        .FirstOrDefault(),
                })
                .ToListAsync(ct);

            // For BLOCKED tasks, attach the latest TaskBlocked event reason
            var blockedIds = tasks.Where(t => t.Status == "BLOCKED").Select(t => t.Id).ToList();
            var blockInfo = new Dictionary<Guid, (string? Reason, DateTimeOffset At)>();
            if (blockedIds.Count > 0)
            {
                var events = await db.DomainEvents
                    .Where(e => e.EventType == "TaskBlocked" && blockedIds.Contains(e.AggregateId))
                    .OrderByDescending(e => e.Id)
                    .Select(e => new { e.AggregateId, e.Payload, e.OccurredAt })
                    .ToListAsync(ct);
                foreach (var ev in events)
                {
                    if (blockInfo.ContainsKey(ev.AggregateId)) continue;
                    string? reason = null;
                    if (ev.Payload.RootElement.TryGetProperty("reason", out var p)
                        && p.ValueKind == JsonValueKind.String)
                        reason = p.GetString();
                    blockInfo[ev.AggregateId] = (reason, ev.OccurredAt);
                }
            }

            var ordered = tasks
                .OrderBy(t => t.Status switch
                {
                    "IN_PROGRESS" => 1,
                    "PAUSED"      => 2,
                    "ASSIGNED"    => 3,
                    "BLOCKED"     => 4,
                    _             => 5,
                })
                .ThenBy(t => t.Priority)
                .Select(t =>
                {
                    blockInfo.TryGetValue(t.Id, out var blk);
                    return new
                    {
                        t.Id,
                        t.RoId,
                        t.RoNumber,
                        t.Sequence,
                        t.OperationName,
                        t.StationName,
                        t.EstimatedHours,
                        t.ActualHours,
                        t.Status,
                        t.Priority,
                        t.CustomerName,
                        t.RequiredDate,
                        t.ClockedInSince,
                        BlockedReason = t.Status == "BLOCKED" ? blk.Reason : null,
                        BlockedAt     = t.Status == "BLOCKED" && blk.Reason != null
                                            ? (DateTimeOffset?)blk.At : null,
                    };
                });

            return Results.Ok(ordered);
        });

        // ── GET /api/tech/tasks/{id} ──────────────────────────────────────────
        tech.MapGet("/{id:guid}", async (Guid id, ClaimsPrincipal principal, NeeDbContext db, CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);

            var task = await db.JobTasks
                .Where(t => t.Id == id)
                .Select(t => new
                {
                    t.Id,
                    t.RoId,
                    RoNumber        = t.RepairOrder.RoNumber,
                    t.Sequence,
                    t.OperationId,
                    t.OperationName,
                    t.JobCodeLine,
                    StationName     = t.Station.Name,
                    t.EstimatedHours,
                    t.ActualHours,
                    t.Status,
                    Priority        = (int)t.RepairOrder.Priority,
                    CustomerName    = t.RepairOrder.Customer.Name,
                    RequiredDate    = t.RepairOrder.RequiredDate,
                    t.Notes,
                    t.AssignedToUserId,
                    Ro = new
                    {
                        CustomerName = t.RepairOrder.Customer.Name,
                        t.RepairOrder.Rego,
                        t.RepairOrder.Make,
                        t.RepairOrder.Model,
                        t.RepairOrder.PaintColour,
                        t.RepairOrder.RequiredDate,
                    },
                    TimeEntries = db.TimeEntries
                        .Where(te => te.TaskId == id && te.ClockOut != null)
                        .OrderBy(te => te.ClockIn)
                        .Select(te => new
                        {
                            te.Id,
                            te.ClockIn,
                            te.ClockOut,
                            te.DurationMinutes,
                            te.ActivityType,
                        })
                        .ToList(),
                    ClockedInSince = db.TimeEntries
                        .Where(te => te.TaskId == id && te.ClockOut == null)
                        .Select(te => (DateTimeOffset?)te.ClockIn)
                        .FirstOrDefault(),
                })
                .FirstOrDefaultAsync(ct);

            if (task is null) return Results.NotFound();
            if (task.AssignedToUserId != currentUserId) return Results.Forbid();

            return Results.Ok(task);
        });

        // ── POST /api/tech/tasks/{id}/clock-in ───────────────────────────────
        tech.MapPost("/{id:guid}/clock-in", async (Guid id, ClaimsPrincipal principal, NeeDbContext db, CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);

            var task = await db.JobTasks.FindAsync([id], ct);
            if (task is null) return Results.NotFound();
            if (task.AssignedToUserId != currentUserId) return Results.Forbid();

            var terminalStatuses = new[] { "COMPLETED", "CANCELLED" };
            if (terminalStatuses.Contains(task.Status))
                return Results.BadRequest(new { message = "Task is already completed or cancelled." });

            // Check no open entries for this user globally
            var alreadyClockedIn = await db.TimeEntries
                .AnyAsync(te => te.UserId == currentUserId && te.ClockOut == null, ct);
            if (alreadyClockedIn)
                return Results.Conflict(new { message = "You are already clocked in on another task." });

            var now = DateTimeOffset.UtcNow;
            var entry = new TimeEntry
            {
                TaskId       = id,
                UserId       = currentUserId,
                ClockIn      = now,
                ActivityType = "WORK",
            };
            db.TimeEntries.Add(entry);

            task.Status    = "IN_PROGRESS";
            task.StartedAt ??= now;
            task.UpdatedAt = now;

            await db.SaveChangesAsync(ct);

            return Results.Created($"/api/tech/tasks/{id}/clock-in", new
            {
                EntryId  = entry.Id,
                ClockIn  = entry.ClockIn,
            });
        });

        // ── POST /api/tech/tasks/{id}/clock-out ──────────────────────────────
        tech.MapPost("/{id:guid}/clock-out", async (Guid id, ClaimsPrincipal principal, NeeDbContext db, CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);

            var task = await db.JobTasks.FindAsync([id], ct);
            if (task is null) return Results.NotFound();
            if (task.AssignedToUserId != currentUserId) return Results.Forbid();

            var openEntry = await db.TimeEntries
                .Where(te => te.TaskId == id && te.UserId == currentUserId && te.ClockOut == null)
                .FirstOrDefaultAsync(ct);
            if (openEntry is null)
                return Results.NotFound(new { message = "No active time entry found for this task." });

            openEntry.ClockOut = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);

            // Reload to get the generated duration_minutes
            await db.Entry(openEntry).ReloadAsync(ct);

            // Recalculate actual_hours
            var actualHours = await db.TimeEntries
                .Where(te => te.TaskId == id && te.ClockOut != null)
                .SumAsync(te => (decimal)(te.DurationMinutes ?? 0), ct) / 60m;
            actualHours = Math.Round(actualHours, 2);

            task.ActualHours = actualHours;
            task.Status      = "PAUSED";
            task.UpdatedAt   = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);

            return Results.Ok(new
            {
                EntryId         = openEntry.Id,
                ClockIn         = openEntry.ClockIn,
                ClockOut        = openEntry.ClockOut,
                DurationMinutes = openEntry.DurationMinutes,
            });
        });

        // ── POST /api/tech/tasks/{id}/photos ─────────────────────────────────
        tech.MapPost("/{id:guid}/photos", async (
            Guid id,
            IFormFile file,
            ClaimsPrincipal principal,
            NeeDbContext db,
            IConfiguration config,
            CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);

            var task = await db.JobTasks.FindAsync([id], ct);
            if (task is null) return Results.NotFound();
            if (task.AssignedToUserId != currentUserId) return Results.Forbid();

            if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new { message = "Only image files are accepted." });

            if (file.Length > 10_485_760)
                return Results.StatusCode(413);

            var uploadsBaseRaw = config["Storage:UploadsBasePath"]
                ?? Path.Combine(AppContext.BaseDirectory, "uploads");
            var uploadsBase = Path.IsPathRooted(uploadsBaseRaw)
                ? uploadsBaseRaw
                : Path.GetFullPath(uploadsBaseRaw);

            var taskDir = Path.Combine(uploadsBase, id.ToString());
            Directory.CreateDirectory(taskDir);

            var storedName = $"{Guid.NewGuid():N}_{file.FileName}";
            var fullPath   = Path.Combine(taskDir, storedName);

            await using (var fs = File.Create(fullPath))
                await file.CopyToAsync(fs, ct);

            var blobPath = $"{id}/{storedName}";
            var now      = DateTimeOffset.UtcNow;

            var attachment = new Attachment
            {
                EntityType    = "JobTask",
                EntityId      = id,
                Category      = "PHOTO",
                FileName      = file.FileName,
                ContentType   = file.ContentType,
                SizeBytes     = file.Length,
                BlobContainer = "local",
                BlobPath      = blobPath,
                UploadedBy    = currentUserId,
                UploadedAt    = now,
            };
            db.Attachments.Add(attachment);
            await db.SaveChangesAsync(ct);

            return Results.Created($"/api/tech/tasks/{id}/photos/{attachment.Id}", new
            {
                AttachmentId = attachment.Id,
                FileName     = attachment.FileName,
                UploadedAt   = attachment.UploadedAt,
            });
        }).DisableAntiforgery();

        // ── GET /api/tech/tasks/{id}/photos ──────────────────────────────────
        tech.MapGet("/{id:guid}/photos", async (Guid id, NeeDbContext db, CancellationToken ct) =>
        {
            var photos = await db.Attachments
                .Where(a => a.EntityType == "JobTask" && a.EntityId == id && a.Category == "PHOTO")
                .OrderBy(a => a.UploadedAt)
                .Select(a => new
                {
                    Id          = a.Id,
                    FileName    = a.FileName,
                    ContentType = a.ContentType,
                    SizeBytes   = a.SizeBytes,
                    UploadedAt  = a.UploadedAt,
                    Url         = $"/uploads/{a.BlobPath}",
                })
                .ToListAsync(ct);

            return Results.Ok(photos);
        });

        // ── GET /api/tech/tasks/{id}/ro-documents ────────────────────────────
        tech.MapGet("/{id:guid}/ro-documents", async (Guid id, NeeDbContext db, CancellationToken ct) =>
        {
            var roId = await db.JobTasks
                .Where(t => t.Id == id)
                .Select(t => (Guid?)t.RoId)
                .FirstOrDefaultAsync(ct);

            if (roId is null) return Results.NotFound();

            var docs = await db.Attachments
                .Where(a => a.EntityType == "RepairOrder"
                         && a.EntityId  == roId
                         && (a.Category == "DRAFT_DRAWING_PACK"
                          || a.Category == "DRAFT_BOM"
                          || a.Category == "DRAFT_LAYOUT"
                          || a.Category == "SOURCE_PDF"))
                .OrderBy(a => a.UploadedAt)
                .Select(a => new
                {
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

        // ── POST /api/tech/tasks/{id}/complete ────────────────────────────────
        tech.MapPost("/{id:guid}/complete", async (
            Guid id,
            CompleteTaskRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            INotificationService notifications,
            IGateEvaluator gateEvaluator,
            IHubContext<KanbanHub> hub,
            CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);

            var task = await db.JobTasks
                .Include(t => t.RepairOrder)
                .Include(t => t.Station)
                .FirstOrDefaultAsync(t => t.Id == id, ct);
            if (task is null) return Results.NotFound();
            if (task.AssignedToUserId != currentUserId) return Results.Forbid();

            var validStatuses = new[] { "IN_PROGRESS", "PAUSED" };
            if (!validStatuses.Contains(task.Status))
                return Results.BadRequest(new { message = $"Task cannot be completed from status '{task.Status}'." });

            // Close any open time entry
            var openEntry = await db.TimeEntries
                .Where(te => te.TaskId == id && te.ClockOut == null)
                .FirstOrDefaultAsync(ct);
            if (openEntry is not null)
            {
                openEntry.ClockOut = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(ct);
                await db.Entry(openEntry).ReloadAsync(ct);
            }

            // Recalculate actual_hours from all closed entries
            var actualHours = await db.TimeEntries
                .Where(te => te.TaskId == id && te.ClockOut != null)
                .SumAsync(te => (decimal)(te.DurationMinutes ?? 0), ct) / 60m;
            actualHours = Math.Round(actualHours, 2);

            var now = DateTimeOffset.UtcNow;

            // Insert variance record
            db.VarianceRecords.Add(new VarianceRecord
            {
                TaskId          = id,
                EstimatedHours  = task.EstimatedHours,
                ActualHours     = actualHours,
                ReasonId        = req.VarianceReasonId,
                Notes           = req.Notes,
                RecordedBy      = currentUserId,
                RecordedAt      = now,
            });

            // Update task
            task.Status      = "COMPLETED";
            task.CompletedAt = now;
            task.ActualHours = actualHours;
            task.UpdatedAt   = now;

            var deltaHours = Math.Round(actualHours - task.EstimatedHours, 2);

            // Insert domain event
            var completedEvt = new DomainEvent
            {
                EventType     = "TaskCompleted",
                AggregateType = "JobTask",
                AggregateId   = id,
                Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new
                {
                    taskId        = id,
                    roId          = task.RoId,
                    roNumber      = task.RepairOrder.RoNumber,
                    operationName = task.OperationName,
                    stationId     = task.StationId,
                    stationName   = task.Station.Name,
                    actualHours,
                    deltaHours,
                    reasonId      = req.VarianceReasonId,
                })),
                UserId = currentUserId,
            };
            db.DomainEvents.Add(completedEvt);

            // Open an explicit transaction so task completion + stage advance are atomic.
            // Two SaveChangesAsync calls are required: the gate evaluator must query the DB
            // and see the task as COMPLETED before deciding whether to advance the stage.
            // Both SaveChangesAsync calls execute within the same transaction and are not
            // visible to other connections until CommitAsync, satisfying atomicity.
            await using var tx = await db.Database.BeginTransactionAsync(ct);

            // Commit 1: persist task + variance + event so gate evaluator sees COMPLETED status
            await db.SaveChangesAsync(ct);

            // Stage kanban advance (queries DB via same in-transaction connection)
            await AutoAdvanceStageAsync(db, gateEvaluator, task, currentUserId, id, ct);

            // Commit 2: persist stage advance entities (if any)
            await db.SaveChangesAsync(ct);

            // Atomically publish both commits
            await tx.CommitAsync(ct);

            // Post-commit: load display values, send notifications, push SignalR
            var reason = await db.VarianceReasons.FindAsync([req.VarianceReasonId], ct);

            await notifications.FanOutAsync(completedEvt, ct);

            // Fire-and-forget: board clients refresh on stage change or task completion
            _ = hub.Clients.All.SendAsync("KanbanUpdated", new { roId = task.RoId }, CancellationToken.None);
            _ = hub.NotifyCardUpdated(task.RoId, task.StationId);

            return Results.Ok(new
            {
                TaskId      = id,
                ActualHours = actualHours,
                DeltaHours  = deltaHours,
                ReasonName  = reason?.Name ?? string.Empty,
            });
        });

        // ── POST /api/tech/tasks/{id}/block ───────────────────────────────────
        tech.MapPost("/{id:guid}/block", async (
            Guid id,
            BlockTaskRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            INotificationService notifications,
            CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);

            if (string.IsNullOrWhiteSpace(req.Reason) || req.Reason.Trim().Length < 10)
                return Results.BadRequest(new { message = "Reason must be at least 10 characters." });

            var task = await db.JobTasks
                .Include(t => t.RepairOrder)
                .Include(t => t.Station)
                .FirstOrDefaultAsync(t => t.Id == id, ct);
            if (task is null) return Results.NotFound();
            if (task.AssignedToUserId != currentUserId) return Results.Forbid();

            var invalidStatuses = new[] { "COMPLETED", "CANCELLED", "BLOCKED" };
            if (invalidStatuses.Contains(task.Status))
                return Results.BadRequest(new { message = $"Task cannot be blocked from status '{task.Status}'." });

            // Close open time entry if any
            var openEntry = await db.TimeEntries
                .Where(te => te.TaskId == id && te.ClockOut == null)
                .FirstOrDefaultAsync(ct);
            if (openEntry is not null)
            {
                openEntry.ClockOut = DateTimeOffset.UtcNow;
                await db.SaveChangesAsync(ct);
                await db.Entry(openEntry).ReloadAsync(ct);

                var actualHours = await db.TimeEntries
                    .Where(te => te.TaskId == id && te.ClockOut != null)
                    .SumAsync(te => (decimal)(te.DurationMinutes ?? 0), ct) / 60m;
                task.ActualHours = Math.Round(actualHours, 2);
            }

            // Read current kanban stage
            var currentState = await db.RoKanbanStates
                .Where(s => s.RoId == task.RoId)
                .FirstOrDefaultAsync(ct);
            short? previousStageId = currentState?.CurrentStageId;

            var now = DateTimeOffset.UtcNow;
            task.Status    = "BLOCKED";
            task.UpdatedAt = now;

            var ro = task.RepairOrder;
            ro.Status                = "ON_HOLD";
            // delivery_block_reason must be one of TBA, NO_CHASSIS, BOOK_IN, EXTERNAL_BB
            ro.UpdatedAt             = now;

            await db.Database.ExecuteSqlRawAsync(
                "UPDATE repair_orders SET delivery_block_reason = 'TBA' WHERE id = {0}",
                task.RoId);

            // UPSERT kanban state to HOSPITAL (95)
            await db.Database.ExecuteSqlRawAsync(
                @"INSERT INTO ro_kanban_state (ro_id, current_stage_id)
                  VALUES ({0}, {1})
                  ON CONFLICT (ro_id) DO UPDATE
                    SET current_stage_id = EXCLUDED.current_stage_id,
                        updated_at = now()",
                task.RoId, (short)95);

            var blockedEvt = new DomainEvent
            {
                EventType     = "TaskBlocked",
                AggregateType = "JobTask",
                AggregateId   = id,
                Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new
                {
                    taskId          = id,
                    roId            = task.RoId,
                    roNumber        = task.RepairOrder.RoNumber,
                    operationName   = task.OperationName,
                    stationId       = task.StationId,
                    stationName     = task.Station.Name,
                    reason          = req.Reason,
                    blockedByUserId = currentUserId,
                    previousStageId,
                })),
                UserId = currentUserId,
            };
            db.DomainEvents.Add(blockedEvt);

            await db.SaveChangesAsync(ct);

            await notifications.FanOutAsync(blockedEvt, ct);

            return Results.Ok(new
            {
                TaskId    = id,
                RoNumber  = task.RepairOrder.RoNumber,
                BlockedAt = now,
            });
        });

        // ── POST /api/tech/tasks/{id}/unblock ─────────────────────────────────
        tech.MapPost("/{id:guid}/unblock", async (
            Guid id,
            UnblockTaskRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.ResolutionNotes) || req.ResolutionNotes.Trim().Length < 10)
                return Results.UnprocessableEntity(new { message = "Resolution notes must be at least 10 characters." });

            var task = await db.JobTasks
                .Include(t => t.RepairOrder)
                .FirstOrDefaultAsync(t => t.Id == id, ct);
            if (task is null) return Results.NotFound();

            if (task.Status != "BLOCKED")
                return Results.BadRequest(new { message = "Task is not blocked." });

            // Read previousStageId from most recent TaskBlocked domain event
            var blockEvent = await db.DomainEvents
                .Where(e => e.AggregateId == id && e.EventType == "TaskBlocked")
                .OrderByDescending(e => e.Id)
                .FirstOrDefaultAsync(ct);

            short previousStageId = 10;
            string? originalReason = null;
            if (blockEvent is not null)
            {
                var doc = blockEvent.Payload.RootElement;
                if (doc.TryGetProperty("previousStageId", out var prop)
                    && prop.ValueKind != JsonValueKind.Null)
                    previousStageId = prop.GetInt16();
                if (doc.TryGetProperty("reason", out var reasonProp)
                    && reasonProp.ValueKind == JsonValueKind.String)
                    originalReason = reasonProp.GetString();
            }

            var now = DateTimeOffset.UtcNow;
            var unblockedByUserId = GetUserId(principal);
            var resolution = req.ResolutionNotes.Trim();

            task.Status    = "PAUSED";
            task.UpdatedAt = now;

            var ro = task.RepairOrder;
            ro.Status    = "IN_PROGRESS";
            ro.UpdatedAt = now;

            await db.Database.ExecuteSqlRawAsync(
                "UPDATE repair_orders SET delivery_block_reason = NULL WHERE id = {0}",
                task.RoId);

            await db.Database.ExecuteSqlRawAsync(
                @"INSERT INTO ro_kanban_state (ro_id, current_stage_id)
                  VALUES ({0}, {1})
                  ON CONFLICT (ro_id) DO UPDATE
                    SET current_stage_id = EXCLUDED.current_stage_id,
                        updated_at = now()",
                task.RoId, previousStageId);

            db.DomainEvents.Add(new DomainEvent
            {
                EventType     = "TaskUnblocked",
                AggregateType = "JobTask",
                AggregateId   = id,
                Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new
                {
                    taskId             = id,
                    roId               = task.RoId,
                    roNumber           = task.RepairOrder.RoNumber,
                    operationName      = task.OperationName,
                    originalReason,
                    resolutionNotes    = resolution,
                    restoredStageId    = previousStageId,
                    unblockedByUserId,
                })),
                UserId = unblockedByUserId,
            });

            await db.SaveChangesAsync(ct);

            return Results.Ok();
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "STATION_OWNER", "ADMIN"));

        // ── GET /api/variance-reasons ─────────────────────────────────────────
        variance.MapGet("/variance-reasons", async (NeeDbContext db, CancellationToken ct) =>
        {
            var reasons = await db.VarianceReasons
                .Where(r => r.IsActive)
                .OrderBy(r => r.Id)
                .Select(r => new
                {
                    r.Id,
                    r.Code,
                    r.Name,
                    r.IsOverrun,
                })
                .ToListAsync(ct);

            return Results.Ok(reasons);
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static Guid GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue(ClaimTypes.NameIdentifier)
               ?? principal.FindFirstValue("sub")
               ?? throw new InvalidOperationException("No sub claim found in token.");
        return Guid.Parse(sub);
    }

    private static string CategoryLabel(string category) => category switch
    {
        "DRAFT_DRAWING_PACK" => "Drawing pack",
        "DRAFT_BOM"          => "BOM",
        "DRAFT_LAYOUT"       => "Layout",
        "SOURCE_PDF"         => "RO PDF",
        _                    => category,
    };

    private static short StationSortOrderToKanbanStage(int sortOrder) => sortOrder switch
    {
        <= 15 => 30,  // MAT_PROCESSING
        <= 25 => 40,  // FABRICATION
        <= 35 => 50,  // PAINTING
        <= 65 => 60,  // AFTER_PAINT_HY
        <= 75 => 70,  // FITOUT
        <= 82 => 80,  // BODY_MOUNTING
        <= 87 => 85,  // ACCESSORIES
        <= 93 => 90,  // FINAL_QC
        _     => 99,  // COMPLETE
    };

    private static async Task AutoAdvanceStageAsync(
        NeeDbContext db, IGateEvaluator gateEvaluator,
        JobTask task, Guid currentUserId, Guid triggeringTaskId, CancellationToken ct)
    {
        // Only advance when gate says this station is fully complete
        var gate = await gateEvaluator.Evaluate(task.RoId, task.StationId, ct);
        if (gate.State != "COMPLETE") return;

        var ro = task.RepairOrder;
        if (ro.BodyType is null) return;

        // Find current station's flow entry for this task's track
        var currentFlow = await db.FlowDefinitions
            .Where(fd => fd.BodyType == ro.BodyType && fd.Track == task.FlowTrack && fd.StationId == task.StationId)
            .FirstOrDefaultAsync(ct);

        if (currentFlow is null)
        {
            // Station not in flow definitions for this body type — advance to next kanban stage by sort order
            var sortOrder = await db.Stations
                .Where(s => s.Id == task.StationId)
                .Select(s => s.SortOrder)
                .FirstOrDefaultAsync(ct);
            if (sortOrder == 0) return;
            var currentStageId = StationSortOrderToKanbanStage((int)sortOrder);
            var nextStageId = await db.KanbanStages
                .Where(ks => ks.Id > currentStageId && !ks.IsTerminal && ks.Id != 95)
                .OrderBy(ks => ks.Id)
                .Select(ks => ks.Id)
                .FirstOrDefaultAsync(ct);
            if (nextStageId == 0) return;
            await ApplyStageAdvanceAsync(db, task.RoId, nextStageId, ct);
            RoLifecycleEvents.EmitRoStageAutoAdvanced(db, task.RoId, currentUserId, task.StationId, task.StationId, triggeringTaskId);
            return;
        }

        // Find next station on this track
        var nextFlow = await db.FlowDefinitions
            .Where(fd => fd.BodyType == ro.BodyType && fd.Track == task.FlowTrack && fd.SortOrder > currentFlow.SortOrder)
            .OrderBy(fd => fd.SortOrder)
            .FirstOrDefaultAsync(ct);

        if (nextFlow is null) return; // Track terminates here; merge station handles the advance

        var nextStationSortOrder = await db.Stations
            .Where(s => s.Id == nextFlow.StationId)
            .Select(s => s.SortOrder)
            .FirstAsync(ct);

        var newStageId = StationSortOrderToKanbanStage((int)nextStationSortOrder);

        bool nextIsMerge = await db.KanbanStages
            .AnyAsync(ks => ks.Id == nextFlow.StationId && ks.IsMergePoint, ct);

        if (nextIsMerge)
        {
            // Re-evaluate the merge station to see if all tracks have arrived
            var mergeGate = await gateEvaluator.Evaluate(task.RoId, nextFlow.StationId, ct);

            if (mergeGate.State == "READY" || mergeGate.State == "COMPLETE")
            {
                // All tracks ready at merge — advance the stage
                await ApplyStageAdvanceAsync(db, task.RoId, newStageId, ct);

                var completedTracks = await db.FlowDefinitions
                    .Where(fd => fd.BodyType == ro.BodyType && fd.StationId == nextFlow.StationId)
                    .Select(fd => fd.Track)
                    .ToListAsync(ct);

                RoLifecycleEvents.EmitRoMergeReached(db, task.RoId, currentUserId, nextFlow.StationId, completedTracks.ToArray());
            }
            else
            {
                // This track arrived but others haven't
                RoLifecycleEvents.EmitRoTrackArrivedAtMerge(db, task.RoId, currentUserId, nextFlow.StationId, task.FlowTrack);
            }
        }
        else
        {
            // Non-merge: advance directly
            await ApplyStageAdvanceAsync(db, task.RoId, newStageId, ct);
            RoLifecycleEvents.EmitRoStageAutoAdvanced(db, task.RoId, currentUserId, task.StationId, nextFlow.StationId, triggeringTaskId);
        }
        // Caller (complete handler) does the single SaveChangesAsync
    }

    private static async Task ApplyStageAdvanceAsync(NeeDbContext db, Guid roId, short newStageId, CancellationToken ct)
    {
        var state = await db.RoKanbanStates.FindAsync([roId], ct);
        if (state is not null && state.CurrentStageId >= newStageId) return; // Idempotent

        if (state is null)
        {
            db.RoKanbanStates.Add(new RoKanbanState
            {
                RoId           = roId,
                CurrentStageId = newStageId,
                EnteredStageAt = DateTimeOffset.UtcNow,
                UpdatedAt      = DateTimeOffset.UtcNow,
            });
        }
        else
        {
            state.CurrentStageId = newStageId;
            state.EnteredStageAt = DateTimeOffset.UtcNow;
            state.UpdatedAt      = DateTimeOffset.UtcNow;
        }
    }
}

public record CompleteTaskRequest(short VarianceReasonId, string? Notes);
public record BlockTaskRequest(string Reason);
public record UnblockTaskRequest(string ResolutionNotes);
