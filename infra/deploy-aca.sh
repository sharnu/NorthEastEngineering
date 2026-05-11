#!/usr/bin/env bash
# deploy-aca.sh — build the single-container image and ship it to Azure Container Apps.
#
# Required env:
#   NEE_IMAGE        full image reference, e.g. ghcr.io/sharnu/nee  or  myacr.azurecr.io/nee
# Optional env:
#   NEE_TAG          image tag (default: short git sha; also tagged "latest")
#   NEE_RG           Azure resource group   (default: nee-rg)
#   NEE_LOCATION     Azure region           (default: australiaeast)
#   NEE_APP          Container app name     (default: nee)
#   NEE_ENV          Container Apps environment name (default: nee-env)
#   ACTION           one of  init | update  (default: update)
#
# First time:   ACTION=init  NEE_IMAGE=ghcr.io/you/nee  ./infra/deploy-aca.sh
# Routine:      NEE_IMAGE=ghcr.io/you/nee               ./infra/deploy-aca.sh

set -euo pipefail

: "${NEE_IMAGE:?Set NEE_IMAGE=<registry>/<repo>  (e.g. ghcr.io/you/nee)}"
NEE_TAG="${NEE_TAG:-$(git rev-parse --short HEAD 2>/dev/null || date +%s)}"
NEE_RG="${NEE_RG:-nee-rg}"
NEE_LOCATION="${NEE_LOCATION:-australiaeast}"
NEE_APP="${NEE_APP:-nee}"
NEE_ENV="${NEE_ENV:-nee-env}"
ACTION="${ACTION:-update}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log() { printf '\e[1;34m▶ %s\e[0m\n' "$*"; }

cd "$REPO_ROOT"

# ── Build local artefacts first so the Dockerfile can just COPY ─────────────
log "Building Angular (production)"
( cd web && npm ci --prefer-offline --no-audit --silent \
                && npm run build -- --configuration production )

log "Publishing .NET API (Release)"
rm -rf api/bin/publish
dotnet publish api/Nee.Api.csproj -c Release -o api/bin/publish --nologo

# ── Build & push image ──────────────────────────────────────────────────────
log "Building image ${NEE_IMAGE}:${NEE_TAG}"
docker build -t "${NEE_IMAGE}:${NEE_TAG}" -t "${NEE_IMAGE}:latest" -f infra/Dockerfile .

log "Pushing ${NEE_IMAGE}:${NEE_TAG} and :latest"
docker push "${NEE_IMAGE}:${NEE_TAG}"
docker push "${NEE_IMAGE}:latest"

# ── Azure resources ─────────────────────────────────────────────────────────
log "Ensuring resource group $NEE_RG exists"
az group show -n "$NEE_RG" >/dev/null 2>&1 \
    || az group create -n "$NEE_RG" -l "$NEE_LOCATION" >/dev/null

log "Ensuring Container Apps environment $NEE_ENV exists"
az containerapp env show -n "$NEE_ENV" -g "$NEE_RG" >/dev/null 2>&1 \
    || az containerapp env create -n "$NEE_ENV" -g "$NEE_RG" -l "$NEE_LOCATION" >/dev/null

if [[ "$ACTION" == "init" ]]; then
    log "Creating container app $NEE_APP"
    JWT_SECRET="$(openssl rand -base64 48)"
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
            Jwt__Audience=nee-platform-web \
        >/dev/null
else
    log "Updating container app $NEE_APP → ${NEE_IMAGE}:${NEE_TAG}"
    az containerapp update \
        --name "$NEE_APP" \
        --resource-group "$NEE_RG" \
        --image "${NEE_IMAGE}:${NEE_TAG}" \
        --revision-suffix "$NEE_TAG" \
        >/dev/null
fi

FQDN=$(az containerapp show -n "$NEE_APP" -g "$NEE_RG" \
        --query properties.configuration.ingress.fqdn -o tsv)

log "Deploy complete."
echo "  https://$FQDN"
