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

            var records = await db.VarianceRecords
                .Where(v => v.RecordedAt >= fromDate && v.RecordedAt < toDate)
                .Select(v => new VarianceRow
                {
                    RecordId       = v.Id,
                    DeltaHours     = v.DeltaHours,
                    DeltaPercent   = v.DeltaPercent,
                    EstimatedHours = v.EstimatedHours,
                    ActualHours    = v.ActualHours,
                    ReasonCode     = v.Reason.Code,
                    ReasonName     = v.Reason.Name,
                    IsOverrun      = v.Reason.IsOverrun,
                    StationId      = v.Task.StationId,
                    StationName    = v.Task.Station.Name,
                    TemplateCode   = v.Task.RepairOrder.TemplateCode,
                    TechnicianId   = v.RecordedBy,
                    TechnicianName = db.Users
                        .Where(u => u.Id == v.RecordedBy)
                        .Select(u => u.FullName).FirstOrDefault(),
                })
                .ToListAsync(ct);

            // Build groupKey/groupLabel selector
            Func<VarianceRow, (string Key, string Label)> selector = key switch
            {
                "reason"     => r => (r.ReasonCode,   r.ReasonName),
                "station"    => r => (r.StationId.ToString(), r.StationName),
                "template"   => r => (r.TemplateCode, r.TemplateCode),
                "technician" => r => (r.TechnicianId.ToString(), r.TechnicianName ?? "Unknown"),
                _            => r => (r.ReasonCode,   r.ReasonName),
            };

            var grouped = records
                .GroupBy(r => selector(r))
                .Select(g => new
                {
                    GroupKey         = g.Key.Key,
                    GroupLabel       = g.Key.Label,
                    TotalDeltaHours  = Math.Round(g.Sum(r => r.DeltaHours), 2),
                    SampleSize       = g.Count(),
                    ByReason = g
                        .GroupBy(r => new { r.ReasonCode, r.ReasonName, r.IsOverrun })
                        .Select(rg => new
                        {
                            ReasonCode  = rg.Key.ReasonCode,
                            ReasonName  = rg.Key.ReasonName,
                            IsOverrun   = rg.Key.IsOverrun,
                            DeltaHours  = Math.Round(rg.Sum(r => r.DeltaHours), 2),
                            Count       = rg.Count(),
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
                TotalSampleSize = records.Count,
                TotalDeltaHours = Math.Round(records.Sum(r => r.DeltaHours), 2),
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
            var resp = await GetVarianceRootCauseRows(from, to, groupBy, minSampleSize, db, ct);
            if (resp is null) return Results.BadRequest(new { message = "groupBy must be one of: reason, station, template, technician" });

            var csv = new StringBuilder("Group,Sample Size,Delta Hours,Reason Code,Reason Name,Reason Delta Hours,Reason Count\r\n");
            foreach (var g in resp.Rows)
            {
                foreach (var r in g.ByReason)
                {
                    csv.AppendLine($"{Esc(g.GroupLabel)},{g.SampleSize},{g.TotalDeltaHours:F2},{r.ReasonCode},{Esc(r.ReasonName)},{r.DeltaHours:F2},{r.Count}");
                }
            }
            var fname = $"variance-root-cause-{resp.From:yyyy-MM-dd}_{resp.To:yyyy-MM-dd}.csv";
            return Results.File(Encoding.UTF8.GetBytes(csv.ToString()), "text/csv", fname);
        }).WithName("ExportVarianceRootCauseCsv");
    }

    private record VarianceRow
    {
        public Guid    RecordId       { get; init; }
        public decimal DeltaHours     { get; init; }
        public decimal? DeltaPercent  { get; init; }
        public decimal EstimatedHours { get; init; }
        public decimal ActualHours    { get; init; }
        public string  ReasonCode     { get; init; } = "";
        public string  ReasonName     { get; init; } = "";
        public bool    IsOverrun      { get; init; }
        public short   StationId      { get; init; }
        public string  StationName    { get; init; } = "";
        public string  TemplateCode   { get; init; } = "";
        public Guid    TechnicianId   { get; init; }
        public string? TechnicianName { get; init; }
    }

    private record VarianceRootCauseResponse(
        DateOnly From,
        DateOnly To,
        IReadOnlyList<VarianceRootCauseRow> Rows);

    private record VarianceRootCauseRow(
        string GroupKey, string GroupLabel,
        decimal TotalDeltaHours, int SampleSize,
        IReadOnlyList<VarianceReasonBreakdown> ByReason);

    private record VarianceReasonBreakdown(
        string ReasonCode, string ReasonName, bool IsOverrun,
        decimal DeltaHours, int Count);

    private static async Task<VarianceRootCauseResponse?> GetVarianceRootCauseRows(
        string? from, string? to, string? groupBy, int? minSampleSize,
        NeeDbContext db, CancellationToken ct)
    {
        var (fromDate, toDate) = ParseDateRange(from, to, defaultDays: 90);
        var key = (groupBy ?? "reason").ToLowerInvariant();
        if (key is not ("reason" or "station" or "template" or "technician"))
            return null;

        var minSize = minSampleSize.GetValueOrDefault(1);

        var records = await db.VarianceRecords
            .Where(v => v.RecordedAt >= fromDate && v.RecordedAt < toDate)
            .Select(v => new VarianceRow
            {
                RecordId       = v.Id,
                DeltaHours     = v.DeltaHours,
                DeltaPercent   = v.DeltaPercent,
                EstimatedHours = v.EstimatedHours,
                ActualHours    = v.ActualHours,
                ReasonCode     = v.Reason.Code,
                ReasonName     = v.Reason.Name,
                IsOverrun      = v.Reason.IsOverrun,
                StationId      = v.Task.StationId,
                StationName    = v.Task.Station.Name,
                TemplateCode   = v.Task.RepairOrder.TemplateCode,
                TechnicianId   = v.RecordedBy,
                TechnicianName = db.Users.Where(u => u.Id == v.RecordedBy).Select(u => u.FullName).FirstOrDefault(),
            })
            .ToListAsync(ct);

        Func<VarianceRow, (string, string)> selector = key switch
        {
            "reason"     => r => (r.ReasonCode,   r.ReasonName),
            "station"    => r => (r.StationId.ToString(), r.StationName),
            "template"   => r => (r.TemplateCode, r.TemplateCode),
            "technician" => r => (r.TechnicianId.ToString(), r.TechnicianName ?? "Unknown"),
            _            => r => (r.ReasonCode,   r.ReasonName),
        };

        var rows = records
            .GroupBy(r => selector(r))
            .Select(g => new VarianceRootCauseRow(
                g.Key.Item1, g.Key.Item2,
                Math.Round(g.Sum(r => r.DeltaHours), 2),
                g.Count(),
                g.GroupBy(r => new { r.ReasonCode, r.ReasonName, r.IsOverrun })
                 .Select(rg => new VarianceReasonBreakdown(
                     rg.Key.ReasonCode, rg.Key.ReasonName, rg.Key.IsOverrun,
                     Math.Round(rg.Sum(r => r.DeltaHours), 2),
                     rg.Count()))
                 .OrderByDescending(rg => Math.Abs(rg.DeltaHours))
                 .ToList()))
            .Where(g => g.SampleSize >= minSize)
            .OrderByDescending(g => Math.Abs(g.TotalDeltaHours))
            .ToList();

        return new VarianceRootCauseResponse(
            DateOnly.FromDateTime(fromDate),
            DateOnly.FromDateTime(toDate.AddDays(-1)),
            rows);
    }

    // ── E18 · Customer Concentration ─────────────────────────────────────
    private static void MapCustomerConcentrationEndpoints(RouteGroupBuilder grp)
    {
        grp.MapGet("/customer-concentration",
            async (string? period, NeeDbContext db, CancellationToken ct) =>
        {
            var (fromDate, toDate, periodKey) = ResolvePeriod(period);

            var perCustomer = await db.RepairOrders
                .Where(r => r.CreatedAt >= fromDate && r.CreatedAt < toDate
                         && r.Status != "CANCELLED")
                .GroupBy(r => new { r.CustomerId, r.Customer.Code, r.Customer.Name })
                .Select(g => new
                {
                    CustomerId   = g.Key.CustomerId,
                    CustomerCode = g.Key.Code,
                    CustomerName = g.Key.Name,
                    RoCount      = g.Count(),
                    TotalHours   = g.SelectMany(r => r.Tasks).Sum(t => t.ActualHours),
                })
                .ToListAsync(ct);

            var totalHours  = perCustomer.Sum(c => c.TotalHours);
            var totalRos    = perCustomer.Sum(c => c.RoCount);
            decimal cum = 0;

            var rows = perCustomer
                .OrderByDescending(c => c.TotalHours)
                .Select((c, i) =>
                {
                    var pct = totalHours > 0 ? Math.Round(c.TotalHours / totalHours * 100m, 1) : 0;
                    cum += pct;
                    return new
                    {
                        c.CustomerId,
                        c.CustomerCode,
                        c.CustomerName,
                        c.RoCount,
                        TotalHours        = Math.Round(c.TotalHours, 1),
                        PercentOfTotal    = pct,
                        CumulativePercent = Math.Round(cum, 1),
                        TopRanked         = i < 3,
                    };
                })
                .ToList();

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
            var nowUtc = DateTime.UtcNow.Date;
            var quarters = new List<(string Label, DateTime Start, DateTime EndExcl)>();
            for (int i = 7; i >= 0; i--)
            {
                var qStart = QuarterStartUtc(nowUtc).AddMonths(-3 * i);
                var qEnd   = qStart.AddMonths(3);
                var label  = $"{qStart.Year} Q{((qStart.Month - 1) / 3) + 1}";
                quarters.Add((label, qStart, qEnd));
            }

            var ros = await db.RepairOrders
                .Where(r => r.CustomerId == customerId
                         && r.CreatedAt >= quarters[0].Start
                         && r.Status != "CANCELLED")
                .Select(r => new { r.CreatedAt, Hours = r.Tasks.Sum(t => t.ActualHours) })
                .ToListAsync(ct);

            var points = quarters.Select(q => new
            {
                QuarterLabel = q.Label,
                QuarterStart = DateOnly.FromDateTime(q.Start),
                RoCount      = ros.Count(r => r.CreatedAt >= q.Start && r.CreatedAt < q.EndExcl),
                TotalHours   = Math.Round(
                    ros.Where(r => r.CreatedAt >= q.Start && r.CreatedAt < q.EndExcl)
                       .Sum(r => r.Hours), 1),
            }).ToList();

            return Results.Ok(new { CustomerId = customerId, Quarters = points });
        }).WithName("GetCustomerConcentrationTrend");

        grp.MapGet("/customer-concentration/csv",
            async (string? period, NeeDbContext db, CancellationToken ct) =>
        {
            var (fromDate, toDate, periodKey) = ResolvePeriod(period);

            var perCustomer = await db.RepairOrders
                .Where(r => r.CreatedAt >= fromDate && r.CreatedAt < toDate && r.Status != "CANCELLED")
                .GroupBy(r => new { r.Customer.Code, r.Customer.Name })
                .Select(g => new
                {
                    Code  = g.Key.Code,
                    Name  = g.Key.Name,
                    Count = g.Count(),
                    Hours = g.SelectMany(r => r.Tasks).Sum(t => t.ActualHours),
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
            async (NeeDbContext db, CancellationToken ct) =>
        {
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

            // Capacity heatmap: hours scheduled per (stationId, weekStart) for the next 4 weeks
            var weekStarts = Enumerable.Range(0, 4)
                .Select(i => IsoWeekStart(DateTimeOffset.UtcNow).AddDays(7 * i))
                .ToList();

            var capacityRaw = await db.JobTasks
                .Where(t => t.RepairOrder.ScheduledStartWeek != null
                         && t.RepairOrder.ScheduledStartWeek >= weekStarts.First()
                         && t.RepairOrder.ScheduledStartWeek <= weekStarts.Last()
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
            var stationOvercommit = capacityRaw
                .GroupBy(c => new { c.StationId, c.Week })
                .Where(g => g.Sum(x => x.EstimatedHours) > weeklyCapacity)
                .GroupBy(g => g.Key.StationId)
                .ToDictionary(
                    g => g.Key,
                    g => g.Count()  // number of weeks the station is overcommitted
                );

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

                // Capacity overcommit
                int capacityScore = 0;
                short? bottleneckId = null;
                string? bottleneckName = null;
                if (r.Stations.Count > 0)
                {
                    var overWeeks = r.Stations
                        .Select(sid => new { sid, w = stationOvercommit.GetValueOrDefault(sid, 0) })
                        .Where(x => x.w > 0)
                        .ToList();
                    if (overWeeks.Count > 0)
                    {
                        var maxOver = overWeeks.OrderByDescending(x => x.w).First();
                        bottleneckId = maxOver.sid;
                        bottleneckName = stationNames.GetValueOrDefault(maxOver.sid);
                        var totalOverWeeks = overWeeks.Sum(x => x.w);
                        capacityScore = (int)Math.Min(FORECAST_FACTOR_CAPACITY,
                            FORECAST_FACTOR_CAPACITY * totalOverWeeks / 4);
                        if (capacityScore > 0)
                            factors.Add(new {
                                key = "capacity_overcommit",
                                weight = capacityScore,
                                description = $"{bottleneckName ?? "Station " + bottleneckId} overcommitted in {totalOverWeeks} of next 4 weeks",
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

            return Results.Ok(new
            {
                ComputedAt = DateTimeOffset.UtcNow,
                Rows = rows,
            });
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

    private static string Esc(string? s) =>
        s is null ? "" : (s.Contains(',') || s.Contains('"'))
            ? "\"" + s.Replace("\"", "\"\"") + "\""
            : s;
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
