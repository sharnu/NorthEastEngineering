# Azure Deployment Plan

> Phase 3 successor to `docs/phase2-backlog.md`. Takes the local-only MVP
> (Docker Compose · Postgres · disk-resident uploads · Mailpit) and lifts
> it to a hosted Azure environment. Two-environment target:
> **`staging`** (always-on, latest `main`) and **`prod`** (manual promotion).
>
> Estimated effort: 5–8 working days for two devs, depending on whether
> you keep a single-instance App Service (cheaper, simpler) or go multi-instance
> (cleaner, requires Redis + Azure SignalR).

---

## Why this isn't trivial

The current code is mostly cloud-portable, but four areas hard-code
local-only assumptions:

| Concern | Local today | Cloud-ready needs |
|---|---|---|
| File uploads | Saved to `api/uploads/` and served by `UseStaticFiles` from `/uploads/{blobPath}` | Azure Blob Storage; `UseStaticFiles` removed; URLs become SAS-signed blob URLs |
| Secrets | `Jwt:Secret` and seed-account passwords sit in `appsettings.Development.json` | Azure Key Vault, referenced from App Service config |
| In-process state | `IMemoryCache` for forecast; `KanbanHub` runs in-proc | Single-instance OK at MVP scale; multi-instance needs Azure Cache for Redis + Azure SignalR Service |
| Mail | Mailpit on port 1025 | Azure Communication Services (or SendGrid via Azure marketplace) |

Plus the usual deploy-pipeline gaps: no IaC, no migration runner,
no environment-specific config, no health check, no observability hookup.

---

# Phase 0 — Decisions to make on day 0

These pin the architecture; later phases assume the answers.

| Decision | Default for this plan | Why |
|---|---|---|
| Single-instance vs multi-instance API | **Single-instance** (`P1v3`, scale-out disabled at first) | Keeps `IMemoryCache` and in-proc SignalR working without Redis or Azure SignalR Service. Defer scale-out to Phase 4. |
| Hosting model | **App Service Linux** + system-assigned managed identity | Avoids managing container images for now; framework-deployed Linux is the cheapest production-ready option. Containerise later if we adopt agents/sidecars. |
| Static frontend hosting | **Azure Static Web Apps** (Standard tier) | Built-in HTTPS, GitHub Actions integration, custom domain on first-class plan. API stays on App Service; SWA proxies `/api/*` to it. |
| Database | **Azure Database for PostgreSQL Flexible Server**, Burstable B2s in non-prod, GP D2s_v5 in prod | Native PG16, pgAdmin-friendly, supports Microsoft Entra auth, point-in-time restore. |
| Secret store | **Key Vault** with App Service Key Vault references | Standard pattern; managed identity grants access |
| Email | **Azure Communication Services Email** | Same provider for monitoring; SendGrid fine if pre-existing contract |
| Region | **Australia East** primary, AU Southeast for backup | Australian customers, latency, data residency |
| Domains | `app.nee-platform.au` (web) → `api.nee-platform.au` (API) | Tighten CORS to web origin only |
| Auth | Continue JWT HS256 for now | Enough for two roles in one tenant; revisit Entra B2C in Phase 5 |

---

# Phase 1 — Code changes for cloud portability

Estimated 2–3 days; sequential because each step changes a piece of `Program.cs`.

## 1.1 Replace local uploads with Blob Storage (must-fix)

The two largest files touching disk are `ChassisStockEndpoints.cs`
(weekly XLSX), `SalesPdfEndpoints.cs` (RO PDFs), `DrafterEndpoints.cs`
(layouts/BOMs/drawings), and `TechEndpoints.cs` (photos). All use the
helper pattern `ResolveUploadsBase(config)` then `Path.Combine(...)`.
Plus `Program.cs:122` mounts `/uploads/{...}` via `UseStaticFiles`.

**New abstraction**: `Nee.Api.Services.IFileStorage` with two
implementations:

```csharp
public interface IFileStorage
{
    Task<string> SaveAsync(string folder, string fileName, Stream content, CancellationToken ct);
    Task<Stream> OpenAsync(string blobPath, CancellationToken ct);
    Task        DeleteAsync(string blobPath, CancellationToken ct);
    /// Returns either a /uploads/{blobPath} URL (local) or a SAS-signed
    /// blob URL with 30-min TTL (Azure). Callers should not assume.
    string      GetReadUrl(string blobPath);
}
```

- `LocalFileStorage` — wraps the existing disk write path so dev still
  works unchanged. Keeps `UseStaticFiles` for `/uploads/`.
- `BlobFileStorage` — uses `Azure.Storage.Blobs` (`BlobContainerClient`)
  via managed identity. `GetReadUrl` issues a user-delegation SAS with
  read-only TTL.

Wire the implementation via `IConfiguration["Storage:Provider"]`
(`local` | `blob`). Default `local` for dev; App Service config sets
`blob` in cloud.

**Touch list**:
- New file: `api/Services/IFileStorage.cs` + two implementations
- New file: `api/Services/BlobFileStorage.cs` (NuGet `Azure.Storage.Blobs`, `Azure.Identity`)
- Replace `File.WriteAllBytesAsync(diskPath, …)` calls in 4 endpoints with `storage.SaveAsync(…)`
- Replace `$"/uploads/{a.BlobPath}"` URL building with `storage.GetReadUrl(a.BlobPath)`
- Conditional `app.UseStaticFiles(...)` only when `Storage:Provider == "local"`
- New tests: `BlobFileStorageTests` against an Azurite-backed container

**Migration**: existing dev uploads in `api/uploads/` stay on disk —
they're test fixtures. The cloud env starts with an empty container.

## 1.2 Move secrets to Key Vault

Today: `Jwt:Secret` is a plain string in `appsettings.Development.json`.
The connection string is supplied by `make dev` env var.

App Service references look like
`@Microsoft.KeyVault(VaultName=nee-stg-kv;SecretName=Jwt-Secret)`. No
code change to `Program.cs:35` — `IConfiguration` resolves it transparently.

**Touch list**:
- Add `appsettings.json` (production-safe defaults — no secrets)
- Move dev defaults out of `appsettings.Development.json` and into a
  `.env.dev` template (gitignored) or keep them as-is for local dev
- Document required env vars in `docs/runbook.md` (new): `Jwt__Secret`,
  `ConnectionStrings__Postgres`, `Storage__BlobConnection`, etc.

## 1.3 Production CORS + HTTPS hardening

`Program.cs:81` calls `AddCors(options => …)`; verify it doesn't
default to `AllowAnyOrigin()` in production. Use a config-driven
allow-list:

```csharp
var allowedOrigins = builder.Configuration
    .GetSection("Cors:AllowedOrigins").Get<string[]>() ?? [];

builder.Services.AddCors(options =>
{
    options.AddDefaultPolicy(p => p
        .WithOrigins(allowedOrigins)
        .AllowAnyHeader()
        .AllowAnyMethod()
        .AllowCredentials());
});
```

In App Service config: `Cors__AllowedOrigins__0=https://app.nee-platform.au`.

Also add:
```csharp
if (!app.Environment.IsDevelopment())
{
    app.UseHsts();
    app.UseHttpsRedirection();
}
```

## 1.4 Health-check endpoint + readiness probe

App Service uses an HTTP health check to decide when an instance is
ready and to take it out of rotation when unhealthy.

```csharp
builder.Services.AddHealthChecks()
    .AddNpgSql(connectionString, name: "postgres")
    .AddCheck("self", () => HealthCheckResult.Healthy());

app.MapHealthChecks("/health");
```

Configure App Service `Health Check Path = /health` with a 5-min
threshold before instance recycling.

## 1.5 Application Insights wiring

Add `Microsoft.ApplicationInsights.AspNetCore`:

```csharp
builder.Services.AddApplicationInsightsTelemetry();
```

Set `APPLICATIONINSIGHTS_CONNECTION_STRING` in App Service config (KV
reference). Custom events for kanban refresh / forecast cache hits go
through `ITelemetryClient` injected where useful.

## 1.6 Email — Azure Communication Services

`EmailService` currently uses `SmtpClient` against `localhost:1025`
(Mailpit). Replace with `Azure.Communication.Email`:

```csharp
public class AcsEmailService : IEmailService
{
    private readonly EmailClient _client;
    public AcsEmailService(IConfiguration cfg) =>
        _client = new EmailClient(cfg["Email:AcsEndpoint"],
                                  new DefaultAzureCredential());
    public Task SendAsync(EmailMessage msg) => _client.SendAsync(WaitUntil.Started, msg);
}
```

Behind an `IEmailService` so dev can stay on Mailpit (`SmtpEmailService`).
Wire on `Email:Provider` config = `smtp` | `acs`.

## 1.7 Migration runner

Today: `db/migrations/*.sql` files are applied by Docker Compose or
manually by `make reset`. Cloud needs an automated migration step.

**Approach**: standalone `Nee.MigrationRunner` console project that:
1. Connects to the target Postgres
2. Reads `__migrations` table (creates if missing)
3. Lists files in `db/migrations/` ordered by name
4. Applies anything not already in the table, in a transaction each

```bash
dotnet run --project tools/Nee.MigrationRunner -- \
    --connection-string "$AZURE_PG_CONNECTION" \
    --migrations-dir db/migrations
```

Run as a GitHub Actions step before swapping the App Service slot.
Idempotent on re-run.

## 1.8 Production-grade JWT secret rotation hooks

Bake in support for a key-rotation header so we can roll the secret
without invalidating sessions atomically. Out of scope for first
deploy; just document.

---

# Phase 2 — Infrastructure as Code (Bicep)

Estimated 1.5 days. Define everything in `infra/` as Bicep.

## 2.1 Directory layout

```
infra/
├── main.bicep                # entrypoint, modules below
├── modules/
│   ├── postgres.bicep        # Flexible Server + DB + firewall
│   ├── app-service.bicep     # Linux plan + slot + KV references
│   ├── static-web.bicep      # SWA + custom domain
│   ├── storage.bicep         # blob container + uploads path
│   ├── key-vault.bicep       # KV + access policies for app
│   ├── monitoring.bicep      # Log Analytics + App Insights
│   ├── email.bicep           # ACS Email Communication
│   └── network.bicep         # vNet + subnets if private (Phase 4)
├── parameters/
│   ├── staging.bicepparam
│   └── prod.bicepparam
└── README.md
```

## 2.2 Resource sketch

| Resource | Staging | Prod |
|---|---|---|
| Resource Group | `rg-nee-staging` | `rg-nee-prod` |
| Postgres Flex | B2s, 32GB, no HA | GP D2s_v5, 128GB, ZRS, daily PITR 7d |
| App Service Plan | `B2` Linux | `P1v3` Linux |
| API App | `nee-stg-api`, slot `staging` | `nee-prod-api` + warm `swap` slot |
| Web (SWA) | `nee-stg-web` Standard | `nee-prod-web` Standard |
| Storage | `neestguploads` (blob), `neestgmig` (deploy artifacts) | `neeproduploads` |
| Key Vault | `nee-stg-kv` | `nee-prod-kv` |
| App Insights | `nee-stg-ai` | `nee-prod-ai` |
| ACS Email | `nee-stg-acs` | `nee-prod-acs` |

## 2.3 Critical wiring

- API App Service has a system-assigned managed identity → granted
  `Key Vault Secrets User` on the relevant KV and
  `Storage Blob Data Contributor` on the blob container.
- App Service config uses `@Microsoft.KeyVault(...)` references for:
  - `ConnectionStrings__Postgres`
  - `Jwt__Secret`
  - `Storage__BlobConnection` (or use managed identity → no string)
  - `Email__AcsEndpoint`
- SWA's `staticwebapp.config.json` proxies `/api/*` → the API App
  Service hostname. Eliminates client-side CORS.

## 2.4 First-time deploy

```bash
az login
az group create --name rg-nee-staging --location australiaeast
az deployment group create \
  --resource-group rg-nee-staging \
  --template-file infra/main.bicep \
  --parameters infra/parameters/staging.bicepparam
```

Output: API hostname, web hostname, KV URI, storage URL. Wire those
into the GitHub Actions secrets (Phase 3).

---

# Phase 3 — CI/CD pipelines

Estimated 1.5 days. GitHub Actions; uses OIDC-federated credentials
(no long-lived service-principal secrets in GitHub).

## 3.1 Workflows

| File | Trigger | Does |
|---|---|---|
| `.github/workflows/ci.yml` | PR + push to `main` | `dotnet test`, `npx ng test`, `npx playwright test` (smoke), Bicep `what-if` |
| `.github/workflows/deploy-staging.yml` | push to `main` after CI green | migrate + deploy API + deploy web → staging |
| `.github/workflows/deploy-prod.yml` | manual dispatch on a tag | migrate + deploy API to prod swap slot, swap, deploy web → prod |

## 3.2 Deploy steps (API)

```yaml
# Excerpt — deploy-staging.yml
- uses: azure/login@v2
  with:
    client-id:       ${{ secrets.AZURE_CLIENT_ID }}
    tenant-id:       ${{ secrets.AZURE_TENANT_ID }}
    subscription-id: ${{ secrets.AZURE_SUBSCRIPTION_ID }}

- name: Apply DB migrations
  run: |
    PG_CONN=$(az keyvault secret show --vault-name nee-stg-kv \
              --name Postgres-Connection-String --query value -o tsv)
    dotnet run --project tools/Nee.MigrationRunner -- \
      --connection-string "$PG_CONN" \
      --migrations-dir db/migrations

- name: Build API
  run: dotnet publish api -c Release -o publish/api

- name: Deploy API to staging slot
  uses: azure/webapps-deploy@v3
  with:
    app-name: nee-stg-api
    slot-name: staging
    package: publish/api
```

## 3.3 Deploy steps (web)

```yaml
- name: Build Angular
  run: |
    cd web
    npm ci
    NG_API_BASE=https://api-staging.nee-platform.au npx ng build \
      --configuration=production
- uses: Azure/static-web-apps-deploy@v1
  with:
    azure_static_web_apps_api_token: ${{ secrets.SWA_DEPLOY_TOKEN_STAGING }}
    app_location: web/dist/web/browser
    output_location: ''
    skip_app_build: true
```

## 3.4 Slot-swap promotion

Prod uses an App Service slot for zero-downtime swaps:

1. Deploy artefact to `nee-prod-api/swap` slot.
2. Run smoke test against the swap slot's hostname.
3. `az webapp deployment slot swap --slot swap --target-slot production`.
4. If the swap fails, slot still has the previous build — instant rollback.

---

# Phase 4 — Multi-instance hardening (optional, ship later)

Estimated 1 day. Defer until you actually need >1 API instance.

## 4.1 IMemoryCache → Azure Cache for Redis

`ReportsEndpoints.cs` injects `IMemoryCache` for the forecast. Multi-
instance breaks this — each instance has its own cache, and the
`InvalidateForecastCache(cache)` call in scheduling/cancel/complete
only affects the local instance.

Replace with `IDistributedCache` backed by Redis:

```csharp
builder.Services.AddStackExchangeRedisCache(opt =>
{
    opt.Configuration = builder.Configuration["Redis:ConnectionString"];
});
```

Rewrite the forecast endpoint to use `IDistributedCache` (string key →
`JsonSerializer.Serialize` payload). Remove invalidation code in the
three call sites or replace with `cache.RemoveAsync`.

## 4.2 SignalR → Azure SignalR Service

`KanbanHub` is in-process. Multi-instance means a `NotifyCardUpdated`
on instance A only reaches clients connected to instance A. Add the
Azure SignalR backplane:

```csharp
builder.Services.AddSignalR()
    .AddAzureSignalR(builder.Configuration["AzureSignalR:ConnectionString"]);
```

Switch to **Default mode** (the SignalR service routes connections
through itself). Existing client-side SignalR hub URL stays the same;
the negotiate response transparently redirects.

## 4.3 Sticky sessions / autoscale rules

If still on App Service Linux with multi-instance, set ARR affinity
**off** (default) — JWT auth means no session state lives on the
instance. Add autoscale rules:

- Scale-out CPU > 70% for 10 min → +1 instance, max 4
- Scale-in CPU < 30% for 30 min → -1 instance, min 1

---

# Phase 5 — Production readiness

Estimated 1 day. Things that don't block first deploy but block "go
live" with paying users.

## 5.1 Backups + restore drill

- Postgres Flex: enable PITR 7d in non-prod, 30d in prod.
- Run a restore drill: take a fresh `staging` instance, restore
  yesterday's backup to a side-by-side server, verify app starts.
  Document the runbook.

## 5.2 Monitoring + alerts

App Insights queries to add as alert rules:
- 5xx rate > 1% over 5 min → page on-call
- Postgres CPU > 80% over 15 min → email
- Forecast endpoint p95 > 2s → email (cache hit-rate dropping)
- Failed login rate > 50/min over 5 min → security alert

## 5.3 Cost controls

- Budget alert at 80% of monthly cap on each resource group
- Auto-shutdown of staging Postgres outside business hours (saves ~$40/mo)
- App Service plan downscale on staging weekends (cron-driven)

## 5.4 Domain + SSL

- Buy/transfer `nee-platform.au` if not already
- Custom domain on SWA (`app.nee-platform.au`) — auto-provisioned cert
- Custom domain on App Service (`api.nee-platform.au`) — App Service
  Managed Certificate (free) or KV-backed cert
- Update CORS allow-list + JWT issuer/audience config

## 5.5 Security review checklist

- [ ] All `appsettings.Development.json` values either committed safely
      or moved to gitignored files (`.env.dev`)
- [ ] No `AllowAnyOrigin()` in production CORS
- [ ] No `--no-verify` git operations in deploy pipelines
- [ ] Key Vault access policies use **least privilege** roles, not
      legacy access policies
- [ ] App Service identity has read-only blob access on uploads container
- [ ] Postgres firewall: deny public access, allow only App Service
      outbound IP or use VNet integration
- [ ] Connection strings never logged (App Insights filter)
- [ ] HTTPS-only on all hostnames
- [ ] WAF rules on Front Door (optional, Phase 6)

## 5.6 Data residency confirmation

If customers are AU-based, verify all resources are AU-region:
- Storage Account: AU East
- Postgres: AU East primary, AU Southeast for cross-region read replica
- App Service Plan: AU East
- App Insights: AU East
- Key Vault: AU East
- ACS: Global by default — switch to a Geo-restricted resource if
  needed, document the limitation if not.

---

# Phase 6 — Stretch (Phase 4 of platform)

Tracked here so they don't get lost; not required for first prod deploy.

- **Front Door + WAF** — single global entry point, OWASP rules
- **VNet integration** — private Postgres, private blob storage
- **Azure AD (Entra ID) auth** — replace HS256 JWT with Entra B2C
  for customer logins; tech accounts move to Entra ID (workforce)
- **Azure Document Intelligence** — replace the regex PDF parser
- **Azure Container Apps** — consider for sidecar workloads (batch
  forecast precomputation, nightly reports)
- **Multi-region failover** — read replica + Front Door routing rules

---

# Step-by-step deploy checklist (first time)

For the developer doing the actual first deploy. Tick them off in order.

## Day 1 — code prep

- [ ] Open PR for `IFileStorage` abstraction; merge after review
- [ ] Rewire 4 endpoints to use `IFileStorage`; tests green
- [ ] Add `IEmailService` abstraction; SMTP impl for dev
- [ ] Remove any plain-text secrets from `appsettings.json`
- [ ] Add `/health` endpoint with PG check
- [ ] Wire Application Insights conditional on env var

## Day 2 — code prep cont.

- [ ] Production-safe CORS via config
- [ ] HSTS + HTTPS redirection in non-dev environments
- [ ] Build `Nee.MigrationRunner` console project
- [ ] Smoke-test runner against a fresh `make reset` Postgres
- [ ] Update `CLAUDE.md` with new env var list

## Day 3 — Bicep + first staging deploy

- [ ] Author `infra/` Bicep modules
- [ ] `az login`; create RG; deploy `staging.bicepparam`
- [ ] Pre-populate KV secrets (Jwt, Postgres, blob, ACS)
- [ ] Verify managed identity → KV → blob access
- [ ] Run migrations against staging Postgres
- [ ] Deploy API to staging App Service
- [ ] Deploy web to SWA with `NG_API_BASE` pointing at staging API
- [ ] Manual smoke: log in, create RO, complete a task, run a report

## Day 4 — pipelines

- [ ] Author `ci.yml`, `deploy-staging.yml`, `deploy-prod.yml`
- [ ] Set up OIDC federated credentials in Azure (no PATs in GitHub)
- [ ] Push a small change → confirm staging auto-deploys
- [ ] Add prod resource group + parameters (don't deploy yet)

## Day 5 — production go-live

- [ ] Run `deploy-prod.yml` (manual approve)
- [ ] Custom domain + cert
- [ ] Monitoring alerts + on-call rota
- [ ] Take a backup, run a restore drill, document
- [ ] Hand-off doc / runbook to ops

---

# Anti-patterns to avoid

Things that look attractive but cost more than they save:

- **Hosting Postgres on App Service / Container Apps** — fragile,
  no PITR. Always use the managed PG service.
- **Storing JWT secret in App Service Configuration plain text** —
  Key Vault references add no friction once set up; do them on day 1.
- **Connection string with DB password in env var** — use managed
  identity-based PG auth (Entra) instead. App Service supports it.
- **One App Service Plan per app** — share a Plan across API +
  staging slots; cuts the bill in half.
- **Blob URLs returned directly from API** — return SAS URLs with
  short TTL (30 min default in `BlobFileStorage`) so leakage has
  bounded exposure.
- **Deploy via `dotnet publish` zip uploaded by hand** — fine once,
  toxic by month two. Pipelines on day 1.
- **Skipping Application Insights** — by week three you'll regret it
  the first time something hangs in production.
- **Mixing dev seed accounts with prod** — `make seed` is dev-only;
  prod gets a single bootstrap admin via the migration runner with
  the password in KV, then immediate password change on first login.

---

# Cost rough-cut (AUD/month, AU East)

| Item | Staging | Prod | Notes |
|---|---:|---:|---|
| App Service Plan | $80 (B2 Linux) | $230 (P1v3 Linux) | 2 slots on prod plan |
| Postgres Flex | $30 (B2s 32GB) | $185 (D2s_v5 128GB) | + $25/mo backup |
| Static Web Apps | $0 (Free) | $13 (Standard) | Custom domain on Standard |
| Storage | $5 | $15 | Blob + small egress |
| Key Vault | $0.50 | $0.50 | Per-secret operation cost |
| App Insights | $5 (1GB/mo) | $20 (4GB/mo) | Sampling at 25% |
| ACS Email | $0.20 | $5 | $0.00025/email |
| **Total** | **~$120** | **~$470** | Excludes dev/data egress |

Add a 20% buffer for unexpected egress / tool-stack / DR drills.

---

# When something goes wrong

Anchor failure modes, sorted by likelihood:

1. **Migration fails mid-deploy** — migrationrunner is per-file
   transactional, but cross-file failures leave you part-applied.
   Fix: re-run after manually fixing the offending migration; the
   `__migrations` table tracks what's done.
2. **Forecast endpoint slower in prod than dev** — most likely the
   `IMemoryCache` warm hit isn't happening because the App Service
   instance gets recycled by health-check fail. Check `/health` is
   returning 200 and Postgres connectivity is stable.
3. **CORS errors after deploy** — `Cors__AllowedOrigins__0` either
   wrong or not set. Double-check the App Service config blade.
4. **SignalR stops working under load** — single-instance limit. Either
   scale back to 1 instance or move to Azure SignalR (Phase 4.2).
5. **Blob URLs returning 403** — SAS expired (default 30 min) or
   managed identity lost the role assignment. Check IAM on the
   storage account.
6. **Login works but every API call 401s** — `Jwt:Secret` in App
   Service config differs from what the token was signed with. If
   you rotated KV, restart the App Service to pick up the new value.
