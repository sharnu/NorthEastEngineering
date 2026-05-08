using System.Text.Json;
using Nee.Api.Data;
using Nee.Api.Domain;

namespace Nee.Api.Domain.Events;

public static class RoLifecycleEvents
{
    public static void EmitRoFieldChanged(NeeDbContext db, Guid roId, Guid? userId, string field, string? before, string? after) =>
        Emit(db, "RoFieldChanged", roId, userId, new { field, before, after });

    public static void EmitRoTaskAdded(NeeDbContext db, Guid roId, Guid? userId, Guid taskId, short operationId, short stationId, short sequence) =>
        Emit(db, "RoTaskAdded", roId, userId, new { taskId, operationId, stationId, sequence });

    public static void EmitRoTaskRemoved(NeeDbContext db, Guid roId, Guid? userId, Guid taskId, short operationId) =>
        Emit(db, "RoTaskRemoved", roId, userId, new { taskId, operationId });

    public static void EmitRoTaskReordered(NeeDbContext db, Guid roId, Guid? userId, Guid[] before, Guid[] after) =>
        Emit(db, "RoTaskReordered", roId, userId, new { before, after });

    public static void EmitRoCancelled(NeeDbContext db, Guid roId, Guid? userId, string reason, Guid? releasedChassisId) =>
        Emit(db, "RoCancelled", roId, userId, new { reason, releasedChassisId });

    public static void EmitRoReopened(NeeDbContext db, Guid roId, Guid? userId) =>
        Emit(db, "RoReopened", roId, userId, new { });

    public static void EmitKanbanStageOverride(NeeDbContext db, Guid roId, Guid? userId, short fromStageId, short toStageId, string reason) =>
        Emit(db, "KanbanStageOverride", roId, userId, new { fromStageId, toStageId, reason });

    public static void EmitRoStageForceAdvanced(NeeDbContext db, Guid roId, Guid? userId, short fromStageId, short toStageId, string reason) =>
        Emit(db, "RoStageForceAdvanced", roId, userId, new { fromStageId, toStageId, reason });

    public static void EmitRoStageAutoAdvanced(NeeDbContext db, Guid roId, Guid? userId, short fromStationId, short toStationId, Guid triggeringTaskId) =>
        Emit(db, "RoStageAutoAdvanced", roId, userId, new { fromStationId, toStationId, reason = "auto", triggeringTaskId });

    public static void EmitRoTrackArrivedAtMerge(NeeDbContext db, Guid roId, Guid? userId, short mergeStationId, string arrivedTrack) =>
        Emit(db, "RoTrackArrivedAtMerge", roId, userId, new { mergeStationId, arrivedTrack });

    public static void EmitRoMergeReached(NeeDbContext db, Guid roId, Guid? userId, short mergeStationId, string[] completedTracks) =>
        Emit(db, "RoMergeReached", roId, userId, new { mergeStationId, completedTracks });

    private static void Emit(NeeDbContext db, string eventType, Guid roId, Guid? userId, object payload) =>
        db.DomainEvents.Add(new DomainEvent
        {
            EventType     = eventType,
            AggregateType = "RepairOrder",
            AggregateId   = roId,
            Payload       = JsonDocument.Parse(JsonSerializer.Serialize(payload)),
            UserId        = userId,
            OccurredAt    = DateTimeOffset.UtcNow,
        });
}
