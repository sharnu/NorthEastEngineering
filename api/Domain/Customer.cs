namespace Nee.Api.Domain;

public class Customer
{
    public Guid Id { get; set; }
    public string? Code { get; set; }
    public string Name { get; set; } = string.Empty;
    public string? Abn { get; set; }
    public string? CustomerNo { get; set; }
    public string? BillToName { get; set; }
    public string? BillToAddress { get; set; }
    public string? ContactEmail { get; set; }
    public string? ContactPhone { get; set; }
    public string? EmailDl { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTimeOffset CreatedAt { get; set; }
    public DateTimeOffset UpdatedAt { get; set; }
}
