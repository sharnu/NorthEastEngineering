using Microsoft.AspNetCore.SignalR;

namespace Nee.Api.Hubs;

// Server-push only hub: the server sends "KanbanUpdated" to all connected
// clients when an RO's stage changes; clients never invoke methods on this hub.
public class KanbanHub : Hub { }
