#!/bin/bash
set -e
cd /app/trivio

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"

# ── 1. Pull latest code ────────────────────────────────────────────────────────
GIT_SSH_COMMAND='ssh -i ~/.ssh/trivio_deploy' git fetch origin main
git reset --hard origin/main

# ── 1a. Reload Caddy if config changed ────────────────────────────────────────
docker exec trivio-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && echo "[deploy] Caddy config reloaded" || echo "[deploy] Caddy reload failed (non-fatal)"

# ── 2. Build new image (runs alongside live container — zero downtime) ─────────
$COMPOSE build app app-next

# ── 3. Start standby container with new image ──────────────────────────────────
$COMPOSE --profile blue-green up -d --no-deps --force-recreate app-next

# ── 4. Wait for standby to be healthy ─────────────────────────────────────────
echo "[deploy] Waiting for app-next to be ready..."
for i in $(seq 1 40); do
  if docker exec trivio-app-next-1 wget -qO- http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "[deploy] app-next is healthy (${i}x3s)"
    break
  fi
  if [ "$i" -eq 40 ]; then
    echo "[deploy] Timed out — aborting, rolling back"
    $COMPOSE --profile blue-green stop app-next || true
    exit 1
  fi
  sleep 3
done

# ── 4a. Add app-next to Caddy upstream pool ───────────────────────────────────
echo "[deploy] Adding app-next to Caddy upstream pool..."
cp /app/trivio/Caddyfile /tmp/Caddyfile.primary
cp /app/trivio/Caddyfile.bgdeploy /app/trivio/Caddyfile
docker exec trivio-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && echo "[deploy] Caddy updated to blue-green config" || echo "[deploy] Caddy reload failed (non-fatal)"
sleep 8  # Give Caddy time to detect app-next as healthy via active health checks

# ── 5. Stop primary — Caddy automatically fails over to app-next ───────────────
echo "[deploy] Cutting over — stopping primary app..."
$COMPOSE stop app

# ── 6. Restart primary with new image ─────────────────────────────────────────
$COMPOSE up -d --no-deps --force-recreate app

# ── 7. Wait for primary to be healthy ─────────────────────────────────────────
echo "[deploy] Waiting for app to be ready..."
for i in $(seq 1 40); do
  if docker exec trivio-app-1 wget -qO- http://localhost:3000/api/health > /dev/null 2>&1; then
    echo "[deploy] app is healthy (${i}x3s)"
    break
  fi
  if [ "$i" -eq 40 ]; then
    echo "[deploy] WARNING: app health check timed out — app-next is still serving"
    # Restore primary Caddyfile before exit so normal-op state is preserved
    cp /tmp/Caddyfile.primary /app/trivio/Caddyfile 2>/dev/null || true
    docker exec trivio-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile 2>/dev/null || true
    exit 1
  fi
  sleep 3
done

sleep 6  # Give Caddy time to switch back to primary via health checks

# ── 8. Tear down standby ──────────────────────────────────────────────────────
echo "[deploy] Stopping app-next standby..."
$COMPOSE --profile blue-green stop app-next

# ── 8a. Restore Caddy to single-upstream config ───────────────────────────────
echo "[deploy] Restoring Caddy to primary-only config..."
cp /tmp/Caddyfile.primary /app/trivio/Caddyfile
docker exec trivio-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile && echo "[deploy] Caddy restored to primary-only config" || echo "[deploy] Caddy reload failed (non-fatal)"

echo "[deploy] Zero-downtime deploy complete"
