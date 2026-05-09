using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Domain;
using Nee.Api.Services;
using Xunit;

namespace Nee.Api.Tests;

/// <summary>
/// Unit tests for GateEvaluator using the real Postgres test container.
/// Each test seeds isolated data (unique RO per test).
/// </summary>
[Collection("Api")]
public class GateEvaluatorTests(ApiFixture fixture)
{
    private static readonly Guid SalesUserId  = new("11111111-1111-1111-1111-111111111111");
    private const string         TemplateCode = "TP42N";
    private static readonly Guid TemplateVerId = new("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    private const short          JobTypeId    = 1;
    private const short          OpId         = 10; // MAT_PROC_CNC — valid FK

    // ── 1. Single-track BODY: gated when upstream station has PENDING task ────

    [Fact]
    public async Task SingleTrack_Body_Gated_WhenUpstreamIncomplete()
    {
        // TRAY flow: stations 10 → 20 → 30 → 40 → 90 (all BODY)
        await using var db = fixture.CreateDbContext();
        var roId = await SeedRoAsync(db, "GATE-GATED-001", "TRAY");

        await SeedTaskAsync(db, roId, stationId: 10, flowTrack: "BODY", status: "PENDING");
        await SeedTaskAsync(db, roId, stationId: 20, flowTrack: "BODY", status: "PENDING");

        var result = await new GateEvaluator(db).Evaluate(roId, stationId: 20, CancellationToken.None);

        result.State.Should().Be("GATED");
        result.Reason.Should().Contain("BODY");
    }

    // ── 2. Single-track BODY: ready when upstream tasks all COMPLETED ─────────

    [Fact]
    public async Task SingleTrack_Body_Ready_WhenUpstreamComplete()
    {
        await using var db = fixture.CreateDbContext();
        var roId = await SeedRoAsync(db, "GATE-READY-001", "TRAY");

        await SeedTaskAsync(db, roId, stationId: 10, flowTrack: "BODY", status: "COMPLETED");
        await SeedTaskAsync(db, roId, stationId: 20, flowTrack: "BODY", status: "PENDING");

        var result = await new GateEvaluator(db).Evaluate(roId, stationId: 20, CancellationToken.None);

        result.State.Should().Be("READY");
    }

    // ── 3. Split tracks: chassis card READY independent of body progress ──────

    [Fact]
    public async Task SplitTracks_ChassisReady_IndependentOfBodyProgress()
    {
        // TIPPER_CS: CHASSIS flow = 50 → 60 → 70 → 90; BODY flow = 10 → 25 → 30 → 40 → 70 → 90
        await using var db = fixture.CreateDbContext();
        var roId = await SeedRoAsync(db, "GATE-SPLIT-001", "TIPPER_CS");

        await SeedTaskAsync(db, roId, stationId: 10, flowTrack: "BODY",    status: "PENDING");
        await SeedTaskAsync(db, roId, stationId: 50, flowTrack: "CHASSIS", status: "COMPLETED");
        await SeedTaskAsync(db, roId, stationId: 60, flowTrack: "CHASSIS", status: "PENDING");

        var result = await new GateEvaluator(db).Evaluate(roId, stationId: 60, CancellationToken.None);

        result.State.Should().Be("READY", because: "chassis upstream (station 50) is complete");
    }

    // ── 4. Merge point: GATED until all incoming tracks complete ──────────────

    [Fact]
    public async Task MergePoint_BothTracksRequired_ReadyOnlyWhenBoth()
    {
        // PANTECH_AL: BODY = 80 → 90 (post-027); CHASSIS = 50 → 60 → 70 → 90.
        // BODY tasks at stations 25/30 below are seeded but not in
        // flow_definitions; the evaluator ignores tasks with no matching
        // flow row, so the assertion is unchanged from the pre-027 flow.
        await using var db = fixture.CreateDbContext();
        var roId = await SeedRoAsync(db, "GATE-MERGE-001", "PANTECH_AL");

        await SeedTaskAsync(db, roId, stationId: 25, flowTrack: "BODY",    status: "COMPLETED");
        await SeedTaskAsync(db, roId, stationId: 30, flowTrack: "BODY",    status: "COMPLETED");
        await SeedTaskAsync(db, roId, stationId: 80, flowTrack: "BODY",    status: "COMPLETED");
        await SeedTaskAsync(db, roId, stationId: 50, flowTrack: "CHASSIS", status: "COMPLETED");
        await SeedTaskAsync(db, roId, stationId: 60, flowTrack: "CHASSIS", status: "PENDING");
        await SeedTaskAsync(db, roId, stationId: 70, flowTrack: "CHASSIS", status: "PENDING");
        await SeedTaskAsync(db, roId, stationId: 90, flowTrack: "BODY",    status: "PENDING");

        var gated = await new GateEvaluator(db).Evaluate(roId, stationId: 90, CancellationToken.None);
        gated.State.Should().Be("GATED");
        gated.Reason.Should().Contain("CHASSIS");

        // Complete remaining CHASSIS upstream tasks using the same context
        var chassisTasks = await db.JobTasks
            .Where(t => t.RoId == roId && (t.StationId == 60 || t.StationId == 70))
            .ToListAsync();
        foreach (var t in chassisTasks) t.Status = "COMPLETED";
        await db.SaveChangesAsync();

        // Clear tracked entities so EvaluateAsync re-queries fresh state
        db.ChangeTracker.Clear();

        var ready = await new GateEvaluator(db).Evaluate(roId, stationId: 90, CancellationToken.None);
        ready.State.Should().Be("READY");
    }

    // ── 5. All tasks at station completed → COMPLETE state ────────────────────

    [Fact]
    public async Task AllTasksCompleted_ReturnsCompleteState()
    {
        await using var db = fixture.CreateDbContext();
        var roId = await SeedRoAsync(db, "GATE-DONE-001", "TRAY");

        await SeedTaskAsync(db, roId, stationId: 10, flowTrack: "BODY", status: "COMPLETED");
        await SeedTaskAsync(db, roId, stationId: 10, flowTrack: "BODY", status: "COMPLETED", seq: 2);

        var result = await new GateEvaluator(db).Evaluate(roId, stationId: 10, CancellationToken.None);

        result.State.Should().Be("COMPLETE");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private static int _seqCounter = 0;
    private static int _roCounter  = 90000; // high range, avoids collisions with API-created ROs

    private async Task<Guid> SeedRoAsync(Nee.Api.Data.NeeDbContext db, string rego, string bodyType)
    {
        var customerId = await db.Customers.Select(c => c.Id).FirstAsync();
        var roNum      = System.Threading.Interlocked.Increment(ref _roCounter);

        var ro = new RepairOrder
        {
            Id                = Guid.NewGuid(),
            RoNumber          = $"RO{roNum:D5}",
            Rego              = rego,
            CustomerId        = customerId,
            TemplateCode      = TemplateCode,
            TemplateVersionId = TemplateVerId,
            JobTypeId         = JobTypeId,
            BodyType          = bodyType,
            Status            = "IN_PROGRESS",
            DraftingStatus    = "COMPLETED",
            RoDate            = DateOnly.FromDateTime(DateTime.UtcNow),
            CreatedBy         = SalesUserId,
            CreatedAt         = DateTimeOffset.UtcNow,
            UpdatedAt         = DateTimeOffset.UtcNow,
            Priority          = 3,
        };
        db.RepairOrders.Add(ro);
        await db.SaveChangesAsync();
        return ro.Id;
    }

    private static async Task SeedTaskAsync(
        Nee.Api.Data.NeeDbContext db,
        Guid roId, short stationId, string flowTrack, string status, short seq = 0)
    {
        var actualSeq = seq == 0 ? (short)System.Threading.Interlocked.Increment(ref _seqCounter) : seq;
        db.JobTasks.Add(new JobTask
        {
            Id             = Guid.NewGuid(),
            RoId           = roId,
            Sequence       = actualSeq,
            JobCodeLine    = $"TEST-{stationId:000}-{actualSeq:00}",
            OperationId    = OpId,
            OperationName  = $"Test op at station {stationId}",
            StationId      = stationId,
            FlowTrack      = flowTrack,
            Status         = status,
            EstimatedHours = 1m,
            ActualHours    = 0m,
            CreatedAt      = DateTimeOffset.UtcNow,
            UpdatedAt      = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();
    }
}
