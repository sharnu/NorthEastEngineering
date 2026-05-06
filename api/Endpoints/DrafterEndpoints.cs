using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain;
using Nee.Api.Services;

namespace Nee.Api.Endpoints;

// ── Request / Response DTOs ────────────────────────────────────────────────

public record DrafterStatusRequest(string Status, string? Notes);

public record DrafterArtefactDto(
    Guid Id,
    string Category,
    string FileName,
    string ContentType,
    long SizeBytes,
    string Url,
    Guid UploadedBy,
    string UploaderName,
    DateTimeOffset UploadedAt);

public static class DrafterEndpoints
{
    private static readonly string[] AllowedTransitions = [];

    private static bool IsValidTransition(string from, string to) => (from, to) switch
    {
        ("NOT_STARTED", "IN_PROGRESS") => true,
        ("IN_PROGRESS", "COMPLETED")   => true,
        ("IN_PROGRESS", "ON_HOLD")     => true,
        ("ON_HOLD",     "IN_PROGRESS") => true,
        _ => false,
    };

    public static void MapDrafterEndpoints(this WebApplication app)
    {
        var drafter = app.MapGroup("/api/drafter")
            .RequireAuthorization(p => p.RequireRole("DRAFTER", "ADMIN"))
            .WithTags("Drafter");

        // ── GET /api/drafter/queue ─────────────────────────────────────────
        drafter.MapGet("/queue", async (NeeDbContext db, CancellationToken ct) =>
        {
            var rows = await db.RepairOrders
                .Where(r => r.DraftingStatus == "NOT_STARTED" ||
                            r.DraftingStatus == "IN_PROGRESS"  ||
                            r.DraftingStatus == "ON_HOLD")
                .OrderBy(r => r.Priority)
                .ThenBy(r => r.RequiredDate)
                .Select(r => new
                {
                    r.Id,
                    r.RoNumber,
                    CustomerName  = r.Customer.Name,
                    TemplateName  = r.Template.Name,
                    r.DraftingStatus,
                    r.Priority,
                    RequiredDate  = r.RequiredDate,
                    DraftedBy     = r.DraftedBy,
                    DraftedAt     = r.DraftedAt,
                })
                .ToListAsync(ct);

            return Results.Ok(rows);
        }).WithName("DrafterQueue");

        // ── GET /api/drafter/ros/{roId} ───────────────────────────────────
        drafter.MapGet("/ros/{roId:guid}", async (Guid roId, NeeDbContext db, CancellationToken ct) =>
        {
            var ro = await db.RepairOrders
                .Where(r => r.Id == roId)
                .Select(r => new
                {
                    r.Id,
                    r.RoNumber,
                    r.DraftingStatus,
                    r.DraftedBy,
                    r.DraftedAt,
                    r.Priority,
                    r.Notes,
                    RequiredDate = r.RequiredDate,
                    CustomerName = r.Customer.Name,
                    TemplateCode = r.TemplateCode,
                    TemplateName = r.Template.Name,
                    Tasks = r.Tasks.OrderBy(t => t.Sequence).Select(t => new
                    {
                        t.Id,
                        t.Sequence,
                        t.JobCodeLine,
                        t.OperationName,
                        t.EstimatedHours,
                        t.Status,
                        StationId = t.StationId,
                        t.Station.Name,
                    }).ToArray(),
                })
                .FirstOrDefaultAsync(ct);

            if (ro is null) return Results.NotFound();

            var artefactsRaw = await db.Attachments
                .Where(a => a.EntityType == "RepairOrder" &&
                            a.EntityId   == roId &&
                            (a.Category == "DRAFT_LAYOUT" ||
                             a.Category == "DRAFT_BOM"    ||
                             a.Category == "DRAFT_DRAWING_PACK"))
                .Join(db.Users, a => a.UploadedBy, u => u.Id, (a, u) => new
                {
                    a.Id,
                    a.Category,
                    a.FileName,
                    a.ContentType,
                    a.SizeBytes,
                    a.BlobPath,
                    a.UploadedBy,
                    UploaderName = u.FullName,
                    a.UploadedAt,
                })
                .OrderBy(a => a.UploadedAt)
                .ToListAsync(ct);

            var artefacts = artefactsRaw.Select(a => new DrafterArtefactDto(
                a.Id,
                a.Category,
                a.FileName,
                a.ContentType,
                a.SizeBytes,
                $"/uploads/{a.BlobPath}",
                a.UploadedBy,
                a.UploaderName,
                a.UploadedAt
            )).ToList();

            return Results.Ok(new
            {
                ro.Id,
                ro.RoNumber,
                ro.DraftingStatus,
                ro.DraftedBy,
                ro.DraftedAt,
                ro.Priority,
                ro.Notes,
                ro.RequiredDate,
                ro.CustomerName,
                ro.TemplateCode,
                ro.TemplateName,
                ro.Tasks,
                Artefacts = artefacts,
            });
        }).WithName("DrafterRoDetail");

        // ── PUT /api/drafter/ros/{roId}/status ────────────────────────────
        drafter.MapPut("/ros/{roId:guid}/status", async (
            Guid roId,
            DrafterStatusRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            INotificationService notifications,
            CancellationToken ct) =>
        {
            var userId = Guid.Parse(principal.FindFirstValue("sub")!);

            var ro = await db.RepairOrders.FindAsync([roId], ct);
            if (ro is null) return Results.NotFound();

            if (!IsValidTransition(ro.DraftingStatus, req.Status))
                return Results.UnprocessableEntity(new
                {
                    message = $"Cannot transition drafting status from '{ro.DraftingStatus}' to '{req.Status}'."
                });

            var oldStatus = ro.DraftingStatus;
            ro.DraftingStatus = req.Status;

            if (req.Status == "COMPLETED")
            {
                ro.DraftedBy = userId;
                ro.DraftedAt = DateTimeOffset.UtcNow;
            }

            var roNumber = ro.RoNumber;

            var evt = new DomainEvent
            {
                EventType     = "DraftingStatusChanged",
                AggregateType = "RepairOrder",
                AggregateId   = roId,
                UserId        = userId,
                OccurredAt    = DateTimeOffset.UtcNow,
                Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new
                {
                    roId      = roId,
                    roNumber  = roNumber,
                    fromStatus = oldStatus,
                    toStatus  = req.Status,
                    notes     = req.Notes,
                })),
            };
            db.DomainEvents.Add(evt);
            await db.SaveChangesAsync(ct);

            if (req.Status == "COMPLETED")
                await notifications.FanOutAsync(evt, ct);

            return Results.NoContent();
        }).WithName("DrafterUpdateStatus");

        // ── POST /api/drafter/ros/{roId}/artefacts ────────────────────────
        drafter.MapPost("/ros/{roId:guid}/artefacts", async (
            Guid roId,
            IFormFile file,
            string category,
            ClaimsPrincipal principal,
            NeeDbContext db,
            IConfiguration config,
            CancellationToken ct) =>
        {
            var userId = Guid.Parse(principal.FindFirstValue("sub")!);

            var ro = await db.RepairOrders.FindAsync([roId], ct);
            if (ro is null) return Results.NotFound();

            var validCategories = new[] { "DRAFT_LAYOUT", "DRAFT_BOM", "DRAFT_DRAWING_PACK" };
            if (!validCategories.Contains(category, StringComparer.OrdinalIgnoreCase))
                return Results.BadRequest(new { message = $"Invalid category. Must be one of: {string.Join(", ", validCategories)}" });

            if (file.Length > 20_971_520)
                return Results.StatusCode(413);

            var uploadsBaseRaw = config["Storage:UploadsBasePath"]
                ?? Path.Combine(AppContext.BaseDirectory, "uploads");
            var uploadsBase = Path.IsPathRooted(uploadsBaseRaw)
                ? uploadsBaseRaw
                : Path.GetFullPath(uploadsBaseRaw);

            var roDir = Path.Combine(uploadsBase, "drafter", roId.ToString());
            Directory.CreateDirectory(roDir);

            var storedName = $"{Guid.NewGuid():N}_{file.FileName}";
            var fullPath   = Path.Combine(roDir, storedName);

            await using (var fs = File.Create(fullPath))
                await file.CopyToAsync(fs, ct);

            var blobPath = $"drafter/{roId}/{storedName}";
            var now      = DateTimeOffset.UtcNow;

            var attachment = new Attachment
            {
                EntityType    = "RepairOrder",
                EntityId      = roId,
                Category      = category.ToUpperInvariant(),
                FileName      = file.FileName,
                ContentType   = file.ContentType,
                SizeBytes     = file.Length,
                BlobContainer = "local",
                BlobPath      = blobPath,
                UploadedBy    = userId,
                UploadedAt    = now,
            };
            db.Attachments.Add(attachment);

            db.DomainEvents.Add(new DomainEvent
            {
                EventType     = "DraftingArtefactUploaded",
                AggregateType = "RepairOrder",
                AggregateId   = roId,
                UserId        = userId,
                OccurredAt    = now,
                Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new
                {
                    roId     = roId,
                    category = category,
                    fileName = file.FileName,
                })),
            });

            await db.SaveChangesAsync(ct);

            return Results.Created($"/api/drafter/ros/{roId}", new
            {
                AttachmentId = attachment.Id,
                FileName     = attachment.FileName,
                Category     = attachment.Category,
                Url          = $"/uploads/{blobPath}",
                UploadedAt   = now,
            });
        }).DisableAntiforgery().WithName("DrafterUploadArtefact");

        // ── DELETE /api/drafter/ros/{roId}/artefacts/{artefactId} ─────────
        drafter.MapDelete("/ros/{roId:guid}/artefacts/{artefactId:guid}", async (
            Guid roId,
            Guid artefactId,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var userId = Guid.Parse(principal.FindFirstValue("sub")!);

            var attachment = await db.Attachments
                .FirstOrDefaultAsync(a => a.Id == artefactId && a.EntityId == roId, ct);
            if (attachment is null) return Results.NotFound();

            db.Attachments.Remove(attachment);

            db.DomainEvents.Add(new DomainEvent
            {
                EventType     = "DraftingArtefactDeleted",
                AggregateType = "RepairOrder",
                AggregateId   = roId,
                UserId        = userId,
                OccurredAt    = DateTimeOffset.UtcNow,
                Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new
                {
                    roId         = roId,
                    artefactId   = artefactId,
                    category     = attachment.Category,
                    fileName     = attachment.FileName,
                })),
            });

            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        }).WithName("DrafterDeleteArtefact");
    }
}
