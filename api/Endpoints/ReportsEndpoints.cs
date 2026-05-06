using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using System.Text;

namespace Nee.Api.Endpoints;

public static class ReportsEndpoints
{
    public static void MapReportsEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/dashboard/reports")
            .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "ADMIN"))
            .WithTags("Reports");

        // GET /api/dashboard/reports/throughput
        grp.MapGet("/throughput", async (NeeDbContext db, CancellationToken ct) =>
        {
            var since = DateTimeOffset.UtcNow.AddDays(-84);

            var ros = await db.RepairOrders
                .Where(r => r.CreatedAt >= since)
                .Select(r => new { r.CreatedAt, r.Status })
                .ToListAsync(ct);

            return Results.Ok(BuildThroughputSeries(ros.Select(r => (r.CreatedAt, r.Status))));
        }).WithName("GetThroughputReport");

        // GET /api/dashboard/reports/throughput/csv
        grp.MapGet("/throughput/csv", async (NeeDbContext db, CancellationToken ct) =>
        {
            var since = DateTimeOffset.UtcNow.AddDays(-84);

            var ros = await db.RepairOrders
                .Where(r => r.CreatedAt >= since)
                .Select(r => new { r.CreatedAt, r.Status })
                .ToListAsync(ct);

            var data = BuildThroughputSeries(ros.Select(r => (r.CreatedAt, r.Status)));
            var csv = new StringBuilder("Week Start,Completed,In Progress,Blocked\r\n");
            foreach (var r in data)
                csv.AppendLine($"{r.WeekStart:yyyy-MM-dd},{r.Completed},{r.InProgress},{r.Blocked}");

            return Results.File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", "throughput-report.csv");
        }).WithName("ExportThroughputCsv");

        // GET /api/dashboard/reports/calibration?templateCode=
        grp.MapGet("/calibration", async (string? templateCode, NeeDbContext db, CancellationToken ct) =>
        {
            var query = db.Set<TemplateCalibrationDto>().AsQueryable();

            if (!string.IsNullOrWhiteSpace(templateCode))
                query = query.Where(x => x.TemplateCode == templateCode.ToUpper());

            var rows = await query
                .OrderBy(x => x.TemplateCode)
                .ThenBy(x => x.OperationName)
                .ToListAsync(ct);

            return Results.Ok(rows);
        }).WithName("GetCalibrationReport");

        // GET /api/dashboard/reports/calibration/csv
        grp.MapGet("/calibration/csv", async (string? templateCode, NeeDbContext db, CancellationToken ct) =>
        {
            var query = db.Set<TemplateCalibrationDto>().AsQueryable();

            if (!string.IsNullOrWhiteSpace(templateCode))
                query = query.Where(x => x.TemplateCode == templateCode.ToUpper());

            var rows = await query
                .OrderBy(x => x.TemplateCode)
                .ThenBy(x => x.OperationName)
                .ToListAsync(ct);

            var csv = new StringBuilder("Template,Operation,Estimate (h),Avg Actual (h),Avg Delta (h),Sample Size\r\n");
            foreach (var r in rows)
            {
                var avgActual = r.AvgActual.HasValue ? r.AvgActual.Value.ToString("F2") : "";
                var avgDelta  = r.AvgDelta.HasValue  ? r.AvgDelta.Value.ToString("F2")  : "";
                csv.AppendLine($"{r.TemplateCode},{r.OperationName},{r.TemplateEstimate:F2},{avgActual},{avgDelta},{r.SampleSize}");
            }

            return Results.File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", "calibration-report.csv");
        }).WithName("ExportCalibrationCsv");
    }

    private static List<ThroughputWeekDto> BuildThroughputSeries(
        IEnumerable<(DateTimeOffset CreatedAt, string Status)> ros)
    {
        var weeks = Enumerable.Range(0, 12)
            .Select(i => IsoWeekStart(DateTimeOffset.UtcNow).AddDays(-7 * (11 - i)))
            .ToList();

        var byWeek = ros
            .GroupBy(r => IsoWeekStart(r.CreatedAt))
            .ToDictionary(g => g.Key, g => g.ToList());

        return weeks.Select(w =>
        {
            byWeek.TryGetValue(w, out var items);
            items ??= [];
            return new ThroughputWeekDto
            {
                WeekStart  = w,
                Completed  = items.Count(r => r.Status == "COMPLETED"),
                InProgress = items.Count(r => r.Status is "APPROVED" or "IN_PROGRESS"),
                Blocked    = items.Count(r => r.Status == "ON_HOLD"),
            };
        }).ToList();
    }

    private static DateOnly IsoWeekStart(DateTimeOffset dt)
    {
        var d = dt.UtcDateTime.Date;
        var dow = (int)d.DayOfWeek;
        var daysToMonday = dow == 0 ? 6 : dow - 1;
        return DateOnly.FromDateTime(d.AddDays(-daysToMonday));
    }
}

public class ThroughputWeekDto
{
    public DateOnly WeekStart  { get; set; }
    public int Completed  { get; set; }
    public int InProgress { get; set; }
    public int Blocked    { get; set; }
}

public class TemplateCalibrationDto
{
    public string   TemplateCode      { get; set; } = string.Empty;
    public string   OperationName     { get; set; } = string.Empty;
    public decimal  TemplateEstimate  { get; set; }
    public decimal? AvgActual         { get; set; }
    public decimal? AvgDelta          { get; set; }
    public int      SampleSize        { get; set; }
    public decimal? StddevActual      { get; set; }
}
