#!/bin/bash
set -e
cd /app/trivio

COMPOSE="docker compose -f docker-compose.prod.yml --env-file .env.prod"

# ── 1. Pull latest code ────────────────────────────────────────────────────────
GIT_SSH_COMMAND='ssh -i ~/.ssh/trivio_deploy' git fetch origin main
git reset --hard origin/main

# ── 2. Build new image (runs alongside live container — zero downtime) ─────────
# Build both services so app-next uses the same new code as app
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

# Give Caddy time to detect app-next as healthy via its health checks
sleep 8

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
    exit 1
  fi
  sleep 3
done

# Give Caddy time to switch back to primary
sleep 8

# ── 8. Tear down standby ──────────────────────────────────────────────────────
echo "[deploy] Stopping app-next standby..."
$COMPOSE --profile blue-green stop app-next

echo "[deploy] Zero-downtime deploy complete"
