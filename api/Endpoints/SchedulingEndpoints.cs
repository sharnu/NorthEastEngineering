using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Caching.Memory;
using Nee.Api.Data;
using Nee.Api.Domain;

namespace Nee.Api.Endpoints;

public static class SchedulingEndpoints
{
    public static void MapSchedulingEndpoints(this WebApplication app)
    {
        var sched = app.MapGroup("/api/scheduling").RequireAuthorization().WithTags("Scheduling");

        // GET /api/scheduling/backlog
        sched.MapGet("/backlog", async (NeeDbContext db, CancellationToken ct) =>
        {
            var rows = await db.RepairOrders
                .Where(r => r.Status != "COMPLETED" && r.Status != "CANCELLED")
                .Select(r => new
                {
                    r.Id,
                    r.RoNumber,
                    r.Rego,
                    r.SourceRoNumber,
                    r.Status,
                    JobTypeName = r.JobType != null ? r.JobType.Name : null,
                    BodyType = r.Template.BodyType.Name,
                    CustomerName = r.Customer.Name,
                    r.TemplateCode,
                    r.Priority,
                    r.RequiredDate,
                    r.ScheduledStartWeek,
                    TotalEstimatedHours = r.Tasks.Sum(t => t.EstimatedHours),
                    DraftingComplete = r.DraftingStatus == "COMPLETED",
                    CustomerApproved = db.CustomerApprovals.Any(a => a.RoId == r.Id && a.SignedAt != null),
                    ChassisAllocated = db.ChassisInventory.Any(c => c.AllocatedToRo == r.Id && c.Status == "ALLOCATED"),
                })
                .ToListAsync(ct);

            var result = rows
                .Select(r =>
                {
                    var allGreen = r.DraftingComplete && r.CustomerApproved && r.ChassisAllocated;
                    return new
                    {
                        roId = r.Id,
                        roNumber = r.RoNumber,
                        rego = r.Rego,
                        sourceRoNumber = r.SourceRoNumber,
                        status = r.Status,
                        jobTypeName = r.JobTypeName,
                        bodyType = r.BodyType,
                        customerName = r.CustomerName,
                        templateCode = r.TemplateCode,
                        priority = r.Priority,
                        requiredDate = r.RequiredDate,
                        scheduledStartWeek = r.ScheduledStartWeek,
                        totalEstimatedHours = r.TotalEstimatedHours,
                        gates = new
                        {
                            draftingComplete = r.DraftingComplete,
                            customerApproved = r.CustomerApproved,
                            chassisAllocated = r.ChassisAllocated,
                            allGreen,
                        },
                    };
                })
                .OrderByDescending(r => r.gates.allGreen)
                .ThenBy(r => r.priority)
                .ThenBy(r => r.requiredDate ?? DateTimeOffset.MaxValue)
                .ToList();

            return Results.Ok(result);
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "STATION_OWNER"))
        .WithName("GetSchedulingBacklog");

        // GET /api/scheduling/chassis?available=true
        sched.MapGet("/chassis", async (bool? available, NeeDbContext db, CancellationToken ct) =>
        {
            var query = db.ChassisInventory.AsQueryable();
            if (available == true)
                query = query.Where(c => c.Status == "AVAILABLE");

            var chassis = await query
                .OrderBy(c => c.ChassisNumber)
                .Select(c => new
                {
                    id = c.Id,
                    chassisNumber = c.ChassisNumber,
                    description = c.Description,
                    chassisClass = c.ChassisClass,
                    status = c.Status,
                })
                .ToListAsync(ct);

            return Results.Ok(chassis);
        })
        .RequireAuthorization()
        .WithName("GetChassis");

        // POST /api/scheduling/ros/{roId}/approve
        sched.MapPost("/ros/{roId:guid}/approve", async (
            Guid roId,
            ApproveRoRequest req,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var ro = await db.RepairOrders.FindAsync([roId], ct);
            if (ro is null)
                return Results.NotFound(new { message = "Repair order not found." });

            db.CustomerApprovals.Add(new CustomerApproval
            {
                Id = Guid.NewGuid(),
                RoId = roId,
                DocumentType = "LAYOUT",
                SignedAt = DateTimeOffset.UtcNow,
                SignedByName = req.SignedByName,
                Notes = req.Notes,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync(ct);

            return Results.Created($"/api/scheduling/ros/{roId}/approve", new { roId });
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "STATION_OWNER"))
        .WithName("ApproveRo");

        // POST /api/scheduling/chassis/{chassisId}/allocate
        sched.MapPost("/chassis/{chassisId:guid}/allocate", async (
            Guid chassisId,
            AllocateChassisRequest req,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var chassis = await db.ChassisInventory.FindAsync([chassisId], ct);
            if (chassis is null)
                return Results.NotFound(new { message = "Chassis not found." });

            if (chassis.Status != "AVAILABLE")
                return Results.Conflict(new { message = "Chassis already allocated." });

            chassis.Status = "ALLOCATED";
            chassis.AllocatedToRo = req.RoId;
            chassis.AllocatedAt = DateTimeOffset.UtcNow;
            chassis.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);

            return Results.Ok(new { chassisId, roId = req.RoId });
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "STATION_OWNER"))
        .WithName("AllocateChassis");

        // GET /api/scheduling/capacity?weeks=4
        sched.MapGet("/capacity", async (int? weeks, NeeDbContext db, CancellationToken ct) =>
        {
            var weeksCount = weeks is > 0 ? weeks.Value : 4;
            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var daysToMonday = ((int)DayOfWeek.Monday - (int)today.DayOfWeek + 7) % 7;
            var firstWeek = today.AddDays(daysToMonday);
            var weekList = Enumerable.Range(0, weeksCount)
                .Select(i => firstWeek.AddDays(i * 7))
                .ToList();

            var stations = await db.Stations.OrderBy(s => s.Name).ToListAsync(ct);

            var lastWeek = weekList[weekList.Count - 1];
            var tasks = await db.JobTasks
                .Where(t => t.RepairOrder.ScheduledStartWeek != null
                            && t.RepairOrder.ScheduledStartWeek >= weekList[0]
                            && t.RepairOrder.ScheduledStartWeek <= lastWeek
                            && t.RepairOrder.Status != "COMPLETED"
                            && t.RepairOrder.Status != "CANCELLED")
                .Select(t => new
                {
                    t.StationId,
                    WeekStart = t.RepairOrder.ScheduledStartWeek!.Value,
                    t.EstimatedHours,
                })
                .ToListAsync(ct);

            const decimal capacityHours = 40m;

            var stationDtos = stations.Select(s =>
            {
                var weeklyHours = weekList
                    .Select(w => tasks
                        .Where(t => t.StationId == s.Id && t.WeekStart == w)
                        .Sum(t => t.EstimatedHours))
                    .ToArray();
                var weeklyCapacityPct = weeklyHours
                    .Select(h => Math.Round(h / capacityHours * 100, 1))
                    .ToArray();
                return new
                {
                    stationId = s.Id,
                    stationName = s.Name,
                    weeklyHours,
                    weeklyCapacityPct,
                };
            }).ToList();

            return Results.Ok(new { weeks = weekList, stations = stationDtos });
        })
        .RequireAuthorization()
        .WithName("GetCapacity");

        // PUT /api/scheduling/ros/{roId}/schedule
        sched.MapPut("/ros/{roId:guid}/schedule", async (
            Guid roId,
            ScheduleRoRequest req,
            NeeDbContext db,
            IMemoryCache cache,
            ClaimsPrincipal user,
            CancellationToken ct) =>
        {
            if (!DateOnly.TryParse(req.StartWeek, out var startWeek))
                return Results.BadRequest(new { message = "Invalid date format. Use yyyy-MM-dd." });

            if (startWeek.DayOfWeek != DayOfWeek.Monday)
                return Results.BadRequest(new { message = "Start week must be a Monday." });

            var today = DateOnly.FromDateTime(DateTime.UtcNow.Date);
            if (startWeek < today)
                return Results.BadRequest(new { message = "Start week cannot be in the past." });

            var ro = await db.RepairOrders.FindAsync([roId], ct);
            if (ro is null)
                return Results.NotFound(new { message = "Repair order not found." });

            if (ro.Status is "COMPLETED" or "CANCELLED")
                return Results.BadRequest(new { message = "Cannot schedule a completed or cancelled repair order." });

            ro.ScheduledStartWeek = startWeek;
            ro.UpdatedAt = DateTimeOffset.UtcNow;

            var userIdStr = user.FindFirstValue("sub") ?? user.FindFirstValue(ClaimTypes.NameIdentifier);
            Guid? userId = Guid.TryParse(userIdStr, out var uid) ? uid : null;

            var payload = JsonSerializer.SerializeToDocument(new
            {
                roId,
                roNumber = ro.RoNumber,
                startWeek = req.StartWeek,
            });
            db.DomainEvents.Add(new DomainEvent
            {
                EventType = "RoScheduled",
                AggregateType = "RepairOrder",
                AggregateId = roId,
                Payload = payload,
                UserId = userId,
                OccurredAt = DateTimeOffset.UtcNow,
            });

            await db.SaveChangesAsync(ct);
            // Forecast depends on scheduled_start_week for capacity, projection,
            // and risk score — drop the cache so the next /forecast hit recomputes.
            ReportsEndpoints.InvalidateForecastCache(cache);
            return Results.Ok(new { roId, scheduledStartWeek = startWeek });
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "STATION_OWNER"))
        .WithName("ScheduleRo");

        // GET /api/scheduling/ros/{id}/chassis-suggestions (E28-S1)
        sched.MapGet("/ros/{id:guid}/chassis-suggestions", async (
            Guid id,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var ro = await db.RepairOrders
                .Where(r => r.Id == id)
                .Select(r => new { r.Id, r.BodyType, r.Colour, r.ChassisTag, r.RequiredDate })
                .FirstOrDefaultAsync(ct);

            if (ro is null) return Results.NotFound();

            var candidates = await db.ChassisInventory
                .Where(c => c.Status == "AVAILABLE"
                         && (c.BodyType == null || c.BodyType == ro.BodyType))
                .OrderBy(c => c.ArrivalDate)
                .Select(c => new { c.Id, c.ChassisNumber, c.BodyType, c.Colour, c.TagNumber, c.ArrivalDate })
                .ToListAsync(ct);

            var requiredDateOnly = ro.RequiredDate.HasValue
                ? DateOnly.FromDateTime(ro.RequiredDate.Value.UtcDateTime)
                : (DateOnly?)null;

            var scored = candidates
                .Select(c =>
                {
                    var tag       = ro.ChassisTag != null && c.TagNumber == ro.ChassisTag ? 100 : 0;
                    var colour    = string.Equals(c.Colour, ro.Colour, StringComparison.OrdinalIgnoreCase) ? 50 : 0;
                    var proximity = c.ArrivalDate.HasValue && requiredDateOnly.HasValue
                        ? Math.Max(0, 30 - Math.Abs(c.ArrivalDate.Value.DayNumber - requiredDateOnly.Value.DayNumber))
                        : 0;
                    var score     = tag + colour + proximity;
                    return new ChassisSuggestionDto(
                        ChassisId:      c.Id,
                        ChassisNumber:  c.ChassisNumber,
                        BodyType:       c.BodyType,
                        Colour:         c.Colour,
                        TagNumber:      c.TagNumber,
                        ArrivalDate:    c.ArrivalDate,
                        Score:          score,
                        ScoreBreakdown: new ScoreBreakdownDto(tag, colour, proximity),
                        Reason:         BuildSuggestionReason(tag, colour, proximity, c.ArrivalDate, requiredDateOnly));
                })
                .OrderByDescending(x => x.Score)
                .ThenBy(x => x.ArrivalDate)
                .Take(3)
                .ToList();

            return Results.Ok(new
            {
                RoId         = ro.Id,
                RoBodyType   = ro.BodyType,
                RoColour     = ro.Colour,
                RoChassisTag = ro.ChassisTag,
                RoRequiredDate = ro.RequiredDate,
                Candidates   = scored,
            });
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "ADMIN"))
        .WithName("GetChassisSuggestions");
    }

    private static string BuildSuggestionReason(int tag, int colour, int proximity,
        DateOnly? arrivalDate, DateOnly? requiredDate)
    {
        var parts = new List<string>();
        if (tag == 100) parts.Add("exact tag match");
        if (colour == 50) parts.Add("colour match");
        if (proximity > 0 && arrivalDate.HasValue && requiredDate.HasValue)
        {
            var diff = arrivalDate.Value.DayNumber - requiredDate.Value.DayNumber;
            parts.Add(diff <= 0
                ? $"arrives {Math.Abs(diff)} day{(Math.Abs(diff) == 1 ? "" : "s")} before required date"
                : $"arrives {diff} day{(diff == 1 ? "" : "s")} after required date");
        }
        if (parts.Count == 0) return "Available chassis, no specific match";
        var first = char.ToUpper(parts[0][0]) + parts[0][1..];
        return parts.Count == 1 ? first : first + ", " + string.Join(", ", parts.Skip(1));
    }
}

public record ApproveRoRequest(string SignedByName, string? Notes);
public record AllocateChassisRequest(Guid RoId);
public record ScheduleRoRequest(string StartWeek);
public record ChassisSuggestionDto(
    Guid ChassisId,
    string ChassisNumber,
    string? BodyType,
    string? Colour,
    string? TagNumber,
    DateOnly? ArrivalDate,
    int Score,
    ScoreBreakdownDto ScoreBreakdown,
    string Reason);
public record ScoreBreakdownDto(int Tag, int Colour, int Proximity);
