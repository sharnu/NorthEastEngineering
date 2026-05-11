#!/usr/bin/env bash
# vm-bootstrap.sh — one-shot setup for a fresh Ubuntu 22.04 VM.
#
# Run ONCE on the VM (as a sudo-capable user) before the first `make deploy`:
#   scp infra/vm-bootstrap.sh azureuser@<vm-ip>:~
#   ssh azureuser@<vm-ip> 'bash ~/vm-bootstrap.sh'
#
# Installs Docker, .NET 10 runtime, nginx; adds a 2 GB swap file; creates
# /opt/nee/{api,web,uploads,migrations}; writes the systemd unit and the
# nginx site; generates a JWT secret on first run. Idempotent — safe to
# re-run if something fails partway through.

set -euo pipefail

APP_USER="${APP_USER:-www-data}"
APP_HOME="/opt/nee"
ENV_FILE="/etc/nee.env"

log() { printf '\e[1;34m▶ %s\e[0m\n' "$*"; }

# ── 1. Packages ─────────────────────────────────────────────────────────────
log "Updating apt and installing base packages"
sudo apt update -qq
sudo DEBIAN_FRONTEND=noninteractive apt -y -qq upgrade
sudo DEBIAN_FRONTEND=noninteractive apt -y -qq install \
    nginx certbot python3-certbot-nginx ufw rsync ca-certificates curl gnupg

# Docker engine + compose plugin (idempotent)
if ! command -v docker >/dev/null 2>&1; then
    log "Installing Docker"
    curl -fsSL https://get.docker.com | sudo sh
fi
sudo usermod -aG docker "$USER" || true

# .NET 10 runtime (we publish locally, so just the runtime is enough)
if ! command -v dotnet >/dev/null 2>&1; then
    log "Installing .NET 10 runtime"
    if ! sudo apt -y -qq install dotnet-runtime-10.0 2>/dev/null; then
        # Fall back to Microsoft's install script if Ubuntu repos don't have it yet
        curl -fsSL https://dot.net/v1/dotnet-install.sh | sudo bash -s -- \
            --channel 10.0 --runtime aspnetcore --install-dir /usr/share/dotnet
        sudo ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet
    fi
fi

# ── 2. Swap (B1s has 1 GiB RAM; 2 GB swap absorbs spikes) ───────────────────
if [[ ! -f /swapfile ]]; then
    log "Creating 2 GB swapfile"
    sudo fallocate -l 2G /swapfile
    sudo chmod 600 /swapfile
    sudo mkswap /swapfile
    sudo swapon /swapfile
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

# ── 3. Firewall ─────────────────────────────────────────────────────────────
log "Configuring UFW"
sudo ufw --force reset >/dev/null
sudo ufw default deny incoming >/dev/null
sudo ufw default allow outgoing >/dev/null
sudo ufw allow OpenSSH >/dev/null
sudo ufw allow 'Nginx Full' >/dev/null
sudo ufw --force enable

# ── 4. App directories ──────────────────────────────────────────────────────
log "Creating $APP_HOME"
sudo mkdir -p "$APP_HOME"/{api,web,uploads,migrations}
sudo chown -R "$APP_USER:$APP_USER" "$APP_HOME/uploads"
sudo chown -R "$USER:$USER" "$APP_HOME/api" "$APP_HOME/web" "$APP_HOME/migrations"

# ── 5. Env file with secrets ────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
    log "Generating JWT secret and writing $ENV_FILE"
    JWT_SECRET="$(openssl rand -base64 48)"
    sudo tee "$ENV_FILE" >/dev/null <<EOF
ASPNETCORE_ENVIRONMENT=Production
ASPNETCORE_URLS=http://127.0.0.1:5000
ConnectionStrings__Postgres=Host=127.0.0.1;Port=5432;Database=nee;Username=nee;Password=nee_dev
Jwt__Secret=$JWT_SECRET
Jwt__Issuer=nee-platform
Jwt__Audience=nee-platform-web
EOF
    sudo chmod 600 "$ENV_FILE"
    sudo chown "$APP_USER:$APP_USER" "$ENV_FILE"
else
    log "$ENV_FILE already exists — leaving JWT secret untouched"
fi

# ── 6. systemd unit ─────────────────────────────────────────────────────────
log "Installing nee-api.service"
sudo tee /etc/systemd/system/nee-api.service >/dev/null <<EOF
[Unit]
Description=NEE API
After=network.target docker.service
Wants=docker.service

[Service]
WorkingDirectory=$APP_HOME/api
ExecStart=/usr/bin/env dotnet $APP_HOME/api/Nee.Api.dll
EnvironmentFile=$ENV_FILE
Restart=always
RestartSec=5
User=$APP_USER
# Map the persistent uploads dir into the API's expected path
BindPaths=$APP_HOME/uploads:$APP_HOME/api/uploads

[Install]
WantedBy=multi-user.target
EOF
sudo systemctl daemon-reload
sudo systemctl enable nee-api    # don't start yet — deploy will start it

# ── 7. nginx site ───────────────────────────────────────────────────────────
log "Installing nginx site"
sudo tee /etc/nginx/sites-available/nee >/dev/null <<'EOF'
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name _;

    root /opt/nee/web;
    index index.html;

    client_max_body_size 30m;          # match expected upload size

    # Block the dev endpoint from the internet — local curl still works
    location = /api/dev/reseed-passwords {
        allow 127.0.0.1;
        deny all;
        proxy_pass http://127.0.0.1:5000;
    }

    # API
    location /api/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 60s;
    }

    # SignalR / WebSocket upgrade (notifications hub)
    location /hubs/ {
        proxy_pass http://127.0.0.1:5000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
    }

    # Static asset cache
    location ~* \.(?:js|css|woff2?|png|jpg|jpeg|svg|ico)$ {
        expires 30d;
        access_log off;
        try_files $uri =404;
    }

    # SPA fallback
    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
sudo ln -sf /etc/nginx/sites-available/nee /etc/nginx/sites-enabled/nee
sudo rm -f /etc/nginx/sites-enabled/default
sudo nginx -t
sudo systemctl reload nginx

log "Bootstrap complete."
echo
echo "Next step (from your laptop):"
echo "  NEE_VM=$USER@<this-vm-ip> make deploy"
