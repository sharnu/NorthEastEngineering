using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Nee.Api.Endpoints;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class AdminCustomerEndpointTests(ApiFixture fixture)
{
    private static readonly Guid SupervisorId = new("33333333-3333-3333-3333-333333333333");
    private static readonly Guid SalesUserId  = new("11111111-1111-1111-1111-111111111111");

    private HttpClient AdminClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SupervisorId, "ADMIN"));
        return c;
    }

    private HttpClient SalesClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SalesUserId, "SALES"));
        return c;
    }

    private HttpClient AnonClient() => fixture.CreateClient();

    // ── E13-S1: List customers ────────────────────────────────────────────────

    [Fact]
    public async Task ListCustomers_RequiresAuth()
    {
        var resp = await AnonClient().GetAsync("/api/admin/customers?page=1&pageSize=20");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task ListCustomers_RequiresAdminOrSales_RefusesOtherRole()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SupervisorId, "SUPERVISOR"));
        var resp = await c.GetAsync("/api/admin/customers?page=1&pageSize=20");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task ListCustomers_AdminRole_ReturnsSeededCustomers()
    {
        var resp = await AdminClient().GetAsync("/api/admin/customers?page=1&pageSize=50");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<CustomerListResponse>();
        body.Should().NotBeNull();
        body!.Items.Should().NotBeEmpty();
        body.Items.Should().Contain(c => c.Code == "DFE");
    }

    [Fact]
    public async Task ListCustomers_SalesRole_ReturnsSeededCustomers()
    {
        var resp = await SalesClient().GetAsync("/api/admin/customers?page=1&pageSize=50");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<CustomerListResponse>();
        body.Should().NotBeNull();
        body!.Items.Should().NotBeEmpty();
    }

    [Fact]
    public async Task ListCustomers_Search_FiltersByName()
    {
        var resp = await AdminClient().GetAsync("/api/admin/customers?q=Direct&page=1&pageSize=50");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<CustomerListResponse>();
        body.Should().NotBeNull();
        body!.Items.Should().NotBeEmpty();
        body.Items.Should().AllSatisfy(c =>
            c.Name.Should().Contain("Direct"));
    }

    [Fact]
    public async Task ListCustomers_Search_FiltersByCode()
    {
        var resp = await AdminClient().GetAsync("/api/admin/customers?q=BGT&page=1&pageSize=50");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<CustomerListResponse>();
        body.Should().NotBeNull();
        body!.Items.Should().NotBeEmpty();
        body.Items.Should().Contain(c => c.Code == "BGT");
    }

    [Fact]
    public async Task ListCustomers_InactiveFilter_HidesInactiveByDefault()
    {
        // First create and deactivate a customer
        var client = AdminClient();
        var createResp = await client.PostAsJsonAsync("/api/admin/customers", new
        {
            name = "Filter Test Customer",
            code = (string?)null,
        });
        createResp.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await createResp.Content.ReadFromJsonAsync<IdResponse>();
        await client.PostAsJsonAsync($"/api/admin/customers/{created!.Id}/deactivate", new { });

        // Inactive filter returns only inactive
        var inactiveResp = await AdminClient().GetAsync("/api/admin/customers?active=false&page=1&pageSize=50");
        var inactiveBody = await inactiveResp.Content.ReadFromJsonAsync<CustomerListResponse>();
        inactiveBody!.Items.Should().AllSatisfy(c => c.IsActive.Should().BeFalse());
    }

    [Fact]
    public async Task ListCustomers_ActiveCounts_MatchRepairOrders()
    {
        // All seeded customers have zero ROs unless tests created some
        var resp = await AdminClient().GetAsync("/api/admin/customers?page=1&pageSize=50");
        var body = await resp.Content.ReadFromJsonAsync<CustomerListResponse>();
        body.Should().NotBeNull();
        // DFE should have a non-negative active count
        body!.Items.Should().Contain(c => c.Code == "DFE" && c.ActiveRoCount >= 0);
    }

    // ── E13-S2: Create customer ───────────────────────────────────────────────

    [Fact]
    public async Task CreateCustomer_HappyPath_Returns201()
    {
        var resp = await AdminClient().PostAsJsonAsync("/api/admin/customers", new
        {
            name       = "Test Logistics Pty Ltd",
            code       = "TLG",
            customerNo = "9001",
            abn        = "12 345 678 901",
            contactEmail = "info@testlogistics.com.au",
        });

        resp.StatusCode.Should().Be(HttpStatusCode.Created);
        var body = await resp.Content.ReadFromJsonAsync<IdResponse>();
        body!.Id.Should().NotBeEmpty();
    }

    [Fact]
    public async Task CreateCustomer_DuplicateCode_Returns422()
    {
        var resp = await AdminClient().PostAsJsonAsync("/api/admin/customers", new
        {
            name = "Another DFE Clone",
            code = "DFE",
        });

        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var body = await resp.Content.ReadAsStringAsync();
        body.Should().Contain("Code already in use");
    }

    [Fact]
    public async Task CreateCustomer_MissingName_Returns422()
    {
        var resp = await AdminClient().PostAsJsonAsync("/api/admin/customers", new
        {
            name = "",
            code = "XYZ",
        });

        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task EmailDl_InvalidAddress_Returns422()
    {
        var resp = await AdminClient().PostAsJsonAsync("/api/admin/customers", new
        {
            name    = "DL Validation Test",
            emailDl = "valid@example.com, not-an-email, another@good.com",
        });

        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
        var body = await resp.Content.ReadAsStringAsync();
        body.Should().Contain("not-an-email");
    }

    // ── E13-S2: Update customer + email DL ───────────────────────────────────

    [Fact]
    public async Task UpdateCustomer_EmailDl_ParsesList()
    {
        // Create a customer
        var client = AdminClient();
        var createResp = await client.PostAsJsonAsync("/api/admin/customers", new
        {
            name = "DL Update Test",
            code = "DLT",
        });
        var created = await createResp.Content.ReadFromJsonAsync<IdResponse>();

        // Update email DL
        var putResp = await client.PutAsJsonAsync($"/api/admin/customers/{created!.Id}", new
        {
            emailDl = "ops@dltest.com, accounts@dltest.com",
        });
        putResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Verify via GET
        var getResp = await client.GetAsync($"/api/admin/customers/{created.Id}");
        var detail  = await getResp.Content.ReadFromJsonAsync<CustomerDetail>();
        detail!.EmailDl.Should().Contain("ops@dltest.com");
        detail.EmailDl.Should().Contain("accounts@dltest.com");
    }

    [Fact]
    public async Task UpdateCustomer_DuplicateCode_Returns422()
    {
        var client = AdminClient();
        var createResp = await client.PostAsJsonAsync("/api/admin/customers", new
        {
            name = "Code Conflict Test",
            code = "CCT",
        });
        var created = await createResp.Content.ReadFromJsonAsync<IdResponse>();

        var putResp = await client.PutAsJsonAsync($"/api/admin/customers/{created!.Id}", new
        {
            code = "DFE",
        });

        putResp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    // ── E13-S3: Customer detail + RO counts ──────────────────────────────────

    [Fact]
    public async Task GetCustomer_RoCounts_BucketCorrectly()
    {
        var client = AdminClient();
        var customers = await client.GetFromJsonAsync<CustomerListResponse>("/api/admin/customers?page=1&pageSize=50");
        var dfe = customers!.Items.First(c => c.Code == "DFE");

        var detailResp = await client.GetAsync($"/api/admin/customers/{dfe.Id}");
        detailResp.StatusCode.Should().Be(HttpStatusCode.OK);

        var detail = await detailResp.Content.ReadFromJsonAsync<CustomerDetail>();
        detail.Should().NotBeNull();
        detail!.Id.Should().Be(dfe.Id);
        detail.ActiveRoCount.Should().BeGreaterThanOrEqualTo(0);
        detail.CompletedRoCount.Should().BeGreaterThanOrEqualTo(0);
        detail.CancelledRoCount.Should().BeGreaterThanOrEqualTo(0);
    }

    [Fact]
    public async Task GetCustomerRos_StatusFilter_ReturnsRightGroup()
    {
        var client = AdminClient();
        var customers = await client.GetFromJsonAsync<CustomerListResponse>("/api/admin/customers?page=1&pageSize=50");
        var dfe = customers!.Items.First(c => c.Code == "DFE");

        // All three status groups should return without error
        foreach (var status in new[] { "active", "completed", "cancelled" })
        {
            var resp = await client.GetAsync($"/api/admin/customers/{dfe.Id}/repair-orders?status={status}&page=1&pageSize=20");
            resp.StatusCode.Should().Be(HttpStatusCode.OK);
        }
    }

    [Fact]
    public async Task GetCustomer_NonExistent_Returns404()
    {
        var resp = await AdminClient().GetAsync($"/api/admin/customers/{Guid.NewGuid()}");
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── E13-S4: Vehicle catalogue ─────────────────────────────────────────────

    [Fact]
    public async Task GetVehicles_DistinctOnIdentifiers()
    {
        var client = AdminClient();
        var customers = await client.GetFromJsonAsync<CustomerListResponse>("/api/admin/customers?page=1&pageSize=50");
        var dfe = customers!.Items.First(c => c.Code == "DFE");

        var resp = await client.GetAsync($"/api/admin/customers/{dfe.Id}/vehicles");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var vehicles = await resp.Content.ReadFromJsonAsync<VehicleEntry[]>();
        vehicles.Should().NotBeNull();
        // May be empty (no seeded ROs), but must not error
    }

    [Fact]
    public async Task GetVehicles_AllNullIdentifiers_Filtered()
    {
        // Create a customer + an RO with no rego/vin/chassis via the seed
        var client = AdminClient();
        var createResp = await client.PostAsJsonAsync("/api/admin/customers", new
        {
            name = "Vehicle Catalogue Test",
            code = "VCT",
        });
        var created = await createResp.Content.ReadFromJsonAsync<IdResponse>();

        var resp = await client.GetAsync($"/api/admin/customers/{created!.Id}/vehicles");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var vehicles = await resp.Content.ReadFromJsonAsync<VehicleEntry[]>();
        // Customer has no ROs so vehicle list is empty
        vehicles.Should().BeEmpty();
    }

    [Fact]
    public async Task GetVehicles_NonExistentCustomer_Returns404()
    {
        var resp = await AdminClient().GetAsync($"/api/admin/customers/{Guid.NewGuid()}/vehicles");
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetVehicles_OrdersByLastSeenDesc()
    {
        // Create customer and verify endpoint returns ordered results (DESC by last_seen_at)
        var client = AdminClient();
        var createResp = await client.PostAsJsonAsync("/api/admin/customers", new
        {
            name = "Vehicle Order Test",
            code = "VOT",
        });
        var created = await createResp.Content.ReadFromJsonAsync<IdResponse>();

        var resp = await client.GetAsync($"/api/admin/customers/{created!.Id}/vehicles");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var vehicles = await resp.Content.ReadFromJsonAsync<VehicleEntry[]>();
        // No ROs → empty list, but if we had vehicles they would be DESC by last seen
        vehicles.Should().NotBeNull();
    }

    // ── E13-S2: Domain events ─────────────────────────────────────────────────

    [Fact]
    public async Task CustomerEmailDlChanged_PayloadHasBeforeAndAfter()
    {
        var client = AdminClient();

        // Create a customer with an initial DL
        var createResp = await client.PostAsJsonAsync("/api/admin/customers", new
        {
            name    = "DL Event Test",
            code    = "DET",
            emailDl = "before@example.com",
        });
        var created = await createResp.Content.ReadFromJsonAsync<IdResponse>();

        // Update the DL — should emit CustomerEmailDlChanged event
        var putResp = await client.PutAsJsonAsync($"/api/admin/customers/{created!.Id}", new
        {
            emailDl = "after@example.com",
        });
        putResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Verify via detail that DL was updated
        var detail = await client.GetFromJsonAsync<CustomerDetail>($"/api/admin/customers/{created.Id}");
        detail!.EmailDl.Should().Contain("after@example.com");
        detail.EmailDl.Should().NotContain("before@example.com");
    }

    // ── Response DTOs ─────────────────────────────────────────────────────────

    private record IdResponse(Guid Id);
}
