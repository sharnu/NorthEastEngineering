using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using FluentValidation;
using Microsoft.AspNetCore.Authentication.JwtBearer;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.RateLimiting;
using Scalar.AspNetCore;
using Microsoft.EntityFrameworkCore;
using Microsoft.IdentityModel.Tokens;
using Nee.Api.Data;
using Nee.Api.Domain;
using Nee.Api.Domain.Sales;
using Nee.Api.Endpoints;
using Nee.Api.Services;
using Npgsql;
using Serilog;

var builder = WebApplication.CreateBuilder(args);

// Kestrel: allow up to 20 MB request bodies (PDF uploads)
builder.WebHost.ConfigureKestrel(o => o.Limits.MaxRequestBodySize = 20_971_520);

// ---- Logging (Serilog) ----
builder.Host.UseSerilog((ctx, lc) => lc
    .ReadFrom.Configuration(ctx.Configuration)
    .Enrich.FromLogContext()
    .WriteTo.Console());

// ---- Configuration ----
var connectionString = builder.Configuration.GetConnectionString("Postgres")
    ?? throw new InvalidOperationException("Missing connection string 'Postgres' in configuration.");

var jwtSecret = builder.Configuration["Jwt:Secret"]
    ?? throw new InvalidOperationException("Missing Jwt:Secret in configuration.");

var jwtIssuer = builder.Configuration["Jwt:Issuer"] ?? "nee-platform";
var jwtAudience = builder.Configuration["Jwt:Audience"] ?? "nee-platform-web";

// ---- Services ----
// Use NpgsqlDataSource so Npgsql 8.x can discover extension types (e.g. citext) from pg_type on startup.
var dataSource = new NpgsqlDataSourceBuilder(connectionString).Build();
builder.Services.AddSingleton(dataSource);

builder.Services.AddDbContext<NeeDbContext>(opt =>
    opt.UseNpgsql(dataSource)
       .UseSnakeCaseNamingConvention());

builder.Services.AddScoped<IPasswordHasher<User>, PasswordHasher<User>>();
builder.Services.AddScoped<RoMaterialisationService>();
builder.Services.AddScoped<EmailService>();
builder.Services.AddSingleton<PdfParserService>();
builder.Services.AddScoped<PdfScoringService>();
builder.Services.AddScoped<INotificationService, NotificationService>();
builder.Services.AddScoped<IGateEvaluator, StubGateEvaluator>();
builder.Services.AddValidatorsFromAssemblyContaining<Program>();

builder.Services.AddAuthentication(JwtBearerDefaults.AuthenticationScheme)
    .AddJwtBearer(opt =>
    {
        opt.MapInboundClaims = false;
        opt.TokenValidationParameters = new TokenValidationParameters
        {
            ValidateIssuerSigningKey = true,
            IssuerSigningKey = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(jwtSecret)),
            ValidateIssuer = true,
            ValidIssuer = jwtIssuer,
            ValidateAudience = true,
            ValidAudience = jwtAudience,
            ValidateLifetime = true,
            ClockSkew = TimeSpan.FromSeconds(30),
        };
    });

builder.Services.AddAuthorization();

// CORS for local dev (Angular on :4200 calling API on :5000)
builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(policy => policy
        .WithOrigins("http://localhost:4200")
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});

// Health checks (tagged so we can expose live and ready separately later)
builder.Services.AddHealthChecks()
    .AddNpgSql(connectionString, name: "postgres", tags: new[] { "ready" });

// OpenAPI
builder.Services.AddOpenApi();

// Rate limiting (basic, applied to login endpoint via attribute below)
builder.Services.AddRateLimiter(options =>
{
    options.AddFixedWindowLimiter("login", o =>
    {
        o.Window = TimeSpan.FromMinutes(1);
        o.PermitLimit = 5;
        o.QueueLimit = 0;
    });
});

var app = builder.Build();

// ---- Middleware ----
app.UseSerilogRequestLogging();
app.UseCors();

// Serve uploaded files from the configured uploads path
var uploadsBasePathRaw = app.Configuration["Storage:UploadsBasePath"]
    ?? Path.Combine(AppContext.BaseDirectory, "uploads");
// PhysicalFileProvider requires an absolute path
var uploadsBasePath = Path.IsPathRooted(uploadsBasePathRaw)
    ? uploadsBasePathRaw
    : Path.GetFullPath(uploadsBasePathRaw);
Directory.CreateDirectory(uploadsBasePath);
app.UseStaticFiles(new StaticFileOptions
{
    FileProvider = new Microsoft.Extensions.FileProviders.PhysicalFileProvider(uploadsBasePath),
    RequestPath = "/uploads"
});

if (app.Environment.IsDevelopment())
{
    app.MapOpenApi();
    app.MapScalarApiReference();
}

app.UseAuthentication();
app.UseAuthorization();
app.UseRateLimiter();

app.Use(async (ctx, next) =>
{
    try
    {
        await next(ctx);
    }
    catch (TemplateNotFoundException ex)
    {
        ctx.Response.StatusCode = 404;
        await ctx.Response.WriteAsJsonAsync(new { message = ex.Message });
    }
    catch (RoValidationException ex)
    {
        ctx.Response.StatusCode = 422;
        await ctx.Response.WriteAsJsonAsync(new
        {
            message = "Validation failed.",
            errors = ex.FieldErrors.Select(e => new { e.Field, e.Message }),
        });
    }
});

// ---- Endpoints ----
app.MapHealthEndpoints();
app.MapAuthEndpoints(jwtSecret, jwtIssuer, jwtAudience);
app.MapDevEndpoints();
app.MapCustomerEndpoints();
app.MapTemplateEndpoints();
app.MapRepairOrderEndpoints();
app.MapDashboardEndpoints();
app.MapReportsEndpoints();
app.MapKanbanEndpoints();
app.MapStationEndpoints();
app.MapJobTaskEndpoints();
app.MapTechEndpoints();
app.MapQcEndpoints();
app.MapNotificationEndpoints();
app.MapSalesPdfEndpoints();
app.MapSchedulingEndpoints();
app.MapAdminEndpoints();
app.MapDrafterEndpoints();

app.Run();

// Required for WebApplicationFactory<Program> in tests
public partial class Program { }
