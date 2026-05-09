using System.IdentityModel.Tokens.Jwt;
using System.Security.Claims;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.IdentityModel.Tokens;
using Nee.Api.Data;
using Testcontainers.PostgreSql;
using Xunit;

namespace Nee.Api.Tests;

public class ApiFixture : IAsyncLifetime
{
    private readonly PostgreSqlContainer _postgres = new PostgreSqlBuilder()
        .WithImage("postgres:16-alpine")
        .WithDatabase("nee_test")
        .WithUsername("nee")
        .WithPassword("nee_test")
        .Build();

    public const string JwtSecret = "nee-test-secret-that-is-long-enough-for-hs256";
    public const string JwtIssuer = "nee-platform";
    public const string JwtAudience = "nee-platform-web";

    public WebApplicationFactory<Program> Factory { get; private set; } = null!;

    // Single data source shared across all CreateDbContext() calls in the suite.
    // Each NpgsqlDataSource owns a connection pool; building a new one per call
    // (the previous behaviour) leaked pools and exhausted Postgres max_connections
    // around test ~190 with "53300: sorry, too many clients already".
    private Npgsql.NpgsqlDataSource _dataSource = null!;

    public async Task InitializeAsync()
    {
        await _postgres.StartAsync();

        await ApplyMigrationsAsync();

        _dataSource = new Npgsql.NpgsqlDataSourceBuilder(_postgres.GetConnectionString()).Build();

        Factory = new WebApplicationFactory<Program>().WithWebHostBuilder(builder =>
        {
            builder.UseSetting("ConnectionStrings:Postgres", _postgres.GetConnectionString());
            builder.UseSetting("Jwt:Secret", JwtSecret);
            builder.UseSetting("Jwt:Issuer", JwtIssuer);
            builder.UseSetting("Jwt:Audience", JwtAudience);
        });

        // Warm up (resolves DI and verifies DB connectivity)
        _ = Factory.CreateClient();
    }

    public async Task DisposeAsync()
    {
        await Factory.DisposeAsync();
        if (_dataSource is not null) await _dataSource.DisposeAsync();
        await _postgres.DisposeAsync();
    }

    public HttpClient CreateClient() => Factory.CreateClient();

    public string GenerateToken(Guid userId, params string[] roles)
    {
        var claims = new List<Claim>
        {
            new(JwtRegisteredClaimNames.Sub, userId.ToString()),
            new(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString()),
        };
        foreach (var role in roles)
            claims.Add(new(ClaimTypes.Role, role));

        var key = new SymmetricSecurityKey(Encoding.UTF8.GetBytes(JwtSecret));
        var token = new JwtSecurityToken(
            issuer: JwtIssuer,
            audience: JwtAudience,
            claims: claims,
            expires: DateTime.UtcNow.AddHours(1),
            signingCredentials: new SigningCredentials(key, SecurityAlgorithms.HmacSha256));

        return new JwtSecurityTokenHandler().WriteToken(token);
    }

    public NeeDbContext CreateDbContext()
    {
        var opts = new DbContextOptionsBuilder<NeeDbContext>()
            .UseNpgsql(_dataSource)
            .UseSnakeCaseNamingConvention()
            .Options;
        return new NeeDbContext(opts);
    }

    private async Task ApplyMigrationsAsync()
    {
        var migrationsDir = Path.Combine(
            Directory.GetCurrentDirectory(),
            "..", "..", "..", "..", "db", "migrations");

        using var conn = new Npgsql.NpgsqlConnection(_postgres.GetConnectionString());
        await conn.OpenAsync();

        foreach (var file in Directory.GetFiles(migrationsDir, "*.sql").OrderBy(f => f))
        {
            var sql = await File.ReadAllTextAsync(file);
            using var cmd = conn.CreateCommand();
            cmd.CommandText = sql;
            await cmd.ExecuteNonQueryAsync();
        }
    }
}
