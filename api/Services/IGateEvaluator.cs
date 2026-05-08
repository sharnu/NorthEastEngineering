namespace Nee.Api.Services;

public interface IGateEvaluator
{
    Task<GateResult> Evaluate(Guid roId, short stationId, CancellationToken ct);
}

public record GateResult(string State, string? Reason);
