using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class RepairOrderLifecycleTests(ApiFixture fixture)
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

    // ── E14-S3: Cancel ────────────────────────────────────────────────────────

    [Fact]
    public async Task CancelRo_PendingTasksTransition()
    {
        var roId = await CreateRoAsync();

        var resp = await SupervisorClient().PostAsJsonAsync($"/api/repair-orders/{roId}/cancel", new
        {
            reason         = "Customer requested cancellation of order",
            releaseChassis = false,
        });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var detail = await SalesClient().GetFromJsonAsync<RoDetailResp>($"/api/repair-orders/{roId}");
        detail!.Status.Should().Be("CANCELLED");
        detail.Tasks.Should().AllSatisfy(t => t.Status.Should().BeOneOf("CANCELLED", "IN_PROGRESS", "COMPLETED"));
        detail.CancellationReason.Should().Contain("Customer requested");
    }

    [Fact]
    public async Task CancelRo_ReleasesChassis()
    {
        var roId = await CreateRoAsync();

        // Allocate a chassis in DB directly
        Guid chassisId;
        using (var db = fixture.CreateDbContext())
        {
            var chassis = new Nee.Api.Domain.ChassisInventory
            {
                Id            = Guid.NewGuid(),
                ChassisNumber = $"TEST-CHAS-{roId:N}",
                Description   = "Test chassis",
                ChassisClass  = "MED",
                Status        = "ALLOCATED",
                AllocatedToRo = roId,
                AllocatedAt   = DateTimeOffset.UtcNow,
                CreatedAt     = DateTimeOffset.UtcNow,
                UpdatedAt     = DateTimeOffset.UtcNow,
            };
            db.ChassisInventory.Add(chassis);
            await db.SaveChangesAsync();
            chassisId = chassis.Id;
        }

        var resp = await SupervisorClient().PostAsJsonAsync($"/api/repair-orders/{roId}/cancel", new
        {
            reason         = "Order cancelled after chassis allocated to job",
            releaseChassis = true,
        });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        using (var db = fixture.CreateDbContext())
        {
            var chassis = await db.ChassisInventory.FindAsync(chassisId);
            chassis!.Status.Should().Be("AVAILABLE");
            chassis.AllocatedToRo.Should().BeNull();
        }
    }

    [Fact]
    public async Task CancelCompletedRo_Returns409()
    {
        var roId = await CreateRoAsync();
        using (var db = fixture.CreateDbContext())
        {
            var ro = await db.RepairOrders.FindAsync(roId);
            ro!.Status = "COMPLETED";
            await db.SaveChangesAsync();
        }

        var resp = await SupervisorClient().PostAsJsonAsync($"/api/repair-orders/{roId}/cancel", new
        {
            reason = "This should not be allowed at all",
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task CancelRo_NonSupervisor_Returns403()
    {
        var roId = await CreateRoAsync();
        var resp = await SalesClient().PostAsJsonAsync($"/api/repair-orders/{roId}/cancel", new
        {
            reason = "Sales user cannot cancel an RO here",
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task CancelRo_ShortReason_Returns422()
    {
        var roId = await CreateRoAsync();
        var resp = await SupervisorClient().PostAsJsonAsync($"/api/repair-orders/{roId}/cancel", new
        {
            reason = "Too short",
        });
        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    // ── E14-S3: Reopen ────────────────────────────────────────────────────────

    [Fact]
    public async Task ReopenRo_NonAdmin_Returns403()
    {
        var roId = await CreateRoAsync();
        await SupervisorClient().PostAsJsonAsync($"/api/repair-orders/{roId}/cancel", new
        {
            reason = "Cancelling to test reopen permission",
        });

        var resp = await SupervisorClient().PostAsJsonAsync($"/api/repair-orders/{roId}/reopen", new { });
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task ReopenRo_NotCancelled_Returns409()
    {
        var roId = await CreateRoAsync();

        var resp = await AdminClient().PostAsJsonAsync($"/api/repair-orders/{roId}/reopen", new { });
        resp.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task ReopenRo_CancelledRo_ClearsBanner()
    {
        var roId = await CreateRoAsync();

        await SupervisorClient().PostAsJsonAsync($"/api/repair-orders/{roId}/cancel", new
        {
            reason = "Testing the full cancel + reopen flow end to end",
        });

        var cancelledDetail = await SalesClient().GetFromJsonAsync<RoDetailResp>($"/api/repair-orders/{roId}");
        cancelledDetail!.Status.Should().Be("CANCELLED");

        var reopenResp = await AdminClient().PostAsJsonAsync($"/api/repair-orders/{roId}/reopen", new { });
        reopenResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var reopenedDetail = await SalesClient().GetFromJsonAsync<RoDetailResp>($"/api/repair-orders/{roId}");
        reopenedDetail!.Status.Should().NotBe("CANCELLED");
        reopenedDetail.CancellationReason.Should().BeNull();
    }

    // ── E14-S5: Domain events emitted ────────────────────────────────────────

    [Fact]
    public async Task CancelRo_EmitsRoCancelledEvent()
    {
        var roId = await CreateRoAsync();
        await SupervisorClient().PostAsJsonAsync($"/api/repair-orders/{roId}/cancel", new
        {
            reason = "Event emission test — cancel reason here",
        });

        using var db = fixture.CreateDbContext();
        var ev = db.DomainEvents
            .Where(e => e.AggregateId == roId && e.EventType == "RoCancelled")
            .ToList();
        ev.Should().HaveCount(1);
        ev[0].Payload.RootElement.GetProperty("reason").GetString().Should().Contain("Event emission");
    }

    [Fact]
    public async Task ReopenRo_EmitsRoReopenedEvent()
    {
        var roId = await CreateRoAsync();
        await SupervisorClient().PostAsJsonAsync($"/api/repair-orders/{roId}/cancel", new
        {
            reason = "Cancel then reopen domain event verification test",
        });
        await AdminClient().PostAsJsonAsync($"/api/repair-orders/{roId}/reopen", new { });

        using var db = fixture.CreateDbContext();
        db.DomainEvents
            .Count(e => e.AggregateId == roId && e.EventType == "RoReopened")
            .Should().Be(1);
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
            rego         = $"LC{Random.Shared.Next(99999)}",
            requiredDate = DateTimeOffset.UtcNow.AddMonths(3),
        });
        var created = await resp.Content.ReadFromJsonAsync<CreateRoResp>();
        return created!.RoId;
    }

    private record CustomerItem(Guid Id, string Code, string Name);
    private record CreateRoResp(Guid RoId, string RoNumber, int TasksCreated);
    private record RoDetailResp(string Status, string? CancellationReason, TaskItem[] Tasks);
    private record TaskItem(Guid Id, string Status);
}
