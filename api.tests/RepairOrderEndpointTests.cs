using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class RepairOrderEndpointTests(ApiFixture fixture)
{
    // Sales user from seed data
    private static readonly Guid SalesUserId = new("11111111-1111-1111-1111-111111111111");
    // Customer id for DFE from seed data (we'll look it up via the /api/customers endpoint)
    // Template code guaranteed to exist from seed data
    private const string ValidTemplate = "TP42N";
    private const string ValidCustomerCode = "DFE";

    private HttpClient AuthenticatedClient(params string[] roles)
    {
        var client = fixture.CreateClient();
        var token = fixture.GenerateToken(SalesUserId, roles.Length > 0 ? roles : ["SALES"]);
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    // ── GET /api/customers ────────────────────────────────────────────────────

    [Fact]
    public async Task GetCustomers_ReturnsSeededCustomers()
    {
        var client = AuthenticatedClient();
        var response = await client.GetAsync("/api/customers");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<CustomerListItem[]>();
        body.Should().NotBeNullOrEmpty();
        body!.Should().Contain(c => c.Code == ValidCustomerCode);
    }

    // ── GET /api/templates ────────────────────────────────────────────────────

    [Fact]
    public async Task GetTemplates_ReturnsSeededTemplates()
    {
        var client = AuthenticatedClient();
        var response = await client.GetAsync("/api/templates");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<TemplateListItem[]>();
        body.Should().NotBeNullOrEmpty();
        body!.Should().Contain(t => t.Code == ValidTemplate);
    }

    [Fact]
    public async Task GetTemplates_WithQuery_FiltersResults()
    {
        var client = AuthenticatedClient();
        var response = await client.GetAsync("/api/templates?q=tipper");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<TemplateListItem[]>();
        body.Should().NotBeNullOrEmpty();
        body!.Should().AllSatisfy(t =>
            (t.DisplayName.Contains("tipper", StringComparison.OrdinalIgnoreCase)
            || t.BodyType.Contains("tipper", StringComparison.OrdinalIgnoreCase)
            || t.Code.Contains("tipper", StringComparison.OrdinalIgnoreCase)).Should().BeTrue());
    }

    [Fact]
    public async Task GetTemplateByCode_ReturnsOperations()
    {
        var client = AuthenticatedClient();
        var response = await client.GetAsync($"/api/templates/{ValidTemplate}");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<TemplateDetail>();
        body.Should().NotBeNull();
        body!.Code.Should().Be(ValidTemplate);
        body.Operations.Should().NotBeNullOrEmpty();
        body.Operations!.Should().AllSatisfy(op => op.EstimatedHours.Should().BeGreaterThan(0));
    }

    [Fact]
    public async Task GetTemplateByCode_NonExistent_Returns404()
    {
        var client = AuthenticatedClient();
        var response = await client.GetAsync("/api/templates/NOPE99");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── POST /api/repair-orders ───────────────────────────────────────────────

    [Fact]
    public async Task CreateRepairOrder_ValidRequest_Returns201WithRoDetails()
    {
        var client = AuthenticatedClient("SALES");
        var customerId = await GetDfeCustomerIdAsync();

        var payload = new
        {
            CustomerId = customerId,
            JobTypeId = 1,       // NEW_BUILD from schema seed
            TemplateCode = ValidTemplate,
            Rego = "ABC123",
            Make = "Isuzu",
            Model = "NPR",
            RequiredDate = DateTimeOffset.UtcNow.AddMonths(3),
            Priority = 3,
        };

        var response = await client.PostAsJsonAsync("/api/repair-orders", payload);

        response.StatusCode.Should().Be(HttpStatusCode.Created);
        response.Headers.Location.Should().NotBeNull();

        var body = await response.Content.ReadFromJsonAsync<CreateRoResponse>();
        body.Should().NotBeNull();
        body!.RoId.Should().NotBeEmpty();
        body.RoNumber.Should().MatchRegex(@"^RO\d{5}$");
        body.TasksCreated.Should().Be(12); // TP42N has 12 operations
    }

    [Fact]
    public async Task CreateRepairOrder_MissingRego_Returns400()
    {
        var client = AuthenticatedClient("SALES");
        var customerId = await GetDfeCustomerIdAsync();

        var payload = new
        {
            CustomerId = customerId,
            JobTypeId = 1,
            TemplateCode = ValidTemplate,
            Rego = "",
            RequiredDate = DateTimeOffset.UtcNow.AddMonths(1),
        };

        var response = await client.PostAsJsonAsync("/api/repair-orders", payload);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreateRepairOrder_InvalidVin_Returns400()
    {
        var client = AuthenticatedClient("SALES");
        var customerId = await GetDfeCustomerIdAsync();

        var payload = new
        {
            CustomerId = customerId,
            JobTypeId = 1,
            TemplateCode = ValidTemplate,
            Vin = "TOOSHORT",
            Rego = "XYZ999",
            RequiredDate = DateTimeOffset.UtcNow.AddMonths(1),
        };

        var response = await client.PostAsJsonAsync("/api/repair-orders", payload);

        response.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task CreateRepairOrder_DfeTt67f_Creates13Tasks()
    {
        var client = AuthenticatedClient("SALES");
        var customerId = await GetDfeCustomerIdAsync();

        var payload = new
        {
            CustomerId = customerId,
            JobTypeId = 1,
            TemplateCode = "DFE-TT67F",
            Rego = "TT001",
            Make = "Vawdrey",
            Model = "TT67F",
            RequiredDate = DateTimeOffset.UtcNow.AddMonths(4),
            Priority = 3,
        };

        var response = await client.PostAsJsonAsync("/api/repair-orders", payload);

        response.StatusCode.Should().Be(HttpStatusCode.Created);

        var body = await response.Content.ReadFromJsonAsync<CreateRoResponse>();
        body.Should().NotBeNull();
        body!.RoNumber.Should().MatchRegex(@"^RO\d{5}$");
        body.TasksCreated.Should().Be(13); // DFE-TT67F has 13 operations
    }

    [Fact]
    public async Task CreateRepairOrder_TemplateNotFound_Returns404()
    {
        var client = AuthenticatedClient("SALES");
        var customerId = await GetDfeCustomerIdAsync();

        var payload = new
        {
            CustomerId = customerId,
            JobTypeId = 1,
            TemplateCode = "NOTEXIST",
            Rego = "ABC999",
            RequiredDate = DateTimeOffset.UtcNow.AddMonths(1),
        };

        var response = await client.PostAsJsonAsync("/api/repair-orders", payload);

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task CreateRepairOrder_RequiresAuth_Returns401WhenNoToken()
    {
        var client = fixture.CreateClient();

        var response = await client.PostAsJsonAsync("/api/repair-orders", new { });

        response.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task CreateRepairOrder_WrongRole_Returns403()
    {
        var client = AuthenticatedClient("TECHNICIAN");
        var customerId = await GetDfeCustomerIdAsync();

        var payload = new
        {
            CustomerId = customerId,
            JobTypeId = 1,
            TemplateCode = ValidTemplate,
            Rego = "TECH001",
            RequiredDate = DateTimeOffset.UtcNow.AddMonths(1),
        };

        var response = await client.PostAsJsonAsync("/api/repair-orders", payload);

        response.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── GET /api/repair-orders/{id} ───────────────────────────────────────────

    [Fact]
    public async Task GetRepairOrderById_AfterCreate_ReturnsFullDetail()
    {
        var client = AuthenticatedClient("SALES");
        var customerId = await GetDfeCustomerIdAsync();

        var createPayload = new
        {
            CustomerId = customerId,
            JobTypeId = 1,
            TemplateCode = ValidTemplate,
            Rego = "GET001",
            Make = "Isuzu",
            Model = "NPR75",
            RequiredDate = DateTimeOffset.UtcNow.AddMonths(2),
            Priority = 2,
        };

        var createResponse = await client.PostAsJsonAsync("/api/repair-orders", createPayload);
        createResponse.StatusCode.Should().Be(HttpStatusCode.Created);

        var created = await createResponse.Content.ReadFromJsonAsync<CreateRoResponse>();
        created.Should().NotBeNull();

        var getResponse = await client.GetAsync($"/api/repair-orders/{created!.RoId}");
        getResponse.StatusCode.Should().Be(HttpStatusCode.OK);

        var ro = await getResponse.Content.ReadFromJsonAsync<RepairOrderDetail>();
        ro.Should().NotBeNull();
        ro!.RoNumber.Should().Be(created.RoNumber);
        ro.Status.Should().Be("DRAFT");
        ro.Tasks.Should().HaveCount(12);
        ro.Tasks.Should().AllSatisfy(t => t.StationName.Should().NotBeNullOrEmpty());
    }

    [Fact]
    public async Task GetRepairOrderById_NonExistent_Returns404()
    {
        var client = AuthenticatedClient("SALES");
        var response = await client.GetAsync($"/api/repair-orders/{Guid.NewGuid()}");

        response.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<Guid> GetDfeCustomerIdAsync()
    {
        var client = AuthenticatedClient();
        var customers = await client.GetFromJsonAsync<CustomerListItem[]>("/api/customers");
        var dfe = customers!.First(c => c.Code == ValidCustomerCode);
        return dfe.Id;
    }

    // ── Response DTOs ─────────────────────────────────────────────────────────

    private record CustomerListItem(Guid Id, string Code, string Name);
    private record TemplateListItem(string Code, string DisplayName, string BodyType, string? CustomerVariant, decimal? TotalHours);
    private record TemplateDetail(string Code, string DisplayName, string? Description, string BodyType, TemplateOperation[]? Operations);
    private record TemplateOperation(int Sequence, string OperationCode, string OperationName, decimal EstimatedHours);
    private record CreateRoResponse(Guid RoId, string RoNumber, int TasksCreated);
    private record RepairOrderDetail(Guid Id, string RoNumber, string Status, int Priority, RoTask[] Tasks);
    private record RoTask(Guid Id, int Sequence, string StationName, decimal EstimatedHours, string Status);
}

[CollectionDefinition("Api")]
public class ApiCollection : ICollectionFixture<ApiFixture>;
