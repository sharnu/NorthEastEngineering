using System.Security.Claims;
using FluentValidation;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain;
using Nee.Api.Domain.Events;
using Nee.Api.Domain.Sales;

namespace Nee.Api.Endpoints;

public record CreateRoRequest(
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
    short Priority = 3,
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

public class CreateRoRequestValidator : AbstractValidator<CreateRoRequest>
{
    public CreateRoRequestValidator()
    {
        RuleFor(x => x.CustomerId).NotEmpty().WithMessage("customerId is required.");
        RuleFor(x => x.JobTypeId).GreaterThan((short)0).WithMessage("jobTypeId is required.");
        RuleFor(x => x.TemplateCode).NotEmpty().WithMessage("templateCode is required.");
        RuleFor(x => x.Rego).NotEmpty().WithMessage("rego is required.");
        RuleFor(x => x.Vin)
            .Length(17).WithMessage("VIN must be exactly 17 characters.")
            .When(x => !string.IsNullOrWhiteSpace(x.Vin));
        RuleFor(x => x.Priority).InclusiveBetween((short)1, (short)5).WithMessage("priority must be between 1 and 5.");
    }
}

public static class RepairOrderEndpoints
{
    public static void MapRepairOrderEndpoints(this WebApplication app)
    {
        var grp = app.MapGroup("/api/repair-orders").RequireAuthorization().WithTags("RepairOrders");

        // POST /api/repair-orders
        grp.MapPost("/", async (
            CreateRoRequest req,
            IValidator<CreateRoRequest> validator,
            RoMaterialisationService svc,
            ClaimsPrincipal user,
            ILoggerFactory loggerFactory,
            CancellationToken ct) =>
        {
            var validation = await validator.ValidateAsync(req, ct);
            if (!validation.IsValid)
            {
                var errors = validation.Errors
                    .GroupBy(e => e.PropertyName.ToLowerInvariant())
                    .ToDictionary(g => g.Key, g => g.Select(e => e.ErrorMessage).ToArray());
                return Results.ValidationProblem(errors);
            }

            var userIdStr = user.FindFirstValue(JwtRegisteredClaimNames.Sub)
                            ?? user.FindFirstValue(ClaimTypes.NameIdentifier);

            if (!Guid.TryParse(userIdStr, out var userId))
                return Results.Unauthorized();

            var cmd = new MaterialiseRoCommand(
                CustomerId: req.CustomerId,
                JobTypeId: req.JobTypeId,
                TemplateCode: req.TemplateCode,
                Vin: req.Vin,
                Rego: req.Rego,
                Make: req.Make,
                Model: req.Model,
                PaintColour: req.PaintColour,
                RequiredDate: req.RequiredDate,
                Priority: req.Priority,
                CreatedByUserId: userId,
                ChassisNumber: req.ChassisNumber,
                EngineNumber: req.EngineNumber,
                BuildDate: req.BuildDate,
                KeyTagNo: req.KeyTagNo,
                Odometer: req.Odometer,
                ExpectedInDate: req.ExpectedInDate,
                SourceRoNumber: req.SourceRoNumber,
                SourceRoDate: req.SourceRoDate,
                CustomerNo: req.CustomerNo,
                CustomerAbn: req.CustomerAbn,
                OwnerName: req.OwnerName,
                CustomerOrderNo: req.CustomerOrderNo,
                ContactEmail: req.ContactEmail,
                ContactPhone: req.ContactPhone,
                BusinessPhone: req.BusinessPhone,
                DeliveryDate: req.DeliveryDate);

            var result = await svc.MaterialiseAsync(cmd, ct);

            loggerFactory.CreateLogger("RepairOrders")
                .LogInformation("RO created: {RoNumber} by user {UserId} ({TaskCount} tasks)",
                    result.RoNumber, userId, result.TasksCreated);

            return Results.Created(
                $"/api/repair-orders/{result.RoId}",
                new { result.RoId, result.RoNumber, result.TasksCreated });
        })
        .RequireAuthorization(p => p.RequireRole("SALES", "ADMIN"))
        .WithName("CreateRepairOrder");

        // GET /api/repair-orders
        grp.MapGet("/", async (string? status, Guid? customerId, NeeDbContext db, CancellationToken ct) =>
        {
            var excluded = new[] { "COMPLETED", "CANCELLED" };

            var query = db.RepairOrders
                .Include(r => r.Customer)
                .Include(r => r.JobType)
                .Include(r => r.Template).ThenInclude(t => t.BodyType)
                .Include(r => r.Tasks)
                .Where(r => !excluded.Contains(r.Status));

            if (!string.IsNullOrWhiteSpace(status))
                query = query.Where(r => r.Status == status.ToUpper());

            if (customerId.HasValue)
                query = query.Where(r => r.CustomerId == customerId.Value);

            var ros = await query
                .OrderBy(r => r.Priority)
                .ThenBy(r => r.RequiredDate == null ? 1 : 0)
                .ThenBy(r => r.RequiredDate)
                .ToListAsync(ct);

            var roIds = ros.Select(r => r.Id).ToList();
            var stages = await db.RoKanbanStates
                .Where(s => roIds.Contains(s.RoId))
                .Join(db.KanbanStages, s => s.CurrentStageId, k => k.Id, (s, k) => new { s.RoId, k.Name })
                .ToDictionaryAsync(x => x.RoId, x => x.Name, ct);

            var result = ros.Select(r =>
            {
                var taskCount = r.Tasks.Count;
                var tasksCompleted = r.Tasks.Count(t => t.Status == "COMPLETED");
                var hoursScheduled = r.Tasks.Sum(t => t.EstimatedHours);
                var hoursUtilised = r.Tasks.Sum(t => t.ActualHours);
                var completionPct = taskCount > 0
                    ? Math.Round((decimal)tasksCompleted / taskCount * 100, 1)
                    : 0m;

                return new
                {
                    r.Id,
                    r.RoNumber,
                    r.Rego,
                    r.SourceRoNumber,
                    JobTypeName = r.JobType != null ? r.JobType.Name : null,
                    CustomerName = r.Customer.Name,
                    r.TemplateCode,
                    BodyType = r.Template.BodyType.Name,
                    CurrentStage = stages.TryGetValue(r.Id, out var s) ? s : null,
                    r.Status,
                    r.Priority,
                    r.RequiredDate,
                    HoursScheduled = hoursScheduled,
                    HoursUtilised = hoursUtilised,
                    TaskCount = taskCount,
                    TasksCompleted = tasksCompleted,
                    CompletionPct = completionPct,
                };
            });

            return Results.Ok(result);
        })
        .RequireAuthorization(p => p.RequireRole("SALES", "SUPERVISOR", "ADMIN"))
        .WithName("ListRepairOrders");

        // GET /api/repair-orders/{id}
        grp.MapGet("/{id:guid}", async (Guid id, NeeDbContext db, CancellationToken ct) =>
        {
            var ro = await db.RepairOrders
                .Include(r => r.Customer)
                .Include(r => r.JobType)
                .Include(r => r.Template).ThenInclude(t => t.BodyType)
                .Include(r => r.Tasks.OrderBy(t => t.Sequence))
                    .ThenInclude(t => t.Station)
                .Include(r => r.Tasks.OrderBy(t => t.Sequence))
                    .ThenInclude(t => t.Operation)
                .FirstOrDefaultAsync(r => r.Id == id, ct);

            if (ro is null)
                return Results.NotFound(new { message = $"Repair order '{id}' not found." });

            var sourcePdf = await db.Attachments
                .Where(a => a.EntityType == "RepairOrder" && a.EntityId == id && a.Category == "SOURCE_PDF")
                .Select(a => a.BlobPath)
                .FirstOrDefaultAsync(ct);

            var sourcePdfUrl = sourcePdf is not null ? $"/uploads/{sourcePdf}" : null;

            // Resolve cancelled-by / reopened-by names
            var cancelledByName = ro.CancelledBy.HasValue
                ? await db.Users.Where(u => u.Id == ro.CancelledBy).Select(u => u.FullName).FirstOrDefaultAsync(ct)
                : null;

            // Batch query for tasks that have time entries (avoids correlated subquery in in-memory projection)
            var roTaskIds = ro.Tasks.Select(t => t.Id).ToList();
            var taskIdsWithWork = await db.TimeEntries
                .Where(te => roTaskIds.Contains(te.TaskId))
                .Select(te => te.TaskId)
                .Distinct()
                .ToHashSetAsync(ct);

            var result = new
            {
                ro.Id,
                ro.RoNumber,
                Customer = new { ro.Customer.Id, ro.Customer.Name },
                JobTypeId = ro.JobTypeId,
                JobType = ro.JobType.Name,
                BodyType = ro.Template.BodyType.Name,
                // Vehicle
                ro.Vin,
                ro.Rego,
                ro.ChassisNumber,
                ro.EngineNumber,
                ro.Make,
                ro.Model,
                ro.PaintColour,
                ro.BuildDate,
                ro.KeyTagNo,
                ro.Odometer,
                // Dates
                ro.ExpectedInDate,
                ro.RequiredDate,
                ro.DeliveryDate,
                // Source document
                ro.SourceRoNumber,
                ro.SourceRoDate,
                ro.CustomerNo,
                ro.CustomerAbn,
                ro.OwnerName,
                ro.CustomerOrderNo,
                ro.ContactEmail,
                ro.ContactPhone,
                ro.BusinessPhone,
                ro.Status,
                ro.Priority,
                ro.Notes,
                ro.CreatedAt,
                // Cancellation
                ro.CancelledAt,
                ro.CancellationReason,
                CancelledByName = cancelledByName,
                ro.ReopenedAt,
                TotalEstimatedHours = ro.Tasks.Sum(t => t.EstimatedHours),
                SourcePdfUrl = sourcePdfUrl,
                Tasks = ro.Tasks.Select(t => new
                {
                    t.Id,
                    t.Sequence,
                    t.JobCodeLine,
                    t.OperationId,
                    OperationCode = t.Operation != null ? t.Operation.Code : null,
                    t.OperationName,
                    t.StationId,
                    StationName = t.Station.Name,
                    t.EstimatedHours,
                    t.ActualHours,
                    t.Status,
                    HasWork = taskIdsWithWork.Contains(t.Id),
                }),
            };

            return Results.Ok(result);
        }).WithName("GetRepairOrderById");

        // GET /api/operations — operation catalogue for add-task form
        app.MapGet("/api/operations", async (NeeDbContext db, CancellationToken ct) =>
        {
            var ops = await db.OperationCatalog
                .Where(o => o.IsActive)
                .OrderBy(o => o.Code)
                .Select(o => new { o.Id, o.Code, o.CanonicalName, o.DefaultStationId, o.TypicalHours })
                .ToListAsync(ct);
            return Results.Ok(ops);
        })
        .RequireAuthorization(p => p.RequireRole("SALES", "SUPERVISOR", "ADMIN"))
        .WithTags("RepairOrders")
        .WithName("GetOperations");

        // PUT /api/repair-orders/{id} — edit header fields (E14-S1)
        grp.MapPut("/{id:guid}", async (
            Guid id,
            UpdateRoRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var ro = await db.RepairOrders.FindAsync(new object[] { id }, ct);
            if (ro is null) return Results.NotFound();
            if (ro.Status is "COMPLETED" or "CANCELLED")
                return Results.Conflict(new { message = "Cannot edit a completed or cancelled repair order." });

            var userId = GetCallerId(principal);

            // Guard: customer change blocked once work has started
            if (req.CustomerId.HasValue && req.CustomerId.Value != ro.CustomerId)
            {
                var hasWork = await db.TimeEntries
                    .AnyAsync(te => db.JobTasks.Where(t => t.RoId == id).Select(t => t.Id).Contains(te.TaskId), ct);
                if (hasWork)
                    return Results.UnprocessableEntity(new { message = "Cannot reassign customer once work has been logged." });
            }

            // Emit one RoFieldChanged event per mutated field
            void MutateStringProp(string field, string? current, string? next, Action<string?> set)
            {
                if (next is null || next == current) return;
                RoLifecycleEvents.EmitRoFieldChanged(db, id, userId, field, current, next);
                set(next);
            }

            if (req.CustomerId.HasValue && req.CustomerId.Value != ro.CustomerId)
            {
                RoLifecycleEvents.EmitRoFieldChanged(db, id, userId, "customerId", ro.CustomerId.ToString(), req.CustomerId.Value.ToString());
                ro.CustomerId = req.CustomerId.Value;
            }
            if (req.JobTypeId.HasValue && req.JobTypeId.Value != ro.JobTypeId)
            {
                RoLifecycleEvents.EmitRoFieldChanged(db, id, userId, "jobTypeId", ro.JobTypeId.ToString(), req.JobTypeId.Value.ToString());
                ro.JobTypeId = req.JobTypeId.Value;
            }
            MutateStringProp("rego", ro.Rego, req.Rego, v => ro.Rego = v);
            MutateStringProp("vin", ro.Vin, req.Vin, v => ro.Vin = v);
            MutateStringProp("make", ro.Make, req.Make, v => ro.Make = v);
            MutateStringProp("model", ro.Model, req.Model, v => ro.Model = v);
            MutateStringProp("paintColour", ro.PaintColour, req.PaintColour, v => ro.PaintColour = v);
            MutateStringProp("chassisNumber", ro.ChassisNumber, req.ChassisNumber, v => ro.ChassisNumber = v);
            MutateStringProp("engineNumber", ro.EngineNumber, req.EngineNumber, v => ro.EngineNumber = v);
            MutateStringProp("notes", ro.Notes, req.Notes, v => ro.Notes = v);

            if (req.Priority.HasValue && req.Priority.Value != ro.Priority)
            {
                RoLifecycleEvents.EmitRoFieldChanged(db, id, userId, "priority", ro.Priority.ToString(), req.Priority.Value.ToString());
                ro.Priority = req.Priority.Value;
            }
            if (req.ExpectedInDate != ro.ExpectedInDate && req.ExpectedInDate != default)
            {
                RoLifecycleEvents.EmitRoFieldChanged(db, id, userId, "expectedInDate", ro.ExpectedInDate?.ToString("O"), req.ExpectedInDate?.ToString("O"));
                ro.ExpectedInDate = req.ExpectedInDate;
            }
            if (req.RequiredDate != ro.RequiredDate && req.RequiredDate != default)
            {
                RoLifecycleEvents.EmitRoFieldChanged(db, id, userId, "requiredDate", ro.RequiredDate?.ToString("O"), req.RequiredDate?.ToString("O"));
                ro.RequiredDate = req.RequiredDate;
            }
            if (req.DeliveryDate.HasValue && req.DeliveryDate.Value != ro.DeliveryDate)
            {
                RoLifecycleEvents.EmitRoFieldChanged(db, id, userId, "deliveryDate", ro.DeliveryDate?.ToString("O"), req.DeliveryDate.Value.ToString("O"));
                ro.DeliveryDate = req.DeliveryDate.Value;
            }

            ro.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .RequireAuthorization(p => p.RequireRole("SALES", "SUPERVISOR", "ADMIN"))
        .WithName("UpdateRepairOrder");

        // POST /api/repair-orders/{id}/tasks — add task (E14-S2)
        grp.MapPost("/{id:guid}/tasks", async (
            Guid id,
            AddTaskRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var ro = await db.RepairOrders.FindAsync(new object[] { id }, ct);
            if (ro is null) return Results.NotFound();
            if (ro.Status is "COMPLETED" or "CANCELLED")
                return Results.Conflict(new { message = "Cannot add tasks to a completed or cancelled repair order." });

            var op = await db.OperationCatalog.FindAsync(new object[] { req.OperationId }, ct);
            if (op is null) return Results.UnprocessableEntity(new { message = "Operation not found." });

            var maxSeq = await db.JobTasks.Where(t => t.RoId == id).MaxAsync(t => (short?)t.Sequence, ct) ?? (short)0;
            var sequence = req.Sequence.HasValue ? req.Sequence.Value : (short)(maxSeq + 1);

            var stationId = req.StationId ?? op.DefaultStationId;

            var task = new JobTask
            {
                Id            = Guid.NewGuid(),
                RoId          = id,
                Sequence      = sequence,
                JobCodeLine   = $"{sequence:00}ADD-{op.Code}",
                OperationId   = req.OperationId,
                OperationName = op.CanonicalName,
                StationId     = stationId,
                EstimatedHours = req.EstimatedHours ?? op.TypicalHours ?? 1m,
                Status        = "PENDING",
                Notes         = req.Notes,
                CreatedAt     = DateTimeOffset.UtcNow,
                UpdatedAt     = DateTimeOffset.UtcNow,
            };
            db.JobTasks.Add(task);

            RoLifecycleEvents.EmitRoTaskAdded(db, id, GetCallerId(principal), task.Id, req.OperationId, stationId, sequence);

            ro.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.Created($"/api/repair-orders/{id}/tasks/{task.Id}", new { task.Id });
        })
        .RequireAuthorization(p => p.RequireRole("SALES", "SUPERVISOR", "ADMIN"))
        .WithName("AddRepairOrderTask");

        // DELETE /api/repair-orders/{id}/tasks/{taskId} — remove task (E14-S2)
        grp.MapDelete("/{id:guid}/tasks/{taskId:guid}", async (
            Guid id,
            Guid taskId,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var ro = await db.RepairOrders.FindAsync(new object[] { id }, ct);
            if (ro is null) return Results.NotFound();
            if (ro.Status is "COMPLETED" or "CANCELLED")
                return Results.Conflict(new { message = "Cannot remove tasks from a completed or cancelled repair order." });

            var task = await db.JobTasks.FirstOrDefaultAsync(t => t.Id == taskId && t.RoId == id, ct);
            if (task is null) return Results.NotFound();

            if (task.Status != "PENDING")
                return Results.UnprocessableEntity(new { message = "Task cannot be removed: work has already started." });

            var hasWork = await db.TimeEntries.AnyAsync(te => te.TaskId == taskId, ct);
            if (hasWork)
                return Results.UnprocessableEntity(new { message = "Task cannot be removed: work has already started." });

            RoLifecycleEvents.EmitRoTaskRemoved(db, id, GetCallerId(principal), task.Id, task.OperationId);
            db.JobTasks.Remove(task);

            ro.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .RequireAuthorization(p => p.RequireRole("SALES", "SUPERVISOR", "ADMIN"))
        .WithName("RemoveRepairOrderTask");

        // PUT /api/repair-orders/{id}/tasks/reorder — reorder tasks (E14-S2)
        grp.MapPut("/{id:guid}/tasks/reorder", async (
            Guid id,
            ReorderTasksRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var ro = await db.RepairOrders.FindAsync(new object[] { id }, ct);
            if (ro is null) return Results.NotFound();
            if (ro.Status is "COMPLETED" or "CANCELLED")
                return Results.Conflict(new { message = "Cannot reorder tasks on a completed or cancelled repair order." });

            if (req.TaskIds is null || req.TaskIds.Length == 0)
                return Results.BadRequest(new { message = "Task IDs are required." });

            var tasks = await db.JobTasks.Where(t => t.RoId == id).ToListAsync(ct);
            var taskIds = tasks.Select(t => t.Id).OrderBy(x => x).ToHashSet();
            var reqIds = req.TaskIds.OrderBy(x => x).ToHashSet();
            if (!taskIds.SetEquals(reqIds))
                return Results.BadRequest(new { message = "Task ID set does not match current tasks." });

            var beforeOrder = tasks.OrderBy(t => t.Sequence).Select(t => t.Id).ToArray();
            var taskLookup = tasks.ToDictionary(t => t.Id);

            // Two-phase update to avoid unique-constraint violations on (ro_id, sequence):
            // Phase 1 — shift all sequences out of range so no new value collides with an existing value.
            using var tx = await db.Database.BeginTransactionAsync(ct);
            const short offset = 1000;
            foreach (var t in tasks)
                t.Sequence = (short)(t.Sequence + offset);
            await db.SaveChangesAsync(ct);

            // Phase 2 — assign the desired final positions.
            for (var i = 0; i < req.TaskIds.Length; i++)
            {
                taskLookup[req.TaskIds[i]].Sequence  = (short)(i + 1);
                taskLookup[req.TaskIds[i]].UpdatedAt = DateTimeOffset.UtcNow;
            }

            RoLifecycleEvents.EmitRoTaskReordered(db, id, GetCallerId(principal), beforeOrder, req.TaskIds);

            ro.UpdatedAt = DateTimeOffset.UtcNow;
            await db.SaveChangesAsync(ct);
            await tx.CommitAsync(ct);
            return Results.NoContent();
        })
        .RequireAuthorization(p => p.RequireRole("SALES", "SUPERVISOR", "ADMIN"))
        .WithName("ReorderRepairOrderTasks");

        // POST /api/repair-orders/{id}/cancel (E14-S3)
        grp.MapPost("/{id:guid}/cancel", async (
            Guid id,
            CancelRoRequest req,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            if (string.IsNullOrWhiteSpace(req.Reason) || req.Reason.Trim().Length < 10)
                return Results.UnprocessableEntity(new { message = "Cancellation reason must be at least 10 characters." });

            var ro = await db.RepairOrders
                .Include(r => r.Tasks)
                .FirstOrDefaultAsync(r => r.Id == id, ct);
            if (ro is null) return Results.NotFound();
            if (ro.Status is "COMPLETED")
                return Results.Conflict(new { message = "Cannot cancel a completed repair order." });
            if (ro.Status is "CANCELLED")
                return Results.Conflict(new { message = "Repair order is already cancelled." });

            var userId = GetCallerId(principal);

            // Release chassis if allocated
            Guid? releasedChassisId = null;
            var releaseChassis = req.ReleaseChassis ?? true;
            if (releaseChassis)
            {
                var chassis = await db.ChassisInventory
                    .FirstOrDefaultAsync(c => c.AllocatedToRo == id && c.Status == "ALLOCATED", ct);
                if (chassis is not null)
                {
                    releasedChassisId = chassis.Id;
                    chassis.Status       = "AVAILABLE";
                    chassis.AllocatedToRo = null;
                    chassis.AllocatedAt  = null;
                    chassis.UpdatedAt    = DateTimeOffset.UtcNow;
                }
            }

            // Cancel all PENDING tasks
            foreach (var task in ro.Tasks.Where(t => t.Status == "PENDING"))
            {
                task.Status    = "CANCELLED";
                task.UpdatedAt = DateTimeOffset.UtcNow;
            }

            ro.Status              = "CANCELLED";
            ro.CancelledAt         = DateTimeOffset.UtcNow;
            ro.CancellationReason  = req.Reason.Trim();
            ro.CancelledBy         = userId;
            ro.UpdatedAt           = DateTimeOffset.UtcNow;

            RoLifecycleEvents.EmitRoCancelled(db, id, userId, req.Reason.Trim(), releasedChassisId);

            await db.SaveChangesAsync(ct);
            return Results.Ok(new { releasedChassisId });
        })
        .RequireAuthorization(p => p.RequireRole("SUPERVISOR", "ADMIN"))
        .WithName("CancelRepairOrder");

        // GET /api/repair-orders/{id}/flow  — E25-S1
        grp.MapGet("/{id:guid}/flow", async (Guid id, NeeDbContext db, CancellationToken ct) =>
        {
            var ro = await db.RepairOrders
                .Where(r => r.Id == id)
                .Select(r => new { r.BodyType })
                .FirstOrDefaultAsync(ct);

            if (ro is null) return Results.NotFound();

            if (ro.BodyType is null)
                return Results.Ok(new { RoId = id, BodyType = (string?)null, Tracks = Array.Empty<object>() });

            var flowSteps = await (
                from fd in db.FlowDefinitions
                where fd.BodyType == ro.BodyType
                join s  in db.Stations     on fd.StationId equals s.Id
                join ks in db.KanbanStages on fd.StationId equals ks.Id into ksJ
                from ks in ksJ.DefaultIfEmpty()
                select new
                {
                    fd.Track,
                    fd.SortOrder,
                    fd.StationId,
                    StationName  = s.Name,
                    IsMergePoint = ks != null ? ks.IsMergePoint : false,
                }
            ).ToListAsync(ct);

            var rawTasks = await db.JobTasks
                .Where(t => t.RoId == id)
                .Select(t => new { t.StationId, t.FlowTrack, t.Status })
                .ToListAsync(ct);

            var taskLookup = rawTasks
                .GroupBy(t => (t.StationId, t.FlowTrack))
                .ToDictionary(g => g.Key, g => g.ToList());

            var trackOrder = new[] { "BODY", "CHASSIS", "SUBFRAME", "ANY" };

            var tracks = flowSteps
                .GroupBy(s => s.Track)
                .OrderBy(g => { var i = Array.IndexOf(trackOrder, g.Key); return i < 0 ? 99 : i; })
                .Select(g => new
                {
                    Track = g.Key,
                    Steps = g.OrderBy(s => s.SortOrder).Select(s =>
                    {
                        var hasTasks = taskLookup.TryGetValue((s.StationId, s.Track), out var ts);
                        var tasks = hasTasks ? ts! : null;
                        string status = tasks is null || tasks.Count == 0          ? "PENDING"
                                      : tasks.Any(t => t.Status == "BLOCKED")      ? "BLOCKED"
                                      : tasks.Any(t => t.Status is "IN_PROGRESS" or "PAUSED") ? "ACTIVE"
                                      : tasks.All(t => t.Status == "COMPLETED")    ? "DONE"
                                      : "PENDING";
                        return new
                        {
                            StationId    = (int)s.StationId,
                            StationName  = s.StationName,
                            StepStatus   = status,
                            IsMergePoint = s.IsMergePoint,
                        };
                    }).ToList(),
                }).ToList();

            return Results.Ok(new { RoId = id, BodyType = ro.BodyType, Tracks = tracks });
        })
        .WithName("GetRepairOrderFlow");

        // POST /api/repair-orders/{id}/reopen (E14-S3)
        grp.MapPost("/{id:guid}/reopen", async (
            Guid id,
            ClaimsPrincipal principal,
            NeeDbContext db,
            CancellationToken ct) =>
        {
            var ro = await db.RepairOrders.FindAsync(new object[] { id }, ct);
            if (ro is null) return Results.NotFound();
            if (ro.Status != "CANCELLED")
                return Results.Conflict(new { message = "Only cancelled repair orders can be reopened." });

            var userId = GetCallerId(principal);

            // Read prior status from the last RoFieldChanged event for field='status', else default to APPROVED
            var priorStatus = await db.DomainEvents
                .Where(e => e.AggregateId == id && e.EventType == "RoFieldChanged")
                .OrderByDescending(e => e.OccurredAt)
                .Select(e => e.Payload)
                .ToListAsync(ct);

            var restoredStatus = "APPROVED";
            foreach (var payload in priorStatus)
            {
                var field = payload.RootElement.TryGetProperty("field", out var f) ? f.GetString() : null;
                if (field == "status")
                {
                    restoredStatus = payload.RootElement.TryGetProperty("before", out var b) ? b.GetString() ?? "APPROVED" : "APPROVED";
                    break;
                }
            }

            ro.Status             = restoredStatus;
            ro.CancelledAt        = null;
            ro.CancellationReason = null;
            ro.CancelledBy        = null;
            ro.ReopenedAt         = DateTimeOffset.UtcNow;
            ro.ReopenedBy         = userId;
            ro.UpdatedAt          = DateTimeOffset.UtcNow;

            RoLifecycleEvents.EmitRoReopened(db, id, userId);

            await db.SaveChangesAsync(ct);
            return Results.NoContent();
        })
        .RequireAuthorization(p => p.RequireRole("ADMIN"))
        .WithName("ReopenRepairOrder");
    }

    private static Guid? GetCallerId(ClaimsPrincipal p)
    {
        var sub = p.FindFirstValue(JwtRegisteredClaimNames.Sub);
        return Guid.TryParse(sub, out var g) ? g : null;
    }
}

// ── Request DTOs ──────────────────────────────────────────────────────────────

public record UpdateRoRequest(
    Guid? CustomerId,
    short? JobTypeId,
    string? Rego,
    string? Vin,
    string? Make,
    string? Model,
    string? PaintColour,
    string? ChassisNumber,
    string? EngineNumber,
    DateTimeOffset? ExpectedInDate,
    DateTimeOffset? RequiredDate,
    DateOnly? DeliveryDate,
    short? Priority,
    string? Notes);

public record AddTaskRequest(
    short OperationId,
    short? StationId,
    decimal? EstimatedHours,
    short? Sequence,
    string? Notes);

public class ReorderTasksRequest
{
    public Guid[]? TaskIds { get; set; }
}

public record CancelRoRequest(string Reason, bool? ReleaseChassis);

// Bring in JWT claim names without extra using
file static class JwtRegisteredClaimNames
{
    public const string Sub = "sub";
}
