using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Nee.Api.Domain;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class ChassisSuggestionTests(ApiFixture fixture)
{
    private static readonly Guid SupervisorId = new("33333333-3333-3333-3333-333333333333");
    private static readonly Guid SalesId = new("11111111-1111-1111-1111-111111111111");
    private const string ValidTemplate = "TP42N";
    private const string ValidCustomerCode = "DFE";

    // ── E28-S1 ────────────────────────────────────────────────────────────────

    [Fact]
    public async Task Suggest_BodyTypeMismatch_ExcludesIncompatible()
    {
        var prefix = Guid.NewGuid().ToString("N")[..6];
        var roId = await CreateRoAsync();

        await using var db = fixture.CreateDbContext();
        var ro = await db.RepairOrders.FindAsync(roId);
        ro!.BodyType = "TIPPER_CS";

        var excluded = MakeChassis($"INV-{prefix}-EX", bodyType: "TAUTLINER");
        db.ChassisInventory.Add(excluded);
        await db.SaveChangesAsync();

        var resp = await SupervisorClient()
            .GetFromJsonAsync<SuggestionsResponse>($"/api/scheduling/ros/{roId}/chassis-suggestions");

        resp!.Candidates.Should().NotContain(c => c.ChassisId == excluded.Id,
            "a TAUTLINER chassis must never appear for a TIPPER_CS RO");
    }

    [Fact]
    public async Task Suggest_TagMatch_RanksFirst()
    {
        var prefix = Guid.NewGuid().ToString("N")[..6];
        var roId = await CreateRoAsync();

        await using var db = fixture.CreateDbContext();
        var ro = await db.RepairOrders.FindAsync(roId);
        ro!.ChassisTag = $"TAG-{prefix}";
        await db.SaveChangesAsync();

        var tagChassis = MakeChassis($"INV-{prefix}-T", tagNumber: $"TAG-{prefix}");
        db.ChassisInventory.Add(tagChassis);
        await db.SaveChangesAsync();

        var resp = await SupervisorClient()
            .GetFromJsonAsync<SuggestionsResponse>($"/api/scheduling/ros/{roId}/chassis-suggestions");

        resp!.Candidates[0].ChassisId.Should().Be(tagChassis.Id,
            "chassis with exact tag match must be ranked first");
        resp.Candidates[0].ScoreBreakdown.Tag.Should().Be(100);
    }

    [Fact]
    public async Task Suggest_NoTag_FallsBackToColourAndProximity()
    {
        var prefix = Guid.NewGuid().ToString("N")[..6];
        var uniqueColour = $"TestColour-{prefix}";
        var requiredDate = DateTimeOffset.UtcNow.AddDays(15);
        var roId = await CreateRoAsync(requiredDate);

        await using var db = fixture.CreateDbContext();
        var ro = await db.RepairOrders.FindAsync(roId);
        ro!.Colour = uniqueColour;
        ro.RequiredDate = requiredDate;
        await db.SaveChangesAsync();

        var arrivalMatching = DateOnly.FromDateTime(requiredDate.UtcDateTime);
        // BodyType=null so all three pass the body-type filter regardless of RO body type
        db.ChassisInventory.AddRange(
            MakeChassis($"INV-{prefix}-A", colour: uniqueColour, arrivalDate: arrivalMatching), // 50+30=80
            MakeChassis($"INV-{prefix}-B", colour: uniqueColour),                               // 50
            MakeChassis($"INV-{prefix}-C", arrivalDate: arrivalMatching)                        // 30
        );
        await db.SaveChangesAsync();

        var resp = await SupervisorClient()
            .GetFromJsonAsync<SuggestionsResponse>($"/api/scheduling/ros/{roId}/chassis-suggestions");

        var cands = resp!.Candidates;
        cands.Should().Contain(c => c.ChassisNumber == $"INV-{prefix}-A" && c.Score == 80);
        cands.Should().Contain(c => c.ChassisNumber == $"INV-{prefix}-B" && c.Score == 50);
        cands.Should().Contain(c => c.ChassisNumber == $"INV-{prefix}-C" && c.Score == 30);

        var idxA = Array.FindIndex(cands, c => c.ChassisNumber == $"INV-{prefix}-A");
        var idxB = Array.FindIndex(cands, c => c.ChassisNumber == $"INV-{prefix}-B");
        idxA.Should().BeLessThan(idxB, "higher score ranks first");
    }

    [Fact]
    public async Task Suggest_FifoTiebreaker_PrefersOldest()
    {
        var prefix = Guid.NewGuid().ToString("N")[..6];
        var uniqueColour = $"FifoTest-{prefix}";
        var roId = await CreateRoAsync();

        await using var db = fixture.CreateDbContext();
        var ro = await db.RepairOrders.FindAsync(roId);
        ro!.Colour = uniqueColour; // both test chassis will match this → score 50 each
        await db.SaveChangesAsync();

        var older = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-30));
        var newer = DateOnly.FromDateTime(DateTime.UtcNow.AddDays(-5));
        // Add B first to ensure sort is not influenced by insert order
        db.ChassisInventory.AddRange(
            MakeChassis($"INV-{prefix}-B", colour: uniqueColour, arrivalDate: newer),
            MakeChassis($"INV-{prefix}-A", colour: uniqueColour, arrivalDate: older)
        );
        await db.SaveChangesAsync();

        var resp = await SupervisorClient()
            .GetFromJsonAsync<SuggestionsResponse>($"/api/scheduling/ros/{roId}/chassis-suggestions");

        var idxA = Array.FindIndex(resp!.Candidates, c => c.ChassisNumber == $"INV-{prefix}-A");
        var idxB = Array.FindIndex(resp!.Candidates, c => c.ChassisNumber == $"INV-{prefix}-B");
        idxA.Should().BeGreaterThanOrEqualTo(0, "older chassis must appear in suggestions");
        idxB.Should().BeGreaterThanOrEqualTo(0, "newer chassis must appear in suggestions");
        idxA.Should().BeLessThan(idxB, "FIFO: older arrival date ranks before newer");
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private HttpClient SupervisorClient()
    {
        var client = fixture.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SupervisorId, "SUPERVISOR"));
        return client;
    }

    private async Task<Guid> CreateRoAsync(DateTimeOffset? requiredDate = null)
    {
        var client = fixture.CreateClient();
        client.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SalesId, "SALES"));

        var customers = await client.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId = customers!.First(c => c.Code == ValidCustomerCode).Id;

        var response = await client.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId = customerId,
            JobTypeId = 1,
            TemplateCode = ValidTemplate,
            Rego = "SUG" + Guid.NewGuid().ToString("N")[..8],
            RequiredDate = requiredDate ?? DateTimeOffset.UtcNow.AddMonths(3),
            Priority = 3,
        });
        response.StatusCode.Should().Be(HttpStatusCode.Created);
        var created = await response.Content.ReadFromJsonAsync<CreateRoResponse>();
        return created!.RoId;
    }

    private static ChassisInventory MakeChassis(
        string number,
        string? bodyType = null,
        string? colour = null,
        string? tagNumber = null,
        DateOnly? arrivalDate = null) => new()
    {
        Id            = Guid.NewGuid(),
        ChassisNumber = number,
        Description   = "Test chassis",
        ChassisClass  = "N",
        Status        = "AVAILABLE",
        BodyType      = bodyType,
        Colour        = colour,
        TagNumber     = tagNumber,
        ArrivalDate   = arrivalDate,
        CreatedAt     = DateTimeOffset.UtcNow,
        UpdatedAt     = DateTimeOffset.UtcNow,
    };

    // ── Response DTOs ─────────────────────────────────────────────────────────

    private record CustomerItem(Guid Id, string Code, string Name);
    private record CreateRoResponse(Guid RoId, string RoNumber, int TasksCreated);
    private record SuggestionsResponse(
        Guid RoId,
        string? RoBodyType,
        string? RoColour,
        string? RoChassisTag,
        DateTimeOffset? RoRequiredDate,
        CandidateDto[] Candidates);
    private record CandidateDto(
        Guid ChassisId,
        string ChassisNumber,
        string? BodyType,
        string? Colour,
        string? TagNumber,
        DateOnly? ArrivalDate,
        int Score,
        BreakdownDto ScoreBreakdown,
        string Reason);
    private record BreakdownDto(int Tag, int Colour, int Proximity);
}
