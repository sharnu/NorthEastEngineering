using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Domain;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class SchedulingEndpointTests(ApiFixture fixture)
{
    private static readonly Guid SupervisorUserId = new("33333333-3333-3333-3333-333333333333");
    private static readonly Guid SalesUserId = new("11111111-1111-1111-1111-111111111111");
    private const string ValidTemplate = "TP42N";
    private const string ValidCustomerCode = "DFE";

    // ── E10-S2: Backlog gate logic ────────────────────────────────────────────

    [Fact]
    public async Task GetBacklog_NewRo_AllGatesFalse()
    {
        var roId = await CreateRoAsync();

        var body = await SupervisorClient().GetFromJsonAsync<BacklogItem[]>("/api/scheduling/backlog");

        var row = body!.FirstOrDefault(r => r.RoId == roId);
        row.Should().NotBeNull();
        row!.Gates.DraftingComplete.Should().BeFalse();
        row.Gates.CustomerApproved.Should().BeFalse();
        row.Gates.ChassisAllocated.Should().BeFalse();
        row.Gates.AllGreen.Should().BeFalse();
    }

    [Fact]
    public async Task GetBacklog_DraftingStatusCompleted_DraftingGateTrue()
    {
        var roId = await CreateRoAsync();
        await using (var db = fixture.CreateDbContext())
        {
            var ro = await db.RepairOrders.FindAsync(roId);
            ro!.DraftingStatus = "COMPLETED";
            await db.SaveChangesAsync();
        }

        var body = await SupervisorClient().GetFromJsonAsync<BacklogItem[]>("/api/scheduling/backlog");
        var row = body!.First(r => r.RoId == roId);

        row.Gates.DraftingComplete.Should().BeTrue();
        row.Gates.CustomerApproved.Should().BeFalse();
        row.Gates.ChassisAllocated.Should().BeFalse();
        row.Gates.AllGreen.Should().BeFalse();
    }

    [Fact]
    public async Task GetBacklog_CustomerApprovalSigned_CustomerGateTrue()
    {
        var roId = await CreateRoAsync();
        await using (var db = fixture.CreateDbContext())
        {
            db.CustomerApprovals.Add(new CustomerApproval
            {
                Id = Guid.NewGuid(),
                RoId = roId,
                DocumentType = "LAYOUT",
                SignedAt = DateTimeOffset.UtcNow,
                SignedByName = "Test Signer",
                CreatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var body = await SupervisorClient().GetFromJsonAsync<BacklogItem[]>("/api/scheduling/backlog");
        var row = body!.First(r => r.RoId == roId);

        row.Gates.DraftingComplete.Should().BeFalse();
        row.Gates.CustomerApproved.Should().BeTrue();
        row.Gates.ChassisAllocated.Should().BeFalse();
        row.Gates.AllGreen.Should().BeFalse();
    }

    [Fact]
    public async Task GetBacklog_ChassisAllocatedToRo_ChassisGateTrue()
    {
        var roId = await CreateRoAsync();
        await using (var db = fixture.CreateDbContext())
        {
            db.ChassisInventory.Add(new ChassisInventory
            {
                Id = Guid.NewGuid(),
                ChassisNumber = "TST-" + Guid.NewGuid().ToString("N")[..8],
                Description = "Test Chassis",
                ChassisClass = "N",
                Status = "ALLOCATED",
                AllocatedToRo = roId,
                AllocatedAt = DateTimeOffset.UtcNow,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var body = await SupervisorClient().GetFromJsonAsync<BacklogItem[]>("/api/scheduling/backlog");
        var row = body!.First(r => r.RoId == roId);

        row.Gates.DraftingComplete.Should().BeFalse();
        row.Gates.CustomerApproved.Should().BeFalse();
        row.Gates.ChassisAllocated.Should().BeTrue();
        row.Gates.AllGreen.Should().BeFalse();
    }

    [Fact]
    public async Task GetBacklog_AllGatesTrue_AllGreenAndSortsBeforeIncompleteRow()
    {
        var greenRoId = await CreateRoAsync();
        var greyRoId = await CreateRoAsync(); // stays all-false

        await using (var db = fixture.CreateDbContext())
        {
            var ro = await db.RepairOrders.FindAsync(greenRoId);
            ro!.DraftingStatus = "COMPLETED";

            db.CustomerApprovals.Add(new CustomerApproval
            {
                Id = Guid.NewGuid(),
                RoId = greenRoId,
                DocumentType = "LAYOUT",
                SignedAt = DateTimeOffset.UtcNow,
                SignedByName = "Approver",
                CreatedAt = DateTimeOffset.UtcNow,
            });

            db.ChassisInventory.Add(new ChassisInventory
            {
                Id = Guid.NewGuid(),
                ChassisNumber = "TST-" + Guid.NewGuid().ToString("N")[..8],
                Description = "Full Gate Chassis",
                ChassisClass = "F",
                Status = "ALLOCATED",
                AllocatedToRo = greenRoId,
                AllocatedAt = DateTimeOffset.UtcNow,
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            });
            await db.SaveChangesAsync();
        }

        var body = await SupervisorClient().GetFromJsonAsync<BacklogItem[]>("/api/scheduling/backlog");

        var greenRow = body!.First(r => r.RoId == greenRoId);
        greenRow.Gates.AllGreen.Should().BeTrue();
        greenRow.Gates.DraftingComplete.Should().BeTrue();
        greenRow.Gates.CustomerApproved.Should().BeTrue();
        greenRow.Gates.ChassisAllocated.Should().BeTrue();

        var greenIndex = Array.FindIndex(body!, r => r.RoId == greenRoId);
        var greyIndex = Array.FindIndex(body!, r => r.RoId == greyRoId);
        greenIndex.Should().BeLessThan(greyIndex, "allGreen rows must sort before incomplete rows");
    }

    [Fact]
    public async Task GetBacklog_TechnicianRole_Returns403()
    {
        var client = fixture.CreateClient();
        var token = fixture.GenerateToken(SalesUserId, "TECHNICIAN");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var response = await client.GetAsync("/api/scheduling/backlog");
        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── E10-S5: Schedule action ───────────────────────────────────────────────

    [Fact]
    public async Task ScheduleRo_ValidMonday_Returns200UpdatesDbAndWritesDomainEvent()
    {
        var roId = await CreateRoAsync();
        var nextMonday = NextMonday();

        var response = await SupervisorClient().PutAsJsonAsync(
            $"/api/scheduling/ros/{roId}/schedule",
            new { startWeek = nextMonday.ToString("yyyy-MM-dd") });

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        await using var db = fixture.CreateDbContext();
        var ro = await db.RepairOrders.FindAsync(roId);
        ro!.ScheduledStartWeek.Should().Be(nextMonday);

        var evt = await db.DomainEvents
            .Where(e => e.AggregateId == roId && e.EventType == "RoScheduled")
            .FirstOrDefaultAsync();
        evt.Should().NotBeNull();
    }

    [Fact]
    public async Task ScheduleRo_TuesdayDate_Returns400WithMessage()
    {
        var roId = await CreateRoAsync();
        var tuesday = NextMonday().AddDays(1);

        var response = await SupervisorClient().PutAsJsonAsync(
            $"/api/scheduling/ros/{roId}/schedule",
            new { startWeek = tuesday.ToString("yyyy-MM-dd") });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("Monday");
    }

    [Fact]
    public async Task ScheduleRo_PastMonday_Returns400WithMessage()
    {
        var roId = await CreateRoAsync();
        var lastMonday = PastMonday();

        var response = await SupervisorClient().PutAsJsonAsync(
            $"/api/scheduling/ros/{roId}/schedule",
            new { startWeek = lastMonday.ToString("yyyy-MM-dd") });

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
        var body = await response.Content.ReadAsStringAsync();
        body.Should().Contain("past");
    }

    [Fact]
    public async Task ScheduleRo_Reschedule_OverwritesWithNewWeek()
    {
        var roId = await CreateRoAsync();
        var week1 = NextMonday();
        var week2 = week1.AddDays(7);
        var client = SupervisorClient();

        var r1 = await client.PutAsJsonAsync(
            $"/api/scheduling/ros/{roId}/schedule",
            new { startWeek = week1.ToString("yyyy-MM-dd") });
        r1.StatusCode.Should().Be(HttpStatusCode.OK);

        var r2 = await client.PutAsJsonAsync(
            $"/api/scheduling/ros/{roId}/schedule",
            new { startWeek = week2.ToString("yyyy-MM-dd") });
        r2.StatusCode.Should().Be(HttpStatusCode.OK);

        await using var db = fixture.CreateDbContext();
        var ro = await db.RepairOrders.FindAsync(roId);
        ro!.ScheduledStartWeek.Should().Be(week2);
    }

    [Fact]
    public async Task ScheduleRo_NonExistentRo_Returns404()
    {
        var response = await SupervisorClient().PutAsJsonAsync(
            $"/api/scheduling/ros/{Guid.NewGuid()}/schedule",
            new { startWeek = NextMonday().ToString("yyyy-MM-dd") });

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private HttpClient SupervisorClient()
    {
        var client = fixture.CreateClient();
        var token = fixture.GenerateToken(SupervisorUserId, "SUPERVISOR", "STATION_OWNER");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private async Task<Guid> CreateRoAsync()
    {
        var client = fixture.CreateClient();
        var token = fixture.GenerateToken(SalesUserId, "SALES");
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);

        var customers = await client.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId = customers!.First(c => c.Code == ValidCustomerCode).Id;

        var response = await client.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId = customerId,
            JobTypeId = 1,
            TemplateCode = ValidTemplate,
            Rego = "SCH" + Guid.NewGuid().ToString("N")[..8],
            RequiredDate = DateTimeOffset.UtcNow.AddMonths(3),
            Priority = 3,
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await response.Content.ReadFromJsonAsync<CreateRoResponse>();
        return created!.RoId;
    }

    // Returns the next Monday strictly after today (never today itself)
    private static DateOnly NextMonday()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var daysToMonday = ((int)DayOfWeek.Monday - (int)today.DayOfWeek + 7) % 7;
        return today.AddDays(daysToMonday == 0 ? 7 : daysToMonday);
    }

    // Returns the most recent Monday strictly before today
    private static DateOnly PastMonday()
    {
        var today = DateOnly.FromDateTime(DateTime.UtcNow);
        var daysSinceMonday = ((int)today.DayOfWeek - (int)DayOfWeek.Monday + 7) % 7;
        return today.AddDays(-(daysSinceMonday == 0 ? 7 : daysSinceMonday));
    }

    // ── Response DTOs ─────────────────────────────────────────────────────────

    private record CustomerItem(Guid Id, string Code, string Name);
    private record CreateRoResponse(Guid RoId, string RoNumber, int TasksCreated);
    private record BacklogItem(Guid RoId, string RoNumber, GatesDto Gates);
    private record GatesDto(bool DraftingComplete, bool CustomerApproved, bool ChassisAllocated, bool AllGreen);
}
