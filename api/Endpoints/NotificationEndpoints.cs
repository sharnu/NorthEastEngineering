using System.Security.Claims;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;

namespace Nee.Api.Endpoints;

public static class NotificationEndpoints
{
    public static void MapNotificationEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/notifications").RequireAuthorization().WithTags("Notifications");

        // GET /api/notifications
        grp.MapGet("/", async (ClaimsPrincipal principal, NeeDbContext db, CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            var items = await db.Notifications
                .Where(n => n.UserId == userId)
                .OrderBy(n => n.IsRead)
                .ThenByDescending(n => n.CreatedAt)
                .Take(50)
                .Select(n => new
                {
                    n.Id, n.EventType, n.Title, n.Body,
                    n.EntityType, n.EntityId, n.IsRead, n.CreatedAt,
                })
                .ToListAsync(ct);
            return Results.Ok(items);
        });

        // GET /api/notifications/unread-count
        grp.MapGet("/unread-count", async (ClaimsPrincipal principal, NeeDbContext db, CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            var count  = await db.Notifications
                .CountAsync(n => n.UserId == userId && !n.IsRead, ct);
            return Results.Ok(new { count });
        });

        // POST /api/notifications/{id}/read
        grp.MapPost("/{id:guid}/read", async (Guid id, ClaimsPrincipal principal, NeeDbContext db, CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            var notif  = await db.Notifications
                .FirstOrDefaultAsync(n => n.Id == id && n.UserId == userId, ct);
            if (notif is null) return Results.NotFound();
            notif.IsRead = true;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        });

        // POST /api/notifications/read-all
        grp.MapPost("/read-all", async (ClaimsPrincipal principal, NeeDbContext db, CancellationToken ct) =>
        {
            var userId = GetUserId(principal);
            await db.Database.ExecuteSqlRawAsync(
                "UPDATE notifications SET is_read = TRUE WHERE user_id = {0} AND is_read = FALSE",
                userId);
            return Results.NoContent();
        });
    }

    private static Guid GetUserId(ClaimsPrincipal principal)
    {
        var sub = principal.FindFirstValue(ClaimTypes.NameIdentifier)
               ?? principal.FindFirstValue("sub")
               ?? throw new InvalidOperationException("No sub claim.");
        return Guid.Parse(sub);
    }
}
