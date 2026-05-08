using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;

namespace Nee.Api.Tests;

/// <summary>
/// E14-S5: drives the full E14 happy path in one test and asserts that all seven
/// domain event types are emitted with the expected payload shapes.
/// </summary>
[Collection("Api")]
public class RoLifecycleEventsTests(ApiFixture fixture)
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

    [Fact]
    public async Task FullLifecycle_EmitsAllSevenEventTypes()
    {
        // ── Step 1: Create RO ────────────────────────────────────────────────
        var salesClient = SalesClient();
        var customers   = await salesClient.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var dfe         = customers!.First(c => c.Code == "DFE");

        var createResp = await salesClient.PostAsJsonAsync("/api/repair-orders", new
        {
            customerId   = dfe.Id,
            jobTypeId    = 1,
            templateCode = "TP42N",
            rego         = $"EVT{Random.Shared.Next(99999)}",
            make         = "Isuzu",
            model        = "NPR",
            requiredDate = DateTimeOffset.UtcNow.AddMonths(3),
        });
        createResp.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await createResp.Content.ReadFromJsonAsync<CreateRoResp>();
        var roId    = created!.RoId;

        // ── Step 2: Edit header field → RoFieldChanged ────────────────────────
        var editResp = await salesClient.PutAsJsonAsync($"/api/repair-orders/{roId}", new
        {
            rego = "EVT-EDITED",
        });
        editResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // ── Step 3: Add task → RoTaskAdded ────────────────────────────────────
        var ops = await salesClient.GetFromJsonAsync<OpItem[]>("/api/operations");
        var op  = ops!.First();
        var addResp = await salesClient.PostAsJsonAsync($"/api/repair-orders/{roId}/tasks", new
        {
            operationId     = op.Id,
            estimatedHours  = 2.0,
        });
        addResp.StatusCode.Should().Be(HttpStatusCode.Created);
        var addedTask = await addResp.Content.ReadFromJsonAsync<AddTaskResp>();
        addedTask.Should().NotBeNull();

        // ── Step 4: Reorder tasks → RoTaskReordered ────────────────────────────
        var detail  = await salesClient.GetFromJsonAsync<RoDetailResp>($"/api/repair-orders/{roId}");
        var ordered = detail!.Tasks.OrderBy(t => t.Sequence).Select(t => t.Id).ToArray();
        var reversed = ordered.Reverse().ToArray();
        if (reversed.Length > 1)
        {
            var reorderResp = await salesClient.PutAsJsonAsync(
                $"/api/repair-orders/{roId}/tasks/reorder",
                new { taskIds = reversed });
            reorderResp.StatusCode.Should().Be(HttpStatusCode.NoContent);
        }

        // ── Step 5: Remove task → RoTaskRemoved ───────────────────────────────
        var removeResp = await salesClient.DeleteAsync(
            $"/api/repair-orders/{roId}/tasks/{addedTask!.Id}");
        removeResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // ── Step 6: Override kanban stage → RoStageForceAdvanced ─────────────
        var stages = await SupervisorClient().GetFromJsonAsync<StageItem[]>("/api/kanban/stages");
        var target  = stages!.First(s => s.Code == "FINAL_QC");
        var overrideResp = await SupervisorClient().PostAsJsonAsync(
            $"/api/kanban/ros/{roId}/override-stage",
            new { stageId = target.Id, reason = "Full lifecycle test — override to Final QC" });
        overrideResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // ── Step 7: Cancel → RoCancelled ─────────────────────────────────────
        var cancelResp = await SupervisorClient().PostAsJsonAsync(
            $"/api/repair-orders/{roId}/cancel",
            new { reason = "Full lifecycle test — cancellation step" });
        cancelResp.StatusCode.Should().Be(HttpStatusCode.OK);

        // ── Step 8: Reopen → RoReopened ───────────────────────────────────────
        var reopenResp = await AdminClient().PostAsJsonAsync(
            $"/api/repair-orders/{roId}/reopen", new { });
        reopenResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // ── Assert: all seven event types present ─────────────────────────────
        using var db = fixture.CreateDbContext();
        var events = db.DomainEvents
            .Where(e => e.AggregateId == roId)
            .Select(e => e.EventType)
            .ToList();

        var expectedTypes = new[]
        {
            "RoFieldChanged",
            "RoTaskAdded",
            "RoTaskReordered",
            "RoTaskRemoved",
            "RoStageForceAdvanced",
            "RoCancelled",
            "RoReopened",
        };

        foreach (var et in expectedTypes)
            events.Should().Contain(et, because: $"event type '{et}' should be emitted");

        // ── Assert: spot-check payload shapes ────────────────────────────────
        var fieldChanged = db.DomainEvents
            .First(e => e.AggregateId == roId && e.EventType == "RoFieldChanged");
        fieldChanged.Payload.RootElement.GetProperty("field").GetString().Should().NotBeNullOrEmpty();
        fieldChanged.Payload.RootElement.GetProperty("before").ValueKind.Should().NotBe(System.Text.Json.JsonValueKind.Undefined);
        fieldChanged.Payload.RootElement.GetProperty("after").GetString().Should().Be("EVT-EDITED");

        var taskAdded = db.DomainEvents
            .First(e => e.AggregateId == roId && e.EventType == "RoTaskAdded");
        taskAdded.Payload.RootElement.GetProperty("taskId").GetString().Should().NotBeNullOrEmpty();
        taskAdded.Payload.RootElement.GetProperty("operationId").GetInt16().Should().BeGreaterThan(0);

        var stageOverride = db.DomainEvents
            .First(e => e.AggregateId == roId && e.EventType == "RoStageForceAdvanced");
        stageOverride.Payload.RootElement.GetProperty("toStageId").GetInt16().Should().Be(target.Id);
        stageOverride.Payload.RootElement.GetProperty("fromStageId").GetInt16().Should().BeGreaterThanOrEqualTo(0);
        stageOverride.Payload.RootElement.GetProperty("reason").GetString().Should().Contain("Final QC");

        var cancelled = db.DomainEvents
            .First(e => e.AggregateId == roId && e.EventType == "RoCancelled");
        cancelled.Payload.RootElement.GetProperty("reason").GetString().Should().Contain("cancellation step");

        db.DomainEvents
            .Count(e => e.AggregateId == roId && e.EventType == "RoReopened")
            .Should().Be(1);
    }

    private record CustomerItem(Guid Id, string Code, string Name);
    private record CreateRoResp(Guid RoId, string RoNumber, int TasksCreated);
    private record AddTaskResp(Guid Id);
    private record RoDetailResp(string Status, TaskItem[] Tasks);
    private record TaskItem(Guid Id, int Sequence);
    private record OpItem(short Id, string Code, string CanonicalName);
    private record StageItem(short Id, string Code, string Name, bool IsTerminal);
}
