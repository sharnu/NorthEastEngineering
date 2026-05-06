using Microsoft.AspNetCore.Diagnostics.HealthChecks;
using Microsoft.Extensions.Diagnostics.HealthChecks;
using System.Text.Json;

namespace Nee.Api.Endpoints;

public static class HealthEndpoints
{
    public static void MapHealthEndpoints(this WebApplication app)
    {
        // /api/health is the liveness check - just confirms the process is up
        app.MapGet("/api/health", () => new
        {
            status = "ok",
            version = "0.1.0",
            timestamp = DateTimeOffset.UtcNow,
        }).WithName("Health").WithTags("Health");

        // /api/health/ready confirms downstream dependencies (Postgres) are reachable
        app.MapHealthChecks("/api/health/ready", new()
        {
            Predicate = check => check.Tags.Contains("ready"),
            ResponseWriter = WriteHealthResponseAsync,
        }).WithName("HealthReady").WithTags("Health");
    }

    private static Task WriteHealthResponseAsync(HttpContext context, HealthReport report)
    {
        context.Response.ContentType = "application/json";
        var payload = new
        {
            status = report.Status.ToString().ToLower(),
            checks = report.Entries.Select(e => new
            {
                name = e.Key,
                status = e.Value.Status.ToString().ToLower(),
                description = e.Value.Description,
                duration_ms = e.Value.Duration.TotalMilliseconds,
            }),
            total_duration_ms = report.TotalDuration.TotalMilliseconds,
        };
        return context.Response.WriteAsync(JsonSerializer.Serialize(payload));
    }
}
