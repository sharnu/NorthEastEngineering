using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain.Events;
using Nee.Api.Services;

namespace Nee.Api.Endpoints;

public static class KanbanEndpoints
{
    public static void MapKanbanEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/kanban").RequireAuthorization().WithTags("Kanban");

        // GET /api/kanban[?stationId=20]
        grp.MapGet("/", async (short? stationId, NeeDbContext db, IGateEvaluator gateEvaluator, CancellationToken ct) =>
        {
            var excludedStatuses = new[] { "COMPLETED", "CANCELLED" };

            var stationsQuery = db.Stations.Where(s => s.IsActive);
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

            var stationIds = stations.Select(s => s.Id).ToList();

            // Load all tasks for these stations (include completed for progress display)
            var tasks = await db.JobTasks
                .Where(t => stationIds.Contains(t.StationId))
                .Select(t => new
                {
                    t.Id,
                    t.RoId,
                    RoNumber     = t.RepairOrder.RoNumber,
                    t.Sequence,
                    t.JobCodeLine,
                    t.OperationName,
                    t.StationId,
                    t.FlowTrack,
                    t.AssignedToUserId,
                    AssignedToName = t.AssignedToUser != null ? t.AssignedToUser.FullName : null,
                    t.EstimatedHours,
                    t.ActualHours,
                    t.Status,
                    Priority     = (short)t.RepairOrder.Priority,
                    CustomerName = t.RepairOrder.Customer.Name,
                    BodyType     = t.RepairOrder.BodyType,
                    t.RepairOrder.RequiredDate,
                    t.Notes,
                })
                .ToListAsync(ct);

            // Group by (RoId, StationId); discard groups where every task is done
            var groups = tasks
                .GroupBy(t => new { t.RoId, t.StationId })
                .Where(g => g.Any(t => !excludedStatuses.Contains(t.Status)))
                .Select(g =>
                {
                    var ordered = g.OrderBy(t => t.Sequence).ToList();
                    var first   = ordered[0];
                    return new
                    {
                        RoId         = g.Key.RoId,
                        StationId    = g.Key.StationId,
                        Tasks        = ordered,
                        Priority     = first.Priority,
                        RequiredDate = first.RequiredDate,
                        RoNumber     = first.RoNumber,
                    };
                })
                .ToList();

            var boardRoIds = groups.Select(g => g.RoId).Distinct().ToList();

            // Override markers — only need the presence flag per RO
            var overrideRoIds = boardRoIds.Count > 0
                ? (await db.RoKanbanStates
                    .Where(s => boardRoIds.Contains(s.RoId) && s.LastOverrideAt != null)
                    .Select(s => s.RoId)
                    .ToListAsync(ct)).ToHashSet()
                : new HashSet<Guid>();

            // Source PDF attachments (one per RO, first wins on duplicates)
            var pdfByRo = boardRoIds.Count > 0
                ? (await db.Attachments
                    .Where(a => boardRoIds.Contains(a.EntityId)
                             && a.EntityType == "RepairOrder"
                             && a.Category   == "SOURCE_PDF")
                    .Select(a => new { a.EntityId, a.BlobPath })
                    .ToListAsync(ct))
                    .GroupBy(a => a.EntityId)
                    .ToDictionary(g => g.Key, g => $"/uploads/{g.First().BlobPath}")
                : new Dictionary<Guid, string>();

            // Evaluate gate state for each card (async, sequential to share one DbContext)
            var gateByGroup = new Dictionary<(Guid RoId, short StationId), GateResult>();
            foreach (var g in groups)
            {
                var sid = (short)g.StationId;
                gateByGroup[(g.RoId, sid)] = await gateEvaluator.Evaluate(g.RoId, sid, ct);
            }

            var result = new
            {
                Stations = stations.Select(s =>
                {
                    var cards = groups
                        .Where(g => g.StationId == s.Id)
                        .OrderBy(g => g.Priority)
                        .ThenBy(g => g.RequiredDate ?? DateTimeOffset.MaxValue)
                        .ThenBy(g => g.RoNumber)
                        .Select(g =>
                        {
                            var taskList = g.Tasks;
                            var first    = taskList[0];
                            var roId     = g.RoId;
                            var sid      = (short)g.StationId;

                            var tracks = taskList.Select(t => t.FlowTrack).Distinct().ToList();
                            var track  = tracks.Count == 1 ? tracks[0] : "MIXED";

                            var gate = gateByGroup.GetValueOrDefault((roId, sid), new GateResult("IN_PROGRESS", null));

                            pdfByRo.TryGetValue(roId, out var sourcePdfUrl);

                            return new KanbanCardDto(
                                RoId:             roId,
                                RoNumber:         first.RoNumber,
                                CustomerName:     first.CustomerName,
                                Priority:         first.Priority,
                                RequiredDate:     first.RequiredDate,
                                BodyType:         first.BodyType,
                                Track:            track,
                                StationId:        sid,
                                StationCode:      s.Code,
                                StationName:      s.Name,
                                GateState:        gate.State,
                                GateReason:       gate.Reason,
                                EstimatedHours:   taskList.Sum(t => t.EstimatedHours),
                                ActualHours:      taskList.Sum(t => t.ActualHours),
                                TotalTasks:       taskList.Count,
                                CompletedTasks:   taskList.Count(t => t.Status == "COMPLETED"),
                                SourcePdfUrl:     sourcePdfUrl,
                                HasManualOverride: overrideRoIds.Contains(roId),
                                Tasks: taskList.Select(t => new KanbanCardTaskDto(
                                    Id:              t.Id,
                                    Sequence:        t.Sequence,
                                    JobCodeLine:     t.JobCodeLine,
                                    OperationName:   t.OperationName,
                                    AssignedToUserId: t.AssignedToUserId,
                                    AssignedToName:  t.AssignedToName,
                                    EstimatedHours:  t.EstimatedHours,
                                    ActualHours:     t.ActualHours,
                                    Status:          t.Status,
                                    FlowTrack:       t.FlowTrack,
                                    Notes:           t.Notes
                                )).ToArray()
                            );
                        })
                        .ToArray();

                    return new
                    {
                        StationId   = s.Id,
                        StationCode = s.Code,
                        StationName = s.Name,
                        s.OwnerName,
                        Cards = cards,
                    };
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

        // POST /api/kanban/ros/{id}/force-advance (E24-S4 — renamed from override-stage)
        grp.MapPost("/ros/{id:guid}/force-advance", async (
            Guid id,
            ForceAdvanceRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            IGateEvaluator gateEvaluator,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Reason) || req.Reason.Trim().Length < 10)
                return Results.UnprocessableEntity(new { message = "Reason must be at least 10 characters." });

            var ro = await db.RepairOrders.FindAsync(new object[] { id }, ct);
            if (ro is null) return Results.NotFound();
            if (ro.Status is "COMPLETED" or "CANCELLED")
                return Results.Conflict(new { message = "Cannot advance a completed or cancelled repair order." });

            short targetStageId;

            if (req.StageId.HasValue)
            {
                // Direct stage override: supervisor chose a specific stage
                var targetStage = await db.KanbanStages.FindAsync(new object[] { req.StageId.Value }, ct);
                if (targetStage is null)
                    return Results.UnprocessableEntity(new { message = "Stage not found." });
                targetStageId = req.StageId.Value;
            }
            else if (req.StationId.HasValue)
            {
                // Compute next stage from current station via flow_definitions
                if (ro.BodyType is null)
                    return Results.UnprocessableEntity(new { message = "Repair order has no body type; cannot auto-compute next stage." });

                var currentFlow = await db.FlowDefinitions
                    .Where(fd => fd.BodyType == ro.BodyType && fd.StationId == req.StationId.Value)
                    .OrderBy(fd => fd.SortOrder)
                    .FirstOrDefaultAsync(ct);

                if (currentFlow is null)
                    return Results.UnprocessableEntity(new { message = "No flow definition found for this station and body type." });

                var nextFlow = await db.FlowDefinitions
                    .Where(fd => fd.BodyType == ro.BodyType
                              && fd.Track == currentFlow.Track
                              && fd.SortOrder > currentFlow.SortOrder)
                    .OrderBy(fd => fd.SortOrder)
                    .FirstOrDefaultAsync(ct);

                if (nextFlow is null)
                    return Results.UnprocessableEntity(new { message = "No next stage in flow; track ends at this station." });

                var nextSortOrder = await db.Stations
                    .Where(s => s.Id == nextFlow.StationId)
                    .Select(s => s.SortOrder)
                    .FirstAsync(ct);

                targetStageId = StationSortOrderToKanbanStage((int)nextSortOrder);
            }
            else
            {
                return Results.UnprocessableEntity(new { message = "Provide either stageId or stationId." });
            }

            var state = await db.RoKanbanStates.FirstOrDefaultAsync(s => s.RoId == id, ct);
            short fromStageId = 0;
            if (state is null)
            {
                state = new Nee.Api.Domain.RoKanbanState
                {
                    RoId           = id,
                    CurrentStageId = targetStageId,
                    EnteredStageAt = DateTimeOffset.UtcNow,
                    UpdatedAt      = DateTimeOffset.UtcNow,
                };
                db.RoKanbanStates.Add(state);
            }
            else
            {
                fromStageId          = state.CurrentStageId;
                state.CurrentStageId = targetStageId;
                state.EnteredStageAt = DateTimeOffset.UtcNow;
                state.UpdatedAt      = DateTimeOffset.UtcNow;
            }

            var userId = GetKanbanCallerId(principal);

            state.LastOverrideAt     = DateTimeOffset.UtcNow;
            state.LastOverrideReason = req.Reason.Trim();
            state.LastOverrideBy     = userId;

            RoLifecycleEvents.EmitRoStageForceAdvanced(db, id, userId, fromStageId, targetStageId, req.Reason.Trim());

            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "ADMIN"))
        .WithName("ForceAdvanceKanbanStage");

        // POST /api/kanban/ros/{id}/override-stage — backward-compat alias (remove in E26-S3)
        grp.MapPost("/ros/{id:guid}/override-stage", async (
            Guid id,
            OverrideStageRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            IGateEvaluator gateEvaluator,
            CancellationToken ct) =>
        {
            // Delegate to force-advance logic with the provided stageId
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
                    RoId           = id,
                    CurrentStageId = req.StageId,
                    EnteredStageAt = DateTimeOffset.UtcNow,
                    UpdatedAt      = DateTimeOffset.UtcNow,
                };
                db.RoKanbanStates.Add(state);
            }
            else
            {
                fromStageId          = state.CurrentStageId;
                state.CurrentStageId = req.StageId;
                state.EnteredStageAt = DateTimeOffset.UtcNow;
                state.UpdatedAt      = DateTimeOffset.UtcNow;
            }

            var userId = GetKanbanCallerId(principal);

            state.LastOverrideAt     = DateTimeOffset.UtcNow;
            state.LastOverrideReason = req.Reason.Trim();
            state.LastOverrideBy     = userId;

            RoLifecycleEvents.EmitRoStageForceAdvanced(db, id, userId, fromStageId, req.StageId, req.Reason.Trim());

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

    internal static short StationSortOrderToKanbanStage(int sortOrder) => sortOrder switch
    {
        <= 15 => 30,  // MAT_PROCESSING
        <= 25 => 40,  // FABRICATION
        <= 35 => 50,  // PAINTING
        <= 65 => 60,  // AFTER_PAINT_HY
        <= 75 => 70,  // FITOUT
        <= 82 => 80,  // BODY_MOUNTING
        <= 87 => 85,  // ACCESSORIES
        <= 93 => 90,  // FINAL_QC
        _     => 99,  // COMPLETE
    };
}

public record KanbanCardTaskDto(
    Guid Id,
    int Sequence,
    string JobCodeLine,
    string OperationName,
    Guid? AssignedToUserId,
    string? AssignedToName,
    decimal EstimatedHours,
    decimal ActualHours,
    string Status,
    string FlowTrack,
    string? Notes);

public record KanbanCardDto(
    Guid RoId,
    string RoNumber,
    string CustomerName,
    short Priority,
    DateTimeOffset? RequiredDate,
    string? BodyType,
    string Track,
    short StationId,
    string StationCode,
    string StationName,
    string GateState,
    string? GateReason,
    decimal EstimatedHours,
    decimal ActualHours,
    int TotalTasks,
    int CompletedTasks,
    string? SourcePdfUrl,
    bool HasManualOverride,
    KanbanCardTaskDto[] Tasks);

public record OverrideStageRequest(short StageId, string Reason);
public record ForceAdvanceRequest(string Reason, short? StageId = null, short? StationId = null);
