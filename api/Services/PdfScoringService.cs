using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;

namespace Nee.Api.Services;

public record ScoredField(string? Value, string Confidence, CustomerSuggestion? Suggestion = null);
public record CustomerSuggestion(Guid CustomerId, string CustomerName);
public record ScoredPdfResult(Dictionary<string, ScoredField> Fields);

public class PdfScoringService(NeeDbContext db)
{
    public async Task<ScoredPdfResult> ScoreAsync(ParsedPdfResult raw, CancellationToken ct)
    {
        var scored = new Dictionary<string, ScoredField>();

        foreach (var (key, field) in raw.Fields)
        {
            scored[key] = key switch
            {
                "rego"         => ScoreRego(field),
                "requiredDate" => ScoreRequiredDate(field),
                "templateCode" => await ScoreTemplateCodeAsync(field, ct),
                "customerName" => await ScoreCustomerNameAsync(field, ct),
                _              => new ScoredField(field.Value, field.Confidence),
            };
        }

        return new ScoredPdfResult(scored);
    }

    private static ScoredField ScoreRego(ParsedField field)
    {
        if (field.Value is null) return new ScoredField(null, field.Confidence);

        // Rego must be uppercase alphanumeric (with optional dash)
        var valid = field.Value.All(c => char.IsUpper(c) || char.IsDigit(c) || c == '-');
        var confidence = valid ? field.Confidence : "MEDIUM";
        return new ScoredField(field.Value, confidence);
    }

    private static ScoredField ScoreRequiredDate(ParsedField field)
    {
        if (field.Value is null) return new ScoredField(null, field.Confidence);

        if (DateTime.TryParse(field.Value, out var parsed))
        {
            var now = DateTime.UtcNow;
            if (parsed < now || parsed > now.AddYears(2))
                return new ScoredField(field.Value, "LOW");
        }

        return new ScoredField(field.Value, field.Confidence);
    }

    private async Task<ScoredField> ScoreTemplateCodeAsync(ParsedField field, CancellationToken ct)
    {
        if (field.Value is null) return new ScoredField(null, field.Confidence);

        var exists = await db.JobCodeTemplates
            .AnyAsync(t => t.Code == field.Value && t.IsActive, ct);

        var confidence = exists ? "MEDIUM" : field.Confidence;
        return new ScoredField(field.Value, confidence);
    }

    private async Task<ScoredField> ScoreCustomerNameAsync(ParsedField field, CancellationToken ct)
    {
        if (field.Value is null) return new ScoredField(null, field.Confidence);

        var customers = await db.Customers
            .Select(c => new { c.Id, c.Name })
            .ToListAsync(ct);

        // Exact match (case-insensitive)
        var exact = customers.FirstOrDefault(c =>
            string.Equals(c.Name, field.Value, StringComparison.OrdinalIgnoreCase));

        if (exact is not null)
            return new ScoredField(field.Value, "HIGH",
                new CustomerSuggestion(exact.Id, exact.Name));

        // Fuzzy match within Levenshtein distance 3
        var best = customers
            .Select(c => new { c.Id, c.Name, Dist = Levenshtein(field.Value.ToLower(), c.Name.ToLower()) })
            .Where(x => x.Dist <= 3)
            .OrderBy(x => x.Dist)
            .FirstOrDefault();

        if (best is not null)
            return new ScoredField(field.Value, "MEDIUM",
                new CustomerSuggestion(best.Id, best.Name));

        return new ScoredField(field.Value, "MEDIUM");
    }

    private static int Levenshtein(string a, string b)
    {
        var m = a.Length;
        var n = b.Length;
        var dp = new int[m + 1, n + 1];

        for (var i = 0; i <= m; i++) dp[i, 0] = i;
        for (var j = 0; j <= n; j++) dp[0, j] = j;

        for (var i = 1; i <= m; i++)
        {
            for (var j = 1; j <= n; j++)
            {
                dp[i, j] = a[i - 1] == b[j - 1]
                    ? dp[i - 1, j - 1]
                    : 1 + Math.Min(dp[i - 1, j - 1], Math.Min(dp[i - 1, j], dp[i, j - 1]));
            }
        }

        return dp[m, n];
    }
}
