using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Endpoints;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class AdminEndpointTests(ApiFixture fixture)
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

    private HttpClient SupervisorClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SupervisorId, "SUPERVISOR"));
        return c;
    }

    // ── E11-S1: Ping ──────────────────────────────────────────────────────────

    [Fact]
    public async Task Ping_AdminRole_Returns200()
    {
        var resp = await AdminClient().GetAsync("/api/admin/ping");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    [Fact]
    public async Task Ping_SupervisorRole_Returns403()
    {
        var resp = await SupervisorClient().GetAsync("/api/admin/ping");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task Ping_NoAuth_Returns401()
    {
        var resp = await fixture.CreateClient().GetAsync("/api/admin/ping");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── E11-S2: List users ────────────────────────────────────────────────────

    [Fact]
    public async Task ListUsers_Search_FiltersByName()
    {
        var resp = await AdminClient().GetAsync("/api/admin/users?q=dwayne&page=1&pageSize=20");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<UserListResponse>();
        body.Should().NotBeNull();
        body!.Items.Should().NotBeEmpty();
        body.Items.Should().AllSatisfy(u =>
            u.FullName.ToLower().Should().Contain("dwayne"));
    }

    [Fact]
    public async Task ListUsers_RoleFilter_ReturnsSupervisors()
    {
        var resp = await AdminClient().GetAsync("/api/admin/users?role=SUPERVISOR&page=1&pageSize=20");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<UserListResponse>();
        body.Should().NotBeNull();
        body!.Items.Should().NotBeEmpty();
        body.Items.Should().AllSatisfy(u =>
            u.Roles.Should().Contain("SUPERVISOR"));
    }

    [Fact]
    public async Task ListUsers_ActiveFilter_ReturnsOnlyActive()
    {
        var resp = await AdminClient().GetAsync("/api/admin/users?active=true&page=1&pageSize=20");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<UserListResponse>();
        body.Should().NotBeNull();
        body!.Items.Should().AllSatisfy(u => u.IsActive.Should().BeTrue());
    }

    // ── E11-S3: Create / edit / deactivate ───────────────────────────────────

    [Fact]
    public async Task CreateUser_HappyPath_Returns201()
    {
        var req = new CreateUserRequest(
            Username:  $"test_{Guid.NewGuid():N}",
            FullName:  "Test User",
            Email:     null,
            ShortCode: null,
            Password:  "Test1234!",
            RoleIds:   new short[] { 6 }); // TECHNICIAN

        var resp = await AdminClient().PostAsJsonAsync("/api/admin/users", req);
        resp.StatusCode.Should().Be(HttpStatusCode.Created);

        var body = await resp.Content.ReadFromJsonAsync<System.Text.Json.JsonElement?>();
        body.Should().NotBeNull();
    }

    [Fact]
    public async Task CreateUser_DuplicateUsername_Returns409()
    {
        var req = new CreateUserRequest(
            Username:  "supervisor",
            FullName:  "Duplicate",
            Email:     null,
            ShortCode: null,
            Password:  "Test1234!",
            RoleIds:   new short[] { 6 });

        var resp = await AdminClient().PostAsJsonAsync("/api/admin/users", req);
        resp.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task DeactivateLastAdmin_Returns422()
    {
        // supervisor is the only ADMIN in seed data; deactivating should be blocked
        var resp = await AdminClient().PostAsync($"/api/admin/users/{SupervisorId}/deactivate", null);
        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task ResetPassword_AllowsLogin()
    {
        var client = AdminClient();
        // Reset supervisor password
        var resetResp = await client.PostAsJsonAsync(
            $"/api/admin/users/{SupervisorId}/reset-password",
            new ResetPasswordRequest("nee2026"));
        resetResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Can still log in with reset password
        var loginResp = await fixture.CreateClient().PostAsJsonAsync("/api/auth/login",
            new { username = "supervisor", password = "nee2026" });
        loginResp.StatusCode.Should().Be(HttpStatusCode.OK);
    }

    // ── E11-S4: Station roster ────────────────────────────────────────────────

    [Fact]
    public async Task AddTechnician_HappyPath_Returns204()
    {
        var req = new AddTechnicianRequest(SalesUserId, false);
        var resp = await AdminClient().PostAsJsonAsync("/api/admin/stations/10/technicians", req);
        resp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Clean up
        await AdminClient().DeleteAsync($"/api/admin/stations/10/technicians/{SalesUserId}");
    }

    [Fact]
    public async Task RemoveTechnician_NotFound_Returns404()
    {
        var resp = await AdminClient().DeleteAsync($"/api/admin/stations/10/technicians/{Guid.NewGuid()}");
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task ChangeOwner_HappyPath_Returns204()
    {
        var resp = await AdminClient().PutAsJsonAsync(
            "/api/admin/stations/20/owner",
            new ChangeOwnerRequest(SupervisorId));
        resp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Restore original owner (dave)
        var db = fixture.CreateDbContext();
        var dave = await db.Users.FirstOrDefaultAsync(u => u.Username == "dave");
        if (dave is not null)
        {
            await AdminClient().PutAsJsonAsync(
                "/api/admin/stations/20/owner",
                new ChangeOwnerRequest(dave.Id));
        }
    }

    // ── E11-S5: Activity timeline ─────────────────────────────────────────────

    [Fact]
    public async Task GetUserActivity_Returns200WithCounts()
    {
        var resp = await AdminClient().GetAsync($"/api/admin/users/{SupervisorId}/activity?days=30");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<ActivityResponse>();
        body.Should().NotBeNull();
        body!.Events.Should().NotBeNull();
        body.Counts.Should().NotBeNull();
    }

    [Fact]
    public async Task GetUserActivity_UnknownUser_Returns404()
    {
        var resp = await AdminClient().GetAsync($"/api/admin/users/{Guid.NewGuid()}/activity?days=30");
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }
}
