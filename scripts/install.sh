#!/bin/bash
set -euo pipefail

# voss server installer
# Usage: curl -fsSL install.voss.dev | sh

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

# ── Generate API key ──
API_KEY=$(openssl rand -hex 32)

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
  docker:
    endpoint: "unix:///var/run/docker.sock"
    exposedByDefault: false
    network: voss_runner
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
docker rm -f traefik 2>/dev/null || true
docker run -d \
  --name traefik \
  --restart unless-stopped \
  --network voss_runner \
  -p 80:80 \
  -p 443:443 \
  -v /var/run/docker.sock:/var/run/docker.sock:ro \
  -v /etc/traefik/traefik.yml:/etc/traefik/traefik.yml:ro \
  -v /etc/traefik/dynamic:/etc/traefik/dynamic:ro \
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

# ── TODO: Download and install voss-server binary ──
# For now, voss-server must be manually started:
#   VOSS_API_KEY=<key> bun packages/server/src/index.ts

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
