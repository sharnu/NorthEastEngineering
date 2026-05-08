using Microsoft.AspNetCore.SignalR;

namespace Nee.Api.Hubs;

// Server-push only hub: the server sends "KanbanUpdated" and "KanbanCardUpdated"
// to all connected clients; clients never invoke methods on this hub.
public class KanbanHub : Hub { }

public static class KanbanHubExtensions
{
    public static Task NotifyCardUpdated(this IHubContext<KanbanHub> hub, Guid roId, short stationId) =>
        hub.Clients.All.SendAsync("KanbanCardUpdated", new { roId, stationId });
}
