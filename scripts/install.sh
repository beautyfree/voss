#!/usr/bin/env bash
set -euo pipefail

# voss server installer
# Usage: curl -fsSL install.voss.dev | bash

echo ""
echo "  ██╗   ██╗ ██████╗ ███████╗███████╗"
echo "  ██║   ██║██╔═══██╗██╔════╝██╔════╝"
echo "  ██║   ██║██║   ██║███████╗███████╗"
echo "  ╚██╗ ██╔╝██║   ██║╚════██║╚════██║"
echo "   ╚████╔╝ ╚██████╔╝███████║███████║"
echo "    ╚═══╝   ╚═════╝ ╚══════╝╚══════╝"
echo ""
echo "  Self-hosted deployment platform"
echo ""

# ── Check root ──
if [ "$(id -u)" -ne 0 ]; then
  echo "  ✕ This script must be run as root"
  echo "    Run: sudo sh -c \"\$(curl -fsSL install.voss.dev)\""
  exit 1
fi

# ── Check OS ──
if [ ! -f /etc/debian_version ] && [ ! -f /etc/lsb-release ]; then
  echo "  ✕ Only Ubuntu/Debian are supported"
  exit 1
fi

echo "  Installing voss-server..."
echo ""

# ── Install Docker if needed ──
if ! command -v docker &> /dev/null; then
  echo "  Installing Docker..."
  apt-get update -qq
  apt-get install -y -qq ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
  apt-get update -qq
  apt-get install -y -qq docker-ce docker-ce-cli containerd.io docker-compose-plugin
  echo "  ✓ Docker installed"
else
  echo "  ✓ Docker already installed"
fi

# ── Create directories ──
mkdir -p /var/voss/{data,logs,uploads,backups}
mkdir -p /etc/voss
mkdir -p /etc/traefik/dynamic
echo "  ✓ Directories created"

# ── Create Docker networks ──
docker network create voss_runner 2>/dev/null || true
docker network create voss_internal 2>/dev/null || true
echo "  ✓ Docker networks created"

# ── Setup swap if < 2GB RAM ──
TOTAL_RAM_MB=$(free -m | awk '/^Mem:/{print $2}')
if [ "$TOTAL_RAM_MB" -lt 2048 ]; then
  if [ ! -f /swapfile ]; then
    echo "  Creating 2GB swap (RAM: ${TOTAL_RAM_MB}MB)..."
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "  ✓ Swap created"
  fi
fi

# ── Generate or reuse API key ──
if [ -f /etc/voss/config.json ]; then
  EXISTING_KEY=$(grep -o '"apiKey": *"[^"]*"' /etc/voss/config.json | cut -d'"' -f4)
fi
API_KEY=${EXISTING_KEY:-$(openssl rand -hex 32)}

# ── Detect server IP ──
SERVER_IP=$(curl -4 -s ifconfig.me || curl -4 -s icanhazip.com || echo "127.0.0.1")

# ── Write config ──
cat > /etc/voss/config.json << EOF
{
  "apiKey": "${API_KEY}",
  "serverIp": "${SERVER_IP}",
  "domain": "",
  "version": "0.1.0"
}
EOF
echo "  ✓ Config written to /etc/voss/config.json"

# ── Write Traefik static config ──
cat > /etc/traefik/traefik.yml << EOF
api:
  dashboard: false

entryPoints:
  web:
    address: ":80"
  websecure:
    address: ":443"
    http:
      tls: true

providers:
  file:
    directory: /etc/traefik/dynamic
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: ${ACME_EMAIL:-admin@localhost}
      storage: /etc/traefik/acme.json
      httpChallenge:
        entryPoint: web

log:
  level: WARN
EOF

# ── Write default middlewares ──
cat > /etc/traefik/dynamic/middlewares.yml << EOF
http:
  middlewares:
    redirect-to-https:
      redirectScheme:
        scheme: https
        permanent: true
EOF

# ── Start Traefik ──
touch /etc/traefik/acme.json
chmod 600 /etc/traefik/acme.json
docker rm -f traefik 2>/dev/null || true
docker run -d \
  --name traefik \
  --restart unless-stopped \
  --network voss_runner \
  -p 80:80 \
  -p 443:443 \
  -v /etc/traefik/traefik.yml:/etc/traefik/traefik.yml:ro \
  -v /etc/traefik/dynamic:/etc/traefik/dynamic \
  -v /etc/traefik/acme.json:/etc/traefik/acme.json \
  traefik:v3.6
echo "  ✓ Traefik started"

# ── Setup SQLite backup cron ──
cat > /etc/cron.daily/voss-backup << 'EOF'
#!/bin/bash
BACKUP_DIR=/var/voss/backups
DB_PATH=/var/voss/data/voss.db
DATE=$(date +%Y%m%d)

if [ -f "$DB_PATH" ]; then
  sqlite3 "$DB_PATH" ".backup $BACKUP_DIR/voss-$DATE.db"
  # Keep last 7 backups
  ls -t "$BACKUP_DIR"/voss-*.db 2>/dev/null | tail -n +8 | xargs rm -f 2>/dev/null
fi
EOF
chmod +x /etc/cron.daily/voss-backup
echo "  ✓ Daily backup cron installed"

# ── Setup firewall ──
if command -v ufw &> /dev/null; then
  ufw allow 22/tcp   > /dev/null 2>&1
  ufw allow 80/tcp   > /dev/null 2>&1
  ufw allow 443/tcp  > /dev/null 2>&1
  ufw allow 3456/tcp > /dev/null 2>&1  # voss-server API
  ufw --force enable  > /dev/null 2>&1
  echo "  ✓ Firewall configured"
fi

# ── Install Bun ──
if ! command -v bun &> /dev/null; then
  echo "  Installing Bun..."
  apt-get install -y -qq unzip > /dev/null 2>&1
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="$HOME/.bun"
  export PATH="$BUN_INSTALL/bin:$PATH"
  # Also make it available system-wide
  ln -sf "$BUN_INSTALL/bin/bun" /usr/local/bin/bun 2>/dev/null || true
  echo "  ✓ Bun installed"
else
  echo "  ✓ Bun already installed"
fi

# ── Clone and install voss-server ──
VOSS_DIR=/opt/voss
if [ -d "$VOSS_DIR" ]; then
  echo "  Updating voss-server..."
  cd "$VOSS_DIR" && git pull --quiet
else
  echo "  Cloning voss-server..."
  git clone --quiet --depth 1 https://github.com/beautyfree/voss.git "$VOSS_DIR"
fi
cd "$VOSS_DIR" && bun install --production 2>/dev/null
echo "  ✓ voss-server installed"

# ── Create systemd service ──
cat > /etc/systemd/system/voss-server.service << EOF
[Unit]
Description=voss deployment server
After=network.target docker.service
Requires=docker.service

[Service]
Type=simple
WorkingDirectory=/opt/voss
ExecStart=$(which bun) run packages/server/src/index.ts
Environment=VOSS_API_KEY=${API_KEY}
Environment=PORT=3456
Environment=VOSS_DOMAIN=${SERVER_IP}
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable voss-server
systemctl start voss-server
echo "  ✓ voss-server running (systemd)"

# ── Verify server is up ──
sleep 2
if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3456/api/health | grep -q "200"; then
  echo "  ✓ voss-server responding on :3456"
else
  echo "  ⚠ voss-server may still be starting... check: systemctl status voss-server"
fi

echo ""
echo "  ═══════════════════════════════════════"
echo "  ✓ voss installed successfully!"
echo ""
echo "  Server IP:  ${SERVER_IP}"
echo "  API Key:    ${API_KEY}"
echo ""
echo "  On your laptop, run:"
echo "    voss login ${SERVER_IP} ${API_KEY}"
echo ""
echo "  Then deploy your first app:"
echo "    cd my-app && voss deploy"
echo "  ═══════════════════════════════════════"
echo ""
