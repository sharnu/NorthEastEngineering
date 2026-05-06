using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain;
using Nee.Api.Services;

namespace Nee.Api.Endpoints;

file static class QcChecklistItems
{
    public static readonly (string Code, string Label)[] All =
    [
        ("DIMENSIONS_VERIFIED",   "Dimensions verified against drawing"),
        ("WELD_QUALITY_CHECKED",  "Weld quality — all welds, seams and mounts inspected"),
        ("PAINT_FINISH_ACCEPTED", "Paint finish — colour match, gloss, coverage"),
        ("ELECTRICAL_TESTED",     "Electrical systems tested (lights, hydraulics, ABS)"),
        ("PLACARDS_FITTED",       "Compliance placards fitted and legible"),
        ("PHOTOS_COMPLETE",       "Photo evidence complete and uploaded"),
    ];
}

public static class QcEndpoints
{
    private const short BluePlateQcOperationId = 70;

    public static void MapQcEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/tech/qc").RequireAuthorization().WithTags("QC");

        // ── GET /api/tech/qc/{roId} ───────────────────────────────────────────
        grp.MapGet("/{roId:guid}", async (
            Guid roId,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);

            var qcTask = await db.JobTasks
                .Where(t => t.RoId == roId && t.OperationId == BluePlateQcOperationId)
                .FirstOrDefaultAsync(ct);

            if (qcTask is null)
                return Results.NotFound(new { message = "No QC task found for this RO." });

            if (qcTask.AssignedToUserId != currentUserId)
                return Results.Forbid();

            var ro = await db.RepairOrders
                .Include(r => r.Customer)
                .FirstOrDefaultAsync(r => r.Id == roId, ct);
            if (ro is null) return Results.NotFound();

            var templateName = await db.JobCodeTemplates
                .Where(t => t.Code == ro.TemplateCode)
                .Select(t => t.Name)
                .FirstOrDefaultAsync(ct) ?? ro.TemplateCode;

            var clockedInSince = await db.TimeEntries
                .Where(te => te.TaskId == qcTask.Id && te.ClockOut == null)
                .Select(te => (DateTimeOffset?)te.ClockIn)
                .FirstOrDefaultAsync(ct);

            var allBuildTasksComplete = !await db.JobTasks
                .AnyAsync(t => t.RoId == roId
                            && t.OperationId != BluePlateQcOperationId
                            && t.Status != "COMPLETED"
                            && t.Status != "CANCELLED", ct);

            var prior = await db.QcSubmissions
                .Where(s => s.RoId == roId)
                .FirstOrDefaultAsync(ct);

            // Read per-item results from qc_results; fall back to qc_submissions JSONB
            var savedChecked = await db.QcResults
                .Where(r => r.RoId == roId)
                .ToDictionaryAsync(r => r.ItemCode, r => r.Passed, ct);

            if (savedChecked.Count == 0 && prior is not null)
            {
                foreach (var item in prior.ItemResponses.RootElement.EnumerateArray())
                {
                    if (item.TryGetProperty("itemCode", out var codeEl)
                        && item.TryGetProperty("checked", out var checkedEl))
                        savedChecked[codeEl.GetString()!] = checkedEl.GetBoolean();
                }
            }

            var checklistItems = QcChecklistItems.All.Select(i => new
            {
                itemCode = i.Code,
                label    = i.Label,
                @checked = savedChecked.GetValueOrDefault(i.Code, false),
            }).ToArray();

            return Results.Ok(new
            {
                roId                 = ro.Id,
                roNumber             = ro.RoNumber,
                customerName         = ro.Customer.Name,
                customerEmailDl      = ro.Customer.EmailDl,
                rego                 = ro.Rego,
                make                 = ro.Make,
                model                = ro.Model,
                paintColour          = ro.PaintColour,
                requiredDate         = ro.RequiredDate,
                templateCode         = ro.TemplateCode,
                templateName,
                qcTask = new
                {
                    id             = qcTask.Id,
                    status         = qcTask.Status,
                    estimatedHours = qcTask.EstimatedHours,
                    actualHours    = qcTask.ActualHours,
                    clockedInSince,
                },
                checklistItems,
                priorSubmission = prior is null ? null : new
                {
                    submittedAt = prior.SubmittedAt,
                    notes       = prior.Notes,
                    emailTo     = prior.EmailTo,
                },
                allBuildTasksComplete,
            });
        });

        // ── GET /api/tech/qc/{roId}/photos ────────────────────────────────────
        grp.MapGet("/{roId:guid}/photos", async (
            Guid roId,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);
            var qcTask = await ResolveQcTask(roId, currentUserId, db, ct);
            if (qcTask is null) return Results.NotFound(new { message = "No QC task found for this RO." });
            if (qcTask.AssignedToUserId != currentUserId) return Results.Forbid();

            var photos = await db.Attachments
                .Where(a => a.EntityType == "JobTask"
                         && db.JobTasks.Any(t => t.RoId == roId && t.Id == a.EntityId)
                         && (a.Category == "PHOTO" || a.Category == "QC"))
                .Join(db.JobTasks,  a => a.EntityId, t => t.Id, (a, t) => new { a, t })
                .Join(db.Stations,  x => x.t.StationId, s => s.Id, (x, s) => new { x.a, x.t, s })
                .Join(db.Users,     x => x.a.UploadedBy, u => u.Id, (x, u) => new
                {
                    x.a.Id,
                    x.a.FileName,
                    Url                   = $"/uploads/{x.a.BlobPath}",
                    x.a.UploadedAt,
                    UploadedByName        = u.FullName,
                    TaskOperationName     = x.t.OperationName,
                    StationName           = x.s.Name,
                    StationSortOrder      = x.s.SortOrder,
                })
                .OrderBy(x => x.StationSortOrder)
                .ThenBy(x => x.UploadedAt)
                .ToListAsync(ct);

            var grouped = photos
                .GroupBy(p => p.TaskOperationName)
                .Select(g => new
                {
                    operationName = g.Key,
                    photos        = g.Select(p => new
                    {
                        id             = p.Id,
                        fileName       = p.FileName,
                        url            = p.Url,
                        uploadedAt     = p.UploadedAt,
                        uploadedByName = p.UploadedByName,
                    }).ToArray(),
                })
                .ToArray();

            return Results.Ok(new { groups = grouped, totalCount = photos.Count });
        });

        // ── POST /api/tech/qc/{roId}/photos ───────────────────────────────────
        grp.MapPost("/{roId:guid}/photos", async (
            Guid roId,
            IFormFile file,
            ClaimsPrincipal principal,
            NeeDbContext db,
            IConfiguration config,
            CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);
            var qcTask = await ResolveQcTask(roId, currentUserId, db, ct);
            if (qcTask is null) return Results.NotFound(new { message = "No QC task found for this RO." });
            if (qcTask.AssignedToUserId != currentUserId) return Results.Forbid();

            if (!file.ContentType.StartsWith("image/", StringComparison.OrdinalIgnoreCase))
                return Results.BadRequest(new { message = "Only image files are accepted." });
            if (file.Length > 10_485_760)
                return Results.StatusCode(413);

            var (attachment, _) = await SavePhoto(file, qcTask.Id, "QC", currentUserId, db, config, ct);
            return Results.Created(
                $"/api/tech/qc/{roId}/photos/{attachment.Id}",
                new { attachmentId = attachment.Id, fileName = attachment.FileName, url = $"/uploads/{attachment.BlobPath}", uploadedAt = attachment.UploadedAt });
        }).DisableAntiforgery();

        // ── PUT /api/tech/qc/{roId}/items/{itemCode} ──────────────────────────
        grp.MapPut("/{roId:guid}/items/{itemCode}", async (
            Guid roId,
            string itemCode,
            QcItemRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);
            var qcTask = await ResolveQcTask(roId, currentUserId, db, ct);
            if (qcTask is null) return Results.NotFound(new { message = "No QC task found for this RO." });
            if (qcTask.AssignedToUserId != currentUserId) return Results.Forbid();
            if (qcTask.Status == "COMPLETED") return Results.Conflict(new { message = "QC already submitted." });

            if (!QcChecklistItems.All.Any(i => i.Code == itemCode))
                return Results.NotFound(new { message = "Unknown checklist item." });

            var now     = DateTimeOffset.UtcNow;
            var existing = await db.QcResults
                .FirstOrDefaultAsync(r => r.RoId == roId && r.ItemCode == itemCode, ct);

            if (existing is null)
            {
                db.QcResults.Add(new QcResult
                {
                    RoId        = roId,
                    ItemCode    = itemCode,
                    Passed      = req.Passed,
                    Notes       = req.Notes,
                    RecordedBy  = currentUserId,
                    RecordedAt  = now,
                });
            }
            else
            {
                existing.Passed     = req.Passed;
                existing.Notes      = req.Notes;
                existing.RecordedBy = currentUserId;
                existing.RecordedAt = now;
            }
            await db.SaveChangesAsync(ct);

            return Results.NoContent();
        });

        // ── GET /api/tech/qc/{roId}/email-preview ─────────────────────────────
        grp.MapGet("/{roId:guid}/email-preview", async (
            Guid roId,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);
            var qcTask = await ResolveQcTask(roId, currentUserId, db, ct);
            if (qcTask is null) return Results.NotFound(new { message = "No QC task found for this RO." });
            if (qcTask.AssignedToUserId != currentUserId) return Results.Forbid();

            var ro = await db.RepairOrders
                .Include(r => r.Customer)
                .FirstOrDefaultAsync(r => r.Id == roId, ct);
            if (ro is null) return Results.NotFound();

            var templateName = await db.JobCodeTemplates
                .Where(t => t.Code == ro.TemplateCode)
                .Select(t => t.Name)
                .FirstOrDefaultAsync(ct) ?? ro.TemplateCode;

            var totalActualHours = await db.JobTasks
                .Where(t => t.RoId == roId)
                .SumAsync(t => t.ActualHours, ct);

            var taskCount = await db.JobTasks
                .CountAsync(t => t.RoId == roId, ct);

            var photoCount = await db.Attachments
                .CountAsync(a => a.EntityType == "JobTask"
                              && db.JobTasks.Any(t => t.RoId == roId && t.Id == a.EntityId)
                              && (a.Category == "PHOTO" || a.Category == "QC"), ct);

            var completionDate = ro.RequiredDate ?? DateTimeOffset.UtcNow;

            var data = new EmailTemplateData(
                ro.RoNumber, ro.Customer.Name, ro.Rego, ro.Make, ro.Model,
                ro.PaintColour, completionDate, totalActualHours, taskCount, photoCount, templateName);

            var (subject, htmlBody, textBody) = EmailTemplateBuilder.Build(data);

            return Results.Ok(new
            {
                to         = ro.Customer.EmailDl ?? string.Empty,
                cc         = string.Empty,
                subject,
                bodyHtml   = htmlBody,
                bodyText   = textBody,
                photoCount,
            });
        });

        // ── POST /api/tech/qc/{roId}/pass ─────────────────────────────────────
        grp.MapPost("/{roId:guid}/pass", async (
            Guid roId,
            QcPassRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            EmailService emailSvc,
            INotificationService notifications,
            CancellationToken ct) =>
        {
            var currentUserId = GetUserId(principal);

            var qcTask = await db.JobTasks
                .Include(t => t.RepairOrder).ThenInclude(r => r.Customer)
                .FirstOrDefaultAsync(t => t.RoId == roId && t.OperationId == BluePlateQcOperationId, ct);

            if (qcTask is null) return Results.NotFound(new { message = "No QC task found for this RO." });
            if (qcTask.AssignedToUserId != currentUserId) return Results.Forbid();
            if (qcTask.Status == "COMPLETED")
                return Results.Conflict(new { message = "QC already submitted for this RO." });

            // Upsert per-item responses into qc_results (belt-and-suspenders alongside auto-save)
            var upsertNow = DateTimeOffset.UtcNow;
            foreach (var r in req.ChecklistResponses)
            {
                if (!QcChecklistItems.All.Any(i => i.Code == r.ItemCode)) continue;
                await db.Database.ExecuteSqlRawAsync(
                    @"INSERT INTO qc_results (ro_id, item_code, passed, recorded_by, recorded_at)
                      VALUES ({0}, {1}, {2}, {3}, {4})
                      ON CONFLICT (ro_id, item_code) DO UPDATE
                        SET passed = EXCLUDED.passed,
                            recorded_by = EXCLUDED.recorded_by,
                            recorded_at = EXCLUDED.recorded_at",
                    roId, r.ItemCode, r.Checked, currentUserId, upsertNow);
            }

            // Validate all 6 items are passed in qc_results
            var passedCount = await db.QcResults.CountAsync(r => r.RoId == roId && r.Passed, ct);
            if (passedCount < QcChecklistItems.All.Length)
                return Results.UnprocessableEntity(new { errors = new { checklist = new[] { "All checklist items must be signed off." } } });

            if (!string.IsNullOrWhiteSpace(req.EmailTo)
                && !req.EmailTo.Contains('@'))
                return Results.UnprocessableEntity(new { errors = new { emailTo = new[] { "Invalid email address." } } });

            // ── Transaction ──────────────────────────────────────────────────
            await using var tx = await db.Database.BeginTransactionAsync(ct);

            var now = DateTimeOffset.UtcNow;

            // 1. Auto clock-out if still clocked in
            var openEntry = await db.TimeEntries
                .Where(te => te.TaskId == qcTask.Id && te.ClockOut == null)
                .FirstOrDefaultAsync(ct);
            if (openEntry is not null)
            {
                openEntry.ClockOut = now;
                await db.SaveChangesAsync(ct);
                await db.Entry(openEntry).ReloadAsync(ct);
            }

            // 2. Recalculate actual hours
            var actualHours = await db.TimeEntries
                .Where(te => te.TaskId == qcTask.Id && te.ClockOut != null)
                .SumAsync(te => (decimal)(te.DurationMinutes ?? 0), ct) / 60m;
            actualHours = Math.Round(actualHours, 2);

            // 3. Insert variance record
            var varianceReasonId = actualHours <= qcTask.EstimatedHours * 1.1m ? (short)11 : (short)13;
            db.VarianceRecords.Add(new VarianceRecord
            {
                TaskId         = qcTask.Id,
                EstimatedHours = qcTask.EstimatedHours,
                ActualHours    = actualHours,
                ReasonId       = varianceReasonId,
                Notes          = actualHours > qcTask.EstimatedHours * 1.1m ? "QC task over estimate" : null,
                RecordedBy     = currentUserId,
                RecordedAt     = now,
            });

            // 4. Complete the QC task
            qcTask.Status      = "COMPLETED";
            qcTask.CompletedAt = now;
            qcTask.ActualHours = actualHours;
            qcTask.UpdatedAt   = now;

            // 5. Insert QC submission
            var responseJson = JsonDocument.Parse(JsonSerializer.Serialize(
                req.ChecklistResponses.Select(r => new { r.ItemCode, r.Checked })));
            db.QcSubmissions.Add(new QcSubmission
            {
                RoId          = roId,
                TaskId        = qcTask.Id,
                SubmittedBy   = currentUserId,
                SubmittedAt   = now,
                ItemResponses = responseJson,
                Notes         = req.Notes,
                EmailSent     = false,
                EmailTo       = req.EmailTo,
            });

            // 6. Complete the RO
            var ro = qcTask.RepairOrder;
            ro.Status    = "COMPLETED";
            ro.UpdatedAt = now;
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE repair_orders SET actual_completion_at = {0} WHERE id = {1}",
                now, roId);

            // 7. Advance kanban to COMPLETE (99)
            await db.Database.ExecuteSqlRawAsync(
                @"INSERT INTO ro_kanban_state (ro_id, current_stage_id)
                  VALUES ({0}, 99)
                  ON CONFLICT (ro_id) DO UPDATE
                    SET current_stage_id = 99, updated_at = now()",
                roId);

            // 8. Domain event
            var qcEvt = new DomainEvent
            {
                EventType     = "QcPassed",
                AggregateType = "RepairOrder",
                AggregateId   = roId,
                Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new
                {
                    roId,
                    roNumber       = ro.RoNumber,
                    qcTaskId       = qcTask.Id,
                    submittedBy    = currentUserId,
                    emailTo        = req.EmailTo,
                    completedAt    = now,
                })),
                UserId      = currentUserId,
                OccurredAt  = now,
            };
            db.DomainEvents.Add(qcEvt);

            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            // ── End transaction ──────────────────────────────────────────────

            await notifications.FanOutAsync(qcEvt, ct);

            // Build email and send (non-fatal)
            var templateName = await db.JobCodeTemplates
                .Where(t => t.Code == ro.TemplateCode)
                .Select(t => t.Name)
                .FirstOrDefaultAsync(ct) ?? ro.TemplateCode;

            var totalActualHours = await db.JobTasks
                .Where(t => t.RoId == roId)
                .SumAsync(t => t.ActualHours, ct);

            var taskCount = await db.JobTasks
                .CountAsync(t => t.RoId == roId, ct);

            var photoCount = await db.Attachments
                .CountAsync(a => a.EntityType == "JobTask"
                              && db.JobTasks.Any(t => t.RoId == roId && t.Id == a.EntityId)
                              && (a.Category == "PHOTO" || a.Category == "QC"), ct);

            var data = new EmailTemplateData(
                ro.RoNumber, ro.Customer.Name, ro.Rego, ro.Make, ro.Model,
                ro.PaintColour, now, totalActualHours, taskCount, photoCount, templateName);

            var (subject, htmlBody, textBody) = EmailTemplateBuilder.Build(data);
            var sent = await emailSvc.SendAsync(req.EmailTo ?? string.Empty, subject, htmlBody, textBody, ct);

            // Best-effort update of email_sent flag
            if (sent)
            {
                var sub = await db.QcSubmissions.FirstOrDefaultAsync(s => s.RoId == roId, ct);
                if (sub is not null)
                {
                    sub.EmailSent   = true;
                    sub.EmailSentAt = DateTimeOffset.UtcNow;
                    await db.SaveChangesAsync(ct);
                }
            }

            return Results.Ok(new
            {
                roId,
                roNumber   = ro.RoNumber,
                emailSent  = sent,
                emailTo    = req.EmailTo ?? string.Empty,
                emailError = sent ? null : (string.IsNullOrWhiteSpace(req.EmailTo)
                    ? "No recipient configured."
                    : "Email could not be sent — check Mailpit at http://localhost:8025."),
            });
        });
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static Guid GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue(ClaimTypes.NameIdentifier)
               ?? principal.FindFirstValue("sub")
               ?? throw new InvalidOperationException("No sub claim found.");
        return Guid.Parse(sub);
    }

    private static Task<JobTask?> ResolveQcTask(Guid roId, Guid userId, NeeDbContext db, CancellationToken ct)
        => db.JobTasks.FirstOrDefaultAsync(
            t => t.RoId == roId && t.OperationId == BluePlateQcOperationId, ct);

    internal static async Task<(Attachment attachment, string blobPath)> SavePhoto(
        IFormFile file, Guid taskId, string category, Guid uploadedBy,
        NeeDbContext db, IConfiguration config, CancellationToken ct)
    {
        var uploadsBaseRaw = config["Storage:UploadsBasePath"]
            ?? Path.Combine(AppContext.BaseDirectory, "uploads");
        var uploadsBase = Path.IsPathRooted(uploadsBaseRaw)
            ? uploadsBaseRaw
            : Path.GetFullPath(uploadsBaseRaw);

        var taskDir = Path.Combine(uploadsBase, taskId.ToString());
        Directory.CreateDirectory(taskDir);

        var storedName = $"{Guid.NewGuid():N}_{file.FileName}";
        var fullPath   = Path.Combine(taskDir, storedName);
        await using (var fs = File.Create(fullPath))
            await file.CopyToAsync(fs, ct);

        var blobPath   = $"{taskId}/{storedName}";
        var attachment = new Attachment
        {
            EntityType    = "JobTask",
            EntityId      = taskId,
            Category      = category,
            FileName      = file.FileName,
            ContentType   = file.ContentType,
            SizeBytes     = file.Length,
            BlobContainer = "local",
            BlobPath      = blobPath,
            UploadedBy    = uploadedBy,
            UploadedAt    = DateTimeOffset.UtcNow,
        };
        db.Attachments.Add(attachment);
        await db.SaveChangesAsync(ct);
        return (attachment, blobPath);
    }
}

public record QcPassRequest(
    QcChecklistResponse[] ChecklistResponses,
    string? Notes,
    string? EmailTo
);

public record QcChecklistResponse(string ItemCode, bool Checked);

public record QcItemRequest(bool Passed, string? Notes = null);
