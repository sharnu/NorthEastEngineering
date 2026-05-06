using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain;

namespace Nee.Api.Services;

public interface INotificationService
{
    Task FanOutAsync(DomainEvent evt, CancellationToken ct = default);
}

public class NotificationService(NeeDbContext db) : INotificationService
{
    public async Task FanOutAsync(DomainEvent evt, CancellationToken ct = default)
    {
        var recipientIds = await ResolveRecipientsAsync(evt, ct);
        if (recipientIds.Count == 0) return;

        var (title, body, entityType, entityId) = BuildContent(evt);

        var now = DateTimeOffset.UtcNow;
        foreach (var userId in recipientIds)
        {
            db.Notifications.Add(new Notification
            {
                UserId     = userId,
                EventType  = evt.EventType,
                Title      = title,
                Body       = body,
                EntityType = entityType,
                EntityId   = entityId,
                IsRead     = false,
                CreatedAt  = now,
            });
        }

        await db.SaveChangesAsync(ct);
    }

    private async Task<List<Guid>> ResolveRecipientsAsync(DomainEvent evt, CancellationToken ct)
    {
        var ids = new HashSet<Guid>();

        switch (evt.EventType)
        {
            case "RoCreated":
                ids.UnionWith(await UsersInRoles(["SUPERVISOR", "STATION_OWNER"], ct));
                break;

            case "TaskCompleted":
            case "TaskBlocked":
            {
                ids.UnionWith(await UsersInRoles(["SUPERVISOR"], ct));
                var stationId = evt.Payload.RootElement.TryGetProperty("stationId", out var sid)
                    ? sid.GetInt16() : (short)0;
                if (stationId > 0)
                {
                    var ownerId = await db.Stations
                        .Where(s => s.Id == stationId && s.OwnerUserId != null)
                        .Select(s => s.OwnerUserId)
                        .FirstOrDefaultAsync(ct);
                    if (ownerId.HasValue) ids.Add(ownerId.Value);
                }
                break;
            }

            case "DraftingStatusChanged":
            {
                var toStatus = evt.Payload.RootElement.TryGetProperty("toStatus", out var ts)
                    ? ts.GetString() : null;
                if (toStatus == "COMPLETED")
                    ids.UnionWith(await UsersInRoles(["SUPERVISOR"], ct));
                break;
            }

            case "QcPassed":
                ids.UnionWith(await UsersInRoles(["SUPERVISOR", "SALES"], ct));
                break;
        }

        // Never notify the user who triggered the event
        if (evt.UserId.HasValue) ids.Remove(evt.UserId.Value);

        return [.. ids];
    }

    private async Task<List<Guid>> UsersInRoles(string[] roleCodes, CancellationToken ct)
        => await db.UserRoles
            .Where(ur => roleCodes.Contains(ur.Role.Code) && ur.User.IsActive)
            .Select(ur => ur.UserId)
            .Distinct()
            .ToListAsync(ct);

    private static (string Title, string Body, string? EntityType, Guid? EntityId) BuildContent(DomainEvent evt)
    {
        var p = evt.Payload.RootElement;

        string Get(string key) => p.TryGetProperty(key, out var v) ? v.GetString() ?? "" : "";
        Guid? GetGuid(string key) => p.TryGetProperty(key, out var v)
            && Guid.TryParse(v.GetString(), out var g) ? g : null;

        return evt.EventType switch
        {
            "RoCreated" => (
                $"New RO: {Get("roNumber")}",
                $"{Get("customerName")} — {Get("templateCode")}",
                "RepairOrder",
                GetGuid("roId")),

            "TaskCompleted" => (
                $"Task complete: {Get("operationName")}",
                $"RO {Get("roNumber")} · {Get("stationName")}",
                "JobTask",
                GetGuid("taskId")),

            "TaskBlocked" => (
                $"BLOCKED: {Get("operationName")}",
                $"RO {Get("roNumber")} — {Get("reason")}",
                "JobTask",
                GetGuid("taskId")),

            "QcPassed" => (
                $"RO complete: {Get("roNumber")}",
                $"QC passed — email sent to {Get("emailTo")}",
                "RepairOrder",
                GetGuid("roId")),

            "DraftingStatusChanged" => (
                $"Drafting complete: {Get("roNumber")}",
                $"Ready to schedule — drafting marked complete",
                "RepairOrder",
                GetGuid("roId")),

            _ => (evt.EventType, "", null, null),
        };
    }
}
