using System.Text.Json;

namespace Nee.Api.Domain;

public class ChassisStockUpload
{
    public Guid Id { get; set; }
    public Guid UploadedBy { get; set; }
    public DateTimeOffset UploadedAt { get; set; }
    public string FileName { get; set; } = string.Empty;
    public string BlobPath { get; set; } = string.Empty;
    public int RowCount { get; set; }
    public int InsertedCount { get; set; }
    public int UpdatedCount { get; set; }
    public int StaleAfterCount { get; set; }
    public string Status { get; set; } = "PARSED";
    public JsonDocument? ParseErrors { get; set; }
    public DateTimeOffset? CommittedAt { get; set; }
}
