using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain.Events;

namespace Nee.Api.Endpoints;

public static class KanbanEndpoints
{
    public static void MapKanbanEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/kanban").RequireAuthorization().WithTags("Kanban");

        // GET /api/kanban[?stationId=20]
        grp.MapGet("/", async (short? stationId, NeeDbContext db, CancellationToken ct) =>
        {
            var excludedStatuses = new[] { "COMPLETED", "CANCELLED" };

            // Load stations ordered by sort_order, filtered if stationId provided
            var stationsQuery = db.Stations
                .Where(s => s.IsActive);
            if (stationId.HasValue)
                stationsQuery = stationsQuery.Where(s => s.Id == stationId.Value);

            var stations = await stationsQuery
                .OrderBy(s => s.SortOrder)
                .Select(s => new
                {
                    s.Id,
                    s.Code,
                    s.Name,
                    OwnerName = s.OwnerUser != null ? s.OwnerUser.FullName : null,
                })
                .ToListAsync(ct);

            // Load all relevant tasks in one query, group in memory
            var stationIds = stations.Select(s => s.Id).ToList();

            var tasks = await db.JobTasks
                .Where(t => stationIds.Contains(t.StationId)
                         && !excludedStatuses.Contains(t.Status))
                .Select(t => new
                {
                    t.Id,
                    t.RoId,
                    RoNumber        = t.RepairOrder.RoNumber,
                    t.Sequence,
                    t.JobCodeLine,
                    t.OperationName,
                    t.StationId,
                    StationName     = t.Station.Name,
                    t.AssignedToUserId,
                    AssignedToName  = t.AssignedToUser != null ? t.AssignedToUser.FullName : null,
                    t.EstimatedHours,
                    t.ActualHours,
                    t.Status,
                    Priority        = (int)t.RepairOrder.Priority,
                    CustomerName    = t.RepairOrder.Customer.Name,
                    t.RepairOrder.RequiredDate,
                    t.Notes,
                })
                .ToListAsync(ct);

            var tasksByStation = tasks
                .GroupBy(t => t.StationId)
                .ToDictionary(g => g.Key, g => g
                    .OrderBy(t => t.Priority)
                    .ThenBy(t => t.RequiredDate == null ? 1 : 0)
                    .ThenBy(t => t.RequiredDate)
                    .ThenBy(t => t.Sequence)
                    .ToList());

            // Fetch override markers for all ROs present on the board
            var boardRoIds = tasks.Select(t => t.RoId).Distinct().ToList();
            var overrideStates = await db.RoKanbanStates
                .Where(s => boardRoIds.Contains(s.RoId) && s.LastOverrideAt != null)
                .Select(s => new { s.RoId, s.LastOverrideAt, s.LastOverrideReason, s.LastOverrideBy })
                .ToListAsync(ct);

            var overrideUserIds = overrideStates
                .Where(s => s.LastOverrideBy.HasValue)
                .Select(s => s.LastOverrideBy!.Value)
                .Distinct()
                .ToList();
            var overrideUsers = overrideUserIds.Count > 0
                ? await db.Users
                    .Where(u => overrideUserIds.Contains(u.Id))
                    .ToDictionaryAsync(u => u.Id, u => u.FullName, ct)
                : new Dictionary<Guid, string>();

            var overrideByRo = overrideStates.ToDictionary(
                s => s.RoId,
                s => new
                {
                    s.LastOverrideAt,
                    s.LastOverrideReason,
                    OverrideByName = s.LastOverrideBy.HasValue && overrideUsers.TryGetValue(s.LastOverrideBy.Value, out var n) ? n : null,
                });

            var result = new
            {
                Stations = stations.Select(s => new
                {
                    StationId   = s.Id,
                    StationCode = s.Code,
                    StationName = s.Name,
                    s.OwnerName,
                    Tasks = tasksByStation.TryGetValue(s.Id, out var stTasks)
                        ? stTasks.Select(t =>
                        {
                            overrideByRo.TryGetValue(t.RoId, out var ov);
                            return new
                            {
                                t.Id,
                                t.RoId,
                                t.RoNumber,
                                t.Sequence,
                                t.JobCodeLine,
                                t.OperationName,
                                t.AssignedToUserId,
                                t.AssignedToName,
                                t.EstimatedHours,
                                t.ActualHours,
                                t.Status,
                                t.Priority,
                                t.CustomerName,
                                t.RequiredDate,
                                t.StationId,
                                t.StationName,
                                t.Notes,
                                HasManualOverride = ov != null,
                                OverrideAt        = ov?.LastOverrideAt,
                                OverrideReason    = ov?.LastOverrideReason,
                                OverrideByName    = ov?.OverrideByName,
                            };
                        })
                        : [],
                }),
            };

            return Results.Ok(result);
        }).WithName("GetKanbanBoard");

        // GET /api/kanban/stages — list all stages for the override-stage form
        grp.MapGet("/stages", async (NeeDbContext db, CancellationToken ct) =>
        {
            var stages = await db.KanbanStages
                .OrderBy(s => s.SortOrder)
                .Select(s => new { s.Id, s.Code, s.Name, s.IsTerminal })
                .ToListAsync(ct);
            return Results.Ok(stages);
        }).WithName("GetKanbanStages");

        // POST /api/kanban/ros/{id}/override-stage (E14-S4)
        grp.MapPost("/ros/{id:guid}/override-stage", async (
            Guid id,
            OverrideStageRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Reason) || req.Reason.Trim().Length < 10)
                return Results.UnprocessableEntity(new { message = "Reason must be at least 10 characters." });

            var ro = await db.RepairOrders.FindAsync(new object[] { id }, ct);
            if (ro is null) return Results.NotFound();
            if (ro.Status is "COMPLETED" or "CANCELLED")
                return Results.Conflict(new { message = "Cannot override stage on a completed or cancelled repair order." });

            var targetStage = await db.KanbanStages.FindAsync(new object[] { req.StageId }, ct);
            if (targetStage is null)
                return Results.UnprocessableEntity(new { message = "Stage not found." });

            var state = await db.RoKanbanStates.FirstOrDefaultAsync(s => s.RoId == id, ct);
            short fromStageId = 0;
            if (state is null)
            {
                state = new Nee.Api.Domain.RoKanbanState
                {
                    RoId             = id,
                    CurrentStageId   = req.StageId,
                    EnteredStageAt   = DateTimeOffset.UtcNow,
                    UpdatedAt        = DateTimeOffset.UtcNow,
                };
                db.RoKanbanStates.Add(state);
            }
            else
            {
                fromStageId            = state.CurrentStageId;
                state.CurrentStageId   = req.StageId;
                state.EnteredStageAt   = DateTimeOffset.UtcNow;
                state.UpdatedAt        = DateTimeOffset.UtcNow;
            }

            var userId = GetKanbanCallerId(principal);

            // Store marker so the board can show the ⚠ badge without querying domain_events
            state.LastOverrideAt     = DateTimeOffset.UtcNow;
            state.LastOverrideReason = req.Reason.Trim();
            state.LastOverrideBy     = userId;

            RoLifecycleEvents.EmitKanbanStageOverride(db, id, userId, fromStageId, req.StageId, req.Reason.Trim());

            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "ADMIN"))
        .WithName("OverrideKanbanStage");
    }

    private static Guid? GetKanbanCallerId(ClaimsPrincipal p)
    {
        var sub = p.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub);
        return Guid.TryParse(sub, out var g) ? g : null;
    }
}

public record OverrideStageRequest(short StageId, string Reason);
