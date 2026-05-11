# Path 2 (Container Apps) — split deploy via Azure Cloud Shell

Use this guide when you **cannot run `az login` locally** (corporate
device, Conditional Access blocking the device-code flow, etc.) but you
**can** open [shell.azure.com](https://shell.azure.com) in a browser.

The standard `make deploy-aca*` targets assume `az` works on your laptop,
so they won't fire. Instead we split the work in two:

| Phase | Where it runs | Needs `az`? |
|---|---|---|
| 1. Build app, build image, push to a public registry | **Local laptop** (Docker + .NET + Node) | No |
| 2. Create / update the Container App | **Azure Cloud Shell** (browser) | Yes |

The bridge between the two is the **publicly-pullable image** in GHCR
or Docker Hub. Cloud Shell never touches your laptop — it just pulls
the image by reference.

---

## Prerequisites

**On your laptop**
- Docker
- .NET 10 SDK
- Node 20+
- A GitHub account with a Personal Access Token that has `write:packages`
  (or a Docker Hub account)

**In the browser**
- An Azure subscription (the 12-month free trial works)
- Access to [shell.azure.com](https://shell.azure.com)

---

## One-time setup

### 1. Log in to your image registry (local)

GitHub Container Registry (free, public):

```bash
docker login ghcr.io -u <your-github-user>
# paste the PAT (write:packages) as the password
```

Or Docker Hub (also free for public repos):

```bash
docker login
```

### 2. Build app + image and push (local)

From the repo root:

```bash
# Choose your image reference once
export NEE_IMAGE=ghcr.io/<your-github-user>/nee
export NEE_TAG=$(git rev-parse --short HEAD)

# Build Angular (production)
( cd web && npm ci --prefer-offline --no-audit && \
            npm run build -- --configuration production )

# Publish the .NET API
rm -rf api/bin/publish
dotnet publish api/Nee.Api.csproj -c Release -o api/bin/publish --nologo

# Build + push the single-container image
docker build -t "$NEE_IMAGE:$NEE_TAG" -t "$NEE_IMAGE:latest" -f infra/Dockerfile .
docker push "$NEE_IMAGE:$NEE_TAG"
docker push "$NEE_IMAGE:latest"

echo "Pushed:  $NEE_IMAGE:$NEE_TAG"
```

> **Important**: make the GHCR package **public** so Container Apps can
> pull without credentials.
> GitHub → your profile → Packages → `nee` → Package settings →
> *Change visibility* → Public.
>
> If you'd rather keep it private, see "Private registry" at the bottom.

### 3. Create Azure resources (Cloud Shell)

Open [shell.azure.com](https://shell.azure.com) and pick **Bash**. Paste
the whole block — adjust the first six lines to match what you pushed:

```bash
# ── Variables ──────────────────────────────────────────────────────
NEE_IMAGE=ghcr.io/<your-github-user>/nee
NEE_TAG=<paste-the-tag-printed-by-step-2>      # or: latest
NEE_RG=nee-rg
NEE_LOCATION=australiaeast
NEE_APP=nee
NEE_ENV=nee-env

# ── Make sure the Container Apps extension + providers are ready ───
az extension add -n containerapp --upgrade -y
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait

# ── Resource group + Container Apps environment ────────────────────
az group create -n "$NEE_RG" -l "$NEE_LOCATION"
az containerapp env create -n "$NEE_ENV" -g "$NEE_RG" -l "$NEE_LOCATION"

# ── Generate a JWT secret (kept inside Container Apps) ─────────────
JWT_SECRET="$(openssl rand -base64 48)"

# ── Create the container app ───────────────────────────────────────
az containerapp create \
  --name "$NEE_APP" \
  --resource-group "$NEE_RG" \
  --environment "$NEE_ENV" \
  --image "${NEE_IMAGE}:${NEE_TAG}" \
  --target-port 80 \
  --ingress external \
  --cpu 0.5 --memory 1Gi \
  --min-replicas 0 --max-replicas 1 \
  --secrets "jwt-secret=$JWT_SECRET" \
  --env-vars \
    ASPNETCORE_ENVIRONMENT=Production \
    ASPNETCORE_URLS=http://127.0.0.1:5000 \
    "ConnectionStrings__Postgres=Host=127.0.0.1;Port=5432;Database=nee;Username=nee;Password=nee_dev" \
    Jwt__Secret=secretref:jwt-secret \
    Jwt__Issuer=nee-platform \
    Jwt__Audience=nee-platform-web

# ── Print the public URL ───────────────────────────────────────────
az containerapp show -n "$NEE_APP" -g "$NEE_RG" \
  --query properties.configuration.ingress.fqdn -o tsv
```

The last command prints something like
`nee.kindbeach-1234abcd.australiaeast.azurecontainerapps.io`.
Visit `https://<that>` — the first hit cold-starts in 15–30 s while
the image pulls, Postgres boots, migrations apply, and demo passwords
hash. After that, log in with any account from `docs/seed-accounts.md`
(password `nee2026`).

---

## Routine deploys

Every code change goes through two short phases.

### Laptop — rebuild and push a new image

```bash
export NEE_IMAGE=ghcr.io/<your-github-user>/nee
export NEE_TAG=$(git rev-parse --short HEAD)

( cd web && npm run build -- --configuration production )
rm -rf api/bin/publish
dotnet publish api/Nee.Api.csproj -c Release -o api/bin/publish --nologo

docker build -t "$NEE_IMAGE:$NEE_TAG" -t "$NEE_IMAGE:latest" -f infra/Dockerfile .
docker push "$NEE_IMAGE:$NEE_TAG"
docker push "$NEE_IMAGE:latest"

echo "Pushed tag: $NEE_TAG"
```

### Cloud Shell — point the app at the new tag

```bash
NEE_TAG=<paste-the-tag-from-the-laptop-output>

az containerapp update \
  --name nee --resource-group nee-rg \
  --image ghcr.io/<your-github-user>/nee:$NEE_TAG \
  --revision-suffix $NEE_TAG
```

Container Apps creates a new revision and shifts 100 % traffic to it.
The previous revision is kept for instant rollback.

---

## Day-to-day operations (Cloud Shell)

| Want to… | Command |
|---|---|
| Print the public URL | `az containerapp show -n nee -g nee-rg --query properties.configuration.ingress.fqdn -o tsv` |
| Tail container logs | `az containerapp logs show -n nee -g nee-rg --follow` |
| List revisions | `az containerapp revision list -n nee -g nee-rg -o table` |
| Roll back | `az containerapp revision activate -n nee -g nee-rg --revision <name>` |
| Force a restart (re-seeds the demo) | `az containerapp revision restart -n nee -g nee-rg --revision <name>` |
| Inspect env / secrets | `az containerapp show -n nee -g nee-rg -o yaml` |

---

## Troubleshooting

**`docker push` → `denied: requested access denied`.**
Your `docker login` is missing or the PAT lacks `write:packages`. Re-run
`docker login ghcr.io -u <user>` with a fresh PAT.

**Container Apps pull fails (`UNAUTHORIZED`).**
The GHCR package is still private. Switch it to *Public* under
GitHub → Packages → `nee` → Package settings.
Or wire up the private flow (see below).

**`az containerapp create` says "extension not installed".**
Run `az extension add -n containerapp --upgrade -y` once per Cloud
Shell session — Cloud Shell starts cold and discards extensions.

**`MissingSubscriptionRegistration` on `az containerapp env create`.**
Resource providers aren't registered yet:
```bash
az provider register --namespace Microsoft.App --wait
az provider register --namespace Microsoft.OperationalInsights --wait
```

**Browser shows "Application Error" or 503 for ~30 s.**
Cold start in progress. Tail logs in Cloud Shell to watch boot:
`az containerapp logs show -n nee -g nee-rg --follow`.

**Login fails with "Invalid credentials" right after a cold start.**
Password-hashing runs ~5–15 s after the API comes up. Wait and retry.

**Cloud Shell session expired mid-deploy.**
Open a new session, re-`export` the variables (or paste the whole block
again — every step is idempotent).

---

## Private registry (optional)

If you want to keep the image **private**, add registry credentials to
the Container App when creating or updating it:

```bash
# GHCR with a PAT that has read:packages
az containerapp registry set \
  -n nee -g nee-rg \
  --server ghcr.io \
  --username <github-user> \
  --password <PAT>
```

Then redeploy with `az containerapp update --image …` as usual — the
stored credentials are used to pull on every cold start.

---

## Why this works

`infra/deploy-aca.sh` chains two independent phases — local build/push
and remote `az` calls. The split deploy just runs each phase where the
required credentials live. The image is the only artefact that needs
to cross the boundary, and a public registry tag handles that with
zero auth on the Azure side.
