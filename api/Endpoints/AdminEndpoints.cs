using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain;

namespace Nee.Api.Endpoints;

// ── Request / Response DTOs ────────────────────────────────────────────────

public record AdminUserSummary(
    Guid Id,
    string Username,
    string FullName,
    string? Email,
    string? ShortCode,
    bool IsActive,
    string[] Roles,
    string[] Stations);

public record UserListResponse(AdminUserSummary[] Items, int TotalCount, int Page, int PageSize);

public record CreateUserRequest(
    string Username,
    string FullName,
    string? Email,
    string? ShortCode,
    string Password,
    short[] RoleIds);

public record UpdateUserRequest(
    string FullName,
    string? Email,
    string? ShortCode,
    short[] RoleIds);

public record ResetPasswordRequest(string NewPassword);

public record AddTechnicianRequest(Guid UserId, bool IsPrimary);

public record ChangeOwnerRequest(Guid? UserId);

public record ActivityResponse(
    ActivityEvent[] Events,
    ActivityCounts Counts);

public record ActivityEvent(string EventType, string Description, DateTimeOffset OccurredAt);

public record ActivityCounts(int TasksCompleted, int RosCreated, DateTimeOffset? LastLoginAt);

public record UserStationAssignment(int StationId, string StationName, bool IsPrimary);

// ──────────────────────────────────────────────────────────────────────────

public static class AdminEndpoints
{
    public static void MapAdminEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/admin")
            .RequireAuthorization(pb => pb.RequireRole("ADMIN"))
            .WithTags("Admin");

        // ── E11-S1: Ping ────────────────────────────────────────────────────

        grp.MapGet("/ping", () => Results.Ok(new { message = "ok" }))
           .WithName("AdminPing");

        // ── E11-S2: List & search users ─────────────────────────────────────

        grp.MapGet("/users", async (
                string? q,
                string? role,
                bool? active,
                int? stationId,
                int page,
                int pageSize,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                page     = Math.Max(1, page);
                pageSize = Math.Clamp(pageSize, 1, 100);

                var query = db.Users.AsQueryable();

                if (!string.IsNullOrWhiteSpace(q))
                {
                    var lower = q.ToLower();
                    query = query.Where(u =>
                        u.Username.ToLower().Contains(lower) ||
                        u.FullName.ToLower().Contains(lower) ||
                        (u.Email != null && u.Email.ToLower().Contains(lower)));
                }

                if (!string.IsNullOrWhiteSpace(role))
                    query = query.Where(u => u.UserRoles.Any(ur => ur.Role.Code == role));

                if (active.HasValue)
                    query = query.Where(u => u.IsActive == active.Value);

                // Station filter: User has no StationTechnicians nav-property, so pre-materialise
                // the matching user IDs and apply Contains — avoids cross-DbSet lambda translation.
                if (stationId.HasValue)
                {
                    var stId = (short)stationId.Value;
                    var userIdsInStation = await db.StationTechnicians
                        .Where(st => st.StationId == stId)
                        .Select(st => st.UserId)
                        .ToListAsync(ct);
                    query = query.Where(u => userIdsInStation.Contains(u.Id));
                }

                var total = await query.CountAsync(ct);

                // Load flat user data (no Include — avoids Npgsql type-resolution issue with joined tables)
                var users = await query
                    .OrderBy(u => u.FullName)
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .Select(u => new { u.Id, u.Username, u.FullName, u.Email, u.ShortCode, u.IsActive })
                    .ToListAsync(ct);

                var userIds = users.Select(u => u.Id).ToList();

                // Roles — explicit join avoids navigation-property type-resolution issues
                var roleRows = await (
                    from ur in db.UserRoles
                    join r in db.Roles on ur.RoleId equals r.Id
                    where userIds.Contains(ur.UserId)
                    select new { ur.UserId, r.Code }
                ).ToListAsync(ct);
                var rolesByUser = roleRows
                    .GroupBy(x => x.UserId)
                    .ToDictionary(g => g.Key, g => g.Select(x => x.Code).ToArray());

                // Stations — explicit join
                var stationRows = await (
                    from st in db.StationTechnicians
                    join s in db.Stations on st.StationId equals s.Id
                    where userIds.Contains(st.UserId)
                    select new { st.UserId, s.Name }
                ).ToListAsync(ct);
                var stationsByUser = stationRows
                    .GroupBy(x => x.UserId)
                    .ToDictionary(g => g.Key, g => g.Select(x => x.Name).ToArray());

                var items = users.Select(u => new AdminUserSummary(
                    u.Id, u.Username, u.FullName, u.Email, u.ShortCode, u.IsActive,
                    rolesByUser.TryGetValue(u.Id, out var r) ? r : Array.Empty<string>(),
                    stationsByUser.TryGetValue(u.Id, out var s) ? s : Array.Empty<string>()))
                    .ToArray();

                return Results.Ok(new UserListResponse(items, total, page, pageSize));
            })
            .WithName("AdminListUsers");

        // GET /api/admin/users/{id}
        grp.MapGet("/users/{id:guid}", async (Guid id, NeeDbContext db, CancellationToken ct) =>
            {
                var u = await db.Users.FindAsync(new object[] { id }, ct);
                if (u is null) return Results.NotFound();

                var roles = await db.UserRoles
                    .Where(ur => ur.UserId == id)
                    .Select(ur => ur.Role.Code)
                    .ToListAsync(ct);

                var stations = await db.StationTechnicians
                    .Where(st => st.UserId == id)
                    .Select(st => st.Station.Name)
                    .ToListAsync(ct);

                return Results.Ok(new AdminUserSummary(
                    u.Id, u.Username, u.FullName, u.Email, u.ShortCode, u.IsActive,
                    roles.ToArray(),
                    stations.ToArray()));
            })
            .WithName("AdminGetUser");

        // GET /api/admin/users/{id}/stations
        grp.MapGet("/users/{id:guid}/stations", async (Guid id, NeeDbContext db, CancellationToken ct) =>
            {
                if (!await db.Users.AnyAsync(u => u.Id == id, ct))
                    return Results.NotFound();

                var assignments = await (
                    from st in db.StationTechnicians
                    join s in db.Stations on st.StationId equals s.Id
                    where st.UserId == id
                    select new UserStationAssignment((int)st.StationId, s.Name, st.IsPrimary)
                ).ToListAsync(ct);

                return Results.Ok(assignments);
            })
            .WithName("AdminGetUserStations");

        // ── E11-S3: Create / edit user + password reset ─────────────────────

        grp.MapPost("/users", async (
                CreateUserRequest req,
                ClaimsPrincipal principal,
                NeeDbContext db,
                IPasswordHasher<User> hasher,
                CancellationToken ct) =>
            {
                if (await db.Users.AnyAsync(u => u.Username == req.Username, ct))
                    return Results.Conflict(new { message = "Username already exists." });

                var user = new User
                {
                    Id        = Guid.NewGuid(),
                    Username  = req.Username.Trim(),
                    FullName  = req.FullName.Trim(),
                    Email     = string.IsNullOrWhiteSpace(req.Email) ? null : req.Email.Trim(),
                    ShortCode = string.IsNullOrWhiteSpace(req.ShortCode) ? null : req.ShortCode.Trim(),
                    IsActive  = true,
                    CreatedAt = DateTimeOffset.UtcNow,
                    UpdatedAt = DateTimeOffset.UtcNow,
                };
                user.PasswordHash = hasher.HashPassword(user, req.Password);
                db.Users.Add(user);

                foreach (var roleId in req.RoleIds)
                    db.UserRoles.Add(new UserRole { UserId = user.Id, RoleId = roleId });

                await db.DomainEvents.AddAsync(new DomainEvent
                {
                    EventType     = "UserCreated",
                    AggregateType = "User",
                    AggregateId   = user.Id,
                    Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new { req.Username, req.FullName })),
                    UserId        = GetCallerId(principal),
                    OccurredAt    = DateTimeOffset.UtcNow,
                }, ct);

                await db.SaveChangesAsync(ct);
                return Results.Created($"/api/admin/users/{user.Id}", new { id = user.Id });
            })
            .WithName("AdminCreateUser");

        grp.MapPut("/users/{id:guid}", async (
                Guid id,
                UpdateUserRequest req,
                ClaimsPrincipal principal,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                var user = await db.Users
                    .Include(u => u.UserRoles)
                    .FirstOrDefaultAsync(u => u.Id == id, ct);
                if (user is null) return Results.NotFound();

                user.FullName  = req.FullName.Trim();
                user.Email     = string.IsNullOrWhiteSpace(req.Email) ? null : req.Email.Trim();
                user.ShortCode = string.IsNullOrWhiteSpace(req.ShortCode) ? null : req.ShortCode.Trim();
                user.UpdatedAt = DateTimeOffset.UtcNow;

                // Replace roles
                db.UserRoles.RemoveRange(user.UserRoles);
                foreach (var roleId in req.RoleIds)
                    db.UserRoles.Add(new UserRole { UserId = id, RoleId = roleId });

                await db.DomainEvents.AddAsync(new DomainEvent
                {
                    EventType     = "UserUpdated",
                    AggregateType = "User",
                    AggregateId   = id,
                    Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new { req.FullName })),
                    UserId        = GetCallerId(principal),
                    OccurredAt    = DateTimeOffset.UtcNow,
                }, ct);

                await db.SaveChangesAsync(ct);
                return Results.NoContent();
            })
            .WithName("AdminUpdateUser");

        grp.MapPost("/users/{id:guid}/reset-password", async (
                Guid id,
                ResetPasswordRequest req,
                ClaimsPrincipal principal,
                NeeDbContext db,
                IPasswordHasher<User> hasher,
                CancellationToken ct) =>
            {
                var user = await db.Users.FindAsync(new object[] { id }, ct);
                if (user is null) return Results.NotFound();

                user.PasswordHash     = hasher.HashPassword(user, req.NewPassword);
                user.PasswordChangedAt = DateTimeOffset.UtcNow;
                user.UpdatedAt        = DateTimeOffset.UtcNow;

                await db.DomainEvents.AddAsync(new DomainEvent
                {
                    EventType     = "PasswordReset",
                    AggregateType = "User",
                    AggregateId   = id,
                    Payload       = JsonDocument.Parse("{}"),
                    UserId        = GetCallerId(principal),
                    OccurredAt    = DateTimeOffset.UtcNow,
                }, ct);

                await db.SaveChangesAsync(ct);
                return Results.NoContent();
            })
            .WithName("AdminResetPassword");

        grp.MapPost("/users/{id:guid}/deactivate", async (
                Guid id,
                ClaimsPrincipal principal,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                var user = await db.Users
                    .Include(u => u.UserRoles)
                    .FirstOrDefaultAsync(u => u.Id == id, ct);
                if (user is null) return Results.NotFound();

                // Guard: cannot deactivate the last ADMIN
                if (user.UserRoles.Any(ur => ur.RoleId == 1))
                {
                    var adminCount = await db.UserRoles
                        .CountAsync(ur => ur.RoleId == 1 && ur.User.IsActive, ct);
                    if (adminCount <= 1)
                        return Results.UnprocessableEntity(new { message = "Cannot deactivate the last admin." });
                }

                user.IsActive  = false;
                user.UpdatedAt = DateTimeOffset.UtcNow;

                await db.DomainEvents.AddAsync(new DomainEvent
                {
                    EventType     = "UserDeactivated",
                    AggregateType = "User",
                    AggregateId   = id,
                    Payload       = JsonDocument.Parse("{}"),
                    UserId        = GetCallerId(principal),
                    OccurredAt    = DateTimeOffset.UtcNow,
                }, ct);

                await db.SaveChangesAsync(ct);
                return Results.NoContent();
            })
            .WithName("AdminDeactivateUser");

        grp.MapPost("/users/{id:guid}/activate", async (
                Guid id,
                ClaimsPrincipal principal,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                var user = await db.Users.FindAsync(new object[] { id }, ct);
                if (user is null) return Results.NotFound();

                user.IsActive  = true;
                user.UpdatedAt = DateTimeOffset.UtcNow;

                await db.DomainEvents.AddAsync(new DomainEvent
                {
                    EventType     = "UserActivated",
                    AggregateType = "User",
                    AggregateId   = id,
                    Payload       = JsonDocument.Parse("{}"),
                    UserId        = GetCallerId(principal),
                    OccurredAt    = DateTimeOffset.UtcNow,
                }, ct);

                await db.SaveChangesAsync(ct);
                return Results.NoContent();
            })
            .WithName("AdminActivateUser");

        // ── E11-S4: Station roster management ───────────────────────────────

        grp.MapPost("/stations/{stationId:int}/technicians", async (
                int stationId,
                AddTechnicianRequest req,
                ClaimsPrincipal principal,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                var existing = await db.StationTechnicians
                    .FirstOrDefaultAsync(st => st.StationId == stationId && st.UserId == req.UserId, ct);

                if (existing is not null)
                {
                    existing.IsPrimary = req.IsPrimary;
                }
                else
                {
                    db.StationTechnicians.Add(new StationTechnician
                    {
                        StationId = (short)stationId,
                        UserId    = req.UserId,
                        IsPrimary = req.IsPrimary,
                    });
                }

                await db.DomainEvents.AddAsync(new DomainEvent
                {
                    EventType     = "TechnicianRostered",
                    AggregateType = "Station",
                    AggregateId   = new Guid($"00000000-0000-0000-0000-{stationId:D12}"),
                    Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new { req.UserId, req.IsPrimary })),
                    UserId        = GetCallerId(principal),
                    OccurredAt    = DateTimeOffset.UtcNow,
                }, ct);

                await db.SaveChangesAsync(ct);
                return Results.NoContent();
            })
            .WithName("AdminAddTechnician");

        grp.MapDelete("/stations/{stationId:int}/technicians/{userId:guid}", async (
                int stationId,
                Guid userId,
                ClaimsPrincipal principal,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                var row = await db.StationTechnicians
                    .FirstOrDefaultAsync(st => st.StationId == stationId && st.UserId == userId, ct);
                if (row is null) return Results.NotFound();

                db.StationTechnicians.Remove(row);

                await db.DomainEvents.AddAsync(new DomainEvent
                {
                    EventType     = "TechnicianUnrostered",
                    AggregateType = "Station",
                    AggregateId   = new Guid($"00000000-0000-0000-0000-{stationId:D12}"),
                    Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new { UserId = userId })),
                    UserId        = GetCallerId(principal),
                    OccurredAt    = DateTimeOffset.UtcNow,
                }, ct);

                await db.SaveChangesAsync(ct);
                return Results.NoContent();
            })
            .WithName("AdminRemoveTechnician");

        grp.MapPut("/stations/{stationId:int}/owner", async (
                int stationId,
                ChangeOwnerRequest req,
                ClaimsPrincipal principal,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                var station = await db.Stations.FindAsync(new object[] { (short)stationId }, ct);
                if (station is null) return Results.NotFound();

                station.OwnerUserId = req.UserId;

                await db.DomainEvents.AddAsync(new DomainEvent
                {
                    EventType     = "StationOwnerChanged",
                    AggregateType = "Station",
                    AggregateId   = new Guid($"00000000-0000-0000-0000-{stationId:D12}"),
                    Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new { req.UserId })),
                    UserId        = GetCallerId(principal),
                    OccurredAt    = DateTimeOffset.UtcNow,
                }, ct);

                await db.SaveChangesAsync(ct);
                return Results.NoContent();
            })
            .WithName("AdminChangeStationOwner");

        // ── E11-S5: User activity timeline ──────────────────────────────────

        grp.MapGet("/users/{id:guid}/activity", async (
                Guid id,
                int days,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                days = Math.Clamp(days <= 0 ? 30 : days, 1, 365);
                var since = DateTimeOffset.UtcNow.AddDays(-days);

                var user = await db.Users.FindAsync(new object[] { id }, ct);
                if (user is null) return Results.NotFound();

                var events = await db.DomainEvents
                    .Where(e => e.AggregateId == id && e.AggregateType == "User" && e.OccurredAt >= since)
                    .OrderByDescending(e => e.OccurredAt)
                    .Take(50)
                    .Select(e => new ActivityEvent(e.EventType, e.EventType, e.OccurredAt))
                    .ToListAsync(ct);

                var tasksCompleted = await db.JobTasks
                    .CountAsync(t => t.AssignedToUserId == id && t.Status == "complete" && t.UpdatedAt >= since, ct);

                var rosCreated = await db.RepairOrders
                    .CountAsync(r => r.CreatedBy == id && r.CreatedAt >= since, ct);

                return Results.Ok(new ActivityResponse(
                    events.ToArray(),
                    new ActivityCounts(tasksCompleted, rosCreated, user.LastLoginAt)));
            })
            .WithName("AdminUserActivity");

        // ── Chassis inventory list ──────────────────────────────────────────
        grp.MapGet("/chassis", async (
                string? status, string? q,
                NeeDbContext db, CancellationToken ct) =>
            {
                var query = db.ChassisInventory.AsQueryable();

                if (!string.IsNullOrWhiteSpace(status))
                    query = query.Where(c => c.Status == status);

                if (!string.IsNullOrWhiteSpace(q))
                    query = query.Where(c =>
                        EF.Functions.ILike(c.ChassisNumber, $"%{q}%") ||
                        EF.Functions.ILike(c.Description,   $"%{q}%") ||
                        (c.BodyType   != null && EF.Functions.ILike(c.BodyType,   $"%{q}%")) ||
                        (c.Colour     != null && EF.Functions.ILike(c.Colour,     $"%{q}%")) ||
                        (c.TagNumber  != null && EF.Functions.ILike(c.TagNumber,  $"%{q}%")));

                var rows = await query
                    .OrderBy(c => c.Status)
                    .ThenBy(c => c.ChassisNumber)
                    .Select(c => new {
                        c.Id, c.ChassisNumber, c.Description, c.ChassisClass,
                        c.Status, c.BodyType, c.Colour, c.TagNumber,
                        c.ArrivalDate, c.AllocatedToRo, c.LastSeenAt,
                        c.Notes, c.CreatedAt,
                    })
                    .ToListAsync(ct);

                return Results.Ok(rows);
            })
            .WithName("ListChassisInventory");
    }

    private static Guid? GetCallerId(ClaimsPrincipal p)
    {
        var sub = p.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub);
        return Guid.TryParse(sub, out var g) ? g : null;
    }
}
