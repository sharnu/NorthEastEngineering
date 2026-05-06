using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain;

namespace Nee.Api.Endpoints;

/// <summary>
/// Dev-only endpoints. Mounted only when ASPNETCORE_ENVIRONMENT=Development.
/// </summary>
public static class DevEndpoints
{
    public static void MapDevEndpoints(this WebApplication app)
    {
        if (!app.Environment.IsDevelopment()) return;

        var dev = app.MapGroup("/api/dev").WithTags("Dev");

        // POST /api/dev/reseed-passwords
        // Re-hash the seeded users' passwords with the real PasswordHasher.
        // The migrations file uses a placeholder hash because we can't generate
        // a real one inside SQL. Run this once after `make seed`.
        dev.MapPost("/reseed-passwords", async (
                NeeDbContext db,
                IPasswordHasher<User> hasher,
                CancellationToken ct) =>
            {
                const string defaultPw = "nee2026";
                var users = await db.Users.ToListAsync(ct);
                foreach (var u in users)
                {
                    u.PasswordHash = hasher.HashPassword(u, defaultPw);
                }
                var changed = await db.SaveChangesAsync(ct);
                return Results.Ok(new
                {
                    message = $"Re-hashed {changed} users with default password",
                    note = "Default password is 'nee2026'. Change before any non-dev use.",
                });
            }).WithName("ReseedPasswords");
    }
}
