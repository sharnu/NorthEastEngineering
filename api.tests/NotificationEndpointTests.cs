using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using FluentAssertions;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain;
using Xunit;

namespace Nee.Api.Tests;

[Collection("Api")]
public class NotificationEndpointTests(ApiFixture fixture)
{
    private static readonly Guid SupervisorId = new("33333333-3333-3333-3333-333333333333");
    private static readonly Guid SalesUserId  = new("11111111-1111-1111-1111-111111111111");

    private HttpClient Client(Guid userId, params string[] roles)
    {
        var c = fixture.CreateClient();
        c.DefaultRequestHeaders.Authorization =
            new AuthenticationHeaderValue("Bearer", fixture.GenerateToken(userId, roles));
        return c;
    }

    // ── GET /api/notifications ────────────────────────────────────────────────

    [Fact]
    public async Task GetNotifications_Returns200_WithEmptyList_WhenNone()
    {
        var client = Client(SupervisorId, "SUPERVISOR");
        var resp   = await client.GetAsync("/api/notifications");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<NotifItemDto[]>();
        body.Should().NotBeNull();
    }

    [Fact]
    public async Task GetNotifications_Returns401_WhenUnauthenticated()
    {
        var resp = await fixture.CreateClient().GetAsync("/api/notifications");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    [Fact]
    public async Task GetNotifications_ReturnsOnlyOwnNotifications()
    {
        await SeedNotification(SupervisorId, "TestEvent", "For supervisor", "Sup body");
        await SeedNotification(SalesUserId,  "TestEvent", "For sales",     "Sales body");

        var supervisor = Client(SupervisorId, "SUPERVISOR");
        var body = await supervisor.GetFromJsonAsync<NotifItemDto[]>("/api/notifications");
        body.Should().NotBeNull();
        body!.Should().OnlyContain(n => n.Title != "For sales");
    }

    [Fact]
    public async Task GetNotifications_OrdersUnreadFirst()
    {
        // seed a read then an unread notification
        var readId   = await SeedNotification(SupervisorId, "EvtA", "Read notif", "body", isRead: true);
        var unreadId = await SeedNotification(SupervisorId, "EvtB", "Unread notif", "body", isRead: false);

        var client = Client(SupervisorId, "SUPERVISOR");
        var body   = await client.GetFromJsonAsync<NotifItemDto[]>("/api/notifications");
        body.Should().NotBeNull();

        var ids = body!.Select(n => n.Id).ToList();
        ids.IndexOf(unreadId).Should().BeLessThan(ids.IndexOf(readId));
    }

    // ── GET /api/notifications/unread-count ───────────────────────────────────

    [Fact]
    public async Task GetUnreadCount_Returns200_WithCorrectCount()
    {
        await SeedNotification(SupervisorId, "EvtC", "Unread 1", "body", isRead: false);
        await SeedNotification(SupervisorId, "EvtC", "Unread 2", "body", isRead: false);
        await SeedNotification(SupervisorId, "EvtC", "Read 1",   "body", isRead: true);

        var client = Client(SupervisorId, "SUPERVISOR");
        var resp   = await client.GetAsync("/api/notifications/unread-count");
        resp.StatusCode.Should().Be(HttpStatusCode.OK);

        var body = await resp.Content.ReadFromJsonAsync<UnreadCountDto>();
        body.Should().NotBeNull();
        body!.Count.Should().BeGreaterThanOrEqualTo(2);
    }

    [Fact]
    public async Task GetUnreadCount_Returns401_WhenUnauthenticated()
    {
        var resp = await fixture.CreateClient().GetAsync("/api/notifications/unread-count");
        resp.StatusCode.Should().Be(HttpStatusCode.Unauthorized);
    }

    // ── POST /api/notifications/{id}/read ─────────────────────────────────────

    [Fact]
    public async Task MarkRead_Returns204_AndSetsIsRead()
    {
        var id = await SeedNotification(SupervisorId, "EvtD", "Mark me read", "body", isRead: false);

        var client = Client(SupervisorId, "SUPERVISOR");
        var resp   = await client.PostAsync($"/api/notifications/{id}/read", null);
        resp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        await using var db = fixture.CreateDbContext();
        var notif = await db.Notifications.FindAsync(id);
        notif!.IsRead.Should().BeTrue();
    }

    [Fact]
    public async Task MarkRead_Returns404_ForOtherUsersNotification()
    {
        var id = await SeedNotification(SalesUserId, "EvtE", "Not mine", "body", isRead: false);

        var supervisor = Client(SupervisorId, "SUPERVISOR");
        var resp       = await supervisor.PostAsync($"/api/notifications/{id}/read", null);
        resp.StatusCode.Should().Be(HttpStatusCode.NotFound);
    }

    // ── POST /api/notifications/read-all ─────────────────────────────────────

    [Fact]
    public async Task MarkAllRead_Returns204_AndClearsUnreadCount()
    {
        await SeedNotification(SupervisorId, "EvtF", "Unread A", "body", isRead: false);
        await SeedNotification(SupervisorId, "EvtF", "Unread B", "body", isRead: false);

        var client = Client(SupervisorId, "SUPERVISOR");
        var resp   = await client.PostAsync("/api/notifications/read-all", null);
        resp.StatusCode.Should().Be(HttpStatusCode.NoContent);

        var count = await client.GetFromJsonAsync<UnreadCountDto>("/api/notifications/unread-count");
        count!.Count.Should().Be(0);
    }

    // ── Fan-out: RoCreated ────────────────────────────────────────────────────

    [Fact]
    public async Task CreateRo_FansOutNotification_ToSupervisor()
    {
        var supervisor = Client(SupervisorId, "SUPERVISOR");
        var countBefore = (await supervisor.GetFromJsonAsync<UnreadCountDto>(
            "/api/notifications/unread-count"))!.Count;

        // Create an RO (triggers RoCreated domain event → fan-out)
        var sales     = Client(SalesUserId, "SALES");
        var customers = await sales.GetFromJsonAsync<CustomerItem[]>("/api/customers");
        await sales.PostAsJsonAsync("/api/repair-orders", new
        {
            CustomerId   = customers!.First().Id,
            JobTypeId    = 1,
            TemplateCode = "TP42N",
            Rego         = $"FANOUT{Guid.NewGuid():N}".Substring(0, 10),
            Priority     = 2,
        });

        var countAfter = (await supervisor.GetFromJsonAsync<UnreadCountDto>(
            "/api/notifications/unread-count"))!.Count;

        countAfter.Should().BeGreaterThan(countBefore);
    }

    // ── Helpers ───────────────────────────────────────────────────────────────

    private async Task<Guid> SeedNotification(
        Guid userId, string eventType, string title, string body,
        bool isRead = false)
    {
        await using var db = fixture.CreateDbContext();
        var n = new Notification
        {
            Id         = Guid.NewGuid(),
            UserId     = userId,
            EventType  = eventType,
            Title      = title,
            Body       = body,
            IsRead     = isRead,
            CreatedAt  = DateTimeOffset.UtcNow,
        };
        db.Notifications.Add(n);
        await db.SaveChangesAsync();
        return n.Id;
    }

    // ── Response DTOs ─────────────────────────────────────────────────────────

    private record NotifItemDto(
        Guid Id, string EventType, string Title, string Body,
        string? EntityType, Guid? EntityId, bool IsRead, DateTimeOffset CreatedAt);

    private record UnreadCountDto(int Count);
    private record CustomerItem(Guid Id, string Code, string Name);
}
