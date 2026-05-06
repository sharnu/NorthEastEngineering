using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class RepairOrderEditTests(ApiFixture fixture)
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

    private HttpClient AdminClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SupervisorUserId, "ADMIN"));
        return c;
    }

    // ── E14-S1: Edit RO header ────────────────────────────────────────────────

    [Fact]
    public async Task UpdateHeader_SingleField_EmitsOneEvent()
    {
        var (roId, _) = await CreateDraftRoAsync();
        var client = SalesClient();

        var resp = await client.PutAsJsonAsync($"/api/repair-orders/{roId}", new
        {
            rego = "UPD001",
        });
        resp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Verify via GET
        var detail = await client.GetFromJsonAsync<RoDetailResp>($"/api/repair-orders/{roId}");
        detail!.Rego.Should().Be("UPD001");

        // Verify domain event
        using var db = fixture.CreateDbContext();
        var events = db.DomainEvents
            .Where(e => e.AggregateId == roId && e.EventType == "RoFieldChanged")
            .ToList();
        events.Should().Contain(e =>
            e.Payload.RootElement.GetProperty("field").GetString() == "rego");
    }

    [Fact]
    public async Task UpdateMultipleFields_EmitsOneEventPerField()
    {
        var (roId, _) = await CreateDraftRoAsync();
        var client = SalesClient();

        var resp = await client.PutAsJsonAsync($"/api/repair-orders/{roId}", new
        {
            rego  = "MULTI01",
            make  = "Hino",   // differs from "Isuzu" set at creation
            model = "NQR",
        });
        resp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        using var db = fixture.CreateDbContext();
        var events = db.DomainEvents
            .Where(e => e.AggregateId == roId && e.EventType == "RoFieldChanged")
            .ToList();
        events.Should().Contain(e => e.Payload.RootElement.GetProperty("field").GetString() == "rego");
        events.Should().Contain(e => e.Payload.RootElement.GetProperty("field").GetString() == "make");
        events.Should().Contain(e => e.Payload.RootElement.GetProperty("field").GetString() == "model");
        events.Count(e => e.EventType == "RoFieldChanged").Should().Be(3);
    }

    [Fact]
    public async Task UpdateCompletedRo_Returns409()
    {
        var (roId, _) = await CreateDraftRoAsync();
        // Force to COMPLETED directly in DB
        using (var db = fixture.CreateDbContext())
        {
            var ro = await db.RepairOrders.FindAsync(roId);
            ro!.Status = "COMPLETED";
            await db.SaveChangesAsync();
        }

        var resp = await SalesClient().PutAsJsonAsync($"/api/repair-orders/{roId}", new { rego = "NOPE" });
        resp.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task UpdateCustomerWithTimeEntries_Returns422()
    {
        var (roId, tasks) = await CreateDraftRoAsync();

        // Inject a time entry for the first task
        using (var db = fixture.CreateDbContext())
        {
            db.TimeEntries.Add(new Nee.Api.Domain.TimeEntry
            {
                Id        = Guid.NewGuid(),
                TaskId    = tasks[0],
                UserId    = SalesUserId,
                ClockIn   = DateTimeOffset.UtcNow.AddHours(-1),
                ClockOut  = DateTimeOffset.UtcNow,
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var customers = await SalesClient().GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var otherCustomer = customers!.First(c => c.Code != "DFE");

        var resp = await SalesClient().PutAsJsonAsync($"/api/repair-orders/{roId}", new
        {
            customerId = otherCustomer.Id,
        });
        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<(Guid RoId, Guid[] Tasks)> CreateDraftRoAsync()
    {
        var client = SalesClient();
        var customers = await client.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var dfe = customers!.First(c => c.Code == "DFE");

        var resp = await client.PostAsJsonAsync("/api/repair-orders", new
        {
            customerId   = dfe.Id,
            jobTypeId    = 1,
            templateCode = "TP42N",
            rego         = "EDIT001",
            make         = "Isuzu",
            model        = "NPR",
            requiredDate = DateTimeOffset.UtcNow.AddMonths(3),
        });
        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await resp.Content.ReadFromJsonAsync<CreateRoResp>();

        var detail = await client.GetFromJsonAsync<RoDetailResp>($"/api/repair-orders/{created!.RoId}");
        var taskIds = detail!.Tasks.Select(t => t.Id).ToArray();

        return (created.RoId, taskIds);
    }

    private record CustomerItem(Guid Id, string Code, string Name);
    private record CreateRoResp(Guid RoId, string RoNumber, int TasksCreated);
    private record RoDetailResp(string Rego, string Status, TaskItem[] Tasks);
    private record TaskItem(Guid Id);
}
