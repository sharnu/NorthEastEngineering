using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Nee.Api.Data;
using Nee.Api.Domain;

namespace Nee.Api.Endpoints;

public record LoginRequest(string Username, string Password);

public record LoginResponse(string Token, UserInfo User);

public record UserInfo(Guid Id, string Username, string FullName, string? Email, string[] Roles);

public static class AuthEndpoints
{
    public static void MapAuthEndpoints(this WebApplication app, string secret, string issuer, string audience)
    {
        var auth = app.MapGroup("/api/auth").WithTags("Auth");

        // POST /api/auth/login
        auth.MapPost("/login", async (
                LoginRequest req,
                NeeDbContext db,
                IPasswordHasher<User> hasher,
                CancellationToken ct) =>
            {
                if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
                {
                    return Results.Json(new { message = "Invalid username or password" }, statusCode: 401);
                }

                var user = await db.Users
                    .Include(u => u.UserRoles).ThenInclude(ur => ur.Role)
                    .FirstOrDefaultAsync(u => u.Username == req.Username && u.IsActive, ct);

                if (user is null)
                {
                    return Results.Json(new { message = "Invalid username or password" }, statusCode: 401);
                }

                var verify = hasher.VerifyHashedPassword(user, user.PasswordHash, req.Password);
                if (verify == PasswordVerificationResult.Failed)
                {
                    user.FailedLoginCount++;
                    await db.SaveChangesAsync(ct);
                    return Results.Json(new { message = "Invalid username or password" }, statusCode: 401);
                }

                user.LastLoginAt = DateTimeOffset.UtcNow;
                user.FailedLoginCount = 0;
                await db.SaveChangesAsync(ct);

                var roles = user.UserRoles.Select(ur => ur.Role.Code).ToArray();
                var token = BuildToken(user, roles, secret, issuer, audience);
                var info = new UserInfo(user.Id, user.Username, user.FullName, user.Email, roles);

                return Results.Ok(new LoginResponse(token, info));
            })
            .RequireRateLimiting("login")
            .WithName("Login");

        // GET /api/auth/me - useful for verifying the token works end-to-end
        auth.MapGet("/me", [Authorize] async (
                ClaimsPrincipal principal,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                var idStr = principal.FindFirstValue(JwtRegisteredClaimNames.Sub);
                if (!Guid.TryParse(idStr, out var id))
                {
                    return Results.Unauthorized();
                }

                var user = await db.Users
                    .Include(u => u.UserRoles).ThenInclude(ur => ur.Role)
                    .FirstOrDefaultAsync(u => u.Id == id, ct);

                if (user is null) return Results.Unauthorized();

                var roles = user.UserRoles.Select(ur => ur.Role.Code).ToArray();
                return Results.Ok(new UserInfo(user.Id, user.Username, user.FullName, user.Email, roles));
            })
            .WithName("Me");
    }

    private static string BuildToken(User user, string[] roles, string secret, string issuer, string audience)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, user.Id.ToString()),
            new(JwtRegisteredClaimNames.UniqueName, user.Username),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
            new("name", user.FullName),
        };

        if (!string.IsNullOrEmpty(user.Email))
        {
            claims.Add(new Claim(JwtRegisteredClaimNames.Email, user.Email));
        }

        foreach (var role in roles)
        {
            claims.Add(new Claim(ClaimTypes.Role, role));
        }

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(secret));
        var creds = new SigningCredentials(key, SecurityAlgorithms.HmacSha256);

        var token = new JwtSecurityToken(
            issuer: issuer,
            audience: audience,
            claims: claims,
            notBefore: DateTime.UtcNow,
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: creds);

        return new JwtSecurityTokenHandler().WriteToken(token);
    }
}
