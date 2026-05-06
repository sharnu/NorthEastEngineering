using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class RepairOrderTaskTests(ApiFixture fixture)
{
    private static readonly Guid SalesUserId = new("11111111-1111-1111-1111-111111111111");

    private HttpClient SalesClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SalesUserId, "SALES"));
        return c;
    }

    // ── E14-S2: Add task ──────────────────────────────────────────────────────

    [Fact]
    public async Task AddTask_Append_AssignsNextSequence()
    {
        var (roId, initialCount) = await CreateRoAsync();
        var client = SalesClient();

        var ops = await client.GetFromJsonAsync<OpItem[]>("/api/operations");
        ops.Should().NotBeEmpty();
        var op = ops![0];

        var resp = await client.PostAsJsonAsync($"/api/repair-orders/{roId}/tasks", new
        {
            operationId    = op.Id,
            estimatedHours = 2.0m,
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);

        var detail = await client.GetFromJsonAsync<RoDetailResp>($"/api/repair-orders/{roId}");
        detail!.Tasks.Length.Should().Be(initialCount + 1);
        detail.Tasks.Max(t => t.Sequence).Should().Be(initialCount + 1);
    }

    [Fact]
    public async Task AddTask_OnCompletedRo_Returns409()
    {
        var (roId, _) = await CreateRoAsync();
        using (var db = fixture.CreateDbContext())
        {
            var ro = await db.RepairOrders.FindAsync(roId);
            ro!.Status = "COMPLETED";
            await db.SaveChangesAsync();
        }

        var ops = await SalesClient().GetFromJsonAsync<OpItem[]>("/api/operations");
        var resp = await SalesClient().PostAsJsonAsync($"/api/repair-orders/{roId}/tasks", new
        {
            operationId    = ops![0].Id,
            estimatedHours = 1.0m,
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    // ── E14-S2: Delete task ───────────────────────────────────────────────────

    [Fact]
    public async Task DeleteTask_WithTimeEntries_Returns422()
    {
        var (roId, taskIds) = await CreateRoWithTaskIdsAsync();

        // Inject a time entry for the first task
        using (var db = fixture.CreateDbContext())
        {
            db.TimeEntries.Add(new Nee.Api.Domain.TimeEntry
            {
                Id        = Guid.NewGuid(),
                TaskId    = taskIds[0],
                UserId    = SalesUserId,
                ClockIn   = DateTimeOffset.UtcNow.AddHours(-1),
                ClockOut  = DateTimeOffset.UtcNow,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var resp = await SalesClient().DeleteAsync($"/api/repair-orders/{roId}/tasks/{taskIds[0]}");
        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task DeleteTask_PendingNoWork_RemovesTask()
    {
        var (roId, taskIds) = await CreateRoWithTaskIdsAsync();
        var client = SalesClient();

        var initialDetail = await client.GetFromJsonAsync<RoDetailResp>($"/api/repair-orders/{roId}");
        var initial = initialDetail!.Tasks.Length;

        var resp = await client.DeleteAsync($"/api/repair-orders/{roId}/tasks/{taskIds[0]}");
        resp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var detail = await client.GetFromJsonAsync<RoDetailResp>($"/api/repair-orders/{roId}");
        detail!.Tasks.Length.Should().Be(initial - 1);
    }

    // ── E14-S2: Reorder tasks ─────────────────────────────────────────────────

    [Fact]
    public async Task ReorderTasks_ValidSet_PersistsNewOrder()
    {
        var (roId, taskIds) = await CreateRoWithTaskIdsAsync();
        var client = SalesClient();

        var reversed = taskIds.Reverse().ToArray();
        var resp = await client.PutAsJsonAsync($"/api/repair-orders/{roId}/tasks/reorder", new { taskIds = reversed });
        resp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var detail = await client.GetFromJsonAsync<RoDetailResp>($"/api/repair-orders/{roId}");
        detail!.Tasks[0].Id.Should().Be(reversed[0]);
    }

    [Fact]
    public async Task ReorderTasks_PartialSet_Returns400()
    {
        var (roId, taskIds) = await CreateRoWithTaskIdsAsync();

        var partial = taskIds.Take(2).ToArray();
        var resp = await SalesClient().PutAsJsonAsync($"/api/repair-orders/{roId}/tasks/reorder", new { taskIds = partial });
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<(Guid RoId, int TaskCount)> CreateRoAsync()
    {
        var client = SalesClient();
        var customers = await client.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var dfe = customers!.First(c => c.Code == "DFE");

        var resp = await client.PostAsJsonAsync("/api/repair-orders", new
        {
            customerId   = dfe.Id,
            jobTypeId    = 1,
            templateCode = "TP42N",
            rego         = $"TASK{Random.Shared.Next(10000)}",
            requiredDate = DateTimeOffset.UtcNow.AddMonths(3),
        });
        var created = await resp.Content.ReadFromJsonAsync<CreateRoResp>();

        var detail = await client.GetFromJsonAsync<RoDetailResp>($"/api/repair-orders/{created!.RoId}");
        return (created.RoId, detail!.Tasks.Length);
    }

    private async Task<(Guid RoId, Guid[] TaskIds)> CreateRoWithTaskIdsAsync()
    {
        var client = SalesClient();
        var customers = await client.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var dfe = customers!.First(c => c.Code == "DFE");

        var resp = await client.PostAsJsonAsync("/api/repair-orders", new
        {
            customerId   = dfe.Id,
            jobTypeId    = 1,
            templateCode = "TP42N",
            rego         = $"TSKID{Random.Shared.Next(10000)}",
            requiredDate = DateTimeOffset.UtcNow.AddMonths(3),
        });
        var created = await resp.Content.ReadFromJsonAsync<CreateRoResp>();
        var detail = await client.GetFromJsonAsync<RoDetailResp>($"/api/repair-orders/{created!.RoId}");
        var taskIds = detail!.Tasks.OrderBy(t => t.Sequence).Select(t => t.Id).ToArray();
        return (created.RoId, taskIds);
    }

    private record CustomerItem(Guid Id, string Code, string Name);
    private record CreateRoResp(Guid RoId, string RoNumber, int TasksCreated);
    private record RoDetailResp(string Rego, string Status, TaskItem[] Tasks);
    private record TaskItem(Guid Id, int Sequence, string Status);
    private record OpItem(short Id, string Code, string CanonicalName);
}
