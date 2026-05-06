using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain;

namespace Nee.Api.Endpoints;

public static class JobTaskEndpoints
{
    public static void MapJobTaskEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/job-tasks").RequireAuthorization().WithTags("JobTasks");

        // PUT /api/job-tasks/{id}/assign
        grp.MapPut("/{id:guid}/assign", async (
            Guid id,
            AssignTaskRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var task = await db.JobTasks.FindAsync([id], ct);
            if (task is null) return Results.NotFound();

            if (req.UserId.HasValue)
            {
                // Validate technician is rostered to this station and their account is active
                var isRostered = await db.StationTechnicians
                    .AnyAsync(st => st.StationId == task.StationId
                                 && st.UserId == req.UserId.Value
                                 && st.User.IsActive, ct);

                if (!isRostered)
                    return Results.BadRequest(new { message = "User is not a technician rostered to this station." });

                var assignedBy = Guid.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)
                    ?? principal.FindFirstValue("sub")!);

                task.AssignedToUserId = req.UserId;
                task.AssignedByUserId = assignedBy;
                task.AssignedAt = DateTimeOffset.UtcNow;

                if (task.Status == "PENDING")
                    task.Status = "ASSIGNED";

                db.DomainEvents.Add(new DomainEvent
                {
                    EventType     = "TaskAssigned",
                    AggregateType = "JobTask",
                    AggregateId   = task.Id,
                    Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new
                    {
                        taskId           = task.Id,
                        roId             = task.RoId,
                        assignedToUserId = req.UserId,
                        assignedByUserId = assignedBy,
                    })),
                    UserId = assignedBy,
                });
            }
            else
            {
                // Unassign
                task.AssignedToUserId = null;
                task.AssignedByUserId = null;
                task.AssignedAt = null;
                if (task.Status == "ASSIGNED")
                    task.Status = "PENDING";
            }

            task.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "STATION_OWNER"))
        .WithName("AssignTask");
    }
}

public record AssignTaskRequest(Guid? UserId);
