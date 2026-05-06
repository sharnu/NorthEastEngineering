using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain;
using Nee.Api.Services;

namespace Nee.Api.Endpoints;

public static class SalesPdfEndpoints
{
    public static void MapSalesPdfEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/sales").RequireAuthorization().WithTags("SalesPdf");

        // POST /api/sales/pdf-upload
        grp.MapPost("/pdf-upload", async (
            IFormFile file,
            IConfiguration config,
            NeeDbContext db,
            ClaimsPrincipal user,
            CancellationToken ct) =>
        {
            var isPdf = file.ContentType.Contains("pdf", StringComparison.OrdinalIgnoreCase)
                        || file.ContentType is "application/octet-stream";
            if (!isPdf)
                return Results.BadRequest(new { message = "Only PDF files are accepted." });

            if (file.Length > 20_971_520)
                return Results.StatusCode(413);

            var uploadsBaseRaw = config["Storage:UploadsBasePath"]
                ?? Path.Combine(AppContext.BaseDirectory, "uploads");
            var uploadsBase = Path.IsPathRooted(uploadsBaseRaw)
                ? uploadsBaseRaw
                : Path.GetFullPath(uploadsBaseRaw);

            var pdfDir = Path.Combine(uploadsBase, "pdf-uploads");
            Directory.CreateDirectory(pdfDir);

            var storedName = $"{Guid.NewGuid()}.pdf";
            var diskPath = Path.Combine(pdfDir, storedName);
            var blobPath = $"pdf-uploads/{storedName}";

            await using (var fs = File.Create(diskPath))
                await file.CopyToAsync(fs, ct);

            var userIdStr = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!Guid.TryParse(userIdStr, out var userId))
                return Results.Unauthorized();

            var attachment = new Attachment
            {
                Id = Guid.NewGuid(),
                EntityType = "PdfUpload",
                EntityId = Guid.Empty,
                Category = "SOURCE_PDF",
                FileName = file.FileName,
                ContentType = "application/pdf",
                SizeBytes = file.Length,
                BlobContainer = "local",
                BlobPath = blobPath,
                UploadedBy = userId,
                UploadedAt = DateTimeOffset.UtcNow,
            };

            db.Attachments.Add(attachment);
            await db.SaveChangesAsync(ct);

            return Results.Created($"/api/sales/pdf-upload/{attachment.Id}", new
            {
                UploadId = attachment.Id,
                FileName = file.FileName,
                BlobPath = blobPath,
                SizeBytes = file.Length,
            });
        })
        .DisableAntiforgery()
        .RequireAuthorization(p => p.RequireRole("SALES", "ADMIN"))
        .WithName("UploadSalesPdf");

        // GET /api/sales/pdf-upload/{id}
        grp.MapGet("/pdf-upload/{id:guid}", async (
            Guid id,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var att = await db.Attachments
                .FirstOrDefaultAsync(a => a.Id == id && a.Category == "SOURCE_PDF", ct);

            if (att is null)
                return Results.NotFound(new { message = "Upload not found." });

            return Results.Ok(new
            {
                UploadId = att.Id,
                att.FileName,
                att.BlobPath,
                att.SizeBytes,
            });
        })
        .RequireAuthorization()
        .WithName("GetSalesPdfUpload");

        // POST /api/sales/pdf-upload/{id}/parse
        grp.MapPost("/pdf-upload/{id:guid}/parse", async (
            Guid id,
            NeeDbContext db,
            IConfiguration config,
            PdfParserService parser,
            PdfScoringService scorer,
            CancellationToken ct) =>
        {
            var att = await db.Attachments
                .FirstOrDefaultAsync(a => a.Id == id && a.EntityType == "PdfUpload" && a.Category == "SOURCE_PDF", ct);

            if (att is null)
                return Results.NotFound(new { message = "Upload not found." });

            var uploadsBaseRaw = config["Storage:UploadsBasePath"]
                ?? Path.Combine(AppContext.BaseDirectory, "uploads");
            var uploadsBase = Path.IsPathRooted(uploadsBaseRaw)
                ? uploadsBaseRaw
                : Path.GetFullPath(uploadsBaseRaw);

            var diskPath = Path.Combine(uploadsBase, att.BlobPath);
            if (!File.Exists(diskPath))
                return Results.NotFound(new { message = "PDF file not found on disk." });

            await using var stream = File.OpenRead(diskPath);
            var parsed = parser.Parse(stream);
            var scored = await scorer.ScoreAsync(parsed, ct);

            return Results.Ok(new
            {
                UploadId = id,
                Fields = scored.Fields,
                RawText = parsed.RawText,
            });
        })
        .RequireAuthorization()
        .WithName("ParseSalesPdf");

        // PATCH /api/sales/pdf-upload/{id}/link
        grp.MapPatch("/pdf-upload/{id:guid}/link", async (
            Guid id,
            LinkPdfRequest req,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var att = await db.Attachments
                .FirstOrDefaultAsync(a => a.Id == id && a.Category == "SOURCE_PDF", ct);

            if (att is null)
                return Results.NotFound(new { message = "Upload not found." });

            if (att.EntityId != Guid.Empty && att.EntityId != req.RoId)
                return Results.Conflict(new { message = "This PDF is already linked to a different repair order." });

            att.EntityType = "RepairOrder";
            att.EntityId = req.RoId;
            await db.SaveChangesAsync(ct);

            return Results.Ok();
        })
        .RequireAuthorization()
        .WithName("LinkSalesPdf");
    }
}

public record LinkPdfRequest(Guid RoId);
