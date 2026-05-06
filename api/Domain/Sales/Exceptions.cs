namespace Nee.Api.Domain.Sales;

public class TemplateNotFoundException : Exception
{
    public string TemplateCode { get; }

    public TemplateNotFoundException(string templateCode)
        : base($"Template '{templateCode}' not found or is not active.")
    {
        TemplateCode = templateCode;
    }
}

public class RoValidationException : Exception
{
    public IReadOnlyList<FieldError> FieldErrors { get; }

    public RoValidationException(IEnumerable<FieldError> errors)
        : base("Repair order validation failed.")
    {
        FieldErrors = errors.ToList();
    }
}

public record FieldError(string Field, string Message);
