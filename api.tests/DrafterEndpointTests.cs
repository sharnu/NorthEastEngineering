using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using FluentAssertions;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class DrafterEndpointTests(ApiFixture fixture)
{
    private static readonly Guid DrafterUserId  = new("22222222-2222-2222-2222-222222222222");
    private static readonly Guid SalesUserId    = new("11111111-1111-1111-1111-111111111111");
    private static readonly Guid SupervisorId   = new("33333333-3333-3333-3333-333333333333");

    private HttpClient DrafterClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(DrafterUserId, "DRAFTER"));
        return c;
    }

    private HttpClient SalesClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SalesUserId, "SALES"));
        return c;
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<Guid> CreateTestRoAsync()
    {
        var customers = await SalesClient().GetFromJsonAsync<CustomerListItem[]>("/api/customers");
        var dfe = customers!.First(c => c.Code == "DFE");

        var payload = new
        {
            CustomerId   = dfe.Id,
            JobTypeId    = 1,
            TemplateCode = "TP42N",
            Rego         = $"DRAFT{Guid.NewGuid():N}"[..10],
            Make         = "Isuzu",
            Model        = "NPR",
            RequiredDate = DateTimeOffset.UtcNow.AddMonths(3),
            Priority     = 2,
        };

        var resp = await SalesClient().PostAsJsonAsync("/api/repair-orders", payload);
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<CreateRoResponse>();
        return body!.RoId;
    }

    // ── E12-S1: Auth guard ────────────────────────────────────────────────────

    [Fact]
    public async Task Queue_NoAuth_Returns401()
    {
        var resp = await fixture.CreateClient().GetAsync("/api/drafter/queue");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task Queue_SalesRole_Returns403()
    {
        var resp = await SalesClient().GetAsync("/api/drafter/queue");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── E12-S1: Queue ─────────────────────────────────────────────────────────

    [Fact]
    public async Task Queue_DrafterRole_Returns200WithList()
    {
        await CreateTestRoAsync();

        var resp = await DrafterClient().GetAsync("/api/drafter/queue");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var items = await resp.Content.ReadFromJsonAsync<QueueItem[]>();
        items.Should().NotBeNull();
        items!.Should().NotBeEmpty();
        items.Should().AllSatisfy(i =>
            new[] { "NOT_STARTED", "IN_PROGRESS", "ON_HOLD" }
                .Should().Contain(i.DraftingStatus));
    }

    // ── E12-S1: RO detail ─────────────────────────────────────────────────────

    [Fact]
    public async Task RoDetail_ValidRo_Returns200WithArtefacts()
    {
        var roId = await CreateTestRoAsync();

        var resp = await DrafterClient().GetAsync($"/api/drafter/ros/{roId}");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<System.Text.Json.JsonElement?>();
        body.Should().NotBeNull();
        body!.Value.GetProperty("id").GetGuid().Should().Be(roId);
        body.Value.GetProperty("artefacts").GetArrayLength().Should().Be(0);
    }

    [Fact]
    public async Task RoDetail_UnknownRo_Returns404()
    {
        var resp = await DrafterClient().GetAsync($"/api/drafter/ros/{Guid.NewGuid()}");
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── E12-S1: Status transitions ────────────────────────────────────────────

    [Fact]
    public async Task StatusTransition_NotStarted_ToInProgress_Returns204()
    {
        var roId = await CreateTestRoAsync();
        var resp = await DrafterClient().PutAsJsonAsync(
            $"/api/drafter/ros/{roId}/status",
            new { status = "IN_PROGRESS", notes = (string?)null });
        resp.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    [Fact]
    public async Task StatusTransition_InvalidTransition_Returns422()
    {
        var roId = await CreateTestRoAsync();
        // Skip IN_PROGRESS — jump straight to COMPLETED (invalid)
        var resp = await DrafterClient().PutAsJsonAsync(
            $"/api/drafter/ros/{roId}/status",
            new { status = "COMPLETED", notes = (string?)null });
        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task StatusTransition_FullPath_NotStarted_InProgress_Completed()
    {
        var roId = await CreateTestRoAsync();

        // NOT_STARTED → IN_PROGRESS
        var r1 = await DrafterClient().PutAsJsonAsync(
            $"/api/drafter/ros/{roId}/status",
            new { status = "IN_PROGRESS", notes = (string?)null });
        r1.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // IN_PROGRESS → ON_HOLD
        var r2 = await DrafterClient().PutAsJsonAsync(
            $"/api/drafter/ros/{roId}/status",
            new { status = "ON_HOLD", notes = "Waiting on customer" });
        r2.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // ON_HOLD → IN_PROGRESS
        var r3 = await DrafterClient().PutAsJsonAsync(
            $"/api/drafter/ros/{roId}/status",
            new { status = "IN_PROGRESS", notes = (string?)null });
        r3.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // IN_PROGRESS → COMPLETED
        var r4 = await DrafterClient().PutAsJsonAsync(
            $"/api/drafter/ros/{roId}/status",
            new { status = "COMPLETED", notes = "All drawings done" });
        r4.StatusCode.Should().Be(HttpStatusCode.NoContent);

        // Verify drafting_status is now COMPLETED via detail endpoint
        var detail = await DrafterClient().GetAsync($"/api/drafter/ros/{roId}");
        var body = await detail.Content.ReadFromJsonAsync<System.Text.Json.JsonElement?>();
        body!.Value.GetProperty("draftingStatus").GetString().Should().Be("COMPLETED");
    }

    // ── E12-S1: Artefact upload ───────────────────────────────────────────────

    [Fact]
    public async Task UploadArtefact_ValidPdf_Returns201()
    {
        var roId = await CreateTestRoAsync();

        var pdfContent = Encoding.UTF8.GetBytes("%PDF-1.4 fake pdf content");
        using var content = new MultipartFormDataContent();
        content.Add(new ByteArrayContent(pdfContent)
        {
            Headers = { ContentType = new("application/pdf") }
        }, "file", "layout.pdf");

        var resp = await DrafterClient()
            .PostAsync($"/api/drafter/ros/{roId}/artefacts?category=DRAFT_LAYOUT", content);
        resp.StatusCode.Should().Be(HttpStatusCode.Created);

        // Verify artefact appears in detail
        var detail = await DrafterClient().GetAsync($"/api/drafter/ros/{roId}");
        var body = await detail.Content.ReadFromJsonAsync<System.Text.Json.JsonElement?>();
        body!.Value.GetProperty("artefacts").GetArrayLength().Should().Be(1);
    }

    [Fact]
    public async Task UploadArtefact_InvalidCategory_Returns400()
    {
        var roId = await CreateTestRoAsync();
        var pdfContent = Encoding.UTF8.GetBytes("fake");
        using var content = new MultipartFormDataContent();
        content.Add(new ByteArrayContent(pdfContent)
        {
            Headers = { ContentType = new("application/pdf") }
        }, "file", "test.pdf");

        var resp = await DrafterClient()
            .PostAsync($"/api/drafter/ros/{roId}/artefacts?category=INVALID_CAT", content);
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task DeleteArtefact_HappyPath_Returns204()
    {
        var roId = await CreateTestRoAsync();

        // Upload first
        var pdfContent = Encoding.UTF8.GetBytes("fake pdf");
        using var content = new MultipartFormDataContent();
        content.Add(new ByteArrayContent(pdfContent)
        {
            Headers = { ContentType = new("application/pdf") }
        }, "file", "bom.pdf");

        var uploadResp = await DrafterClient()
            .PostAsync($"/api/drafter/ros/{roId}/artefacts?category=DRAFT_BOM", content);
        uploadResp.EnsureSuccessStatusCode();

        var uploadBody = await uploadResp.Content.ReadFromJsonAsync<System.Text.Json.JsonElement?>();
        var attachmentId = uploadBody!.Value.GetProperty("attachmentId").GetGuid();

        // Delete
        var deleteResp = await DrafterClient()
            .DeleteAsync($"/api/drafter/ros/{roId}/artefacts/{attachmentId}");
        deleteResp.StatusCode.Should().Be(HttpStatusCode.NoContent);
    }

    // ── Response DTOs ─────────────────────────────────────────────────────────

    private record CustomerListItem(Guid Id, string Code, string Name);
    private record CreateRoResponse(Guid RoId, string RoNumber, int TasksCreated);
    private record QueueItem(Guid Id, string RoNumber, string DraftingStatus, short Priority);
}
