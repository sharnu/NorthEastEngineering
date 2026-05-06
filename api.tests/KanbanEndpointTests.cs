using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Nee.Api.Domain;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class KanbanEndpointTests(ApiFixture fixture)
{
    private static readonly Guid SupervisorUserId = new("22222222-2222-2222-2222-222222222222");
    private static readonly Guid SalesUserId      = new("11111111-1111-1111-1111-111111111111");
    private static readonly Guid PeterRogersId    = new("44444444-4444-4444-4444-444444444444");

    private const short FabLineStationId = 20;

    private HttpClient AuthClient(Guid userId, params string[] roles)
    {
        var client = fixture.CreateClient();
        var token  = fixture.GenerateToken(userId, roles);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    // ── GET /api/kanban ───────────────────────────────────────────────────────

    [Fact]
    public async Task GetKanbanBoard_ReturnsAllActiveStations()
    {
        var client   = AuthClient(SalesUserId, "SALES");
        var response = await client.GetAsync("/api/kanban");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var board = await response.Content.ReadFromJsonAsync<KanbanBoardResponse>();
        board.Should().NotBeNull();
        board!.Stations.Should().HaveCount(11, "seed data has 11 active stations");
        board.Stations.Should().AllSatisfy(s =>
        {
            s.StationId.Should().BeGreaterThan(0);
            s.StationName.Should().NotBeNullOrEmpty();
            s.Cards.Should().NotBeNull();
        });
    }

    [Fact]
    public async Task GetKanbanBoard_NoToken_Returns401()
    {
        var client   = fixture.CreateClient();
        var response = await client.GetAsync("/api/kanban");
        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── GET /api/kanban?stationId=20 ──────────────────────────────────────────

    [Fact]
    public async Task GetKanbanBoard_StationFilter_ReturnsOnlyThatStation()
    {
        var client   = AuthClient(SalesUserId, "SALES");
        var response = await client.GetAsync($"/api/kanban?stationId={FabLineStationId}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var board = await response.Content.ReadFromJsonAsync<KanbanBoardResponse>();
        board!.Stations.Should().HaveCount(1);
        board.Stations[0].StationId.Should().Be(FabLineStationId);
        board.Stations[0].StationCode.Should().Be("FAB_LINE");
    }

    // ── Tasks appear after RO creation ───────────────────────────────────────

    [Fact]
    public async Task GetKanbanBoard_AfterRoCreation_TasksAtCorrectStation()
    {
        var salesClient = AuthClient(SalesUserId, "SALES");
        var customers   = await salesClient.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId  = customers!.First().Id;

        var createResp = await salesClient.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId   = customerId,
            JobTypeId    = 1,
            TemplateCode = "TP42N",
            Rego         = "KAN001",
            Priority     = 2,
        });
        createResp.StatusCode.Should().Be(HttpStatusCode.Created);

        var board = await salesClient.GetFromJsonAsync<KanbanBoardResponse>("/api/kanban");
        var fabLine = board!.Stations.First(s => s.StationId == FabLineStationId);

        // TP42N has 4 ops at FAB_LINE; they should all appear inside one card's task list
        var allTasks = fabLine.Cards.SelectMany(c => c.Tasks).ToList();
        allTasks.Should().HaveCountGreaterThanOrEqualTo(4,
            "TP42N template has 4 operations at FAB_LINE");
        allTasks.Should().AllSatisfy(t =>
        {
            t.OperationName.Should().NotBeNullOrEmpty();
            t.EstimatedHours.Should().BeGreaterThan(0);
            t.Status.Should().Be("PENDING");
        });

        // Each card carries the RO number
        fabLine.Cards.Should().AllSatisfy(c => c.RoNumber.Should().MatchRegex(@"^RO\d{5}$"));
    }

    // ── Technician assignment ─────────────────────────────────────────────────

    [Fact]
    public async Task AssignTechnician_ValidUser_Returns204AndUpdatesAssignee()
    {
        var salesClient = AuthClient(SalesUserId, "SALES");
        var customers   = await salesClient.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId  = customers!.First().Id;

        await salesClient.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId   = customerId,
            JobTypeId    = 1,
            TemplateCode = "TP42N",
            Rego         = "KAN002",
            Priority     = 2,
        });

        var board   = await salesClient.GetFromJsonAsync<KanbanBoardResponse>("/api/kanban");
        var fabLine = board!.Stations.First(s => s.StationId == FabLineStationId);
        var taskId  = fabLine.Cards.First().Tasks.First().Id;

        var supClient  = AuthClient(SupervisorUserId, "SUPERVISOR");
        var assignResp = await supClient.PutAsJsonAsync(
            $"/api/job-tasks/{taskId}/assign",
            new { UserId = PeterRogersId });

        assignResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var updatedBoard   = await salesClient.GetFromJsonAsync<KanbanBoardResponse>("/api/kanban");
        var updatedFabLine = updatedBoard!.Stations.First(s => s.StationId == FabLineStationId);
        var updatedTask    = updatedFabLine.Cards.SelectMany(c => c.Tasks).First(t => t.Id == taskId);

        updatedTask.AssignedToName.Should().Be("Peter Rogers");
        updatedTask.Status.Should().Be("ASSIGNED");
    }

    [Fact]
    public async Task AssignTechnician_WrongStation_Returns400()
    {
        var salesClient = AuthClient(SalesUserId, "SALES");
        var customers   = await salesClient.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId  = customers!.First().Id;

        await salesClient.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId   = customerId,
            JobTypeId    = 1,
            TemplateCode = "TP42N",
            Rego         = "KAN003",
            Priority     = 3,
        });

        var board   = await salesClient.GetFromJsonAsync<KanbanBoardResponse>("/api/kanban");
        var fabLine = board!.Stations.First(s => s.StationId == FabLineStationId);
        var taskId  = fabLine.Cards.First().Tasks.First().Id;

        var supClient  = AuthClient(SupervisorUserId, "SUPERVISOR");
        var assignResp = await supClient.PutAsJsonAsync(
            $"/api/job-tasks/{taskId}/assign",
            new { UserId = SupervisorUserId });

        assignResp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task AssignTechnician_Unassign_Returns204AndClearsAssignee()
    {
        var salesClient = AuthClient(SalesUserId, "SALES");
        var customers   = await salesClient.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId  = customers!.First().Id;

        await salesClient.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId   = customerId,
            JobTypeId    = 1,
            TemplateCode = "TP42N",
            Rego         = "KAN004",
            Priority     = 3,
        });

        var board   = await salesClient.GetFromJsonAsync<KanbanBoardResponse>("/api/kanban");
        var fabLine = board!.Stations.First(s => s.StationId == FabLineStationId);
        var taskId  = fabLine.Cards.First().Tasks.First().Id;

        var supClient = AuthClient(SupervisorUserId, "SUPERVISOR");

        await supClient.PutAsJsonAsync($"/api/job-tasks/{taskId}/assign", new { UserId = PeterRogersId });

        var unassignResp = await supClient.PutAsJsonAsync(
            $"/api/job-tasks/{taskId}/assign",
            new { UserId = (Guid?)null });

        unassignResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var updatedBoard = await salesClient.GetFromJsonAsync<KanbanBoardResponse>("/api/kanban");
        var updatedTask  = updatedBoard!.Stations
            .First(s => s.StationId == FabLineStationId)
            .Cards.SelectMany(c => c.Tasks).First(t => t.Id == taskId);

        updatedTask.AssignedToName.Should().BeNull();
        updatedTask.Status.Should().Be("PENDING");
    }

    [Fact]
    public async Task AssignTechnician_AsSales_Returns403()
    {
        var salesClient  = AuthClient(SalesUserId, "SALES");
        var assignResp = await salesClient.PutAsJsonAsync(
            $"/api/job-tasks/{Guid.NewGuid()}/assign",
            new { UserId = PeterRogersId });

        assignResp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── GET /api/stations/{id}/technicians ───────────────────────────────────

    [Fact]
    public async Task GetStationTechnicians_ReturnsPeterForFabLine()
    {
        var client   = AuthClient(SalesUserId, "SALES");
        var response = await client.GetAsync($"/api/stations/{FabLineStationId}/technicians");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var techs = await response.Content.ReadFromJsonAsync<StationTechnicianItem[]>();
        techs.Should().NotBeNull();
        techs!.Should().Contain(t => t.FullName == "Peter Rogers" && t.IsPrimary);
    }

    // ── E22-S1: grouped card shape ────────────────────────────────────────────

    [Fact]
    public async Task GetBoard_GroupsByRoAndStation()
    {
        var salesClient = AuthClient(SalesUserId, "SALES");
        var customers   = await salesClient.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId  = customers!.First().Id;

        // Two ROs from the same template → two separate cards at FAB_LINE
        await salesClient.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId = customerId, JobTypeId = 1, TemplateCode = "TP42N",
            Rego = "GRP001", Priority = 2,
        });
        await salesClient.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId = customerId, JobTypeId = 1, TemplateCode = "TP42N",
            Rego = "GRP002", Priority = 2,
        });

        var board   = await salesClient.GetFromJsonAsync<KanbanBoardResponse>("/api/kanban");
        var fabLine = board!.Stations.First(s => s.StationId == FabLineStationId);

        fabLine.Cards.Should().HaveCountGreaterThanOrEqualTo(2,
            "each RO yields its own card at the same station");

        var roIds = fabLine.Cards.Select(c => c.RoId).Distinct().ToList();
        roIds.Should().HaveCountGreaterThanOrEqualTo(2,
            "cards from different ROs must have distinct RoIds");
    }

    [Fact]
    public async Task GetBoard_IncludesPdfUrl()
    {
        var salesClient = AuthClient(SalesUserId, "SALES");
        var customers   = await salesClient.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId  = customers!.First().Id;

        var createResp = await salesClient.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId = customerId, JobTypeId = 1, TemplateCode = "TP42N",
            Rego = "PDF001", Priority = 2,
        });
        createResp.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await createResp.Content.ReadFromJsonAsync<CreateRoResult>();

        await using var db = fixture.CreateDbContext();
        db.Attachments.Add(new Attachment
        {
            Id            = Guid.NewGuid(),
            EntityType    = "RepairOrder",
            EntityId      = created!.RoId,
            Category      = "SOURCE_PDF",
            FileName      = "source.pdf",
            ContentType   = "application/pdf",
            SizeBytes     = 1024,
            BlobContainer = "uploads",
            BlobPath      = "test/source.pdf",
            UploadedBy    = SalesUserId,
            UploadedAt    = DateTimeOffset.UtcNow,
        });
        await db.SaveChangesAsync();

        var board   = await salesClient.GetFromJsonAsync<KanbanBoardResponse>("/api/kanban");
        var fabLine = board!.Stations.First(s => s.StationId == FabLineStationId);
        var card    = fabLine.Cards.First(c => c.RoId == created.RoId);

        card.SourcePdfUrl.Should().Be("/uploads/test/source.pdf");
    }

    [Fact]
    public async Task GetBoard_TrackFieldReflectsTasks()
    {
        var salesClient = AuthClient(SalesUserId, "SALES");
        var customers   = await salesClient.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId  = customers!.First().Id;

        await salesClient.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId = customerId, JobTypeId = 1, TemplateCode = "TP42N",
            Rego = "TRK001", Priority = 2,
        });

        var board   = await salesClient.GetFromJsonAsync<KanbanBoardResponse>("/api/kanban");
        var fabLine = board!.Stations.First(s => s.StationId == FabLineStationId);
        var card    = fabLine.Cards.First(c => c.Tasks.Any(t => t.Status == "PENDING"));

        // All FAB_LINE ops on a tipper are BODY track; card must reflect that
        card.Tasks.Should().AllSatisfy(t => t.FlowTrack.Should().Be("BODY"));
        card.Track.Should().Be("BODY");
    }

    // ── Response DTOs ─────────────────────────────────────────────────────────

    private record KanbanBoardResponse(KanbanStationItem[] Stations);

    private record KanbanStationItem(
        short StationId,
        string StationCode,
        string StationName,
        string? OwnerName,
        KanbanCardItem[] Cards);

    private record KanbanCardItem(
        Guid RoId,
        string RoNumber,
        string CustomerName,
        short Priority,
        DateTimeOffset? RequiredDate,
        string? BodyType,
        string Track,
        short StationId,
        string StationCode,
        string StationName,
        string GateState,
        string? GateReason,
        decimal EstimatedHours,
        decimal ActualHours,
        int TotalTasks,
        int CompletedTasks,
        string? SourcePdfUrl,
        bool HasManualOverride,
        KanbanCardTaskItem[] Tasks);

    private record KanbanCardTaskItem(
        Guid Id,
        int Sequence,
        string JobCodeLine,
        string OperationName,
        Guid? AssignedToUserId,
        string? AssignedToName,
        decimal EstimatedHours,
        decimal ActualHours,
        string Status,
        string FlowTrack,
        string? Notes);

    private record StationTechnicianItem(Guid UserId, string FullName, bool IsPrimary, int SkillLevel);
    private record CustomerItem(Guid Id, string Code, string Name);
    private record CreateRoResult(Guid RoId, string RoNumber, int TasksCreated);
}
