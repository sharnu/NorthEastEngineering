# Single-container "self-resetting demo" image for Azure Container Apps.
# Bundles Postgres 16 + .NET 10 API + Angular static bundle + nginx behind
# one HTTP port. On a fresh start (ephemeral disk) the entrypoint applies
# every migration in db/migrations/ and rehashes the seed passwords, so each
# cold start lands on a clean, populated demo.
#
# Built and pushed by infra/deploy-aca.sh ; consumed by the nee container app.

# Base provides Postgres 16, gosu for dropping to the postgres user, and the
# data-dir layout. We add .NET runtime and nginx on top.
FROM postgres:16-bookworm

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        nginx curl ca-certificates \
 && curl -fsSL https://dot.net/v1/dotnet-install.sh \
        | bash -s -- --channel 10.0 --runtime aspnetcore --install-dir /usr/share/dotnet \
 && ln -s /usr/share/dotnet/dotnet /usr/local/bin/dotnet \
 && apt-get purge -y curl \
 && apt-get clean && rm -rf /var/lib/apt/lists/* /var/cache/apt/archives/*

# App layout matches the VM at /opt/nee/{api,web,migrations}
COPY web/dist/web/browser/      /opt/nee/web/
COPY api/bin/publish/           /opt/nee/api/
COPY db/migrations/             /opt/nee/migrations/

# Configs
COPY infra/nginx-in-container.conf /etc/nginx/sites-available/nee
COPY infra/container-entrypoint.sh /entrypoint.sh

RUN chmod +x /entrypoint.sh \
 && rm -f /etc/nginx/sites-enabled/default \
 && ln -s /etc/nginx/sites-available/nee /etc/nginx/sites-enabled/nee

# Postgres data dir (ephemeral in Option A, Azure Files mount in Option B)
ENV PGDATA=/var/lib/postgresql/data

EXPOSE 80
ENTRYPOINT ["/entrypoint.sh"]
