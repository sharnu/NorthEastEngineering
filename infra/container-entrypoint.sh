#!/usr/bin/env bash
# Entrypoint for the single-container demo image (infra/Dockerfile).
# Brings up Postgres → applies migrations once → starts nginx → runs the .NET
# API in the foreground. PID 1 is the API, so if it crashes the container
# exits and Container Apps restarts it.
#
# Idempotency markers live inside $PGDATA so they survive when persistent
# storage is mounted and are wiped automatically on ephemeral starts.

set -euo pipefail

log() { printf '\e[1;34m▶ %s\e[0m\n' "$*"; }

# ── Postgres ────────────────────────────────────────────────────────────────
# Initialise the data dir on first boot.
if [[ ! -s "$PGDATA/PG_VERSION" ]]; then
    log "Initialising Postgres data dir"
    chown -R postgres:postgres "$PGDATA"
    chmod 700 "$PGDATA"
    gosu postgres initdb -D "$PGDATA" --auth-local=trust --auth-host=trust
fi

log "Starting Postgres on 127.0.0.1:5432"
gosu postgres pg_ctl -D "$PGDATA" \
    -o "-c listen_addresses=127.0.0.1 -c shared_buffers=128MB -c max_connections=50" \
    -l /tmp/pg.log -w start

# Role + database (idempotent — safe across persistent restarts too)
gosu postgres psql -tA -c "SELECT 1 FROM pg_roles WHERE rolname='nee'" | grep -q 1 \
    || gosu postgres psql -c "CREATE ROLE nee WITH LOGIN SUPERUSER PASSWORD 'nee_dev';"
gosu postgres psql -tA -c "SELECT 1 FROM pg_database WHERE datname='nee'" | grep -q 1 \
    || gosu postgres psql -c "CREATE DATABASE nee OWNER nee;"

# Apply migrations once. Marker lives in $PGDATA so:
#   - on ephemeral disk: gone on each cold start → migrations re-applied → fresh demo
#   - on persistent disk: present after first run → migrations skipped
MIGRATIONS_MARKER="$PGDATA/.nee-migrations-applied"
if [[ ! -f "$MIGRATIONS_MARKER" ]]; then
    log "Applying migrations"
    for f in /opt/nee/migrations/*.sql; do
        echo "  · $(basename "$f")"
        PGPASSWORD=nee_dev psql -h 127.0.0.1 -U nee -d nee -v ON_ERROR_STOP=1 -f "$f" \
            >/tmp/pg-migrate.log 2>&1 \
            || { echo "Migration failed: $f"; tail -30 /tmp/pg-migrate.log; exit 1; }
    done
    touch "$MIGRATIONS_MARKER"
fi

# ── nginx (background) ──────────────────────────────────────────────────────
log "Starting nginx"
nginx

# ── Password hashing (one-shot, after API is up) ────────────────────────────
# Run in the background so it doesn't block the API exec. Runs once per data
# volume — marker is in $PGDATA so it shares the same persistence semantics.
HASH_MARKER="$PGDATA/.nee-passwords-hashed"
if [[ ! -f "$HASH_MARKER" ]]; then
    (
        for delay in 1 1 1 2 2 3 3 5 5 8; do
            if curl -fsS http://127.0.0.1:5000/api/health >/dev/null 2>&1; then
                if curl -fsS -X POST http://127.0.0.1:5000/api/dev/reseed-passwords >/dev/null; then
                    log "Seed passwords hashed"
                    touch "$HASH_MARKER"
                fi
                exit 0
            fi
            sleep "$delay"
        done
        echo "⚠ API health probe timed out; passwords not hashed yet" >&2
    ) &
fi

# ── API (foreground / PID 1 after exec) ─────────────────────────────────────
log "Starting .NET API"
cd /opt/nee/api
exec dotnet /opt/nee/api/Nee.Api.dll
