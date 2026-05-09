using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Domain;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class ReportsExtraTests(ApiFixture fixture)
{
    private static readonly Guid SupervisorUserId = new("33333333-3333-3333-3333-333333333333");
    private static readonly Guid SalesUserId      = new("11111111-1111-1111-1111-111111111111");

    private HttpClient SupClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SupervisorUserId, "SUPERVISOR"));
        return c;
    }

    private HttpClient SalesClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SalesUserId, "SALES"));
        return c;
    }

    // ── E17 · Variance Root Cause ────────────────────────────────────────

    [Fact]
    public async Task VarianceRootCause_GroupByReason_ReturnsRows()
    {
        var resp = await SupClient().GetAsync("/api/dashboard/reports/variance-root-cause?groupBy=reason");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var doc = await resp.Content.ReadFromJsonAsync<VarianceReport>();
        doc.Should().NotBeNull();
        doc!.GroupBy.Should().Be("reason");
    }

    [Fact]
    public async Task VarianceRootCause_InvalidGroupBy_Returns400()
    {
        var resp = await SupClient().GetAsync("/api/dashboard/reports/variance-root-cause?groupBy=banana");
        resp.StatusCode.Should().Be(HttpStatusCode.BadRequest);
    }

    [Fact]
    public async Task VarianceRootCause_NonSupervisor_Returns403()
    {
        var resp = await SalesClient().GetAsync("/api/dashboard/reports/variance-root-cause");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task VarianceRootCause_Csv_ReturnsTextCsv()
    {
        var resp = await SupClient().GetAsync("/api/dashboard/reports/variance-root-cause/csv?groupBy=reason");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        resp.Content.Headers.ContentType?.MediaType.Should().Be("text/csv");
    }

    [Fact]
    public async Task VarianceRootCauseRecords_Pagination_RespectsPageSize()
    {
        var resp = await SupClient().GetAsync(
            "/api/dashboard/reports/variance-root-cause/records?groupBy=reason&groupKey=DESIGN_NCR&page=1&pageSize=5");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var page = await resp.Content.ReadFromJsonAsync<VarianceRecordsPage>();
        page.Should().NotBeNull();
        page!.PageSize.Should().Be(5);
        page.Page.Should().Be(1);
    }

    // ── E18 · Customer Concentration ─────────────────────────────────────

    [Fact]
    public async Task CustomerConcentration_DefaultPeriod_ReturnsRows()
    {
        var resp = await SupClient().GetAsync("/api/dashboard/reports/customer-concentration");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var doc = await resp.Content.ReadFromJsonAsync<ConcentrationReport>();
        doc.Should().NotBeNull();
        doc!.Period.Should().Be("last_quarter");
    }

    [Fact]
    public async Task CustomerConcentration_CumulativePercent_IsMonotonic()
    {
        var doc = await SupClient().GetFromJsonAsync<ConcentrationReport>(
            "/api/dashboard/reports/customer-concentration?period=last_year");
        doc.Should().NotBeNull();
        decimal prev = 0;
        foreach (var r in doc!.Rows)
        {
            r.CumulativePercent.Should().BeGreaterThanOrEqualTo(prev);
            prev = r.CumulativePercent;
        }
    }

    [Fact]
    public async Task CustomerConcentrationTrend_PadsEightQuarters()
    {
        // Pick the first customer (DFE typically)
        var customers = await SupClient().GetFromJsonAsync<CustomerListItem[]>("/api/customers");
        customers.Should().NotBeNullOrEmpty();
        var trend = await SupClient().GetFromJsonAsync<TrendResponse>(
            $"/api/dashboard/reports/customer-concentration/trend?customerId={customers!.First().Id}");
        trend.Should().NotBeNull();
        trend!.Quarters.Should().HaveCount(8);
    }

    [Fact]
    public async Task CustomerConcentration_Csv_HasHeader()
    {
        var resp = await SupClient().GetAsync("/api/dashboard/reports/customer-concentration/csv?period=ytd");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);
        var text = await resp.Content.ReadAsStringAsync();
        text.Should().StartWith("Customer Code,Customer Name");
    }

    // ── E20 · Strategic Forecasting ──────────────────────────────────────

    [Fact]
    public async Task Forecast_ReturnsRowsWithValidScore()
    {
        var doc = await SupClient().GetFromJsonAsync<ForecastResponse>("/api/dashboard/reports/forecast");
        doc.Should().NotBeNull();
        foreach (var r in doc!.Rows)
        {
            r.RiskScore.Should().BeInRange(0, 100);
            new[] { "LOW", "MED", "HIGH" }.Should().Contain(r.RiskTier);
        }
    }

    [Fact]
    public async Task Forecast_ProjectedDate_IsOnOrAfterScheduledStart()
    {
        var doc = await SupClient().GetFromJsonAsync<ForecastResponse>("/api/dashboard/reports/forecast");
        doc.Should().NotBeNull();
        foreach (var r in doc!.Rows)
        {
            r.ProjectedCompletionDate.Should().BeOnOrAfter(r.ScheduledStartWeek);
        }
    }

    [Fact]
    public async Task Forecast_NonSupervisor_Returns403()
    {
        var resp = await SalesClient().GetAsync("/api/dashboard/reports/forecast");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── DTOs ─────────────────────────────────────────────────────────────

    private record VarianceReport(string GroupBy, string From, string To,
        int TotalSampleSize, decimal TotalDeltaHours, VarianceRow[] Rows);

    private record VarianceRow(string GroupKey, string GroupLabel,
        decimal TotalDeltaHours, int SampleSize, ReasonBreakdown[] ByReason);

    private record ReasonBreakdown(string ReasonCode, string ReasonName,
        bool IsOverrun, decimal DeltaHours, int Count);

    private record VarianceRecordsPage(VarianceRecord[] Items, int TotalCount, int Page, int PageSize);
    private record VarianceRecord(Guid RecordId, DateTimeOffset RecordedAt,
        string RoNumber, string OperationName, string ReasonCode);

    private record ConcentrationReport(string Period, string From, string To,
        int TotalRoCount, decimal TotalHours, ConcentrationRow[] Rows);

    private record ConcentrationRow(Guid CustomerId, string CustomerCode, string CustomerName,
        int RoCount, decimal TotalHours, decimal PercentOfTotal, decimal CumulativePercent, bool TopRanked);

    private record TrendResponse(Guid CustomerId, TrendPoint[] Quarters);
    private record TrendPoint(string QuarterLabel, DateOnly QuarterStart, int RoCount, decimal TotalHours);

    private record ForecastResponse(DateTimeOffset ComputedAt, ForecastRow[] Rows);
    private record ForecastRow(Guid RoId, string RoNumber, string CustomerName,
        DateOnly ScheduledStartWeek, DateOnly ProjectedCompletionDate,
        int DaysAtRisk, int RiskScore, string RiskTier);

    private record CustomerListItem(Guid Id, string Code, string Name);
}
