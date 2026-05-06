using System.Text.Json;

namespace Nee.Api.Domain;

public class DomainEvent
{
    public long Id { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string AggregateType { get; set; } = string.Empty;
    public Guid AggregateId { get; set; }
    public JsonDocument Payload { get; set; } = JsonDocument.Parse("{}");
    public Guid? UserId { get; set; }
    public DateTimeOffset OccurredAt { get; set; }
}
