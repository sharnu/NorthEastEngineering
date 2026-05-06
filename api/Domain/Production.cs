namespace Nee.Api.Domain;

public class QcChecklistItem
{
    public short Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Label { get; set; } = string.Empty;
    public short SortOrder { get; set; }
}

public class QcResult
{
    public Guid Id { get; set; }
    public Guid RoId { get; set; }
    public string ItemCode { get; set; } = string.Empty;
    public bool Passed { get; set; }
    public string? Notes { get; set; }
    public Guid RecordedBy { get; set; }
    public DateTimeOffset RecordedAt { get; set; }
}

public class Notification
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string EventType { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Body { get; set; } = string.Empty;
    public string? EntityType { get; set; }
    public Guid? EntityId { get; set; }
    public bool IsRead { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class Attachment
{
    public Guid Id { get; set; }
    public string EntityType { get; set; } = string.Empty;
    public Guid EntityId { get; set; }
    public string Category { get; set; } = string.Empty;
    public string FileName { get; set; } = string.Empty;
    public string ContentType { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public string BlobContainer { get; set; } = string.Empty;
    public string BlobPath { get; set; } = string.Empty;
    public Guid UploadedBy { get; set; }
    public DateTimeOffset UploadedAt { get; set; }
}

public class KanbanStage
{
    public short Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public short SortOrder { get; set; }
    public bool IsTerminal { get; set; }
    public bool IsMergePoint { get; set; }
}

public class RoKanbanState
{
    public Guid RoId { get; set; }
    public short CurrentStageId { get; set; }
    public DateTimeOffset EnteredStageAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
    public DateTimeOffset? LastOverrideAt { get; set; }
    public string? LastOverrideReason { get; set; }
    public Guid? LastOverrideBy { get; set; }

    public RepairOrder RepairOrder { get; set; } = null!;
    public KanbanStage CurrentStage { get; set; } = null!;
}

public class VarianceReason
{
    public short Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool IsOverrun { get; set; }
    public bool IsActive { get; set; }
}

public class VarianceRecord
{
    public Guid Id { get; set; }
    public Guid TaskId { get; set; }
    public decimal EstimatedHours { get; set; }
    public decimal ActualHours { get; set; }
    public decimal DeltaHours { get; set; }
    public decimal? DeltaPercent { get; set; }
    public short ReasonId { get; set; }
    public string? Notes { get; set; }
    public Guid RecordedBy { get; set; }
    public DateTimeOffset RecordedAt { get; set; }

    public JobTask Task { get; set; } = null!;
    public VarianceReason Reason { get; set; } = null!;
}

public class QcSubmission
{
    public Guid Id { get; set; }
    public Guid RoId { get; set; }
    public Guid TaskId { get; set; }
    public Guid SubmittedBy { get; set; }
    public DateTimeOffset SubmittedAt { get; set; }
    public System.Text.Json.JsonDocument ItemResponses { get; set; } = System.Text.Json.JsonDocument.Parse("[]");
    public string? Notes { get; set; }
    public bool EmailSent { get; set; }
    public DateTimeOffset? EmailSentAt { get; set; }
    public string? EmailTo { get; set; }

    public RepairOrder RepairOrder { get; set; } = null!;
    public JobTask Task { get; set; } = null!;
}

public class ChassisInventory
{
    public Guid Id { get; set; }
    public string ChassisNumber { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string ChassisClass { get; set; } = string.Empty;
    public string Status { get; set; } = "AVAILABLE";
    public Guid? AllocatedToRo { get; set; }
    public DateTimeOffset? ReceivedAt { get; set; }
    public DateTimeOffset? AllocatedAt { get; set; }
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}

public class CustomerApproval
{
    public Guid Id { get; set; }
    public Guid RoId { get; set; }
    public string DocumentType { get; set; } = string.Empty;
    public DateTimeOffset? SignedAt { get; set; }
    public string? SignedByName { get; set; }
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
}

public class TimeEntry
{
    public Guid Id { get; set; }
    public Guid TaskId { get; set; }
    public Guid UserId { get; set; }
    public DateTimeOffset ClockIn { get; set; }
    public DateTimeOffset? ClockOut { get; set; }
    public int? DurationMinutes { get; set; }
    public string ActivityType { get; set; } = "WORK";
    public string? Notes { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public JobTask Task { get; set; } = null!;
    public User User { get; set; } = null!;
}
