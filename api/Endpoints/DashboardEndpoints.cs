using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;

namespace Nee.Api.Endpoints;

public static class DashboardEndpoints
{
    public static void MapDashboardEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/dashboard").RequireAuthorization().WithTags("Dashboard");

        // GET /api/dashboard/kpis
        grp.MapGet("/kpis", async (NeeDbContext db, CancellationToken ct) =>
        {
            var activeStatuses = new[] { "APPROVED", "IN_PROGRESS", "ON_HOLD" };

            var activeRoIds = await db.RepairOrders
                .Where(r => activeStatuses.Contains(r.Status))
                .Select(r => r.Id)
                .ToListAsync(ct);

            var activeRos = activeRoIds.Count;

            var taskStats = await db.JobTasks
                .Where(t => activeRoIds.Contains(t.RoId))
                .GroupBy(_ => 1)
                .Select(g => new
                {
                    HoursScheduled = g.Sum(t => t.EstimatedHours),
                    HoursUtilised = g.Sum(t => t.ActualHours),
                })
                .FirstOrDefaultAsync(ct);

            var hoursScheduled = taskStats?.HoursScheduled ?? 0m;
            var hoursUtilised = taskStats?.HoursUtilised ?? 0m;

            // Spec: utilisationPct = actual/estimated for IN_PROGRESS tasks only
            var inProgressStats = await db.JobTasks
                .Where(t => activeRoIds.Contains(t.RoId) && t.Status == "IN_PROGRESS")
                .GroupBy(_ => 1)
                .Select(g => new
                {
                    Estimated = g.Sum(t => t.EstimatedHours),
                    Actual    = g.Sum(t => t.ActualHours),
                })
                .FirstOrDefaultAsync(ct);

            var utilisationPct = (inProgressStats?.Estimated ?? 0m) > 0
                ? Math.Round((inProgressStats!.Actual / inProgressStats.Estimated) * 100, 1)
                : 0m;

            var inHospitalCount = await db.RoKanbanStates
                .Join(db.KanbanStages, s => s.CurrentStageId, k => k.Id, (s, k) => new { s, k })
                .CountAsync(x => x.k.Code == "HOSPITAL", ct);

            var overdueCount = await db.RepairOrders
                .CountAsync(r => activeStatuses.Contains(r.Status)
                    && r.RequiredDate.HasValue
                    && r.RequiredDate.Value <= DateTimeOffset.UtcNow, ct);

            var onTimePct = activeRos > 0
                ? Math.Round((activeRos - overdueCount) / (double)activeRos * 100, 1)
                : 100.0;

            return Results.Ok(new
            {
                ActiveRos = activeRos,
                HoursScheduled = hoursScheduled,
                HoursUtilised = hoursUtilised,
                UtilisationPct = utilisationPct,
                InHospitalCount = inHospitalCount,
                OnTimePct = onTimePct,
                OverdueCount = overdueCount,
            });
        }).WithName("GetDashboardKpis");

        // GET /api/dashboard/station-load
        grp.MapGet("/station-load", async (NeeDbContext db, CancellationToken ct) =>
        {
            var rows = await db.Database
                .SqlQueryRaw<StationLoadDto>("SELECT * FROM v_station_load")
                .ToListAsync(ct);

            return Results.Ok(rows);
        }).WithName("GetStationLoad");

        // GET /api/dashboard/top-variance
        grp.MapGet("/top-variance", async (NeeDbContext db, CancellationToken ct) =>
        {
            var since = DateTimeOffset.UtcNow.AddDays(-7);

            var rows = await db.VarianceRecords
                .Where(v => v.RecordedAt >= since)
                .OrderByDescending(v => v.DeltaHours)
                .Take(5)
                .Select(v => new
                {
                    TaskId = v.TaskId,
                    RoNumber = v.Task.RepairOrder.RoNumber,
                    OperationName = v.Task.OperationName,
                    StationName = v.Task.Station.Name,
                    EstimatedHours = v.EstimatedHours,
                    ActualHours = v.ActualHours,
                    DeltaHours = v.DeltaHours,
                    DeltaPct = v.DeltaPercent,
                    ReasonName = v.Reason.Name,
                    TechnicianName = v.Task.AssignedToUser != null ? v.Task.AssignedToUser.FullName : null,
                })
                .ToListAsync(ct);

            return Results.Ok(rows);
        }).WithName("GetTopVariance");

        // GET /api/dashboard/job-types  (for filter dropdowns)
        grp.MapGet("/job-types", async (NeeDbContext db, CancellationToken ct) =>
        {
            var types = await db.JobTypes
                .Where(jt => jt.IsActive)
                .OrderBy(jt => jt.Name)
                .Select(jt => new { jt.Id, jt.Name })
                .ToListAsync(ct);
            return Results.Ok(types);
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "ADMIN"))
        .WithName("GetDashboardJobTypes");

        // GET /api/dashboard/archive
        grp.MapGet("/archive", async (
            string? search, DateOnly? from, DateOnly? to, short? jobTypeId,
            string? sortBy, string? sortDir,
            int page, int pageSize,
            NeeDbContext db, CancellationToken ct) =>
        {
            page     = Math.Max(page, 1);
            pageSize = Math.Clamp(pageSize, 1, 200);

            var roQuery = db.RepairOrders.Where(r => r.Status == "COMPLETED");

            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLower();
                roQuery = roQuery.Where(r =>
                    r.RoNumber.ToLower().Contains(s) ||
                    (r.Rego            != null && r.Rego.ToLower().Contains(s)) ||
                    (r.SourceRoNumber  != null && r.SourceRoNumber.ToLower().Contains(s)) ||
                    r.Customer.Name.ToLower().Contains(s));
            }

            if (jobTypeId.HasValue)
                roQuery = roQuery.Where(r => r.JobTypeId == jobTypeId.Value);

            var joined = from r in roQuery
                         join ks in db.RoKanbanStates on r.Id equals ks.RoId
                         select new
                         {
                             r.Id,
                             r.RoNumber,
                             r.SourceRoNumber,
                             r.Rego,
                             CustomerName = r.Customer.Name,
                             JobTypeName  = r.JobType.Name,
                             r.BodyType,
                             r.RoDate,
                             CompletedAt  = ks.EnteredStageAt,
                         };

            if (from.HasValue)
            {
                var fromDt = new DateTimeOffset(from.Value.Year, from.Value.Month, from.Value.Day,
                                                 0, 0, 0, TimeSpan.Zero);
                joined = joined.Where(x => x.CompletedAt >= fromDt);
            }
            if (to.HasValue)
            {
                var toDt = new DateTimeOffset(to.Value.Year, to.Value.Month, to.Value.Day,
                                               23, 59, 59, TimeSpan.Zero);
                joined = joined.Where(x => x.CompletedAt <= toDt);
            }

            var totalCount = await joined.CountAsync(ct);

            var desc = sortDir?.ToLower() != "asc";
            var sorted = sortBy switch
            {
                "roNumber"     => desc ? joined.OrderByDescending(x => x.RoNumber)     : joined.OrderBy(x => x.RoNumber),
                "rego"         => desc ? joined.OrderByDescending(x => x.Rego)         : joined.OrderBy(x => x.Rego),
                "customerName" => desc ? joined.OrderByDescending(x => x.CustomerName) : joined.OrderBy(x => x.CustomerName),
                "roDate"       => desc ? joined.OrderByDescending(x => x.RoDate)       : joined.OrderBy(x => x.RoDate),
                _              => joined.OrderByDescending(x => x.CompletedAt),
            };

            var pageRows = await sorted
                .Skip((page - 1) * pageSize)
                .Take(pageSize)
                .ToListAsync(ct);

            var rowIds = pageRows.Select(x => x.Id).ToList();

            var hoursByRo = await db.JobTasks
                .Where(t => rowIds.Contains(t.RoId))
                .GroupBy(t => t.RoId)
                .Select(g => new
                {
                    RoId           = g.Key,
                    EstimatedHours = g.Sum(t => t.EstimatedHours),
                    ActualHours    = g.Sum(t => t.ActualHours),
                })
                .ToDictionaryAsync(x => x.RoId, ct);

            var rows = pageRows.Select(r => new
            {
                r.Id,
                r.RoNumber,
                r.SourceRoNumber,
                r.Rego,
                r.CustomerName,
                r.JobTypeName,
                r.BodyType,
                r.RoDate,
                r.CompletedAt,
                EstimatedHours = hoursByRo.TryGetValue(r.Id, out var h) ? h.EstimatedHours : 0m,
                ActualHours    = hoursByRo.TryGetValue(r.Id, out var h2) ? h2.ActualHours   : 0m,
            });

            return Results.Ok(new { TotalCount = totalCount, Page = page, PageSize = pageSize, Rows = rows });
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "ADMIN"))
        .WithName("GetArchivedRos");

        // GET /api/dashboard/active-ros
        grp.MapGet("/active-ros", async (string? status, Guid? customerId, NeeDbContext db, CancellationToken ct) =>
        {
            var excluded = new[] { "COMPLETED", "CANCELLED" };

            var query = db.RepairOrders
                .Include(r => r.Customer)
                .Include(r => r.Template).ThenInclude(t => t.BodyType)
                .Include(r => r.Tasks)
                .Where(r => !excluded.Contains(r.Status));

            if (!string.IsNullOrWhiteSpace(status))
                query = query.Where(r => r.Status == status.ToUpper());

            if (customerId.HasValue)
                query = query.Where(r => r.CustomerId == customerId.Value);

            var ros = await query
                .OrderBy(r => r.Priority)
                .ThenBy(r => r.RequiredDate == null ? 1 : 0)
                .ThenBy(r => r.RequiredDate)
                .ToListAsync(ct);

            // Load kanban stage names separately to avoid multiple-collection warning
            var roIds = ros.Select(r => r.Id).ToList();
            var stages = await db.RoKanbanStates
                .Where(s => roIds.Contains(s.RoId))
                .Join(db.KanbanStages, s => s.CurrentStageId, k => k.Id, (s, k) => new { s.RoId, k.Name })
                .ToDictionaryAsync(x => x.RoId, x => x.Name, ct);

            var result = ros.Select(r =>
            {
                var taskCount = r.Tasks.Count;
                var tasksCompleted = r.Tasks.Count(t => t.Status == "COMPLETED");
                var hoursScheduled = r.Tasks.Sum(t => t.EstimatedHours);
                var hoursUtilised = r.Tasks.Sum(t => t.ActualHours);
                var completionPct = taskCount > 0
                    ? Math.Round((decimal)tasksCompleted / taskCount * 100, 1)
                    : 0m;

                return new
                {
                    r.Id,
                    r.RoNumber,
                    CustomerName = r.Customer.Name,
                    r.TemplateCode,
                    BodyType = r.Template.BodyType.Name,
                    CurrentStage = stages.TryGetValue(r.Id, out var s) ? s : null,
                    r.Status,
                    r.Priority,
                    r.RequiredDate,
                    HoursScheduled = hoursScheduled,
                    HoursUtilised = hoursUtilised,
                    TaskCount = taskCount,
                    TasksCompleted = tasksCompleted,
                    CompletionPct = completionPct,
                };
            });

            return Results.Ok(result);
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "ADMIN"))
        .WithName("GetActiveRos");
    }
}

// EF Core keyless entity for the v_station_load view
public class StationLoadDto
{
    public short StationId { get; set; }
    public string StationCode { get; set; } = string.Empty;
    public string StationName { get; set; } = string.Empty;
    public string? OwnerName { get; set; }
    public int OpenTasks { get; set; }
    public int ActiveTasks { get; set; }
    public decimal? HoursRemaining { get; set; }
}
