using Microsoft.EntityFrameworkCore;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class FlowDefinitionEntityTests(ApiFixture fixture)
{
    [Fact]
    public async Task TipperCs_Body_Track_Has_Six_Steps_In_Order()
    {
        await using var db = fixture.CreateDbContext();

        var steps = await db.FlowDefinitions
            .Where(x => x.BodyType == "TIPPER_CS" && x.Track == "BODY")
            .OrderBy(x => x.SortOrder)
            .Include(x => x.Station)
            .ToListAsync();

        Assert.Equal(6, steps.Count);
        Assert.Equal(10, steps[0].StationId); // MATERIAL_PROC
        Assert.Equal(25, steps[1].StationId); // ROBOTIC_FAB
        Assert.Equal(30, steps[2].StationId); // PAINT_PANEL
        Assert.Equal(40, steps[3].StationId); // BODY_FITOUT
        Assert.Equal(70, steps[4].StationId); // FINAL_FITMENT
        Assert.Equal(90, steps[5].StationId); // COMPLIANCE_QC
    }

    [Fact]
    public async Task TipperCs_Chassis_Track_Has_Four_Steps_In_Order()
    {
        await using var db = fixture.CreateDbContext();

        var steps = await db.FlowDefinitions
            .Where(x => x.BodyType == "TIPPER_CS" && x.Track == "CHASSIS")
            .OrderBy(x => x.SortOrder)
            .ToListAsync();

        Assert.Equal(4, steps.Count);
        Assert.Equal(50, steps[0].StationId); // CHASSIS_PREP
        Assert.Equal(60, steps[1].StationId); // HYVA
        Assert.Equal(70, steps[2].StationId); // FINAL_FITMENT
        Assert.Equal(90, steps[3].StationId); // COMPLIANCE_QC
    }

    [Fact]
    public async Task All_Ten_Body_Types_Are_Seeded()
    {
        await using var db = fixture.CreateDbContext();

        var bodyTypes = await db.FlowDefinitions
            .Select(x => x.BodyType)
            .Distinct()
            .ToListAsync();

        var expected = new[]
        {
            "TIPPER_CS", "CHIPPER_TIPPER_TRAY_CRANE",
            "TRAY", "TAUTLINER", "BEAVERTAIL",
            "PANTECH_STEEL", "PANTECH_AL",
            "TILT_SLIDER", "TRAILER", "BODY_SWAP"
        };

        foreach (var bt in expected)
            Assert.Contains(bt, bodyTypes);
    }

    [Fact]
    public async Task Subframe_MaterialProc_Step_Is_Optional()
    {
        await using var db = fixture.CreateDbContext();

        var step = await db.FlowDefinitions
            .FirstOrDefaultAsync(x => x.BodyType == "TIPPER_CS" && x.Track == "SUBFRAME" && x.StationId == 10);

        Assert.NotNull(step);
        Assert.True(step.IsOptional);
    }
}
