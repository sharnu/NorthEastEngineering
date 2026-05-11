#!/usr/bin/env bash
# deploy.sh — build locally and ship the app to a VM.
#
# Required env:
#   NEE_VM      ssh target, e.g. azureuser@20.213.45.67  (or a Host alias from ~/.ssh/config)
# Optional env:
#   NEE_REMOTE  remote app dir   (default: /opt/nee)
#   SKIP_WEB=1  skip the Angular build/sync
#   SKIP_API=1  skip the .NET publish/sync
#   SKIP_DB=1   skip the migrations sync
#
# Usage: NEE_VM=azureuser@<vm-ip> ./infra/deploy.sh

set -euo pipefail

: "${NEE_VM:?Set NEE_VM=user@host (or an SSH config alias) before deploying}"
NEE_REMOTE="${NEE_REMOTE:-/opt/nee}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

log() { printf '\e[1;34m▶ %s\e[0m\n' "$*"; }

cd "$REPO_ROOT"

# ── Web ─────────────────────────────────────────────────────────────────────
if [[ "${SKIP_WEB:-0}" != "1" ]]; then
    log "Building Angular (production)"
    ( cd web && npm ci --prefer-offline --no-audit --silent && \
                npm run build -- --configuration production )

    log "Syncing web bundle → $NEE_VM:$NEE_REMOTE/web/"
    rsync -az --delete web/dist/web/browser/ "$NEE_VM:$NEE_REMOTE/web/"
fi

# ── API ─────────────────────────────────────────────────────────────────────
if [[ "${SKIP_API:-0}" != "1" ]]; then
    log "Publishing .NET API (Release)"
    rm -rf api/bin/publish
    dotnet publish api/Nee.Api.csproj -c Release -o api/bin/publish --nologo

    log "Syncing API → $NEE_VM:$NEE_REMOTE/api/"
    # --delete-excluded keeps the remote in sync but preserves uploads/ which
    # is a separate bind-mounted directory (see vm-bootstrap.sh systemd unit).
    rsync -az --delete --exclude='uploads/' \
        api/bin/publish/ "$NEE_VM:$NEE_REMOTE/api/"
fi

# ── Migrations (used by `make deploy-reset`) ────────────────────────────────
if [[ "${SKIP_DB:-0}" != "1" ]]; then
    log "Syncing migrations and docker-compose"
    rsync -az --delete db/migrations/        "$NEE_VM:$NEE_REMOTE/migrations/"
    rsync -az          db/docker-compose.yml "$NEE_VM:$NEE_REMOTE/docker-compose.yml"
fi

# ── Restart API ─────────────────────────────────────────────────────────────
log "Restarting nee-api on $NEE_VM"
ssh "$NEE_VM" 'sudo systemctl restart nee-api && sudo systemctl is-active nee-api'

log "Deploy complete."
