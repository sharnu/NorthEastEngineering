namespace Nee.Api.Domain;

public class RepairOrder
{
    public Guid Id { get; set; }
    public string RoNumber { get; set; } = string.Empty;
    public Guid CustomerId { get; set; }
    public string TemplateCode { get; set; } = string.Empty;
    public Guid TemplateVersionId { get; set; }
    public short JobTypeId { get; set; }
    public string? BodyType { get; set; }

    // Vehicle identifiers
    public string? Vin { get; set; }
    public string? Rego { get; set; }
    public string? ChassisNumber { get; set; }
    public string? EngineNumber { get; set; }
    public string? Make { get; set; }
    public string? Model { get; set; }
    public string? PaintColour { get; set; }
    public string? ChassisTag { get; set; }
    public string? Colour { get; set; }
    public DateOnly? BuildDate { get; set; }
    public string? KeyTagNo { get; set; }
    public int? Odometer { get; set; }

    // Source document fields
    public string? SourceRoNumber { get; set; }
    public DateOnly? SourceRoDate { get; set; }
    public string? CustomerNo { get; set; }
    public string? CustomerAbn { get; set; }
    public string? OwnerName { get; set; }
    public string? CustomerOrderNo { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
    public string? BusinessPhone { get; set; }

    // Dates
    public DateOnly RoDate { get; set; }
    public DateTimeOffset? ExpectedInDate { get; set; }
    public DateTimeOffset? RequiredDate { get; set; }
    public DateOnly? DeliveryDate { get; set; }

    public string Status { get; set; } = "DRAFT";
    public string DraftingStatus { get; set; } = "NOT_STARTED";
    public Guid? DraftedBy { get; set; }
    public DateTimeOffset? DraftedAt { get; set; }
    public DateOnly? ScheduledStartWeek { get; set; }
    public short Priority { get; set; } = 3;
    public string? Notes { get; set; }

    // Cancellation / reopen
    public DateTimeOffset? CancelledAt { get; set; }
    public string? CancellationReason { get; set; }
    public Guid? CancelledBy { get; set; }
    public DateTimeOffset? ReopenedAt { get; set; }
    public Guid? ReopenedBy { get; set; }

    public Guid CreatedBy { get; set; }
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public Customer Customer { get; set; } = null!;
    public JobCodeTemplate Template { get; set; } = null!;
    public TemplateVersion TemplateVersion { get; set; } = null!;
    public JobType JobType { get; set; } = null!;
    public ICollection<JobTask> Tasks { get; set; } = new List<JobTask>();
}

public class JobTask
{
    public Guid Id { get; set; }
    public Guid RoId { get; set; }
    public short Sequence { get; set; }
    public string JobCodeLine { get; set; } = string.Empty;
    public short OperationId { get; set; }
    public string OperationName { get; set; } = string.Empty;
    public short StationId { get; set; }
    public string FlowTrack { get; set; } = "BODY";
    public Guid? AssignedToUserId { get; set; }
    public Guid? AssignedByUserId { get; set; }
    public DateTimeOffset? AssignedAt { get; set; }

    public decimal EstimatedHours { get; set; }
    public decimal ActualHours { get; set; }

    public string Status { get; set; } = "PENDING";
    public DateTimeOffset? StartedAt { get; set; }
    public DateTimeOffset? CompletedAt { get; set; }
    public string? Notes { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public RepairOrder RepairOrder { get; set; } = null!;
    public OperationCatalog Operation { get; set; } = null!;
    public Station Station { get; set; } = null!;
    public User? AssignedToUser { get; set; }
    public User? AssignedByUser { get; set; }
}
