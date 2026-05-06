using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class QcEndpointTests(ApiFixture fixture)
{
    private static readonly Guid SupervisorId = new("33333333-3333-3333-3333-333333333333");
    private static readonly Guid SalesUserId  = new("11111111-1111-1111-1111-111111111111");
    private static readonly Guid PeterId      = new("44444444-4444-4444-4444-444444444444");
    private static readonly Guid KaneId       = new("55555555-5555-5555-5555-555555555555");

    private static readonly string[] ChecklistCodes =
        ["DIMENSIONS_VERIFIED", "WELD_QUALITY_CHECKED", "PAINT_FINISH_ACCEPTED", "ELECTRICAL_TESTED", "PLACARDS_FITTED", "PHOTOS_COMPLETE"];

    private static readonly object[] AllChecked = ChecklistCodes
        .Select(code => (object)new { itemCode = code, @checked = true })
        .ToArray();

    private HttpClient Client(Guid userId, params string[] roles)
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(userId, roles));
        return c;
    }

    // ── S1: GET /api/tech/qc/{roId} ───────────────────────────────────────────

    [Fact]
    public async Task GetQcContext_Returns200_WithAllItemsUnchecked()
    {
        var roId   = await CreateAndApproveRo("QC001");
        var qcId   = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.GetAsync($"/api/tech/qc/{roId}");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<QcContextDto>();
        body.Should().NotBeNull();
        body!.RoId.Should().Be(roId);
        body.ChecklistItems.Should().HaveCount(6);
        body.ChecklistItems.Should().AllSatisfy(i => i.Checked.Should().BeFalse());
        body.PriorSubmission.Should().BeNull();
    }

    [Fact]
    public async Task GetQcContext_WrongUser_Returns403()
    {
        var roId = await CreateAndApproveRo("QC002");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        // Kane tries to access Peter's QC task
        var kane = Client(KaneId, "TECHNICIAN");
        var resp = await kane.GetAsync($"/api/tech/qc/{roId}");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task GetQcContext_NoQcTask_Returns404()
    {
        var nonExistentRoId = Guid.NewGuid();
        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.GetAsync($"/api/tech/qc/{nonExistentRoId}");
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    [Fact]
    public async Task GetQcContext_BuildTasksIncomplete_AllBuildTasksCompleteFalse()
    {
        var roId = await CreateAndApproveRo("QC003");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.GetAsync($"/api/tech/qc/{roId}");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<QcContextDto>();
        body!.AllBuildTasksComplete.Should().BeFalse();
    }

    // ── S3: GET /api/tech/qc/{roId}/photos ────────────────────────────────────

    [Fact]
    public async Task GetPhotos_Returns200_WithEmptyStations_WhenNoneUploaded()
    {
        var roId = await CreateAndApproveRo("QCP001");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.GetAsync($"/api/tech/qc/{roId}/photos");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<QcPhotosDto>();
        body.Should().NotBeNull();
        body!.TotalCount.Should().Be(0);
        body.Groups.Should().BeEmpty();
    }

    [Fact]
    public async Task GetPhotos_WrongUser_Returns403()
    {
        var roId = await CreateAndApproveRo("QCP002");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        var kane = Client(KaneId, "TECHNICIAN");
        var resp = await kane.GetAsync($"/api/tech/qc/{roId}/photos");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    [Fact]
    public async Task PostPhoto_Returns201_WithCategoryQc()
    {
        var roId = await CreateAndApproveRo("QCP003");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        var peter  = Client(PeterId, "TECHNICIAN");
        var form   = new MultipartFormDataContent();
        var bytes  = MinimalJpeg();
        var fileCt = new ByteArrayContent(bytes);
        fileCt.Headers.ContentType = new MediaTypeHeaderValue("image/jpeg");
        form.Add(fileCt, "file", "qc_photo.jpg");

        var resp = await peter.PostAsync($"/api/tech/qc/{roId}/photos", form);
        resp.StatusCode.Should().Be(HttpStatusCode.Created);

        // Verify DB: attachment exists with category QC
        await using var db = fixture.CreateDbContext();
        var att = await db.Attachments
            .Where(a => a.EntityId == qcId && a.Category == "QC")
            .FirstOrDefaultAsync();
        att.Should().NotBeNull();
        att!.FileName.Should().Be("qc_photo.jpg");
    }

    // ── S4: GET /api/tech/qc/{roId}/email-preview ─────────────────────────────

    [Fact]
    public async Task GetEmailPreview_Returns200_WithCorrectSubjectFormat()
    {
        var roId = await CreateAndApproveRo("QCE001");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.GetAsync($"/api/tech/qc/{roId}/email-preview");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<EmailPreviewDto>();
        body.Should().NotBeNull();
        body!.Subject.Should().StartWith("Build complete:");
        body.Subject.Should().Contain("QCE001");
        body.BodyHtml.Should().NotBeNullOrEmpty();
        body.BodyText.Should().NotBeNullOrEmpty();
    }

    [Fact]
    public async Task GetEmailPreview_WrongUser_Returns403()
    {
        var roId = await CreateAndApproveRo("QCE002");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        var kane = Client(KaneId, "TECHNICIAN");
        var resp = await kane.GetAsync($"/api/tech/qc/{roId}/email-preview");
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── S5: POST /api/tech/qc/{roId}/pass ─────────────────────────────────────

    [Fact]
    public async Task Pass_HappyPath_Returns200_AndRoCompleted()
    {
        var roId = await CreateAndApproveRo("QCPASS001");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.PostAsJsonAsync($"/api/tech/qc/{roId}/pass", new
        {
            checklistResponses = AllChecked,
            notes              = "All checks complete.",
            emailTo            = "fleet@test.example.com",
        });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<PassResultDto>();
        body.Should().NotBeNull();
        body!.RoId.Should().Be(roId);

        await using var db = fixture.CreateDbContext();

        var qcTask = await db.JobTasks.FindAsync(qcId);
        qcTask!.Status.Should().Be("COMPLETED");

        var ro = await db.RepairOrders.FindAsync(roId);
        ro!.Status.Should().Be("COMPLETED");

        var kanban = await db.RoKanbanStates.FindAsync(roId);
        kanban!.CurrentStageId.Should().Be(99);

        var submission = await db.QcSubmissions.FirstOrDefaultAsync(s => s.RoId == roId);
        submission.Should().NotBeNull();
        submission!.EmailTo.Should().Be("fleet@test.example.com");

        var evt = await db.DomainEvents
            .FirstOrDefaultAsync(e => e.AggregateId == roId && e.EventType == "QcPassed");
        evt.Should().NotBeNull();
    }

    [Fact]
    public async Task Pass_IncompleteChecklist_Returns422()
    {
        var roId = await CreateAndApproveRo("QCFAIL001");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        // Only 5 of 6 items checked (PHOTOS_COMPLETE is false)
        var partial = ChecklistCodes
            .Select(code => (object)new { itemCode = code, @checked = code != "PHOTOS_COMPLETE" })
            .ToArray();

        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.PostAsJsonAsync($"/api/tech/qc/{roId}/pass", new
        {
            checklistResponses = partial,
            notes              = (string?)null,
            emailTo            = "",
        });
        resp.StatusCode.Should().Be(HttpStatusCode.UnprocessableEntity);
    }

    [Fact]
    public async Task Pass_AlreadyCompleted_Returns409()
    {
        var roId = await CreateAndApproveRo("QCDUP001");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        var peter    = Client(PeterId, "TECHNICIAN");
        var passBody = new
        {
            checklistResponses = AllChecked,
            notes              = (string?)null,
            emailTo            = "",
        };

        var first = await peter.PostAsJsonAsync($"/api/tech/qc/{roId}/pass", passBody);
        first.StatusCode.Should().Be(HttpStatusCode.OK);

        var second = await peter.PostAsJsonAsync($"/api/tech/qc/{roId}/pass", passBody);
        second.StatusCode.Should().Be(HttpStatusCode.Conflict);
    }

    [Fact]
    public async Task Pass_EmptyEmailTo_Returns200_EmailSentFalse()
    {
        var roId = await CreateAndApproveRo("QCNOEML001");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        var peter = Client(PeterId, "TECHNICIAN");
        var resp  = await peter.PostAsJsonAsync($"/api/tech/qc/{roId}/pass", new
        {
            checklistResponses = AllChecked,
            notes              = (string?)null,
            emailTo            = "",
        });
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<PassResultDto>();
        body!.EmailSent.Should().BeFalse();
    }

    // ── S2: PUT /api/tech/qc/{roId}/items/{itemCode} ─────────────────────────

    [Fact]
    public async Task PutItem_HappyPath_Returns204_AndReflectsInGet()
    {
        var roId = await CreateAndApproveRo("QCPUT001");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        var peter = Client(PeterId, "TECHNICIAN");
        var putResp = await peter.PutAsJsonAsync(
            $"/api/tech/qc/{roId}/items/DIMENSIONS_VERIFIED", new { passed = true });
        putResp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var ctx = await peter.GetFromJsonAsync<QcContextDto>($"/api/tech/qc/{roId}");
        ctx!.ChecklistItems
            .Single(i => i.ItemCode == "DIMENSIONS_VERIFIED")
            .Checked.Should().BeTrue();
    }

    [Fact]
    public async Task PutItem_WrongUser_Returns403()
    {
        var roId = await CreateAndApproveRo("QCPUT002");
        var qcId = await GetQcTaskId(roId);
        await AssignTaskToPeter(qcId);

        var kane = Client(KaneId, "TECHNICIAN");
        var resp = await kane.PutAsJsonAsync(
            $"/api/tech/qc/{roId}/items/DIMENSIONS_VERIFIED", new { passed = true });
        resp.StatusCode.Should().Be(HttpStatusCode.Forbidden);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<Guid> CreateAndApproveRo(string rego)
    {
        var sales     = Client(SalesUserId, "SALES");
        var customers = await sales.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        var customerId = customers!.First().Id;

        var resp = await sales.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId   = customerId,
            JobTypeId    = 1,
            TemplateCode = "TP42N",
            Rego         = rego,
            Priority     = 2,
        });
        resp.EnsureSuccessStatusCode();
        var body = await resp.Content.ReadFromJsonAsync<CreateRoResult>();
        return body!.RoId;
    }

    private async Task<Guid> GetQcTaskId(Guid roId)
    {
        await using var db = fixture.CreateDbContext();
        return await db.JobTasks
            .Where(t => t.RoId == roId && t.OperationId == 70)
            .Select(t => t.Id)
            .FirstAsync();
    }

    private async Task AssignTaskToPeter(Guid taskId)
    {
        // Direct DB assignment: QC station (90) has no Peter roster entry in seed data,
        // so we bypass the roster check and assign directly.
        await using var db = fixture.CreateDbContext();
        var task = await db.JobTasks.FindAsync(taskId);
        if (task is null) throw new InvalidOperationException($"Task {taskId} not found.");
        task.AssignedToUserId = PeterId;
        task.AssignedByUserId = SupervisorId;
        task.AssignedAt = DateTimeOffset.UtcNow;
        if (task.Status == "PENDING") task.Status = "ASSIGNED";
        await db.SaveChangesAsync();
    }

    private static byte[] MinimalJpeg()
    {
        // 1×1 white JPEG
        return
        [
            0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46, 0x49, 0x46, 0x00, 0x01,
            0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0xFF, 0xDB, 0x00, 0x43,
            0x00, 0x08, 0x06, 0x06, 0x07, 0x06, 0x05, 0x08, 0x07, 0x07, 0x07, 0x09,
            0x09, 0x08, 0x0A, 0x0C, 0x14, 0x0D, 0x0C, 0x0B, 0x0B, 0x0C, 0x19, 0x12,
            0x13, 0x0F, 0x14, 0x1D, 0x1A, 0x1F, 0x1E, 0x1D, 0x1A, 0x1C, 0x1C, 0x20,
            0x24, 0x2E, 0x27, 0x20, 0x22, 0x2C, 0x23, 0x1C, 0x1C, 0x28, 0x37, 0x29,
            0x2C, 0x30, 0x31, 0x34, 0x34, 0x34, 0x1F, 0x27, 0x39, 0x3D, 0x38, 0x32,
            0x3C, 0x2E, 0x33, 0x34, 0x32, 0xFF, 0xC0, 0x00, 0x0B, 0x08, 0x00, 0x01,
            0x00, 0x01, 0x01, 0x01, 0x11, 0x00, 0xFF, 0xC4, 0x00, 0x1F, 0x00, 0x00,
            0x01, 0x05, 0x01, 0x01, 0x01, 0x01, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00,
            0x00, 0x00, 0x00, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
            0x09, 0x0A, 0x0B, 0xFF, 0xC4, 0x00, 0xB5, 0x10, 0x00, 0x02, 0x01, 0x03,
            0x03, 0x02, 0x04, 0x03, 0x05, 0x05, 0x04, 0x04, 0x00, 0x00, 0x01, 0x7D,
            0x01, 0x02, 0x03, 0x00, 0x04, 0x11, 0x05, 0x12, 0x21, 0x31, 0x41, 0x06,
            0x13, 0x51, 0x61, 0x07, 0x22, 0x71, 0x14, 0x32, 0x81, 0x91, 0xA1, 0x08,
            0x23, 0x42, 0xB1, 0xC1, 0x15, 0x52, 0xD1, 0xF0, 0x24, 0x33, 0x62, 0x72,
            0x82, 0x09, 0x0A, 0x16, 0x17, 0x18, 0x19, 0x1A, 0x25, 0x26, 0x27, 0x28,
            0x29, 0x2A, 0x34, 0x35, 0x36, 0x37, 0x38, 0x39, 0x3A, 0x43, 0x44, 0x45,
            0x46, 0x47, 0x48, 0x49, 0x4A, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59,
            0x5A, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6A, 0x73, 0x74, 0x75,
            0x76, 0x77, 0x78, 0x79, 0x7A, 0x83, 0x84, 0x85, 0x86, 0x87, 0x88, 0x89,
            0x8A, 0x92, 0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9A, 0xA2, 0xA3,
            0xA4, 0xA5, 0xA6, 0xA7, 0xA8, 0xA9, 0xAA, 0xB2, 0xB3, 0xB4, 0xB5, 0xB6,
            0xB7, 0xB8, 0xB9, 0xBA, 0xC2, 0xC3, 0xC4, 0xC5, 0xC6, 0xC7, 0xC8, 0xC9,
            0xCA, 0xD2, 0xD3, 0xD4, 0xD5, 0xD6, 0xD7, 0xD8, 0xD9, 0xDA, 0xE1, 0xE2,
            0xE3, 0xE4, 0xE5, 0xE6, 0xE7, 0xE8, 0xE9, 0xEA, 0xF1, 0xF2, 0xF3, 0xF4,
            0xF5, 0xF6, 0xF7, 0xF8, 0xF9, 0xFA, 0xFF, 0xDA, 0x00, 0x08, 0x01, 0x01,
            0x00, 0x00, 0x3F, 0x00, 0xFB, 0xD3, 0xFF, 0xD9,
        ];
    }

    // ── Response DTOs ─────────────────────────────────────────────────────────

    private record QcContextDto(
        Guid RoId, string RoNumber, string CustomerName,
        QcTaskDto QcTask, QcChecklistItemDto[] ChecklistItems,
        PriorSubmissionDto? PriorSubmission, bool AllBuildTasksComplete);

    private record QcTaskDto(Guid Id, string Status, decimal EstimatedHours, decimal ActualHours);
    private record QcChecklistItemDto(string ItemCode, string Label, bool Checked);
    private record PriorSubmissionDto(DateTimeOffset SubmittedAt, string? Notes, string? EmailTo);
    private record QcPhotosDto(GroupDto[] Groups, int TotalCount);
    private record GroupDto(string OperationName, PhotoEntryDto[] Photos);
    private record PhotoEntryDto(Guid Id, string FileName, string Url);
    private record EmailPreviewDto(string To, string Cc, string Subject, string BodyHtml, string BodyText, int PhotoCount);
    private record PassResultDto(Guid RoId, string RoNumber, bool EmailSent, string EmailTo, string? EmailError);
    private record CustomerItem(Guid Id, string Code, string Name);
    private record CreateRoResult(Guid RoId, string RoNumber, int TasksCreated);
}
