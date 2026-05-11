# Deploying NEE

Two supported targets, pick based on whether demo state needs to persist:

| Target | Best for | Cost | Persistence |
|---|---|---|---|
| **Azure VM (B1s)** | Long-running demo, customer pilot, anything where state matters | Free for 12 months, ~$10/mo after | Persistent — DB and uploads survive restarts |
| **Azure Container Apps** | Always-free public demo URL; every visitor gets the seeded state | $0 forever (within free allowance) | **Ephemeral** — every cold start re-seeds |

Files in this folder:

| File | Purpose |
|---|---|
| `vm-bootstrap.sh` | One-shot setup for a fresh Ubuntu 22.04 VM (Docker, .NET runtime, nginx, swap, systemd unit, firewall). Idempotent. |
| `deploy.sh` | Local build + rsync + remote service restart. Used for every VM deploy. |
| `Dockerfile` | Single-container image: Postgres + .NET API + nginx + Angular bundle. Powers the Container Apps path. |
| `container-entrypoint.sh` | Boots Postgres → applies migrations → starts nginx → execs the API. Runs as PID 1 in the container. |
| `nginx-in-container.conf` | nginx config for the bundled image (plain HTTP; TLS terminated by Container Apps). |
| `deploy-aca.sh` | Local build + image push + `az containerapp create/update`. |

Wrapped by Makefile targets:

- **VM**: `make deploy-bootstrap`, `make deploy`, `make deploy-logs`, `make deploy-reset`, `make deploy-ssh`
- **Container Apps**: `make deploy-aca-init`, `make deploy-aca`, `make deploy-aca-logs`, `make deploy-aca-url`

---

# Path 1 · Azure VM

## Architecture on the VM

```
              ┌─────────────── VM (Ubuntu 22.04, B1s) ───────────────┐
internet ──▶  │  nginx (80/443)                                       │
              │    /api/   ─▶ http://127.0.0.1:5000  (nee-api.service)│
              │    /hubs/  ─▶ http://127.0.0.1:5000  (SignalR upgrade)│
              │    /       ─▶ /opt/nee/web/    (Angular static)       │
              │                                                       │
              │  systemd: nee-api.service                             │
              │    runs /opt/nee/api/Nee.Api.dll, env from /etc/nee.env│
              │    uploads bind-mounted from /opt/nee/uploads         │
              │                                                       │
              │  docker compose (in /opt/nee):                        │
              │    postgres (5432)  ◀── migrations auto-applied       │
              │    mailpit  (1025/8025 — optional)                    │
              └───────────────────────────────────────────────────────┘
```

## Prerequisites

- **On Azure**: an active subscription (the free 12-month trial works).
- **Locally**: .NET 10 SDK, Node 20, `rsync`, an SSH key.
- **VM size**: B1s (1 vCPU, 1 GiB RAM) — free for 12 months under the trial, ~$7/mo after.
- **Disk**: 30 GB Standard SSD is plenty.

> B1s has only 1 GiB RAM. Builds happen on your laptop, not the VM. The bootstrap script also adds a 2 GB swap file as a safety net.

## One-time setup

### 1. Provision the VM

Azure portal → Virtual machines → Create:

- **Image**: Ubuntu Server 22.04 LTS
- **Size**: B1s
- **Auth**: SSH public key (paste your `~/.ssh/id_*.pub`)
- **Inbound ports**: SSH (22), HTTP (80), HTTPS (443)

Note the public IP and (optionally) assign a DNS label
(`nee-demo.australiaeast.cloudapp.azure.com` — free with the VM).

### 2. Bootstrap

```bash
export NEE_VM=azureuser@<vm-public-ip>     # or your SSH config alias
make deploy-bootstrap
```

What this does (`infra/vm-bootstrap.sh`):

- Installs Docker, .NET 10 runtime, nginx, certbot, ufw
- Creates a 2 GB swap file
- Sets up the firewall (SSH + Nginx Full only)
- Generates a strong JWT secret and writes `/etc/nee.env` (mode 600)
- Installs the `nee-api.service` systemd unit
- Installs the nginx site (`/etc/nginx/sites-available/nee`)
- Creates `/opt/nee/{api,web,uploads,migrations}`

Idempotent: safe to re-run. The JWT secret is preserved on re-runs.

### 3. First deploy

```bash
make deploy
```

`infra/deploy.sh`:

1. `npm run build -- --configuration production` in `web/`
2. `dotnet publish -c Release` in `api/`
3. rsync the Angular bundle, the API binaries, migrations, and `docker-compose.yml` to the VM
4. SSH in and `systemctl restart nee-api`

### 4. Seed and password-hash

```bash
make deploy-reset
```

This wipes any existing data, brings Postgres up fresh (so the schema +
seed migrations apply automatically), restarts the API, and POSTs to the
local `/api/dev/reseed-passwords` endpoint to install the demo password
hashes. Takes about 10 seconds.

You can now hit `http://<vm-ip>/` and log in with the seed accounts in
`docs/seed-accounts.md` (password: `nee2026`).

## Routine deployment

After the bootstrap, normal code deploys are just:

```bash
make deploy           # build locally, rsync, restart API
```

Run it any time. The API restart is graceful — systemd does a stop-then-start.

Skip parts of the build if nothing changed there:

```bash
SKIP_WEB=1 make deploy    # API-only change
SKIP_API=1 make deploy    # CSS/HTML-only change
```

## HTTPS

Once you have a DNS name pointing at the VM (Azure auto-DNS or a custom domain):

```bash
make deploy-ssh
sudo certbot --nginx -d nee-demo.australiaeast.cloudapp.azure.com
```

Certbot edits the nginx config in place and renews automatically.

## Common operations

| Want to… | Command |
|---|---|
| Tail API logs | `make deploy-logs` |
| SSH in | `make deploy-ssh` |
| Reset demo data | `make deploy-reset` |
| Restart just the API | `ssh $NEE_VM 'sudo systemctl restart nee-api'` |
| Check service status | `ssh $NEE_VM 'sudo systemctl status nee-api'` |
| Check Postgres | `ssh $NEE_VM 'docker exec nee-postgres pg_isready -U nee'` |
| nginx error log | `ssh $NEE_VM 'sudo tail -f /var/log/nginx/error.log'` |
| Free disk / RAM | `ssh $NEE_VM 'df -h /; free -h'` |

## Configuration

API config lives in `/etc/nee.env` on the VM:

```dotenv
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://127.0.0.1:5000
ConnectionStrings__Postgres=Host=127.0.0.1;Port=5432;Database=nee;Username=nee;Password=nee_dev
Jwt__Secret=<generated-on-bootstrap>
Jwt__Issuer=nee-platform
Jwt__Audience=nee-platform-web
```

Edit it via `make deploy-ssh` and `sudo nano /etc/nee.env`, then
`sudo systemctl restart nee-api`. Don't commit changes here — secrets stay
on the VM.

## Adding a database migration

1. Drop the new `.sql` file into `db/migrations/` locally.
2. `make deploy` — the file rsyncs to `/opt/nee/migrations/` on the VM.

`make deploy` does **not** apply migrations to an existing database — the
Docker entrypoint only runs init scripts on an empty volume. Two options:

- **Destructive (demo): `make deploy-reset`** — wipes everything, re-applies all migrations from scratch.
- **In-place**: `ssh $NEE_VM 'docker exec -i nee-postgres psql -U nee -d nee < /opt/nee/migrations/0XX_new.sql'`

## Security notes

- The dev endpoint `/api/dev/reseed-passwords` is **internet-blocked** by the nginx site (only `127.0.0.1` can reach it). `make deploy-reset` works because it runs on the VM's loopback.
- The Postgres password (`nee_dev`) is fine for a demo bound to localhost on a single VM. If you start exposing 5432 externally, change it.
- JWT secret is generated per-VM; never reused across deployments.
- Mailpit is dev-only — leave the compose file as-is or comment out the service if you're not testing email flows on the VM.

## Cost

| Component | Cost |
|---|---|
| B1s VM | Free for 12 months, then ~$7.50/mo |
| 30 GB Standard SSD | Free for 12 months, then ~$2.50/mo |
| Bandwidth (outbound) | First 100 GB/mo free |
| Public IP (basic, dynamic) | Free |
| Total | **$0 for 12 months → ~$10/mo after** |

Set a calendar reminder for month 11 — Microsoft does not auto-renew the
free trial.

## Troubleshooting

**`make deploy` fails on the API publish step.**
Run `dotnet --version` locally — needs the .NET 10 SDK installed.

**API won't start (`make deploy-logs` shows `dotnet: command not found`).**
The bootstrap fell back to the manual install. Re-run `make deploy-bootstrap`
or manually symlink: `ssh $NEE_VM 'sudo ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet'`.

**`502 Bad Gateway` from nginx.**
The API isn't listening on 5000. Check:
```
make deploy-logs                                  # journalctl tail
make deploy-ssh
sudo systemctl status nee-api                     # state + last error
ss -ltnp | grep 5000                              # is anything bound?
```

**Login fails with "Invalid credentials" after a fresh deploy.**
Passwords haven't been hashed yet. Run `make deploy-reset` (or just the curl
step from the VM: `curl -X POST http://localhost/api/dev/reseed-passwords`).

**Out of memory during peak load.**
Check `free -h`. If swap is being hammered, upsize to B1ms (2 GiB) — about
$15/mo. The app fits in 1 GiB but doesn't have headroom for big concurrent
requests like PDF processing.

**Postgres won't come up after `deploy-reset`.**
Check the Docker volume mount:
```
ssh $NEE_VM 'docker logs nee-postgres | tail -50'
```
A migration syntax error will halt the entrypoint and leave the container
unhealthy. Fix the SQL locally, `make deploy`, then `make deploy-reset`.

---

# Path 2 · Azure Container Apps (self-resetting demo)

The whole stack — Postgres, .NET API, nginx, Angular static — is packaged
into a single image. On Container Apps with `min-replicas=0`, the container
sleeps when idle and cold-starts fresh on the next request. Because the
filesystem is ephemeral by default, every cold start applies all migrations
from scratch — so each visitor lands on a clean, seeded demo.

This stays inside the always-free Container Apps allowance
(180k vCPU-sec/month) for sporadic traffic.

## Architecture inside the container

```
┌───────── nee container ──────────┐        Azure Container Apps
│  /entrypoint.sh (PID 1)          │        (terminates TLS, scales 0↔1)
│  ├─ pg_ctl start  (background)   │ ─── exposes :80 ───▶ https://nee.<env>.azurecontainerapps.io
│  ├─ apply migrations once        │
│  ├─ nginx        (background)    │
│  ├─ hash passwords (one-shot)    │
│  └─ exec dotnet Nee.Api.dll      │
│                                  │
│  Postgres → 127.0.0.1:5432       │
│  API      → 127.0.0.1:5000       │
│  nginx    → 0.0.0.0:80           │
└──────────────────────────────────┘
```

## Prerequisites

- Azure CLI (`az`) logged in (`az login`)
- Docker locally
- A container registry you can push to:
  - **GHCR** (free for public images): `docker login ghcr.io -u <user>` with a personal access token
  - **Docker Hub** (free for public images): `docker login`
  - **Azure Container Registry** (Basic ~$5/mo if you want it private in-Azure)

## One-time setup

```bash
export NEE_IMAGE=ghcr.io/<your-user>/nee     # or docker.io/<your-user>/nee
make deploy-aca-init
```

`deploy-aca-init` will:

1. `npm run build` + `dotnet publish` locally
2. `docker build` the single-container image
3. `docker push` two tags: a git-sha tag and `:latest`
4. Create the resource group (`nee-rg`) and Container Apps environment (`nee-env`) if they don't exist
5. Generate a JWT secret and store it as a Container Apps secret
6. `az containerapp create` the `nee` app with:
   - `--cpu 0.5 --memory 1Gi`
   - `--min-replicas 0 --max-replicas 1`
   - `--ingress external --target-port 80`
   - Env vars wiring `ConnectionStrings__Postgres`, `Jwt__Secret`, etc.

Output: a `https://nee.<random>.<region>.azurecontainerapps.io` URL.

## Routine deploy

```bash
make deploy-aca
```

Build → push → `az containerapp update` with the new image tag. Container
Apps creates a new revision and shifts 100% traffic over. Old revision
stays around for instant rollback (`az containerapp revision activate …`).

## Common operations

| Want to… | Command |
|---|---|
| Print the public URL | `make deploy-aca-url` |
| Tail container logs | `make deploy-aca-logs` |
| Trigger a fresh cold-start | Visit the URL after 5+ min idle |
| Force restart | `az containerapp revision restart -n nee -g nee-rg --revision <name>` |
| List revisions / roll back | `az containerapp revision list -n nee -g nee-rg -o table` |

## Cost math

Container Apps always-free allowance per subscription:

- 180,000 vCPU-seconds / month
- 360,000 GiB-seconds / month
- 2,000,000 HTTP requests / month

At 0.5 vCPU / 1 GiB, the free budget covers ~100 hours/month of
active runtime. With `min-replicas=0`, you only burn budget while
actively serving requests — a demo URL visited a few times a day
costs **$0**.

The registry adds cost only if you choose ACR Basic (~$5/mo). GHCR and
Docker Hub are free for public repositories.

## Trade-offs vs the VM

| | VM | Container Apps |
|---|---|---|
| Cold-start delay | none | 15–30 s after idle |
| Demo data persistence | yes | **no — resets on each cold start** |
| File uploads | persist | **lost on cold start** |
| HTTPS | manual (certbot) | automatic |
| Custom domain | nginx + DNS | one `az` command |
| Routine deploy | rsync | docker push + az update |
| Steady-state cost | $7/mo after trial | $0 forever |

If a customer needs to retain entered data between visits, use the VM.
If the goal is "a public URL that always shows the seeded demo state",
Container Apps is the better fit.

## Adding persistence (optional, ~$1/mo)

To turn the self-resetting demo into a persistent app:

1. Create an Azure Files share in a storage account (first 5 GB free on a new account).
2. `az containerapp env storage set` to expose it to the environment.
3. Attach a volume mount in the container app: `mountPath: /var/lib/postgresql/data`, `storageType: AzureFile`.
4. Set `--min-replicas 1` so the DB is never killed mid-flight.

Expect **noticeable slowdown** — Postgres on SMB-backed storage is fine for
this scope but not snappy. And keeping a replica alive 24/7 puts you past
the free vCPU allowance (≈ $11/mo for vCPU + memory).

## Troubleshooting

**Image push fails with "denied: requested access denied".**
You're not logged in to the registry. `docker login ghcr.io -u <user>`
with a GitHub PAT that has `write:packages`.

**`make deploy-aca-init` fails on `az containerapp create`.**
The Container Apps extension isn't installed: `az extension add -n containerapp`.

**Browser shows "Application Error" or 503.**
Container hasn't booted yet. `make deploy-aca-logs` to watch. First cold
start is slower than subsequent ones because the image layer cache is cold.

**Login fails with "Invalid credentials" right after a cold start.**
Password-hashing runs in the background ~5–15s after the API comes up. Wait
a moment and retry. The marker file ensures it doesn't run twice on the
same data volume.

**Demo data unexpectedly persists across visits.**
Container Apps may be keeping the replica warm if there's been recent
traffic — that's not a bug, just no cold-start happened. Either wait 5+ min
idle or restart the revision manually.
