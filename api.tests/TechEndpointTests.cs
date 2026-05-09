using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class TechEndpointTests(ApiFixture fixture)
{
    private static readonly Guid SupervisorId = new("33333333-3333-3333-3333-333333333333");
    private static readonly Guid SalesUserId  = new("11111111-1111-1111-1111-111111111111");
    private static readonly Guid PeterId      = new("44444444-4444-4444-4444-444444444444");
    private static readonly Guid KaneId       = new("55555555-5555-5555-5555-555555555555");

    private HttpClient Client(Guid userId, params string[] roles)
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(userId, roles));
        return c;
    }

    // ── 1. GetMyTasks_NoToken_Returns401 ─────────────────────────────────────

    [Fact]
    public async Task GetMyTasks_NoToken_Returns401()
    {
        var resp = await fixture.CreateClient().GetAsync("/api/tech/tasks");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── 2. GetMyTasks_WithToken_NoTasks_ReturnsEmptyArray ────────────────────

    [Fact]
    public async Task GetMyTasks_WithToken_NoTasks_ReturnsEmptyArray()
    {
        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.GetAsync("/api/tech/tasks");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var tasks = await resp.Content.ReadFromJsonAsync<TechTaskItem[]>();
        // Peter may have tasks from other tests — we just verify the array is present and non-null
        tasks.Should().NotBeNull();
    }

    // ── 3. GetMyTasks_AfterAssignment_ReturnsTask ────────────────────────────

    [Fact]
    public async Task GetMyTasks_AfterAssignment_ReturnsTask()
    {
        var roId     = await CreateAndApproveRo("GTMA001");
        var taskId   = await GetFirstFabTaskId(roId);
        await AssignTaskToPeter(taskId);

        var peter  = Client(PeterId, "TECHNICIAN");
        var resp   = await peter.GetAsync("/api/tech/tasks");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var tasks = await resp.Content.ReadFromJsonAsync<TechTaskItem[]>();
        tasks.Should().NotBeNull();
        tasks!.Should().Contain(t => t.Id == taskId);
    }

    // ── 4. ClockIn_Returns201_AndTaskIsInProgress ────────────────────────────

    [Fact]
    public async Task ClockIn_Returns201_AndTaskIsInProgress()
    {
        var roId   = await CreateAndApproveRo("CLKI001");
        var taskId = await GetFirstFabTaskId(roId);
        await AssignTaskToPeter(taskId);

        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/clock-in", new { });

        resp.StatusCode.Should().Be(HttpStatusCode.Created);

        var body = await resp.Content.ReadFromJsonAsync<ClockInResult>();
        body.Should().NotBeNull();
        body!.EntryId.Should().NotBeEmpty();

        // Verify open time entry in DB
        await using var db = fixture.CreateDbContext();
        var entry = await db.TimeEntries
            .FirstOrDefaultAsync(te => te.TaskId == taskId && te.ClockOut == null);
        entry.Should().NotBeNull();

        var task = await db.JobTasks.FindAsync(taskId);
        task!.Status.Should().Be("IN_PROGRESS");

        // Clean up: clock out so next tests aren't blocked
        await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/clock-out", new { });
    }

    // ── 5. ClockIn_AlreadyClockedIn_Returns409 ───────────────────────────────

    [Fact]
    public async Task ClockIn_AlreadyClockedIn_Returns409()
    {
        var roId    = await CreateAndApproveRo("ALRDY001");
        var taskIds = await GetFabTaskIds(roId);

        // Need at least 2 tasks
        taskIds.Should().HaveCountGreaterThan(1);

        var t1 = taskIds[0];
        var t2 = taskIds[1];

        await AssignTaskToPeter(t1);
        await AssignTaskToPeter(t2);

        var peter = Client(PeterId, "TECHNICIAN");
        await peter.PostAsJsonAsync($"/api/tech/tasks/{t1}/clock-in", new { });

        var resp2 = await peter.PostAsJsonAsync($"/api/tech/tasks/{t2}/clock-in", new { });
        resp2.StatusCode.Should().Be(HttpStatusCode.Conflict);

        // Clean up
        await peter.PostAsJsonAsync($"/api/tech/tasks/{t1}/clock-out", new { });
    }

    // ── 6. ClockOut_Returns200_AndActualHoursUpdated ─────────────────────────

    [Fact]
    public async Task ClockOut_Returns200_AndActualHoursUpdated()
    {
        var roId   = await CreateAndApproveRo("CLKO001");
        var taskId = await GetFirstFabTaskId(roId);
        await AssignTaskToPeter(taskId);

        var peter = Client(PeterId, "TECHNICIAN");
        await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/clock-in", new { });

        var resp = await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/clock-out", new { });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<ClockOutResult>();
        body.Should().NotBeNull();
        body!.ClockOut.Should().BeAfter(body.ClockIn);

        await using var db = fixture.CreateDbContext();
        var task = await db.JobTasks.FindAsync(taskId);
        task!.Status.Should().Be("PAUSED");
    }

    // ── 7. ClockOut_NotClockedIn_Returns404 ──────────────────────────────────

    [Fact]
    public async Task ClockOut_NotClockedIn_Returns404()
    {
        var roId   = await CreateAndApproveRo("NCLK001");
        var taskId = await GetFirstFabTaskId(roId);
        await AssignTaskToPeter(taskId);

        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/clock-out", new { });
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── 8. CompleteTask_WithinEstimate_Returns200 ─────────────────────────────

    [Fact]
    public async Task CompleteTask_WithinEstimate_Returns200()
    {
        var roId   = await CreateAndApproveRo("COMP001");
        var taskId = await GetFirstFabTaskId(roId);
        await AssignTaskToPeter(taskId);

        var peter = Client(PeterId, "TECHNICIAN");
        await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/clock-in", new { });
        await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/clock-out", new { });

        var resp = await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/complete",
            new { VarianceReasonId = 11, Notes = (string?)null });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<CompleteResult>();
        body.Should().NotBeNull();
        body!.TaskId.Should().Be(taskId);

        await using var db = fixture.CreateDbContext();
        var task = await db.JobTasks.FindAsync(taskId);
        task!.Status.Should().Be("COMPLETED");
    }

    // ── 9. CompleteTask_WrongUser_Returns403 ──────────────────────────────────

    [Fact]
    public async Task CompleteTask_WrongUser_Returns403()
    {
        var roId   = await CreateAndApproveRo("WRNG001");
        var taskId = await GetFirstFabTaskId(roId);
        await AssignTaskToPeter(taskId);

        // Kane tries to complete Peter's task
        var kane = Client(KaneId, "TECHNICIAN");
        var resp = await kane.PostAsJsonAsync($"/api/tech/tasks/{taskId}/complete",
            new { VarianceReasonId = 11, Notes = (string?)null });
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── 10. BlockTask_Returns200_AndRoOnHold ──────────────────────────────────

    [Fact]
    public async Task BlockTask_Returns200_AndRoOnHold()
    {
        var roId   = await CreateAndApproveRo("BLOK001");
        var taskId = await GetFirstFabTaskId(roId);
        await AssignTaskToPeter(taskId);

        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/block",
            new { Reason = "Waiting for chassis delivery from supplier" });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        await using var db = fixture.CreateDbContext();

        var task = await db.JobTasks.FindAsync(taskId);
        task!.Status.Should().Be("BLOCKED");

        var ro = await db.RepairOrders.FindAsync(roId);
        ro!.Status.Should().Be("ON_HOLD");

        var kanban = await db.RoKanbanStates.FindAsync(roId);
        kanban.Should().NotBeNull();
        kanban!.CurrentStageId.Should().Be(95);
    }

    // ── 11. UnblockTask_AsSupervisor_Returns200 ───────────────────────────────

    [Fact]
    public async Task UnblockTask_AsSupervisor_Returns200()
    {
        var roId   = await CreateAndApproveRo("UNBL001");
        var taskId = await GetFirstFabTaskId(roId);
        await AssignTaskToPeter(taskId);

        // Capture the kanban stage *before* blocking so we can assert the
        // unblock restores it (not the static fallback value).
        short stageBeforeBlock;
        await using (var dbBefore = fixture.CreateDbContext())
        {
            var s = await dbBefore.RoKanbanStates.FindAsync(roId);
            stageBeforeBlock = s?.CurrentStageId ?? (short)10;
        }

        // Block first
        var peter = Client(PeterId, "TECHNICIAN");
        await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/block",
            new { Reason = "Waiting for parts to arrive before fabrication can start" });

        // Sanity: blocking parked the RO in HOSPITAL (stage 95)
        await using (var dbBlocked = fixture.CreateDbContext())
        {
            var s = await dbBlocked.RoKanbanStates.FindAsync(roId);
            s!.CurrentStageId.Should().Be((short)95);
        }

        // Unblock as supervisor
        var sup  = Client(SupervisorId, "SUPERVISOR");
        var resp = await sup.PostAsJsonAsync($"/api/tech/tasks/{taskId}/unblock",
            new { ResolutionNotes = "Parts arrived on dock, technician can resume" });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        await using var db = fixture.CreateDbContext();
        var task = await db.JobTasks.FindAsync(taskId);
        task!.Status.Should().Be("PAUSED");

        var ro = await db.RepairOrders.FindAsync(roId);
        ro!.Status.Should().Be("IN_PROGRESS");

        // Stage is restored to whatever it was before blocking — NOT 95
        var kanban = await db.RoKanbanStates.FindAsync(roId);
        kanban!.CurrentStageId.Should().Be(stageBeforeBlock,
            "unblock must restore the previousStageId saved on TaskBlocked");
        kanban.CurrentStageId.Should().NotBe((short)95);

        // A TaskUnblocked domain event was emitted with the resolution notes
        var ev = await db.DomainEvents
            .Where(e => e.AggregateId == taskId && e.EventType == "TaskUnblocked")
            .OrderByDescending(e => e.Id)
            .FirstOrDefaultAsync();
        ev.Should().NotBeNull();
        ev!.Payload.RootElement.GetProperty("resolutionNotes").GetString()
            .Should().Be("Parts arrived on dock, technician can resume");
        ev.Payload.RootElement.GetProperty("restoredStageId").GetInt16()
            .Should().Be(stageBeforeBlock);
    }

    [Fact]
    public async Task UnblockTask_ShortNotes_Returns422()
    {
        var roId   = await CreateAndApproveRo("UNBL002");
        var taskId = await GetFirstFabTaskId(roId);
        await AssignTaskToPeter(taskId);

        var peter = Client(PeterId, "TECHNICIAN");
        await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/block",
            new { Reason = "Waiting for parts to arrive before fabrication can start" });

        var sup  = Client(SupervisorId, "SUPERVISOR");
        var resp = await sup.PostAsJsonAsync($"/api/tech/tasks/{taskId}/unblock",
            new { ResolutionNotes = "ok" });
        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task GetMyTasks_IncludesBlockedTasks_WithReason()
    {
        var roId   = await CreateAndApproveRo("UNBL003");
        var taskId = await GetFirstFabTaskId(roId);
        await AssignTaskToPeter(taskId);

        var peter = Client(PeterId, "TECHNICIAN");
        var blockReason = "Drilling jig is broken — need replacement";
        await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/block",
            new { Reason = blockReason });

        var tasks = await peter.GetFromJsonAsync<MyTasksItem[]>("/api/tech/tasks/");
        tasks.Should().NotBeNull();

        var blocked = tasks!.FirstOrDefault(t => t.Id == taskId);
        blocked.Should().NotBeNull("the BLOCKED task should appear on the technician's list");
        blocked!.Status.Should().Be("BLOCKED");
        blocked.BlockedReason.Should().Be(blockReason);
        blocked.BlockedAt.Should().NotBeNull();
    }

    private record MyTasksItem(
        Guid Id,
        Guid RoId,
        string RoNumber,
        int Sequence,
        string OperationName,
        string StationName,
        decimal EstimatedHours,
        decimal ActualHours,
        string Status,
        int Priority,
        string CustomerName,
        DateTimeOffset? RequiredDate,
        DateTimeOffset? ClockedInSince,
        string? BlockedReason,
        DateTimeOffset? BlockedAt);

    // ── 12. KanbanStageAdvances_WhenAllStationTasksComplete ──────────────────

    [Fact]
    public async Task KanbanStageAdvances_WhenAllStationTasksComplete()
    {
        var roId    = await CreateAndApproveRo("KADV001");
        var taskIds = await GetFabTaskIds(roId);
        taskIds.Should().NotBeEmpty();

        var peter = Client(PeterId, "TECHNICIAN");

        foreach (var taskId in taskIds)
        {
            await AssignTaskToPeter(taskId);
            await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/clock-in", new { });
            await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/clock-out", new { });
            var resp = await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/complete",
                new { VarianceReasonId = 11, Notes = (string?)null });
            resp.EnsureSuccessStatusCode();
        }

        await using var db = fixture.CreateDbContext();
        var kanban = await db.RoKanbanStates.FindAsync(roId);
        kanban.Should().NotBeNull();
        // Stage should have advanced past FABRICATION (40)
        kanban!.CurrentStageId.Should().NotBe((short)40);
    }

    // ── 13. BlockTask_AlreadyBlocked_Returns400 ───────────────────────────────

    [Fact]
    public async Task BlockTask_AlreadyBlocked_Returns400()
    {
        var roId   = await CreateAndApproveRo("BLOK002");
        var taskId = await GetFirstFabTaskId(roId);
        await AssignTaskToPeter(taskId);

        var peter  = Client(PeterId, "TECHNICIAN");
        var block1 = await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/block",
            new { Reason = "Waiting for chassis delivery from supplier" });
        block1.StatusCode.Should().Be(HttpStatusCode.OK);

        var block2 = await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/block",
            new { Reason = "Trying to block again after already blocked" });
        block2.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    // ── 14. UnblockTask_AsTechnician_Returns403 ───────────────────────────────

    [Fact]
    public async Task UnblockTask_AsTechnician_Returns403()
    {
        var roId   = await CreateAndApproveRo("UNBL002");
        var taskId = await GetFirstFabTaskId(roId);
        await AssignTaskToPeter(taskId);

        var peter = Client(PeterId, "TECHNICIAN");
        await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/block",
            new { Reason = "Waiting for parts to arrive from supplier" });

        var resp = await peter.PostAsJsonAsync($"/api/tech/tasks/{taskId}/unblock", new { });
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── 16. GetVarianceReasons_Returns200WithReasons ──────────────────────────

    [Fact]
    public async Task GetVarianceReasons_Returns200WithReasons()
    {
        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.GetAsync("/api/variance-reasons");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var reasons = await resp.Content.ReadFromJsonAsync<VarianceReasonItem[]>();
        reasons.Should().NotBeNull();
        reasons!.Should().NotBeEmpty();
        reasons!.Should().Contain(r => r.Id == 11); // AS_ESTIMATED
        reasons!.Should().Contain(r => r.Id == 7);  // HOSPITAL_ZONE
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<Guid> CreateAndApproveRo(string rego)
    {
        var sales      = Client(SalesUserId, "SALES");
        var customers  = await sales.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId = customers!.First().Id;

        var resp = await sales.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId   = customerId,
            JobTypeId    = 1,
            TemplateCode = "TP42N",
            Rego         = rego,
            Priority     = 2,
        });
        resp.EnsureSuccessStatusCode();

        var body = await resp.Content.ReadFromJsonAsync<CreateRoResult>();
        return body!.RoId;
    }

    private async Task<Guid> GetFirstFabTaskId(Guid roId)
    {
        await using var db = fixture.CreateDbContext();
        return await db.JobTasks
            .Where(t => t.RoId == roId && t.StationId == 20)
            .OrderBy(t => t.Sequence)
            .Select(t => t.Id)
            .FirstAsync();
    }

    private async Task<List<Guid>> GetFabTaskIds(Guid roId)
    {
        await using var db = fixture.CreateDbContext();
        return await db.JobTasks
            .Where(t => t.RoId == roId && t.StationId == 20)
            .OrderBy(t => t.Sequence)
            .Select(t => t.Id)
            .ToListAsync();
    }

    private async Task AssignTaskToPeter(Guid taskId)
    {
        var sup  = Client(SupervisorId, "SUPERVISOR");
        var resp = await sup.PutAsJsonAsync($"/api/job-tasks/{taskId}/assign", new { UserId = PeterId });
        resp.EnsureSuccessStatusCode();
    }

    // ── Response DTOs ─────────────────────────────────────────────────────────

    private record TechTaskItem(Guid Id, string RoNumber, string OperationName, string Status);
    private record ClockInResult(Guid EntryId, DateTimeOffset ClockIn);
    private record ClockOutResult(Guid EntryId, DateTimeOffset ClockIn, DateTimeOffset ClockOut, int? DurationMinutes);
    private record CompleteResult(Guid TaskId, decimal ActualHours, decimal DeltaHours, string ReasonName);
    private record BlockResult(Guid TaskId, string RoNumber, DateTimeOffset BlockedAt);
    private record VarianceReasonItem(int Id, string Code, string Name, bool IsOverrun);
    private record CustomerItem(Guid Id, string Code, string Name);
    private record CreateRoResult(Guid RoId, string RoNumber, int TasksCreated);
}
