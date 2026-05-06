using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Services;

namespace Nee.Api.Domain.Sales;

public record MaterialiseRoCommand(
    Guid CustomerId,
    short JobTypeId,
    string TemplateCode,
    // Core vehicle fields
    string? Vin,
    string? Rego,
    string? Make,
    string? Model,
    string? PaintColour,
    DateTimeOffset? RequiredDate,
    short Priority,
    Guid CreatedByUserId,
    // Extended vehicle fields
    string? ChassisNumber = null,
    string? EngineNumber = null,
    DateOnly? BuildDate = null,
    string? KeyTagNo = null,
    int? Odometer = null,
    DateTimeOffset? ExpectedInDate = null,
    // Source document fields
    string? SourceRoNumber = null,
    DateOnly? SourceRoDate = null,
    string? CustomerNo = null,
    string? CustomerAbn = null,
    string? OwnerName = null,
    string? CustomerOrderNo = null,
    string? ContactEmail = null,
    string? ContactPhone = null,
    string? BusinessPhone = null,
    DateOnly? DeliveryDate = null
);

public record RoMaterialisationResult(
    Guid RoId,
    string RoNumber,
    int TasksCreated
);

public class RoMaterialisationService(NeeDbContext db, INotificationService notifications)
{
    public async Task<RoMaterialisationResult> MaterialiseAsync(
        MaterialiseRoCommand cmd,
        CancellationToken ct = default)
    {
        Validate(cmd);

        var customer = await db.Customers
            .FirstOrDefaultAsync(c => c.Id == cmd.CustomerId && c.IsActive, ct)
            ?? throw new RoValidationException([new("customerId", "Customer not found or inactive.")]);

        var version = await db.TemplateVersions
            .Include(v => v.Operations)
                .ThenInclude(o => o.Operation)
                    .ThenInclude(op => op.DefaultStation)
            .Include(v => v.Template)
            .Where(v => v.TemplateCode == cmd.TemplateCode && v.SupersededAt == null)
            .OrderByDescending(v => v.VersionNumber)
            .FirstOrDefaultAsync(ct)
            ?? throw new TemplateNotFoundException(cmd.TemplateCode);

        var jobType = await db.JobTypes
            .FirstOrDefaultAsync(j => j.Id == cmd.JobTypeId, ct)
            ?? throw new RoValidationException([new("jobTypeId", "Job type not found.")]);

        await db.Database.ExecuteSqlRawAsync(
            "CREATE SEQUENCE IF NOT EXISTS ro_number_seq START 1 INCREMENT BY 1 NO MAXVALUE CACHE 1;",
            ct);

        var seqRows = await db.Database
            .SqlQueryRaw<long>("SELECT nextval('ro_number_seq')")
            .ToListAsync(ct);
        var roNumber = $"RO{seqRows[0]:D5}";

        var ro = new RepairOrder
        {
            Id = Guid.NewGuid(),
            RoNumber = roNumber,
            CustomerId = cmd.CustomerId,
            TemplateCode = cmd.TemplateCode,
            TemplateVersionId = version.Id,
            JobTypeId = cmd.JobTypeId,
            BodyType = version.BodyType,
            Vin = cmd.Vin,
            Rego = cmd.Rego,
            ChassisNumber = cmd.ChassisNumber,
            EngineNumber = cmd.EngineNumber,
            Make = cmd.Make,
            Model = cmd.Model,
            PaintColour = cmd.PaintColour,
            BuildDate = cmd.BuildDate,
            KeyTagNo = cmd.KeyTagNo,
            Odometer = cmd.Odometer,
            RoDate = DateOnly.FromDateTime(DateTime.UtcNow),
            ExpectedInDate = cmd.ExpectedInDate,
            RequiredDate = cmd.RequiredDate,
            SourceRoNumber = cmd.SourceRoNumber,
            SourceRoDate = cmd.SourceRoDate,
            CustomerNo = cmd.CustomerNo,
            CustomerAbn = cmd.CustomerAbn,
            OwnerName = cmd.OwnerName,
            CustomerOrderNo = cmd.CustomerOrderNo,
            ContactEmail = cmd.ContactEmail,
            ContactPhone = cmd.ContactPhone,
            BusinessPhone = cmd.BusinessPhone,
            DeliveryDate = cmd.DeliveryDate,
            Status = "DRAFT",
            Priority = cmd.Priority,
            CreatedBy = cmd.CreatedByUserId,
            CreatedAt = DateTimeOffset.UtcNow,
            UpdatedAt = DateTimeOffset.UtcNow,
        };
        db.RepairOrders.Add(ro);

        var orderedOps = version.Operations.OrderBy(o => o.Sequence).ToList();
        foreach (var op in orderedOps)
        {
            var stationId = op.StationIdOverride ?? op.Operation.DefaultStationId;
            var task = new JobTask
            {
                Id = Guid.NewGuid(),
                RoId = ro.Id,
                Sequence = op.Sequence,
                JobCodeLine = $"{op.Sequence:00}{cmd.TemplateCode}-{op.Operation.Code}",
                OperationId = op.OperationId,
                OperationName = op.Operation.CanonicalName,
                StationId = stationId,
                FlowTrack = op.FlowTrack,
                EstimatedHours = op.EstimatedHours,
                Status = "PENDING",
                CreatedAt = DateTimeOffset.UtcNow,
                UpdatedAt = DateTimeOffset.UtcNow,
            };
            db.JobTasks.Add(task);
        }

        var payload = JsonSerializer.SerializeToDocument(new
        {
            roId = ro.Id,
            roNumber,
            customerId = cmd.CustomerId,
            customerName = customer.Name,
            templateCode = cmd.TemplateCode,
            taskCount = orderedOps.Count,
        });
        var domainEvt = new DomainEvent
        {
            EventType     = "RoCreated",
            AggregateType = "RepairOrder",
            AggregateId   = ro.Id,
            Payload       = payload,
            UserId        = cmd.CreatedByUserId,
            OccurredAt    = DateTimeOffset.UtcNow,
        };
        db.DomainEvents.Add(domainEvt);

        // Dispose the transaction before FanOutAsync — Npgsql throws if the connection
        // still holds a completed (committed) transaction when the next SaveChanges runs.
        await using (var tx = await db.Database.BeginTransactionAsync(ct))
        {
            try
            {
                await db.SaveChangesAsync(ct);
                await tx.CommitAsync(ct);
            }
            catch
            {
                try { await tx.RollbackAsync(CancellationToken.None); } catch { }
                throw;
            }
        }

        await notifications.FanOutAsync(domainEvt, ct);
        return new RoMaterialisationResult(ro.Id, roNumber, orderedOps.Count);
    }

    private static void Validate(MaterialiseRoCommand cmd)
    {
        var errors = new List<FieldError>();

        if (!string.IsNullOrWhiteSpace(cmd.Vin) && cmd.Vin.Length != 17)
            errors.Add(new("vin", "VIN must be exactly 17 characters."));

        if (string.IsNullOrWhiteSpace(cmd.Rego))
            errors.Add(new("rego", "Rego is required."));

        if (cmd.Priority is < 1 or > 5)
            errors.Add(new("priority", "Priority must be between 1 and 5."));

        if (errors.Count > 0)
            throw new RoValidationException(errors);
    }
}
