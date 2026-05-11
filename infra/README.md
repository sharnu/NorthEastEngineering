# Deploying NEE to an Azure VM

This folder holds everything needed to run the platform on a single Azure VM:

| File | Purpose |
|---|---|
| `vm-bootstrap.sh` | One-shot setup for a fresh Ubuntu 22.04 VM (Docker, .NET runtime, nginx, swap, systemd unit, firewall). Idempotent. |
| `deploy.sh` | Local build + rsync + remote service restart. Used for every code deploy. |

The Makefile in the repo root wraps both scripts:
`make deploy-bootstrap`, `make deploy`, `make deploy-logs`, `make deploy-reset`, `make deploy-ssh`.

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
