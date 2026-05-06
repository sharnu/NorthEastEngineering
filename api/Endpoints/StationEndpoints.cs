using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;

namespace Nee.Api.Endpoints;

public static class StationEndpoints
{
    public static void MapStationEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/stations").RequireAuthorization().WithTags("Stations");

        // GET /api/stations — list all active stations with owner + roster
        grp.MapGet("", async (NeeDbContext db, CancellationToken ct) =>
        {
            var stations = await db.Stations
                .Where(s => s.IsActive)
                .OrderBy(s => s.SortOrder)
                .Select(s => new
                {
                    s.Id,
                    s.Code,
                    s.Name,
                    s.OwnerUserId,
                    OwnerName = s.OwnerUser != null ? s.OwnerUser.FullName : null,
                })
                .ToListAsync(ct);

            var stationIds = stations.Select(s => s.Id).ToList();
            var techMap = await db.StationTechnicians
                .Where(st => stationIds.Contains(st.StationId))
                .Select(st => new
                {
                    st.StationId,
                    st.UserId,
                    FullName = st.User.FullName,
                    st.IsPrimary,
                    SkillLevel = (int)st.SkillLevel,
                })
                .ToListAsync(ct);

            var result = stations.Select(s => new
            {
                s.Id,
                s.Code,
                s.Name,
                s.OwnerUserId,
                s.OwnerName,
                Technicians = techMap
                    .Where(t => t.StationId == s.Id)
                    .Select(t => new { t.UserId, t.FullName, t.IsPrimary, t.SkillLevel })
                    .ToArray(),
            });
            return Results.Ok(result);
        }).WithName("ListStations");

        // GET /api/stations/{id}/technicians
        grp.MapGet("/{id:int}/technicians", async (int id, NeeDbContext db, CancellationToken ct) =>
        {
            var techs = await db.StationTechnicians
                .Where(st => st.StationId == id)
                .Select(st => new
                {
                    UserId     = st.UserId,
                    FullName   = st.User.FullName,
                    IsPrimary  = st.IsPrimary,
                    SkillLevel = (int)st.SkillLevel,
                })
                .OrderByDescending(st => st.IsPrimary)
                .ThenBy(st => st.FullName)
                .ToListAsync(ct);

            return Results.Ok(techs);
        }).WithName("GetStationTechnicians");
    }
}
