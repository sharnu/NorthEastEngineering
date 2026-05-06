namespace Nee.Api.Domain;

public class BodyType
{
    public short Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public short SortOrder { get; set; }
}

public class JobType
{
    public short Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
}

public class Station
{
    public short Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public bool IsActive { get; set; } = true;
    public short SortOrder { get; set; }
    public Guid? OwnerUserId { get; set; }

    public User? OwnerUser { get; set; }
    public ICollection<StationTechnician> Technicians { get; set; } = new List<StationTechnician>();
    public ICollection<OperationCatalog> Operations { get; set; } = new List<OperationCatalog>();
}

public class StationTechnician
{
    public short StationId { get; set; }
    public Guid UserId { get; set; }
    public bool IsPrimary { get; set; }
    public short SkillLevel { get; set; } = 3;

    public Station Station { get; set; } = null!;
    public User User { get; set; } = null!;
}

public class OperationCatalog
{
    public short Id { get; set; }
    public string Code { get; set; } = string.Empty;
    public string CanonicalName { get; set; } = string.Empty;
    public short DefaultStationId { get; set; }
    public decimal? TypicalHours { get; set; }
    public bool IsActive { get; set; } = true;

    public Station DefaultStation { get; set; } = null!;
}
