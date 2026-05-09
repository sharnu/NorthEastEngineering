using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nee.Api.Data;
using System.Text;

namespace Nee.Api.Endpoints;

public static class ReportsEndpoints
{
    /// <summary>
    /// Memory-cache key for the strategic forecast response. Other endpoints
    /// (RO schedule, RO cancel, task complete) call <see cref="InvalidateForecastCache"/>
    /// to drop this entry when the underlying signals change.
    /// </summary>
    public const string ForecastCacheKey = "reports.forecast.v1";

    /// <summary>Drops the cached forecast response so the next /forecast hit recomputes.</summary>
    public static void InvalidateForecastCache(IMemoryCache cache) => cache.Remove(ForecastCacheKey);

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

        MapVarianceRootCauseEndpoints(grp);
        MapCustomerConcentrationEndpoints(grp);
        MapForecastEndpoints(grp);
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

    // ── E17 · Variance Root Cause ────────────────────────────────────────
    private static void MapVarianceRootCauseEndpoints(RouteGroupBuilder grp)
    {
        grp.MapGet("/variance-root-cause",
            async (string? from, string? to, string? groupBy, int? minSampleSize,
                   NeeDbContext db, CancellationToken ct) =>
        {
            var (fromDate, toDate) = ParseDateRange(from, to, defaultDays: 90);
            var key = (groupBy ?? "reason").ToLowerInvariant();
            if (key is not ("reason" or "station" or "template" or "technician"))
                return Results.BadRequest(new { message = "groupBy must be one of: reason, station, template, technician" });

            var minSize = minSampleSize.GetValueOrDefault(1);
            var flat = await ComputeVarianceFlatAggregates(db, fromDate, toDate, key, ct);

            var grouped = flat
                .GroupBy(a => new { a.GroupKey, a.GroupLabel })
                .Select(g => new
                {
                    GroupKey        = g.Key.GroupKey,
                    GroupLabel      = g.Key.GroupLabel,
                    TotalDeltaHours = Math.Round(g.Sum(a => a.DeltaHours), 2),
                    SampleSize      = g.Sum(a => a.Count),
                    ByReason = g
                        .Select(a => new
                        {
                            a.ReasonCode, a.ReasonName, a.IsOverrun,
                            DeltaHours = Math.Round(a.DeltaHours, 2),
                            a.Count,
                        })
                        .OrderByDescending(rg => Math.Abs(rg.DeltaHours))
                        .ToList(),
                })
                .Where(g => g.SampleSize >= minSize)
                .OrderByDescending(g => Math.Abs(g.TotalDeltaHours))
                .ToList();

            return Results.Ok(new
            {
                GroupBy         = key,
                From            = DateOnly.FromDateTime(fromDate),
                To              = DateOnly.FromDateTime(toDate.AddDays(-1)),
                TotalSampleSize = flat.Sum(a => a.Count),
                TotalDeltaHours = Math.Round(flat.Sum(a => a.DeltaHours), 2),
                Rows            = grouped,
            });
        }).WithName("GetVarianceRootCauseReport");

        grp.MapGet("/variance-root-cause/records",
            async (string? from, string? to, string? groupBy, string? groupKey,
                   int? page, int? pageSize,
                   NeeDbContext db, CancellationToken ct) =>
        {
            var (fromDate, toDate) = ParseDateRange(from, to, defaultDays: 90);
            var key = (groupBy ?? "reason").ToLowerInvariant();
            if (key is not ("reason" or "station" or "template" or "technician"))
                return Results.BadRequest(new { message = "groupBy must be one of: reason, station, template, technician" });

            var pageN = Math.Max(1, page.GetValueOrDefault(1));
            var sizeN = Math.Clamp(pageSize.GetValueOrDefault(50), 1, 200);

            var query = db.VarianceRecords
                .Where(v => v.RecordedAt >= fromDate && v.RecordedAt < toDate);

            if (!string.IsNullOrWhiteSpace(groupKey))
            {
                query = key switch
                {
                    "reason"     => query.Where(v => v.Reason.Code == groupKey),
                    "station"    => short.TryParse(groupKey, out var sId) ? query.Where(v => v.Task.StationId == sId) : query.Where(v => false),
                    "template"   => query.Where(v => v.Task.RepairOrder.TemplateCode == groupKey),
                    "technician" => Guid.TryParse(groupKey, out var uId) ? query.Where(v => v.RecordedBy == uId) : query.Where(v => false),
                    _            => query,
                };
            }

            var total = await query.CountAsync(ct);
            var items = await query
                .OrderByDescending(v => v.RecordedAt)
                .Skip((pageN - 1) * sizeN)
                .Take(sizeN)
                .Select(v => new
                {
                    RecordId       = v.Id,
                    RecordedAt     = v.RecordedAt,
                    RoId           = v.Task.RoId,
                    RoNumber       = v.Task.RepairOrder.RoNumber,
                    OperationName  = v.Task.OperationName,
                    StationName    = v.Task.Station.Name,
                    TemplateCode   = v.Task.RepairOrder.TemplateCode,
                    TechnicianName = db.Users.Where(u => u.Id == v.RecordedBy).Select(u => u.FullName).FirstOrDefault(),
                    EstimatedHours = v.EstimatedHours,
                    ActualHours    = v.ActualHours,
                    DeltaHours     = v.DeltaHours,
                    DeltaPercent   = v.DeltaPercent,
                    ReasonCode     = v.Reason.Code,
                    ReasonName     = v.Reason.Name,
                    Notes          = v.Notes,
                })
                .ToListAsync(ct);

            return Results.Ok(new { Items = items, TotalCount = total, Page = pageN, PageSize = sizeN });
        }).WithName("GetVarianceRootCauseRecords");

        grp.MapGet("/variance-root-cause/csv",
            async (string? from, string? to, string? groupBy, int? minSampleSize,
                   NeeDbContext db, CancellationToken ct) =>
        {
            var (fromDate, toDate) = ParseDateRange(from, to, defaultDays: 90);
            var key = (groupBy ?? "reason").ToLowerInvariant();
            if (key is not ("reason" or "station" or "template" or "technician"))
                return Results.BadRequest(new { message = "groupBy must be one of: reason, station, template, technician" });

            var minSize = minSampleSize.GetValueOrDefault(1);
            var flat = await ComputeVarianceFlatAggregates(db, fromDate, toDate, key, ct);

            // Group totals so the CSV's "Sample Size" / "Delta Hours" match
            // the JSON endpoint, then emit one row per (group, reason) tuple.
            var groupTotals = flat
                .GroupBy(a => new { a.GroupKey, a.GroupLabel })
                .ToDictionary(
                    g => g.Key.GroupKey,
                    g => (Total: g.Sum(a => a.DeltaHours), Count: g.Sum(a => a.Count)));

            var csv = new StringBuilder("Group,Sample Size,Delta Hours,Reason Code,Reason Name,Reason Delta Hours,Reason Count\r\n");
            foreach (var a in flat
                .Where(a => groupTotals[a.GroupKey].Count >= minSize)
                .OrderByDescending(a => Math.Abs(groupTotals[a.GroupKey].Total))
                .ThenByDescending(a => Math.Abs(a.DeltaHours)))
            {
                var (gTotal, gCount) = groupTotals[a.GroupKey];
                csv.AppendLine($"{Esc(a.GroupLabel)},{gCount},{gTotal:F2},{a.ReasonCode},{Esc(a.ReasonName)},{a.DeltaHours:F2},{a.Count}");
            }

            var fname = $"variance-root-cause-{DateOnly.FromDateTime(fromDate):yyyy-MM-dd}_{DateOnly.FromDateTime(toDate.AddDays(-1)):yyyy-MM-dd}.csv";
            return Results.File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", fname);
        }).WithName("ExportVarianceRootCauseCsv");
    }

    /// <summary>One row per (group, reason) tuple — flat output of a SQL
    /// GROUP BY. Both the JSON endpoint and the CSV exporter pivot this
    /// into the nested response shape in C#. Doing the GROUP BY in Postgres
    /// avoids loading every variance record into memory.</summary>
    private sealed record VarianceFlatAggregate(
        string GroupKey, string GroupLabel,
        string ReasonCode, string ReasonName, bool IsOverrun,
        decimal DeltaHours, int Count);

    /// <summary>Issues a single SQL GROUP BY with a two-key composite (group +
    /// reason) — the group key is selected based on <paramref name="groupBy"/>.
    /// EF Core translates each switch arm into its own query; per-arm shape
    /// keeps the projection simple enough for the EF translator.</summary>
    private static async Task<List<VarianceFlatAggregate>> ComputeVarianceFlatAggregates(
        NeeDbContext db, DateTime fromDate, DateTime toDate, string key, CancellationToken ct)
    {
        var baseQuery = db.VarianceRecords
            .Where(v => v.RecordedAt >= fromDate && v.RecordedAt < toDate);

        return key switch
        {
            "reason" => await baseQuery
                .GroupBy(v => new {
                    Code     = v.Reason.Code,
                    Name     = v.Reason.Name,
                    Overrun  = v.Reason.IsOverrun,
                })
                .Select(g => new VarianceFlatAggregate(
                    g.Key.Code, g.Key.Name,
                    g.Key.Code, g.Key.Name, g.Key.Overrun,
                    g.Sum(v => v.DeltaHours), g.Count()))
                .ToListAsync(ct),

            "station" => await baseQuery
                .GroupBy(v => new {
                    StationId   = v.Task.StationId,
                    StationName = v.Task.Station.Name,
                    Code        = v.Reason.Code,
                    Name        = v.Reason.Name,
                    Overrun     = v.Reason.IsOverrun,
                })
                .Select(g => new VarianceFlatAggregate(
                    g.Key.StationId.ToString(), g.Key.StationName,
                    g.Key.Code, g.Key.Name, g.Key.Overrun,
                    g.Sum(v => v.DeltaHours), g.Count()))
                .ToListAsync(ct),

            "template" => await baseQuery
                .GroupBy(v => new {
                    TemplateCode = v.Task.RepairOrder.TemplateCode,
                    Code         = v.Reason.Code,
                    Name         = v.Reason.Name,
                    Overrun      = v.Reason.IsOverrun,
                })
                .Select(g => new VarianceFlatAggregate(
                    g.Key.TemplateCode, g.Key.TemplateCode,
                    g.Key.Code, g.Key.Name, g.Key.Overrun,
                    g.Sum(v => v.DeltaHours), g.Count()))
                .ToListAsync(ct),

            "technician" => await baseQuery
                .Join(db.Users, v => v.RecordedBy, u => u.Id, (v, u) => new { v, u })
                .GroupBy(x => new {
                    TechId   = x.v.RecordedBy,
                    TechName = x.u.FullName,
                    Code     = x.v.Reason.Code,
                    Name     = x.v.Reason.Name,
                    Overrun  = x.v.Reason.IsOverrun,
                })
                .Select(g => new VarianceFlatAggregate(
                    g.Key.TechId.ToString(), g.Key.TechName ?? "Unknown",
                    g.Key.Code, g.Key.Name, g.Key.Overrun,
                    g.Sum(x => x.v.DeltaHours), g.Count()))
                .ToListAsync(ct),

            _ => new List<VarianceFlatAggregate>(),
        };
    }

    // ── E18 · Customer Concentration ─────────────────────────────────────
    private static void MapCustomerConcentrationEndpoints(RouteGroupBuilder grp)
    {
        grp.MapGet("/customer-concentration",
            async (string? period, NeeDbContext db, CancellationToken ct) =>
        {
            var (fromDate, toDate, periodKey) = ResolvePeriod(period);

            // Anchor on JobTask.CompletedAt, not RepairOrder.CreatedAt:
            // we want hours actually delivered in the period. Using
            // RO.CreatedAt would include in-flight ROs that have logged
            // little work yet, and exclude ROs created earlier whose
            // work was completed in the period. CANCELLED ROs are
            // excluded because their task hours don't represent
            // delivered work.
            var perCustomer = await db.JobTasks
                .Where(t => t.Status == "COMPLETED"
                         && t.CompletedAt != null
                         && t.CompletedAt >= fromDate && t.CompletedAt < toDate
                         && t.RepairOrder.Status != "CANCELLED")
                .GroupBy(t => new { t.RepairOrder.CustomerId, t.RepairOrder.Customer.Code, t.RepairOrder.Customer.Name })
                .Select(g => new
                {
                    CustomerId   = g.Key.CustomerId,
                    CustomerCode = g.Key.Code,
                    CustomerName = g.Key.Name,
                    RoCount      = g.Select(t => t.RoId).Distinct().Count(),
                    TotalHours   = g.Sum(t => t.ActualHours),
                })
                .ToListAsync(ct);

            var totalHours  = perCustomer.Sum(c => c.TotalHours);
            var totalRos    = perCustomer.Sum(c => c.RoCount);
            var ordered = perCustomer.OrderByDescending(c => c.TotalHours).ToList();

            // Compute cumulative percentages first; then mark topRanked only
            // when the top-3 cumulative crosses 60% — i.e. only when the
            // concentration is meaningful enough to surface visually. This
            // keeps row badges and the over-threshold banner in sync.
            decimal[] cumulatives = new decimal[ordered.Count];
            decimal running = 0;
            for (var i = 0; i < ordered.Count; i++)
            {
                var pct = totalHours > 0 ? Math.Round(ordered[i].TotalHours / totalHours * 100m, 1) : 0;
                running += pct;
                cumulatives[i] = Math.Round(running, 1);
            }
            var top3Dominant = ordered.Count >= 3 && cumulatives[2] > 60;

            var rows = ordered.Select((c, i) =>
            {
                var pct = totalHours > 0 ? Math.Round(c.TotalHours / totalHours * 100m, 1) : 0;
                return new
                {
                    c.CustomerId,
                    c.CustomerCode,
                    c.CustomerName,
                    c.RoCount,
                    TotalHours        = Math.Round(c.TotalHours, 1),
                    PercentOfTotal    = pct,
                    CumulativePercent = cumulatives[i],
                    TopRanked         = i < 3 && top3Dominant,
                };
            }).ToList();

            return Results.Ok(new
            {
                Period = periodKey,
                From   = DateOnly.FromDateTime(fromDate),
                To     = DateOnly.FromDateTime(toDate.AddDays(-1)),
                TotalRoCount = totalRos,
                TotalHours   = Math.Round(totalHours, 1),
                Rows = rows,
            });
        }).WithName("GetCustomerConcentrationReport");

        grp.MapGet("/customer-concentration/trend",
            async (Guid customerId, NeeDbContext db, CancellationToken ct) =>
        {
            var customerExists = await db.Customers.AnyAsync(c => c.Id == customerId, ct);
            if (!customerExists)
                return Results.NotFound(new { message = "Customer not found." });

            var nowUtc = DateTime.UtcNow.Date;
            var quarters = new List<(string Label, DateTime Start, DateTime EndExcl)>();
            for (int i = 7; i >= 0; i--)
            {
                var qStart = QuarterStartUtc(nowUtc).AddMonths(-3 * i);
                var qEnd   = qStart.AddMonths(3);
                var label  = $"{qStart.Year} Q{((qStart.Month - 1) / 3) + 1}";
                quarters.Add((label, qStart, qEnd));
            }

            // Same anchor as the headline endpoint — completed tasks in window
            var tasks = await db.JobTasks
                .Where(t => t.RepairOrder.CustomerId == customerId
                         && t.Status == "COMPLETED"
                         && t.CompletedAt != null
                         && t.CompletedAt >= quarters[0].Start
                         && t.RepairOrder.Status != "CANCELLED")
                .Select(t => new { CompletedAt = t.CompletedAt!.Value, t.RoId, t.ActualHours })
                .ToListAsync(ct);

            var points = quarters.Select(q =>
            {
                var inWindow = tasks.Where(t => t.CompletedAt >= q.Start && t.CompletedAt < q.EndExcl).ToList();
                return new
                {
                    QuarterLabel = q.Label,
                    QuarterStart = DateOnly.FromDateTime(q.Start),
                    RoCount      = inWindow.Select(t => t.RoId).Distinct().Count(),
                    TotalHours   = Math.Round(inWindow.Sum(t => t.ActualHours), 1),
                };
            }).ToList();

            return Results.Ok(new { CustomerId = customerId, Quarters = points });
        }).WithName("GetCustomerConcentrationTrend");

        grp.MapGet("/customer-concentration/csv",
            async (string? period, NeeDbContext db, CancellationToken ct) =>
        {
            var (fromDate, toDate, periodKey) = ResolvePeriod(period);

            // Same per-task completion anchor as the JSON endpoint.
            var perCustomer = await db.JobTasks
                .Where(t => t.Status == "COMPLETED"
                         && t.CompletedAt != null
                         && t.CompletedAt >= fromDate && t.CompletedAt < toDate
                         && t.RepairOrder.Status != "CANCELLED")
                .GroupBy(t => new { t.RepairOrder.Customer.Code, t.RepairOrder.Customer.Name })
                .Select(g => new
                {
                    Code  = g.Key.Code,
                    Name  = g.Key.Name,
                    Count = g.Select(t => t.RoId).Distinct().Count(),
                    Hours = g.Sum(t => t.ActualHours),
                })
                .OrderByDescending(c => c.Hours)
                .ToListAsync(ct);

            var totalHours = perCustomer.Sum(c => c.Hours);
            decimal cum = 0;

            var csv = new StringBuilder("Customer Code,Customer Name,RO Count,Total Hours,Percent,Cumulative Percent\r\n");
            foreach (var c in perCustomer)
            {
                var pct = totalHours > 0 ? Math.Round(c.Hours / totalHours * 100m, 1) : 0;
                cum += pct;
                csv.AppendLine($"{Esc(c.Code)},{Esc(c.Name)},{c.Count},{c.Hours:F1},{pct:F1},{cum:F1}");
            }

            var fname = $"customer-concentration-{periodKey}.csv";
            return Results.File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", fname);
        }).WithName("ExportCustomerConcentrationCsv");
    }

    // ── E20 · Strategic Forecasting ──────────────────────────────────────
    // Risk score formula (0-100), see docs/forecasting-formula.md:
    //   capacity_overcommit (max 30) +
    //   recent_variance     (max 30) +
    //   blocker_frequency   (max 25) +
    //   days_late           (max 15)
    private const int FORECAST_FACTOR_CAPACITY  = 30;
    private const int FORECAST_FACTOR_VARIANCE  = 30;
    private const int FORECAST_FACTOR_BLOCKERS  = 25;
    private const int FORECAST_FACTOR_DAYS_LATE = 15;

    private static void MapForecastEndpoints(RouteGroupBuilder grp)
    {
        grp.MapGet("/forecast",
            async (NeeDbContext db, IMemoryCache cache, CancellationToken ct) =>
        {
            // 1h memory cache. Invalidated by RO scheduling/cancel/complete
            // — see InvalidateForecastCache calls in those endpoints.
            if (cache.TryGetValue(ForecastCacheKey, out object? cached) && cached is not null)
                return Results.Ok(cached);

            var nowUtc = DateTime.UtcNow.Date;
            var sixtyDaysAgo = nowUtc.AddDays(-60);
            var fourWeeksOut = nowUtc.AddDays(28);

            // Active scheduled ROs
            var ros = await db.RepairOrders
                .Where(r => r.ScheduledStartWeek != null
                         && r.Status != "COMPLETED" && r.Status != "CANCELLED")
                .Select(r => new
                {
                    r.Id, r.RoNumber, r.TemplateCode,
                    CustomerName = r.Customer.Name,
                    r.ScheduledStartWeek,
                    r.RequiredDate,
                    EstimatedHours = r.Tasks.Sum(t => t.EstimatedHours),
                    Stations = r.Tasks.Select(t => t.StationId).Distinct().ToList(),
                })
                .ToListAsync(ct);

            // Capacity heatmap covering the full horizon any active RO is
            // scheduled into (no longer a fixed 4-week window — that silently
            // produced a 0 capacity score for ROs scheduled further out).
            var capacityRaw = await db.JobTasks
                .Where(t => t.RepairOrder.ScheduledStartWeek != null
                         && t.RepairOrder.Status != "COMPLETED"
                         && t.RepairOrder.Status != "CANCELLED")
                .Select(t => new
                {
                    t.StationId,
                    Week = t.RepairOrder.ScheduledStartWeek!.Value,
                    t.EstimatedHours,
                })
                .ToListAsync(ct);

            const decimal weeklyCapacity = 40m;
            // Map (stationId, week) -> bool overcommitted? — used per-RO so
            // an RO scheduled to W30 sees overcommit on W30 even though it's
            // not in the next-4-weeks window.
            var overcommittedSet = capacityRaw
                .GroupBy(c => new { c.StationId, c.Week })
                .Where(g => g.Sum(x => x.EstimatedHours) > weeklyCapacity)
                .Select(g => (g.Key.StationId, g.Key.Week))
                .ToHashSet();

            var stationNames = await db.Stations
                .ToDictionaryAsync(s => s.Id, s => s.Name, ct);

            // Recent variance per template (avg delta_percent on same template in last 60 days)
            var recentVariance = await db.VarianceRecords
                .Where(v => v.RecordedAt >= sixtyDaysAgo)
                .GroupBy(v => v.Task.RepairOrder.TemplateCode)
                .Select(g => new { TemplateCode = g.Key, AvgPct = g.Average(v => v.DeltaPercent ?? 0m) })
                .ToDictionaryAsync(g => g.TemplateCode, g => g.AvgPct, ct);

            // Blocker frequency per template (TaskBlocked events on ROs of same template, last 60d)
            var blockedCounts = await db.DomainEvents
                .Where(e => e.EventType == "TaskBlocked" && e.OccurredAt >= sixtyDaysAgo)
                .Join(db.JobTasks, e => e.AggregateId, t => t.Id, (e, t) => t.RepairOrder.TemplateCode)
                .GroupBy(t => t)
                .Select(g => new { TemplateCode = g.Key, Count = g.Count() })
                .ToDictionaryAsync(g => g.TemplateCode, g => g.Count, ct);

            var rows = ros.Select(r =>
            {
                var factors = new List<object>();
                int score = 0;

                // Capacity overcommit — count overcommitted weeks across the
                // span this RO is expected to run, per station on its path.
                int capacityScore = 0;
                short? bottleneckId = null;
                string? bottleneckName = null;
                if (r.Stations.Count > 0)
                {
                    // Estimate the RO's execution span: ceil(estimatedHours / weeklyCapacity)
                    // weeks starting from scheduledStartWeek, minimum 1 week.
                    var weeksNeededInt = Math.Max(1,
                        (int)Math.Ceiling((double)(r.EstimatedHours / weeklyCapacity)));
                    // Cap span at 12 weeks to avoid pathological estimates blowing up the score.
                    weeksNeededInt = Math.Min(12, weeksNeededInt);
                    var roWeeks = Enumerable.Range(0, weeksNeededInt)
                        .Select(i => r.ScheduledStartWeek!.Value.AddDays(7 * i))
                        .ToList();

                    var perStationOver = r.Stations
                        .Select(sid => new {
                            sid,
                            count = roWeeks.Count(w => overcommittedSet.Contains((sid, w))),
                        })
                        .Where(x => x.count > 0)
                        .ToList();
                    if (perStationOver.Count > 0)
                    {
                        var max = perStationOver.OrderByDescending(x => x.count).First();
                        bottleneckId = max.sid;
                        bottleneckName = stationNames.GetValueOrDefault(max.sid);
                        var totalOverWeeks = perStationOver.Sum(x => x.count);
                        capacityScore = (int)Math.Min(FORECAST_FACTOR_CAPACITY,
                            FORECAST_FACTOR_CAPACITY * totalOverWeeks / 4);
                        if (capacityScore > 0)
                            factors.Add(new {
                                key = "capacity_overcommit",
                                weight = capacityScore,
                                description = $"{bottleneckName ?? "Station " + bottleneckId} overcommitted in {totalOverWeeks} of {roWeeks.Count} scheduled week(s)",
                            });
                    }
                }
                score += capacityScore;

                // Recent variance
                int varianceScore = 0;
                var avgPct = recentVariance.GetValueOrDefault(r.TemplateCode, 0m);
                if (avgPct > 0)
                {
                    varianceScore = (int)Math.Round(Math.Min((decimal)FORECAST_FACTOR_VARIANCE, avgPct));
                    if (varianceScore > 0)
                        factors.Add(new {
                            key = "recent_variance",
                            weight = varianceScore,
                            description = $"Template {r.TemplateCode} avg overrun {avgPct:F1}% (last 60d)",
                        });
                }
                score += varianceScore;

                // Blocker frequency
                int blockScore = 0;
                var blockCount = blockedCounts.GetValueOrDefault(r.TemplateCode, 0);
                if (blockCount > 0)
                {
                    blockScore = Math.Min(FORECAST_FACTOR_BLOCKERS, 5 * blockCount);
                    factors.Add(new {
                        key = "blocker_frequency",
                        weight = blockScore,
                        description = $"{blockCount} TaskBlocked events on similar template (last 60d)",
                    });
                }
                score += blockScore;

                // Days-late projection
                var weeksNeeded = r.EstimatedHours / weeklyCapacity;
                var overrunFactor = 1 + Math.Max(0m, avgPct) / 100m;
                var startMon = r.ScheduledStartWeek!.Value.ToDateTime(TimeOnly.MinValue);
                var projected = startMon.AddDays((double)(weeksNeeded * overrunFactor) * 7);
                int daysAtRisk = 0;
                int daysScore = 0;
                if (r.RequiredDate.HasValue)
                {
                    daysAtRisk = Math.Max(0, (int)(projected - r.RequiredDate.Value.UtcDateTime).TotalDays);
                    if (daysAtRisk > 0)
                    {
                        daysScore = Math.Min(FORECAST_FACTOR_DAYS_LATE, daysAtRisk);
                        factors.Add(new {
                            key = "days_late",
                            weight = daysScore,
                            description = $"Projected {daysAtRisk} day(s) past required date",
                        });
                    }
                }
                score += daysScore;

                score = Math.Clamp(score, 0, 100);
                var tier = score >= 60 ? "HIGH" : score >= 30 ? "MED" : "LOW";

                return new
                {
                    RoId                  = r.Id,
                    RoNumber              = r.RoNumber,
                    CustomerName          = r.CustomerName,
                    TemplateCode          = r.TemplateCode,
                    ScheduledStartWeek    = r.ScheduledStartWeek,
                    RequiredDate          = r.RequiredDate,
                    ProjectedCompletionDate = DateOnly.FromDateTime(projected),
                    DaysAtRisk            = daysAtRisk,
                    RiskScore             = score,
                    RiskTier              = tier,
                    BottleneckStationId   = bottleneckId,
                    BottleneckStationName = bottleneckName,
                    Factors               = factors,
                };
            })
            .OrderByDescending(r => r.RiskScore)
            .ToList();

            var response = new
            {
                ComputedAt = DateTimeOffset.UtcNow,
                Rows = rows,
            };
            cache.Set(ForecastCacheKey, response, TimeSpan.FromHours(1));
            return Results.Ok(response);
        }).WithName("GetForecastReport");
    }

    // ── Shared helpers ───────────────────────────────────────────────────
    private static (DateTime From, DateTime To) ParseDateRange(
        string? from, string? to, int defaultDays)
    {
        var toDate = !string.IsNullOrWhiteSpace(to) && DateTime.TryParse(to, out var t)
            ? t.Date.AddDays(1)
            : DateTime.UtcNow.Date.AddDays(1);
        var fromDate = !string.IsNullOrWhiteSpace(from) && DateTime.TryParse(from, out var f)
            ? f.Date
            : toDate.AddDays(-defaultDays);
        return (DateTime.SpecifyKind(fromDate, DateTimeKind.Utc),
                DateTime.SpecifyKind(toDate,   DateTimeKind.Utc));
    }

    private static (DateTime From, DateTime To, string Key) ResolvePeriod(string? period)
    {
        var key = (period ?? "last_quarter").ToLowerInvariant();
        var nowUtc = DateTime.UtcNow.Date;
        DateTime fromDate;
        var toDate = nowUtc.AddDays(1);
        switch (key)
        {
            case "last_year":   fromDate = nowUtc.AddDays(-365); break;
            case "ytd":         fromDate = new DateTime(nowUtc.Year, 1, 1, 0, 0, 0, DateTimeKind.Utc); break;
            case "last_quarter":
            default:            key = "last_quarter"; fromDate = nowUtc.AddDays(-90); break;
        }
        return (DateTime.SpecifyKind(fromDate, DateTimeKind.Utc),
                DateTime.SpecifyKind(toDate,   DateTimeKind.Utc),
                key);
    }

    private static DateTime QuarterStartUtc(DateTime nowUtc)
    {
        var q = ((nowUtc.Month - 1) / 3) * 3 + 1;
        return new DateTime(nowUtc.Year, q, 1, 0, 0, 0, DateTimeKind.Utc);
    }

    /// <summary>RFC 4180 CSV escape — quotes when the field contains a
    /// comma, quote, or newline (CR or LF). Doubles inner quotes.</summary>
    private static string Esc(string? s)
    {
        if (s is null) return "";
        var needsQuoting = s.Contains(',') || s.Contains('"') ||
                           s.Contains('\n') || s.Contains('\r');
        return needsQuoting ? "\"" + s.Replace("\"", "\"\"") + "\"" : s;
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
