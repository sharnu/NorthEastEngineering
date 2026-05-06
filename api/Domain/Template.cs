namespace Nee.Api.Domain;

public class JobCodeTemplate
{
    public string Code { get; set; } = string.Empty;
    public string? BaseCode { get; set; }
    public Guid? CustomerId { get; set; }
    public short BodyTypeId { get; set; }
    public short JobTypeId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Description { get; set; }
    public int? BodySizeMm { get; set; }
    public char? ChassisClass { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }

    public BodyType BodyType { get; set; } = null!;
    public Customer? Customer { get; set; }
    public ICollection<TemplateVersion> Versions { get; set; } = new List<TemplateVersion>();
}

public class TemplateVersion
{
    public Guid Id { get; set; }
    public string TemplateCode { get; set; } = string.Empty;
    public int VersionNumber { get; set; }
    public DateTimeOffset EffectiveFrom { get; set; }
    public DateTimeOffset? SupersededAt { get; set; }
    public decimal TotalEstimatedHours { get; set; }
    public string? BodyType { get; set; }
    public DateTimeOffset CreatedAt { get; set; }

    public JobCodeTemplate Template { get; set; } = null!;
    public ICollection<TemplateOperation> Operations { get; set; } = new List<TemplateOperation>();
}

public class TemplateOperation
{
    public Guid Id { get; set; }
    public Guid TemplateVersionId { get; set; }
    public short Sequence { get; set; }
    public short OperationId { get; set; }
    public decimal EstimatedHours { get; set; }
    public short? StationIdOverride { get; set; }
    public string FlowTrack { get; set; } = "BODY";
    public string? Notes { get; set; }

    public TemplateVersion TemplateVersion { get; set; } = null!;
    public OperationCatalog Operation { get; set; } = null!;
}
