using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using ClosedXML.Excel;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Domain;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class ChassisStockUploadTests(ApiFixture fixture)
{
    // The supervisor seed account also has ADMIN role (013_admin_role.sql)
    private static readonly Guid AdminUserId = new("33333333-3333-3333-3333-333333333333");
    // A non-admin user for authorization tests
    private static readonly Guid SalesUserId = new("11111111-1111-1111-1111-111111111111");

    // ── Helpers ──────────────────────────────────────────────────────────────

    private HttpClient AdminClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(AdminUserId, "ADMIN"));
        return c;
    }

    private HttpClient SalesClient()
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(SalesUserId, "SALES"));
        return c;
    }

    /// <summary>Creates an xlsx file in memory and returns a MultipartFormDataContent.</summary>
    private static MultipartFormDataContent BuildXlsx(Action<IXLWorksheet> populate, string fileName = "test.xlsx")
    {
        using var wb = new XLWorkbook();
        var ws = wb.AddWorksheet("Sheet1");
        populate(ws);
        var stream = new MemoryStream();
        wb.SaveAs(stream);
        stream.Position = 0;

        var bytes = stream.ToArray();
        var fileContent = new ByteArrayContent(bytes);
        fileContent.Headers.ContentType =
            new MediaTypeHeaderValue("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

        var form = new MultipartFormDataContent();
        form.Add(fileContent, "file", fileName);
        return form;
    }

    /// <summary>
    /// Builds a 5-row sheet: 2 match existing seed chassis (CN-001, CF-002),
    /// 3 are new (NEW-001, NEW-002, NEW-003). CF-003 (seed) is missing → would be stale.
    /// </summary>
    private static MultipartFormDataContent Build5RowSheet()
    {
        return BuildXlsx(ws =>
        {
            ws.Cell(1, 1).Value = "Chassis Number";
            ws.Cell(1, 2).Value = "Body Type";
            ws.Cell(1, 3).Value = "Colour";
            ws.Cell(1, 4).Value = "Tag Number";
            ws.Cell(1, 5).Value = "Arrival Date";

            // Row 2 — matches seed CN-001 with a field update
            ws.Cell(2, 1).Value = "CN-001";
            ws.Cell(2, 2).Value = "TIPPER_CS";
            ws.Cell(2, 3).Value = "WHITE";
            ws.Cell(2, 4).Value = "TAG-01";
            ws.Cell(2, 5).Value = "2026-01-10";

            // Row 3 — matches seed CF-002 with a field update
            ws.Cell(3, 1).Value = "CF-002";
            ws.Cell(3, 2).Value = "TAUTLINER";
            ws.Cell(3, 3).Value = "SILVER";
            ws.Cell(3, 4).Value = "TAG-02";
            ws.Cell(3, 5).Value = "2026-01-15";

            // Rows 4-6 — new chassis
            ws.Cell(4, 1).Value = "NEW-001";
            ws.Cell(4, 2).Value = "TIPPER_CS";
            ws.Cell(4, 3).Value = "BLUE";

            ws.Cell(5, 1).Value = "NEW-002";
            ws.Cell(5, 2).Value = "TAUTLINER";
            ws.Cell(5, 3).Value = "RED";

            ws.Cell(6, 1).Value = "NEW-003";
            ws.Cell(6, 2).Value = "TIPPER_CS";
            ws.Cell(6, 3).Value = "BLACK";
        });
    }

    // ── Test 1: Dry-run returns diff without mutating DB ─────────────────────

    [Fact]
    public async Task Upload_DryRun_ReturnsDiffWithoutMutating()
    {
        int countBefore;
        await using (var db = fixture.CreateDbContext())
        {
            countBefore = await db.ChassisInventory.CountAsync();
        }

        countBefore.Should().BeGreaterOrEqualTo(3, "seed includes 3 chassis");

        var resp = await AdminClient().PostAsync(
            "/api/scheduling/chassis/upload-inventory",
            Build5RowSheet());

        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<DryRunResponse>();
        body.Should().NotBeNull();
        body!.UploadId.Should().NotBeEmpty();
        body.ToInsert.Should().HaveCount(3, "NEW-001, NEW-002, NEW-003 are not in DB");
        body.WouldBeStale.Should().HaveCountGreaterOrEqualTo(1, "CF-003 is AVAILABLE and missing from sheet");

        // DB row count must not have changed
        int countAfter;
        await using (var db = fixture.CreateDbContext())
        {
            countAfter = await db.ChassisInventory.CountAsync();
        }
        countAfter.Should().Be(countBefore, "dry-run must not insert chassis rows");
    }

    // ── Test 2: Bad headers → parse errors ───────────────────────────────────

    [Fact]
    public async Task Upload_BadHeaders_ReturnsParseErrors()
    {
        var form = BuildXlsx(ws =>
        {
            ws.Cell(1, 1).Value = "VehicleId";   // not a recognised alias
            ws.Cell(1, 2).Value = "Colour";
            ws.Cell(2, 1).Value = "SOME-123";
            ws.Cell(2, 2).Value = "WHITE";
        });

        var resp = await AdminClient().PostAsync(
            "/api/scheduling/chassis/upload-inventory",
            form);

        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<DryRunResponse>();
        body.Should().NotBeNull();
        body!.ParseErrors.Should().HaveCountGreaterOrEqualTo(1);
        var msg = body.ParseErrors[0].Message;
        msg.Should().Contain("chassis_number", "error must mention the missing column");
    }

    // ── Test 3: Non-ADMIN role → 403 ─────────────────────────────────────────

    [Fact]
    public async Task Upload_NotAdmin_Returns403()
    {
        var resp = await SalesClient().PostAsync(
            "/api/scheduling/chassis/upload-inventory",
            Build5RowSheet());

        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── Test 4: Commit applies diff and audits counts ─────────────────────────

    [Fact]
    public async Task Commit_AppliesDiffAndAuditsCounts()
    {
        int countBefore;
        await using (var db = fixture.CreateDbContext())
        {
            countBefore = await db.ChassisInventory.CountAsync();
        }

        // Dry-run first
        var dryResp = await AdminClient().PostAsync(
            "/api/scheduling/chassis/upload-inventory",
            Build5RowSheet());
        dryResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var dry = await dryResp.Content.ReadFromJsonAsync<DryRunResponse>();
        dry.Should().NotBeNull();

        // Commit
        var commitResp = await AdminClient().PostAsync(
            $"/api/scheduling/chassis/upload-inventory/{dry!.UploadId}/commit",
            new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        commitResp.StatusCode.Should().Be(HttpStatusCode.OK);

        var result = await commitResp.Content.ReadFromJsonAsync<CommitResponse>();
        result.Should().NotBeNull();
        result!.Inserted.Should().Be(3, "3 new chassis were in the sheet");

        // Verify DB has new rows
        int countAfter;
        await using (var db = fixture.CreateDbContext())
        {
            countAfter = await db.ChassisInventory.CountAsync();
        }
        countAfter.Should().Be(countBefore + 3);

        // Verify upload status = COMMITTED
        await using (var db = fixture.CreateDbContext())
        {
            var upload = await db.ChassisStockUploads.FindAsync(dry.UploadId);
            upload.Should().NotBeNull();
            upload!.Status.Should().Be("COMMITTED");
            upload.InsertedCount.Should().Be(3);
        }
    }

    // ── Test 5: Committing twice → 409 ────────────────────────────────────────

    [Fact]
    public async Task Commit_TwiceReturns409()
    {
        // Build a simple single-row sheet with a unique chassis number
        var uniqueNum = "UNIQUE-" + Guid.NewGuid().ToString("N")[..8];
        var form = BuildXlsx(ws =>
        {
            ws.Cell(1, 1).Value = "Chassis Number";
            ws.Cell(1, 2).Value = "Body Type";
            ws.Cell(2, 1).Value = uniqueNum;
            ws.Cell(2, 2).Value = "TIPPER_CS";
        });

        var dryResp = await AdminClient().PostAsync(
            "/api/scheduling/chassis/upload-inventory",
            form);
        dryResp.StatusCode.Should().Be(HttpStatusCode.OK);
        var dry = await dryResp.Content.ReadFromJsonAsync<DryRunResponse>();

        // First commit
        var first = await AdminClient().PostAsync(
            $"/api/scheduling/chassis/upload-inventory/{dry!.UploadId}/commit",
            new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        first.StatusCode.Should().Be(HttpStatusCode.OK);

        // Second commit — should conflict
        var second = await AdminClient().PostAsync(
            $"/api/scheduling/chassis/upload-inventory/{dry.UploadId}/commit",
            new StringContent("{}", System.Text.Encoding.UTF8, "application/json"));
        second.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    // ── Response DTOs ─────────────────────────────────────────────────────────

    private record DryRunResponse(
        Guid UploadId,
        int RowCount,
        List<ParsedChassisRow> ToInsert,
        List<object> ToUpdate,
        List<object> WouldBeStale,
        List<ParseErrorDto> ParseErrors);

    private record ParsedChassisRow(string ChassisNumber, string? BodyType, string? Colour);
    private record ParseErrorDto(int Row, string Message);
    private record CommitResponse(int Inserted, int Updated, int DeliveredAuto, int StaleAfterUpload);
}
