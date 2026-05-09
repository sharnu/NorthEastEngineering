using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class KanbanOverrideTests(ApiFixture fixture)
{
    private static readonly Guid SalesUserId      = new("11111111-1111-1111-1111-111111111111");
    private static readonly Guid SupervisorUserId = new("33333333-3333-3333-3333-333333333333");

    private HttpClient SalesClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SalesUserId, "SALES"));
        return c;
    }

    private HttpClient SupervisorClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SupervisorUserId, "SUPERVISOR"));
        return c;
    }

    private HttpClient AdminClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SupervisorUserId, "ADMIN"));
        return c;
    }

    // ── E14-S4: Kanban stage override ─────────────────────────────────────────

    [Fact]
    public async Task GetKanbanStages_ReturnsSeededStages()
    {
        var resp = await SupervisorClient().GetAsync("/api/kanban/stages");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var stages = await resp.Content.ReadFromJsonAsync<StageItem[]>();
        stages.Should().NotBeEmpty();
        stages!.Should().Contain(s => s.Code == "FINAL_QC");
    }

    [Fact]
    public async Task OverrideStage_AnyToAny_Allowed()
    {
        var roId = await CreateRoAsync();
        var stages = await SupervisorClient().GetFromJsonAsync<StageItem[]>("/api/kanban/stages");
        var target = stages!.First(s => s.Code == "FINAL_QC");

        var resp = await SupervisorClient().PostAsJsonAsync($"/api/kanban/ros/{roId}/force-advance", new
        {
            stageId = target.Id,
            reason  = "Supervisor manually advancing this RO to Final QC stage",
        });
        resp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Verify kanban state changed
        using var db = fixture.CreateDbContext();
        var state = db.RoKanbanStates.FirstOrDefault(s => s.RoId == roId);
        state.Should().NotBeNull();
        state!.CurrentStageId.Should().Be(target.Id);
    }

    [Fact]
    public async Task OverrideStage_EmitsEventWithFromAndTo()
    {
        var roId = await CreateRoAsync();
        var stages = await SupervisorClient().GetFromJsonAsync<StageItem[]>("/api/kanban/stages");
        var target = stages!.First(s => s.Code == "FINAL_QC");

        // First override to set a known fromStageId
        await SupervisorClient().PostAsJsonAsync($"/api/kanban/ros/{roId}/force-advance", new
        {
            stageId = stages!.First(s => s.Code == "FABRICATION").Id,
            reason  = "Setting initial stage before testing event payload correctness",
        });

        var secondTarget = target;
        await SupervisorClient().PostAsJsonAsync($"/api/kanban/ros/{roId}/force-advance", new
        {
            stageId = secondTarget.Id,
            reason  = "Second override to verify from/to event payload fields",
        });

        using var db = fixture.CreateDbContext();
        var events = db.DomainEvents
            .Where(e => e.AggregateId == roId && e.EventType == "RoStageForceAdvanced")
            .ToList();
        events.Should().HaveCountGreaterThan(0);
        var last = events.Last();
        last.Payload.RootElement.GetProperty("toStageId").GetInt16().Should().Be(secondTarget.Id);
        last.Payload.RootElement.GetProperty("fromStageId").GetInt16().Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public async Task OverrideStage_NonSupervisor_Returns403()
    {
        var roId = await CreateRoAsync();
        var stages = await SalesClient().GetFromJsonAsync<StageItem[]>("/api/kanban/stages");
        var target = stages!.First();

        var resp = await SalesClient().PostAsJsonAsync($"/api/kanban/ros/{roId}/force-advance", new
        {
            stageId = target.Id,
            reason  = "Sales user should not be able to override kanban stage",
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task OverrideStage_CompletedRo_Returns409()
    {
        var roId = await CreateRoAsync();
        using (var db = fixture.CreateDbContext())
        {
            var ro = await db.RepairOrders.FindAsync(roId);
            ro!.Status = "COMPLETED";
            await db.SaveChangesAsync();
        }

        var stages = await SupervisorClient().GetFromJsonAsync<StageItem[]>("/api/kanban/stages");
        var target = stages!.First();
        var resp = await SupervisorClient().PostAsJsonAsync($"/api/kanban/ros/{roId}/force-advance", new
        {
            stageId = target.Id,
            reason  = "Should be blocked for completed RO override attempt",
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task OverrideStage_ShortReason_Returns422()
    {
        var roId = await CreateRoAsync();
        var stages = await SupervisorClient().GetFromJsonAsync<StageItem[]>("/api/kanban/stages");
        var resp = await SupervisorClient().PostAsJsonAsync($"/api/kanban/ros/{roId}/force-advance", new
        {
            stageId = stages![0].Id,
            reason  = "Short",
        });
        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<Guid> CreateRoAsync()
    {
        var client = SalesClient();
        var customers = await client.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var dfe = customers!.First(c => c.Code == "DFE");

        var resp = await client.PostAsJsonAsync("/api/repair-orders", new
        {
            customerId   = dfe.Id,
            jobTypeId    = 1,
            templateCode = "TP42N",
            rego         = $"KO{Random.Shared.Next(99999)}",
            requiredDate = DateTimeOffset.UtcNow.AddMonths(3),
        });
        var created = await resp.Content.ReadFromJsonAsync<CreateRoResp>();
        return created!.RoId;
    }

    private record CustomerItem(Guid Id, string Code, string Name);
    private record CreateRoResp(Guid RoId, string RoNumber, int TasksCreated);
    private record StageItem(short Id, string Code, string Name, bool IsTerminal);
}
