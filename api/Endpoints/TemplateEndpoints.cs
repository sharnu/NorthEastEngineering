using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;

namespace Nee.Api.Endpoints;

public static class TemplateEndpoints
{
    public static void MapTemplateEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/templates").RequireAuthorization().WithTags("Templates");

        // GET /api/templates[?q=search]
        grp.MapGet("/", async (string? q, NeeDbContext db, CancellationToken ct) =>
        {
            var query = db.JobCodeTemplates
                .Include(t => t.BodyType)
                .Include(t => t.Customer)
                .Include(t => t.Versions.Where(v => v.SupersededAt == null))
                .Where(t => t.IsActive);

            if (!string.IsNullOrWhiteSpace(q))
            {
                var lower = q.ToLower();
                query = query.Where(t =>
                    t.Code.ToLower().Contains(lower) ||
                    t.Name.ToLower().Contains(lower) ||
                    t.BodyType.Name.ToLower().Contains(lower));
            }

            var templates = await query
                .OrderBy(t => t.Code)
                .ToListAsync(ct);

            var result = templates.Select(t =>
            {
                var v = t.Versions.MaxBy(v => v.VersionNumber);
                return new
                {
                    t.Code,
                    DisplayName = t.Name,
                    BodyType = t.BodyType.Name,
                    BodyTypeCode = t.BodyType.Code,
                    CustomerVariant = t.Customer?.Name,
                    TotalHours = v?.TotalEstimatedHours,
                    LatestVersion = v?.VersionNumber,
                };
            });

            return Results.Ok(result);
        }).WithName("GetTemplates");

        // GET /api/templates/{code}
        grp.MapGet("/{code}", async (string code, NeeDbContext db, CancellationToken ct) =>
        {
            var template = await db.JobCodeTemplates
                .Include(t => t.BodyType)
                .Include(t => t.Customer)
                .Include(t => t.Versions.Where(v => v.SupersededAt == null))
                    .ThenInclude(v => v.Operations.OrderBy(o => o.Sequence))
                        .ThenInclude(o => o.Operation)
                            .ThenInclude(op => op.DefaultStation)
                .Where(t => t.Code == code && t.IsActive)
                .FirstOrDefaultAsync(ct);

            if (template is null)
                return Results.NotFound(new { message = $"Template '{code}' not found." });

            var version = template.Versions.MaxBy(v => v.VersionNumber);

            var result = new
            {
                template.Code,
                DisplayName = template.Name,
                template.Description,
                BodyType = template.BodyType.Name,
                BodyTypeCode = template.BodyType.Code,
                CustomerVariant = template.Customer?.Name,
                TotalHours = version?.TotalEstimatedHours,
                LatestVersion = version?.VersionNumber,
                Operations = version?.Operations.Select(o => new
                {
                    o.Sequence,
                    OperationCode = o.Operation.Code,
                    OperationName = o.Operation.CanonicalName,
                    o.EstimatedHours,
                    DefaultStation = o.Operation.DefaultStation.Name,
                    DefaultStationCode = o.Operation.DefaultStation.Code,
                    StationOverrideId = o.StationIdOverride,
                    o.Notes,
                }),
            };

            return Results.Ok(result);
        }).WithName("GetTemplateByCode");
    }
}
