namespace Nee.Api.Services;

public interface IGateEvaluator
{
    (string State, string? Reason) Evaluate(Guid roId, short stationId);
}

// E24-S1 will replace this with real gate logic.
public class StubGateEvaluator : IGateEvaluator
{
    public (string State, string? Reason) Evaluate(Guid roId, short stationId)
        => ("IN_PROGRESS", null);
}
