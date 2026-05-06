using System.Net;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.AspNetCore.Mvc.Testing;
using Xunit;

namespace Nee.Api.Tests;

/// <summary>
/// Smoke tests against the health endpoint. Validates that the WebApplicationFactory
/// boot path works end-to-end. Use as a template for writing endpoint tests in E2 onwards.
/// </summary>
public class HealthEndpointTests : IClassFixture<WebApplicationFactory<Program>>
{
    private readonly WebApplicationFactory<Program> _factory;

    public HealthEndpointTests(WebApplicationFactory<Program> factory)
    {
        _factory = factory;
    }

    [Fact]
    public async Task GetHealth_Returns200_WithStatusOk()
    {
        var client = _factory.CreateClient();
        var response = await client.GetAsync("/api/health");

        response.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await response.Content.ReadFromJsonAsync<HealthResponse>();
        body.Should().NotBeNull();
        body!.Status.Should().Be("ok");
        body.Version.Should().NotBeNullOrEmpty();
    }

    private record HealthResponse(string Status, string Version, DateTimeOffset Timestamp);
}
