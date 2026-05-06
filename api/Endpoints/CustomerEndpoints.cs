using System.Security.Claims;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using Nee.Api.Data;
using Nee.Api.Domain;

namespace Nee.Api.Endpoints;

// ── DTOs ──────────────────────────────────────────────────────────────────────

public record CustomerSummary(
    Guid Id,
    string? Code,
    string Name,
    string? CustomerNo,
    string? Abn,
    string? ContactEmail,
    string? ContactPhone,
    bool IsActive,
    int ActiveRoCount,
    DateOnly? LastRoDate);

public record CustomerListResponse(
    CustomerSummary[] Items,
    int TotalCount,
    int Page,
    int PageSize);

public record CustomerDetail(
    Guid Id,
    string? Code,
    string Name,
    string? CustomerNo,
    string? Abn,
    string? BillToName,
    string? BillToAddress,
    string? ContactEmail,
    string? ContactPhone,
    string? EmailDl,
    bool IsActive,
    DateTimeOffset CreatedAt,
    DateTimeOffset UpdatedAt,
    int ActiveRoCount,
    int CompletedRoCount,
    int CancelledRoCount);

public record CustomerRoSummary(
    Guid Id,
    string RoNumber,
    string TemplateCode,
    string? Rego,
    string? ChassisNumber,
    string Status,
    string? KanbanStage,
    DateTimeOffset? RequiredDate,
    DateOnly RoDate);

public record CustomerRoListResponse(
    CustomerRoSummary[] Items,
    int TotalCount,
    int Page,
    int PageSize);

public record VehicleEntry(
    string? Rego,
    string? Vin,
    string? ChassisNumber,
    string? Make,
    string? Model,
    string? PaintColour,
    DateOnly? FirstSeenAt,
    DateOnly? LastSeenAt,
    int RoCount);

public record CreateCustomerRequest(
    string? Code,
    string Name,
    string? CustomerNo,
    string? Abn,
    string? BillToName,
    string? BillToAddress,
    string? ContactEmail,
    string? ContactPhone,
    string? EmailDl);

public record UpdateCustomerRequest(
    string? Code,
    string? Name,
    string? CustomerNo,
    string? Abn,
    string? BillToName,
    string? BillToAddress,
    string? ContactEmail,
    string? ContactPhone,
    string? EmailDl);

// ──────────────────────────────────────────────────────────────────────────────

public static class CustomerEndpoints
{
    public static void MapCustomerEndpoints(this WebApplication app)
    {
        // ── Existing endpoints (used by sales / RO-creation dropdown) ──────────

        var grp = app.MapGroup("/api/customers").RequireAuthorization().WithTags("Customers");

        grp.MapGet("/", async (NeeDbContext db, CancellationToken ct) =>
        {
            var customers = await db.Customers
                .Where(c => c.IsActive)
                .OrderBy(c => c.Name)
                .Select(c => new { c.Id, c.Code, c.Name })
                .ToListAsync(ct);

            return Results.Ok(customers);
        }).WithName("GetCustomers");

        app.MapGet("/api/job-types", async (NeeDbContext db, CancellationToken ct) =>
        {
            var types = await db.JobTypes
                .OrderBy(j => j.Id)
                .Select(j => new { j.Id, j.Code, j.Name })
                .ToListAsync(ct);

            return Results.Ok(types);
        }).RequireAuthorization().WithTags("Customers").WithName("GetJobTypes");

        // ── E13 admin endpoints ────────────────────────────────────────────────

        var adminGrp = app.MapGroup("/api/admin/customers")
            .RequireAuthorization(pb => pb.RequireRole("ADMIN", "SALES"))
            .WithTags("Admin");

        // E13-S1: List customers with filters
        adminGrp.MapGet("/", async (
                string? q,
                bool? active,
                string? sortBy,
                int page,
                int pageSize,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                page     = Math.Max(1, page);
                pageSize = Math.Clamp(pageSize, 1, 100);

                var query = db.Customers.AsQueryable();

                if (!string.IsNullOrWhiteSpace(q))
                {
                    var lower = q.ToLower();
                    query = query.Where(c =>
                        c.Name.ToLower().Contains(lower) ||
                        (c.Code != null && c.Code.ToLower().Contains(lower)) ||
                        (c.CustomerNo != null && c.CustomerNo.ToLower().Contains(lower)) ||
                        (c.ContactEmail != null && c.ContactEmail.ToLower().Contains(lower)));
                }

                if (active.HasValue)
                    query = query.Where(c => c.IsActive == active.Value);

                var total = await query.CountAsync(ct);

                // sortBy=lastrodate isn't easily composable from the aggregated subquery,
                // so we sort by name and let the client sort on lastRoDate if desired.
                var ordered = query.OrderBy(c => c.Name);

                var customers = await ordered
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .Select(c => new { c.Id, c.Code, c.Name, c.CustomerNo, c.Abn, c.ContactEmail, c.ContactPhone, c.IsActive })
                    .ToListAsync(ct);

                var customerIds = customers.Select(c => c.Id).ToList();

                // Batch aggregate RO counts and last RO date
                var roAggs = await db.RepairOrders
                    .Where(r => customerIds.Contains(r.CustomerId))
                    .GroupBy(r => r.CustomerId)
                    .Select(g => new
                    {
                        CustomerId   = g.Key,
                        ActiveCount  = g.Count(r => r.Status != "COMPLETED" && r.Status != "CANCELLED"),
                        LastRoDate   = g.Max(r => (DateOnly?)r.RoDate),
                    })
                    .ToListAsync(ct);

                var aggByCustomer = roAggs.ToDictionary(x => x.CustomerId);

                var items = customers.Select(c =>
                {
                    var agg = aggByCustomer.TryGetValue(c.Id, out var a) ? a : null;
                    return new CustomerSummary(
                        c.Id, c.Code, c.Name, c.CustomerNo, c.Abn,
                        c.ContactEmail, c.ContactPhone, c.IsActive,
                        agg?.ActiveCount ?? 0,
                        agg?.LastRoDate);
                }).ToArray();

                return Results.Ok(new CustomerListResponse(items, total, page, pageSize));
            })
            .WithName("AdminListCustomers");

        // E13-S3: Get single customer with RO counts
        adminGrp.MapGet("/{id:guid}", async (Guid id, NeeDbContext db, CancellationToken ct) =>
            {
                var c = await db.Customers.FindAsync(new object[] { id }, ct);
                if (c is null) return Results.NotFound();

                var activeCnt    = await db.RepairOrders.CountAsync(r => r.CustomerId == id && r.Status != "COMPLETED" && r.Status != "CANCELLED", ct);
                var completedCnt = await db.RepairOrders.CountAsync(r => r.CustomerId == id && r.Status == "COMPLETED", ct);
                var cancelledCnt = await db.RepairOrders.CountAsync(r => r.CustomerId == id && r.Status == "CANCELLED", ct);

                return Results.Ok(new CustomerDetail(
                    c.Id, c.Code, c.Name, c.CustomerNo, c.Abn,
                    c.BillToName, c.BillToAddress,
                    c.ContactEmail, c.ContactPhone, c.EmailDl,
                    c.IsActive, c.CreatedAt, c.UpdatedAt,
                    activeCnt, completedCnt, cancelledCnt));
            })
            .WithName("AdminGetCustomer");

        // E13-S3: Get customer's repair orders by status group
        adminGrp.MapGet("/{id:guid}/repair-orders", async (
                Guid id,
                string? status,
                int page,
                int pageSize,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                if (!await db.Customers.AnyAsync(c => c.Id == id, ct))
                    return Results.NotFound();

                page     = Math.Max(1, page);
                pageSize = Math.Clamp(pageSize, 1, 100);

                var activeStatuses = new[] { "DRAFT", "QUOTED", "APPROVED", "IN_PROGRESS", "ON_HOLD" };

                var query = db.RepairOrders.Where(r => r.CustomerId == id);
                query = status switch
                {
                    "completed" => query.Where(r => r.Status == "COMPLETED"),
                    "cancelled" => query.Where(r => r.Status == "CANCELLED"),
                    _           => query.Where(r => activeStatuses.Contains(r.Status)),
                };

                var total = await query.CountAsync(ct);
                var roIds = await query
                    .OrderByDescending(r => r.RequiredDate)
                    .Skip((page - 1) * pageSize)
                    .Take(pageSize)
                    .Select(r => new
                    {
                        r.Id, r.RoNumber, r.TemplateCode, r.Rego,
                        r.ChassisNumber, r.Status, r.RequiredDate, r.RoDate
                    })
                    .ToListAsync(ct);

                var roIdList = roIds.Select(r => r.Id).ToList();

                var stages = await db.RoKanbanStates
                    .Where(ks => roIdList.Contains(ks.RoId))
                    .Join(db.KanbanStages, ks => ks.CurrentStageId, k => k.Id, (ks, k) => new { ks.RoId, k.Name })
                    .ToDictionaryAsync(x => x.RoId, x => x.Name, ct);

                var items = roIds.Select(r => new CustomerRoSummary(
                    r.Id, r.RoNumber, r.TemplateCode, r.Rego,
                    r.ChassisNumber, r.Status,
                    stages.TryGetValue(r.Id, out var stage) ? stage : null,
                    r.RequiredDate, r.RoDate))
                    .ToArray();

                return Results.Ok(new CustomerRoListResponse(items, total, page, pageSize));
            })
            .WithName("AdminGetCustomerRepairOrders");

        // E13-S4: Get customer's vehicle catalogue
        adminGrp.MapGet("/{id:guid}/vehicles", async (Guid id, NeeDbContext db, CancellationToken ct) =>
            {
                if (!await db.Customers.AnyAsync(c => c.Id == id, ct))
                    return Results.NotFound();

                var raw = await db.RepairOrders
                    .Where(r => r.CustomerId == id
                        && (r.Rego != null || r.Vin != null || r.ChassisNumber != null))
                    .GroupBy(r => new { r.Rego, r.Vin, r.ChassisNumber, r.Make, r.Model, r.PaintColour })
                    .Select(g => new
                    {
                        g.Key.Rego,
                        g.Key.Vin,
                        g.Key.ChassisNumber,
                        g.Key.Make,
                        g.Key.Model,
                        g.Key.PaintColour,
                        FirstSeenAt = g.Min(r => r.RoDate),
                        LastSeenAt  = g.Max(r => r.RoDate),
                        RoCount     = g.Count(),
                    })
                    .ToListAsync(ct);

                var vehicles = raw
                    .OrderByDescending(v => v.LastSeenAt)
                    .Select(v => new VehicleEntry(
                        v.Rego, v.Vin, v.ChassisNumber, v.Make, v.Model, v.PaintColour,
                        v.FirstSeenAt, v.LastSeenAt, v.RoCount))
                    .ToList();

                return Results.Ok(vehicles);
            })
            .WithName("AdminGetCustomerVehicles");

        // E13-S2: Create customer
        adminGrp.MapPost("/", async (
                CreateCustomerRequest req,
                ClaimsPrincipal principal,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                if (string.IsNullOrWhiteSpace(req.Name))
                    return Results.UnprocessableEntity(new { message = "Customer name is required." });

                if (!string.IsNullOrWhiteSpace(req.Code))
                {
                    var code = req.Code.Trim().ToUpperInvariant();
                    if (code.Length < 2 || !System.Text.RegularExpressions.Regex.IsMatch(code, @"^[A-Z0-9]+$"))
                        return Results.UnprocessableEntity(new { message = "Code must be 2–20 uppercase letters or digits." });
                    if (await db.Customers.AnyAsync(c => c.Code == code, ct))
                        return Results.UnprocessableEntity(new { message = "Code already in use." });
                }

                if (!string.IsNullOrWhiteSpace(req.CustomerNo))
                {
                    var no = req.CustomerNo.Trim();
                    if (!System.Text.RegularExpressions.Regex.IsMatch(no, @"^\d+$"))
                        return Results.UnprocessableEntity(new { message = "Customer number must contain digits only." });
                    if (await db.Customers.AnyAsync(c => c.CustomerNo == no, ct))
                        return Results.UnprocessableEntity(new { message = "Customer number already in use." });
                }

                var dlError = ValidateEmailDl(req.EmailDl);
                if (dlError is not null) return Results.UnprocessableEntity(new { message = dlError });

                var customer = new Customer
                {
                    Id             = Guid.NewGuid(),
                    Code           = string.IsNullOrWhiteSpace(req.Code) ? null : req.Code.Trim().ToUpperInvariant(),
                    Name           = req.Name.Trim(),
                    CustomerNo     = string.IsNullOrWhiteSpace(req.CustomerNo) ? null : req.CustomerNo.Trim(),
                    Abn            = string.IsNullOrWhiteSpace(req.Abn) ? null : req.Abn.Trim(),
                    BillToName     = string.IsNullOrWhiteSpace(req.BillToName) ? null : req.BillToName.Trim(),
                    BillToAddress  = string.IsNullOrWhiteSpace(req.BillToAddress) ? null : req.BillToAddress.Trim(),
                    ContactEmail   = string.IsNullOrWhiteSpace(req.ContactEmail) ? null : req.ContactEmail.Trim(),
                    ContactPhone   = string.IsNullOrWhiteSpace(req.ContactPhone) ? null : req.ContactPhone.Trim(),
                    EmailDl        = NormalizeEmailDl(req.EmailDl),
                    IsActive       = true,
                    CreatedAt      = DateTimeOffset.UtcNow,
                    UpdatedAt      = DateTimeOffset.UtcNow,
                };
                db.Customers.Add(customer);

                await db.DomainEvents.AddAsync(new DomainEvent
                {
                    EventType     = "CustomerCreated",
                    AggregateType = "Customer",
                    AggregateId   = customer.Id,
                    Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new { customer.Code, customer.Name })),
                    UserId        = GetCallerId(principal),
                    OccurredAt    = DateTimeOffset.UtcNow,
                }, ct);

                await db.SaveChangesAsync(ct);
                return Results.Created($"/api/admin/customers/{customer.Id}", new { id = customer.Id });
            })
            .WithName("AdminCreateCustomer");

        // E13-S2: Update customer
        adminGrp.MapPut("/{id:guid}", async (
                Guid id,
                UpdateCustomerRequest req,
                ClaimsPrincipal principal,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                var customer = await db.Customers.FindAsync(new object[] { id }, ct);
                if (customer is null) return Results.NotFound();

                if (req.Code is not null)
                {
                    var code = req.Code.Trim().ToUpperInvariant();
                    if (!string.IsNullOrWhiteSpace(req.Code))
                    {
                        if (code.Length < 2 || !System.Text.RegularExpressions.Regex.IsMatch(code, @"^[A-Z0-9]+$"))
                            return Results.UnprocessableEntity(new { message = "Code must be 2–20 uppercase letters or digits." });
                    }
                    if (await db.Customers.AnyAsync(c => c.Code == code && c.Id != id, ct))
                        return Results.UnprocessableEntity(new { message = "Code already in use." });
                    customer.Code = string.IsNullOrWhiteSpace(req.Code) ? null : code;
                }
                if (req.Name is not null && !string.IsNullOrWhiteSpace(req.Name))
                    customer.Name = req.Name.Trim();
                if (req.CustomerNo is not null)
                {
                    if (!string.IsNullOrWhiteSpace(req.CustomerNo))
                    {
                        if (!System.Text.RegularExpressions.Regex.IsMatch(req.CustomerNo.Trim(), @"^\d+$"))
                            return Results.UnprocessableEntity(new { message = "Customer number must contain digits only." });
                        if (await db.Customers.AnyAsync(c => c.CustomerNo == req.CustomerNo.Trim() && c.Id != id, ct))
                            return Results.UnprocessableEntity(new { message = "Customer number already in use." });
                    }
                    customer.CustomerNo = string.IsNullOrWhiteSpace(req.CustomerNo) ? null : req.CustomerNo.Trim();
                }
                if (req.Abn is not null)
                    customer.Abn = string.IsNullOrWhiteSpace(req.Abn) ? null : req.Abn.Trim();
                if (req.BillToName is not null)
                    customer.BillToName = string.IsNullOrWhiteSpace(req.BillToName) ? null : req.BillToName.Trim();
                if (req.BillToAddress is not null)
                    customer.BillToAddress = string.IsNullOrWhiteSpace(req.BillToAddress) ? null : req.BillToAddress.Trim();
                if (req.ContactEmail is not null)
                    customer.ContactEmail = string.IsNullOrWhiteSpace(req.ContactEmail) ? null : req.ContactEmail.Trim();
                if (req.ContactPhone is not null)
                    customer.ContactPhone = string.IsNullOrWhiteSpace(req.ContactPhone) ? null : req.ContactPhone.Trim();

                var oldEmailDl = customer.EmailDl;
                if (req.EmailDl is not null)
                {
                    var dlError = ValidateEmailDl(req.EmailDl);
                    if (dlError is not null) return Results.UnprocessableEntity(new { message = dlError });
                    customer.EmailDl = NormalizeEmailDl(req.EmailDl);
                }

                customer.UpdatedAt = DateTimeOffset.UtcNow;

                await db.DomainEvents.AddAsync(new DomainEvent
                {
                    EventType     = "CustomerUpdated",
                    AggregateType = "Customer",
                    AggregateId   = id,
                    Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new { customer.Name })),
                    UserId        = GetCallerId(principal),
                    OccurredAt    = DateTimeOffset.UtcNow,
                }, ct);

                if (req.EmailDl is not null && customer.EmailDl != oldEmailDl)
                {
                    await db.DomainEvents.AddAsync(new DomainEvent
                    {
                        EventType     = "CustomerEmailDlChanged",
                        AggregateType = "Customer",
                        AggregateId   = id,
                        Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new { before = oldEmailDl, after = customer.EmailDl })),
                        UserId        = GetCallerId(principal),
                        OccurredAt    = DateTimeOffset.UtcNow,
                    }, ct);
                }

                await db.SaveChangesAsync(ct);
                return Results.NoContent();
            })
            .WithName("AdminUpdateCustomer");

        // E13-S2: Deactivate customer
        adminGrp.MapPost("/{id:guid}/deactivate", async (
                Guid id,
                ClaimsPrincipal principal,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                var customer = await db.Customers.FindAsync(new object[] { id }, ct);
                if (customer is null) return Results.NotFound();

                var activeRoCount = await db.RepairOrders
                    .CountAsync(r => r.CustomerId == id && r.Status != "COMPLETED" && r.Status != "CANCELLED", ct);

                customer.IsActive  = false;
                customer.UpdatedAt = DateTimeOffset.UtcNow;

                await db.DomainEvents.AddAsync(new DomainEvent
                {
                    EventType     = "CustomerDeactivated",
                    AggregateType = "Customer",
                    AggregateId   = id,
                    Payload       = JsonDocument.Parse(JsonSerializer.Serialize(new { activeRoCount })),
                    UserId        = GetCallerId(principal),
                    OccurredAt    = DateTimeOffset.UtcNow,
                }, ct);

                await db.SaveChangesAsync(ct);
                return Results.Ok(new { activeRoCount });
            })
            .WithName("AdminDeactivateCustomer");

        // E13-S2: Activate customer
        adminGrp.MapPost("/{id:guid}/activate", async (
                Guid id,
                ClaimsPrincipal principal,
                NeeDbContext db,
                CancellationToken ct) =>
            {
                var customer = await db.Customers.FindAsync(new object[] { id }, ct);
                if (customer is null) return Results.NotFound();

                customer.IsActive  = true;
                customer.UpdatedAt = DateTimeOffset.UtcNow;

                await db.DomainEvents.AddAsync(new DomainEvent
                {
                    EventType     = "CustomerActivated",
                    AggregateType = "Customer",
                    AggregateId   = id,
                    Payload       = JsonDocument.Parse("{}"),
                    UserId        = GetCallerId(principal),
                    OccurredAt    = DateTimeOffset.UtcNow,
                }, ct);

                await db.SaveChangesAsync(ct);
                return Results.NoContent();
            })
            .WithName("AdminActivateCustomer");
    }

    private static string? ValidateEmailDl(string? emailDl)
    {
        if (string.IsNullOrWhiteSpace(emailDl)) return null;
        var entries = emailDl
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(e => !string.IsNullOrWhiteSpace(e))
            .ToList();
        var invalid = entries.Where(e => !IsValidEmail(e)).ToList();
        return invalid.Count > 0
            ? $"Invalid email addresses: {string.Join(", ", invalid)}"
            : null;
    }

    private static string? NormalizeEmailDl(string? emailDl)
    {
        if (string.IsNullOrWhiteSpace(emailDl)) return null;
        var entries = emailDl
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Where(e => !string.IsNullOrWhiteSpace(e))
            .ToList();
        return entries.Count == 0 ? null : string.Join(", ", entries);
    }

    private static bool IsValidEmail(string email)
    {
        try { _ = new System.Net.Mail.MailAddress(email.Trim()); return true; }
        catch { return false; }
    }

    private static Guid? GetCallerId(ClaimsPrincipal p)
    {
        var sub = p.FindFirstValue(System.IdentityModel.Tokens.Jwt.JwtRegisteredClaimNames.Sub);
        return Guid.TryParse(sub, out var g) ? g : null;
    }
}
