using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;

namespace Nee.Api.Services;

public class GateEvaluator : IGateEvaluator
{
    private readonly NeeDbContext _db;

    public GateEvaluator(NeeDbContext db) => _db = db;

    public async Task<GateResult> Evaluate(Guid roId, short stationId, CancellationToken ct)
    {
        var ro = await _db.RepairOrders.FindAsync([roId], ct);
        if (ro is null || ro.BodyType is null)
            return await EvaluateHereOnly(roId, stationId, ct);

        // Flow entries for this station (one per track that passes through it)
        var thisStationFlows = await _db.FlowDefinitions
            .Where(fd => fd.BodyType == ro.BodyType && fd.StationId == stationId)
            .ToListAsync(ct);

        if (thisStationFlows.Count == 0)
            return await EvaluateHereOnly(roId, stationId, ct);

        // Batch-load all flow entries for all tracks at this station, to avoid per-track queries
        var tracksHere = thisStationFlows.Select(f => f.Track).ToList();
        var allFlowsForTracks = await _db.FlowDefinitions
            .Where(fd => fd.BodyType == ro.BodyType && tracksHere.Contains(fd.Track))
            .ToListAsync(ct);

        // For each track at this station, verify all upstream tasks are COMPLETED
        foreach (var flow in thisStationFlows)
        {
            var upstreamStationIds = allFlowsForTracks
                .Where(fd => fd.Track == flow.Track && fd.SortOrder < flow.SortOrder)
                .Select(fd => fd.StationId)
                .ToList();

            if (upstreamStationIds.Count == 0) continue;

            var firstIncomplete = await _db.JobTasks
                .Where(t => t.RoId == roId
                         && upstreamStationIds.Contains(t.StationId)
                         && t.FlowTrack == flow.Track
                         && t.Status != "COMPLETED"
                         && t.Status != "CANCELLED")
                .Select(t => new { t.OperationName, StationName = t.Station.Name })
                .FirstOrDefaultAsync(ct);

            if (firstIncomplete is not null)
            {
                return new GateResult("GATED",
                    $"{flow.Track} track at {firstIncomplete.StationName} not complete ({firstIncomplete.OperationName} pending)");
            }
        }

        return await EvaluateHereOnly(roId, stationId, ct);
    }

    private async Task<GateResult> EvaluateHereOnly(Guid roId, short stationId, CancellationToken ct)
    {
        var statuses = await _db.JobTasks
            .Where(t => t.RoId == roId && t.StationId == stationId)
            .Select(t => t.Status)
            .ToListAsync(ct);

        if (statuses.Count == 0) return new GateResult("READY", null);
        if (statuses.All(s => s == "COMPLETED" || s == "CANCELLED")) return new GateResult("COMPLETE", null);
        if (statuses.Any(s => s == "IN_PROGRESS" || s == "PAUSED")) return new GateResult("IN_PROGRESS", null);
        return new GateResult("READY", null);
    }
}
