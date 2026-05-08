using System.Globalization;
using System.Security.Claims;
using System.Text.Json;
using ClosedXML.Excel;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain;

namespace Nee.Api.Endpoints;

public static class ChassisStockEndpoints
{
    // Header alias map (lowercase → canonical field name)
    private static readonly Dictionary<string, string> HeaderAliases = new(StringComparer.OrdinalIgnoreCase)
    {
        ["chassis number"] = "chassis_number", ["chassis no"] = "chassis_number",
        ["chassis#"]       = "chassis_number", ["vin"]        = "chassis_number",
        ["chassis_number"] = "chassis_number",
        ["body type"]  = "body_type",  ["type"]  = "body_type",  ["body"]     = "body_type",
        ["body_type"]  = "body_type",
        ["colour"] = "colour", ["color"] = "colour", ["paint"] = "colour",
        ["tag"] = "tag_number", ["tag no"] = "tag_number", ["tag number"] = "tag_number",
        ["key"] = "tag_number", ["key no"] = "tag_number", ["key number"] = "tag_number",
        ["tag_number"] = "tag_number",
        ["arrival date"]     = "arrival_date", ["arrived"]       = "arrival_date",
        ["received"]         = "arrival_date", ["eta"]           = "arrival_date",
        ["est. arrival date"]= "arrival_date", ["est arrival date"] = "arrival_date",
        ["arrival_date"]     = "arrival_date",
    };

    public static void MapChassisStockEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/scheduling/chassis").RequireAuthorization().WithTags("ChassisStock");

        // POST /api/scheduling/chassis/upload-inventory
        grp.MapPost("/upload-inventory", async (
            IFormFile file,
            IConfiguration config,
            NeeDbContext db,
            ClaimsPrincipal user,
            CancellationToken ct) =>
        {
            // Validate file type
            var isXlsx = file.ContentType is "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                         || file.FileName.EndsWith(".xlsx", StringComparison.OrdinalIgnoreCase)
                         || file.ContentType is "application/octet-stream";
            if (!isXlsx)
                return Results.BadRequest(new { message = "Only .xlsx files are accepted." });
            if (file.Length > 5_242_880)
                return Results.StatusCode(413);

            // Resolve uploads path
            var uploadsBase = ResolveUploadsBase(config);
            var chassisDir  = Path.Combine(uploadsBase, "chassis-stock");
            Directory.CreateDirectory(chassisDir);

            var storedName = $"{Guid.NewGuid()}.xlsx";
            var diskPath   = Path.Combine(chassisDir, storedName);
            var blobPath   = $"chassis-stock/{storedName}";

            await using (var fs = File.Create(diskPath))
                await file.CopyToAsync(fs, ct);

            var userIdStr = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
            if (!Guid.TryParse(userIdStr, out var userId))
                return Results.Unauthorized();

            // Parse
            var parsed = ParseSheet(diskPath);

            // Diff against DB
            var existingChassis = await db.ChassisInventory.ToListAsync(ct);
            var existingByNumber = existingChassis.ToDictionary(c => c.ChassisNumber, StringComparer.OrdinalIgnoreCase);
            var parsedNumbers = parsed.Rows.Select(r => r.ChassisNumber).ToHashSet(StringComparer.OrdinalIgnoreCase);

            var toInsert = parsed.Rows
                .Where(r => !existingByNumber.ContainsKey(r.ChassisNumber))
                .ToList();

            var toUpdate = new List<object>();
            foreach (var row in parsed.Rows.Where(r => existingByNumber.ContainsKey(r.ChassisNumber)))
            {
                var existing = existingByNumber[row.ChassisNumber];
                var changes = new List<object>();
                if (row.BodyType    != null && row.BodyType    != existing.BodyType)
                    changes.Add(new { field = "body_type",    from = existing.BodyType,    to = row.BodyType });
                if (row.Colour      != null && row.Colour      != existing.Colour)
                    changes.Add(new { field = "colour",       from = existing.Colour,      to = row.Colour });
                if (row.TagNumber   != null && row.TagNumber   != existing.TagNumber)
                    changes.Add(new { field = "tag_number",   from = existing.TagNumber,   to = row.TagNumber });
                if (row.ArrivalDate != null && row.ArrivalDate != existing.ArrivalDate)
                    changes.Add(new { field = "arrival_date", from = existing.ArrivalDate?.ToString(), to = row.ArrivalDate?.ToString() });
                if (changes.Count > 0)
                    toUpdate.Add(new { chassisNumber = row.ChassisNumber, changes });
            }

            var wouldBeStale = existingChassis
                .Where(c => c.Status == "AVAILABLE" && c.AllocatedToRo == null && !parsedNumbers.Contains(c.ChassisNumber))
                .Select(c =>
                {
                    int weeksAgo = c.LastSeenAt.HasValue
                        ? (int)((DateTimeOffset.UtcNow - c.LastSeenAt.Value).TotalDays / 7)
                        : -1;
                    return new { chassisNumber = c.ChassisNumber, lastSeenWeeksAgo = weeksAgo };
                })
                .ToList();

            // Persist audit row
            var errorsJson = parsed.ParseErrors.Count > 0
                ? JsonDocument.Parse(JsonSerializer.Serialize(parsed.ParseErrors))
                : null;

            var upload = new ChassisStockUpload
            {
                UploadedBy  = userId,
                FileName    = file.FileName,
                BlobPath    = blobPath,
                RowCount    = parsed.Rows.Count + parsed.ParseErrors.Count,
                Status      = "PARSED",
                ParseErrors = errorsJson,
            };
            db.ChassisStockUploads.Add(upload);
            await db.SaveChangesAsync(ct);

            return Results.Ok(new
            {
                uploadId     = upload.Id,
                rowCount     = upload.RowCount,
                toInsert,
                toUpdate,
                wouldBeStale,
                parseErrors  = parsed.ParseErrors,
            });
        })
        .DisableAntiforgery()
        .RequireAuthorization(p => p.RequireRole("ADMIN"))
        .WithName("UploadChassisInventory");

        // POST /api/scheduling/chassis/upload-inventory/{uploadId}/commit
        grp.MapPost("/upload-inventory/{uploadId:guid}/commit", async (
            Guid uploadId,
            NeeDbContext db,
            IConfiguration config,
            ClaimsPrincipal user,
            CancellationToken ct) =>
        {
            var upload = await db.ChassisStockUploads.FindAsync([uploadId], ct);
            if (upload is null) return Results.NotFound();
            if (upload.Status != "PARSED")
                return Results.Conflict(new { message = "This upload has already been committed or rejected." });

            var uploadsBase = ResolveUploadsBase(config);
            var diskPath    = Path.Combine(uploadsBase, upload.BlobPath);
            if (!File.Exists(diskPath))
                return Results.UnprocessableEntity(new { message = "Uploaded file not found on disk." });

            var parsed = ParseSheet(diskPath);
            var parsedNumbers = parsed.Rows.Select(r => r.ChassisNumber).ToHashSet(StringComparer.OrdinalIgnoreCase);

            var existingChassis = await db.ChassisInventory
                .Include(c => c.AllocatedRo)
                .ToListAsync(ct);
            var existingByNumber = existingChassis.ToDictionary(c => c.ChassisNumber, StringComparer.OrdinalIgnoreCase);

            var userIdStr = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
            Guid.TryParse(userIdStr, out var userId);

            int inserted = 0, updated = 0, deliveredAuto = 0;
            var now = DateTimeOffset.UtcNow;

            await using var tx = await db.Database.BeginTransactionAsync(ct);

            // Insert new chassis
            foreach (var row in parsed.Rows.Where(r => !existingByNumber.ContainsKey(r.ChassisNumber)))
            {
                db.ChassisInventory.Add(new ChassisInventory
                {
                    ChassisNumber  = row.ChassisNumber,
                    Description    = row.BodyType ?? row.ChassisNumber,
                    ChassisClass   = "?",
                    Status         = "AVAILABLE",
                    BodyType       = row.BodyType,
                    Colour         = row.Colour,
                    TagNumber      = row.TagNumber,
                    ArrivalDate    = row.ArrivalDate,
                    LastSeenAt     = now,
                    SourceUploadId = uploadId,
                    ReceivedAt     = now,
                });
                inserted++;
            }

            // Update existing rows whose fields differ
            foreach (var row in parsed.Rows.Where(r => existingByNumber.ContainsKey(r.ChassisNumber)))
            {
                var c = existingByNumber[row.ChassisNumber];
                bool changed = false;
                if (row.BodyType    != null && row.BodyType    != c.BodyType)    { c.BodyType    = row.BodyType;    changed = true; }
                if (row.Colour      != null && row.Colour      != c.Colour)      { c.Colour      = row.Colour;      changed = true; }
                if (row.TagNumber   != null && row.TagNumber   != c.TagNumber)   { c.TagNumber   = row.TagNumber;   changed = true; }
                if (row.ArrivalDate != null && row.ArrivalDate != c.ArrivalDate) { c.ArrivalDate = row.ArrivalDate; changed = true; }
                c.LastSeenAt     = now;
                c.SourceUploadId = uploadId;
                c.UpdatedAt      = now;
                if (changed) updated++;
            }

            // Auto-deliver: ALLOCATED chassis missing from sheet whose linked RO is COMPLETED
            foreach (var c in existingChassis.Where(c => c.Status == "ALLOCATED" && !parsedNumbers.Contains(c.ChassisNumber)))
            {
                if (c.AllocatedRo?.Status == "COMPLETED")
                {
                    c.Status      = "DELIVERED";
                    c.DeliveredAt = now;
                    c.UpdatedAt   = now;
                    deliveredAuto++;
                }
            }

            var staleAfter = existingChassis.Count(c =>
                c.Status == "AVAILABLE" && c.AllocatedToRo == null && !parsedNumbers.Contains(c.ChassisNumber));

            upload.Status          = "COMMITTED";
            upload.CommittedAt     = now;
            upload.InsertedCount   = inserted;
            upload.UpdatedCount    = updated;
            upload.StaleAfterCount = staleAfter;

            db.DomainEvents.Add(new DomainEvent
            {
                EventType     = "ChassisStockReconciled",
                AggregateType = "ChassisStockUpload",
                AggregateId   = uploadId,
                Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new
                {
                    uploadId, inserted, updated, deliveredAuto, staleAfter,
                    rowCount = parsed.Rows.Count,
                })),
                UserId = userId == Guid.Empty ? null : (Guid?)userId,
            });

            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);

            return Results.Ok(new { inserted, updated, deliveredAuto, staleAfterUpload = staleAfter });
        })
        .RequireAuthorization(p => p.RequireRole("ADMIN"))
        .WithName("CommitChassisInventory");
    }

    private static string ResolveUploadsBase(IConfiguration config)
    {
        var raw = config["Storage:UploadsBasePath"]
                  ?? Path.Combine(AppContext.BaseDirectory, "uploads");
        return Path.IsPathRooted(raw) ? raw : Path.GetFullPath(raw);
    }

    internal record ParsedRow(
        string ChassisNumber,
        string? BodyType,
        string? Colour,
        string? TagNumber,
        DateOnly? ArrivalDate);

    internal record ParseResult(List<ParsedRow> Rows, List<object> ParseErrors);

    internal static ParseResult ParseSheet(string path)
    {
        var rows   = new List<ParsedRow>();
        var errors = new List<object>();

        using var wb    = new XLWorkbook(path);
        var sheet = wb.Worksheet(1);
        var used  = sheet.RangeUsed();
        if (used is null) return new ParseResult(rows, errors);

        var allRows = used.RowsUsed().ToList();
        if (allRows.Count < 2) return new ParseResult(rows, errors);

        // Build column index from header row
        var headerRow  = allRows[0];
        var colMap     = new Dictionary<string, int>(); // canonical → 1-based col index
        for (int c = 1; c <= headerRow.CellCount(); c++)
        {
            var raw = headerRow.Cell(c).GetString().Trim();
            if (HeaderAliases.TryGetValue(raw, out var canonical) && !colMap.ContainsKey(canonical))
                colMap[canonical] = c;
        }

        if (!colMap.ContainsKey("chassis_number"))
        {
            errors.Add(new { row = 1, message = "No chassis_number column found. Recognized aliases: chassis number, chassis no, chassis#, vin" });
            return new ParseResult(rows, errors);
        }

        for (int i = 1; i < allRows.Count; i++)
        {
            var row  = allRows[i];
            var rowN = i + 1; // 1-based, skip header

            string GetCell(string field) =>
                colMap.TryGetValue(field, out var ci) ? row.Cell(ci).GetString().Trim() : string.Empty;

            var chassisNumber = GetCell("chassis_number");
            if (string.IsNullOrWhiteSpace(chassisNumber))
            {
                errors.Add(new { row = rowN, message = "missing chassis_number" });
                continue;
            }

            DateOnly? arrivalDate = null;
            var dateStr = GetCell("arrival_date");
            if (!string.IsNullOrWhiteSpace(dateStr))
            {
                // Try ISO, AU format, or let ClosedXML DateTime fall through
                if (DateOnly.TryParseExact(dateStr, "yyyy-MM-dd", null, DateTimeStyles.None, out var d1))
                    arrivalDate = d1;
                else if (DateOnly.TryParseExact(dateStr, "d/MM/yyyy", null, DateTimeStyles.None, out var d2))
                    arrivalDate = d2;
                else if (DateOnly.TryParseExact(dateStr, "dd/MM/yyyy", null, DateTimeStyles.None, out var d3))
                    arrivalDate = d3;
                else if (colMap.TryGetValue("arrival_date", out var ci))
                {
                    var cell = row.Cell(ci);
                    if (cell.DataType == XLDataType.DateTime)
                        arrivalDate = DateOnly.FromDateTime(cell.GetDateTime());
                }
            }

            rows.Add(new ParsedRow(
                ChassisNumber: chassisNumber,
                BodyType:      NullIfEmpty(GetCell("body_type")),
                Colour:        NullIfEmpty(GetCell("colour")),
                TagNumber:     NullIfEmpty(GetCell("tag_number")),
                ArrivalDate:   arrivalDate));
        }

        return new ParseResult(rows, errors);
    }

    private static string? NullIfEmpty(string s) => string.IsNullOrWhiteSpace(s) ? null : s;
}
