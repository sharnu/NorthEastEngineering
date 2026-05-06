using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class DashboardEndpointTests(ApiFixture fixture)
{
    private static readonly Guid SupervisorUserId = new("22222222-2222-2222-2222-222222222222");
    private static readonly Guid SalesUserId = new("11111111-1111-1111-1111-111111111111");

    private HttpClient AuthenticatedClient(Guid userId, params string[] roles)
    {
        var client = fixture.CreateClient();
        var token = fixture.GenerateToken(userId, roles);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    // ── GET /api/dashboard/kpis ───────────────────────────────────────────────

    [Fact]
    public async Task GetKpis_AuthenticatedUser_ReturnsKpiShape()
    {
        var client = AuthenticatedClient(SalesUserId, "SALES");
        var response = await client.GetAsync("/api/dashboard/kpis");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<KpiResponse>();
        body.Should().NotBeNull();
        body!.ActiveRos.Should().BeGreaterThanOrEqualTo(0);
        body.UtilisationPct.Should().BeInRange(0, 100);
        body.InHospitalCount.Should().BeGreaterThanOrEqualTo(0);
        body.OnTimePct.Should().BeInRange(0, 100);
        body.OverdueCount.Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public async Task GetKpis_NoToken_Returns401()
    {
        var client = fixture.CreateClient();
        var response = await client.GetAsync("/api/dashboard/kpis");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── GET /api/dashboard/station-load ──────────────────────────────────────

    [Fact]
    public async Task GetStationLoad_AuthenticatedUser_ReturnsStationList()
    {
        var client = AuthenticatedClient(SalesUserId, "SALES");
        var response = await client.GetAsync("/api/dashboard/station-load");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<StationLoadItem[]>();
        body.Should().NotBeNull();
        body!.Should().NotBeEmpty();
        body!.Should().AllSatisfy(s =>
        {
            s.StationId.Should().BeGreaterThan(0);
            s.StationName.Should().NotBeNullOrEmpty();
            s.OpenTasks.Should().BeGreaterThanOrEqualTo(0);
        });
    }

    [Fact]
    public async Task GetStationLoad_NoToken_Returns401()
    {
        var client = fixture.CreateClient();
        var response = await client.GetAsync("/api/dashboard/station-load");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── GET /api/dashboard/top-variance ──────────────────────────────────────

    [Fact]
    public async Task GetTopVariance_AuthenticatedUser_ReturnsArray()
    {
        var client = AuthenticatedClient(SalesUserId, "SALES");
        var response = await client.GetAsync("/api/dashboard/top-variance");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<TopVarianceItem[]>();
        body.Should().NotBeNull();
        // Seed data may have no variance records; empty array is valid
        body!.Length.Should().BeLessThanOrEqualTo(5);
    }

    [Fact]
    public async Task GetTopVariance_NoToken_Returns401()
    {
        var client = fixture.CreateClient();
        var response = await client.GetAsync("/api/dashboard/top-variance");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── GET /api/dashboard/active-ros ────────────────────────────────────────

    [Fact]
    public async Task GetActiveRos_AsSupervisor_ReturnsActiveRoList()
    {
        // First create an RO so there is something to return
        var salesClient = AuthenticatedClient(SalesUserId, "SALES");
        var customers = await salesClient.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId = customers!.First().Id;

        var createPayload = new
        {
            CustomerId = customerId,
            JobTypeId = 1,
            TemplateCode = "TP42N",
            Rego = "DASH001",
            Make = "Isuzu",
            Model = "NPR",
            RequiredDate = DateTimeOffset.UtcNow.AddMonths(2),
            Priority = 3,
        };
        var createResp = await salesClient.PostAsJsonAsync("/api/repair-orders", createPayload);
        createResp.StatusCode.Should().Be(HttpStatusCode.Created);

        var supervisorClient = AuthenticatedClient(SupervisorUserId, "SUPERVISOR");
        var response = await supervisorClient.GetAsync("/api/dashboard/active-ros");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<ActiveRoItem[]>();
        body.Should().NotBeNull();
        body!.Should().NotBeEmpty();
        body!.Should().AllSatisfy(r =>
        {
            r.Id.Should().NotBeEmpty();
            r.RoNumber.Should().MatchRegex(@"^RO\d{5}$");
            r.CustomerName.Should().NotBeNullOrEmpty();
            r.TaskCount.Should().BeGreaterThan(0);
        });
    }

    [Fact]
    public async Task GetActiveRos_AsNonSupervisor_Returns403()
    {
        var client = AuthenticatedClient(SalesUserId, "SALES");
        var response = await client.GetAsync("/api/dashboard/active-ros");

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetActiveRos_NoToken_Returns401()
    {
        var client = fixture.CreateClient();
        var response = await client.GetAsync("/api/dashboard/active-ros");

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetActiveRos_FilterByStatus_ReturnsDraftOnly()
    {
        var salesClient = AuthenticatedClient(SalesUserId, "SALES");
        var customers = await salesClient.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId = customers!.First().Id;

        var createPayload = new
        {
            CustomerId = customerId,
            JobTypeId = 1,
            TemplateCode = "TP42N",
            Rego = "FILT001",
            Priority = 3,
        };
        await salesClient.PostAsJsonAsync("/api/repair-orders", createPayload);

        var supervisorClient = AuthenticatedClient(SupervisorUserId, "SUPERVISOR");
        var response = await supervisorClient.GetAsync("/api/dashboard/active-ros?status=DRAFT");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<ActiveRoItem[]>();
        body.Should().NotBeNull();
        // Newly created ROs start as DRAFT
        body!.Should().AllSatisfy(r => r.Status.Should().Be("DRAFT"));
    }

    // ── E3-S5: polling freshness ──────────────────────────────────────────────

    [Fact]
    public async Task GetKpis_ReflectsLiveData_AfterEachRoApproved()
    {
        var salesClient = AuthenticatedClient(SalesUserId, "SALES");
        var kpiClient   = AuthenticatedClient(SalesUserId, "SALES");

        var customers  = await salesClient.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId = customers!.First().Id;

        // Baseline: record current active-RO count (other tests may have created ROs)
        var baseline  = await kpiClient.GetFromJsonAsync<KpiResponse>("/api/dashboard/kpis");
        var baseCount = baseline!.ActiveRos;

        // Create + approve first RO
        var resp1 = await salesClient.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId   = customerId,
            JobTypeId    = 1,
            TemplateCode = "TP42N",
            Rego         = "POLL001",
            Priority     = 3,
        });
        var ro1 = await resp1.Content.ReadFromJsonAsync<CreatedRoResponse>();
        await SetRoStatus(ro1!.RoId, "APPROVED");

        var after1 = await kpiClient.GetFromJsonAsync<KpiResponse>("/api/dashboard/kpis");
        after1!.ActiveRos.Should().Be(baseCount + 1, "activeRos should increment after first RO approved");

        // Create + approve second RO — verifies data is live, not cached
        var resp2 = await salesClient.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId   = customerId,
            JobTypeId    = 1,
            TemplateCode = "TP42N",
            Rego         = "POLL002",
            Priority     = 3,
        });
        var ro2 = await resp2.Content.ReadFromJsonAsync<CreatedRoResponse>();
        await SetRoStatus(ro2!.RoId, "APPROVED");

        var after2 = await kpiClient.GetFromJsonAsync<KpiResponse>("/api/dashboard/kpis");
        after2!.ActiveRos.Should().Be(baseCount + 2, "activeRos should increment again after second RO approved");
    }

    private async Task SetRoStatus(Guid roId, string status)
    {
        await using var db = fixture.CreateDbContext();
        var ro = await db.RepairOrders.FindAsync(roId);
        ro!.Status = status;
        await db.SaveChangesAsync();
    }

    // ── Response DTOs ─────────────────────────────────────────────────────────

    private record KpiResponse(
        int ActiveRos,
        decimal HoursScheduled,
        decimal HoursUtilised,
        decimal UtilisationPct,
        int InHospitalCount,
        double OnTimePct,
        int OverdueCount);

    private record StationLoadItem(
        short StationId,
        string StationCode,
        string StationName,
        string? OwnerName,
        int OpenTasks,
        int ActiveTasks,
        decimal? HoursRemaining);

    private record TopVarianceItem(
        Guid TaskId,
        string RoNumber,
        string OperationName,
        string StationName,
        decimal EstimatedHours,
        decimal ActualHours,
        decimal DeltaHours,
        decimal? DeltaPct,
        string ReasonName,
        string? TechnicianName);

    private record ActiveRoItem(
        Guid Id,
        string RoNumber,
        string CustomerName,
        string TemplateCode,
        string BodyType,
        string? CurrentStage,
        string Status,
        int Priority,
        DateTimeOffset? RequiredDate,
        decimal HoursScheduled,
        decimal HoursUtilised,
        int TaskCount,
        int TasksCompleted,
        decimal CompletionPct);

    private record CustomerItem(Guid Id, string Code, string Name);
    private record CreatedRoResponse(Guid RoId, string RoNumber, int TasksCreated);
}
