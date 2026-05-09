# 10-day UAT Deploy — cheap & cheerful

> Companion to `docs/azure-deployment-plan.md`. That plan targets a
> production-grade environment (~AUD 120/mo staging, AUD 470/mo prod).
> For a **10-day UAT** that doesn't need to survive into production,
> almost all of that is over-engineered. This doc shows the minimum.
>
> **Target cost: AUD 5–10 total for 10 days.**
> **Target setup time: half a day.**

---

## TL;DR — recommended approach

**Single Azure VM (B1s, Linux) running your existing `docker-compose`
stack behind Caddy for HTTPS.**

You ship the repo as-is, `docker compose up`, point a DNS record at
the VM, done. No App Service, no Key Vault, no Bicep, no Static Web
Apps — those exist for things you don't need at UAT scale (HA,
deploy automation, multi-instance, audit logging).

| | UAT-cheap (this doc) | Full prod plan |
|---|---|---|
| **Cost (10 days)** | ~AUD 5–10 | ~AUD 40 (pro-rated) |
| **Setup time** | ~4 hours | ~5 days |
| **Code changes needed** | None | ~6 (file storage, secrets, etc.) |
| **CI/CD pipelines** | None — SSH + git pull | GitHub Actions w/ slot swap |
| **HTTPS** | Caddy + Let's Encrypt | App Service managed cert |
| **Backups** | `pg_dump` on a cron | PITR 7d |
| **Acceptable for** | 10-day UAT, 5–20 concurrent users | Real production |

---

## Why this works

The codebase already has Docker Compose for Postgres + Mailpit. The
only missing pieces for "internet-accessible" are:

1. A small VM with a public IP
2. HTTPS termination (Caddy does this in two lines of config)
3. A way to run the .NET API and Angular dev server beside the
   existing Docker services

Everything else (uploads on disk, JWT in env var, in-memory cache,
in-process SignalR) **already works as-is** for a single host.

---

## Architecture

```
                    Internet
                       │
                       ▼  HTTPS (Caddy + Let's Encrypt)
            ┌──────────────────────┐
            │  Azure VM (B1s)      │
            │  Ubuntu 24.04 LTS    │
            │                      │
            │  Caddy :443 ──┬──> :4200 (Angular)
            │               └──> :5000 (API)
            │                                            │
            │  ┌────────── docker compose ───────────┐   │
            │  │ postgres:16 (volume)                │   │
            │  │ mailpit                             │   │
            │  └─────────────────────────────────────┘   │
            └──────────────────────────────────────────┘
            │  /opt/nee/uploads (mounted)              │
            │  /opt/nee/repo    (git checkout)         │
            └──────────────────────────────────────────┘
```

---

## Cost — line-by-line

| Item | SKU | $AUD/hr | $AUD for 10 days |
|---|---|---:|---:|
| VM compute | **B1s** (1 vCPU, 1 GB RAM) | $0.014 | **$3.36** |
| OS disk | Standard SSD 30 GB (P4) | — | **$1.80** |
| Public IP | Standard static | — | **$1.20** |
| Outbound bandwidth | First 100 GB/mo free | — | **$0** |
| **Total** | | | **~AUD 6.50** |

If you **deallocate the VM overnight** (8h/day instead of 24h), VM
cost drops to ~$1.10. Realistic UAT total: **AUD 4–5**.

If `B1s` is too small (it might be — Postgres + .NET + Angular dev
server eats memory), bump to **B2s** (2 vCPU, 4 GB RAM): ~$15 for
10 days. Still trivial.

---

## Step-by-step: UAT deploy

### 0. Prerequisites

- Azure subscription (any tier, even pay-as-you-go)
- A domain name (or use the VM's `*.cloudapp.azure.com` DNS — free,
  ugly, works fine for UAT)
- Your local SSH public key

### 1. Provision the VM (10 minutes)

```bash
# Create resource group
az group create --name rg-nee-uat --location australiaeast

# Create VM with auto-installed Docker
az vm create \
  --resource-group rg-nee-uat \
  --name nee-uat \
  --image Ubuntu2404 \
  --size Standard_B2s \
  --admin-username azureuser \
  --ssh-key-values ~/.ssh/id_rsa.pub \
  --public-ip-sku Standard \
  --public-ip-address-dns-name nee-uat \
  --custom-data cloud-init.yml

# Open ports 80 + 443
az vm open-port --resource-group rg-nee-uat --name nee-uat --port 80,443 --priority 1010
```

**`cloud-init.yml`** — auto-installs Docker + Caddy on first boot:

```yaml
#cloud-config
package_update: true
packages:
  - docker.io
  - docker-compose-plugin
  - debian-keyring
  - debian-archive-keyring
  - apt-transport-https
runcmd:
  - usermod -aG docker azureuser
  - curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  - curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
  - apt update
  - apt install -y caddy
  - systemctl enable docker
  - systemctl enable caddy
```

DNS hostname auto-assigned: `nee-uat.australiaeast.cloudapp.azure.com`
(Caddy can pull a Let's Encrypt cert for any DNS hostname).

### 2. Ship the repo (15 minutes)

```bash
ssh azureuser@nee-uat.australiaeast.cloudapp.azure.com

# On the VM
git clone <your-repo-url> /opt/nee/repo
cd /opt/nee/repo

# Install .NET 10 SDK
wget https://dot.net/v1/dotnet-install.sh
bash dotnet-install.sh --channel 10.0
echo 'export PATH=$PATH:$HOME/.dotnet' >> ~/.bashrc
source ~/.bashrc

# Install Node.js 20
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash
sudo apt install -y nodejs

# Verify
dotnet --version    # 10.0.x
node --version      # v20.x
docker --version
```

### 3. Bring up Postgres + Mailpit (2 minutes)

```bash
cd /opt/nee/repo
make up    # already in your Makefile
make seed
make hash-pw
```

Postgres binds to `127.0.0.1:5432` only — no public exposure.

### 4. Run the API + web (5 minutes)

The simplest option — use `tmux` so the processes survive your SSH
session:

```bash
sudo apt install -y tmux

tmux new -s api
cd /opt/nee/repo/api
dotnet run    # binds to :5000
# Ctrl-b d to detach

tmux new -s web
cd /opt/nee/repo/web
npm ci
npx ng serve --host 127.0.0.1 --port 4200
# Ctrl-b d to detach
```

For something marginally more robust, run them under `systemd`. See
appendix.

### 5. Wire Caddy for HTTPS (5 minutes)

`/etc/caddy/Caddyfile`:

```
nee-uat.australiaeast.cloudapp.azure.com {
    # Caddy auto-provisions Let's Encrypt cert on first request

    # API routes
    handle /api/* {
        reverse_proxy 127.0.0.1:5000
    }
    handle /hubs/* {
        reverse_proxy 127.0.0.1:5000
    }
    handle /uploads/* {
        reverse_proxy 127.0.0.1:5000
    }

    # Everything else → Angular dev server (or static build)
    handle {
        reverse_proxy 127.0.0.1:4200
    }
}
```

```bash
sudo systemctl reload caddy
```

Visit `https://nee-uat.australiaeast.cloudapp.azure.com` — you have
a working HTTPS app.

### 6. Smoke test (5 minutes)

- Login as `supervisor` / `nee2026`
- Open kanban
- Open reports tab
- Verify Mailpit at `127.0.0.1:8025` via SSH tunnel
  (`ssh -L 8025:localhost:8025 azureuser@…`)

---

## Optional improvements (only if pain warrants)

### A. Production-build the Angular app (recommended)

The dev server eats memory and rebuilds on file change. For UAT use
the production build served by Caddy directly:

```bash
cd /opt/nee/repo/web
npx ng build --configuration=production
```

Update Caddyfile:
```
handle {
    root * /opt/nee/repo/web/dist/web/browser
    try_files {path} /index.html
    file_server
}
```

Halves VM RAM use. B1s becomes viable.

### B. systemd unit for the API

`/etc/systemd/system/nee-api.service`:

```ini
[Unit]
Description=NEE API
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
User=azureuser
WorkingDirectory=/opt/nee/repo/api
ExecStart=/home/azureuser/.dotnet/dotnet run -c Release
Restart=on-failure
RestartSec=5
Environment=ASPNETCORE_ENVIRONMENT=Production
Environment=ConnectionStrings__Postgres=Host=localhost;Database=nee;Username=nee;Password=nee_local
Environment=Jwt__Secret=<generate a 64-char random string>

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now nee-api
```

Survives reboots, restarts on crash, no `tmux` needed.

### C. Auto-shutdown the VM at night

Free, halves the compute bill:

```bash
az vm auto-shutdown \
  --resource-group rg-nee-uat \
  --name nee-uat \
  --time 1800 \
  --email <your-email>
```

VM shuts down at 18:00 local. Start it manually each morning:
```bash
az vm start --resource-group rg-nee-uat --name nee-uat
```

(Add a cron in your shell to auto-start weekday mornings if needed.)

### D. Daily Postgres backup to local disk

Before tearing down the VM at the end of UAT — or to capture
intermediate state — run:

```bash
docker exec nee-postgres pg_dump -U nee nee > /opt/nee/backup-$(date +%F).sql
```

Cron at `0 2 * * * /opt/nee/backup.sh`. Keeps the last 7 days.

---

## What you skip vs the full plan

These are deliberate omissions. Each is fine for UAT; **none** is
acceptable for production.

| Skipped | OK for UAT because… |
|---|---|
| Azure App Service | Single VM is cheaper and "dev mode" works fine for ≤20 concurrent users |
| Static Web Apps | Caddy serves the Angular build directly; saves the SWA tier cost |
| Azure Database for PostgreSQL | Containerised PG is fine for UAT; back up before destroy |
| Azure Blob Storage | Uploads stay on the VM disk; survive reboots, lost when VM is destroyed |
| Key Vault | Env vars in `systemd` unit / `docker compose .env` |
| Application Insights | `docker logs` + `journalctl -u nee-api -f` is enough for 10 days |
| Bicep / IaC | One `az vm create` + a Caddyfile — write IaC when you do this twice |
| GitHub Actions | `git pull && systemctl restart nee-api` is the deploy script |
| Slot swaps | Acceptable to have a 10s downtime when you push a fix |
| Multi-instance scale-out | One VM is more than enough for UAT |
| Azure SignalR Service | In-process hub works on a single instance |
| HA / PITR / DR | If the VM dies you spin a new one in 15 minutes; UAT users will accept |
| Custom domain | The `*.cloudapp.azure.com` hostname is functional |

---

## Tear-down (the day after UAT ends)

```bash
# Optional: dump the DB for posterity
ssh azureuser@nee-uat... 'docker exec nee-postgres pg_dump -U nee nee' \
    > nee-uat-final-$(date +%F).sql

# Optional: tar the uploads folder
ssh azureuser@nee-uat... 'tar -czf - /opt/nee/uploads' > uploads-$(date +%F).tar.gz

# Destroy everything
az group delete --name rg-nee-uat --yes
```

Clean — zero ongoing cost.

---

## When to upgrade to the full plan

Move to `docs/azure-deployment-plan.md` if **any** of these become true:

- UAT extends beyond ~3 weeks
- Real customer data lands in the system (compliance, backups)
- More than ~20 concurrent users
- A second person needs deploy access (push your own changes)
- You need an audit trail of who deployed what
- The VM going down for an hour starts costing real money

Below that, the single-VM approach is the rational choice.

---

## Anti-patterns even at UAT scale

Things that look cheaper but bite back:

- **Free-tier App Service / SWA** — both have hard memory + CPU
  caps that make the .NET app sluggish and Angular cold-start slow.
  B2s VM beats either for ~$1 difference.
- **Sharing a VM with another project** — UAT users will ask
  questions about firewall rules, port conflicts. Spin a fresh
  RG, kill it cleanly when done.
- **Putting the JWT secret in `appsettings.Development.json` on the
  VM** — even for UAT, generate a fresh 64-char random string on
  the VM and pass via env var.
- **Running `make seed` weekly** — wipes UAT users' data. Do it
  once, snapshot, never run again until tear-down.
- **Skipping HTTPS** — Caddy makes it free; UAT users typing on
  unencrypted forms is a bad look.
