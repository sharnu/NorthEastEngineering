namespace Nee.Api.Domain;

public class FlowDefinition
{
    public int Id { get; set; }
    public string BodyType { get; set; } = "";
    public string Track { get; set; } = "";
    public short StationId { get; set; }
    public short SortOrder { get; set; }
    public bool IsOptional { get; set; }

    public Station Station { get; set; } = null!;
}
