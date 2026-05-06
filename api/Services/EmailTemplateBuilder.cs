using System.Net;

namespace Nee.Api.Services;

public record EmailTemplateData(
    string RoNumber,
    string CustomerName,
    string? Rego,
    string? Make,
    string? Model,
    string? PaintColour,
    DateTimeOffset CompletionDate,
    decimal TotalActualHours,
    int TaskCount,
    int PhotoCount,
    string TemplateName
);

public static class EmailTemplateBuilder
{
    public static (string Subject, string HtmlBody, string TextBody) Build(EmailTemplateData d)
    {
        Func<string?, string> e = s => WebUtility.HtmlEncode(s ?? string.Empty);

        var subject = $"Build complete: {d.RoNumber} — {d.TemplateName} for {d.Rego ?? d.RoNumber}";

        var html = $"""
            <html><body style="font-family:Arial,sans-serif;color:#1a202c;max-width:600px;">
            <p>Hi {e(d.CustomerName)},</p>
            <p>Your vehicle build is complete and ready for collection.</p>
            <table style="border-collapse:collapse;width:100%;margin-bottom:16px;">
              <tr style="background:#f7fafc;">
                <td style="padding:8px 12px;font-weight:600;border:1px solid #e2e8f0;">RO Number</td>
                <td style="padding:8px 12px;border:1px solid #e2e8f0;">{e(d.RoNumber)}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;font-weight:600;border:1px solid #e2e8f0;">Registration</td>
                <td style="padding:8px 12px;border:1px solid #e2e8f0;">{e(d.Rego ?? "—")}</td>
              </tr>
              <tr style="background:#f7fafc;">
                <td style="padding:8px 12px;font-weight:600;border:1px solid #e2e8f0;">Make / Model</td>
                <td style="padding:8px 12px;border:1px solid #e2e8f0;">{e($"{d.Make} {d.Model}".Trim())}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;font-weight:600;border:1px solid #e2e8f0;">Paint Colour</td>
                <td style="padding:8px 12px;border:1px solid #e2e8f0;">{e(d.PaintColour ?? "—")}</td>
              </tr>
              <tr style="background:#f7fafc;">
                <td style="padding:8px 12px;font-weight:600;border:1px solid #e2e8f0;">Completed</td>
                <td style="padding:8px 12px;border:1px solid #e2e8f0;">{d.CompletionDate:dd MMM yyyy}</td>
              </tr>
              <tr>
                <td style="padding:8px 12px;font-weight:600;border:1px solid #e2e8f0;">Total Hours</td>
                <td style="padding:8px 12px;border:1px solid #e2e8f0;">{d.TotalActualHours:0.##}h across {d.TaskCount} operations</td>
              </tr>
            </table>
            <p>Please contact us to arrange collection.{(d.PhotoCount > 0 ? $" {d.PhotoCount} build photos are available on request." : "")}</p>
            <p>Regards,<br/><strong>North East Engineering</strong></p>
            <p style="color:#a0aec0;font-size:11px;">NEE Production Platform · {DateTime.UtcNow:dd MMM yyyy}</p>
            </body></html>
            """;

        var text = $"""
            Hi {d.CustomerName},

            Your vehicle build is complete and ready for collection.

            RO Number:    {d.RoNumber}
            Registration: {d.Rego ?? "—"}
            Make / Model: {d.Make} {d.Model}
            Paint Colour: {d.PaintColour ?? "—"}
            Completed:    {d.CompletionDate:dd MMM yyyy}
            Total Hours:  {d.TotalActualHours:0.##}h across {d.TaskCount} operations

            Please contact us to arrange collection.{(d.PhotoCount > 0 ? $" {d.PhotoCount} build photos are available on request." : "")}

            Regards,
            North East Engineering

            NEE Production Platform · {DateTime.UtcNow:dd MMM yyyy}
            """;

        return (subject, html, text);
    }
}
